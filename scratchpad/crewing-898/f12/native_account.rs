//! Account bootstrap wire validation. Credentials in this module never become UI payloads.
use chrono::{DateTime, Duration, Utc};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub(crate) const ACCOUNT_ORIGIN: &str = "https://assistant.skipi.app";
pub(crate) const COMPANY_SCOPES: [&str; 5] = [
    "vacancy:write", "mailing:write", "applications:read", "profile:write", "pubkey:write",
];

#[derive(Clone, Deserialize)]
pub(crate) struct LoginResponse {
    pub token: String,
    pub scope: String,
    #[serde(deserialize_with = "required_nullable")]
    pub role: Option<String>,
    pub account_id: String,
}

#[derive(Clone, Deserialize)]
pub(crate) struct BootstrapResponse {
    pub account_id: String,
    pub connection: Connection,
    pub entitlement: Entitlement,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Connection {
    pub server_url: String,
    pub crewing_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub organization_id: Option<String>,
    pub bearer_token: String,
    pub scopes: Vec<String>,
    pub expires_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Entitlement {
    pub source: String,
    #[serde(deserialize_with = "required_nullable")]
    pub expires_at: Option<String>,
}

// A nullable key is still mandatory in the agreed wire contract. Plain serde Option
// would silently accept a missing key as None.
fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where D: serde::Deserializer<'de>, T: Deserialize<'de> {
    Option::<T>::deserialize(deserializer)
}

pub(crate) fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value == value.trim() && !value.chars().any(char::is_control)
}

pub(crate) fn valid_opaque_credential(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn utc_time(value: &str) -> Result<DateTime<Utc>, &'static str> {
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| "invalid_response")?;
    if parsed.offset().local_minus_utc() != 0 || value.ends_with("-00:00") { return Err("invalid_response"); }
    Ok(parsed.with_timezone(&Utc))
}

/// Only explicitly configured origins are trusted. An arbitrary HTTPS URL from a response
/// is not a trust policy. Production callers supply the two compiled company API origins;
/// disposable local QA supplies an independently configured loopback origin.
pub(crate) fn trusted_origin(value: &str, configured: &[&str]) -> bool {
    let Ok(url) = Url::parse(value) else { return false; };
    if !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/"
    { return false; }
    configured.iter().any(|candidate| {
        Url::parse(candidate).is_ok_and(|expected| {
            expected.origin() == url.origin() && expected.path() == "/"
                && expected.query().is_none() && expected.fragment().is_none()
                && expected.username().is_empty() && expected.password().is_none()
                && (expected.scheme() == "https" ||
                    (cfg!(debug_assertions) && expected.scheme() == "http"
                     && matches!(expected.host_str(), Some("127.0.0.1") | Some("[::1]") | Some("::1"))))
        })
    })
}

impl LoginResponse {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if self.scope != "app_full" || !valid_id(&self.account_id)
            || !valid_opaque_credential(&self.token)
        { return Err("invalid_response"); }
        // Role is deliberately not used as ownership or entitlement evidence.
        Ok(())
    }
}

// Parsed times contain no credentials and do not imply an active session or ownership.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedTimes {
    pub connection_expiry: DateTime<Utc>,
    pub entitlement_expiry: Option<DateTime<Utc>>,
}

fn validate_expiry_order(
    connection_expiry: &DateTime<Utc>, entitlement_expiry: Option<&DateTime<Utc>>,
) -> Result<(), &'static str> {
    if entitlement_expiry.is_some_and(|grant| connection_expiry > grant) {
        return Err("invalid_response");
    }
    Ok(())
}

