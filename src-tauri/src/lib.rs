use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

mod db;
mod messaging;

// ---------- Settings ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CrewingProfile {
    pub legal_name: String,
    pub jurisdiction: String,
    pub registration_number: String,
    pub mlc_cert_number: String,
    pub mlc_cert_valid_to: String,
    pub contact_email: String,
    pub contact_phone: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InterfacePrefs {
    /// "dark" | "light" (placeholder, dark only for now)
    pub theme: String,
    /// "en" | "ru" (placeholder)
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]   // forward-compat: any new field added later loads with
                    // its Default value when absent from the JSON, so user
                    // settings survive every upgrade.
pub struct Settings {
    // ----- Connection (server, identity) -----
    pub server_url: String,
    pub bearer_token: String,
    pub crewing_id: String,
    pub company_name: String,
    pub reply_to: String,

    // ----- Vault (multi-user shared storage) -----
    pub vault_path: String,
    /// Recently used vault paths so the user can switch between them
    /// without re-picking via folder dialog every time.
    pub recent_vaults: Vec<String>,

    // ----- Crewing company profile -----
    pub profile: CrewingProfile,

    // ----- Interface preferences -----
    pub interface: InterfacePrefs,
}

impl Settings {
    fn config_path() -> PathBuf {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("skipi-crewing");
        std::fs::create_dir_all(&dir).ok();
        dir.join("settings.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        // First-run default points at the production endpoint; users on
        // the local dev backend can override it in Settings → Connection.
        let first_run = || Settings {
            server_url: "https://api.skipi.app".to_string(),
            ..Default::default()
        };
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => return first_run(),
        };
        match serde_json::from_str::<Settings>(&raw) {
            Ok(s) => s,
            Err(e) => {
                // Forward-compat fallback: settings.json from an older
                // build is missing required fields. Don't wipe it — back
                // it up so the user's token/crewing_id can be recovered,
                // and start with a sensible default.
                let backup = path.with_extension("json.bak");
                let _ = std::fs::copy(&path, &backup);
                eprintln!("settings deserialize failed ({e}); backed up to {backup:?}");
                first_run()
            }
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        let s = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, s).map_err(|e| e.to_string())
    }
}

// ---------- Vacancy payload ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacancyDraft {
    pub title: String,
    pub rank: String,
    pub vessel_type: String,
    pub vessel_imo: Option<String>,
    pub vessel_name: Option<String>,
    pub flag: Option<String>,
    pub join_date: Option<String>,
    pub join_port: Option<String>,
    pub contract_months: Option<u32>,
    pub salary_min: Option<f64>,
    pub salary_max: Option<f64>,
    pub salary_currency: Option<String>,
    pub trading_area: Option<String>,
    pub trading_russia_ok: Option<bool>,
    pub description: Option<String>,
    /// CRM phase-1: free-text client (the crewing's customer who
    /// requested this search). Promoted to FK in phase-2.
    #[serde(default)]
    pub client_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacancyPosted {
    pub id: String,
    pub posted_at: String,
}

// ---------- Tauri commands ----------

pub struct AppState {
    pub settings: Mutex<Settings>,
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(new_settings: Settings, state: tauri::State<AppState>) -> Result<(), String> {
    new_settings.save()?;
    *state.settings.lock().unwrap() = new_settings;
    Ok(())
}

#[tauri::command]
fn ensure_vault_folder(path: String) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())
}

/// Wire-format payload as accepted by skipi-server's POST /api/vacancies.
/// Built from VacancyDraft + Settings at send time.
#[derive(Debug, Clone, Serialize)]
struct VacancyWire<'a> {
    crewing_id: &'a str,
    rank: &'a str,
    vessel_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    vessel_imo: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flag: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trading_area: Option<&'a str>,
    russia_trading: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    joining_window_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    joining_window_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    contract_months: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    salary_min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    salary_max: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    salary_currency: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vessel_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    join_port: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_name: Option<&'a str>,
}

#[derive(Debug, Clone, Deserialize)]
struct VacancyServerResponse {
    id: String,
    published_at: String,
}

