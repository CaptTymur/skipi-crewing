use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod api;
mod contact;
mod crewing_intake;
mod db;
mod feedback;
mod messaging;
mod native_account;
mod native_profile;
mod native_lifecycle;
mod private_json;
mod private_store;

#[cfg(target_os = "android")]
pub(crate) fn app_data_dir() -> PathBuf {
    PathBuf::from("/data/data/app.skipi.crewing.mobile/files").join("skipi-crewing")
}

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
    /// "dark" | "light"
    pub theme: String,
    /// "en" | "ru" (placeholder)
    pub language: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)] // forward-compat: any new field added later loads with
                  // its Default value when absent from the JSON, so user
                  // settings survive every upgrade.
pub struct Settings {
    // Ephemeral native-issued revision; never persisted or exposed as credential material.
    #[serde(skip)]
    connection_revision: Arc<Mutex<ConnectionRevision>>,
    #[serde(skip)]
    connection_snapshot: Option<ConnectionSnapshot>,

    // Private lifecycle metadata. No native record is added to legacy serialized files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) native_account: Option<native_lifecycle::SessionRecord>,
    #[serde(skip)]
    pub(crate) native_authorized: bool,
    #[serde(skip)]
    pub(crate) native_generation: String,
    #[serde(skip)]
    pub(crate) load_uncertain: bool,
    #[serde(skip)]
    pub(crate) storage_uncertain: bool,

    // ----- Connection (server, identity) -----
    pub server_url: String,
    pub bearer_token: String,
    pub crewing_id: String,
    pub organization_id: String,
    pub company_name: String,
    pub user_display_name: String,
    pub token_scopes: Vec<String>,
    pub token_expires_at: Option<String>,
    pub team_role: String,
    pub team_onboarding_seen: bool,
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

impl std::fmt::Debug for Settings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Settings(<private>)")
    }
}

// Native snapshots share live authority but carry an immutable local revision.
impl Clone for Settings {
    fn clone(&self) -> Self {
        let revision = connection_context(self);
        Self {
            connection_revision: self.connection_revision.clone(),
            connection_snapshot: Some(ConnectionSnapshot {
                fingerprint: connection_fingerprint(self), revision, prepared_from: None,
            }),
            native_account: self.native_account.clone(),
            native_authorized: self.native_authorized,
            native_generation: self.native_generation.clone(),
            load_uncertain: self.load_uncertain,
            storage_uncertain: self.storage_uncertain,
            server_url: self.server_url.clone(),
            bearer_token: self.bearer_token.clone(),
            crewing_id: self.crewing_id.clone(),
            organization_id: self.organization_id.clone(),
            company_name: self.company_name.clone(),
            user_display_name: self.user_display_name.clone(),
            token_scopes: self.token_scopes.clone(),
            token_expires_at: self.token_expires_at.clone(),
            team_role: self.team_role.clone(),
            team_onboarding_seen: self.team_onboarding_seen,
            reply_to: self.reply_to.clone(),
            vault_path: self.vault_path.clone(),
            recent_vaults: self.recent_vaults.clone(),
            profile: self.profile.clone(),
            interface: self.interface.clone(),
        }
    }
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
struct NativePersistError { code: &'static str, phase: &'static str, cleanup_confirmed: bool }
#[cfg(target_os = "linux")]
impl NativePersistError {
    fn from_storage(error: private_store::PersistError) -> Self {
        Self {code:if error.cleanup_confirmed {"settings_storage_error"} else {"settings_cleanup_unconfirmed"},
            phase:error.phase,cleanup_confirmed:error.cleanup_confirmed}
    }
}

impl Settings {
    fn config_path() -> PathBuf {
        #[cfg(target_os = "android")]
        let dir = app_data_dir();

        #[cfg(not(target_os = "android"))]
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("skipi-crewing");

        std::fs::create_dir_all(&dir).ok();
        dir.join("settings.json")
    }

    pub fn load() -> Self {
        Self::load_from(&Self::config_path())
    }

    // This explicit-path loader never writes, copies or logs private configuration.
    fn load_from(path: &std::path::Path) -> Self {
        let first_run = || Settings { server_url: api::RU_API.to_string(), ..Default::default() };
        let uncertain = || Settings { load_uncertain: true, ..first_run() };
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // A dangling symlink or unresolved metadata is not a fresh install.
                return match std::fs::symlink_metadata(path) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => first_run(),
                    _ => uncertain(),
                };
            }
            Err(_) => return uncertain(),
        };
        match serde_json::from_str::<Settings>(&raw) {
            Ok(mut settings) => {
                // A v1 Linux reference must agree with the outer private tuple.
                // Refuse the entire file without rewriting; old format stays unchanged.
                #[cfg(target_os = "linux")]
                if settings.native_account.as_ref().is_some_and(|record|
                    record.has_binding() && native_lifecycle::mode(&settings, &[api::PRIMARY_API,api::RU_API]) == native_lifecycle::Mode::Unavailable)
                { return uncertain(); }
                // Preserve the existing legacy endpoint correction only in memory.
                if settings.native_account.is_none() && !settings.bearer_token.trim().starts_with("skn_")
                    && settings.server_url.ends_with(":8443")
                { settings.server_url = settings.server_url.trim_end_matches(":8443").to_owned(); }
                settings
            }
            Err(_) => uncertain(),
        }
    }

    // Explicit Linux native persistence only. The caller owns the Runtime write
    // gate, Settings mutex and stable app namespace; no UI-selected destination.
    #[cfg(target_os = "linux")]
    fn persist_native_to_path(&self, path: &std::path::Path) -> Result<private_store::Durability, &'static str> {
        self.persist_native_using(path, private_store::atomic_write)
    }
    #[cfg(all(test, target_os = "linux"))]
    fn persist_native_with_fault(&self, path: &std::path::Path, fault: private_store::TestFault)
        -> Result<private_store::Durability, &'static str> {
        self.persist_native_using(path, |path, bytes| private_store::atomic_write_with_fault(path, bytes, fault))
    }
    #[cfg(target_os = "linux")]
    fn persist_native_detailed(&self, path: &std::path::Path) -> Result<private_store::Durability, NativePersistError> {
        self.persist_native_detailed_using(path, private_store::atomic_write)
    }
    #[cfg(all(test, target_os = "linux"))]
    fn persist_native_detailed_with_fault(&self, path: &std::path::Path, fault: private_store::TestFault)
        -> Result<private_store::Durability, NativePersistError> {
        self.persist_native_detailed_using(path, |path,bytes| private_store::atomic_write_with_fault(path,bytes,fault))
    }
    #[cfg(target_os = "linux")]
    fn persist_native_using(&self, path: &std::path::Path,
        write: impl FnOnce(&std::path::Path, &[u8])
            -> Result<private_store::Durability, private_store::PersistError>,
    ) -> Result<private_store::Durability, &'static str> {
        self.persist_native_detailed_using(path,write).map_err(|error| error.code)
    }
    #[cfg(target_os = "linux")]
    fn persist_native_detailed_using(&self, path: &std::path::Path,
        write: impl FnOnce(&std::path::Path, &[u8])
            -> Result<private_store::Durability, private_store::PersistError>,
    ) -> Result<private_store::Durability, NativePersistError> {
        let origins=[api::PRIMARY_API,api::RU_API];
        if self.native_account.is_none() || !matches!(native_lifecycle::mode(self,&origins),
            native_lifecycle::Mode::NativeLocked | native_lifecycle::Mode::NativeSession | native_lifecycle::Mode::SignedOut)
        { return Err(NativePersistError {code:"settings_unavailable",phase:"native_admission",cleanup_confirmed:true}); }
        private_store::native_settings_destination(path).map_err(NativePersistError::from_storage)?;
        let bytes=serde_json::to_vec_pretty(self).map_err(|_| NativePersistError {
            code:"settings_storage_error",phase:"serialization",cleanup_confirmed:true})?;
        // This is the same writer and serializer used by the preserved string adapter.
        // CommittedUnknown remains Ok and never becomes a precommit failure.
        write(path,&bytes).map_err(NativePersistError::from_storage)
    }

    pub fn save(&self) -> Result<(), String> {
        self.save_to_path(&Self::config_path())
    }
    fn save_to_path(&self, path: &std::path::Path) -> Result<(), String> {
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
    #[serde(default)]
    pub min_age: Option<u32>,
    #[serde(default)]
    pub max_age: Option<u32>,
    #[serde(default)]
    pub us_visa_required: Option<bool>,
    #[serde(default)]
    pub schengen_visa_required: Option<bool>,
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
    #[serde(default)]
    pub compliance_profile_id: Option<String>,
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
    pub settings: Arc<Mutex<Settings>>,
    pub(crate) runtime: Arc<native_lifecycle::Runtime>,
}

impl AppState {
    fn from_settings(settings: Settings) -> Self {
        let runtime = native_lifecycle::Runtime::new(settings);
        Self { settings: runtime.settings_arc(), runtime }
    }
}

// Transitional admission until the coherent native consumers are integrated.
// Even a native_authorized flag alone cannot activate private RPC or resources.
// Only these three public commands can run in a non-legacy process.
fn boot_command_allowed(settings: &Settings, command: &str) -> Result<(), &'static str> {
    // native_account_login is admitted in a non-legacy process on purpose: it is the one
    // command a person must be able to run BEFORE being connected, and refusing it would
    // make sign-in unreachable for exactly the user this task exists for. Its size is
    // pinned by native635_boot_public_commands_and_legacy_dispatch_control below.
    // No.880 п.5: `open_external_url` в том же списке — дверь «Регистрация»
    // живёт на развилке, то есть в не-легаси процессе.
    if matches!(command, "get_build_info" | "get_settings" | "save_settings" | "native_account_login" | "open_external_url")
        || startup_should_open_db(settings) { Ok(()) } else { Err("login_required") }
}
// No.880 п.5 (1495). Дверь «Регистрация» ведёт на страницу Skipi, и открыть её
// должно приложение, а не инструкция человеку. Открывает ТОЛЬКО эта команда.
// Аллоулист — граница безопасности: схема одна (`https`) и хост названный, то
// есть ни `file:`, ни `javascript:`, ни произвольный хост из ответа сервера.
// Образец взят у Моряка (`skipi-public`, `commands/vault.rs`, прочитан через
// `git show` объекта), но СТРОЖЕ: у него четыре схемы и хост любой.
const EXTERNAL_URL_ALLOWED_HOSTS: [&str; 1] = ["assistant.skipi.app"];

fn external_url_allowed(url: &str) -> bool {
    // Разбор берётся через реэкспорт reqwest — новой зависимости не вводим
    // (`Cargo.toml` release-sensitive для этой задачи).
    let Ok(parsed) = reqwest::Url::parse(url) else { return false; };
    if parsed.scheme() != "https" { return false; }
    // Креденшал в URL и нестандартный порт — признаки не той ссылки, которую
    // показывает дверь; принимать их значило бы расширять границу молча.
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.port().is_some() { return false; }
    let Some(host) = parsed.host_str() else { return false; };
    EXTERNAL_URL_ALLOWED_HOSTS.iter().any(|allowed| host.eq_ignore_ascii_case(allowed))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !external_url_allowed(&url) { return Err("external_url_refused".into()); }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn()
            .map(|_| ()).map_err(|_| "external_url_unavailable".to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Ни одной платформы, кроме Linux, этот дом сегодня не собирает; молчать
        // здесь нельзя — отказ обязан быть называемым.
        Err("external_url_unsupported".into())
    }
}

fn locked_asset_response(_request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder().status(403).header("Cache-Control", "no-store")
        .body(Vec::new()).expect("constant locked asset response")
}

#[derive(Debug, Clone, Serialize)]
pub struct BuildInfo {
    pub component: String,
    pub component_version: String,
    pub stack_id: String,
    pub source_identifier: String,
    pub manifest_url: String,
    pub verification_status: String,
    pub version: String,
    pub sha: String,
    pub short_sha: String,
}

