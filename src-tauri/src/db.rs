use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
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
        );
        CREATE TABLE IF NOT EXISTS seafarers (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            rank TEXT,
            position TEXT,
            nationality TEXT,
            available_from TEXT,
            source_application_id TEXT,
            first_seen_at TEXT NOT NULL,
            last_received_at TEXT NOT NULL,
            ex_crew INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'prospect',
            notes TEXT,
            summary_json TEXT,
            manifest_json TEXT,
            docs_dir TEXT,
            cv_path TEXT,
            availability_status TEXT NOT NULL DEFAULT 'unknown',
            last_ping_at TEXT,
            last_reply_at TEXT,
            last_reply_text TEXT
        );
        CREATE TABLE IF NOT EXISTS seafarer_documents (
            id TEXT PRIMARY KEY,
            seafarer_id TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT,
            template_id TEXT,
            file_path TEXT,
            file_name TEXT,
            doc_number TEXT,
            issued_by TEXT,
            valid_from TEXT,
            valid_to TEXT,
            has_file INTEGER NOT NULL DEFAULT 0,
            received_at TEXT NOT NULL,
            FOREIGN KEY(seafarer_id) REFERENCES seafarers(id) ON DELETE CASCADE
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
        "ALTER TABLE seafarers ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'unknown'",
        "ALTER TABLE seafarers ADD COLUMN last_ping_at TEXT",
        "ALTER TABLE seafarers ADD COLUMN last_reply_at TEXT",
        "ALTER TABLE seafarers ADD COLUMN last_reply_text TEXT",
    ] {
        let _ = conn.execute(stmt, []);
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_seafarers_rank ON seafarers(rank);
         CREATE INDEX IF NOT EXISTS idx_seafarers_ex_crew ON seafarers(ex_crew);
         CREATE INDEX IF NOT EXISTS idx_seafarer_documents_owner ON seafarer_documents(seafarer_id);",
    )?;
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
    (
        "crew-licence",
        "Manning Agency Licence",
        "Licences",
        "license",
        true,
    ),
    (
        "mlc-cert",
        "MLC Certificate",
        "Certifications",
        "mlc_cert",
        true,
    ),
    (
        "pi-insurance",
        "P&I Insurance Cover",
        "Insurance",
        "other",
        true,
    ),
    (
        "joining-checklist",
        "Joining Checklist (template)",
        "Checklists",
        "checklist",
        false,
    ),
    (
        "info-pack",
        "Seafarer Info Pack (template)",
        "Templates",
        "template",
        false,
    ),
];