impl BootstrapResponse {
    fn validate_connection_shape(
        &self, account_id: &str, existing_company: Option<&str>,
        trusted_company_origins: &[&str],
    ) -> Result<DateTime<Utc>, &'static str> {
        let c = &self.connection;
        if !valid_id(account_id) || self.account_id != account_id {
            return Err("tenant_mismatch");
        }
        if !valid_id(&c.crewing_id)
            || c.organization_id.as_deref().is_some_and(|id| !valid_id(id))
            || !trusted_origin(&c.server_url, trusted_company_origins)
            || !c.bearer_token.starts_with("skn_") || c.bearer_token.len() <= 4
            || !valid_opaque_credential(&c.bearer_token)
        { return Err("invalid_response"); }
        if existing_company.is_some_and(|existing| existing != c.crewing_id) {
            return Err("tenant_mismatch");
        }
        let scopes: BTreeSet<&str> = c.scopes.iter().map(String::as_str).collect();
        if scopes.len() != COMPANY_SCOPES.len() || c.scopes.len() != COMPANY_SCOPES.len()
            || scopes != COMPANY_SCOPES.into_iter().collect()
        { return Err("scope_denied"); }
        utc_time(&c.expires_at)
    }

    fn validate_entitlement_shape(&self) -> Result<Option<DateTime<Utc>>, &'static str> {
        match (self.entitlement.source.as_str(), self.entitlement.expires_at.as_deref()) {
            ("approved_free", None) => Ok(None),
            ("approved_free" | "paddle", Some(value)) => utc_time(value).map(Some),
            _ => Err("invalid_response"),
        }
    }

    /// Recognize a stored binding, including expired/signed-out records. No clock,
    /// authorization, issuance age, or ownership proof is inferred by this method.
    pub(crate) fn validate_stored_shape(
        &self, account_id: &str, existing_company: Option<&str>,
        trusted_company_origins: &[&str],
    ) -> Result<ValidatedTimes, &'static str> {
        let connection_expiry = self.validate_connection_shape(account_id, existing_company, trusted_company_origins)?;
        let entitlement_expiry = self.validate_entitlement_shape()?;
        validate_expiry_order(&connection_expiry, entitlement_expiry.as_ref())?;
        Ok(ValidatedTimes { connection_expiry, entitlement_expiry })
    }

    pub(crate) fn validate(
        &self, account_id: &str, existing_company: Option<&str>,
        trusted_company_origins: &[&str], now: DateTime<Utc>,
    ) -> Result<(), &'static str> {
        // Preserve active-admission error precedence and the real clock/15-minute bound.
        let expiry = self.validate_connection_shape(account_id, existing_company, trusted_company_origins)?;
        if expiry <= now || expiry > now + Duration::minutes(15) {
            return Err("invalid_response");
        }
        let grant_expiry = self.validate_entitlement_shape()?;
        if grant_expiry.as_ref().is_some_and(|grant| grant <= &now) {
            return Err("entitlement_expired");
        }
        validate_expiry_order(&expiry, grant_expiry.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn clock() -> DateTime<Utc> { "2026-10-19T16:00:00Z".parse().unwrap() }
    fn wire() -> Value {
        json!({"account_id":"account-635", "connection": {
            "server_url":"https://api.skipi.app", "crewing_id":"company-635",
            "organization_id":null,"bearer_token":"skn_synthetic_secret_635",
            "scopes":["vacancy:write","mailing:write","applications:read","profile:write","pubkey:write"],"expires_at":"2026-10-19T16:14:00Z"},
            "entitlement":{"source":"paddle","expires_at":"2026-10-20T16:00:00Z"}})
    }
    fn validate(value: Value) -> Result<(), &'static str> {
        let parsed: BootstrapResponse = serde_json::from_value(value).map_err(|_|"invalid_response")?;
        parsed.validate("account-635",Some("company-635"), &["https://api.skipi.app"],clock())
    }
    #[test]
    fn native635_bootstrap_accepts_exact_paid_and_explicit_free() {
        assert_eq!(validate(wire()),Ok(()));
        let mut free=wire();free["entitlement"]=json!({"source":"approved_free","expires_at":null});
        assert_eq!(validate(free),Ok(()));
        let mut finite_free=wire();finite_free["entitlement"]["source"]=json!("approved_free");
        assert_eq!(validate(finite_free),Ok(()));
    }
    #[test]
    fn native635_bootstrap_required_keys_are_really_required() {
        for field in ["account_id","connection","entitlement"] {
            let mut v=wire();v.as_object_mut().unwrap().remove(field);assert!(validate(v).is_err(),"{field}");
            let mut v=wire();v[field]=json!(false);assert!(validate(v).is_err(),"wrong type {field}");
        }
        for field in ["server_url","crewing_id","organization_id","bearer_token","scopes","expires_at"] {
            let mut v=wire();v["connection"].as_object_mut().unwrap().remove(field);assert!(validate(v).is_err(),"{field}");
            let mut v=wire();v["connection"][field]=json!(false);assert!(validate(v).is_err(),"wrong type {field}");
        }
        for field in ["source","expires_at"] {
            let mut v=wire();v["entitlement"].as_object_mut().unwrap().remove(field);assert!(validate(v).is_err(),"{field}");
            let mut v=wire();v["entitlement"][field]=json!(false);assert!(validate(v).is_err(),"wrong type {field}");
        }
    }
    #[test]
    fn native635_bootstrap_rejects_wrong_tenant_and_untrusted_origin() {
        for (field,value) in [("account_id",json!("another-account")),("account_id",json!(""))] {
            let mut v=wire();v[field]=value;assert!(validate(v).is_err());
        }
        for (field,value) in [("crewing_id",json!("another-company")),("crewing_id",json!(" ")),
            ("organization_id",json!("")),("organization_id",json!(false)),
            ("server_url",json!("https://untrusted.invalid")),("server_url",json!("http://api.skipi.app")),
            ("server_url",json!("https://api.skipi.app/path")),("server_url",json!("https://x@api.skipi.app")),
            ("server_url",json!("https://api.skipi.app?redirect=elsewhere")),
            ("bearer_token",json!("legacy-token")),("bearer_token",json!("skn_")),("bearer_token",json!("skn_a\nb"))] {
            let mut v=wire();v["connection"][field]=value;assert!(validate(v).is_err(),"{field}");
        }
    }
    #[test]
    fn native635_bootstrap_rejects_scope_expiry_and_unproven_entitlement() {
        for scopes in [json!(["*"]),json!(["team:claim-owner"]),json!([]),
            json!(["vacancy:write","mailing:write","applications:read","profile:write","pubkey:write","pubkey:write"])] {
            let mut v=wire();v["connection"]["scopes"]=scopes;assert!(validate(v).is_err());
        }
        // Keep five elements: these must fail on values, not only cardinality.
        for invalid in ["team:claim-owner", "*", "vacancy:write"] {
            let mut v=wire();v["connection"]["scopes"][4]=json!(invalid);
            assert!(validate(v).is_err(),"{invalid}");
        }
        for expiry in [Value::Null,json!("bad"),json!("2026-10-19T15:59:59Z"),json!("2026-10-19T16:00:00Z"),
            json!("2026-10-19T16:15:01Z"),json!("2026-10-19T17:14:00+01:00")] {
            let mut v=wire();v["connection"]["expires_at"]=expiry;assert!(validate(v).is_err());
        }
        for entitlement in [json!({"source":"paddle","expires_at":null}),
            json!({"source":"trial","expires_at":null}),json!({"source":"approved_free","expires_at":"bad"}),
            json!({"source":"paddle","expires_at":"2026-10-19T15:59:59Z"}),
            json!({"source":"paddle","expires_at":"2026-10-19T16:13:00Z"})] {
            let mut v=wire();v["entitlement"]=entitlement;assert!(validate(v).is_err());
        }
    }
    #[test]
    fn native635_bootstrap_accepts_exact_credential_and_grant_boundaries() {
        let mut v=wire();v["connection"]["expires_at"]=json!("2026-10-19T16:15:00Z");
        assert_eq!(validate(v.clone()),Ok(()));
        v["entitlement"]["expires_at"]=json!("2026-10-19T16:15:00Z");
        assert_eq!(validate(v),Ok(()));
    }
    #[test]
    fn native635_bootstrap_accepts_additive_fields_without_forwarding_them() {
        let mut v=wire();v["future_metadata"]=json!({"status":"new"});
        v["connection"]["future_metadata"]=json!({"status":"new"});
        v["entitlement"]["future_metadata"]=json!({"status":"new"});
        assert_eq!(validate(v.clone()),Ok(()));
        let parsed:BootstrapResponse=serde_json::from_value(v).unwrap();
        assert!(serde_json::to_value(&parsed.connection).unwrap().get("future_metadata").is_none());
        assert!(serde_json::to_value(&parsed.entitlement).unwrap().get("future_metadata").is_none());
        assert_eq!(parsed.connection.organization_id,None);
        assert_eq!(parsed.connection.organization_id.as_deref().unwrap_or(""),"");
    }
    #[test]
    fn native635_login_requires_app_full_and_account_id_not_role() {
        for field in ["token", "scope", "role", "account_id"] {
            let mut v=json!({"token":"synthetic_app_secret","scope":"app_full","role":null,"account_id":"account-635"});
            v.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<LoginResponse>(v).is_err(),"{field}");
        }
        let additive:LoginResponse=serde_json::from_value(json!({"token":"synthetic_app_secret","scope":"app_full","role":null,"account_id":"account-635","future_metadata":true})).unwrap();
        assert_eq!(additive.validate(),Ok(()));
        for field in ["token", "scope", "role", "account_id"] {
            let mut v=json!({"token":"synthetic_app_secret","scope":"app_full","role":null,"account_id":"account-635"});
            v[field]=json!(false);assert!(serde_json::from_value::<LoginResponse>(v).is_err(),"wrong type {field}");
        }
        for role in [Value::Null,json!("member")] {
            let parsed:LoginResponse=serde_json::from_value(json!({"token":"synthetic_app_secret","scope":"app_full","role":role,"account_id":"account-635"})).unwrap();
            assert_eq!(parsed.validate(),Ok(()));
        }
        for (field,value) in [("scope",json!("app_limited")),("token",json!("")),("token",json!("bad token")),("account_id",json!(""))] {
            let mut v=json!({"token":"synthetic_app_secret","scope":"app_full","role":null,"account_id":"account-635"});v[field]=value;
            let parsed:LoginResponse=serde_json::from_value(v).unwrap();assert!(parsed.validate().is_err());
        }
    }

    fn stored(v: Value) -> Result<ValidatedTimes, &'static str> {
        let parsed:BootstrapResponse=serde_json::from_value(v).map_err(|_| "invalid_response")?;
        parsed.validate_stored_shape("account-635",Some("company-635"),&["https://api.skipi.app"])
    }
    #[test]
    fn native635_stored_shape_recognizes_expired_binding_without_admitting_it() {
        let mut v=wire();v["connection"]["expires_at"]=json!("2020-01-01T00:01:00Z");
        v["entitlement"]["expires_at"]=json!("2020-01-01T00:02:00Z");
        let shape=stored(v.clone()).unwrap();
        assert_eq!(shape.connection_expiry,"2020-01-01T00:01:00Z".parse::<DateTime<Utc>>().unwrap());
        assert_eq!(shape.entitlement_expiry,Some("2020-01-01T00:02:00Z".parse::<DateTime<Utc>>().unwrap()));
        assert_eq!(validate(v),Err("invalid_response"));
        let mut far_future=wire();far_future["connection"]["expires_at"]=json!("2026-10-20T16:00:00Z");
        assert!(stored(far_future.clone()).is_ok());assert_eq!(validate(far_future),Err("invalid_response"));
        let mut free=wire();free["entitlement"]=json!({"source":"approved_free","expires_at":null});
        assert_eq!(stored(free).unwrap().entitlement_expiry,None);
    }
    #[test]
    fn native635_stored_shape_shares_canonical_credential_scope_time_and_grant_checks() {
        for (field,value) in [("bearer_token",json!("skn_")),("bearer_token",json!(" skn_synthetic")),
            ("bearer_token",json!("skn_a\nb")),("organization_id",json!("")),("organization_id",json!("bad\nid")),
            ("expires_at",json!("2026-10-19T16:14:00-00:00")),("expires_at",json!("2026-10-19T17:14:00+01:00")),
            ("scopes",json!(["vacancy:write","mailing:write","applications:read","profile:write","profile:write"]))] {
            let mut v=wire();v["connection"][field]=value;assert!(stored(v).is_err(),"{field}");
        }
        for entitlement in [json!({"source":"paddle","expires_at":null}),json!({"source":"trial","expires_at":null}),
            json!({"source":"approved_free","expires_at":"2026-10-19T16:13:00Z"}),
            json!({"source":"paddle","expires_at":"2026-10-20T16:00:00-00:00"})] {
            let mut v=wire();v["entitlement"]=entitlement;assert!(stored(v).is_err());
        }
    }
    #[test]
    fn native635_stored_shape_uses_explicit_origin_and_binding_policy() {
        let mut v=wire();v["connection"]["server_url"]=json!("https://synthetic-policy.invalid");
        assert!(stored(v.clone()).is_err());
        let parsed:BootstrapResponse=serde_json::from_value(v).unwrap();
        assert!(parsed.validate_stored_shape("account-635",Some("company-635"),&["https://synthetic-policy.invalid"]).is_ok());
        assert!(parsed.validate_stored_shape("other-account",Some("company-635"),&["https://synthetic-policy.invalid"]).is_err());
        assert!(parsed.validate_stored_shape("account-635",Some("other-company"),&["https://synthetic-policy.invalid"]).is_err());
        assert!(parsed.validate_stored_shape("account-635",None,&[]).is_err());
        let mut local=wire();local["connection"]["server_url"]=json!("http://127.0.0.1:28135");
        assert!(stored(local.clone()).is_err());
        let parsed:BootstrapResponse=serde_json::from_value(local).unwrap();
        assert_eq!(parsed.validate_stored_shape("account-635",Some("company-635"),&["http://127.0.0.1:28135"]).is_ok(),cfg!(debug_assertions));
    }
    #[test]
    fn native635_active_validation_retains_error_precedence_after_shape_extraction() {
        let mut v=wire();v["connection"]["scopes"]=json!([]);v["connection"]["expires_at"]=json!("bad");
        assert_eq!(validate(v),Err("scope_denied"));
        let mut v=wire();v["account_id"]=json!("other");v["connection"]["scopes"]=json!([]);
        assert_eq!(validate(v),Err("tenant_mismatch"));
        let mut v=wire();v["entitlement"]["expires_at"]=json!("2026-10-19T15:59:59Z");
        assert_eq!(validate(v),Err("entitlement_expired"));
        let mut v=wire();v["connection"]["expires_at"]=json!("2026-10-19T15:59:59Z");
        v["entitlement"]=json!({"source":"trial","expires_at":null});
        assert_eq!(validate(v),Err("invalid_response"));
    }

}

