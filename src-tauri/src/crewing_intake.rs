use crate::{AppState, Settings};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::{redirect::Policy, Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 20;
const PILOT_MAX_FILE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PilotExpectedContext {
    server_url: String,
    bearer_token: String,
    crewing_id: String,
}

#[derive(Debug, Clone)]
struct PilotContext {
    server_url: String,
    bearer_token: String,
    crewing_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct PilotBridgeError {
    pub kind: String,
    pub status: Option<u16>,
    pub detail: Option<String>,
    pub ambiguous: bool,
}

impl PilotBridgeError {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.to_string(),
            status: None,
            detail: None,
            ambiguous: false,
        }
    }

    fn invalid_context(detail: &str) -> Self {
        let mut err = Self::new("invalid_context");
        err.detail = Some(detail.to_string());
        err
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct IntakeAliasPublic {
    pub id: String,
    pub crewing_id: String,
    pub primary_profile_id: Option<String>,
    pub label: Option<String>,
    pub state: String,
    pub generation: i64,
    pub created_at: String,
    pub updated_at: String,
    pub rotated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct IntakeAliasIssued {
    #[serde(flatten)]
    pub public: IntakeAliasPublic,
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct IntakeAliasListResponse {
    pub items: Vec<IntakeAliasPublic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateIntakeObject {
    pub id: String,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateIntakeSummary {
    pub state: String,
    pub facts: i64,
    pub ranks: i64,
    pub ranks_stale: i64,
    pub active_confirmations: i64,
    pub needs_review_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateIntakeReceipt {
    pub intake_id: String,
    pub receipt_id: String,
    pub crewing_id: String,
    pub source: String,
    pub source_id: String,
    pub event_id: String,
    pub primary_profile_id: Option<String>,
    pub content_sha256: String,
    pub content_bytes: u64,
    pub content_type: String,
    pub state: String,
    pub source_trust: String,
    pub version: i64,
    pub created_at: String,
    pub issued_at: String,
    #[serde(default)]
    pub objects: Vec<CandidateIntakeObject>,
    /// S3 (2026-09-26): the attachment METADATA rows of this intake. The field is
    /// declared BEFORE the two byte commands exist on purpose — a typed Tauri
    /// command deserializes into this struct, so a missing field would drop the
    /// list on the way to the webview and the card would honestly render
    /// "no attachments" while the server had them.
    #[serde(default)]
    pub attachments: Vec<CandidateIntakeAttachment>,
    pub summary: Option<CandidateIntakeSummary>,
}

/// One attachment row exactly as `candidate_intake_service.public_attachments_for`
/// serializes it (card S3 OUTCOME (1)): metadata only, никаких storage-путей.
/// `eligible` says the verdict admits a download; the byte route stays the
/// authority and may still answer 404.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateIntakeAttachment {
    pub ordinal: i64,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub declared_type: Option<String>,
    #[serde(default)]
    pub measured_type: Option<String>,
    #[serde(default)]
    pub byte_size: Option<i64>,
    #[serde(default)]
    pub verdict: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub eligible: bool,
}

/// What a byte route gives the screen: where the copy landed, how big it is, its
/// digest, and — for the original letter only — the header part of the .eml so the
/// card can show From/Date/Subject without ever parsing the body.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct CandidateIntakeDownload {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub head_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateIntakeListResponse {
    pub items: Vec<CandidateIntakeReceipt>,
    pub limit: u32,
    pub offset: u32,
    pub total: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CandidateIntakeSubmit {
    pub alias: Option<String>,
    pub source_id: Option<String>,
    pub event_id: String,
    pub content_type: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateSubmitResult {
    pub created: bool,
    pub receipt: CandidateIntakeReceipt,
}

// ---------------- C3b-2: facts, stored comparisons, shortlist decisions ----------------

const FACT_MAX_FIELD_CHARS: usize = 120;
const FACT_MAX_VALUE_CHARS: usize = 4096;
const FACT_MAX_SOURCE_OBJECT_CHARS: usize = 120;
const FACT_MAX_SPAN_CHARS: usize = 64;
const PROFILE_ID_MAX_CHARS: usize = 36;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateFact {
    pub field: String,
    pub value: String,
    pub version: i64,
    pub source_object: String,
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub span: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub uncertainty: Option<String>,
    #[serde(default)]
    pub corrected_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateFactVersions {
    pub field: String,
    pub versions: Vec<CandidateFact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateFactListResponse {
    pub items: Vec<CandidateFactVersions>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CandidateFactSubmit {
    pub field: String,
    pub value: String,
    pub source_object: String,
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub span: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateRankResponse {
    pub ranked: i64,
    #[serde(default)]
    pub written: i64,
    pub reason: String,
    #[serde(default)]
    pub profiles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateRankReason {
    pub requirement: String,
    pub outcome: String,
    #[serde(default)]
    pub wanted: Option<Value>,
    #[serde(default)]
    pub found: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateProfileRank {
    pub profile_id: String,
    pub profile_version: i64,
    pub primary: bool,
    pub met: Vec<String>,
    pub missing: Vec<String>,
    pub unconfirmed: Vec<String>,
    pub reasons: Vec<CandidateRankReason>,
    pub decided: bool,
    pub stale: bool,
    #[serde(default)]
    pub stale_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct UnrankedProfile {
    pub profile_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct ShortlistConfirmation {
    pub profile_id: String,
    pub profile_version: i64,
    pub confirmed_by: String,
    pub confirmed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct ShortlistHistory {
    pub id: String,
    pub profile_id: String,
    pub profile_version: i64,
    pub confirmed_by: String,
    pub confirmed_at: String,
    #[serde(default)]
    pub withdrawn_by: Option<String>,
    #[serde(default)]
    pub withdrawn_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct CandidateRanksResponse {
    pub items: Vec<CandidateProfileRank>,
    #[serde(default)]
    pub unranked_active_profiles: Vec<UnrankedProfile>,
    #[serde(default)]
    pub confirmations: Vec<ShortlistHistory>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ShortlistPair {
    pub profile_id: String,
    pub profile_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct MatchingProfileMetadata {
    pub id: String,
    pub crewing_id: String,
    pub name: String,
    pub version: i64,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct MatchingProfileListResponse {
    pub items: Vec<MatchingProfileMetadata>,
}

/// What the publication route hands back (P2/S1).
///
/// A separate type from `MatchingProfileMetadata` on purpose: that one is the
/// thin row the candidate card needs in order to name a profile, and widening
/// it would put the frozen snapshot into every rank read. Unknown fields are
/// ignored by serde, so the server may carry more than this without breaking
/// the client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct MatchingProfilePublication {
    pub id: String,
    pub crewing_id: String,
    pub name: String,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default)]
    pub vessel_type: Option<String>,
    pub version: i64,
    pub state: String,
    pub publication_state: String,
    #[serde(default)]
    pub published_snapshot: Option<Value>,
}

fn snapshot_context(
    settings: &Settings,
    expected: &PilotExpectedContext,
) -> Result<PilotContext, PilotBridgeError> {
    let server_url = settings.server_url.trim();
    let bearer_token = settings.bearer_token.trim();
    let crewing_id = settings.crewing_id.trim();
    if server_url.is_empty() || bearer_token.is_empty() || crewing_id.is_empty() {
        return Err(PilotBridgeError::invalid_context("pilot_not_configured"));
    }
    if server_url != expected.server_url.trim()
        || bearer_token != expected.bearer_token.trim()
        || crewing_id != expected.crewing_id.trim()
    {
        return Err(PilotBridgeError::invalid_context("settings_changed"));
    }
    Ok(PilotContext {
        server_url: server_url.to_string(),
        bearer_token: bearer_token.to_string(),
        crewing_id: crewing_id.to_string(),
    })
}

fn context_from_state(
    state: tauri::State<'_, AppState>,
    expected: &PilotExpectedContext,
) -> Result<PilotContext, PilotBridgeError> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| PilotBridgeError::invalid_context("settings_unavailable"))?;
    snapshot_context(&settings, expected)
}

fn client() -> Result<Client, PilotBridgeError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(Policy::none())
        .build()
        .map_err(|_| PilotBridgeError::new("client_unavailable"))
}

fn base_url(context: &PilotContext) -> Result<Url, PilotBridgeError> {
    let mut url = Url::parse(context.server_url.trim())
        .map_err(|_| PilotBridgeError::invalid_context("invalid_server_url"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(PilotBridgeError::invalid_context("invalid_server_url"));
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn fixed_url(context: &PilotContext, segments: &[&str]) -> Result<Url, PilotBridgeError> {
    let mut url = base_url(context)?;
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| PilotBridgeError::invalid_context("invalid_server_url"))?;
        path.pop_if_empty();
        path.extend(["api", "crewings", context.crewing_id.as_str()]);
        path.extend(segments.iter().copied());
    }
    Ok(url)
}

fn safe_detail(value: &Value) -> Option<String> {
    let detail = value.get("detail")?.as_str()?;
    const SAFE: &[&str] = &[
        "Not Found",
        "not authorised for this crewing",
        "token does not belong to this crewing",
        "intake alias not found",
        "candidate intake not found",
        "body must be a JSON object",
        "request body exceeds the configured ceiling",
        "raw object exceeds the configured ceiling",
        "content_base64 is not valid base64",
        "content_base64 decodes to no bytes",
        "either alias or source_id is required",
        "alias and source_id are mutually exclusive",
        "event already accepted with different content",
        "matching profile not found",
        "limit_above_ceiling",
        "limit_not_a_number",
        "intake is not in a state this build can serve",
        "token missing",
        "token invalid",
        "token revoked",
        "token inactive",
        "token expired",
        "token scope denied",
        "crewing not found",
        // C3b-2 domain codes (contract §5): facts
        "fact_no_source_object",
        "fact_no_uncertainty",
        "fact_no_actor",
        "fact_unknown_key",
        "fact_shape",
        // C3b-2 domain codes (contract §5): shortlist
        "rank_not_found",
        "profile_not_active",
        "profile_version_stale",
        "already_confirmed",
        "confirmation_no_actor",
        "not_confirmed",
        "already_withdrawn",
        "withdraw_not_permitted",
        // P2/S1 publication. Two refusals that share a 422 and differ only by
        // their words, so the card can tell the operator WHICH field is
        // missing instead of "something is wrong".
        "publication needs a rank on the profile",
        "publication needs a vessel type on the profile",
    ];
    SAFE.contains(&detail).then(|| detail.to_string())
}

fn perform(
    context: &PilotContext,
    method: Method,
    url: Url,
    body: Option<Value>,
    ambiguous_on_network: bool,
) -> Result<(StatusCode, Vec<u8>), PilotBridgeError> {
    let client = client()?;
    let mut request: RequestBuilder = client
        .request(method, url)
        .bearer_auth(&context.bearer_token)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().map_err(|_| {
        let mut err = PilotBridgeError::new("network");
        err.ambiguous = ambiguous_on_network;
        err
    })?;
    let status = response.status();
    let bytes = response.bytes().map(|body| body.to_vec()).map_err(|_| {
        let mut err = PilotBridgeError::new("network");
        err.ambiguous = ambiguous_on_network;
        err
    })?;
    if !status.is_success() {
        let parsed = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
        let mut err = PilotBridgeError::new(if status.is_redirection() {
            "redirect_refused"
        } else {
            "server"
        });
        err.status = Some(status.as_u16());
        err.detail = safe_detail(&parsed);
        return Err(err);
    }
    Ok((status, bytes))
}

fn send<T: DeserializeOwned>(
    context: &PilotContext,
    method: Method,
    url: Url,
    body: Option<Value>,
    ambiguous_on_network: bool,
) -> Result<(StatusCode, T), PilotBridgeError> {
    let (status, bytes) = perform(context, method, url, body, ambiguous_on_network)?;
    serde_json::from_slice(&bytes)
        .map(|value| (status, value))
        .map_err(|_| {
            let mut err = PilotBridgeError::new("malformed_response");
            err.status = Some(status.as_u16());
            err.ambiguous = ambiguous_on_network;
            err
        })
}

/// Typed no-content write (C3b-2). The ONLY success is an exact `204` with an
/// empty body: that is the documented shape of shortlist withdraw. Any other
/// successful status, or a 204 that carries bytes, is not the documented
/// acknowledgement and stays ambiguous (`unexpected_success`) so the screen
/// keeps the outcome UNKNOWN instead of inventing a success. Refusals and
/// network failures follow the same policy as `send`.
fn send_no_content(
    context: &PilotContext,
    method: Method,
    url: Url,
) -> Result<(), PilotBridgeError> {
    let (status, bytes) = perform(context, method, url, None, true)?;
    if status == StatusCode::NO_CONTENT && bytes.is_empty() {
        return Ok(());
    }
    let mut err = PilotBridgeError::new("unexpected_success");
    err.status = Some(status.as_u16());
    err.ambiguous = true;
    Err(err)
}

fn alias_url(context: &PilotContext, tail: &[&str]) -> Result<Url, PilotBridgeError> {
    let mut segments = vec!["intake-aliases"];
    segments.extend_from_slice(tail);
    fixed_url(context, &segments)
}

fn candidate_url(context: &PilotContext) -> Result<Url, PilotBridgeError> {
    fixed_url(context, &["candidate-intake"])
}

fn alias_transition(
    context: &PilotContext,
    alias_id: &str,
    action: &str,
) -> Result<IntakeAliasPublic, PilotBridgeError> {
    if alias_id.trim().is_empty() {
        return Err(PilotBridgeError::invalid_context("alias_id_required"));
    }
    let url = alias_url(context, &[alias_id.trim(), action])?;
    let (_, response) = send(context, Method::POST, url, Some(json!({})), true)?;
    Ok(response)
}

async fn without_blocking_ui<T, F>(operation: F) -> Result<T, PilotBridgeError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, PilotBridgeError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| PilotBridgeError::new("request_task_failed"))?
}

#[tauri::command]
pub(crate) async fn crewing_intake_alias_list(
    expected_context: PilotExpectedContext,
    state: tauri::State<'_, AppState>,
) -> Result<IntakeAliasListResponse, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let (_, response) = send(
            &context,
            Method::GET,
            alias_url(&context, &[])?,
            None,
            false,
        )?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_alias_create(
    expected_context: PilotExpectedContext,
    label: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<IntakeAliasIssued, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let label = label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    without_blocking_ui(move || {
        let (_, response) = send(
            &context,
            Method::POST,
            alias_url(&context, &[])?,
            Some(json!({ "label": label })),
            true,
        )?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_alias_rotate(
    expected_context: PilotExpectedContext,
    alias_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<IntakeAliasIssued, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    if alias_id.trim().is_empty() {
        return Err(PilotBridgeError::invalid_context("alias_id_required"));
    }
    without_blocking_ui(move || {
        let url = alias_url(&context, &[alias_id.trim(), "rotate"])?;
        let (_, response) = send(&context, Method::POST, url, Some(json!({})), true)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_alias_pause(
    expected_context: PilotExpectedContext,
    alias_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<IntakeAliasPublic, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || alias_transition(&context, &alias_id, "pause")).await
}

#[tauri::command]
pub(crate) async fn crewing_intake_alias_resume(
    expected_context: PilotExpectedContext,
    alias_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<IntakeAliasPublic, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || alias_transition(&context, &alias_id, "resume")).await
}

#[tauri::command]
pub(crate) async fn crewing_intake_alias_revoke(
    expected_context: PilotExpectedContext,
    alias_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<IntakeAliasPublic, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || alias_transition(&context, &alias_id, "revoke")).await
}

#[tauri::command]
pub(crate) async fn crewing_intake_candidate_submit(
    expected_context: PilotExpectedContext,
    request: CandidateIntakeSubmit,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateSubmitResult, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let alias = request
        .alias
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let source_id = request
        .source_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if alias.is_some() == source_id.is_some()
        || request.event_id.trim().is_empty()
        || request.content_type.trim().is_empty()
        || request.content_base64.is_empty()
    {
        return Err(PilotBridgeError::invalid_context("invalid_upload_shape"));
    }
    let decoded = BASE64_STANDARD
        .decode(request.content_base64.as_bytes())
        .map_err(|_| PilotBridgeError::invalid_context("invalid_upload_shape"))?;
    if decoded.is_empty() || decoded.len() > PILOT_MAX_FILE_BYTES {
        return Err(PilotBridgeError::invalid_context("invalid_upload_shape"));
    }
    without_blocking_ui(move || {
        let body = json!({
            "alias": alias,
            "source_id": source_id,
            "event_id": request.event_id,
            "content_type": request.content_type,
            "content_base64": request.content_base64,
        });
        let (status, receipt) = send(
            &context,
            Method::POST,
            candidate_url(&context)?,
            Some(body),
            true,
        )?;
        Ok(CandidateSubmitResult {
            created: status == StatusCode::CREATED,
            receipt,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_candidate_list(
    expected_context: PilotExpectedContext,
    limit: u32,
    offset: u32,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateIntakeListResponse, PilotBridgeError> {
    if limit == 0 || limit > 200 {
        return Err(PilotBridgeError::invalid_context("limit_above_ceiling"));
    }
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let mut url = candidate_url(&context)?;
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string())
            .append_pair("offset", &offset.to_string());
        let (_, response) = send(&context, Method::GET, url, None, false)?;
        Ok(response)
    })
    .await
}

// ---------------- C3b-2 typed operations (nine fixed commands) ----------------

fn intake_url(
    context: &PilotContext,
    intake_id: &str,
    tail: &[&str],
) -> Result<Url, PilotBridgeError> {
    let intake_id = intake_id.trim();
    if intake_id.is_empty() {
        return Err(PilotBridgeError::invalid_context("intake_id_required"));
    }
    let mut segments = vec!["candidate-intake", intake_id];
    segments.extend_from_slice(tail);
    fixed_url(context, &segments)
}

fn invalid_request(detail: &str) -> PilotBridgeError {
    let mut err = PilotBridgeError::new("invalid_request");
    err.detail = Some(detail.to_string());
    err
}

fn checked_fact(fact: CandidateFactSubmit) -> Result<Value, PilotBridgeError> {
    let field = fact.field.trim().to_string();
    if field.is_empty()
        || field.chars().count() > FACT_MAX_FIELD_CHARS
        || field
            .chars()
            .any(|c| matches!(c, '\0' | '\r' | '\n' | '\t'))
    {
        return Err(invalid_request("invalid_fact_field"));
    }
    if fact.value.chars().count() > FACT_MAX_VALUE_CHARS || fact.value.contains('\0') {
        return Err(invalid_request("invalid_fact_value"));
    }
    let source_object = fact.source_object.trim().to_string();
    if source_object.is_empty() || source_object.chars().count() > FACT_MAX_SOURCE_OBJECT_CHARS {
        return Err(invalid_request("invalid_fact_source_object"));
    }
    if matches!(fact.page, Some(page) if page < 0) {
        return Err(invalid_request("invalid_fact_page"));
    }
    if matches!(&fact.span, Some(span) if span.chars().count() > FACT_MAX_SPAN_CHARS) {
        return Err(invalid_request("invalid_fact_span"));
    }
    // No confidence / uncertainty / actor: the operator route sets them itself.
    Ok(json!({
        "field": field,
        "value": fact.value,
        "source_object": source_object,
        "page": fact.page,
        "span": fact.span,
    }))
}

fn checked_pair(pair: &ShortlistPair) -> Result<(String, String), PilotBridgeError> {
    let profile_id = pair.profile_id.trim().to_string();
    if profile_id.is_empty() || profile_id.chars().count() > PROFILE_ID_MAX_CHARS {
        return Err(invalid_request("invalid_profile_id"));
    }
    if pair.profile_version < 1 {
        return Err(invalid_request("invalid_profile_version"));
    }
    Ok((profile_id, pair.profile_version.to_string()))
}

#[tauri::command]
pub(crate) async fn crewing_intake_candidate_get(
    expected_context: PilotExpectedContext,
    intake_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateIntakeReceipt, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &[])?;
        let (_, response) = send(&context, Method::GET, url, None, false)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_fact_list(
    expected_context: PilotExpectedContext,
    intake_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateFactListResponse, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &["facts"])?;
        let (_, response) = send(&context, Method::GET, url, None, false)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_fact_record(
    expected_context: PilotExpectedContext,
    intake_id: String,
    fact: CandidateFactSubmit,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateFact, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let body = checked_fact(fact)?;
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &["facts"])?;
        let (_, response) = send(&context, Method::POST, url, Some(body), true)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_fact_correct(
    expected_context: PilotExpectedContext,
    intake_id: String,
    field: String,
    fact: CandidateFactSubmit,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateFact, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let field = field.trim().to_string();
    if field.is_empty() || field != fact.field.trim() {
        return Err(invalid_request("correction_field_mismatch"));
    }
    let body = checked_fact(fact)?;
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &["facts", field.as_str(), "correct"])?;
        let (_, response) = send(&context, Method::POST, url, Some(body), true)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_candidate_rank(
    expected_context: PilotExpectedContext,
    intake_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateRankResponse, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &["rank"])?;
        let (_, response) = send(&context, Method::POST, url, Some(json!({})), true)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_rank_list(
    expected_context: PilotExpectedContext,
    intake_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateRanksResponse, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &["ranks"])?;
        let (_, response) = send(&context, Method::GET, url, None, false)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_shortlist_confirm(
    expected_context: PilotExpectedContext,
    intake_id: String,
    pair: ShortlistPair,
    state: tauri::State<'_, AppState>,
) -> Result<ShortlistConfirmation, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let (profile_id, _version) = checked_pair(&pair)?;
    let body = json!({ "profile_id": profile_id, "profile_version": pair.profile_version });
    without_blocking_ui(move || {
        let url = intake_url(&context, &intake_id, &["shortlist"])?;
        let (_, response) = send(&context, Method::POST, url, Some(body), true)?;
        Ok(response)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_shortlist_withdraw(
    expected_context: PilotExpectedContext,
    intake_id: String,
    pair: ShortlistPair,
    state: tauri::State<'_, AppState>,
) -> Result<(), PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let (profile_id, version) = checked_pair(&pair)?;
    without_blocking_ui(move || {
        let url = intake_url(
            &context,
            &intake_id,
            &["shortlist", profile_id.as_str(), version.as_str()],
        )?;
        send_no_content(&context, Method::DELETE, url)
    })
    .await
}

#[tauri::command]
pub(crate) async fn crewing_intake_matching_profile_list(
    expected_context: PilotExpectedContext,
    state: tauri::State<'_, AppState>,
) -> Result<MatchingProfileListResponse, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let mut url = fixed_url(&context, &["matching-profiles"])?;
        url.query_pairs_mut()
            .append_pair("include_archived", "true");
        let (_, response) = send(&context, Method::GET, url, None, false)?;
        Ok(response)
    })
    .await
}

/// P2/S1: publish the profile, or take it off publication. ONE button.
///
/// `published` is the whole payload: the server owns the two words and the
/// frozen snapshot, and a client that posted a state string would be a second
/// place where the vocabulary lives.
///
/// `ambiguous_on_network = true` for the same reason every other write here
/// sets it: a request that died on the wire may or may not have been applied,
/// and the card has to say UNKNOWN rather than pick an answer.
#[tauri::command]
pub(crate) async fn crewing_intake_matching_profile_publication(
    expected_context: PilotExpectedContext,
    profile_id: String,
    published: bool,
    state: tauri::State<'_, AppState>,
) -> Result<MatchingProfilePublication, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err(invalid_request("profile_id_missing"));
    }
    let body = json!({ "published": published });
    without_blocking_ui(move || {
        let url = fixed_url(
            &context,
            &["matching-profiles", profile_id.as_str(), "publication"],
        )?;
        let (_, response) = send(&context, Method::POST, url, Some(body), true)?;
        Ok(response)
    })
    .await
}

// ---------------- K2.1 audited byte routes (OWNER (739) п.2) ----------------
// The original letter and its attachments are reachable FROM THE CARD. They are
// never part of the card read: one press, one audited request on the server, one
// copy written under Downloads/Skipi/Crewing/<intake8>/. The copies have no
// retention and no auto-cleanup, and an .eml carries personal data of people
// other than the candidate (RISKS №491) — that is said to the owner, not hidden.

/// Hard ceiling regardless of what the card claims; 32 MiB is far above any CV
/// and far below anything that could exhaust the machine.
const DOWNLOAD_CEILING_BYTES: u64 = 32 * 1024 * 1024;
/// Only the header part of an .eml is ever handed to the screen.
const LETTER_HEAD_MAX_BYTES: usize = 32 * 1024;

fn saved_root() -> Result<std::path::PathBuf, PilotBridgeError> {
    let base = dirs::download_dir().ok_or_else(|| invalid_request("no_downloads_dir"))?;
    Ok(base.join("Skipi").join("Crewing"))
}

/// The server chooses the filename; the client still treats it as hostile input.
/// Path separators, `..`, control characters and non-ASCII become `_`, so a
/// `Content-Disposition` can never write outside the intake folder.
fn safe_download_name(raw: &str, fallback: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        let ok = ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-');
        out.push(if ok { ch } else { '_' });
    }
    let trimmed = out.trim_matches('_').trim_matches('.').to_string();
    if trimmed.is_empty() || trimmed.contains("..") || trimmed.len() > 120 {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn filename_from_disposition(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    let at = lower.find("filename=")?;
    let tail = value[at + "filename=".len()..].trim();
    let name = if let Some(stripped) = tail.strip_prefix('"') {
        stripped.split('"').next().unwrap_or("")
    } else {
        tail.split(';').next().unwrap_or("").trim()
    };
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Byte fetch for the two audited routes. A sibling of `perform`, not a reuse of
/// it: the JSON path insists on `Accept: application/json` and throws the
/// response headers away, while here the server-chosen filename lives in
/// `Content-Disposition` and the body is not JSON at all.
fn fetch_bytes(
    context: &PilotContext,
    url: Url,
    ceiling: u64,
) -> Result<(Vec<u8>, Option<String>), PilotBridgeError> {
    let client = client()?;
    let response = client
        .request(Method::GET, url)
        .bearer_auth(&context.bearer_token)
        .header(reqwest::header::ACCEPT, "*/*")
        .send()
        .map_err(|_| PilotBridgeError::new("network"))?;
    let status = response.status();
    let disposition = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    if !status.is_success() {
        let mut err = PilotBridgeError::new(if status.is_redirection() {
            "redirect_refused"
        } else {
            "server"
        });
        err.status = Some(status.as_u16());
        return Err(err);
    }
    let bytes = response
        .bytes()
        .map_err(|_| PilotBridgeError::new("network"))?
        .to_vec();
    if bytes.len() as u64 > ceiling {
        return Err(invalid_request("payload_above_ceiling"));
    }
    Ok((
        bytes,
        disposition.as_deref().and_then(filename_from_disposition),
    ))
}

/// The card's own `content_bytes` may lower the ceiling, never raise it.
fn download_ceiling(expected_bytes: Option<u64>) -> u64 {
    match expected_bytes {
        Some(bytes) if bytes > 0 => bytes.min(DOWNLOAD_CEILING_BYTES),
        _ => DOWNLOAD_CEILING_BYTES,
    }
}

fn write_saved_copy(
    intake_id: &str,
    name: &str,
    bytes: &[u8],
) -> Result<CandidateIntakeDownload, PilotBridgeError> {
    use sha2::{Digest, Sha256};
    let folder = saved_root()?.join(safe_download_name(
        intake_id.get(..8).unwrap_or(intake_id),
        "intake",
    ));
    std::fs::create_dir_all(&folder).map_err(|_| invalid_request("cannot_create_folder"))?;
    let target = folder.join(name);
    std::fs::write(&target, bytes).map_err(|_| invalid_request("cannot_write_file"))?;
    let digest = Sha256::digest(bytes);
    Ok(CandidateIntakeDownload {
        path: target.to_string_lossy().to_string(),
        bytes: bytes.len() as u64,
        sha256: digest.iter().map(|b| format!("{:02x}", b)).collect(),
        head_text: None,
    })
}

/// The header part of an .eml: everything before the first empty line, capped at
/// 32 KB. A header-looking line in the BODY is therefore never read as a header.
fn letter_head_text(bytes: &[u8]) -> String {
    let window = &bytes[..bytes.len().min(LETTER_HEAD_MAX_BYTES)];
    let mut cut = window.len();
    for index in 0..window.len() {
        if window[index..].starts_with(b"\r\n\r\n") || window[index..].starts_with(b"\n\n") {
            cut = index;
            break;
        }
    }
    String::from_utf8_lossy(&window[..cut]).to_string()
}

/// Both sides are canonicalized, so a symlink pointing out of the folder resolves
/// to its target and is refused. A path that does not exist is an error, never a
/// silently created file (the sqlite-on-prod lesson, 2026-09-18).
fn resolved_saved_path(
    root: &std::path::Path,
    input: &str,
) -> Result<std::path::PathBuf, PilotBridgeError> {
    if input.trim().is_empty() {
        return Err(invalid_request("path_required"));
    }
    let root = std::fs::canonicalize(root).map_err(|_| invalid_request("downloads_root_missing"))?;
    let candidate = std::fs::canonicalize(std::path::Path::new(input))
        .map_err(|_| invalid_request("path_not_found"))?;
    if candidate == root || !candidate.starts_with(&root) {
        return Err(invalid_request("path_outside_downloads"));
    }
    if !candidate.is_file() {
        return Err(invalid_request("path_not_a_file"));
    }
    Ok(candidate)
}

#[tauri::command]
pub(crate) async fn crewing_intake_object_download(
    expected_context: PilotExpectedContext,
    intake_id: String,
    object_id: String,
    expected_bytes: Option<u64>,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateIntakeDownload, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        let object = object_id.trim();
        if object.is_empty() {
            return Err(invalid_request("object_id_required"));
        }
        let url = intake_url(&context, &intake_id, &["objects", object])?;
        let (bytes, disposition) = fetch_bytes(&context, url, download_ceiling(expected_bytes))?;
        let name = safe_download_name(
            disposition.as_deref().unwrap_or("letter.eml"),
            "letter.eml",
        );
        let mut saved = write_saved_copy(&intake_id, &name, &bytes)?;
        saved.head_text = Some(letter_head_text(&bytes));
        Ok(saved)
    })
    .await
}

/// The attachment ordinal as the server counts it: FROM ZERO. Server
/// `_ordinal_or_404`: "the floor is 0, not 1 - attachments are counted from
/// zero"; `docs/crewing-baseline/c3a-api-contract.md` §attachments (rows
/// "ordered by `ordinal`", the receipt of a one-attachment letter carries
/// `ordinal: 0`). The bound is a pure function so a unit test can hold it
/// against that contract without a Tauri runtime: K2.1 shipped with a floor
/// of 1, and the first — often the only — attachment of every letter was
/// refused as `ordinal_out_of_range` while `GET /attachments/0` answered 200
/// with the bytes (BACKLOG №504, 2026-09-27).
fn checked_attachment_ordinal(ordinal: i64) -> Result<i64, PilotBridgeError> {
    if ordinal < 0 || ordinal > 9999 {
        return Err(invalid_request("ordinal_out_of_range"));
    }
    Ok(ordinal)
}

/// The whole attachment download as ONE sync function, so a unit test can drive
/// it against a real request line (`TcpListener`) without a Tauri runtime — the
/// same separation as `open_saved_with`. Before №504-b the body lived inside the
/// command's closure, and the only oracles were the pure bound above plus a regex
/// over the source: a `+ 1` slipped in after the check, or the old `< 1` guard
/// put back after the checked call, survived both (skipi-ops BACKLOG №504-b,
/// 2026-09-27). The command below is a pass-through and adds nothing of its own.
fn download_attachment(
    context: &PilotContext,
    intake_id: &str,
    ordinal: i64,
    expected_bytes: Option<u64>,
) -> Result<CandidateIntakeDownload, PilotBridgeError> {
    let ordinal = checked_attachment_ordinal(ordinal)?;
    let url = intake_url(context, intake_id, &["attachments", &ordinal.to_string()])?;
    let (bytes, disposition) = fetch_bytes(context, url, download_ceiling(expected_bytes))?;
    let fallback = format!("attachment-{}.bin", ordinal);
    let name = safe_download_name(disposition.as_deref().unwrap_or(&fallback), &fallback);
    write_saved_copy(intake_id, &name, &bytes)
}

#[tauri::command]
pub(crate) async fn crewing_intake_attachment_download(
    expected_context: PilotExpectedContext,
    intake_id: String,
    ordinal: i64,
    expected_bytes: Option<u64>,
    state: tauri::State<'_, AppState>,
) -> Result<CandidateIntakeDownload, PilotBridgeError> {
    let context = context_from_state(state, &expected_context)?;
    without_blocking_ui(move || {
        download_attachment(&context, &intake_id, ordinal, expected_bytes)
    })
    .await
}

/// The guard and the opener are separated on purpose: the guard can then be
/// measured with the side effect STUBBED, so a drill that removes the check fails
/// a test instead of opening a file on the machine running the drill (skipi-ops
/// AGENTS, «Субагенты» п.6). The home already knows how to hand a file to the
/// desktop (`lib.rs open_with_default_app`: xdg-open / open / cmd start); K2.1
/// adds the guard in front of it, not a second opener.
fn open_saved_with<F>(
    root: &std::path::Path,
    path: &str,
    opener: F,
) -> Result<(), PilotBridgeError>
where
    F: Fn(&str) -> Result<(), String>,
{
    let resolved = resolved_saved_path(root, path)?;
    opener(&resolved.to_string_lossy()).map_err(|_| invalid_request("cannot_open_file"))
}

/// Opens a copy this app wrote, and nothing else: the path must resolve INSIDE
/// `Downloads/Skipi/Crewing`. Without that check the screen would be a generic
/// "open any file on this machine" command for whoever can reach the bridge.
#[tauri::command]
pub(crate) async fn crewing_intake_open_saved(path: String) -> Result<(), PilotBridgeError> {
    without_blocking_ui(move || {
        let root = saved_root()?;
        open_saved_with(&root, &path, crate::open_with_default_app)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn settings(server_url: &str) -> Settings {
        Settings {
            server_url: server_url.to_string(),
            bearer_token: "synthetic-token".to_string(),
            crewing_id: "crew-test".to_string(),
            ..Default::default()
        }
    }

    fn expected(server_url: &str) -> PilotExpectedContext {
        PilotExpectedContext {
            server_url: server_url.to_string(),
            bearer_token: "synthetic-token".to_string(),
            crewing_id: "crew-test".to_string(),
        }
    }

    #[test]
    fn expected_context_must_match_all_three_settings() {
        let current = settings("http://127.0.0.1:9");
        assert!(snapshot_context(&current, &expected("http://127.0.0.1:9")).is_ok());
        let mut changed = expected("http://127.0.0.1:9");
        changed.bearer_token = "other".to_string();
        assert_eq!(
            snapshot_context(&current, &changed).unwrap_err().detail,
            Some("settings_changed".to_string())
        );
        let mut changed = expected("http://127.0.0.1:10");
        changed.server_url = "http://127.0.0.1:10".to_string();
        assert_eq!(
            snapshot_context(&current, &changed).unwrap_err().detail,
            Some("settings_changed".to_string())
        );
        let mut changed = expected("http://127.0.0.1:9");
        changed.crewing_id = "other-crew".to_string();
        assert_eq!(
            snapshot_context(&current, &changed).unwrap_err().detail,
            Some("settings_changed".to_string())
        );
    }

    #[test]
    fn missing_settings_refuse_before_client_creation() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut current = settings(&base);
        current.bearer_token.clear();
        assert_eq!(
            snapshot_context(&current, &expected(&base))
                .unwrap_err()
                .detail,
            Some("pilot_not_configured".to_string())
        );
        thread::sleep(Duration::from_millis(50));
        assert!(
            listener.accept().is_err(),
            "missing config must refuse with zero network dispatches"
        );
    }

    #[test]
    fn fixed_paths_percent_encode_ids() {
        let context = snapshot_context(
            &settings("http://127.0.0.1:9"),
            &expected("http://127.0.0.1:9"),
        )
        .unwrap();
        let url = alias_url(&context, &["id/with space", "rotate"]).unwrap();
        assert_eq!(
            url.path(),
            "/api/crewings/crew-test/intake-aliases/id%2Fwith%20space/rotate"
        );
    }

    #[test]
    fn redirects_are_refused_without_contacting_target() {
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let target_addr = target.local_addr().unwrap();

        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        let source_addr = source.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = source.accept().unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nLocation: http://{target_addr}/captured\r\nContent-Length: 0\r\n\r\n"
            )
            .unwrap();
        });

        let base = format!("http://{source_addr}");
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let result: Result<(StatusCode, Value), PilotBridgeError> = send(
            &context,
            Method::GET,
            alias_url(&context, &[]).unwrap(),
            None,
            false,
        );
        server.join().unwrap();
        let err = result.unwrap_err();
        assert_eq!(err.kind, "redirect_refused");
        assert_eq!(err.status, Some(302));
        thread::sleep(Duration::from_millis(50));
        assert!(
            target.accept().is_err(),
            "redirect target must not be contacted"
        );
    }

    #[test]
    fn malformed_success_for_write_is_ambiguous() {
        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        let source_addr = source.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = source.accept().unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 9\r\n\r\n{{not-json"
            )
            .unwrap();
        });

        let base = format!("http://{source_addr}");
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let result: Result<(StatusCode, Value), PilotBridgeError> = send(
            &context,
            Method::POST,
            alias_url(&context, &[]).unwrap(),
            Some(json!({"label":"synthetic"})),
            true,
        );
        server.join().unwrap();
        let err = result.unwrap_err();
        assert_eq!(err.kind, "malformed_response");
        assert_eq!(err.status, Some(200));
        assert!(err.ambiguous, "a malformed 2xx write outcome is ambiguous");
    }

    // ---------------- C3b-2 native unit tests ----------------

    fn one_shot_server(reply: String) -> (String, thread::JoinHandle<Vec<u8>>) {
        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        let source_addr = source.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = source.accept().unwrap();
            let mut request = [0_u8; 4096];
            let read = stream.read(&mut request).unwrap_or(0);
            write!(stream, "{reply}").unwrap();
            request[..read].to_vec()
        });
        (format!("http://{source_addr}"), server)
    }

    fn json_reply(status_line: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    fn pair(version: i64) -> ShortlistPair {
        ShortlistPair {
            profile_id: "profile-a".to_string(),
            profile_version: version,
        }
    }

    // ---- R2 (OWNER 2026-09-29): the queue row reads the stored outcome from the
    // list response, so CandidateIntakeSummary must carry it — and must keep
    // "the server did not send the field" distinguishable from "the server says
    // there are none". Collapsing those two makes an unanswered question look
    // like an answer on the operator's screen.
    #[test]
    fn summary_without_profile_ranks_parses_and_stays_unanswered() {
        let json = r#"{"state":"ranked","facts":3,"ranks":1,"ranks_stale":0,
            "active_confirmations":0,"needs_review_reason":null}"#;
        let summary: CandidateIntakeSummary =
            serde_json::from_str(json).expect("a server build without the field must still parse");
        assert!(
            summary.profile_ranks.is_none(),
            "a missing field is None (unanswered), never an empty list (answered)"
        );
    }

    #[test]
    fn summary_with_empty_profile_ranks_is_an_answer() {
        let json = r#"{"state":"ranked","facts":3,"ranks":0,"ranks_stale":0,
            "active_confirmations":0,"needs_review_reason":null,"profile_ranks":[]}"#;
        let summary: CandidateIntakeSummary = serde_json::from_str(json).unwrap();
        assert_eq!(
            summary.profile_ranks,
            Some(Vec::new()),
            "an empty list is the server saying there are no stored evaluations"
        );
    }

    #[test]
    fn summary_profile_rank_row_carries_the_frozen_contract() {
        let json = r#"{"state":"ranked","facts":3,"ranks":1,"ranks_stale":0,
            "active_confirmations":0,"needs_review_reason":null,
            "profile_ranks":[{"profile_id":"p-main","profile_version":2,"met":2,
              "missing":1,"unconfirmed":3,"unknown":0,"stale":true}]}"#;
        let summary: CandidateIntakeSummary = serde_json::from_str(json).unwrap();
        let rows = summary.profile_ranks.expect("present");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.profile_id, "p-main");
        assert_eq!(row.profile_version, 2);
        assert_eq!((row.met, row.missing, row.unconfirmed, row.unknown), (2, 1, 3, 0));
        assert!(row.stale, "stale travels as a bool, exactly as the contract says");
    }

    #[test]
    fn withdraw_expected_empty_204_is_ack() {
        let (base, server) =
            one_shot_server("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".to_string());
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let (profile_id, version) = checked_pair(&pair(1)).unwrap();
        let url = intake_url(&context, "intake-1", &["shortlist", &profile_id, &version]).unwrap();
        let result = send_no_content(&context, Method::DELETE, url);
        let request = String::from_utf8_lossy(&server.join().unwrap()).to_string();
        assert!(
            result.is_ok(),
            "an exact empty 204 is the documented withdraw ACK"
        );
        assert!(
            request.starts_with(
                "DELETE /api/crewings/crew-test/candidate-intake/intake-1/shortlist/profile-a/1 "
            ),
            "withdraw uses the fixed DELETE path: {request}"
        );
        assert!(
            !request.contains("Content-Type: application/json"),
            "withdraw sends no JSON request body"
        );
    }

    #[test]
    fn withdraw_unexpected_empty_200_stays_ambiguous() {
        let (base, server) =
            one_shot_server("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_string());
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let url = intake_url(&context, "intake-1", &["shortlist", "profile-a", "1"]).unwrap();
        let err = send_no_content(&context, Method::DELETE, url).unwrap_err();
        server.join().unwrap();
        assert_eq!(err.kind, "unexpected_success");
        assert_eq!(err.status, Some(200));
        assert!(
            err.ambiguous,
            "a success that is not the documented 204 is UNKNOWN, not ACK"
        );
    }

    #[test]
    fn withdraw_200_with_json_body_stays_ambiguous() {
        // reqwest discards any body of a 204 by specification, so "204 with
        // bytes" is not observable through this client; the observable
        // neighbour is a 2xx that is not 204 and carries a body.
        let (base, server) = one_shot_server(json_reply("200 OK", "{}"));
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let url = intake_url(&context, "intake-1", &["shortlist", "profile-a", "1"]).unwrap();
        let err = send_no_content(&context, Method::DELETE, url).unwrap_err();
        server.join().unwrap();
        assert_eq!(err.kind, "unexpected_success");
        assert!(err.ambiguous);
    }

    #[test]
    fn withdraw_documented_403_keeps_refusal_code() {
        let (base, server) = one_shot_server(json_reply(
            "403 Forbidden",
            "{\"detail\":\"withdraw_not_permitted\"}",
        ));
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let url = intake_url(&context, "intake-1", &["shortlist", "profile-a", "1"]).unwrap();
        let err = send_no_content(&context, Method::DELETE, url).unwrap_err();
        server.join().unwrap();
        assert_eq!(err.kind, "server");
        assert_eq!(err.status, Some(403));
        assert_eq!(err.detail, Some("withdraw_not_permitted".to_string()));
        assert!(
            !err.ambiguous,
            "a documented refusal is a refusal, never UNKNOWN"
        );
    }

    #[test]
    fn typed_reads_still_refuse_an_empty_204() {
        let (base, server) =
            one_shot_server("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n".to_string());
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let url = intake_url(&context, "intake-1", &["ranks"]).unwrap();
        let result: Result<(StatusCode, CandidateRanksResponse), PilotBridgeError> =
            send(&context, Method::GET, url, None, false);
        server.join().unwrap();
        let err = result.unwrap_err();
        assert_eq!(
            err.kind, "malformed_response",
            "the JSON decoder of typed commands is not loosened"
        );
        assert!(
            !err.ambiguous,
            "an empty read is a read failure, not a write ambiguity"
        );
    }

    #[test]
    fn rank_posts_an_empty_json_object() {
        let (base, server) = one_shot_server(json_reply(
            "200 OK",
            "{\"ranked\":0,\"written\":0,\"reason\":\"no_active_profiles\",\"profiles\":[]}",
        ));
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let url = intake_url(&context, "intake-1", &["rank"]).unwrap();
        let result: Result<(StatusCode, CandidateRankResponse), PilotBridgeError> =
            send(&context, Method::POST, url, Some(json!({})), true);
        let request = String::from_utf8_lossy(&server.join().unwrap()).to_string();
        let (_, parsed) = result.unwrap();
        assert!(
            request.starts_with("POST /api/crewings/crew-test/candidate-intake/intake-1/rank "),
            "{request}"
        );
        assert!(
            request.ends_with("\r\n\r\n{}"),
            "rank body is exactly {{}}: {request}"
        );
        assert_eq!(parsed.reason, "no_active_profiles");
        assert_eq!(parsed.ranked, 0);
    }

    #[test]
    fn correction_path_encodes_every_segment() {
        let context = snapshot_context(
            &settings("http://127.0.0.1:9"),
            &expected("http://127.0.0.1:9"),
        )
        .unwrap();
        let url = intake_url(
            &context,
            "in/take",
            &["facts", "certificate:coc master", "correct"],
        )
        .unwrap();
        assert_eq!(
            url.path(),
            "/api/crewings/crew-test/candidate-intake/in%2Ftake/facts/certificate:coc%20master/correct"
        );
        let url = fixed_url(&context, &["matching-profiles"]).unwrap();
        assert_eq!(url.path(), "/api/crewings/crew-test/matching-profiles");
    }

    #[test]
    fn shortlist_pair_and_fact_shape_are_refused_before_any_dispatch() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let _context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        assert_eq!(
            checked_pair(&pair(0)).unwrap_err().detail,
            Some("invalid_profile_version".to_string())
        );
        assert_eq!(
            checked_pair(&pair(-7)).unwrap_err().detail,
            Some("invalid_profile_version".to_string())
        );
        let mut blank = pair(1);
        blank.profile_id = "   ".to_string();
        assert_eq!(
            checked_pair(&blank).unwrap_err().detail,
            Some("invalid_profile_id".to_string())
        );
        let submit =
            |field: &str, value: &str, source: &str, page: Option<i64>, span: Option<&str>| {
                CandidateFactSubmit {
                    field: field.to_string(),
                    value: value.to_string(),
                    source_object: source.to_string(),
                    page,
                    span: span.map(|s| s.to_string()),
                }
            };
        assert_eq!(
            checked_fact(submit("", "x", "obj", None, None))
                .unwrap_err()
                .detail,
            Some("invalid_fact_field".to_string())
        );
        assert_eq!(
            checked_fact(submit("rank", "x", " ", None, None))
                .unwrap_err()
                .detail,
            Some("invalid_fact_source_object".to_string())
        );
        assert_eq!(
            checked_fact(submit("rank", "x", "obj", Some(-1), None))
                .unwrap_err()
                .detail,
            Some("invalid_fact_page".to_string())
        );
        assert_eq!(
            checked_fact(submit("rank", "x", "obj", None, Some(&"s".repeat(65))))
                .unwrap_err()
                .detail,
            Some("invalid_fact_span".to_string())
        );
        let body = checked_fact(submit("rank", "", "obj", Some(0), None)).unwrap();
        assert_eq!(
            body["value"],
            json!(""),
            "an empty value is a value, not an absence"
        );
        assert_eq!(
            body["page"],
            json!(0),
            "page 0 is a measured page, not null"
        );
        assert!(
            body.get("confidence").is_none()
                && body.get("uncertainty").is_none()
                && body.get("corrected_by").is_none()
        );
        thread::sleep(Duration::from_millis(50));
        assert!(
            listener.accept().is_err(),
            "shape refusals dispatch nothing"
        );
    }

    #[test]
    fn fact_confidence_null_and_zero_stay_distinct_in_the_dto() {
        let null_confidence: CandidateFact = serde_json::from_str(
            "{\"field\":\"rank\",\"value\":\"Master\",\"version\":1,\"source_object\":\"o\",\"page\":null,\"span\":null,\"confidence\":null,\"uncertainty\":\"operator_entered\",\"corrected_by\":\"user-1\",\"created_at\":\"2026-09-23T00:00:00\"}",
        )
        .unwrap();
        let zero_confidence: CandidateFact = serde_json::from_str(
            "{\"field\":\"rank\",\"value\":\"\",\"version\":2,\"source_object\":\"o\",\"page\":0,\"confidence\":0.0,\"created_at\":\"2026-09-23T00:00:00\"}",
        )
        .unwrap();
        assert_eq!(null_confidence.confidence, None);
        assert_eq!(zero_confidence.confidence, Some(0.0));
        assert_eq!(zero_confidence.page, Some(0));
        assert_eq!(zero_confidence.value, "");
        let out = serde_json::to_value(&zero_confidence).unwrap();
        assert_eq!(out["confidence"], json!(0.0));
        assert_eq!(
            serde_json::to_value(&null_confidence).unwrap()["confidence"],
            Value::Null
        );
    }

    #[test]
    fn saved_path_guard_refuses_everything_outside_the_downloads_folder() {
        // The guard is the only thing between "open the copy I just wrote" and
        // "open any file on this machine", so it is measured on real paths,
        // including a symlink that points out of the folder.
        let base = std::env::temp_dir().join(format!(
            "skipi-crewing-k21-{}-{}",
            std::process::id(),
            "guard"
        ));
        let root = base.join("root");
        std::fs::create_dir_all(root.join("intake12")).unwrap();
        let inside = root.join("intake12").join("letter.eml");
        std::fs::write(&inside, b"x").unwrap();
        let outside = base.join("outside.eml");
        std::fs::write(&outside, b"x").unwrap();

        assert_eq!(
            resolved_saved_path(&root, inside.to_str().unwrap()).unwrap(),
            std::fs::canonicalize(&inside).unwrap()
        );
        assert!(resolved_saved_path(&root, outside.to_str().unwrap()).is_err());
        assert!(resolved_saved_path(&root, root.to_str().unwrap()).is_err());
        assert!(resolved_saved_path(&root, "").is_err());
        assert!(resolved_saved_path(
            &root,
            root.join("intake12").join("nope.eml").to_str().unwrap()
        )
        .is_err());
        assert!(resolved_saved_path(
            &root,
            root.join("intake12")
                .join("..")
                .join("..")
                .join("outside.eml")
                .to_str()
                .unwrap()
        )
        .is_err());
        #[cfg(unix)]
        {
            let link = root.join("intake12").join("escape.eml");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(
                resolved_saved_path(&root, link.to_str().unwrap()).is_err(),
                "a symlink out of the folder must resolve and be refused"
            );
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn open_saved_refuses_before_it_opens_anything() {
        // The opener is a stub that records: the point of the test is that a path
        // outside the folder never REACHES it, which a check "returns Err" alone
        // would not prove.
        let base = std::env::temp_dir().join(format!("skipi-crewing-k21-{}-open", std::process::id()));
        let root = base.join("root");
        std::fs::create_dir_all(root.join("intake12")).unwrap();
        let inside = root.join("intake12").join("letter.eml");
        std::fs::write(&inside, b"x").unwrap();
        let outside = base.join("outside.eml");
        std::fs::write(&outside, b"x").unwrap();

        let opened = std::cell::RefCell::new(Vec::new());
        let record = |p: &str| {
            opened.borrow_mut().push(p.to_string());
            Ok(())
        };
        assert!(open_saved_with(&root, inside.to_str().unwrap(), record).is_ok());
        assert_eq!(opened.borrow().len(), 1);
        assert!(opened.borrow()[0].ends_with("letter.eml"));

        assert!(open_saved_with(&root, outside.to_str().unwrap(), record).is_err());
        assert_eq!(
            opened.borrow().len(),
            1,
            "a path outside the downloads folder must never reach the opener"
        );
        assert!(open_saved_with(&root, "/etc/passwd", record).is_err());
        assert_eq!(opened.borrow().len(), 1, "and neither must a system path");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn only_the_header_part_of_an_eml_reaches_the_screen() {
        let raw = b"From: a@b.test\r\nSubject: one\r\n\r\nSubject: forged\r\nbody\r\n";
        let head = letter_head_text(raw);
        assert!(head.contains("Subject: one"));
        assert!(!head.contains("forged"), "{head}");
        let lf = b"From: a@b.test\nSubject: two\n\nbody\n";
        assert!(!letter_head_text(lf).contains("body"));
        assert!(letter_head_text(b"no headers at all").contains("no headers"));
        let long = vec![b'A'; LETTER_HEAD_MAX_BYTES * 2];
        assert_eq!(letter_head_text(&long).len(), LETTER_HEAD_MAX_BYTES);
    }

    #[test]
    fn a_server_filename_can_never_walk_out_of_the_folder() {
        assert_eq!(safe_download_name("letter-3a8bcae3.eml", "f"), "letter-3a8bcae3.eml");
        assert_eq!(safe_download_name("../../etc/passwd", "f"), "f");
        assert_eq!(safe_download_name("/etc/passwd", "f"), "etc_passwd");
        assert_eq!(safe_download_name("", "f"), "f");
        assert_eq!(safe_download_name("..", "f"), "f");
        assert_eq!(safe_download_name("a\0b.pdf", "f"), "a_b.pdf");
        assert_eq!(safe_download_name("резюме.pdf", "f"), "pdf");
        assert_eq!(
            filename_from_disposition("attachment; filename=\"letter-3a8bcae3.eml\""),
            Some("letter-3a8bcae3.eml".to_string())
        );
        assert_eq!(
            filename_from_disposition("attachment; filename=attachment-1.pdf"),
            Some("attachment-1.pdf".to_string())
        );
        assert_eq!(filename_from_disposition("attachment"), None);
    }

    #[test]
    fn the_card_may_lower_the_download_ceiling_never_raise_it() {
        assert_eq!(download_ceiling(None), DOWNLOAD_CEILING_BYTES);
        assert_eq!(download_ceiling(Some(0)), DOWNLOAD_CEILING_BYTES);
        assert_eq!(download_ceiling(Some(512)), 512);
        assert_eq!(
            download_ceiling(Some(DOWNLOAD_CEILING_BYTES * 4)),
            DOWNLOAD_CEILING_BYTES
        );
    }

    #[test]
    fn the_attachment_row_survives_a_receipt_without_the_field() {
        // Old servers (before S3) answer without `attachments`; the screen must
        // read that as "no rows", not as a broken card.
        let receipt: CandidateIntakeReceipt = serde_json::from_str(
            "{\"intake_id\":\"i\",\"receipt_id\":\"r\",\"crewing_id\":\"c\",\"source\":\"desktop\",\"source_id\":\"s\",\"event_id\":\"e\",\"primary_profile_id\":null,\"content_sha256\":\"x\",\"content_bytes\":1,\"content_type\":\"message/rfc822\",\"state\":\"quarantined\",\"source_trust\":\"unverified\",\"version\":1,\"created_at\":\"t\",\"issued_at\":\"t\",\"summary\":null}",
        )
        .unwrap();
        assert!(receipt.attachments.is_empty());
        let with_rows: CandidateIntakeReceipt = serde_json::from_str(
            "{\"intake_id\":\"i\",\"receipt_id\":\"r\",\"crewing_id\":\"c\",\"source\":\"desktop\",\"source_id\":\"s\",\"event_id\":\"e\",\"primary_profile_id\":null,\"content_sha256\":\"x\",\"content_bytes\":1,\"content_type\":\"message/rfc822\",\"state\":\"quarantined\",\"source_trust\":\"unverified\",\"version\":1,\"created_at\":\"t\",\"issued_at\":\"t\",\"attachments\":[{\"ordinal\":2,\"filename\":null,\"declared_type\":\"application/pdf\",\"measured_type\":null,\"byte_size\":11,\"verdict\":\"needs_review\",\"reason\":\"scanner_unavailable\",\"eligible\":true}],\"summary\":null}",
        )
        .unwrap();
        assert_eq!(with_rows.attachments.len(), 1);
        assert_eq!(with_rows.attachments[0].ordinal, 2);
        assert!(with_rows.attachments[0].eligible);
        assert_eq!(with_rows.attachments[0].filename, None);
        let back = serde_json::to_value(&with_rows).unwrap();
        assert_eq!(back["attachments"][0]["reason"], json!("scanner_unavailable"));
    }

    #[test]
    fn pydantic_list_detail_is_not_a_code() {
        let parsed: Value = serde_json::from_str(
            "{\"detail\":[{\"type\":\"missing\",\"loc\":[\"body\",\"field\"],\"msg\":\"x\"}]}",
        )
        .unwrap();
        assert_eq!(safe_detail(&parsed), None);
        let parsed: Value = serde_json::from_str("{\"detail\":\"rank_not_found\"}").unwrap();
        assert_eq!(safe_detail(&parsed), Some("rank_not_found".to_string()));
        let parsed: Value = serde_json::from_str("{\"detail\":\"some_future_code\"}").unwrap();
        assert_eq!(
            safe_detail(&parsed),
            None,
            "unknown detail never leaves the safe allowlist"
        );
    }

    #[test]
    fn the_first_attachment_is_ordinal_zero() {
        // Server contract: attachments are counted from zero (`_ordinal_or_404`,
        // c3a-api-contract.md). Live 2026-09-27: GET /attachments/0 answered 200
        // with 898 bytes while this client refused ordinal 0 as out of range
        // (BACKLOG №504) — so every single-attachment letter had nothing to
        // download.
        assert_eq!(
            checked_attachment_ordinal(0),
            Ok(0),
            "ordinal 0 is the FIRST attachment and must pass the bound"
        );
        assert_eq!(checked_attachment_ordinal(1), Ok(1));
        assert_eq!(checked_attachment_ordinal(9999), Ok(9999));
        let refused = |ordinal: i64| {
            checked_attachment_ordinal(ordinal)
                .expect_err("an out-of-range ordinal must be refused")
                .detail
        };
        assert_eq!(refused(-1), Some("ordinal_out_of_range".to_string()));
        assert_eq!(refused(10000), Some("ordinal_out_of_range".to_string()));
    }

    /// Like `one_shot_server`, but the server gives up after `patience` when no
    /// request arrives: a guard that refuses BEFORE dispatch must show up as
    /// `None`, not hang the test on `accept`.
    fn one_shot_server_or_silence(
        reply: String,
        patience: Duration,
    ) -> (String, thread::JoinHandle<Option<Vec<u8>>>) {
        let source = TcpListener::bind("127.0.0.1:0").unwrap();
        source.set_nonblocking(true).unwrap();
        let source_addr = source.local_addr().unwrap();
        let server = thread::spawn(move || {
            let deadline = std::time::Instant::now() + patience;
            loop {
                match source.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        let mut request = [0_u8; 4096];
                        let read = stream.read(&mut request).unwrap_or(0);
                        write!(stream, "{reply}").unwrap();
                        return Some(request[..read].to_vec());
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() >= deadline {
                            return None;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => return None,
                }
            }
        });
        (format!("http://{source_addr}"), server)
    }

    /// The request line the server sees for one `download_attachment` call, or
    /// `None` when the client refused before dispatching. The stand answers 404 so
    /// nothing is ever written under `Downloads/Skipi/Crewing` by a test.
    fn attachment_request_line(ordinal: i64) -> (Option<String>, PilotBridgeError) {
        let (base, server) = one_shot_server_or_silence(
            json_reply("404 Not Found", "{\"detail\":\"Not Found\"}"),
            Duration::from_millis(1500),
        );
        let context = snapshot_context(&settings(&base), &expected(&base)).unwrap();
        let result = download_attachment(&context, "intake-1", ordinal, None);
        let request = server
            .join()
            .unwrap()
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .map(|text| text.lines().next().unwrap_or("").to_string());
        let err = result.expect_err("the stand answers 404, so the download must not succeed");
        (request, err)
    }

    #[test]
    fn attachment_download_asks_the_server_for_the_ordinal_it_issued() {
        // Measured on the REAL request line, not on source tokens: the ordinal the
        // screen passes is the ordinal in the path, unshifted, and the first
        // attachment (0) is dispatched, not refused (№504: the K2.1 client turned
        // every single-attachment letter into `ordinal_out_of_range`).
        for ordinal in [0_i64, 7] {
            let (request, err) = attachment_request_line(ordinal);
            assert_eq!(
                request.as_deref(),
                Some(
                    format!(
                        "GET /api/crewings/crew-test/candidate-intake/intake-1/attachments/{ordinal} HTTP/1.1"
                    )
                    .as_str()
                ),
                "ordinal {ordinal} must reach the server as /attachments/{ordinal}: \
                 attachments are counted from zero and the client adds nothing \
                 (client answer was kind={} detail={:?})",
                err.kind,
                err.detail
            );
            assert_eq!(err.kind, "server", "the server's own answer comes back");
            assert_eq!(err.status, Some(404));
        }
    }

    #[test]
    fn out_of_range_ordinals_are_refused_before_any_dispatch() {
        // The same function, the same stand: -1 and 10000 never open a connection.
        for ordinal in [-1_i64, 10000] {
            let (request, err) = attachment_request_line(ordinal);
            assert_eq!(
                request, None,
                "ordinal {ordinal} is out of range and must not be dispatched"
            );
            assert_eq!(err.kind, "invalid_request");
            assert_eq!(err.detail, Some("ordinal_out_of_range".to_string()));
        }
    }
}