#[tauri::command]
fn get_build_info() -> BuildInfo {
    let sha = option_env!("SKIPI_BUILD_SHA")
        .unwrap_or("unknown")
        .to_string();
    let short_sha = if sha == "unknown" {
        "unknown".to_string()
    } else {
        sha.chars().take(7).collect()
    };
    BuildInfo {
        component: "Crewing".to_string(),
        // Версия компонента берётся из CARGO_PKG_VERSION: бамп идёт правкой
        // Cargo.toml через дверь stack-metadata, литерала здесь нет и быть не должно.
        component_version: env!("CARGO_PKG_VERSION").to_string(),
        stack_id: "SKIPI-2026.08-R1".to_string(),
        source_identifier: sha.clone(),
        manifest_url: "https://api.skipi.app/.well-known/skipi-stack/SKIPI-2026.08-R1.json"
            .to_string(),
        verification_status: "unavailable".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        sha,
        short_sha,
    }
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
    pub expires_at: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewingTrialTokenRequest {
    pub display_name: Option<String>,
    pub contact_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewingTrialTokenIssued {
    pub crewing_id: String,
    pub organization_id: Option<String>,
    pub token: String,
    pub token_prefix: String,
    pub label: Option<String>,
    pub expires_at: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewingTeamMember {
    pub id: String,
    pub organization_id: String,
    pub crewing_id: Option<String>,
    pub user_id: String,
    pub display_name: Option<String>,
    pub role: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_seen_at: Option<String>,
    #[serde(default)]
    pub pubkey_last_seen_at: Option<String>,
    #[serde(default)]
    pub online: Option<bool>,
    #[serde(default)]
    pub is_online: Option<bool>,
    pub token: Option<String>,
    pub token_prefix: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamChatMessage {
    pub id: String,
    pub broker_id: String,
    pub sender_nickname: String,
    pub body: String,
    pub event_type: Option<String>,
    #[serde(default)]
    pub attachments: Vec<TeamChatAttachment>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamChatAttachment {
    pub kind: String,
    pub mime_type: String,
    pub filename: Option<String>,
    pub size_bytes: u64,
    pub data_b64: String,
}


// Context revisions are random, native-issued values. The private fingerprint is never
// returned. Only the live owner/install publishes; snapshot reads never change authority.
#[derive(Default)]
struct ConnectionRevision {
    unavailable: bool,
    fingerprint: Option<[u8; 32]>,
    revision: String,
}
impl ConnectionRevision {
    fn retire(&mut self) { self.unavailable = true; self.revision.clear(); self.fingerprint = None; }
}
impl std::fmt::Debug for ConnectionRevision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConnectionRevision")
    }
}
fn connection_fingerprint(settings: &Settings) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    // A repeated bootstrap may return the same tuple. Its new native runtime
    // authorization generation still invalidates every old snapshot and UI context.
    let native = settings.native_account.as_ref().map(|record| (
        &record.account_id, record.signed_out, settings.native_authorized,
        &settings.native_generation, &settings.vault_path, settings.load_uncertain, settings.storage_uncertain,
        record.binding_identity().expect("private binding serialization"),
    ));
    let tuple = serde_json::to_vec(&(
        settings.server_url.trim(), settings.bearer_token.trim(), settings.crewing_id.trim(), native,
    )).expect("connection tuple serialization");
    Sha256::digest(tuple).into()
}
pub(crate) fn connection_context(settings: &Settings) -> String {
    // Empty is unavailable, never a native-issued revision. Even an old snapshot
    // must first observe the shared authority's irreversible retirement.
    let Ok(mut context) = settings.connection_revision.lock() else { return String::new(); };
    if context.unavailable { return String::new(); }
    if let Some(snapshot) = &settings.connection_snapshot { return snapshot.revision.clone(); }
    let fingerprint = connection_fingerprint(settings);
    if context.fingerprint != Some(fingerprint) {
        context.fingerprint = Some(fingerprint);
        context.revision = format!("ctx_{}", uuid::Uuid::new_v4());
    }
    context.revision.clone()
}

struct ConnectionSnapshot {
    fingerprint: [u8; 32],
    revision: String,
    prepared_from: Option<String>,
}
impl std::fmt::Debug for ConnectionSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("ConnectionSnapshot") }
}
// Readers compare both the immutable captured revision/tuple AND current live authority.
pub(crate) fn connection_context_matches(settings: &Settings, expected: &str) -> bool {
    if expected.is_empty() { return false; }
    if connection_context(settings) != expected { return false; }
    let fingerprint = connection_fingerprint(settings);
    if settings.connection_snapshot.as_ref().is_some_and(|s| s.fingerprint != fingerprint) { return false; }
    let Ok(authority) = settings.connection_revision.lock() else { return false; };
    !authority.unavailable && authority.revision == expected && authority.fingerprint == Some(fingerprint)
}
fn prepare_connection_context(proposed: &mut Settings, current: &Settings) {
    let current_revision = connection_context(current);
    let fingerprint = connection_fingerprint(proposed);
    let revision = if fingerprint == connection_fingerprint(current) { current_revision.clone() }
        else { format!("ctx_{}", uuid::Uuid::new_v4()) };
    proposed.connection_revision = current.connection_revision.clone();
    proposed.connection_snapshot = Some(ConnectionSnapshot {
        fingerprint, revision, prepared_from: Some(current_revision),
    });
}
// Snapshot preparation happens before the authority lock: Settings::clone and
// context helpers can themselves lock that authority.
struct PreparedSettingsInstall {
    proposed: Settings,
    parent_revision: String,
    parent_fingerprint: [u8; 32],
    next_revision: String,
    next_fingerprint: [u8; 32],
}
fn prepare_settings_install(mut proposed: Settings, current: &Settings)
    -> Result<PreparedSettingsInstall, Settings>
{
    let parent_revision = connection_context(current);
    if parent_revision.is_empty() { return Err(proposed); }
    let parent_fingerprint = connection_fingerprint(current);
    let fingerprint = connection_fingerprint(&proposed);
    let prepared = proposed.connection_snapshot.as_ref().is_some_and(|s|
        s.fingerprint == fingerprint && s.prepared_from.as_deref() == Some(parent_revision.as_str()));
    if !prepared { prepare_connection_context(&mut proposed, current); }
    let Some(snapshot) = proposed.connection_snapshot.take() else { return Err(proposed); };
    proposed.connection_revision = current.connection_revision.clone();
    Ok(PreparedSettingsInstall { proposed, parent_revision, parent_fingerprint,
        next_revision: snapshot.revision, next_fingerprint: snapshot.fingerprint })
}
// Caller holds Settings and the captured authority through BOTH publications.
// No context/clone callbacks, filesystem I/O or DB operation is allowed here.
fn install_prepared_settings(
    current: &mut Settings, authority: &mut ConnectionRevision, prepared: PreparedSettingsInstall,
) -> Result<(), PreparedSettingsInstall> {
    if authority.unavailable || authority.revision != prepared.parent_revision
        || authority.fingerprint != Some(prepared.parent_fingerprint)
        || !Arc::ptr_eq(&current.connection_revision, &prepared.proposed.connection_revision)
    { return Err(prepared); }
    authority.fingerprint = Some(prepared.next_fingerprint);
    authority.revision = prepared.next_revision;
    *current = prepared.proposed;
    Ok(())
}
// Called only after successful persistence while the caller holds Settings.
fn install_settings(current: &mut Settings, proposed: Settings) {
    let prepared = match prepare_settings_install(proposed, current) {
        Ok(prepared) => prepared, Err(_) => panic!("connection revision unavailable"),
    };
    let owner = current.connection_revision.clone();
    let mut authority = owner.lock().expect("connection revision unavailable");
    if install_prepared_settings(current, &mut authority, prepared).is_err() {
        panic!("connection revision changed");
    }
}

// Production and regression tests use the same persist-before-publish sequencing boundary.
fn persist_and_install_settings(
    current: &mut Settings, proposed: Settings,
    persist: impl FnOnce(&Settings) -> Result<(), String>,
) -> Result<(), String> {
    // Unknown original bytes must survive all three Settings writers.
    if current.load_uncertain || current.connection_revision.lock().map_or(true, |authority| authority.unavailable) {
        return Err("settings_unavailable".into());
    }
    // The legacy process keeps its existing DB/plugin/asset setup. It cannot
    // transition to a blocked mode through a generic Settings writer. Native
    // activation requires the future coherent runtime/resource transaction.
    if startup_should_open_db(current) && !startup_should_open_db(&proposed) {
        return Err("connection_change_requires_login".into());
    }
    persist(&proposed)?;
    install_settings(current, proposed);
    Ok(())
}

// Explicit public allowlist. Private Settings serialization remains complete for persistence.
#[derive(Clone, Serialize)]
struct PublicSettings {
    server_url: String,
    has_bearer_token: bool,
    connection_context: String,
    crewing_id: String,
    organization_id: String,
    company_name: String,
    user_display_name: String,
    token_scopes: Vec<String>,
    token_expires_at: Option<String>,
    team_role: String,
    team_onboarding_seen: bool,
    reply_to: String,
    vault_path: String,
    recent_vaults: Vec<String>,
    profile: CrewingProfile,
    interface: InterfacePrefs,
    // No.880 (1495), пункт 4. ЕДИНСТВЕННЫЙ признак аккаунт-сессии, пересекающий
    // границу; имя то же и на стороне UI (`crewingAccountSessionActive` читает
    // ровно это поле). Тип `&'static str` выбран намеренно: набор значений закрыт
    // компилятором, опечатка в исходе не доедет до UI молча.
    account_session: &'static str,
    // Право живёт отдельно от соединения. Имена взяты из уже утверждённой проекции
    // «4+1» входа (`NativeAccountLogin`), чтобы на обоих концах было одно имя;
    // `entitlement_expires_at` — срок ПРАВА и не путается с `token_expires_at`,
    // который остаётся сроком СОЕДИНЕНИЯ.
    entitlement_source: String,
    entitlement_expires_at: Option<String>,
}

// Все исходы режима названы ПОЛЕМ. `NativeSession` различается дальше по
// `private_access`, потому что запись сессии может быть на месте, а право или
// соединение — просрочены: это разные ответы для человека, и схлопывать их
// в «нет сессии» нельзя (канон UI: неизвестность и устаревание не прячутся).
fn account_session_state(settings: &Settings, origins: &[&str], now: chrono::DateTime<chrono::Utc>) -> &'static str {
    match native_lifecycle::mode(settings, origins) {
        native_lifecycle::Mode::Unavailable => "unavailable",
        native_lifecycle::Mode::SignedOut => "signed_out",
        native_lifecycle::Mode::NativeLocked => "locked",
        native_lifecycle::Mode::LegacyConnected => "legacy",
        native_lifecycle::Mode::Unbound => "none",
        native_lifecycle::Mode::NativeSession => match native_lifecycle::private_access(settings, origins, now) {
            Ok(()) => "active",
            Err("entitlement_expired") | Err("connection_expired") => "expired",
            // Запись есть, но предъявить её нельзя: для человека это тот же
            // ответ, что и перезапуск без авторизации — нужно войти снова.
            Err(_) => "locked",
        },
    }
}
fn settings_for_ui(settings: &Settings) -> PublicSettings {
    let empty = Settings::default();
    let visible = if startup_should_open_db(settings) { settings } else { &empty };
    PublicSettings {
        server_url: settings.server_url.clone(),
        has_bearer_token: !visible.bearer_token.trim().is_empty(),
        connection_context: connection_context(settings),
        crewing_id: visible.crewing_id.clone(),
        organization_id: visible.organization_id.clone(),
        company_name: visible.company_name.clone(),
        user_display_name: visible.user_display_name.clone(),
        token_scopes: visible.token_scopes.clone(),
        token_expires_at: visible.token_expires_at.clone(),
        team_role: visible.team_role.clone(),
        team_onboarding_seen: visible.team_onboarding_seen,
        reply_to: visible.reply_to.clone(),
        vault_path: visible.vault_path.clone(),
        recent_vaults: visible.recent_vaults.clone(),
        profile: visible.profile.clone(),
        interface: settings.interface.clone(),
        // Признак сессии читается из НАСТОЯЩИХ настроек, а не из `visible`:
        // скрытая проекция обнуляет рабочее место, но состояние входа человек
        // обязан видеть именно тогда, когда рабочего места ещё нет.
        account_session: account_session_state(settings, &[api::PRIMARY_API, api::RU_API], chrono::Utc::now()),
        entitlement_source: settings.native_account.as_ref()
            .map(|record| record.entitlement.source.clone()).unwrap_or_default(),
        entitlement_expires_at: settings.native_account.as_ref()
            .and_then(|record| record.entitlement.expires_at.clone()),
    }
}
#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> PublicSettings {
    settings_for_ui(&state.settings.lock().unwrap())
}
fn merge_ui_settings(
    mut proposed: Settings, current: &Settings, expected_context: &str,
) -> Result<Settings, String> {
    if !connection_context_matches(current, expected_context) {
        return Err("settings_changed".into());
    }
    if !startup_should_open_db(current) {
        // A hidden public projection contains no workspace. Saving interface
        // preferences must preserve every private value, including an expired,
        // signed-out, malformed-native, or partial legacy binding.
        if (!proposed.bearer_token.trim().is_empty() && proposed.bearer_token != current.bearer_token)
            || (!proposed.server_url.trim().is_empty() && proposed.server_url != current.server_url)
            || (!proposed.crewing_id.trim().is_empty() && proposed.crewing_id != current.crewing_id)
            || (!proposed.organization_id.trim().is_empty() && proposed.organization_id != current.organization_id)
        { return Err("connection_change_requires_validation".into()); }
        let mut retained = current.clone();
        retained.interface = proposed.interface;
        prepare_connection_context(&mut retained, current);
        return Ok(retained);
    }
    if current.native_account.is_some() || current.bearer_token.trim().starts_with("skn_") {
        // Native credentials and their tenant/origin are never editable through this bridge.
        if (!proposed.bearer_token.trim().is_empty() && proposed.bearer_token != current.bearer_token)
            || proposed.server_url.trim() != current.server_url.trim()
            || proposed.crewing_id.trim() != current.crewing_id.trim()
            || proposed.organization_id.trim() != current.organization_id.trim()
        { return Err("connection_change_requires_validation".into()); }
    }
    // The generic settings bridge never accepts private native state from JS.
    proposed.native_account = current.native_account.clone();
    proposed.native_authorized = current.native_authorized;
    proposed.native_generation = current.native_generation.clone();
    proposed.load_uncertain = current.load_uncertain;
    proposed.storage_uncertain = current.storage_uncertain;
    if proposed.bearer_token.trim().is_empty() {
        // Never attach the hidden credential to a caller-selected different tenant/origin.
        if !current.bearer_token.trim().is_empty()
            && (proposed.server_url.trim() != current.server_url.trim()
                || proposed.crewing_id.trim() != current.crewing_id.trim())
        { return Err("connection_change_requires_validation".into()); }
        proposed.bearer_token = current.bearer_token.clone();
    }
    prepare_connection_context(&mut proposed, current);
    Ok(proposed)
}
#[tauri::command]
fn save_settings(
    new_settings: Settings, expected_context: String, state: tauri::State<AppState>,
) -> Result<PublicSettings, String> {
    let mut current = state.settings.lock().unwrap();
    let mut proposed = merge_ui_settings(new_settings, &current, &expected_context)?;
    if startup_should_open_db(&current) && !proposed.vault_path.is_empty() {
        proposed.recent_vaults.retain(|p| p != &proposed.vault_path);
        proposed.recent_vaults.insert(0, proposed.vault_path.clone());
        proposed.recent_vaults.truncate(10);
    }
    // Publish the candidate revision and native tuple only after successful persistence.
    persist_and_install_settings(&mut current, proposed, Settings::save)?;
    Ok(settings_for_ui(&current))
}