// Одно правило «локальная петля» для обоих отладочных путей (loopback_qa и
// переопределения origin на сборке): два похожих предиката разошлись бы молча.
#[cfg(debug_assertions)]
fn loopback_origin(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else { return false; };
    url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1") | Some("[::1]") | Some("::1"))
        && url.username().is_empty() && url.password().is_none()
        && url.path() == "/" && url.query().is_none() && url.fragment().is_none()
}

// Fixed native transport. No origin/tenant/credential selector is accepted from JS.
#[derive(Clone)]
pub(crate) struct TransportConfig {
    account_origin: String,
    company_origins: Vec<String>,
    #[cfg(debug_assertions)]
    direct_loopback_qa: bool,
}
impl TransportConfig {
    pub(crate) fn production() -> Self {
        // No.880 п.7 ((1608)). В ОТЛАДОЧНОЙ сборке источник аккаунта можно
        // переопределить переменной СБОРКИ — без этого стенд упирается в закрытый
        // порт захардкоженного origin (измерено на стенде 635 25.10). Три границы
        // держат это узким: (1) `option_env!` читает КОМПИЛЯТОР, поэтому окружение
        // запущенного приложения ничего не меняет; (2) ветки не существует в
        // релизной сборке; (3) принимается только локальная петля, то есть боевой
        // источник подменить нельзя даже в debug. В UI — ничего.
        #[cfg(debug_assertions)]
        if let Some(config) = option_env!("SKIPI_CREWING_DEV_ACCOUNT_ORIGIN")
            .and_then(Self::dev_origin_config) { return config; }
        Self {
            #[cfg(debug_assertions)]
            direct_loopback_qa: false,
            account_origin: ACCOUNT_ORIGIN.to_owned(),
            company_origins: vec![crate::api::PRIMARY_API.to_owned(), crate::api::RU_API.to_owned()],
        }
    }
    // Предикат вынесен, чтобы проверяться без пересборки с переменной: иначе
    // граница безопасности осталась бы непроверяемой.
    #[cfg(debug_assertions)]
    pub(crate) fn dev_origin_config(origin: &str) -> Option<Self> {
        if !loopback_origin(origin) { return None; }
        Some(Self {
            direct_loopback_qa: true,
            account_origin: origin.trim_end_matches('/').to_owned(),
            // Origin КОМПАНИИ не подменяются: предмет переопределения — только
            // источник аккаунта.
            company_origins: vec![crate::api::PRIMARY_API.to_owned(), crate::api::RU_API.to_owned()],
        })
    }
    // Explicit disposable QA config only. This constructor does not exist in release builds.
    #[cfg(debug_assertions)]
    pub(crate) fn loopback_qa(account: &str, company: &str) -> Result<Self, &'static str> {
        if !loopback_origin(account) || !loopback_origin(company) { return Err("invalid_qa_config"); }
        Ok(Self {direct_loopback_qa: true, account_origin: account.trim_end_matches('/').to_owned(),
            company_origins: vec![company.trim_end_matches('/').to_owned()]})
    }
}

