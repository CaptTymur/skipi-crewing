use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;

pub(crate) const PRIMARY_API: &str = "https://api.skipi.app";
pub(crate) const RU_API: &str = "https://api-ru.skipi.app";

pub(crate) fn api_bases(server_url: Option<&str>) -> Vec<String> {
    if let Ok(base) = std::env::var("SKIPI_API_BASE") {
        let base = normalize_api_base(&base);
        if !base.is_empty() {
            return vec![base];
        }
    }

    let configured = server_url
        .map(normalize_api_base)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| RU_API.to_string());

    if configured == PRIMARY_API || configured == RU_API {
        vec![RU_API.to_string(), PRIMARY_API.to_string()]
    } else {
        vec![configured]
    }
}

pub(crate) fn primary_api_base(server_url: Option<&str>) -> String {
    if let Ok(base) = std::env::var("SKIPI_API_BASE") {
        let base = normalize_api_base(&base);
        if !base.is_empty() {
            return base;
        }
    }

    let configured = server_url
        .map(normalize_api_base)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| PRIMARY_API.to_string());

    if configured == RU_API {
        PRIMARY_API.to_string()
    } else {
        configured
    }
}

pub(crate) fn normalize_api_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

fn api_url(base: &str, path: &str) -> String {
    let suffix = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("{}{suffix}", normalize_api_base(base))
}

fn client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

fn retryable_status(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn bearer<'a>(
    req: reqwest::blocking::RequestBuilder,
    token: Option<&'a str>,
) -> reqwest::blocking::RequestBuilder {
    match token.map(str::trim).filter(|s| !s.is_empty()) {
        Some(token) => req.bearer_auth(token),
        None => req,
    }
}

pub(crate) fn get_json<T>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for (idx, base) in bases.iter().enumerate() {
        let url = api_url(base, path);
        match bearer(client.get(&url), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp.json().map_err(|e| format!("bad JSON: {e}"));
                }
                let body = resp.text().unwrap_or_default();
                if idx + 1 < bases.len() && retryable_status(status) {
                    last_err = format!("{base} returned {status}: {body}");
                    continue;
                }
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn get_json_primary<T>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let client = client(timeout_secs)?;
    let base = primary_api_base(server_url);
    let url = api_url(&base, path);
    match bearer(client.get(&url), bearer_token).send() {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                return resp.json().map_err(|e| format!("bad JSON: {e}"));
            }
            let body = resp.text().unwrap_or_default();
            Err(format!("server returned {status}: {body}"))
        }
        Err(e) => Err(format!("{base} network: {e}")),
    }
}

pub(crate) fn post_empty_json<T>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.post(&url), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp.json().map_err(|e| format!("bad JSON: {e}"));
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn post_json<T, B>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    body: &B,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.post(&url).json(body), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp.json().map_err(|e| format!("bad JSON: {e}"));
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn post_json_primary<T, B>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    body: &B,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let client = client(timeout_secs)?;
    let base = primary_api_base(server_url);
    let url = api_url(&base, path);
    match bearer(client.post(&url).json(body), bearer_token).send() {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                return resp.json().map_err(|e| format!("bad JSON: {e}"));
            }
            let body = resp.text().unwrap_or_default();
            Err(format!("server returned {status}: {body}"))
        }
        Err(e) => Err(format!("{base} network: {e}")),
    }
}

pub(crate) fn put_json_primary<T, B>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    body: &B,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let client = client(timeout_secs)?;
    let base = primary_api_base(server_url);
    let url = api_url(&base, path);
    match bearer(client.put(&url).json(body), bearer_token).send() {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                return resp.json().map_err(|e| format!("bad JSON: {e}"));
            }
            let body = resp.text().unwrap_or_default();
            Err(format!("server returned {status}: {body}"))
        }
        Err(e) => Err(format!("{base} network: {e}")),
    }
}

pub(crate) fn post_empty(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.post(&url), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 204 {
                    return Ok(());
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn post_empty_json_primary<T>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let client = client(timeout_secs)?;
    let base = primary_api_base(server_url);
    let url = api_url(&base, path);
    match bearer(client.post(&url), bearer_token).send() {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                return resp.json().map_err(|e| format!("bad JSON: {e}"));
            }
            let body = resp.text().unwrap_or_default();
            Err(format!("server returned {status}: {body}"))
        }
        Err(e) => Err(format!("{base} network: {e}")),
    }
}

pub(crate) fn post_json_empty<B>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    body: &B,
    timeout_secs: u64,
) -> Result<(), String>
where
    B: Serialize + ?Sized,
{
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.post(&url).json(body), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 204 {
                    return Ok(());
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn patch_json_empty<B>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    body: &B,
    timeout_secs: u64,
) -> Result<(), String>
where
    B: Serialize + ?Sized,
{
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.patch(&url).json(body), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 204 {
                    return Ok(());
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn patch_json<T, B>(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    body: &B,
    timeout_secs: u64,
) -> Result<T, String>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.patch(&url).json(body), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp.json().map_err(|e| format!("bad JSON: {e}"));
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn delete_empty(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    let client = client(timeout_secs)?;
    let bases = api_bases(server_url);
    let mut last_err = String::from("API unavailable");

    for base in &bases {
        let url = api_url(base, path);
        match bearer(client.delete(&url), bearer_token).send() {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() || status.as_u16() == 204 {
                    return Ok(());
                }
                let body = resp.text().unwrap_or_default();
                return Err(format!("server returned {status}: {body}"));
            }
            Err(e) => {
                last_err = format!("{base} network: {e}");
                continue;
            }
        }
    }

    Err(last_err)
}

pub(crate) fn delete_empty_primary(
    server_url: Option<&str>,
    bearer_token: Option<&str>,
    path: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    let client = client(timeout_secs)?;
    let base = primary_api_base(server_url);
    let url = api_url(&base, path);
    match bearer(client.delete(&url), bearer_token).send() {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() || status.as_u16() == 204 {
                return Ok(());
            }
            let body = resp.text().unwrap_or_default();
            Err(format!("server returned {status}: {body}"))
        }
        Err(e) => Err(format!("{base} network: {e}")),
    }
}
