use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

mod api;
mod db;
mod feedback;
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
    pub public_description: String,
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
#[serde(default)] // forward-compat: any new field added later loads with
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
        // First-run default points at the RF-friendly production endpoint; users on
        // the local dev backend can override it in Settings → Connection.
        let first_run = || Settings {
            server_url: api::RU_API.to_string(),
            ..Default::default()
        };
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => return first_run(),
        };
        match serde_json::from_str::<Settings>(&raw) {
            Ok(mut s) => {
                // Auto-migrate stale URLs from old builds that hardcoded
                // :8443 (nginx now listens on 443). Idempotent.
                if s.server_url.ends_with(":8443") {
                    s.server_url = s.server_url.trim_end_matches(":8443").to_string();
                    let _ = s.save();
                }
                s
            }
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
    #[serde(default)]
    pub languages: Option<Vec<String>>,
    #[serde(default)]
    pub nationalities: Option<Vec<String>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailingRequestDraft {
    pub title: String,
    pub rank: String,
    pub vessel_type: String,
    pub reply_to: Option<String>,
    pub client_name: Option<String>,
    pub description: Option<String>,
    pub min_experience_years: Option<u32>,
    pub required_certs: Option<Vec<String>>,
    pub languages: Option<Vec<String>>,
}

// ---------- Tauri commands ----------

pub struct AppState {
    pub settings: Mutex<Settings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewingTokenActivation {
    pub crewing_id: String,
    pub organization_id: Option<String>,
    pub display_name: String,
    pub verified_level: String,
    pub mlc_certified: bool,
    pub token_id: String,
    pub token_prefix: String,
    pub token_status: String,
    pub scopes: Vec<String>,
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(mut new_settings: Settings, state: tauri::State<AppState>) -> Result<(), String> {
    // Maintain recent_vaults list whenever vault_path changes via Settings.
    // Newest-first, deduped, capped at 10.
    if !new_settings.vault_path.is_empty() {
        new_settings
            .recent_vaults
            .retain(|p| p != &new_settings.vault_path);
        new_settings
            .recent_vaults
            .insert(0, new_settings.vault_path.clone());
        new_settings.recent_vaults.truncate(10);
    }
    new_settings.save()?;
    *state.settings.lock().unwrap() = new_settings;
    Ok(())
}

#[tauri::command]
fn forget_recent_vault(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap().clone();
    s.recent_vaults.retain(|p| p != &path);
    s.save()?;
    *state.settings.lock().unwrap() = s;
    Ok(())
}

#[tauri::command]
fn activate_crewing_token(
    server_url: String,
    bearer_token: String,
) -> Result<CrewingTokenActivation, String> {
    let base = server_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("No server URL configured.".into());
    }
    let token = bearer_token.trim();
    if token.is_empty() {
        return Err("No company token configured.".into());
    }
    api::post_empty_json::<CrewingTokenActivation>(
        Some(base),
        Some(token),
        "/api/crewings/token/activate",
        15,
    )
}

#[derive(Debug, Clone, Serialize)]
struct CrewingProfileWire<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legal_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    jurisdiction: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    registration_number: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mlc_cert_number: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mlc_cert_valid_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    contact_email: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    contact_phone: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slug: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    public_description: Option<&'a str>,
}

fn nonempty(s: &str) -> Option<&str> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[tauri::command]
fn sync_crewing_profile(state: tauri::State<AppState>) -> Result<String, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty()
        || settings.crewing_id.is_empty()
        || settings.server_url.is_empty()
    {
        return Ok("skipped: connection settings incomplete".into());
    }

    let profile = &settings.profile;
    let mlc_valid_to =
        nonempty(&profile.mlc_cert_valid_to).map(|s| format!("{}T00:00:00+00:00", s));
    let wire = CrewingProfileWire {
        display_name: nonempty(&settings.company_name),
        legal_name: nonempty(&profile.legal_name),
        jurisdiction: nonempty(&profile.jurisdiction),
        registration_number: nonempty(&profile.registration_number),
        mlc_cert_number: nonempty(&profile.mlc_cert_number),
        mlc_cert_valid_to: mlc_valid_to,
        contact_email: nonempty(&profile.contact_email),
        contact_phone: nonempty(&profile.contact_phone),
        slug: nonempty(&profile.slug),
        public_description: nonempty(&profile.public_description),
    };
    let path = format!("/api/crewings/{}/profile", settings.crewing_id);
    api::patch_json_empty(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        &wire,
        15,
    )?;
    Ok("synced".into())
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
    languages: Option<&'a Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nationalities: Option<&'a Vec<String>>,
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

#[derive(Debug, Clone, Serialize)]
struct MailingRequestWire<'a> {
    crewing_id: &'a str,
    title: &'a str,
    rank: &'a str,
    vessel_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_experience_years: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    required_certs: Option<&'a Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    languages: Option<&'a Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct VacancyServerResponse {
    id: String,
    published_at: String,
}

#[derive(Debug, Clone, Deserialize)]
struct MailingRequestServerResponse {
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
        return Err(
            "No bearer token configured. Open Settings and paste the token issued by Skipi.".into(),
        );
    }
    if settings.crewing_id.is_empty() {
        return Err("No crewing_id configured. Open Settings and paste the crewing_id issued together with the token.".into());
    }
    if settings.server_url.is_empty() {
        return Err("No server URL configured. Default is http://127.0.0.1:8000 for dev.".into());
    }

    // Build wire payload. Map join_date → joining_window_from (server uses
    // datetimes; we send midnight UTC). vessel_imo is integer on the server.
    let imo: Option<i64> = draft
        .vessel_imo
        .as_ref()
        .and_then(|s| s.trim().parse::<i64>().ok());
    let join_from = draft
        .join_date
        .as_ref()
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
        languages: draft.languages.as_ref(),
        nationalities: draft.nationalities.as_ref(),
        description: draft.description.as_deref(),
        reply_to,
        title: Some(&draft.title),
        vessel_name: draft.vessel_name.as_deref(),
        join_port: draft.join_port.as_deref(),
        client_name: draft.client_name.as_deref(),
    };

    let server_resp: VacancyServerResponse = api::post_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/vacancies",
        &wire,
        30,
    )?;

    db::save_posted_vacancy(&server_resp.id, &draft, &server_resp.published_at)
        .map_err(|e| format!("local cache write failed: {e}"))?;

    Ok(VacancyPosted {
        id: server_resp.id,
        posted_at: server_resp.published_at,
    })
}