pub(crate) struct AccountClient {
    config: TransportConfig,
    http: reqwest::blocking::Client,
}

const MAX_ACCOUNT_RESPONSE_BYTES: u64 = 65536;
#[derive(Deserialize)]
struct ErrorResponse { error: String }
#[derive(Deserialize)]
struct LogoutResponse { ok: bool }

fn response_json<T: serde::de::DeserializeOwned>(
    status: u16, bytes: &[u8], login: bool,
) -> Result<T, &'static str> {
    if bytes.len() > MAX_ACCOUNT_RESPONSE_BYTES as usize { return Err("invalid_response"); }
    if status == 200 {
        return serde_json::from_slice(bytes).map_err(|_| "invalid_response");
    }
    let error: ErrorResponse = serde_json::from_slice(bytes).map_err(|_| "upstream_unavailable")?;
    let code = error.error.as_str();
    if login {
        return Err(match (status, code) {
            (400, "bad_email") => "bad_email",
            (403, "invalid_credentials") => "invalid_credentials",
            (429, "too_many_attempts") => "too_many_attempts",
            _ => "upstream_unavailable",
        });
    }
    Err(match (status, code) {
        (400, "invalid_request") => "invalid_request",
        (401, "login_required") => "login_required",
        (403, "invalid_credentials") => "invalid_credentials",
        (403, "entitlement_missing") => "entitlement_missing",
        (403, "entitlement_expired") => "entitlement_expired",
        (403, "entitlement_revoked") => "entitlement_revoked",
        (403, "tenant_mismatch") => "tenant_mismatch",
        (403, "scope_denied") => "scope_denied",
        (409, "ownership_conflict") => "ownership_conflict",
        (503, "upstream_unavailable") => "upstream_unavailable",
        _ => "upstream_unavailable",
    })
}

