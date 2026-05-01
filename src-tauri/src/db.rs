use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::VacancyDraft;

static CONN: Mutex<Option<Connection>> = Mutex::new(None);

fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("skipi-crewing")
}

fn db_path(vault_path: &str) -> PathBuf {
    let dir = if vault_path.trim().is_empty() {
        default_data_dir()
    } else {
        PathBuf::from(vault_path)
    };
    std::fs::create_dir_all(&dir).ok();
    dir.join("crewing.sqlite")
}

pub fn init(vault_path: &str) -> Result<(), rusqlite::Error> {
    let conn = Connection::open(db_path(vault_path))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vacancies (
            id TEXT PRIMARY KEY,
            posted_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open'
        );
        CREATE TABLE IF NOT EXISTS applications (
            id TEXT PRIMARY KEY,
            vacancy_id TEXT NOT NULL,
            received_at TEXT NOT NULL,
            applicant_summary_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new'
        );
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL
        );",
    )?;
    // Inline migrations — additive only. Each ALTER TABLE is wrapped so
    // re-running on a freshly migrated DB is a no-op.
    for stmt in [
        "ALTER TABLE documents ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'",
        "ALTER TABLE documents ADD COLUMN template_id TEXT",
        "ALTER TABLE documents ADD COLUMN valid_to TEXT",
        "ALTER TABLE documents ADD COLUMN has_expiry INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE documents ADD COLUMN issuer TEXT",
        "ALTER TABLE documents ADD COLUMN issue_date TEXT",
        "ALTER TABLE documents ADD COLUMN cert_number TEXT",
    ] {
        let _ = conn.execute(stmt, []);
    }
    // Backfill category from doc_type for rows added before the migration.
    let _ = conn.execute(
        "UPDATE documents SET category = CASE doc_type
            WHEN 'license'   THEN 'Licences'
            WHEN 'mlc_cert'  THEN 'Certifications'
            WHEN 'template'  THEN 'Templates'
            WHEN 'checklist' THEN 'Checklists'
            ELSE 'Other'
         END WHERE category IS NULL OR category = 'Other'",
        [],
    );
    *CONN.lock().unwrap() = Some(conn);
    // Seed required templates (placeholders without files) on first run.
    let _ = seed_required_templates();
    Ok(())
}

const REQUIRED_TEMPLATES: &[(&str, &str, &str, &str, bool)] = &[
    // (template_id, name, category, doc_type, has_expiry)
    ("crew-licence",     "Manning Agency Licence",       "Licences",      "license",  true),
    ("mlc-cert",         "MLC Certificate",               "Certifications","mlc_cert", true),
    ("pi-insurance",     "P&I Insurance Cover",           "Insurance",     "other",    true),
    ("joining-checklist","Joining Checklist (template)",  "Checklists",    "checklist",false),
    ("info-pack",        "Seafarer Info Pack (template)", "Templates",     "template", false),
];