#[tauri::command]
fn post_vacancy(
    draft: VacancyDraft,
    state: tauri::State<AppState>,
) -> Result<VacancyPosted, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() {
        return Err("No bearer token configured. Open Settings and paste the token issued by Skipi.".into());
    }
    if settings.crewing_id.is_empty() {
        return Err("No crewing_id configured. Open Settings and paste the crewing_id issued together with the token.".into());
    }
    if settings.server_url.is_empty() {
        return Err("No server URL configured. Default is http://127.0.0.1:8000 for dev.".into());
    }

    let url = format!("{}/api/vacancies", settings.server_url.trim_end_matches('/'));
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // Build wire payload. Map join_date → joining_window_from (server uses
    // datetimes; we send midnight UTC). vessel_imo is integer on the server.
    let imo: Option<i64> = draft.vessel_imo.as_ref()
        .and_then(|s| s.trim().parse::<i64>().ok());
    let join_from = draft.join_date.as_ref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("{}T00:00:00+00:00", s));
    let salary_min_int = draft.salary_min.map(|f| f.round() as i64);
    let salary_max_int = draft.salary_max.map(|f| f.round() as i64);
    let reply_to = if settings.reply_to.is_empty() {
        None
    } else {
        Some(settings.reply_to.as_str())
    };

    let wire = VacancyWire {
        crewing_id: &settings.crewing_id,
        rank: &draft.rank,
        vessel_type: &draft.vessel_type,
        vessel_imo: imo,
        flag: draft.flag.as_deref(),
        trading_area: draft.trading_area.as_deref(),
        russia_trading: draft.trading_russia_ok.unwrap_or(false),
        joining_window_from: join_from.clone(),
        joining_window_to: None,
        contract_months: draft.contract_months,
        salary_min: salary_min_int,
        salary_max: salary_max_int,
        salary_currency: draft.salary_currency.as_deref(),
        description: draft.description.as_deref(),
        reply_to,
        title: Some(&draft.title),
        vessel_name: draft.vessel_name.as_deref(),
        join_port: draft.join_port.as_deref(),
        client_name: draft.client_name.as_deref(),
    };

    let resp = client
        .post(&url)
        .bearer_auth(&settings.bearer_token)
        .json(&wire)
        .send()
        .map_err(|e| format!("network error: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("server returned {status}: {body}"));
    }

    let server_resp: VacancyServerResponse = resp.json()
        .map_err(|e| format!("bad JSON from server: {e}"))?;

    db::save_posted_vacancy(&server_resp.id, &draft, &server_resp.published_at)
        .map_err(|e| format!("local cache write failed: {e}"))?;

    Ok(VacancyPosted {
        id: server_resp.id,
        posted_at: server_resp.published_at,
    })
}

#[tauri::command]
fn list_my_vacancies() -> Result<Vec<db::CachedVacancy>, String> {
    db::list_vacancies().map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerApplication {
    pub id: String,
    pub vacancy_id: String,
    pub received_at: String,
    pub contact_for_reply: String,
    pub message: Option<String>,
    pub summary: Option<serde_json::Value>,
    pub status: String,
    // Derived client-side from contact_for_reply.
    #[serde(default)]
    pub seafarer_user_id: Option<String>,
}

/// Vacancy as returned by GET /api/vacancies — superset of the local cache
/// shape, includes server-side fields like applications counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerVacancy {
    pub id: String,
    pub crewing_id: String,
    pub crewing_ref: String,
    pub rank: String,
    pub vessel_type: String,
    pub vessel_imo: Option<i64>,
    pub flag: Option<String>,
    pub trading_area: Option<String>,
    pub russia_trading: bool,
    pub joining_window_from: Option<String>,
    pub joining_window_to: Option<String>,
    pub contract_months: Option<i64>,
    pub salary_min: Option<i64>,
    pub salary_max: Option<i64>,
    pub salary_currency: Option<String>,
    pub salary_negotiable: bool,
    pub description: Option<String>,
    pub reply_to: String,
    pub title: Option<String>,
    pub vessel_name: Option<String>,
    pub join_port: Option<String>,
    #[serde(default)]
    pub client_name: Option<String>,
    pub published_at: String,
    pub expires_at: Option<String>,
    pub status: String,
    pub reply_count: i64,
    #[serde(default)]
    pub apply_click_count: i64,
    #[serde(default)]
    pub hide_count: i64,
    pub new_applications_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct VacancyListResp {
    items: Vec<ServerVacancy>,
}

#[tauri::command]
fn fetch_my_vacancies(
    state: tauri::State<AppState>,
) -> Result<Vec<ServerVacancy>, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() || settings.crewing_id.is_empty() || settings.server_url.is_empty() {
        return Err("Not configured. Open Settings.".into());
    }
    let url = format!(
        "{}/api/vacancies?crewing_id={}&include_closed=true&limit=200",
        settings.server_url.trim_end_matches('/'),
        settings.crewing_id
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().map_err(|e| format!("network error: {e}"))?;
    let s = resp.status();
    if !s.is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("server returned {s}: {body}"));
    }
    let parsed: VacancyListResp = resp.json().map_err(|e| format!("bad JSON: {e}"))?;
    Ok(parsed.items)
}