impl AccountClient {
    pub(crate) fn new(config: TransportConfig) -> Result<Self, &'static str> {
        let builder = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(4))
            .timeout(std::time::Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none());
        // Explicit disposable QA must stay on its numeric loopback origin.
        // Production retains the ordinary reqwest system proxy policy.
        #[cfg(debug_assertions)]
        let builder = if config.direct_loopback_qa { builder.no_proxy() } else { builder };
        let http = builder.build().map_err(|_| "transport_unreachable")?;
        Ok(Self {config, http})
    }
    fn post<T: serde::de::DeserializeOwned>(
        &self, path: &'static str, credential: Option<&str>, body: serde_json::Value,
        login: bool,
    ) -> Result<T, &'static str> {
        use std::io::Read;
        let mut request = self.http.post(format!("{}{}", self.config.account_origin, path)).json(&body);
        if let Some(credential) = credential {
            if credential.is_empty() || credential.chars().any(char::is_whitespace)
                || credential.chars().any(char::is_control) { return Err("login_required"); }
            request = request.bearer_auth(credential);
        }
        let response = request.send().map_err(|_| "transport_unreachable")?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        response.take(MAX_ACCOUNT_RESPONSE_BYTES + 1).read_to_end(&mut bytes)
            .map_err(|_| "transport_unreachable")?;
        response_json(status, &bytes, login)
    }
    pub(crate) fn login(&self, email: &str, password: &str) -> Result<LoginResponse, &'static str> {
        let response: LoginResponse = self.post("/api/app/login", None,
            serde_json::json!({"email":email.trim(), "password":password, "label":"Skipi Crewing"}), true)?;
        response.validate()?;
        Ok(response)
    }
    pub(crate) fn bootstrap(
        &self, app_credential: &str, account_id: &str,
        existing_company: Option<&str>, create_if_missing: bool,
    ) -> Result<BootstrapResponse, &'static str> {
        let response: BootstrapResponse = self.post("/api/app/crewing/bootstrap", Some(app_credential),
            serde_json::json!({"create_if_missing":create_if_missing}), false)?;
        let origins: Vec<&str> = self.config.company_origins.iter().map(String::as_str).collect();
        response.validate(account_id, existing_company, &origins, Utc::now())?;
        Ok(response)
    }
    pub(crate) fn logout(&self, app_credential: &str) -> Result<(), &'static str> {
        let response: LogoutResponse = self.post("/api/app/logout", Some(app_credential),
            serde_json::json!({}), false)?;
        if !response.ok { return Err("invalid_response"); }
        Ok(())
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use serde_json::{json, Value};
    #[test]
    fn native635_transport_production_has_one_fixed_account_origin() {
        let config=TransportConfig::production();
        // No.880 п.7: в отладочной сборке с SKIPI_CREWING_DEV_ACCOUNT_ORIGIN источник
        // аккаунта намеренно иной. Пин говорит правду про ОБЕ сборки, а не
        // притворяется, что переопределения нет: иначе прогон на стенде краснел бы
        // «сам по себе» и это читали бы как поломку.
        let expected = option_env!("SKIPI_CREWING_DEV_ACCOUNT_ORIGIN")
            .filter(|origin| TransportConfig::dev_origin_config(origin).is_some())
            .map(|origin| origin.trim_end_matches('/'))
            .unwrap_or("https://assistant.skipi.app");
        assert_eq!(config.account_origin, expected);
        // Origin КОМПАНИИ переопределению не подлежат ни в одной сборке.
        assert_eq!(config.company_origins,vec!["https://api.skipi.app","https://api-ru.skipi.app"]);
    }
    // No.880 п.7 ((1608)): отладочная сборка может указать ИНОЙ источник аккаунта
    // — иначе стенд упирается в закрытый порт захардкоженного origin (измерено на
    // стенде 635 25.10). Значение читается ТОЛЬКО на этапе сборки и ТОЛЬКО в
    // debug; предикат вынесен отдельно, чтобы проверяться без сборки с env.
    #[cfg(debug_assertions)]
    #[test]
    fn native635_880_dev_account_origin_is_loopback_only() {
        // Контроль: ровно та форма, которую поднимает стенд, принимается.
        let config = TransportConfig::dev_origin_config("http://127.0.0.1:9").expect("loopback origin accepted");
        assert_eq!(config.account_origin, "http://127.0.0.1:9");
        // Фирменные origin компании не подменяются: предмет переопределения —
        // только источник АККАУНТА.
        assert_eq!(config.company_origins, vec![crate::api::PRIMARY_API, crate::api::RU_API]);
        assert!(config.direct_loopback_qa, "a loopback stand must not go through a proxy");
        for refused in [
            "https://assistant.skipi.app",      // не петля: подмена боевого источника
            "http://evil.example.com",           // чужой хост
            "http://127.0.0.1:9/path",           // путь
            "http://127.0.0.1:9?q=1",            // запрос
            "http://user:pass@127.0.0.1:9",      // креденшал
            "ftp://127.0.0.1:9",                 // чужая схема
            "127.0.0.1:9",                       // без схемы
            "",
        ] {
            assert!(TransportConfig::dev_origin_config(refused).is_none(), "must be refused: {refused}");
        }
        // И обратная сторона: БЕЗ переменной сборки production() остаётся боевым —
        // это пинит соседний тест native635_transport_production_has_one_fixed_account_origin.
    }

    #[test]
    fn native635_transport_error_status_and_code_must_match() {
        for (status,code) in [(400,"invalid_request"),(401,"login_required"),
            (403,"invalid_credentials"),(403,"entitlement_missing"),(403,"entitlement_expired"),
            (403,"entitlement_revoked"),(403,"tenant_mismatch"),(403,"scope_denied"),
            (409,"ownership_conflict"),(503,"upstream_unavailable")] {
            let bytes=serde_json::to_vec(&json!({"error":code})).unwrap();
            assert_eq!(response_json::<Value>(status,&bytes,false),Err(code));
            assert_eq!(response_json::<Value>(500,&bytes,false),Err("upstream_unavailable"));
        }
        for (status,code) in [(400,"bad_email"),(403,"invalid_credentials"),(429,"too_many_attempts")] {
            let bytes=serde_json::to_vec(&json!({"error":code})).unwrap();
            assert_eq!(response_json::<Value>(status,&bytes,true),Err(code));
        }
        for (status,bytes) in [(302,b"redirect".as_slice()),(401,b"<html>secret raw error</html>"),
            (403,b"{\"error\":\"synthetic_secret\"}"),(409,b"{\"error\":\"tenant_mismatch\"}")] {
            assert_eq!(response_json::<Value>(status,bytes,false),Err("upstream_unavailable"));
        }
    }
    #[test]
    fn native635_transport_bounds_responses_and_requires_success_body() {
        assert_eq!(response_json::<Value>(200,&vec![b'x';65537],false),Err("invalid_response"));
        assert_eq!(response_json::<Value>(200,b"bad JSON",false),Err("invalid_response"));
        assert!(response_json::<LogoutResponse>(200,b"{\"ok\":\"yes\"}",false).is_err());
        let value:LogoutResponse=response_json(200,b"{\"ok\":true,\"future\":1}",false).unwrap();
        assert!(value.ok);
    }
    #[cfg(debug_assertions)]
    #[test]
    fn native635_transport_qa_accepts_only_explicit_loopback_origins() {
        assert!(TransportConfig::loopback_qa("http://127.0.0.1:28135","http://127.0.0.1:28136").is_ok());
        for bad in ["http://localhost:28135","https://other.invalid","http://192.168.1.2",
            "http://user@127.0.0.1:28135","http://127.0.0.1/path","http://127.0.0.1?x=1"] {
            assert!(TransportConfig::loopback_qa(bad,"http://127.0.0.1:28136").is_err());
            assert!(TransportConfig::loopback_qa("http://127.0.0.1:28135",bad).is_err());
        }
    }
}