pub fn seed_required_templates() -> Result<(), rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let now = chrono::Utc::now().to_rfc3339();
    for (tid, name, cat, dtype, has_exp) in REQUIRED_TEMPLATES {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM documents WHERE template_id = ?1",
            params![tid],
            |r| r.get(0),
        ).unwrap_or(0);
        if exists > 0 { continue; }
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO documents (id, name, doc_type, stored_path, original_filename, size_bytes,
                notes, created_at, category, template_id, has_expiry)
             VALUES (?1, ?2, ?3, '', '', 0, NULL, ?4, ?5, ?6, ?7)",
            params![id, name, dtype, now, cat, tid, if *has_exp { 1 } else { 0 }],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedVacancy {
    pub id: String,
    pub posted_at: String,
    pub status: String,
    pub draft: VacancyDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedApplication {
    pub id: String,
    pub vacancy_id: String,
    pub received_at: String,
    pub status: String,
    pub applicant_summary: serde_json::Value,
}

pub fn save_posted_vacancy(
    id: &str,
    draft: &VacancyDraft,
    posted_at: &str,
) -> Result<(), rusqlite::Error> {
    let payload = serde_json::to_string(draft).unwrap();
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.execute(
        "INSERT OR REPLACE INTO vacancies (id, posted_at, payload_json, status) VALUES (?1, ?2, ?3, 'open')",
        params![id, posted_at, payload],
    )?;
    Ok(())
}

pub fn list_vacancies() -> Result<Vec<CachedVacancy>, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let mut stmt = conn.prepare(
        "SELECT id, posted_at, status, payload_json FROM vacancies ORDER BY posted_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let payload: String = r.get(3)?;
            let draft: VacancyDraft = serde_json::from_str(&payload).unwrap_or_else(|_| VacancyDraft {
                title: "(corrupted record)".into(),
                rank: String::new(),
                vessel_type: String::new(),
                vessel_imo: None,
                vessel_name: None,
                flag: None,
                join_date: None,
                join_port: None,
                contract_months: None,
                salary_min: None,
                salary_max: None,
                salary_currency: None,
                trading_area: None,
                trading_russia_ok: None,
                description: None,
                client_name: None,
            });
            Ok(CachedVacancy {
                id: r.get(0)?,
                posted_at: r.get(1)?,
                status: r.get(2)?,
                draft,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// ---------- Documents ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedDocument {
    pub id: String,
    pub name: String,
    pub doc_type: String,
    pub stored_path: String,
    pub original_filename: String,
    pub size_bytes: i64,
    pub notes: Option<String>,
    pub created_at: String,
    pub category: String,
    pub template_id: Option<String>,
    pub valid_to: Option<String>,
    pub has_expiry: bool,
    pub issuer: Option<String>,
    pub issue_date: Option<String>,
    pub cert_number: Option<String>,
}

fn documents_dir(vault_path: &str) -> PathBuf {
    let base: PathBuf = if vault_path.is_empty() {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("skipi-crewing")
    } else {
        PathBuf::from(vault_path)
    };
    let docs = base.join("documents");
    std::fs::create_dir_all(&docs).ok();
    docs
}

pub fn add_document(
    meta: &crate::CrewingDocumentMeta,
    source_path: &str,
    vault_path: &str,
) -> Result<CachedDocument, String> {
    let src = PathBuf::from(source_path);
    if !src.exists() {
        return Err(format!("source file not found: {source_path}"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let original_filename = src.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed")
        .to_string();
    let stored_filename = format!("{id}__{original_filename}");
    let stored = documents_dir(vault_path).join(&stored_filename);
    std::fs::copy(&src, &stored).map_err(|e| format!("copy failed: {e}"))?;
    let size = std::fs::metadata(&stored).map(|m| m.len() as i64).unwrap_or(0);
    let now = chrono::Utc::now().to_rfc3339();
    let category = doc_type_to_category(&meta.doc_type);

    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.execute(
        "INSERT INTO documents (id, name, doc_type, stored_path, original_filename, size_bytes,
            notes, created_at, category, has_expiry)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
        params![
            id, meta.name, meta.doc_type,
            stored.to_string_lossy(), original_filename, size,
            if meta.notes.is_empty() { None } else { Some(&meta.notes) },
            now, category,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(CachedDocument {
        id, name: meta.name.clone(), doc_type: meta.doc_type.clone(),
        stored_path: stored.to_string_lossy().into(),
        original_filename, size_bytes: size,
        notes: if meta.notes.is_empty() { None } else { Some(meta.notes.clone()) },
        created_at: now, category,
        template_id: None, valid_to: None, has_expiry: false,
        issuer: None, issue_date: None, cert_number: None,
    })
}

fn doc_type_to_category(t: &str) -> String {
    match t {
        "license"   => "Licences".into(),
        "mlc_cert"  => "Certifications".into(),
        "template"  => "Templates".into(),
        "checklist" => "Checklists".into(),
        _           => "Other".into(),
    }
}

pub fn attach_file_to_document(
    doc_id: &str,
    source_path: &str,
    vault_path: &str,
) -> Result<CachedDocument, String> {
    let src = PathBuf::from(source_path);
    if !src.exists() {
        return Err(format!("source file not found: {source_path}"));
    }
    let original_filename = src.file_name()
        .and_then(|s| s.to_str()).unwrap_or("unnamed").to_string();
    let stored_filename = format!("{doc_id}__{original_filename}");
    let stored = documents_dir(vault_path).join(&stored_filename);
    std::fs::copy(&src, &stored).map_err(|e| format!("copy failed: {e}"))?;
    let size = std::fs::metadata(&stored).map(|m| m.len() as i64).unwrap_or(0);

    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.execute(
        "UPDATE documents SET stored_path = ?1, original_filename = ?2, size_bytes = ?3 WHERE id = ?4",
        params![stored.to_string_lossy(), original_filename, size, doc_id],
    ).map_err(|e| e.to_string())?;
    fetch_document(doc_id).map_err(|e| e.to_string())
}

pub fn update_document_meta(
    doc_id: &str,
    name: Option<&str>,
    issuer: Option<&str>,
    issue_date: Option<&str>,
    valid_to: Option<&str>,
    cert_number: Option<&str>,
    notes: Option<&str>,
    has_expiry: bool,
) -> Result<CachedDocument, String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.execute(
        "UPDATE documents SET
            name = COALESCE(?1, name),
            issuer = ?2, issue_date = ?3, valid_to = ?4,
            cert_number = ?5, notes = ?6, has_expiry = ?7
         WHERE id = ?8",
        params![name, issuer, issue_date, valid_to, cert_number, notes,
                if has_expiry {1} else {0}, doc_id],
    ).map_err(|e| e.to_string())?;
    drop(guard);
    fetch_document(doc_id).map_err(|e| e.to_string())
}

pub fn delete_document(doc_id: &str) -> Result<(), String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let stored: Option<String> = conn.query_row(
        "SELECT stored_path FROM documents WHERE id = ?1",
        params![doc_id],
        |r| r.get(0),
    ).ok();
    conn.execute("DELETE FROM documents WHERE id = ?1", params![doc_id])
        .map_err(|e| e.to_string())?;
    if let Some(p) = stored {
        if !p.is_empty() { let _ = std::fs::remove_file(&p); }
    }
    Ok(())
}

pub fn find_document_by_template(template_id: &str) -> Result<Option<CachedDocument>, rusqlite::Error> {
    let id_opt: Option<String> = {
        let guard = CONN.lock().unwrap();
        let conn = guard.as_ref().expect("db not initialised");
        let mut stmt = conn.prepare(
            "SELECT id FROM documents WHERE template_id = ?1 LIMIT 1",
        )?;
        stmt.query_row(params![template_id], |r| r.get(0)).ok()
    };
    if let Some(id) = id_opt {
        Ok(Some(fetch_document(&id)?))
    } else {
        Ok(None)
    }
}

pub fn fetch_document(doc_id: &str) -> Result<CachedDocument, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.query_row(
        "SELECT id, name, doc_type, stored_path, original_filename, size_bytes, notes,
                created_at, category, template_id, valid_to, has_expiry, issuer, issue_date, cert_number
         FROM documents WHERE id = ?1",
        params![doc_id],
        |r| Ok(CachedDocument {
            id: r.get(0)?, name: r.get(1)?, doc_type: r.get(2)?,
            stored_path: r.get(3)?, original_filename: r.get(4)?, size_bytes: r.get(5)?,
            notes: r.get(6)?, created_at: r.get(7)?, category: r.get(8)?,
            template_id: r.get(9)?, valid_to: r.get(10)?,
            has_expiry: r.get::<_,i64>(11)? != 0,
            issuer: r.get(12)?, issue_date: r.get(13)?, cert_number: r.get(14)?,
        }),
    )
}

pub fn list_documents() -> Result<Vec<CachedDocument>, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let mut stmt = conn.prepare(
        "SELECT id, name, doc_type, stored_path, original_filename, size_bytes, notes,
                created_at, category, template_id, valid_to, has_expiry, issuer, issue_date, cert_number
         FROM documents ORDER BY category, name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CachedDocument {
                id: r.get(0)?, name: r.get(1)?, doc_type: r.get(2)?,
                stored_path: r.get(3)?, original_filename: r.get(4)?,
                size_bytes: r.get(5)?, notes: r.get(6)?, created_at: r.get(7)?,
                category: r.get(8)?, template_id: r.get(9)?,
                valid_to: r.get(10)?,
                has_expiry: r.get::<_,i64>(11)? != 0,
                issuer: r.get(12)?, issue_date: r.get(13)?, cert_number: r.get(14)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get_document_path(doc_id: &str) -> Result<String, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.query_row(
        "SELECT stored_path FROM documents WHERE id = ?1",
        params![doc_id],
        |r| r.get::<_, String>(0),
    )
}

pub fn list_applications() -> Result<Vec<CachedApplication>, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let mut stmt = conn.prepare(
        "SELECT id, vacancy_id, received_at, status, applicant_summary_json
         FROM applications ORDER BY received_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let summary: String = r.get(4)?;
            let value: serde_json::Value = serde_json::from_str(&summary).unwrap_or(serde_json::Value::Null);
            Ok(CachedApplication {
                id: r.get(0)?,
                vacancy_id: r.get(1)?,
                received_at: r.get(2)?,
                status: r.get(3)?,
                applicant_summary: value,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}