#[tauri::command]
fn post_mailing_request(
    draft: MailingRequestDraft,
    state: tauri::State<AppState>,
) -> Result<VacancyPosted, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() {
        return Err(
            "No bearer token configured. Open Settings and paste the token issued by Skipi.".into(),
        );
    }
    if settings.crewing_id.is_empty() {
        return Err("No crewing_id configured. Open Settings and paste the crewing_id issued together with the token.".into());
    }
    if settings.server_url.is_empty() {
        return Err("No server URL configured.".into());
    }

    let reply_to_owned = draft
        .reply_to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            if settings.reply_to.trim().is_empty() {
                None
            } else {
                Some(settings.reply_to.trim().to_string())
            }
        });
    let wire = MailingRequestWire {
        crewing_id: &settings.crewing_id,
        title: &draft.title,
        rank: &draft.rank,
        vessel_type: &draft.vessel_type,
        reply_to: reply_to_owned.as_deref(),
        client_name: draft.client_name.as_deref(),
        description: draft.description.as_deref(),
        min_experience_years: draft.min_experience_years,
        required_certs: draft.required_certs.as_ref(),
        languages: draft.languages.as_ref(),
    };

    let server_resp: MailingRequestServerResponse = api::post_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mailing-requests",
        &wire,
        30,
    )?;
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
    // Slice D — present only when server was asked with
    // ?include_compliance=1 (or when any compliance filter was passed).
    #[serde(default)]
    pub compliance: Option<serde_json::Value>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerMailingRequest {
    pub id: String,
    pub crewing_id: String,
    pub crewing_ref: String,
    pub title: String,
    pub rank: String,
    pub vessel_type: String,
    pub reply_to: String,
    #[serde(default)]
    pub client_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub min_experience_years: Option<i64>,
    #[serde(default)]
    pub required_certs: Option<Vec<String>>,
    #[serde(default)]
    pub languages: Option<Vec<String>>,
    pub published_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    pub status: String,
    #[serde(default)]
    pub send_click_count: i64,
    #[serde(default)]
    pub hide_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct VacancyListResp {
    items: Vec<ServerVacancy>,
}

#[derive(Debug, Clone, Deserialize)]
struct MailingRequestListResp {
    items: Vec<ServerMailingRequest>,
}

#[tauri::command]
fn fetch_my_vacancies(state: tauri::State<AppState>) -> Result<Vec<ServerVacancy>, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty()
        || settings.crewing_id.is_empty()
        || settings.server_url.is_empty()
    {
        return Err("Not configured. Open Settings.".into());
    }
    let path = format!(
        "/api/vacancies?crewing_id={}&include_closed=true&limit=200",
        settings.crewing_id
    );
    let parsed: VacancyListResp = api::get_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )?;
    Ok(parsed.items)
}