#[cfg(all(test, debug_assertions, target_os = "linux"))]
mod http_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    static HTTP_SERIAL: Mutex<()> = Mutex::new(());

    const ACCOUNT: &str = "http://127.0.0.1:39163";
    const PROXY: &str = "http://127.0.0.1:39164";
    const SINK: &str = "http://127.0.0.1:39165";
    const PROXY_VARS: [&str; 6] = ["HTTP_PROXY","http_proxy","HTTPS_PROXY","https_proxy","ALL_PROXY","all_proxy"];

    #[derive(Clone)]
    struct Captured { method: String, target: String, headers: Vec<(String,String)>, body: Vec<u8> }
    impl Captured {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers.iter().find(|(key,_)|key.eq_ignore_ascii_case(name)).map(|(_,v)|v.as_str())
        }
        fn json(&self) -> serde_json::Value { serde_json::from_slice(&self.body).unwrap() }
    }
    struct Reply { status: u16, extra: Vec<(String,String)>, body: Vec<u8> }
    impl Reply {
        fn json(status: u16, body: serde_json::Value) -> Self {
            Self {status, extra:vec![],body:serde_json::to_vec(&body).unwrap()}
        }
    }
    struct Server {
        stop: Arc<AtomicBool>, requests: Arc<Mutex<Vec<Captured>>>,
        errors: Arc<Mutex<Vec<&'static str>>>, worker: Option<JoinHandle<()>>,
    }
    fn namespace() -> String {
        std::fs::read_link("/proc/self/ns/net").unwrap().to_string_lossy().into_owned()
    }
    fn read_request(stream: &mut TcpStream) -> Result<Captured, &'static str> {
        stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|_|"read_timeout")?;
        stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|_|"write_timeout")?;
        let mut raw=Vec::new(); let mut chunk=[0u8;1024];
        let end=loop {
            if raw.len()>16384 {return Err("request_too_large");}
            if let Some(index)=raw.windows(4).position(|w|w==b"\r\n\r\n") {break index+4;}
            let n=stream.read(&mut chunk).map_err(|_|"header_read")?;
            if n==0 {return Err("short_headers");}
            raw.extend_from_slice(&chunk[..n]);
        };
        let head=std::str::from_utf8(&raw[..end]).map_err(|_|"header_utf8")?.to_owned();
        let mut lines=head.split("\r\n"); let mut first=lines.next().ok_or("request_line")?.split_whitespace();
        let method=first.next().ok_or("method")?.to_owned();
        let target=first.next().ok_or("target")?.to_owned();
        let mut headers=Vec::new();
        for line in lines.filter(|line|!line.is_empty()) {
            let (key,value)=line.split_once(':').ok_or("header_shape")?;
            headers.push((key.to_owned(),value.trim().to_owned()));
        }
        let length=match headers.iter().find(|(key,_)|key.eq_ignore_ascii_case("content-length")) {
            Some((_,value))=>value.parse::<usize>().map_err(|_|"content_length")?, None=>0,
        };
        if length>16384 {return Err("body_too_large");}
        while raw.len()-end<length {
            let n=stream.read(&mut chunk).map_err(|_|"body_read")?;
            if n==0 {return Err("short_body");}
            raw.extend_from_slice(&chunk[..n]);
        }
        Ok(Captured {method,target,headers,body:raw[end..end+length].to_vec()})
    }
    impl Server {
        fn start(address: &str, replies: Vec<Reply>) -> Self {
            let parsed=reqwest::Url::parse(address).unwrap();
            let expected: SocketAddr=format!("127.0.0.1:{}",parsed.port().unwrap()).parse().unwrap();
            let listener=TcpListener::bind(expected).expect("HTTP_QA_SETUP_ERROR fixed owned port unavailable");
            assert_eq!(listener.local_addr().unwrap(),expected);
            listener.set_nonblocking(true).unwrap();
            println!("HTTP_QA_BOUND pid={} namespace={} local={}",std::process::id(),namespace(),expected);
            let stop=Arc::new(AtomicBool::new(false)); let requests=Arc::new(Mutex::new(Vec::new()));
            let errors=Arc::new(Mutex::new(Vec::new()));
            let (done,seen,failures)=(stop.clone(),requests.clone(),errors.clone());
            let worker=thread::spawn(move || {
                let mut replies=replies.into_iter();
                while !done.load(Ordering::SeqCst) {
                    let (mut stream,peer)=match listener.accept() {
                        Ok(pair)=>pair,
                        Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{
                            thread::sleep(Duration::from_millis(5)); continue;
                        },
                        Err(_)=>{failures.lock().unwrap().push("accept");break;}
                    };
                    if !peer.ip().is_loopback() {failures.lock().unwrap().push("nonloopback_peer");break;}
                    match read_request(&mut stream) {
                        Ok(request)=>seen.lock().unwrap().push(request),
                        Err(error)=>{failures.lock().unwrap().push(error);continue;}
                    }
                    let reply=replies.next().unwrap_or_else(||Reply::json(500,serde_json::json!({"error":"unexpected_request"})));
                    let mut head=format!("HTTP/1.1 {} QA\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",reply.status,reply.body.len());
                    for (key,value) in reply.extra {head.push_str(&format!("{}: {}\r\n",key,value));}
                    head.push_str("\r\n");
                    if stream.write_all(head.as_bytes()).and_then(|_|stream.write_all(&reply.body)).is_err() {
                        // Oversize-response rejection can close this owned socket early.
                        // Tests separately prove the intended response/error and captures.
                        failures.lock().unwrap().push("response_write");
                    }
                }
                // Listener is dropped before thread completion; no detached serving task.
            });
            Self {stop,requests,errors,worker:Some(worker)}
        }
        fn finish(&mut self) -> (Vec<Captured>,Vec<&'static str>) {
            self.stop.store(true,Ordering::SeqCst);
            if let Some(worker)=self.worker.take() {
                if worker.join().is_err() {self.errors.lock().unwrap().push("server_thread_panic");}
            }
            (self.requests.lock().unwrap().clone(),self.errors.lock().unwrap().clone())
        }
    }
    impl Drop for Server {
        fn drop(&mut self) { let _=self.finish(); }
    }
    // Isolate environment changes BEFORE exec. Never mutate proxy variables in
    // this multithreaded process or read/copy real proxy credential values.
    fn isolated_child(name: &str, scenario: &str) -> bool {
        if std::env::var("CREWING635_HTTP_CHILD").ok().as_deref()==Some(scenario) {
            assert_eq!(namespace(),std::env::var("CREWING635_HTTP_NETNS").expect("HTTP_QA_SETUP_ERROR namespace marker"));
            return false;
        }
        let mut command=std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact",&format!("native_account::http_tests::{name}"),"--nocapture","--test-threads=1"])
            .env_remove("REQUEST_METHOD")
            .env("CREWING635_HTTP_CHILD",scenario).env("CREWING635_HTTP_NETNS",namespace());
        for variable in PROXY_VARS {command.env(variable,PROXY);}
        for variable in ["NO_PROXY","no_proxy"] {
            command.env(variable,if scenario=="proxy" {""} else {"127.0.0.1,::1"});
        }
        let output=command.output().expect("HTTP_QA_SETUP_ERROR spawn own libtest");
        assert!(output.status.success(),"owned HTTP QA child failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),String::from_utf8_lossy(&output.stderr));
        true
    }
    fn client() -> AccountClient {
        AccountClient::new(TransportConfig::loopback_qa(ACCOUNT,ACCOUNT).unwrap()).unwrap()
    }
    fn login_reply() -> serde_json::Value {
        serde_json::json!({"token":"app_synthetic_http_635","scope":"app_full","role":null,"account_id":"account-http-635"})
    }
    fn bootstrap_reply() -> serde_json::Value {
        serde_json::json!({"account_id":"account-http-635","connection":{
            "server_url":ACCOUNT,"crewing_id":"company-http-635","organization_id":null,
            "bearer_token":"skn_synthetic_http_company_635","scopes":COMPANY_SCOPES,
            "expires_at":(Utc::now()+chrono::Duration::minutes(10)).to_rfc3339()},
            "entitlement":{"source":"approved_free","expires_at":null}})
    }
    #[test]
    fn native635_http_loopback_qa_bypasses_controlled_system_proxy() {
        let _serial = HTTP_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        if isolated_child("native635_http_loopback_qa_bypasses_controlled_system_proxy","proxy") {return;}
        let mut account=Server::start(ACCOUNT,vec![Reply::json(200,login_reply())]);
        let mut proxy=Server::start(PROXY,vec![Reply::json(403,serde_json::json!({"error":"invalid_credentials"}))]);
        let result=client().login("synthetic@example.invalid","synthetic-only-password");
        let (sent,errors)=account.finish(); let (leaked,proxy_errors)=proxy.finish();
        assert_eq!(leaked.len(),0,"explicit QA request reached synthetic proxy");
        assert!(proxy_errors.is_empty() && errors.is_empty());
        assert!(result.is_ok());assert_eq!(sent.len(),1);
        assert_eq!(sent[0].target,"/api/app/login");
    }
    #[test]
    fn native635_http_actual_login_bootstrap_logout_keep_wire_and_credentials_at_account_origin() {
        let _serial = HTTP_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        if isolated_child("native635_http_actual_login_bootstrap_logout_keep_wire_and_credentials_at_account_origin","wire") {return;}
        let mut account=Server::start(ACCOUNT,vec![Reply::json(200,login_reply()),Reply::json(200,bootstrap_reply()),
            Reply::json(200,serde_json::json!({"ok":true}))]);
        let client=client();let login=client.login(" synthetic@example.invalid ","synthetic-only-password é");
        let bootstrap=login.as_ref().map(|login|client.bootstrap(&login.token,&login.account_id,Some("company-http-635"),false));
        let logout=login.as_ref().map(|login|client.logout(&login.token));
        let (sent,errors)=account.finish();assert!(errors.is_empty());
        assert!(login.is_ok());assert!(bootstrap.unwrap().is_ok());assert_eq!(logout.unwrap(),Ok(()));
        assert_eq!(sent.len(),3);
        assert_eq!(sent.iter().map(|r|r.method.as_str()).collect::<Vec<_>>(),vec!["POST";3]);
        assert_eq!(sent[0].target,"/api/app/login");assert!(sent[0].header("authorization").is_none());
        assert_eq!(sent[0].json(),serde_json::json!({"email":"synthetic@example.invalid","password":"synthetic-only-password é","label":"Skipi Crewing"}));
        assert_eq!(sent[1].target,"/api/app/crewing/bootstrap");
        assert_eq!(sent[1].header("authorization"),Some("Bearer app_synthetic_http_635"));
        assert_eq!(sent[1].json(),serde_json::json!({"create_if_missing":false}));
        assert_eq!(sent[2].target,"/api/app/logout");
        assert_eq!(sent[2].header("authorization"),Some("Bearer app_synthetic_http_635"));
        assert_eq!(sent[2].json(),serde_json::json!({}));
    }
    #[test]
    fn native635_http_redirect_never_forwards_app_bearer_to_live_sink() {
        let _serial = HTTP_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        if isolated_child("native635_http_redirect_never_forwards_app_bearer_to_live_sink","redirect") {return;}
        let mut sink=Server::start(SINK,vec![Reply::json(200,serde_json::json!({"control":true}))]);
        // Positive control proves this sink accepts requests; zero forwarded
        // requests alone would not prove redirect-policy enforcement.
        let mut control=TcpStream::connect("127.0.0.1:39165").unwrap();
        control.write_all(b"GET /control HTTP/1.1\r\nHost: 127.0.0.1:39165\r\nConnection: close\r\n\r\n").unwrap();
        control.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut reply=Vec::new();control.read_to_end(&mut reply).unwrap();drop(control);
        assert!(reply.starts_with(b"HTTP/1.1 200"));
        let mut redirect=Reply::json(302,serde_json::json!({"error":"upstream_unavailable"}));
        redirect.extra.push(("Location".into(),format!("{SINK}/redirect-sink")));
        let mut account=Server::start(ACCOUNT,vec![redirect]);
        let result=client().bootstrap("app_synthetic_http_635","account-http-635",Some("company-http-635"),false);
        let (sent,errors)=account.finish();let (received,sink_errors)=sink.finish();
        assert!(matches!(result,Err("upstream_unavailable")));
        assert!(errors.is_empty() && sink_errors.is_empty());assert_eq!(sent.len(),1);
        assert_eq!(sent[0].header("authorization"),Some("Bearer app_synthetic_http_635"));
        assert_eq!(received.len(),1,"redirect followed to live sink");
        assert_eq!(received[0].target,"/control");assert!(received[0].header("authorization").is_none());
    }
    #[test]
    fn native635_http_response_over_limit_is_refused_on_actual_socket() {
        let _serial = HTTP_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        if isolated_child("native635_http_response_over_limit_is_refused_on_actual_socket","oversize") {return;}
        let mut account=Server::start(ACCOUNT,vec![Reply {status:200,extra:vec![],
            body:vec![b'x';MAX_ACCOUNT_RESPONSE_BYTES as usize+2048]}]);
        let result=client().login("synthetic@example.invalid","synthetic-only-password");
        let (sent,errors)=account.finish();
        assert!(matches!(result,Err("invalid_response")));assert_eq!(sent.len(),1);
        assert!(errors.iter().all(|error|*error=="response_write"));
    }
}