#[tauri::command]
fn forget_recent_vault(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    let mut current = state.settings.lock().unwrap();
    let mut next = current.clone();
    next.recent_vaults.retain(|p| p != &path);
    prepare_connection_context(&mut next, &current);
    persist_and_install_settings(&mut current, next, Settings::save)?;
    Ok(())
}

// No.880 S2: продуктового вызывающего больше нет — `activate_crewing_token`
// снята по слову владельца (1495). Функция оставлена ТЕСТ-ОНЛИ, потому что
// девять её ассертов проверяют сторож устаревания `expected_context`, снимать
// который PRESERVE запрещает. Это зафиксировано cfg, а не комментарием: иначе
// первый проход по «мёртвому коду» снёс бы вместе с ней и это покрытие.
#[cfg(test)]
fn activation_token(settings: &Settings, base: &str, supplied: Option<&str>, expected: Option<&str>) -> Result<String, String> {
    if let Some(token) = supplied.map(str::trim).filter(|token| !token.is_empty()) {
        return Ok(token.to_string()); // Existing explicit manual input; retired in the full account stage.
    }
    if !expected.is_some_and(|expected| connection_context_matches(settings, expected)) {
        return Err("settings_changed".into());
    }
    if base.trim_end_matches('/') != settings.server_url.trim().trim_end_matches('/') {
        return Err("settings_changed".into());
    }
    if settings.bearer_token.trim().is_empty() {
        return Err("No company token configured.".into());
    }
    Ok(settings.bearer_token.trim().to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeAccountLogin {
    server_url: String,
    scopes: Vec<String>,
    expires_at: Option<String>,
    entitlement_source: String,
    local_outcome: String,
}

// Registered but NOT admitted. boot_command_allowed (line 325) lets only three
// commands run in a non-legacy process, so an invoke of this returns login_required
// until the allowlist is widened together with the test that pins its size.
// The outcome is projected to a flat string: LocalOutcome is cfg-gated and must not
// cross into the public surface.
#[tauri::command]
fn native_account_login(
    email: String,
    password: String,
    expected_context: String,
    state: tauri::State<AppState>,
) -> Result<NativeAccountLogin, String> {
    #[cfg(target_os = "linux")]
    {
        let transport =
            native_account::AccountClient::new(native_account::TransportConfig::production())?;
        let attempt = state.runtime.start_login(
            &expected_context, native_lifecycle::CreationPolicy::ExistingOrUncertain)?;
        let proof = state.runtime.authenticate(&transport, &email, &password, attempt)?;
        let target = native_lifecycle::NativeSettingsTarget::for_application()?;
        let plan = native_lifecycle::LocalPlan::existing_application();
        let outcome = state.runtime.commit_local(proof, plan, target)
            .map_err(|error| error.code)?;
        let local_outcome = match outcome {
            native_lifecycle::LocalOutcome::CommittedInactive { .. } =>
                "committed_inactive".to_string(),
            native_lifecycle::LocalOutcome::CommittedBlocked { reason, .. } =>
                format!("committed_blocked:{reason}"),
            native_lifecycle::LocalOutcome::CommittedPublicationFailed { reason, .. } =>
                format!("committed_publication_failed:{reason}"),
        };
        let settings = state.settings.lock().map_err(|_| "settings_unavailable")?;
        Ok(NativeAccountLogin {
            server_url: settings.server_url.clone(),
            scopes: settings.token_scopes.clone(),
            expires_at: settings.token_expires_at.clone(),
            entitlement_source: settings.native_account.as_ref()
                .map(|record| record.entitlement.source.clone()).unwrap_or_default(),
            local_outcome,
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Native activation is unsupported here; no mobile acceptance claim.
        let _ = (email, password, expected_context, state);
        Err("native_unsupported".into())
    }
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
    vessel_imo: Option<i64>,
    flag: Option<&'a str>,
    trading_area: Option<&'a str>,
    russia_trading: bool,
    joining_window_from: Option<String>,
    joining_window_to: Option<String>,
    contract_months: Option<u32>,
    salary_min: Option<i64>,
    salary_max: Option<i64>,
    salary_currency: Option<&'a str>,
    min_age: Option<u32>,
    max_age: Option<u32>,
    us_visa_required: bool,
    schengen_visa_required: bool,
    languages: Option<&'a Vec<String>>,
    nationalities: Option<&'a Vec<String>>,
    description: Option<&'a str>,
    reply_to: Option<&'a str>,
    title: Option<&'a str>,
    vessel_name: Option<&'a str>,
    join_port: Option<&'a str>,
    client_name: Option<&'a str>,
    compliance_profile_id: Option<&'a str>,
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

fn ensure_vacancy_connection_settings(settings: &Settings) -> Result<(), String> {
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
    Ok(())
}

fn vacancy_wire_from_draft<'a>(draft: &'a VacancyDraft, settings: &'a Settings) -> VacancyWire<'a> {
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

    VacancyWire {
        crewing_id: &settings.crewing_id,
        rank: &draft.rank,
        vessel_type: &draft.vessel_type,
        vessel_imo: imo,
        flag: draft.flag.as_deref(),
        trading_area: draft.trading_area.as_deref(),
        russia_trading: draft.trading_russia_ok.unwrap_or(false),
        joining_window_from: join_from,
        joining_window_to: None,
        contract_months: draft.contract_months,
        salary_min: salary_min_int,
        salary_max: salary_max_int,
        salary_currency: draft.salary_currency.as_deref(),
        min_age: draft.min_age,
        max_age: draft.max_age,
        us_visa_required: draft.us_visa_required.unwrap_or(false),
        schengen_visa_required: draft.schengen_visa_required.unwrap_or(false),
        languages: draft.languages.as_ref(),
        nationalities: draft.nationalities.as_ref(),
        description: draft.description.as_deref(),
        reply_to,
        title: Some(&draft.title),
        vessel_name: draft.vessel_name.as_deref(),
        join_port: draft.join_port.as_deref(),
        client_name: draft.client_name.as_deref(),
        compliance_profile_id: draft.compliance_profile_id.as_deref(),
    }
}

#[tauri::command]
fn post_vacancy(
    draft: VacancyDraft,
    state: tauri::State<AppState>,
) -> Result<VacancyPosted, String> {
    let settings = state.settings.lock().unwrap().clone();
    ensure_vacancy_connection_settings(&settings)?;
    let wire = vacancy_wire_from_draft(&draft, &settings);

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
fn update_vacancy_remote(
    vacancy_id: String,
    draft: VacancyDraft,
    state: tauri::State<AppState>,
) -> Result<ServerVacancy, String> {
    let settings = state.settings.lock().unwrap().clone();
    ensure_vacancy_connection_settings(&settings)?;
    let wire = vacancy_wire_from_draft(&draft, &settings);
    let path = format!("/api/vacancies/{vacancy_id}");
    let updated: ServerVacancy = api::patch_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        &wire,
        30,
    )?;
    db::save_posted_vacancy(&updated.id, &draft, &updated.published_at)
        .map_err(|e| format!("local cache write failed: {e}"))?;
    Ok(updated)
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
    #[serde(default)]
    pub min_age: Option<i64>,
    #[serde(default)]
    pub max_age: Option<i64>,
    #[serde(default)]
    pub us_visa_required: bool,
    #[serde(default)]
    pub schengen_visa_required: bool,
    #[serde(default)]
    pub required_certs: Option<Vec<String>>,
    #[serde(default)]
    pub languages: Option<Vec<String>>,
    #[serde(default)]
    pub nationalities: Option<Vec<String>>,
    pub salary_negotiable: bool,
    pub description: Option<String>,
    pub reply_to: String,
    pub title: Option<String>,
    pub vessel_name: Option<String>,
    pub join_port: Option<String>,
    #[serde(default)]
    pub client_name: Option<String>,
    #[serde(default)]
    pub compliance_profile_id: Option<String>,
    #[serde(default)]
    pub compliance_profile_snapshot: Option<serde_json::Value>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceExtraRequirement {
    pub id: String,
    pub label: String,
    pub weight: i64,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ComplianceProfileDraft {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub rank: Option<String>,
    /// P2/S1. The second thing a crewing matches on, and a profile cannot be
    /// published without it.
    #[serde(default)]
    pub vessel_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub mandatory_certs: Option<Vec<String>>,
    #[serde(default)]
    pub extra_requirements: Option<Vec<ComplianceExtraRequirement>>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerComplianceProfile {
    pub id: String,
    pub crewing_id: String,
    pub name: String,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default)]
    pub vessel_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub mandatory_certs: Option<Vec<String>>,
    #[serde(default)]
    pub extra_requirements: Option<Vec<ComplianceExtraRequirement>>,
    pub status: String,
    /// P2/S1, READ-ONLY on this surface: "unpublished" | "published".
    /// Publication is only ever CHANGED through the matching-profile route,
    /// which is the one that owns the version and the frozen snapshot. It is
    /// read here so the profile card can draw the button in the right state
    /// without a second round-trip. `serde(default)` because an older server
    /// does not send it, and a crewing on an older pilot must still be able
    /// to open its own profiles.
    #[serde(default = "unpublished_state")]
    pub publication_state: String,
    #[serde(default)]
    pub published_snapshot: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

fn unpublished_state() -> String {
    "unpublished".to_string()
}

#[derive(Debug, Clone, Deserialize)]
struct ComplianceProfileListResp {
    items: Vec<ServerComplianceProfile>,
}

fn require_api_settings(settings: &Settings) -> Result<(), String> {
    if settings.bearer_token.is_empty()
        || settings.crewing_id.is_empty()
        || settings.server_url.is_empty()
    {
        return Err("Not configured. Open Settings.".into());
    }
    Ok(())
}

#[tauri::command]
fn fetch_compliance_profiles(
    include_archived: Option<bool>,
    state: tauri::State<AppState>,
) -> Result<Vec<ServerComplianceProfile>, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let path = format!(
        "/api/compliance-profiles?crewing_id={}&include_archived={}",
        urlenc(&settings.crewing_id),
        if include_archived.unwrap_or(false) {
            "true"
        } else {
            "false"
        }
    );
    let parsed: ComplianceProfileListResp = api::get_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        20,
    )?;
    Ok(parsed.items)
}

#[tauri::command]
fn create_compliance_profile(
    draft: ComplianceProfileDraft,
    state: tauri::State<AppState>,
) -> Result<ServerComplianceProfile, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let name = draft
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Profile name is required.".to_string())?;
    let description = draft
        .description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let body = serde_json::json!({
        "crewing_id": settings.crewing_id,
        "name": name,
        "rank": draft.rank.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        "vessel_type": draft.vessel_type.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        "description": description,
        "mandatory_certs": draft.mandatory_certs.unwrap_or_default(),
        "extra_requirements": draft.extra_requirements.unwrap_or_default(),
    });
    api::post_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/compliance-profiles",
        &body,
        20,
    )
}

#[tauri::command]
fn update_compliance_profile(
    profile_id: String,
    draft: ComplianceProfileDraft,
    state: tauri::State<AppState>,
) -> Result<ServerComplianceProfile, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let mut body = serde_json::Map::new();
    if let Some(name) = draft.name {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err("Profile name is required.".into());
        }
        body.insert("name".into(), serde_json::Value::String(trimmed));
    }
    if let Some(description) = draft.description {
        let trimmed = description.trim().to_string();
        body.insert(
            "description".into(),
            if trimmed.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::Value::String(trimmed)
            },
        );
    }
    if let Some(rank) = draft.rank {
        let trimmed = rank.trim().to_string();
        body.insert(
            "rank".into(),
            if trimmed.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::Value::String(trimmed)
            },
        );
    }
    if let Some(vessel_type) = draft.vessel_type {
        let trimmed = vessel_type.trim().to_string();
        body.insert(
            "vessel_type".into(),
            if trimmed.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::Value::String(trimmed)
            },
        );
    }
    if let Some(certs) = draft.mandatory_certs {
        body.insert(
            "mandatory_certs".into(),
            serde_json::to_value(certs).map_err(|e| e.to_string())?,
        );
    }
    if let Some(extras) = draft.extra_requirements {
        body.insert(
            "extra_requirements".into(),
            serde_json::to_value(extras).map_err(|e| e.to_string())?,
        );
    }
    if let Some(status) = draft.status {
        body.insert("status".into(), serde_json::Value::String(status));
    }
    let path = format!("/api/compliance-profiles/{profile_id}");
    api::patch_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        &body,
        20,
    )
}