#[tauri::command]
fn fetch_my_mailing_requests(
    state: tauri::State<AppState>,
) -> Result<Vec<ServerMailingRequest>, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty()
        || settings.crewing_id.is_empty()
        || settings.server_url.is_empty()
    {
        return Err("Not configured. Open Settings.".into());
    }
    let path = format!(
        "/api/mailing-requests?crewing_id={}&include_closed=true&limit=200",
        settings.crewing_id
    );
    let parsed: MailingRequestListResp = api::get_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )?;
    Ok(parsed.items)
}

#[tauri::command]
fn close_mailing_request_remote(
    request_id: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    mailing_request_action(&request_id, "close", state)
}

#[tauri::command]
fn reopen_mailing_request_remote(
    request_id: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    mailing_request_action(&request_id, "reopen", state)
}

#[tauri::command]
fn delete_mailing_request_remote(
    request_id: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() || settings.server_url.is_empty() {
        return Err("Not configured".into());
    }
    let path = format!("/api/mailing-requests/{request_id}");
    api::delete_empty(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )
}

fn mailing_request_action(
    request_id: &str,
    action: &str,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() || settings.server_url.is_empty() {
        return Err("Not configured".into());
    }
    let path = format!("/api/mailing-requests/{request_id}/{action}");
    api::post_empty(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )
}

#[tauri::command]
fn close_vacancy_remote(vacancy_id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() || settings.server_url.is_empty() {
        return Err("Not configured".into());
    }
    let path = format!("/api/vacancies/{vacancy_id}/close");
    api::post_empty(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )
}

#[tauri::command]
fn reopen_vacancy_remote(vacancy_id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() || settings.server_url.is_empty() {
        return Err("Not configured".into());
    }
    let path = format!("/api/vacancies/{vacancy_id}/reopen");
    api::post_empty(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )
}

#[tauri::command]
fn delete_vacancy_remote(vacancy_id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() || settings.server_url.is_empty() {
        return Err("Not configured".into());
    }
    let path = format!("/api/vacancies/{vacancy_id}");
    api::delete_empty(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct ApplicationsFilter {
    pub include_compliance: Option<bool>,
    pub missing_required: Option<i64>,
    pub expired_required: Option<i64>,
    pub months_in_rank: Option<i64>,
    pub required_cert: Option<String>,
    pub sort: Option<String>,
}

fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[tauri::command]
fn fetch_applications_for_vacancy(
    vacancy_id: String,
    filter: Option<ApplicationsFilter>,
    state: tauri::State<AppState>,
) -> Result<Vec<ServerApplication>, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.is_empty() {
        return Err("No bearer token configured. Open Settings.".into());
    }
    if settings.server_url.is_empty() {
        return Err("No server URL configured.".into());
    }

    let mut path = format!("/api/vacancies/{vacancy_id}/applications");
    if let Some(f) = filter {
        let mut q: Vec<String> = Vec::new();
        if matches!(f.include_compliance, Some(true)) {
            q.push("include_compliance=1".into());
        }
        if let Some(v) = f.missing_required {
            q.push(format!("missing_required={}", v));
        }
        if let Some(v) = f.expired_required {
            q.push(format!("expired_required={}", v));
        }
        if let Some(v) = f.months_in_rank {
            q.push(format!("months_in_rank={}", v));
        }
        if let Some(v) = f.required_cert {
            if !v.is_empty() {
                q.push(format!("required_cert={}", urlenc(&v)));
            }
        }
        if let Some(v) = f.sort {
            if !v.is_empty() && v != "received_at" {
                q.push(format!("sort={}", urlenc(&v)));
            }
        }
        if !q.is_empty() {
            path.push('?');
            path.push_str(&q.join("&"));
        }
    }
    api::get_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        20,
    )
}

// ---------- Documents module ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewingDocumentMeta {
    pub name: String,
    pub doc_type: String, // 'license' | 'mlc_cert' | 'template' | 'checklist' | 'other'
    pub notes: String,
}

