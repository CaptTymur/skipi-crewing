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
    pub summary: Option<CandidateIntakeSummary>,
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
    ];
    SAFE.contains(&detail).then(|| detail.to_string())
}

fn send<T: DeserializeOwned>(
    context: &PilotContext,
    method: Method,
    url: Url,
    body: Option<Value>,
    ambiguous_on_network: bool,
) -> Result<(StatusCode, T), PilotBridgeError> {
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
    let bytes = response.bytes().map_err(|_| {
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
    serde_json::from_slice(&bytes)
        .map(|value| (status, value))
        .map_err(|_| {
            let mut err = PilotBridgeError::new("malformed_response");
            err.status = Some(status.as_u16());
            err.ambiguous = ambiguous_on_network;
            err
        })
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
        let mut current = settings("http://127.0.0.1:9");
        current.bearer_token.clear();
        assert_eq!(
            snapshot_context(&current, &expected("http://127.0.0.1:9"))
                .unwrap_err()
                .detail,
            Some("pilot_not_configured".to_string())
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
}