#[tauri::command]
fn archive_compliance_profile(
    profile_id: String,
    state: tauri::State<AppState>,
) -> Result<ServerComplianceProfile, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let path = format!("/api/compliance-profiles/{profile_id}/archive");
    api::post_empty_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        20,
    )
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ComplianceRankCandidateArgs {
    pub application_id: Option<String>,
    pub vacancy_id: Option<String>,
    pub candidate_summary: Option<serde_json::Value>,
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

#[tauri::command]
fn rank_compliance_candidate(
    args: ComplianceRankCandidateArgs,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let mut candidate = serde_json::Map::new();
    if let Some(application_id) = args
        .application_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        candidate.insert(
            "application_id".into(),
            serde_json::Value::String(application_id.into()),
        );
    }
    if let Some(vacancy_id) = args
        .vacancy_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        candidate.insert(
            "vacancy_id".into(),
            serde_json::Value::String(vacancy_id.into()),
        );
    }
    if let Some(summary) = args.candidate_summary {
        if summary.is_object() {
            candidate.insert("summary".into(), summary);
        }
    }
    let body = serde_json::json!({ "candidate": candidate });
    api::post_json(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/crewing/compliance/rank-candidates",
        &body,
        20,
    )
}

#[tauri::command]
fn get_mailbox_status(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    api::get_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mail/mailbox",
        15,
    )
}

#[tauri::command]
fn save_mailbox_config(
    payload: serde_json::Value,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    api::put_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mail/mailbox",
        &payload,
        20,
    )
}

#[tauri::command]
fn test_mailbox(
    payload: serde_json::Value,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    api::post_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mail/mailbox/test",
        &payload,
        30,
    )
}

#[tauri::command]
fn disconnect_mailbox(state: tauri::State<AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    api::delete_empty_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mail/mailbox",
        15,
    )
}

#[tauri::command]
fn fetch_mail_messages(
    folder: Option<String>,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let folder = folder
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("INBOX");
    let path = format!("/api/mail/messages?folder={}&limit=100", urlenc(folder));
    api::get_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        20,
    )
}

#[tauri::command]
fn fetch_mail_message(
    message_id: String,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let path = format!("/api/mail/messages/{}", urlenc(&message_id));
    api::get_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
    )
}

#[tauri::command]
fn poll_mail(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    api::post_empty_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mail/poll",
        60,
    )
}

#[tauri::command]
fn send_mail(
    payload: serde_json::Value,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    api::post_json_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        "/api/mail/send",
        &payload,
        30,
    )
}

#[tauri::command]
fn delete_mail_message(message_id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    require_api_settings(&settings)?;
    let path = format!("/api/mail/messages/{}", urlenc(&message_id));
    api::delete_empty_primary(
        Some(&settings.server_url),
        Some(&settings.bearer_token),
        &path,
        15,
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
    // No.664/S3: optional on the bridge. The bundle writer sends none → «replace»
    // (its behaviour byte for byte); the Crew Flow writer sends "merge".
    mode: Option<String>,
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
        mode.as_deref(),
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
    messaging::register_pubkey_native(
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
    messaging::register_pubkey_native(
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
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    let _ = path;

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

// Actual startup admission seam. Baseline was unconditional DB init.
fn startup_should_open_db(settings: &Settings) -> bool {
    matches!(native_lifecycle::mode(settings, &[api::PRIMARY_API, api::RU_API]),
        native_lifecycle::Mode::LegacyConnected)
}

// The Linux view receives a fresh ephemeral browser context while blocked. This
// preserves the old persistent store without exposing its cached values to this
// view. Wry may construct a persistent context first; zero store I/O is NOT claimed.
fn configure_boot_windows(windows: &mut [tauri::utils::config::WindowConfig], legacy_boot: bool) {
    #[cfg(target_os = "linux")]
    if !legacy_boot { for window in windows { window.incognito = true; } }
    #[cfg(not(target_os = "linux"))]
    let _ = (windows, legacy_boot); // Native activation is unsupported, no mobile acceptance claim.
}

// ---------- App entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::from_settings(Settings::load());
    let legacy_boot = {
        let settings = state.settings.lock().expect("settings unavailable");
        if startup_should_open_db(&settings) {
            db::init(&settings.vault_path).expect("db init");
            true
        } else { false }
    };

    let command_handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            get_build_info,
            get_settings,
            save_settings,
            native_account_login,
            open_external_url,
            sync_crewing_profile,
            forget_recent_vault,
            ensure_vault_folder,
            post_vacancy,
            update_vacancy_remote,
            post_mailing_request,
            list_my_vacancies,
            fetch_compliance_profiles,
            create_compliance_profile,
            update_compliance_profile,
            archive_compliance_profile,
            fetch_my_vacancies,
            fetch_my_mailing_requests,
            close_vacancy_remote,
            reopen_vacancy_remote,
            delete_vacancy_remote,
            close_mailing_request_remote,
            reopen_mailing_request_remote,
            delete_mailing_request_remote,
            crewing_intake::crewing_intake_alias_list,
            crewing_intake::crewing_intake_alias_reveal,
            crewing_intake::crewing_intake_alias_create,
            crewing_intake::crewing_intake_alias_rotate,
            crewing_intake::crewing_intake_alias_pause,
            crewing_intake::crewing_intake_alias_resume,
            crewing_intake::crewing_intake_alias_revoke,
            crewing_intake::crewing_intake_candidate_submit,
            crewing_intake::crewing_intake_candidate_list,
            crewing_intake::crewing_intake_candidate_get,
            crewing_intake::crewing_intake_fact_list,
            crewing_intake::crewing_intake_fact_record,
            crewing_intake::crewing_intake_fact_correct,
            crewing_intake::crewing_intake_candidate_rank,
            crewing_intake::crewing_intake_rank_list,
            crewing_intake::crewing_intake_response_contact,
            crewing_intake::crewing_intake_shortlist_confirm,
            crewing_intake::crewing_intake_shortlist_withdraw,
            crewing_intake::crewing_intake_shortlist_hold,
            crewing_intake::crewing_intake_shortlist_release,
            crewing_intake::crewing_intake_profile_shortlist,
            crewing_intake::crewing_intake_matching_profile_list,
            crewing_intake::crewing_intake_matching_profile_publication,
            crewing_intake::crewing_intake_object_download,
            crewing_intake::crewing_intake_attachment_download,
            crewing_intake::crewing_intake_open_saved,
            crewing_intake::crewing_customer_letter_prepare,
            contact::open_mailto,
            fetch_applications_for_vacancy,
            rank_compliance_candidate,
            get_mailbox_status,
            save_mailbox_config,
            test_mailbox,
            disconnect_mailbox,
            fetch_mail_messages,
            fetch_mail_message,
            poll_mail,
            send_mail,
            delete_mail_message,
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
        ];

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .manage(state)
        .invoke_handler(move |invoke| {
            let decision = {
                let state = invoke.message.state_ref().get::<AppState>();
                let locked = state.settings.lock();
                match locked {
                    Ok(settings) => boot_command_allowed(&settings, invoke.message.command()),
                    Err(_) => Err("settings_unavailable"),
                }
            };
            if let Err(code) = decision { invoke.resolver.reject(code); return true; }
            command_handler(invoke)
        });

    // Plugins dispatch before the app's invoke handler. In a blocked process
    // neither file/dialog plugin is installed. A custom asset scheme is registered
    // before window creation and takes precedence over Tauri's builtin file reader.
    // Generic settings persistence above forbids a boot-Legacy mode transition.
    let builder = if legacy_boot {
        builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init())
    } else {
        builder.register_uri_scheme_protocol("asset", |_, request| locked_asset_response(request))
    };

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    let mut context = tauri::generate_context!();
    configure_boot_windows(&mut context.config_mut().app.windows, legacy_boot);
    builder
        .run(context)
        .expect("error while running Skipi Crewing");
}

#[cfg(test)]
mod native635_settings_tests {
    use super::*;

    // These controls exercise the retained legacy edit path; actual native record/orphan negatives live below.
    const NATIVE_SECRET: &str = "legacy_native635_synthetic_getter_secret";

    fn owner_fixture() -> Settings {
        Settings {
            server_url: "https://synthetic.invalid".into(),
            bearer_token: NATIVE_SECRET.into(),
            crewing_id: "635-synthetic-company".into(),
            organization_id: "635-synthetic-organization".into(),
            company_name: "635 synthetic company".into(),
            user_display_name: "635 synthetic person".into(),
            token_scopes: vec!["applications:read".into()],
            token_expires_at: Some("2026-10-19T12:15:00Z".into()),
            team_role: "member".into(),
            team_onboarding_seen: true,
            reply_to: "fixture@example.invalid".into(),
            vault_path: "/synthetic/native635/vault".into(),
            recent_vaults: vec!["/synthetic/native635/previous-vault".into()],
            profile: CrewingProfile {
                legal_name: "635 synthetic legal profile".into(),
                jurisdiction: "GB".into(),
                registration_number: "SYNTHETIC-635".into(),
                mlc_cert_number: "SYNTHETIC-MLC-635".into(),
                mlc_cert_valid_to: "2027-10-19".into(),
                contact_email: "fixture@example.invalid".into(),
                contact_phone: "+10000000635".into(),
                slug: "native635-fixture".into(),
                public_description: "Only a synthetic owner profile".into(),
            },
            interface: InterfacePrefs { theme: "light".into(), language: "ru".into() },
            connection_revision: Default::default(),
            connection_snapshot: None,
            native_account: None,
            native_authorized: false,
            native_generation: String::new(),
            load_uncertain: false,
            storage_uncertain: false,
        }
    }


    fn owner_expected() -> serde_json::Value {
        // Independent JSON expectation: do not serialize the same struct to define its contract.
        serde_json::json!({
            "server_url": "https://synthetic.invalid",
            "bearer_token": NATIVE_SECRET,
            "crewing_id": "635-synthetic-company",
            "organization_id": "635-synthetic-organization",
            "company_name": "635 synthetic company",
            "user_display_name": "635 synthetic person",
            "token_scopes": ["applications:read"],
            "token_expires_at": "2026-10-19T12:15:00Z",
            "team_role": "member",
            "team_onboarding_seen": true,
            "reply_to": "fixture@example.invalid",
            "vault_path": "/synthetic/native635/vault",
            "recent_vaults": ["/synthetic/native635/previous-vault"],
            "profile": {
                "legal_name": "635 synthetic legal profile",
                "jurisdiction": "GB",
                "registration_number": "SYNTHETIC-635",
                "mlc_cert_number": "SYNTHETIC-MLC-635",
                "mlc_cert_valid_to": "2027-10-19",
                "contact_email": "fixture@example.invalid",
                "contact_phone": "+10000000635",
                "slug": "native635-fixture",
                "public_description": "Only a synthetic owner profile"
            },
            "interface": { "theme": "light", "language": "ru" }
        })
    }

    #[test]
    fn native635_private_settings_roundtrip_preserves_credential_and_owner_data() {
        let settings = owner_fixture();
        // Use exactly the serializer used by Settings::save, without touching a real profile.
        let stored = serde_json::to_string_pretty(&settings).unwrap();
        let expected = owner_expected();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&stored).unwrap(), expected);
        let restored: Settings = serde_json::from_str(&stored).unwrap();
        assert_eq!(restored.bearer_token, NATIVE_SECRET);
        assert_eq!(serde_json::to_value(&restored).unwrap(), expected);
    }

    #[test]
    fn native635_public_getter_hides_credential_preserving_owner_data() {
        let settings = owner_fixture();
        // This is the same production projection called by the registered get_settings command.
        let public = serde_json::to_value(settings_for_ui(&settings)).unwrap();
        let expected = owner_expected();
        for field in ["server_url", "crewing_id", "organization_id", "company_name",
            "user_display_name", "token_scopes", "token_expires_at", "team_role",
            "team_onboarding_seen", "reply_to", "vault_path", "recent_vaults", "profile", "interface"] {
            assert!(public.get(field).is_some(), "owner field missing: {field}");
            assert_eq!(public.get(field), expected.get(field), "owner field changed: {field}");
        }
        assert!(public.get("bearer_token").is_none(), "public get_settings exposes credential field");
        assert!(!public.to_string().contains(NATIVE_SECRET), "public get_settings exposes credential value");
    }
    #[test]
    fn native635_public_save_preserves_private_credential_and_owner_fields() {
        let current = owner_fixture();
        let public = serde_json::to_value(settings_for_ui(&current)).unwrap();
        let revision = public["connection_context"].as_str().unwrap();
        assert!(revision.starts_with("ctx_"));
        assert!(uuid::Uuid::parse_str(&revision[4..]).is_ok());
        assert_eq!(public["has_bearer_token"], true);
        let mut incoming: Settings = serde_json::from_value(public.clone()).unwrap();
        assert!(incoming.bearer_token.is_empty());
        incoming.interface.theme = "dark".into();
        let merged = merge_ui_settings(incoming, &current, revision).unwrap();
        let mut expected = owner_expected(); expected["interface"]["theme"] = "dark".into();
        assert_eq!(serde_json::to_value(&merged).unwrap(), expected);
        assert_eq!(connection_context(&merged), revision);
        let returned = serde_json::to_value(settings_for_ui(&merged)).unwrap();
        assert!(returned.get("bearer_token").is_none());
        assert!(!returned.to_string().contains(NATIVE_SECRET));
    }
    #[test]
    fn native635_hidden_credential_never_moves_to_changed_origin_or_company() {
        let current=owner_fixture(); let revision=connection_context(&current);
        for field in ["server_url", "crewing_id"] {
            let mut incoming=serde_json::to_value(settings_for_ui(&current)).unwrap();
            incoming[field]="different".into();
            let proposed:Settings=serde_json::from_value(incoming).unwrap();
            assert!(merge_ui_settings(proposed,&current,&revision).is_err(),"{field}");
            assert_eq!(serde_json::to_value(&current).unwrap(),owner_expected());
        }
        let proposed:Settings=serde_json::from_value(serde_json::to_value(settings_for_ui(&current)).unwrap()).unwrap();
        assert!(merge_ui_settings(proposed,&current,"ctx_stale").is_err());
        assert_eq!(serde_json::to_value(&current).unwrap(),owner_expected());
        assert!(activation_token(&current,"https://different.invalid",None,Some(&revision)).is_err());
        assert_eq!(activation_token(&current,&current.server_url,None,Some(&revision)).unwrap(),NATIVE_SECRET);
        assert!(activation_token(&current,&current.server_url,None,Some("ctx_stale")).is_err());
        let (company,secret,base)=messaging::pubkey_context(&current,&revision).unwrap();
        assert_eq!(company,"635-synthetic-company");
        assert_eq!(secret,NATIVE_SECRET);
        assert_eq!(base,"https://synthetic.invalid");
        assert!(messaging::pubkey_context(&current,"ctx_stale").is_err());
    }
    #[test]
    fn native635_opaque_context_rotates_on_each_tuple_change_including_aba() {
        let mut original=owner_fixture(); let first=connection_context(&original);
        let mut edited=original.clone(); edited.profile.contact_email="changed@example.invalid".into();
        assert_eq!(connection_context(&edited),first);
        for field in ["server_url","bearer_token","crewing_id"] {
            let restored=original.clone();
            let mut changed=original.clone();
            match field {
                "server_url"=>changed.server_url="https://different.invalid".into(),
                "bearer_token"=>changed.bearer_token="different-secret".into(),
                _=>changed.crewing_id="different-company".into(),
            }
            let before=connection_context(&original);
            let prepared=merge_ui_settings(changed,&original,&before).unwrap();
            persist_and_install_settings(&mut original,prepared, |_settings| Ok(())).unwrap();
            let during=connection_context(&original);
            assert_ne!(before,during,"{field}");
            let prepared=merge_ui_settings(restored,&original,&during).unwrap();
            persist_and_install_settings(&mut original,prepared, |_settings| Ok(())).unwrap();
            let after=connection_context(&original);
            assert_ne!(after,before,"ABA reused {field} revision");
            assert_ne!(after,during,"{field}");
        }
    }

    #[test]
    fn native635_context_stale_snapshot_cannot_rotate_live_issuer() {
        let mut live=owner_fixture();
        let old_context=connection_context(&live);
        let stale=live.clone();
        live.bearer_token="synthetic-new-company-secret".into();
        let current_context=connection_context(&live);
        assert_ne!(current_context,old_context);
        let _=connection_context(&stale);
        assert_eq!(connection_context(&live),current_context,
            "reading a stale native snapshot rotated the live context issuer");
    }
    #[test]
    fn native635_context_unsaved_proposal_cannot_rotate_live_issuer() {
        let live=owner_fixture();
        let current_context=connection_context(&live);
        let mut proposal=live.clone();
        proposal.bearer_token="synthetic-not-yet-persisted-secret".into();
        let prepared=merge_ui_settings(proposal,&live,&current_context).unwrap();
        assert_ne!(connection_context(&prepared),current_context);
        assert_eq!(connection_context(&live),current_context,
            "a proposal not yet persisted or installed rotated the live context issuer");
    }

    #[test]
    fn native635_context_committed_change_denies_stale_activation_snapshot() {
        let mut live=owner_fixture();
        let old_context=connection_context(&live);
        let stale=live.clone();
        let mut changed=live.clone();changed.bearer_token="synthetic-committed-activation-secret".into();
        let prepared=merge_ui_settings(changed,&live,&old_context).unwrap();
        persist_and_install_settings(&mut live,prepared, |_settings| Ok(())).unwrap();
        assert_ne!(connection_context(&live),old_context);
        assert!(activation_token(&stale,&stale.server_url,None,Some(&old_context)).is_err(),
            "stale activation snapshot accepted after a real connection change");
    }
    #[test]
    fn native635_context_committed_change_denies_stale_pubkey_snapshot() {
        let mut live=owner_fixture();
        let old_context=connection_context(&live);
        let stale=live.clone();
        let mut changed=live.clone();changed.bearer_token="synthetic-committed-pubkey-secret".into();
        let prepared=merge_ui_settings(changed,&live,&old_context).unwrap();
        persist_and_install_settings(&mut live,prepared, |_settings| Ok(())).unwrap();
        assert_ne!(connection_context(&live),old_context);
        assert!(messaging::pubkey_context(&stale,&old_context).is_err(),
            "stale public-key snapshot accepted after a real connection change");
    }

    #[test]
    fn native635_context_persist_failure_preserves_live_owner_and_authority() {
        let mut live=owner_fixture();
        let current_context=connection_context(&live);
        let reader=live.clone();
        let before=serde_json::to_value(&live).unwrap();
        let authority=live.connection_revision.clone();
        let mut changed=live.clone();changed.bearer_token="synthetic-never-committed-secret".into();
        let prepared=merge_ui_settings(changed,&live,&current_context).unwrap();
        assert_ne!(connection_context(&prepared),current_context);
        let failure=persist_and_install_settings(&mut live,prepared, |_settings| {
            assert_eq!(authority.lock().unwrap().revision,current_context,
                "authority was published before persistence ran");
            Err("synthetic_persist_failure".to_string())
        });
        assert_eq!(failure,Err("synthetic_persist_failure".into()));
        assert_eq!(serde_json::to_value(&live).unwrap(),before);
        assert_eq!(connection_context(&live),current_context);
        assert!(activation_token(&reader,&reader.server_url,None,Some(&current_context)).is_ok());
        assert!(messaging::pubkey_context(&reader,&current_context).is_ok());
    }

}