#[tauri::command]
fn fetch_applications_for_vacancy(
    vacancy_id: String,
    state: tauri::State<AppState>,
) -> Result<Vec<ServerApplication>, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() {
        return Err("No bearer token configured. Open Settings.".into());
    }
    if settings.server_url.is_empty() {
        return Err("No server URL configured.".into());
    }

    let url = format!(
        "{}/api/vacancies/{}/applications",
        settings.server_url.trim_end_matches('/'),
        vacancy_id
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .bearer_auth(&settings.bearer_token)
        .send()
        .map_err(|e| format!("network error: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("server returned {status}: {body}"));
    }

    resp.json::<Vec<ServerApplication>>()
        .map_err(|e| format!("bad JSON from server: {e}"))
}

// ---------- Documents module ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewingDocumentMeta {
    pub name: String,
    pub doc_type: String,    // 'license' | 'mlc_cert' | 'template' | 'checklist' | 'other'
    pub notes: String,
}

#[tauri::command]
fn add_document(
    meta: CrewingDocumentMeta,
    source_path: String,
    state: tauri::State<AppState>,
) -> Result<db::CachedDocument, String> {
    let settings = state.settings.lock().unwrap().clone();
    db::add_document(&meta, &source_path, &settings.vault_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_documents() -> Result<Vec<db::CachedDocument>, String> {
    db::list_documents().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_document(doc_id: String) -> Result<(), String> {
    let path = db::get_document_path(&doc_id).map_err(|e| e.to_string())?;
    if path.is_empty() {
        return Err("This document has no file attached. Use 'Attach file' first.".into());
    }
    open_with_default_app(&path)
}

#[tauri::command]
fn attach_file_to_document(
    doc_id: String,
    source_path: String,
    state: tauri::State<AppState>,
) -> Result<db::CachedDocument, String> {
    let settings = state.settings.lock().unwrap().clone();
    db::attach_file_to_document(&doc_id, &source_path, &settings.vault_path)
}

#[derive(Debug, Clone, Deserialize)]
pub struct DocumentMetaUpdate {
    pub name: Option<String>,
    pub issuer: Option<String>,
    pub issue_date: Option<String>,
    pub valid_to: Option<String>,
    pub cert_number: Option<String>,
    pub notes: Option<String>,
    pub has_expiry: bool,
}

#[tauri::command]
fn update_document(
    doc_id: String,
    meta: DocumentMetaUpdate,
) -> Result<db::CachedDocument, String> {
    db::update_document_meta(
        &doc_id,
        meta.name.as_deref(),
        meta.issuer.as_deref(),
        meta.issue_date.as_deref(),
        meta.valid_to.as_deref(),
        meta.cert_number.as_deref(),
        meta.notes.as_deref(),
        meta.has_expiry,
    )
}

#[tauri::command]
fn delete_document(doc_id: String) -> Result<(), String> {
    db::delete_document(&doc_id)
}

/// Read the document's stored file as (base64_data, mime). Used by the
/// frontend to render an inline preview (PDF in an iframe, image as <img>).
#[tauri::command]
fn read_document_file_base64(doc_id: String) -> Result<(String, String), String> {
    use base64::Engine;
    let path = db::get_document_path(&doc_id).map_err(|e| e.to_string())?;
    if path.is_empty() {
        return Err("This document has no file attached.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
    let mime = mime_from_path(&path);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((b64, mime))
}

fn mime_from_path(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".pdf") { "application/pdf".into() }
    else if lower.ends_with(".png") { "image/png".into() }
    else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") { "image/jpeg".into() }
    else if lower.ends_with(".webp") { "image/webp".into() }
    else if lower.ends_with(".gif") { "image/gif".into() }
    else if lower.ends_with(".bmp") { "image/bmp".into() }
    else if lower.ends_with(".txt") { "text/plain".into() }
    else { "application/octet-stream".into() }
}

fn open_with_default_app(path: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Demo documents (synthetic license + MLC cert) ----------

fn write_demo_pdf(title: &str, body_lines: &[&str]) -> Result<std::path::PathBuf, String> {
    use printpdf::{PdfDocument, Mm, BuiltinFont};
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(210.0), Mm(297.0), "L1");
    let layer = doc.get_page(page1).get_layer(layer1);
    let font = doc.add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;
    let body_font = doc.add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;
    layer.use_text(title, 18.0, Mm(20.0), Mm(265.0), &font);
    let mut y = 245.0;
    for line in body_lines {
        layer.use_text(*line, 11.0, Mm(20.0), Mm(y), &body_font);
        y -= 7.0;
    }
    let tmp = std::env::temp_dir().join(format!(
        "skipi-demo-{}.pdf",
        title.replace(' ', "-").to_lowercase()
    ));
    let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut buf = std::io::BufWriter::new(file);
    doc.save(&mut buf).map_err(|e| e.to_string())?;
    Ok(tmp)
}

/// Realistic synthetic content for each pre-seeded required template.
/// Structures follow the actual document layouts (MLC 2006 DMLC Part I,
/// IMO Recruitment & Placement Service licence, P&I cover note, etc.) but
/// are clearly marked SYNTHETIC at the top so they can never be mistaken
/// for genuine certificates.
fn template_pdf_content(template_id: &str) -> Option<(&'static str, Vec<String>)> {
    let issued = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let valid_to_5y = (chrono::Utc::now() + chrono::Duration::days(365 * 5))
        .format("%Y-%m-%d").to_string();
    let valid_to_1y = (chrono::Utc::now() + chrono::Duration::days(365))
        .format("%Y-%m-%d").to_string();
    Some(match template_id {
        "crew-licence" => ("Recruitment and Placement Service Licence", vec![
            "*** SYNTHETIC SAMPLE — NOT A VALID LICENCE ***".into(),
            "".into(),
            "Issuing Authority: Department of Maritime Affairs (DEMO)".into(),
            "Issued under MLC 2006 Regulation 1.4 and IMO Resolution".into(),
            "A.946(23) (Voluntary Member State Audit Scheme).".into(),
            "".into(),
            "LICENCE GRANTED TO".into(),
            "  Skipi Dev Crewing".into(),
            "  Address: 1 Demo Street, Tbilisi, Georgia".into(),
            format!("  Registration number: DEV-LIC-2026-0001"),
            "".into(),
            "SCOPE OF LICENCE".into(),
            "  - Recruitment and placement of seafarers (deck, engine,".into(),
            "    catering, hotel) for vessels engaged in international".into(),
            "    voyages under any flag.".into(),
            "  - Compliance with MLC 2006 Standard A1.4 (Recruitment".into(),
            "    and placement) and Guideline B1.4.".into(),
            "  - Quality management system: ISO 9001:2015 (DEMO).".into(),
            "".into(),
            format!("Date of issue : {issued}"),
            format!("Valid until   : {valid_to_5y}"),
            "".into(),
            "______________________________".into(),
            "Director, Maritime Personnel Affairs (DEMO)".into(),
            "Department of Maritime Affairs".into(),
        ]),
        "mlc-cert" => ("Maritime Labour Certificate", vec![
            "*** SYNTHETIC SAMPLE — NOT A VALID MLC CERTIFICATE ***".into(),
            "".into(),
            "Issued under the authority of the Government of:".into(),
            "  REPUBLIC OF MARSHALL ISLANDS (DEMO)".into(),
            "by the Maritime Administration of the Republic of the".into(),
            "Marshall Islands.".into(),
            "".into(),
            "Particulars of the recruiter:".into(),
            "  Name: Skipi Dev Crewing".into(),
            "  Address: 1 Demo Street, Tbilisi, Georgia".into(),
            "  Identification (Reg No): DEV-MLC-2026-0001".into(),
            "".into(),
            "This is to certify that the recruitment and placement".into(),
            "service has been audited and verified to be in compliance".into(),
            "with the requirements of the Maritime Labour Convention,".into(),
            "2006, as amended, in respect of:".into(),
            "  1. Minimum age".into(),
            "  2. Medical certification".into(),
            "  3. Qualifications of seafarers".into(),
            "  4. Seafarers' employment agreements".into(),
            "  5. Recruitment and placement procedures".into(),
            "  6. Hours of work or rest verification".into(),
            "  7. Documentation of employment conditions".into(),
            "  8. Anti-fraud and anti-discrimination procedures".into(),
            "  9. Complaints handling".into(),
            "".into(),
            format!("Date of issue : {issued}"),
            format!("Valid until   : {valid_to_5y}"),
            format!("Certificate No: DMLC-DEMO-2026-0001"),
            "".into(),
            "______________________________".into(),
            "For the Maritime Administrator (DEMO)".into(),
        ]),
        "pi-insurance" => ("P&I Insurance Cover Note", vec![
            "*** SYNTHETIC SAMPLE — NOT A VALID INSURANCE POLICY ***".into(),
            "".into(),
            "INSURER".into(),
            "  Demo P&I Mutual Association Ltd.".into(),
            "  Member of the International Group of P&I Clubs (DEMO)".into(),
            "".into(),
            "ASSURED".into(),
            "  Skipi Dev Crewing".into(),
            "  1 Demo Street, Tbilisi, Georgia".into(),
            "".into(),
            "TYPE OF COVER".into(),
            "  Crew liabilities (Class 1) — recruitment & placement".into(),
            "  service operator's liability for claims by seafarers".into(),
            "  arising from breach of employment contract, repatriation".into(),
            "  costs, medical expenses ashore, death and disability.".into(),
            "".into(),
            "LIMIT OF LIABILITY".into(),
            "  USD 5,000,000 any one event (DEMO)".into(),
            "  USD 25,000,000 in the aggregate".into(),
            "".into(),
            "PERIOD OF COVER".into(),
            format!("  From: {issued} 12:00 GMT"),
            format!("  To  : {valid_to_1y} 12:00 GMT"),
            "".into(),
            format!("Policy number : PI-DEMO-2026-0001"),
            "Geographic limits: Worldwide except sanctioned zones".into(),
            "".into(),
            "Subject to the rules and exclusions of the Association".into(),
            "in force from time to time.".into(),
        ]),
        "joining-checklist" => ("Seafarer Joining Checklist (Template)", vec![
            "*** SYNTHETIC TEMPLATE — replace with your own ***".into(),
            "".into(),
            "Vessel: ____________________  Position: _____________".into(),
            "Joining port: _______________  ETD: _________________".into(),
            "Seafarer: ____________________  Rank: ______________".into(),
            "".into(),
            "PRE-DEPARTURE DOCUMENTS".into(),
            "  [ ] Valid passport (>= 6 months remaining)".into(),
            "  [ ] Seaman's Discharge Book".into(),
            "  [ ] Certificate of Competency (CoC) for the position".into(),
            "  [ ] Medical fitness certificate (PEME, valid)".into(),
            "  [ ] Yellow Fever vaccination (if required by route)".into(),
            "  [ ] STCW basic safety: BST, AFF, PSCRB, MFA".into(),
            "  [ ] Vessel-specific endorsements (tanker, IGF, etc.)".into(),
            "  [ ] Visa for joining port + transit countries".into(),
            "  [ ] Letter of guarantee / contract".into(),
            "  [ ] Bank details for salary".into(),
            "".into(),
            "TRAVEL ARRANGEMENTS".into(),
            "  [ ] Flight tickets booked and forwarded".into(),
            "  [ ] Hotel reservation at joining port (if needed)".into(),
            "  [ ] Local agent contact provided".into(),
            "  [ ] Emergency contact at crewing office (24/7)".into(),
            "".into(),
            "BRIEFING".into(),
            "  [ ] Vessel particulars, owner, ISM details shared".into(),
            "  [ ] Salary scale, overtime, leave structure explained".into(),
            "  [ ] Repatriation conditions explained".into(),
            "  [ ] Onboard reporting and grievance channels shared".into(),
            "".into(),
            "Signed by seafarer: __________________  Date: _______".into(),
            "Signed by crewing : __________________  Date: _______".into(),
        ]),
        "info-pack" => ("Seafarer Information Pack (Template)", vec![
            "*** SYNTHETIC TEMPLATE — replace with your own ***".into(),
            "".into(),
            "Welcome from Skipi Dev Crewing".into(),
            "".into(),
            "About us".into(),
            "  Skipi Dev Crewing is a manning agency operating under".into(),
            "  MLC 2006 and the laws of the country of registration.".into(),
            "  We work with shipowners and ship managers across all".into(),
            "  vessel types.".into(),
            "".into(),
            "Your contract".into(),
            "  - Standard contracts follow ITF templates or owner".into(),
            "    CBA, whichever is more favourable.".into(),
            "  - Salary is paid in USD/EUR by 7th of the following".into(),
            "    month directly to your designated bank account.".into(),
            "  - Allotment to family is configurable up to 80%.".into(),
            "  - Overtime is calculated per the CBA in force.".into(),
            "".into(),
            "While onboard".into(),
            "  - Hours of work and rest are recorded per MLC 2.3.".into(),
            "  - Repatriation is at no cost to the seafarer per MLC 2.5.".into(),
            "  - Medical care onboard and ashore is covered per MLC 4.1.".into(),
            "  - Complaints can be raised onboard via the Master,".into(),
            "    or directly to the crewing office at any time.".into(),
            "".into(),
            "Contact us 24/7".into(),
            "  Email: ops@skipi-dev-crewing.example".into(),
            "  Phone: +995 XX XXX XXXX (DEMO)".into(),
            "  WhatsApp: same number above".into(),
        ]),
        _ => return None,
    })
}

#[tauri::command]
fn attach_demo_to_template(
    template_id: String,
    state: tauri::State<AppState>,
) -> Result<db::CachedDocument, String> {
    let settings = state.settings.lock().unwrap().clone();
    let doc = db::find_document_by_template(&template_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No template found with id '{template_id}'"))?;
    let (title, body) = template_pdf_content(&template_id)
        .ok_or_else(|| format!("Unknown template '{template_id}'"))?;
    let body_refs: Vec<&str> = body.iter().map(|s| s.as_str()).collect();
    let pdf = write_demo_pdf(title, &body_refs)?;
    db::attach_file_to_document(&doc.id, &pdf.to_string_lossy(), &settings.vault_path)
}

// ---------- App entry ----------

pub fn run() {
    let settings = Settings::load();
    db::init(&settings.vault_path).expect("db init");
    let state = AppState {
        settings: Mutex::new(settings),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            ensure_vault_folder,
            post_vacancy,
            list_my_vacancies,
            fetch_my_vacancies,
            fetch_applications_for_vacancy,
            add_document,
            list_documents,
            open_document,
            attach_demo_to_template,
            attach_file_to_document,
            update_document,
            delete_document,
            read_document_file_base64,
            messaging::get_my_identity,
            messaging::register_my_pubkey,
            messaging::send_encrypted_message,
            messaging::fetch_messages,
            messaging::upload_encrypted_attachment,
            messaging::download_encrypted_attachment,
            messaging::open_path_with_default,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skipi Crewing");
}