pub fn seed_required_templates() -> Result<(), rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let now = chrono::Utc::now().to_rfc3339();
    for (tid, name, cat, dtype, has_exp) in REQUIRED_TEMPLATES {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM documents WHERE template_id = ?1",
                params![tid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            continue;
        }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSeafarer {
    pub id: String,
    pub display_name: String,
    pub rank: Option<String>,
    pub position: Option<String>,
    pub nationality: Option<String>,
    pub available_from: Option<String>,
    pub source_application_id: Option<String>,
    pub first_seen_at: String,
    pub last_received_at: String,
    pub ex_crew: bool,
    pub status: String,
    pub notes: Option<String>,
    pub summary: serde_json::Value,
    pub manifest: serde_json::Value,
    pub docs_dir: Option<String>,
    pub cv_path: Option<String>,
    pub availability_status: String,
    pub last_ping_at: Option<String>,
    pub last_reply_at: Option<String>,
    pub last_reply_text: Option<String>,
    pub doc_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSeafarerDocument {
    pub id: String,
    pub seafarer_id: String,
    pub title: String,
    pub category: Option<String>,
    pub template_id: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub doc_number: Option<String>,
    pub issued_by: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub has_file: bool,
    pub received_at: String,
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
            let draft: VacancyDraft =
                serde_json::from_str(&payload).unwrap_or_else(|_| VacancyDraft {
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
                    languages: None,
                    nationalities: None,
                    description: None,
                    client_name: None,
                    compliance_profile_id: None,
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
    let original_filename = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed")
        .to_string();
    let stored_filename = format!("{id}__{original_filename}");
    let stored = documents_dir(vault_path).join(&stored_filename);
    std::fs::copy(&src, &stored).map_err(|e| format!("copy failed: {e}"))?;
    let size = std::fs::metadata(&stored)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    let now = chrono::Utc::now().to_rfc3339();
    let category = doc_type_to_category(&meta.doc_type);

    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    conn.execute(
        "INSERT INTO documents (id, name, doc_type, stored_path, original_filename, size_bytes,
            notes, created_at, category, has_expiry)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
        params![
            id,
            meta.name,
            meta.doc_type,
            stored.to_string_lossy(),
            original_filename,
            size,
            if meta.notes.is_empty() {
                None
            } else {
                Some(&meta.notes)
            },
            now,
            category,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(CachedDocument {
        id,
        name: meta.name.clone(),
        doc_type: meta.doc_type.clone(),
        stored_path: stored.to_string_lossy().into(),
        original_filename,
        size_bytes: size,
        notes: if meta.notes.is_empty() {
            None
        } else {
            Some(meta.notes.clone())
        },
        created_at: now,
        category,
        template_id: None,
        valid_to: None,
        has_expiry: false,
        issuer: None,
        issue_date: None,
        cert_number: None,
    })
}

fn doc_type_to_category(t: &str) -> String {
    match t {
        "license" => "Licences".into(),
        "mlc_cert" => "Certifications".into(),
        "template" => "Templates".into(),
        "checklist" => "Checklists".into(),
        _ => "Other".into(),
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
    let original_filename = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed")
        .to_string();
    let stored_filename = format!("{doc_id}__{original_filename}");
    let stored = documents_dir(vault_path).join(&stored_filename);
    std::fs::copy(&src, &stored).map_err(|e| format!("copy failed: {e}"))?;
    let size = std::fs::metadata(&stored)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

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
        params![
            name,
            issuer,
            issue_date,
            valid_to,
            cert_number,
            notes,
            if has_expiry { 1 } else { 0 },
            doc_id
        ],
    )
    .map_err(|e| e.to_string())?;
    drop(guard);
    fetch_document(doc_id).map_err(|e| e.to_string())
}

pub fn delete_document(doc_id: &str) -> Result<(), String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let stored: Option<String> = conn
        .query_row(
            "SELECT stored_path FROM documents WHERE id = ?1",
            params![doc_id],
            |r| r.get(0),
        )
        .ok();
    conn.execute("DELETE FROM documents WHERE id = ?1", params![doc_id])
        .map_err(|e| e.to_string())?;
    if let Some(p) = stored {
        if !p.is_empty() {
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(())
}

pub fn find_document_by_template(
    template_id: &str,
) -> Result<Option<CachedDocument>, rusqlite::Error> {
    let id_opt: Option<String> = {
        let guard = CONN.lock().unwrap();
        let conn = guard.as_ref().expect("db not initialised");
        let mut stmt = conn.prepare("SELECT id FROM documents WHERE template_id = ?1 LIMIT 1")?;
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
                id: r.get(0)?,
                name: r.get(1)?,
                doc_type: r.get(2)?,
                stored_path: r.get(3)?,
                original_filename: r.get(4)?,
                size_bytes: r.get(5)?,
                notes: r.get(6)?,
                created_at: r.get(7)?,
                category: r.get(8)?,
                template_id: r.get(9)?,
                valid_to: r.get(10)?,
                has_expiry: r.get::<_, i64>(11)? != 0,
                issuer: r.get(12)?,
                issue_date: r.get(13)?,
                cert_number: r.get(14)?,
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
            let value: serde_json::Value =
                serde_json::from_str(&summary).unwrap_or(serde_json::Value::Null);
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

// ---------- Local seafarer database ----------

fn seafarers_dir(vault_path: &str) -> PathBuf {
    let base: PathBuf = if vault_path.is_empty() {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("skipi-crewing")
    } else {
        PathBuf::from(vault_path)
    };
    let dir = base.join("seafarers");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn clean_path_part(value: &str, fallback: &str) -> String {
    let mut out: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    out = out.trim().trim_matches('.').to_string();
    if out.is_empty() {
        fallback.to_string()
    } else if out.len() > 90 {
        out.chars().take(90).collect()
    } else {
        out
    }
}

fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let p = Path::new(value);
    if p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for component in p.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

fn json_str<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = value;
    for key in path {
        cur = cur.get(*key)?;
    }
    cur.as_str().filter(|s| !s.trim().is_empty())
}

fn read_saved_seafarer(conn: &Connection, id: &str) -> Result<SavedSeafarer, rusqlite::Error> {
    conn.query_row(
        "SELECT s.id, s.display_name, s.rank, s.position, s.nationality, s.available_from,
                s.source_application_id, s.first_seen_at, s.last_received_at, s.ex_crew,
                s.status, s.notes, s.summary_json, s.manifest_json, s.docs_dir, s.cv_path,
                s.availability_status, s.last_ping_at, s.last_reply_at, s.last_reply_text,
                (SELECT COUNT(*) FROM seafarer_documents d WHERE d.seafarer_id = s.id AND d.has_file = 1)
         FROM seafarers s WHERE s.id = ?1",
        params![id],
        |r| {
            let summary_json: Option<String> = r.get(12)?;
            let manifest_json: Option<String> = r.get(13)?;
            Ok(SavedSeafarer {
                id: r.get(0)?,
                display_name: r.get(1)?,
                rank: r.get(2)?,
                position: r.get(3)?,
                nationality: r.get(4)?,
                available_from: r.get(5)?,
                source_application_id: r.get(6)?,
                first_seen_at: r.get(7)?,
                last_received_at: r.get(8)?,
                ex_crew: r.get::<_, i64>(9)? != 0,
                status: r.get(10)?,
                notes: r.get(11)?,
                summary: summary_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Null),
                manifest: manifest_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Null),
                docs_dir: r.get(14)?,
                cv_path: r.get(15)?,
                availability_status: r.get(16)?,
                last_ping_at: r.get(17)?,
                last_reply_at: r.get(18)?,
                last_reply_text: r.get(19)?,
                doc_count: r.get(20)?,
            })
        },
    )
}

pub fn get_saved_seafarer(seafarer_id: &str) -> Result<SavedSeafarer, String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    read_saved_seafarer(conn, seafarer_id).map_err(|e| e.to_string())
}

pub fn save_seafarer_from_bundle(
    application_id: &str,
    seafarer_user_id: &str,
    manifest: &serde_json::Value,
    extracted_to: &str,
    applicant_summary: Option<&serde_json::Value>,
    cv_path: Option<&str>,
    vault_path: &str,
) -> Result<SavedSeafarer, String> {
    let manifest_user_id = json_str(manifest, &["skipi_identity", "messaging_user_id"])
        .or_else(|| json_str(manifest, &["exported_by", "messaging_user_id"]))
        .or_else(|| json_str(manifest, &["exported_by", "user_id"]));
    let seafarer_id = if seafarer_user_id.trim().is_empty() {
        if let Some(id) = manifest_user_id {
            id.trim().to_string()
        } else {
            format!("application_{}", clean_path_part(application_id, "unknown"))
        }
    } else {
        seafarer_user_id.trim().to_string()
    };
    let safe_id = clean_path_part(&seafarer_id, "seafarer");
    let seafarers_base = seafarers_dir(vault_path);
    let docs_dir = seafarers_base.join(&safe_id);
    let staging_dir =
        seafarers_base.join(format!(".{}.{}", safe_id, uuid::Uuid::new_v4().simple()));
    let backup_dir = seafarers_base.join(format!(
        ".{}.backup.{}",
        safe_id,
        uuid::Uuid::new_v4().simple()
    ));

    let summary = applicant_summary
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let display_name = json_str(manifest, &["exported_by", "name"])
        .or_else(|| json_str(&summary, &["name"]))
        .or_else(|| json_str(&summary, &["redacted_initials"]))
        .unwrap_or(&seafarer_id)
        .to_string();
    let rank = json_str(manifest, &["exported_by", "rank"])
        .or_else(|| json_str(&summary, &["rank"]))
        .map(str::to_string);
    let position = json_str(manifest, &["exported_by", "position"])
        .or_else(|| json_str(&summary, &["position"]))
        .map(str::to_string);
    let nationality = json_str(&summary, &["nationality"])
        .or_else(|| json_str(&summary, &["nationality_code"]))
        .map(str::to_string);
    let available_from = json_str(&summary, &["available_from"]).map(str::to_string);

    let now = chrono::Utc::now().to_rfc3339();
    let manifest_json = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    let summary_json = serde_json::to_string(&summary).map_err(|e| e.to_string())?;

    struct PreparedDoc {
        title: String,
        category: Option<String>,
        template_id: Option<String>,
        file_path: Option<String>,
        file_name: Option<String>,
        doc_number: Option<String>,
        issued_by: Option<String>,
        valid_from: Option<String>,
        valid_to: Option<String>,
    }

    let prepared = (|| -> Result<(Option<String>, Vec<PreparedDoc>), String> {
        std::fs::create_dir_all(&staging_dir)
            .map_err(|e| format!("create seafarer staging dir: {e}"))?;

        let mut saved_cv_path: Option<String> = None;
        if let Some(path) = cv_path.filter(|p| !p.trim().is_empty()) {
            let src = PathBuf::from(path);
            if src.exists() {
                let fname = src
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| clean_path_part(s, "CV.pdf"))
                    .unwrap_or_else(|| "CV.pdf".to_string());
                let stage_dest = staging_dir.join("CV").join(&fname);
                let final_dest = docs_dir.join("CV").join(&fname);
                if let Some(parent) = stage_dest.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("create CV dir: {e}"))?;
                }
                std::fs::copy(&src, &stage_dest).map_err(|e| format!("copy CV: {e}"))?;
                saved_cv_path = Some(final_dest.to_string_lossy().to_string());
            }
        }

        let extracted_base = PathBuf::from(extracted_to);
        let docs = manifest
            .get("documents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut prepared_docs = Vec::new();
        for doc in docs {
            let title = json_str(&doc, &["title"])
                .unwrap_or("(untitled)")
                .to_string();
            let category = json_str(&doc, &["category"]).map(str::to_string);
            let template_id = json_str(&doc, &["template_id"]).map(str::to_string);
            let doc_number = json_str(&doc, &["doc_number"]).map(str::to_string);
            let issued_by = json_str(&doc, &["issued_by"]).map(str::to_string);
            let valid_from = json_str(&doc, &["valid_from"]).map(str::to_string);
            let valid_to = json_str(&doc, &["valid_to"]).map(str::to_string);
            let file_name = json_str(&doc, &["file_name"]).map(str::to_string);
            let mut stored_file_path: Option<String> = None;

            if let Some(rel) = json_str(&doc, &["file_path"]).and_then(safe_relative_path) {
                let src = extracted_base.join(&rel);
                if src.exists() {
                    let dest_rel =
                        safe_relative_path(&rel.to_string_lossy()).unwrap_or_else(|| {
                            PathBuf::from(clean_path_part(
                                file_name.as_deref().unwrap_or("document"),
                                "document",
                            ))
                        });
                    let stage_dest = staging_dir.join(&dest_rel);
                    let final_dest = docs_dir.join(&dest_rel);
                    if let Some(parent) = stage_dest.parent() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| format!("create document dir: {e}"))?;
                    }
                    std::fs::copy(&src, &stage_dest).map_err(|e| format!("copy document: {e}"))?;
                    stored_file_path = Some(final_dest.to_string_lossy().to_string());
                }
            }

            prepared_docs.push(PreparedDoc {
                title,
                category,
                template_id,
                file_path: stored_file_path,
                file_name,
                doc_number,
                issued_by,
                valid_from,
                valid_to,
            });
        }

        Ok((saved_cv_path, prepared_docs))
    })();

    let (saved_cv_path, prepared_docs) = match prepared {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging_dir);
            return Err(e);
        }
    };

    let had_existing_dir = docs_dir.exists();
    if had_existing_dir {
        if let Err(e) = std::fs::rename(&docs_dir, &backup_dir) {
            let _ = std::fs::remove_dir_all(&staging_dir);
            return Err(format!("backup existing seafarer dir: {e}"));
        }
    }
    if let Err(e) = std::fs::rename(&staging_dir, &docs_dir) {
        if had_existing_dir {
            let _ = std::fs::rename(&backup_dir, &docs_dir);
        }
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(format!("activate seafarer dir: {e}"));
    }

    let db_result = (|| -> Result<SavedSeafarer, String> {
        let mut guard = CONN.lock().unwrap();
        let conn = guard.as_mut().expect("db not initialised");
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let first_seen = tx
            .query_row(
                "SELECT first_seen_at FROM seafarers WHERE id = ?1",
                params![&seafarer_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| now.clone());
        tx.execute(
            "INSERT INTO seafarers
                (id, display_name, rank, position, nationality, available_from,
                 source_application_id, first_seen_at, last_received_at, ex_crew,
                 status, notes, summary_json, manifest_json, docs_dir, cv_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                 COALESCE((SELECT ex_crew FROM seafarers WHERE id = ?1), 0),
                 COALESCE((SELECT status FROM seafarers WHERE id = ?1), 'prospect'),
                 (SELECT notes FROM seafarers WHERE id = ?1),
                 ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                 display_name = excluded.display_name,
                 rank = excluded.rank,
                 position = excluded.position,
                 nationality = excluded.nationality,
                 available_from = excluded.available_from,
                 source_application_id = excluded.source_application_id,
                 last_received_at = excluded.last_received_at,
                 summary_json = excluded.summary_json,
                 manifest_json = excluded.manifest_json,
                 docs_dir = excluded.docs_dir,
                 cv_path = excluded.cv_path",
            params![
                &seafarer_id,
                &display_name,
                rank.as_deref(),
                position.as_deref(),
                nationality.as_deref(),
                available_from.as_deref(),
                application_id,
                &first_seen,
                &now,
                &summary_json,
                &manifest_json,
                docs_dir.to_string_lossy().as_ref(),
                saved_cv_path.as_deref(),
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM seafarer_documents WHERE seafarer_id = ?1",
            params![&seafarer_id],
        )
        .map_err(|e| e.to_string())?;

        if let Some(cv_file) = saved_cv_path.as_deref() {
            tx.execute(
                "INSERT INTO seafarer_documents
                    (id, seafarer_id, title, category, file_path, file_name, has_file, received_at)
                 VALUES (?1, ?2, 'CV', 'CV', ?3, ?4, 1, ?5)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    &seafarer_id,
                    cv_file,
                    Path::new(cv_file)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("CV.pdf"),
                    &now,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        for doc in prepared_docs {
            let has_file = doc.file_path.is_some() as i64;
            tx.execute(
                "INSERT INTO seafarer_documents
                    (id, seafarer_id, title, category, template_id, file_path, file_name,
                     doc_number, issued_by, valid_from, valid_to, has_file, received_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    &seafarer_id,
                    &doc.title,
                    doc.category.as_deref(),
                    doc.template_id.as_deref(),
                    doc.file_path.as_deref(),
                    doc.file_name.as_deref(),
                    doc.doc_number.as_deref(),
                    doc.issued_by.as_deref(),
                    doc.valid_from.as_deref(),
                    doc.valid_to.as_deref(),
                    has_file,
                    &now,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        read_saved_seafarer(conn, &seafarer_id).map_err(|e| e.to_string())
    })();

    match db_result {
        Ok(saved) => {
            if had_existing_dir {
                let _ = std::fs::remove_dir_all(&backup_dir);
            }
            Ok(saved)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&docs_dir);
            if had_existing_dir {
                let _ = std::fs::rename(&backup_dir, &docs_dir);
            }
            Err(e)
        }
    }
}

pub fn list_saved_seafarers() -> Result<Vec<SavedSeafarer>, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let mut stmt = conn.prepare(
        "SELECT id FROM seafarers
         ORDER BY ex_crew DESC, last_received_at DESC, display_name COLLATE NOCASE",
    )?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    let rows = ids
        .into_iter()
        .filter_map(|id| read_saved_seafarer(conn, &id).ok())
        .collect::<Vec<_>>();
    Ok(rows)
}

pub fn list_saved_seafarer_documents(
    seafarer_id: &str,
) -> Result<Vec<SavedSeafarerDocument>, rusqlite::Error> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let mut stmt = conn.prepare(
        "SELECT id, seafarer_id, title, category, template_id, file_path, file_name,
                doc_number, issued_by, valid_from, valid_to, has_file, received_at
         FROM seafarer_documents
         WHERE seafarer_id = ?1
         ORDER BY category COLLATE NOCASE, title COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map(params![seafarer_id], |r| {
            Ok(SavedSeafarerDocument {
                id: r.get(0)?,
                seafarer_id: r.get(1)?,
                title: r.get(2)?,
                category: r.get(3)?,
                template_id: r.get(4)?,
                file_path: r.get(5)?,
                file_name: r.get(6)?,
                doc_number: r.get(7)?,
                issued_by: r.get(8)?,
                valid_from: r.get(9)?,
                valid_to: r.get(10)?,
                has_file: r.get::<_, i64>(11)? != 0,
                received_at: r.get(12)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn update_saved_seafarer(
    seafarer_id: &str,
    ex_crew: Option<bool>,
    status: Option<&str>,
    notes: Option<&str>,
) -> Result<SavedSeafarer, String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    if let Some(v) = ex_crew {
        conn.execute(
            "UPDATE seafarers SET ex_crew = ?1 WHERE id = ?2",
            params![if v { 1 } else { 0 }, seafarer_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(v) = status {
        conn.execute(
            "UPDATE seafarers SET status = ?1 WHERE id = ?2",
            params![v, seafarer_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(v) = notes {
        conn.execute(
            "UPDATE seafarers SET notes = ?1 WHERE id = ?2",
            params![v, seafarer_id],
        )
        .map_err(|e| e.to_string())?;
    }
    read_saved_seafarer(conn, seafarer_id).map_err(|e| e.to_string())
}

pub fn mark_saved_seafarer_ping_sent(
    seafarer_id: &str,
    application_id: Option<&str>,
    sent_at: Option<&str>,
) -> Result<SavedSeafarer, String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let now = chrono::Utc::now().to_rfc3339();
    let ping_at = sent_at.unwrap_or(&now);
    if let Some(app_id) = application_id.filter(|v| !v.trim().is_empty()) {
        conn.execute(
            "UPDATE seafarers
             SET source_application_id = ?1,
                 availability_status = 'pinged',
                 last_ping_at = ?2
             WHERE id = ?3",
            params![app_id, ping_at, seafarer_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE seafarers
             SET availability_status = 'pinged',
                 last_ping_at = ?1
             WHERE id = ?2",
            params![ping_at, seafarer_id],
        )
        .map_err(|e| e.to_string())?;
    }
    read_saved_seafarer(conn, seafarer_id).map_err(|e| e.to_string())
}

pub fn mark_saved_seafarer_reply(
    seafarer_id: &str,
    status: &str,
    reply_at: &str,
    reply_text: &str,
) -> Result<SavedSeafarer, String> {
    let guard = CONN.lock().unwrap();
    let conn = guard.as_ref().expect("db not initialised");
    let text = if reply_text.chars().count() > 500 {
        reply_text.chars().take(500).collect::<String>()
    } else {
        reply_text.to_string()
    };
    conn.execute(
        "UPDATE seafarers
         SET availability_status = ?1,
             last_reply_at = ?2,
             last_reply_text = ?3
         WHERE id = ?4",
        params![status, reply_at, text, seafarer_id],
    )
    .map_err(|e| e.to_string())?;
    read_saved_seafarer(conn, seafarer_id).map_err(|e| e.to_string())
}