#[tauri::command]
fn add_document(
    meta: CrewingDocumentMeta,
    source_path: String,
    state: tauri::State<AppState>,
) -> Result<db::CachedDocument, String> {
    let settings = state.settings.lock().unwrap().clone();
    db::add_document(&meta, &source_path, &settings.vault_path).map_err(|e| e.to_string())
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
fn update_document(doc_id: String, meta: DocumentMetaUpdate) -> Result<db::CachedDocument, String> {
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

#[tauri::command]
fn save_seafarer_from_bundle(
    application_id: String,
    seafarer_user_id: String,
    manifest: serde_json::Value,
    extracted_to: String,
    applicant_summary: Option<serde_json::Value>,
    cv_path: Option<String>,
    state: tauri::State<AppState>,
) -> Result<db::SavedSeafarer, String> {
    let settings = state.settings.lock().unwrap().clone();
    db::save_seafarer_from_bundle(
        &application_id,
        &seafarer_user_id,
        &manifest,
        &extracted_to,
        applicant_summary.as_ref(),
        cv_path.as_deref(),
        &settings.vault_path,
    )
}

#[tauri::command]
fn list_saved_seafarers() -> Result<Vec<db::SavedSeafarer>, String> {
    db::list_saved_seafarers().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_saved_seafarer_documents(
    seafarer_id: String,
) -> Result<Vec<db::SavedSeafarerDocument>, String> {
    db::list_saved_seafarer_documents(&seafarer_id).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SavedSeafarerUpdate {
    pub ex_crew: Option<bool>,
    pub status: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
fn update_saved_seafarer(
    seafarer_id: String,
    patch: SavedSeafarerUpdate,
) -> Result<db::SavedSeafarer, String> {
    db::update_saved_seafarer(
        &seafarer_id,
        patch.ex_crew,
        patch.status.as_deref(),
        patch.notes.as_deref(),
    )
}

fn classify_availability_reply(text: &str) -> &'static str {
    let lower = text.to_lowercase();
    let negative = [
        "not available",
        "unavailable",
        "not ready",
        "no work",
        "can't",
        "cannot",
        "не готов",
        "не могу",
        "недоступ",
    ];
    if negative.iter().any(|needle| lower.contains(needle)) {
        return "not_available";
    }
    let positive = ["available", "ready", "can join", "готов", "доступ", "могу"];
    if positive.iter().any(|needle| lower.contains(needle)) {
        return "available";
    }
    "replied"
}

#[tauri::command]
fn send_saved_seafarer_ping(
    seafarer_id: String,
    plaintext: String,
    state: tauri::State<AppState>,
) -> Result<db::SavedSeafarer, String> {
    let settings = state.settings.lock().unwrap().clone();
    if seafarer_id.trim().is_empty() || seafarer_id.starts_with("application_") {
        return Err("Saved record has no server seafarer ID.".into());
    }
    if settings.bearer_token.trim().is_empty() {
        return Err("No company token configured. Open Settings.".into());
    }
    if settings.crewing_id.trim().is_empty() {
        return Err("No crewing_id configured. Open Settings.".into());
    }
    messaging::register_my_pubkey(
        settings.crewing_id.clone(),
        Some(settings.bearer_token.clone()),
        Some(settings.server_url.clone()),
    )?;
    let saved = db::get_saved_seafarer(&seafarer_id)?;
    let msg = if let Some(app_id) = saved
        .source_application_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        messaging::send_encrypted_message(
            app_id.to_string(),
            seafarer_id.clone(),
            plaintext,
            Some(settings.server_url.clone()),
        )?
    } else {
        messaging::send_direct_availability_ping(
            seafarer_id.clone(),
            plaintext,
            settings.bearer_token.clone(),
            Some(settings.server_url.clone()),
        )?
    };
    db::mark_saved_seafarer_ping_sent(&seafarer_id, Some(&msg.application_id), Some(&msg.sent_at))
}

#[tauri::command]
fn refresh_saved_seafarer_replies(
    seafarer_id: String,
    state: tauri::State<AppState>,
) -> Result<db::SavedSeafarer, String> {
    let settings = state.settings.lock().unwrap().clone();
    let saved = db::get_saved_seafarer(&seafarer_id)?;
    let Some(application_id) = saved
        .source_application_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    else {
        return Ok(saved);
    };
    let messages = messaging::fetch_messages(
        application_id.to_string(),
        Some(settings.server_url.clone()),
    )?;
    let last_ping_at = saved.last_ping_at.clone().unwrap_or_default();
    let latest_reply = messages
        .into_iter()
        .filter(|m| m.from_user_id == seafarer_id)
        .filter(|m| !m.plaintext.trim_start().starts_with("[skipi:"))
        .filter(|m| last_ping_at.is_empty() || m.sent_at > last_ping_at)
        .max_by(|a, b| a.sent_at.cmp(&b.sent_at));
    if let Some(reply) = latest_reply {
        let status = classify_availability_reply(&reply.plaintext);
        db::mark_saved_seafarer_reply(&seafarer_id, status, &reply.sent_at, &reply.plaintext)
    } else {
        Ok(saved)
    }
}

#[tauri::command]
fn send_direct_availability_ping(
    seafarer_id: String,
    plaintext: String,
    state: tauri::State<AppState>,
) -> Result<db::SavedSeafarer, String> {
    let settings = state.settings.lock().unwrap().clone();
    if settings.bearer_token.trim().is_empty() {
        return Err("No company token configured. Open Settings.".into());
    }
    if settings.crewing_id.trim().is_empty() {
        return Err("No crewing_id configured. Open Settings.".into());
    }
    messaging::register_my_pubkey(
        settings.crewing_id.clone(),
        Some(settings.bearer_token.clone()),
        Some(settings.server_url.clone()),
    )?;
    let msg = messaging::send_direct_availability_ping(
        seafarer_id.clone(),
        plaintext,
        settings.bearer_token.clone(),
        Some(settings.server_url.clone()),
    )?;
    db::mark_saved_seafarer_ping_sent(&seafarer_id, Some(&msg.application_id), Some(&msg.sent_at))
}

fn mime_from_path(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".pdf") {
        "application/pdf".into()
    } else if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".webp") {
        "image/webp".into()
    } else if lower.ends_with(".gif") {
        "image/gif".into()
    } else if lower.ends_with(".bmp") {
        "image/bmp".into()
    } else if lower.ends_with(".txt") {
        "text/plain".into()
    } else {
        "application/octet-stream".into()
    }
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
    use printpdf::{BuiltinFont, Mm, PdfDocument};
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(210.0), Mm(297.0), "L1");
    let layer = doc.get_page(page1).get_layer(layer1);
    let font = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;
    let body_font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
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
        .format("%Y-%m-%d")
        .to_string();
    let valid_to_1y = (chrono::Utc::now() + chrono::Duration::days(365))
        .format("%Y-%m-%d")
        .to_string();
    Some(match template_id {
        "crew-licence" => (
            "Recruitment and Placement Service Licence",
            vec![
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
            ],
        ),
        "mlc-cert" => (
            "Maritime Labour Certificate",
            vec![
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
            ],
        ),
        "pi-insurance" => (
            "P&I Insurance Cover Note",
            vec![
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
            ],
        ),
        "joining-checklist" => (
            "Seafarer Joining Checklist (Template)",
            vec![
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
            ],
        ),
        "info-pack" => (
            "Seafarer Information Pack (Template)",
            vec![
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
            ],
        ),
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
            activate_crewing_token,
            sync_crewing_profile,
            forget_recent_vault,
            ensure_vault_folder,
            post_vacancy,
            post_mailing_request,
            list_my_vacancies,
            fetch_my_vacancies,
            fetch_my_mailing_requests,
            close_vacancy_remote,
            reopen_vacancy_remote,
            delete_vacancy_remote,
            close_mailing_request_remote,
            reopen_mailing_request_remote,
            delete_mailing_request_remote,
            fetch_applications_for_vacancy,
            add_document,
            list_documents,
            open_document,
            attach_demo_to_template,
            attach_file_to_document,
            update_document,
            delete_document,
            read_document_file_base64,
            save_seafarer_from_bundle,
            list_saved_seafarers,
            list_saved_seafarer_documents,
            update_saved_seafarer,
            send_saved_seafarer_ping,
            refresh_saved_seafarer_replies,
            send_direct_availability_ping,
            messaging::get_my_identity,
            messaging::register_my_pubkey,
            messaging::send_encrypted_message,
            messaging::fetch_messages,
            messaging::upload_encrypted_attachment,
            messaging::download_encrypted_attachment,
            messaging::fetch_attachments_for_application,
            messaging::extract_documents_bundle,
            messaging::open_path_with_default,
            feedback::init_app_diagnostics,
            feedback::app_heartbeat,
            feedback::mark_app_shutdown,
            feedback::record_app_diagnostic,
            feedback::get_feedback_prompt_state,
            feedback::postpone_app_feedback,
            feedback::submit_app_feedback,
            feedback::list_app_feedback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Skipi Crewing");
}