#[cfg(all(test, unix))]
mod native635_lifecycle_red_tests {
    use super::*;
    use std::path::Path;
    use std::os::unix::fs::PermissionsExt;
    struct Fixture { root: PathBuf, path: PathBuf }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("crewing635-lifecycle-red-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self { path: root.join("synthetic-settings.json"), root }
        }
        fn write(&self, bytes: &[u8]) { std::fs::write(&self.path, bytes).unwrap(); }
    }
    impl Drop for Fixture { fn drop(&mut self) { std::fs::remove_dir_all(&self.root).unwrap(); } }
    fn legacy() -> Settings {
        Settings { server_url: "https://synthetic.invalid".into(), bearer_token: "legacy-synthetic-only".into(),
            crewing_id: "company-synthetic".into(), company_name: "Old synthetic owner".into(),
            vault_path: "/synthetic/never-opened/vault".into(),
            profile: CrewingProfile { legal_name: "Synthetic retained profile".into(), ..Default::default() },
            ..Default::default() }
    }
    fn native(signed_out: bool) -> Settings {
        let mut s=legacy(); s.bearer_token="skn_synthetic_only".into();
        s.native_account=Some(native_lifecycle::SessionRecord::new(
            "account-synthetic".into(), "app-synthetic-only".into(), signed_out,
            native_account::Entitlement {source:"approved_free".into(),expires_at:None},
        )); s
    }
    fn load(path: &Path) -> Settings { Settings::load_from(path) }
    #[test]
    fn native635_lifecycle_red_fresh_startup_does_not_open_private_db() {
        assert!(!startup_should_open_db(&Settings::default()));
    }
    #[test]
    fn native635_lifecycle_red_signed_out_startup_does_not_open_private_db() {
        let f=Fixture::new(); f.write(&serde_json::to_vec(&native(true)).unwrap());
        let s=load(&f.path); assert!(!startup_should_open_db(&s));
    }
    #[test]
    fn native635_lifecycle_red_locked_restart_does_not_open_private_db() {
        let f=Fixture::new(); let mut s=native(false); s.native_authorized=true;
        f.write(&serde_json::to_vec(&s).unwrap());let loaded=load(&f.path);
        assert!(!loaded.native_authorized);assert!(!startup_should_open_db(&loaded));
    }
    #[test]
    fn native635_lifecycle_red_orphan_native_never_falls_back_to_legacy() {
        let mut s=legacy(); s.bearer_token="skn_synthetic_orphan".into();
        assert!(s.native_account.is_none());assert!(!startup_should_open_db(&s));
    }
    #[test]
    fn native635_lifecycle_red_malformed_config_is_uncertain() {
        let f=Fixture::new();let bytes=b"{synthetic-malformed";f.write(bytes);
        let s=load(&f.path);assert!(s.load_uncertain);assert_eq!(std::fs::read(&f.path).unwrap(),bytes);
    }
    #[test]
    fn native635_lifecycle_red_malformed_config_does_not_create_backup() {
        let f=Fixture::new();f.write(b"{synthetic-malformed");let _=load(&f.path);
        assert!(!f.path.with_extension("json.bak").exists());
    }
    #[test]
    fn native635_lifecycle_red_read_failure_is_not_fresh() {
        let f=Fixture::new();let s=load(&f.root);assert!(s.load_uncertain);
    }
    #[test]
    fn native635_lifecycle_red_signed_out_public_dto_hides_prior_workspace() {
        let s=native(true);let dto=serde_json::to_value(settings_for_ui(&s)).unwrap();
        assert_eq!(dto["crewing_id"], "");assert_eq!(dto["company_name"], "");
        assert_eq!(dto["vault_path"], "");assert_eq!(dto["recent_vaults"],serde_json::json!([]));
        assert_eq!(dto["profile"]["legal_name"], "");assert_eq!(dto["has_bearer_token"],false);
    }
    #[test]
    fn native635_lifecycle_red_missing_config_control_starts_unbound() {
        let f=Fixture::new();let s=load(&f.path);assert!(!s.load_uncertain);
        assert!(s.crewing_id.is_empty());assert!(s.native_account.is_none());assert!(!f.path.exists());
    }
    #[test]
    fn native635_lifecycle_red_valid_legacy_control_keeps_connection_and_profile() {
        let f=Fixture::new();let old=legacy();let bytes=serde_json::to_vec(&old).unwrap();f.write(&bytes);
        let s=load(&f.path);assert!(startup_should_open_db(&s));assert!(!s.native_authorized);
        assert_eq!(s.bearer_token,"legacy-synthetic-only");assert_eq!(s.profile.legal_name,"Synthetic retained profile");
        assert_eq!(s.vault_path,"/synthetic/never-opened/vault");assert_eq!(std::fs::read(&f.path).unwrap(),bytes);
    }

    // No.880 (1495), пункт 4: признак АККАУНТ-СЕССИИ в публичной проекции.
    // Имя одно на обоих концах — `account_session` здесь и в dist. Все исходы
    // различаются ПОЛЕМ, а не классом ошибки, включая «никогда не было» (`none`).
    // Ложные источники, которые проверка обязана НЕ принимать за сессию:
    // `has_bearer_token` (легаси-токен компании) и `crewing_id` (UUID организации).
    fn session_shape(signed_out: bool, expires_in: chrono::Duration) -> Settings {
        let mut s = native(signed_out);
        s.server_url = api::PRIMARY_API.into();
        s.token_scopes = native_account::COMPANY_SCOPES.iter().map(|scope| scope.to_string()).collect();
        s.token_expires_at = Some((chrono::Utc::now() + expires_in).to_rfc3339());
        s
    }
    fn session_field(s: &Settings) -> String {
        serde_json::to_value(settings_for_ui(s)).unwrap()["account_session"].as_str().unwrap().to_string()
    }
    #[test]
    fn native635_880_account_session_names_every_outcome() {
        // ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: поле вообще присутствует в проекции, иначе все
        // сравнения ниже сравнивали бы null с null.
        let dto = serde_json::to_value(settings_for_ui(&Settings::default())).unwrap();
        assert!(dto.get("account_session").is_some(), "control: the projection must carry the field at all");

        assert_eq!(session_field(&Settings::default()), "none",
            "a virgin install has never had a session");
        assert_eq!(session_field(&legacy()), "legacy",
            "the old company-token install is its own outcome, not a session");
        assert_eq!(session_field(&session_shape(false, chrono::Duration::minutes(10))), "locked",
            "a stored record without this process being authorized is locked, not active");
        assert_eq!(session_field(&session_shape(true, chrono::Duration::minutes(10))), "signed_out",
            "signing out is distinguishable from never having signed in");
        let mut uncertain = Settings::default(); uncertain.load_uncertain = true;
        assert_eq!(session_field(&uncertain), "unavailable",
            "an unreadable store is never reported as «no session»");

        let mut active = session_shape(false, chrono::Duration::minutes(10));
        active.native_authorized = true;
        assert_eq!(session_field(&active), "active", "an authorized live session reads active");
        let mut expired = session_shape(false, chrono::Duration::minutes(-10));
        expired.native_authorized = true;
        assert_eq!(session_field(&expired), "expired",
            "an expired session is its own outcome and never collapses into «none»");
    }
    #[test]
    fn native635_880_account_session_rejects_the_false_sources() {
        // Ровно три ложных источника из карточки. Ни один не должен дать «active».
        let mut token_only = Settings::default();
        token_only.bearer_token = "legacy-synthetic-only".into();
        assert_ne!(session_field(&token_only), "active", "a company bearer token is not an account session");
        let mut company_only = Settings::default();
        company_only.crewing_id = "company-synthetic".into();
        assert_ne!(session_field(&company_only), "active", "an organization UUID is not an account session");
    }
    #[test]
    fn native635_880_account_entitlement_is_projected_flat() {
        let mut active = session_shape(false, chrono::Duration::minutes(10));
        active.native_authorized = true;
        let expiry = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
        if let Some(record) = active.native_account.as_mut() {
            record.entitlement.source = "paddle".into();
            record.entitlement.expires_at = Some(expiry.clone());
        }
        let dto = serde_json::to_value(settings_for_ui(&active)).unwrap();
        // Имена те же, что в проекции «4+1» входа (NativeAccountLogin).
        assert_eq!(dto["entitlement_source"], "paddle");
        assert_eq!(dto["entitlement_expires_at"], serde_json::json!(expiry));
        // И отдельное имя для отдельного срока: `token_expires_at` — это срок
        // СОЕДИНЕНИЯ, а не права. Склейка этих двух и была бы молчащим дефектом.
        assert_ne!(dto["entitlement_expires_at"], dto["token_expires_at"]);
        // Без записи аккаунта поля пусты, а не отсутствуют.
        let empty = serde_json::to_value(settings_for_ui(&Settings::default())).unwrap();
        assert_eq!(empty["entitlement_source"], "");
        assert_eq!(empty["entitlement_expires_at"], serde_json::Value::Null);
    }

    #[cfg(target_os = "linux")]
    fn bindingfmt_old_record() -> Settings {
        let mut s=native(false);s.server_url=api::PRIMARY_API.into();
        s.token_scopes=native_account::COMPANY_SCOPES.iter().map(|scope|scope.to_string()).collect();
        s.token_expires_at=Some((chrono::Utc::now()+chrono::Duration::minutes(10)).to_rfc3339());
        s
    }
    #[cfg(target_os = "linux")]
    fn bindingfmt_refuses_without_rewrite(json: serde_json::Value) {
        let f=Fixture::new();let bytes=serde_json::to_vec_pretty(&json).unwrap();f.write(&bytes);
        let mut loaded=load(&f.path);
        assert!(loaded.load_uncertain,"unsupported/incomplete native private format must not be treated as a writable record");
        assert!(!startup_should_open_db(&loaded));let mut proposed=loaded.clone();
        proposed.interface.language="en".into();let mut writes=0;
        assert!(persist_and_install_settings(&mut loaded,proposed,|_|{writes+=1;Ok(())}).is_err());
        assert_eq!(writes,0);assert_eq!(std::fs::read(&f.path).unwrap(),bytes);
        assert_eq!(std::fs::read_dir(&f.root).unwrap().count(),1,"no backup/migration/extra file");
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_unknown_record_version_preserves_bytes_and_blocks_preference_write() {
        let mut json=serde_json::to_value(bindingfmt_old_record()).unwrap();
        json["native_account"]["record_version"]=serde_json::json!(2);
        json["native_account"]["local_binding"]=serde_json::json!({"version":99,"future_private_payload":["synthetic-preserved"]});
        bindingfmt_refuses_without_rewrite(json);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_version_one_without_binding_is_not_a_writable_record() {
        let mut json=serde_json::to_value(bindingfmt_old_record()).unwrap();
        json["native_account"]["record_version"]=serde_json::json!(1);
        json["native_account"].as_object_mut().unwrap().remove("local_binding");
        bindingfmt_refuses_without_rewrite(json);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_unknown_binding_version_preserves_private_payload() {
        let mut json=serde_json::to_value(bindingfmt_old_record()).unwrap();
        json["native_account"]["record_version"]=serde_json::json!(1);
        json["native_account"]["local_binding"]=serde_json::json!({"version":2,"future_key_descriptor":{"keep":"synthetic-only"}});
        bindingfmt_refuses_without_rewrite(json);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_old_record_control_restarts_locked_without_inferred_refs() {
        let f=Fixture::new();let old=bindingfmt_old_record();let json=serde_json::to_value(&old).unwrap();
        assert!(json["native_account"].get("record_version").is_none());assert!(json["native_account"].get("local_binding").is_none());
        let bytes=serde_json::to_vec(&old).unwrap();f.write(&bytes);let loaded=load(&f.path);
        assert!(!loaded.load_uncertain);assert!(!loaded.native_authorized);assert!(!startup_should_open_db(&loaded));
        let runtime=native_lifecycle::Runtime::new(loaded);let state=runtime.settings_arc();let locked=state.lock().unwrap();
        assert_eq!(native_lifecycle::mode(&locked,&[api::PRIMARY_API,api::RU_API]),native_lifecycle::Mode::NativeLocked);
        let saved=serde_json::to_value(&*locked).unwrap();
        assert!(saved["native_account"].get("local_binding").is_none());
        assert_eq!(locked.profile.legal_name,"Synthetic retained profile");
        assert_eq!(std::fs::read(&f.path).unwrap(),bytes);
    }

    #[cfg(target_os = "linux")]
    fn bindingfmt_real_record(f: &Fixture, label: &str) -> serde_json::Value {
        use crate::db::native_database::{Namespace, Owner, Store, native_keys};
        let dbroot=f.root.join(format!("db-{label}"));let keyroot=f.root.join(format!("key-{label}"));
        for root in [&dbroot,&keyroot] {
            std::fs::create_dir(root).unwrap();
            std::fs::set_permissions(root,std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let stable=uuid::Uuid::new_v4().to_string();
        let owner=Owner::from_validated_binding("account-synthetic".into(),"company-synthetic".into(),stable.clone()).unwrap();
        let slot=std::sync::Mutex::new(None);let quarantine=std::sync::Mutex::new(None);
        let store=Store::new(&slot,&quarantine);
        let prepared=store.prepare_fresh(Namespace::inspect(&dbroot).unwrap(),owner.clone()).unwrap();
        prepared.validate_before_persist().unwrap();
        let database_ref=serde_json::to_value(prepared.reference()).unwrap();
        // Close the sole owned SQLite handle before any fixture inventory/cleanup.
        drop(prepared);store.close_all().unwrap();
        let key=native_keys::prepare_fresh(&Namespace::inspect(&keyroot).unwrap(),owner).unwrap();
        let key_ref=serde_json::to_value(key.reference()).unwrap();drop(key);
        let mut json=serde_json::to_value(bindingfmt_old_record()).unwrap();
        json["native_account"]["record_version"]=serde_json::json!(1);
        json["native_account"]["local_binding"]=serde_json::json!({
            "version":1,"stable_uuid":stable,"database_ref":database_ref,"key_ref":key_ref
        });
        json
    }
    #[cfg(target_os = "linux")]
    fn bindingfmt_reject_raw(f: &Fixture, bytes: &[u8]) {
        f.write(bytes);let mut loaded=load(&f.path);
        assert!(loaded.load_uncertain);assert!(!startup_should_open_db(&loaded));
        let mut proposed=loaded.clone();proposed.interface.language="en".into();let mut writes=0;
        assert!(persist_and_install_settings(&mut loaded,proposed,|_|{writes+=1;Ok(())}).is_err());
        assert_eq!(writes,0);assert_eq!(std::fs::read(&f.path).unwrap(),bytes);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_real_refs_roundtrip_restart_locked_and_profile_preserved() {
        let f=Fixture::new();let input=bindingfmt_real_record(&f,"roundtrip");
        f.write(&serde_json::to_vec(&input).unwrap());let loaded=load(&f.path);
        assert!(!loaded.load_uncertain);assert!(!loaded.native_authorized);assert!(!startup_should_open_db(&loaded));
        let saved=serde_json::to_value(&loaded).unwrap();
        assert_eq!(saved["native_account"],input["native_account"]);
        let runtime=native_lifecycle::Runtime::new(loaded);let state=runtime.settings_arc();let locked=state.lock().unwrap();
        assert_eq!(native_lifecycle::mode(&locked,&[api::PRIMARY_API,api::RU_API]),native_lifecycle::Mode::NativeLocked);
        assert_eq!(locked.profile.legal_name,"Synthetic retained profile");
        assert_eq!(locked.persist_native_to_path(&f.path),Ok(private_store::Durability::Confirmed));
        let reloaded=load(&f.path);assert!(!reloaded.load_uncertain);
        assert_eq!(serde_json::to_value(&reloaded).unwrap()["native_account"],input["native_account"]);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_record_version_only_with_real_refs_is_refused() {
        let f=Fixture::new();let mut input=bindingfmt_real_record(&f,"record-version");
        f.write(&serde_json::to_vec(&input).unwrap());assert!(!load(&f.path).load_uncertain);
        input["native_account"]["record_version"]=serde_json::json!(2);
        bindingfmt_reject_raw(&f,&serde_json::to_vec(&input).unwrap());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_binding_version_only_with_real_refs_is_refused() {
        let f=Fixture::new();let mut input=bindingfmt_real_record(&f,"binding-version");
        f.write(&serde_json::to_vec(&input).unwrap());assert!(!load(&f.path).load_uncertain);
        input["native_account"]["local_binding"]["version"]=serde_json::json!(2);
        bindingfmt_reject_raw(&f,&serde_json::to_vec(&input).unwrap());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_opaque_nested_metadata_survives_known_updates_without_authority() {
        let f=Fixture::new();let mut input=bindingfmt_real_record(&f,"opaque");
        let original=input["native_account"]["local_binding"].clone();
        input["native_account"]["metadata"]=serde_json::json!({"account_id":"other","crewing_id":"other","entitlement":{"source":"paddle"}});
        input["native_account"]["entitlement"]["metadata"]=serde_json::json!({"source":"paddle","expires_at":"invalid-synthetic"});
        input["native_account"]["local_binding"]["metadata"]=serde_json::json!({"root":"/synthetic-other","stable_uuid":"other","version":99});
        input["native_account"]["local_binding"]["database_ref"]["owner"]["metadata"]=serde_json::json!({"account":"other","context":"other"});
        input["native_account"]["local_binding"]["key_ref"]["metadata"]=serde_json::json!({"local_origin":"LegacySnapshot","root":"/synthetic-other"});
        f.write(&serde_json::to_vec(&input).unwrap());let mut loaded=load(&f.path);assert!(!loaded.load_uncertain);
        assert_eq!(loaded.crewing_id,"company-synthetic");let record=loaded.native_account.as_mut().unwrap();
        assert_eq!(record.account_id,"account-synthetic");assert_eq!(record.entitlement.source,"approved_free");
        record.app_credential="app-synthetic-updated".into();record.signed_out=true;
        record.entitlement.source="paddle".into();record.entitlement.expires_at=Some((chrono::Utc::now()+chrono::Duration::hours(1)).to_rfc3339());
        assert_eq!(loaded.persist_native_to_path(&f.path),Ok(private_store::Durability::Confirmed));
        let reloaded=load(&f.path);assert!(!reloaded.load_uncertain);
        let output=serde_json::to_value(&reloaded).unwrap();let out=&output["native_account"];let before=&input["native_account"];
        assert_eq!(out["metadata"],before["metadata"]);
        assert_eq!(out["entitlement"]["metadata"],before["entitlement"]["metadata"]);
        assert_eq!(out["local_binding"],before["local_binding"]);
        assert_eq!(out["local_binding"]["database_ref"]["root"],original["database_ref"]["root"]);
        assert_eq!(out["local_binding"]["key_ref"]["local_origin"],original["key_ref"]["local_origin"]);
        assert_eq!(out["app_credential"],"app-synthetic-updated");assert_eq!(out["signed_out"],true);
        assert_eq!(out["entitlement"]["source"],"paddle");
        assert_eq!(native_lifecycle::mode(&reloaded,&[api::PRIMARY_API,api::RU_API]),native_lifecycle::Mode::SignedOut);
        let public=serde_json::to_string(&settings_for_ui(&reloaded)).unwrap();
        assert!(!public.contains("metadata"));assert!(!public.contains("local_binding"));assert!(!public.contains("app-synthetic"));
        assert_eq!(format!("{:?}",reloaded),"Settings(<private>)");
        assert_eq!(format!("{:?}",reloaded.native_account.as_ref().unwrap()),"SessionRecord(<private>)");
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_opaque_numbers_and_literal_reserved_keys_roundtrip_raw() {
        let f=Fixture::new();let input=bindingfmt_real_record(&f,"raw");
        let mut text=serde_json::to_string(&input).unwrap();
        let needle="\"native_account\":{";
        assert!(text.contains(needle));
        text=text.replacen(needle,r#""native_account":{"opaque_array":[{"$serde_json::private::RawValue":"literal-synthetic","huge":18446744073709551617,"negative":-18446744073709551617,"exponent":1e10000,"precise":1.2345678901234567890123456789}],"# ,1);
        f.write(text.as_bytes());let loaded=load(&f.path);assert!(!loaded.load_uncertain);
        let roundtrip=serde_json::to_string(&loaded).unwrap();
        for literal in ["18446744073709551617","-18446744073709551617","1e10000","1.2345678901234567890123456789",r#""$serde_json::private::RawValue":"literal-synthetic""#] {
            assert!(roundtrip.contains(literal),"opaque raw value changed");
        }
        assert_eq!(loaded.persist_native_to_path(&f.path),Ok(private_store::Durability::Confirmed));
        let reloaded=load(&f.path);assert!(!reloaded.load_uncertain);
        assert!(serde_json::to_string(&reloaded).unwrap().contains("1e10000"));
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_duplicate_escaped_keys_and_array_members_are_refused() {
        let f=Fixture::new();let input=bindingfmt_real_record(&f,"duplicate");
        let good=serde_json::to_string(&input).unwrap();
        for addition in [
            r#""account\u005fid":"other","#,
            r#""metadata":[{"root":"first","\u0072oot":"second"}],"#,
            r#""metadata":{"unknown":1,"unknown":2},"#,
        ] {
            let text=good.replacen("\"native_account\":{",&format!("\"native_account\":{{{addition}"),1);
            bindingfmt_reject_raw(&f,text.as_bytes());
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_null_partial_types_ranges_and_outer_owner_are_refused() {
        let f=Fixture::new();let good=bindingfmt_real_record(&f,"known");
        for pointer in ["/native_account/record_version","/native_account/local_binding",
            "/native_account/local_binding/version","/native_account/local_binding/database_ref/owner/account",
            "/native_account/local_binding/key_ref/local_origin"] {
            let mut input=good.clone();*input.pointer_mut(pointer).unwrap()=serde_json::Value::Null;
            bindingfmt_reject_raw(&f,&serde_json::to_vec(&input).unwrap());
        }
        for value in [serde_json::json!("1"),serde_json::json!(1.0),serde_json::json!(256),serde_json::json!(-1)] {
            let mut input=good.clone();input["native_account"]["record_version"]=value;
            bindingfmt_reject_raw(&f,&serde_json::to_vec(&input).unwrap());
        }
        let mut no_version=good.clone();no_version["native_account"].as_object_mut().unwrap().remove("record_version");
        bindingfmt_reject_raw(&f,&serde_json::to_vec(&no_version).unwrap());
        for (pointer,value) in [
            ("/crewing_id",serde_json::json!("other-synthetic")),
            ("/native_account/account_id",serde_json::json!("other-synthetic")),
            ("/native_account/local_binding/database_ref/root_identity/uid",serde_json::json!(4294967296u64)),
            ("/native_account/local_binding/database_ref/main_identity/inode",serde_json::json!(-1)),
            ("/native_account/local_binding/stable_uuid",serde_json::json!("ctx_synthetic")),
            ("/native_account/local_binding/key_ref/raw_key_sha256",serde_json::json!("bad-synthetic")),
            ("/native_account/local_binding/key_ref/public_key_b64",serde_json::json!("bad-synthetic")),
        ] {
            let mut input=good.clone();*input.pointer_mut(pointer).unwrap()=value;
            bindingfmt_reject_raw(&f,&serde_json::to_vec(&input).unwrap());
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn native635_bindingfmt_private_ref_swap_invalidates_existing_context() {
        let f=Fixture::new();let first=bindingfmt_real_record(&f,"first");let second=bindingfmt_real_record(&f,"second");
        let mut loaded:Settings=serde_json::from_value(first).unwrap();let context=connection_context(&loaded);
        let other:Settings=serde_json::from_value(second).unwrap();loaded.native_account=other.native_account;
        assert!(!connection_context_matches(&loaded,&context));assert_ne!(connection_context(&loaded),context);
        assert!(!startup_should_open_db(&loaded));
    }

    #[test]
    fn native635_lifecycle_red_private_record_control_persists_without_runtime_auth() {
        let f=Fixture::new();let mut s=native(false);s.native_authorized=true;s.native_generation="synthetic-runtime-generation".into();
        f.write(&serde_json::to_vec(&s).unwrap());let bytes=std::fs::read(&f.path).unwrap();
        let json:serde_json::Value=serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["native_account"]["app_credential"],"app-synthetic-only");
        assert!(json.get("native_authorized").is_none());assert!(json.get("native_generation").is_none());
        let loaded=load(&f.path);assert!(!loaded.native_authorized);assert!(loaded.native_generation.is_empty());
        let public=serde_json::to_string(&settings_for_ui(&loaded)).unwrap();
        assert!(!public.contains("app-synthetic-only"));assert!(!public.contains("skn_synthetic_only"));
    }
    #[test]
    fn native635_lifecycle_red_bridge_injected_record_cannot_replace_native_identity() {
        let mut current=native(false);current.native_authorized=true;current.native_generation="live-synthetic-generation".into();
        let expected=connection_context(&current);let mut json=serde_json::to_value(&current).unwrap();
        json["native_account"]["account_id"]=serde_json::json!("attacker-synthetic");
        json["native_account"]["app_credential"]=serde_json::json!("attacker-app-synthetic");
        json["native_account"]["signed_out"]=serde_json::json!(true);
        let proposed:Settings=serde_json::from_value(json).unwrap();
        let merged=merge_ui_settings(proposed,&current,&expected).unwrap();
        let record=merged.native_account.as_ref().unwrap();assert_eq!(record.account_id,"account-synthetic");
        assert_eq!(record.app_credential,"app-synthetic-only");assert!(!record.signed_out);
        assert!(merged.native_authorized);assert_eq!(merged.native_generation,"live-synthetic-generation");
    }
    #[test]
    fn native635_lifecycle_red_bridge_omission_cannot_drop_private_state() {
        let mut current=native(false);current.native_authorized=true;current.native_generation="live-synthetic-generation".into();
        current.load_uncertain=true;current.storage_uncertain=true;let expected=connection_context(&current);
        let mut json=serde_json::to_value(&current).unwrap();json.as_object_mut().unwrap().remove("native_account");
        let proposed:Settings=serde_json::from_value(json).unwrap();assert!(proposed.native_account.is_none());
        let merged=merge_ui_settings(proposed,&current,&expected).unwrap();
        assert_eq!(merged.native_account.as_ref().unwrap().account_id,"account-synthetic");
        assert!(merged.native_authorized);assert_eq!(merged.native_generation,"live-synthetic-generation");
        assert!(merged.load_uncertain);assert!(merged.storage_uncertain);
    }
    #[test]
    fn native635_lifecycle_red_bridge_injection_cannot_bind_legacy_owner() {
        let current=legacy();let expected=connection_context(&current);let mut json=serde_json::to_value(&current).unwrap();
        json["native_account"]=serde_json::to_value(native(false).native_account).unwrap();
        let proposed:Settings=serde_json::from_value(json).unwrap();assert!(proposed.native_account.is_some());
        let merged=merge_ui_settings(proposed,&current,&expected).unwrap();
        assert!(merged.native_account.is_none());assert!(!merged.native_authorized);
        assert_eq!(merged.bearer_token,"legacy-synthetic-only");assert_eq!(merged.crewing_id,"company-synthetic");
    }

    #[test]
    fn native635_lifecycle_extra_red_settings_debug_contains_no_private_fields() {
        let s=native(false);let debug=format!("{:?}",s);
        for private in ["skn_synthetic_only","app-synthetic-only","account-synthetic","Synthetic retained profile","/synthetic/never-opened/vault"] {
            assert!(!debug.contains(private),"Settings Debug contains private field");
        }
    }
    #[test]
    fn native635_lifecycle_extra_red_legacy_url_normalization_does_not_rewrite_config() {
        let f=Fixture::new();let mut s=legacy();s.server_url="https://synthetic.invalid:8443".into();
        let bytes=serde_json::to_vec(&s).unwrap();f.write(&bytes);let loaded=load(&f.path);
        assert_eq!(loaded.server_url,"https://synthetic.invalid");
        assert_eq!(std::fs::read(&f.path).unwrap(),bytes,"startup must not rewrite credentials");
        assert!(!f.path.with_extension("json.bak").exists());
    }

    #[test]
    fn native635_lifecycle_extra_red_trimmed_native_orphans_never_expose_workspace() {
        for token in [" skn_synthetic_orphan ","\tskn_synthetic_orphan\n","skn_"] {
            let mut current=legacy();current.bearer_token=token.into();
            let dto=serde_json::to_value(settings_for_ui(&current)).unwrap();
            assert_eq!(dto["crewing_id"],"");assert_eq!(dto["profile"]["legal_name"],"");
            assert_eq!(dto["has_bearer_token"],false);
        }
    }
    #[test]
    fn native635_lifecycle_extra_red_native_public_preferences_roundtrip_preserves_private_workspace() {
        let current=native(true);let expected=connection_context(&current);
        let mut json=serde_json::to_value(settings_for_ui(&current)).unwrap();
        json["interface"]["theme"]=serde_json::json!("dark");
        let proposed:Settings=serde_json::from_value(json).unwrap();
        let merged=merge_ui_settings(proposed,&current,&expected).expect("safe interface save must preserve workspace");
        assert_eq!(merged.interface.theme,"dark");assert_eq!(merged.bearer_token,"skn_synthetic_only");
        assert_eq!(merged.crewing_id,"company-synthetic");assert_eq!(merged.vault_path,"/synthetic/never-opened/vault");
        assert_eq!(merged.profile.legal_name,"Synthetic retained profile");
        assert_eq!(merged.native_account.as_ref().unwrap().app_credential,"app-synthetic-only");
        assert!(merged.native_account.as_ref().unwrap().signed_out);
    }
    #[test]
    fn native635_lifecycle_extra_red_partial_legacy_preferences_roundtrip_preserves_private_workspace() {
        let mut current=legacy();current.bearer_token.clear();current.crewing_id.clear();
        let expected=connection_context(&current);let mut json=serde_json::to_value(settings_for_ui(&current)).unwrap();
        json["interface"]["language"]=serde_json::json!("ru");
        let proposed:Settings=serde_json::from_value(json).unwrap();let merged=merge_ui_settings(proposed,&current,&expected).unwrap();
        assert_eq!(merged.interface.language,"ru");assert!(merged.bearer_token.is_empty());assert!(merged.crewing_id.is_empty());
        assert_eq!(merged.company_name,"Old synthetic owner");assert_eq!(merged.vault_path,"/synthetic/never-opened/vault");
        assert_eq!(merged.profile.legal_name,"Synthetic retained profile");
    }
    #[test]
    fn native635_lifecycle_extra_red_native_binding_cannot_be_replaced_by_manual_credential() {
        let current=native(false);let expected=connection_context(&current);let mut json=serde_json::to_value(&current).unwrap();
        json["bearer_token"]=serde_json::json!("skn_other_synthetic");json["crewing_id"]=serde_json::json!("other-synthetic-company");
        json["server_url"]=serde_json::json!("https://other-synthetic.invalid");
        let proposed:Settings=serde_json::from_value(json).unwrap();
        assert!(merge_ui_settings(proposed,&current,&expected).is_err(),"native company credentials cannot come from settings UI");
    }

    #[test]
    fn native635_loader_uncertain_persistence_never_calls_writer_or_changes_original() {
        let f=Fixture::new();let raw=b"{synthetic-malformed-private-settings";f.write(raw);
        let mut current=load(&f.path);let before=connection_context(&current);
        let mut proposed=current.clone();proposed.interface.language="ru".into();
        let result=persist_and_install_settings(&mut current,proposed,|_| {
            panic!("uncertain configuration reached a persistence callback");
        });
        assert_eq!(result,Err("settings_unavailable".into()));
        assert_eq!(connection_context(&current),before);
        assert_eq!(std::fs::read(&f.path).unwrap(),raw);
        assert!(current.load_uncertain);
    }
    #[test]
    fn native635_loader_dangling_symlink_is_uncertain_without_mutation() {
        let f=Fixture::new();std::os::unix::fs::symlink(f.root.join("absent-target"),&f.path).unwrap();
        let loaded=load(&f.path);assert!(loaded.load_uncertain);
        assert!(std::fs::symlink_metadata(&f.path).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_dir(&f.root).unwrap().count(),1);
    }
}

#[cfg(test)]
mod native635_revision_red_tests {
    use super::*;
    fn synthetic(native: bool) -> Settings {
        let mut s = Settings::default();
        s.server_url = api::PRIMARY_API.into(); s.crewing_id = "synthetic-revision-company".into();
        s.bearer_token = if native { "skn_synthetic-revision-secret" } else { "synthetic-legacy-revision-secret" }.into();
        s.vault_path = "/synthetic-revision-old-vault-never-opened".into();
        if native {
            s.native_account = Some(native_lifecycle::SessionRecord::new(
                "synthetic-revision-account".into(), "synthetic-revision-app-secret".into(), false,
                native_account::Entitlement { source: "approved_free".into(), expires_at: None },
            ));
            s.native_authorized = true; s.native_generation = "synthetic-generation-old".into();
        }
        s
    }
    #[test]
    fn native635_revision_same_connection_new_native_generation_invalidates_old_snapshot() {
        let mut current = synthetic(true); let context = connection_context(&current); let snapshot = current.clone();
        let mut next = current.clone(); next.native_generation = "synthetic-generation-new".into();
        install_settings(&mut current, next);
        assert_ne!(connection_context(&current), context, "fresh native authorization must rotate context even for identical connection tuple");
        assert!(!connection_context_matches(&snapshot, &context), "old immutable snapshot cannot own new authorization");
    }
    #[test]
    fn native635_revision_native_vault_change_invalidates_old_snapshot() {
        let mut current = synthetic(true); let context = connection_context(&current); let snapshot = current.clone();
        let mut next = current.clone(); next.vault_path = "/synthetic-revision-new-vault-never-opened".into();
        install_settings(&mut current, next);
        assert_ne!(connection_context(&current), context, "native private workspace is part of context identity");
        assert!(!connection_context_matches(&snapshot, &context));
    }
    #[test]
    fn native635_revision_legacy_preferences_preserve_existing_context_behavior() {
        let mut current = synthetic(false); let context = connection_context(&current); let snapshot = current.clone();
        let mut next = current.clone(); next.vault_path = "/synthetic-legacy-new-vault-never-opened".into();
        next.interface.theme = "light".into(); next.profile.legal_name = "Synthetic preference edit".into();
        install_settings(&mut current, next);
        assert_eq!(connection_context(&current), context); assert!(connection_context_matches(&snapshot, &context));
    }
}

#[cfg(test)]
mod native635_boot_tests {
    use super::*;
    fn legacy() -> Settings {
        Settings { server_url: "https://synthetic.invalid".into(),
            bearer_token: "legacy-synthetic-only".into(), crewing_id: "company-synthetic".into(),
            ..Default::default() }
    }
    fn native() -> Settings {
        let mut s=legacy(); s.server_url=api::PRIMARY_API.into(); s.bearer_token="skn_synthetic_only".into();
        s.token_scopes=native_account::COMPANY_SCOPES.iter().map(|s|s.to_string()).collect();
        s.token_expires_at=Some((chrono::Utc::now()+chrono::Duration::minutes(10)).to_rfc3339());
        s.native_account=Some(native_lifecycle::SessionRecord::new(
            "account-synthetic".into(), "app-synthetic-only".into(), false,
            native_account::Entitlement {source:"approved_free".into(),expires_at:None},
        )); s
    }
    fn blocked_modes() -> Vec<Settings> {
        let mut signed=native();signed.native_account.as_mut().unwrap().signed_out=true;
        let mut authorized=native(); authorized.native_authorized=true;
        let mut orphan=legacy(); orphan.bearer_token=" skn_synthetic_orphan ".into();
        let mut uncertain=legacy(); uncertain.load_uncertain=true;
        let mut partial=legacy();partial.crewing_id.clear();
        vec![Settings::default(),native(),signed,authorized,orphan,uncertain,partial]
    }
    #[test]
    fn native635_boot_private_dispatch_never_reaches_side_effects_in_blocked_modes() {
        for settings in blocked_modes() {
            for command in ["get_my_identity","list_documents","crewing_intake_open_saved",
                "download_encrypted_attachment","open_path_with_default","init_app_diagnostics",
                "activate_crewing_token","issue_crewing_trial_token","unknown_future_command","get_settings_extra"] {
                let mut reached=0;
                let result=boot_command_allowed(&settings,command).map(|_|{reached+=1;});
                assert_eq!(reached,0,"private dispatch reached handler: {command}");
                assert!(result.is_err(),"{command}");
            }
        }
    }
    #[test]
    fn native635_boot_public_commands_and_legacy_dispatch_control() {
        for settings in blocked_modes() {
            // No.880 п.5: `open_external_url` допущена до входа намеренно — дверь
            // «Регистрация» живёт на развилке, то есть ИМЕННО в не-легаси процессе,
            // и отказ сделал бы регистрацию недостижимой для того, для кого эта
            // задача и существует.
            for command in ["get_build_info","get_settings","save_settings","native_account_login","open_external_url"] {
                assert_eq!(boot_command_allowed(&settings,command),Ok(()));
            }
            // ОТРИЦАТЕЛЬНАЯ сторона того же пина: список закрыт, и команда вне
            // него в заблокированном процессе отказывает. Без этой половины пин
            // прошёл бы и на гейте, который пускает всё.
            for command in ["get_my_identity","list_documents","crewing_intake_open_saved","save_compliance_profile"] {
                assert_eq!(boot_command_allowed(&settings,command),Err("login_required"));
            }
        }
        for command in ["get_my_identity","list_documents","crewing_intake_open_saved","get_settings"] {
            assert_eq!(boot_command_allowed(&legacy(),command),Ok(()));
        }
    }

    // No.880 п.5 (1495): внешнюю ссылку открывает ТОЛЬКО эта проверка, и только
    // https на названный хост. Образец — Моряк (`skipi-public`, blob прочитан
    // через `git show`), но аллоулист СТРОЖЕ: у Моряка four схемы
    // (https/http/mailto/tel) и хост любой, здесь — одна схема и один хост,
    // потому что предмет один: страница регистрации Skipi.
    #[test]
    fn native635_880_external_url_allowlist_is_scheme_and_host() {
        assert!(external_url_allowed("https://assistant.skipi.app/register"),
            "control: the registration page itself must be allowed, else every refusal below is vacuous");
        for refused in [
            "http://assistant.skipi.app/register",      // не https
            "file:///etc/passwd",                        // локальный файл
            "javascript:alert(1)",                       // исполнение в вебвью
            "https://evil.example.com/register",         // чужой хост
            "https://assistant.skipi.app.evil.com/x",    // хост-приставка
            "https://user:pass@assistant.skipi.app/x",   // креденшал в URL
            "https://assistant.skipi.app:8443/register",  // нестандартный порт
            "data:text/html,<script>1</script>",
            "",
            "assistant.skipi.app/register",              // без схемы вовсе
        ] {
            assert!(!external_url_allowed(refused), "must be refused: {refused}");
        }
        // Регистр хоста не делает ссылку чужой.
        assert!(external_url_allowed("https://ASSISTANT.skipi.app/register"));
    }
    #[test]
    fn native635_boot_app_state_constructor_never_reuses_native_authorization() {
        let mut input=native();input.native_authorized=true;
        let state=AppState::from_settings(input);
        assert!(!state.settings.lock().unwrap().native_authorized);
    }
    #[test]
    fn native635_boot_legacy_mode_transition_denies_before_persistence_and_preserves_state() {
        for mutation in ["orphan","empty_company","empty_origin"] {
            let mut current=legacy();let before=serde_json::to_value(&current).unwrap();
            let context=connection_context(&current);let mut next=current.clone();
            match mutation { "orphan"=>next.bearer_token="skn_synthetic_only".into(),
                "empty_company"=>next.crewing_id.clear(), _=>next.server_url.clear() }
            let mut reached=0;
            let outcome=persist_and_install_settings(&mut current,next,|_|{reached+=1;Ok(())});
            assert!(outcome.is_err(),"{mutation} was persisted");
            assert_eq!(reached,0);assert_eq!(serde_json::to_value(&current).unwrap(),before);
            assert_eq!(connection_context(&current),context);
        }
    }
}

#[cfg(test)]
mod native635_boot_resource_tests {
    use super::*;
    #[test]
    fn native635_boot_locked_asset_callback_denies_get_head_and_range_without_content() {
        for method in ["GET","HEAD"] {
            for range in [None,Some("bytes=0-31")] {
                let mut request=tauri::http::Request::builder().method(method)
                    .uri("asset://localhost/synthetic-never-opened-private-file");
                if let Some(range)=range {request=request.header("Range",range);}
                let response=locked_asset_response(request.body(Vec::new()).unwrap());
                assert_eq!(response.status(),403);
                assert_eq!(response.headers()["cache-control"],"no-store");
                assert!(response.body().is_empty());
            }
        }
    }
    #[test]
    fn native635_boot_app_state_shares_the_only_runtime_settings_owner() {
        let state=AppState::from_settings(Settings::default());
        assert!(Arc::ptr_eq(&state.settings,&state.runtime.settings_arc()));
    }
    #[test]
    fn native635_boot_legacy_default_vault_admission_preserves_exact_empty_reference() {
        let settings=Settings {server_url:"https://synthetic.invalid".into(),
            bearer_token:"legacy-synthetic-only".into(), crewing_id:"company-synthetic".into(),
            vault_path:String::new(), ..Default::default()};
        let state=AppState::from_settings(settings);
        let locked=state.settings.lock().unwrap();
        assert!(startup_should_open_db(&locked)); assert_eq!(locked.vault_path,"");
    }
}

#[cfg(all(test, target_os = "linux"))]
mod native635_boot_window_tests {
    use super::*;
    #[test]
    fn native635_boot_blocked_linux_view_uses_ephemeral_storage_without_changing_window_options() {
        let mut first=tauri::utils::config::WindowConfig::default();
        first.label="synthetic-main".into();first.incognito=false;
        let mut second=first.clone();second.label="synthetic-second".into();
        let mut windows=vec![first,second];
        let original=serde_json::to_value(&windows).unwrap();
        configure_boot_windows(&mut windows,false);
        for window in &windows { assert!(window.incognito); }
        let mut expected=original;
        for window in expected.as_array_mut().unwrap() {window["incognito"]=serde_json::json!(true);}
        assert_eq!(serde_json::to_value(&windows).unwrap(),expected);
    }
    #[test]
    fn native635_boot_existing_legacy_view_retains_all_browser_storage_options() {
        let mut window=tauri::utils::config::WindowConfig::default();window.incognito=false;
        let mut windows=vec![window];let original=serde_json::to_value(&windows).unwrap();
        configure_boot_windows(&mut windows,true);
        assert_eq!(serde_json::to_value(&windows).unwrap(),original);
    }
}
