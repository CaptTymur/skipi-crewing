//! E2E messaging client for Skipi Crewing.
//!
//! On first run we generate a X25519 keypair, store the secret in the
//! crewing config dir (~/.config/skipi-crewing/keys/), publish the public
//! key + derived user_id to skipi-server's pubkey registry. From then on:
//! - Encrypt outbound messages with `crypto_box::SalsaBox::encrypt`
//!   (recipient_pk, our_sk).
//! - Decrypt inbound with the inverse.
//! Server stores opaque ciphertext blobs; never decrypts.

use base64::Engine;
use crypto_box::{
    aead::{Aead, AeadCore, OsRng},
    PublicKey, SalsaBox, SecretKey,
};
use data_encoding::BASE32_NOPAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const SK_FILENAME: &str = "x25519_sk.bin";
const PROD_API: &str = "https://api.skipi.app";

fn keys_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("skipi-crewing")
        .join("keys");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn sk_path() -> PathBuf {
    keys_dir().join(SK_FILENAME)
}

/// Load existing X25519 secret key, or generate a fresh one and persist.
pub fn ensure_keypair() -> Result<(SecretKey, PublicKey, String), String> {
    let path = sk_path();
    let sk: SecretKey = if path.exists() {
        let bytes = std::fs::read(&path).map_err(|e| format!("read sk: {e}"))?;
        if bytes.len() != 32 {
            return Err(format!("malformed sk file: {} bytes", bytes.len()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        SecretKey::from_bytes(arr)
    } else {
        let fresh = SecretKey::generate(&mut OsRng);
        std::fs::write(&path, fresh.to_bytes()).map_err(|e| format!("write sk: {e}"))?;
        // Restrict permissions on Unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        fresh
    };
    let pk = sk.public_key();
    let user_id = derive_user_id(pk.as_bytes());
    Ok((sk, pk, user_id))
}

fn derive_user_id(pubkey: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pubkey);
    let digest = hasher.finalize();
    let encoded = BASE32_NOPAD.encode(&digest);
    encoded.chars().take(16).collect::<String>().to_lowercase()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyIdentity {
    pub user_id: String,
    pub pubkey_b64: String,
}

#[tauri::command]
pub fn get_my_identity() -> Result<MyIdentity, String> {
    let (_sk, pk, user_id) = ensure_keypair()?;
    let pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(pk.as_bytes());
    Ok(MyIdentity { user_id, pubkey_b64 })
}

#[tauri::command]
pub fn register_my_pubkey(crewing_id: String) -> Result<MyIdentity, String> {
    let me = get_my_identity()?;
    let url = format!("{}/api/messaging/pubkey", PROD_API);
    let body = serde_json::json!({
        "user_id": me.user_id,
        "pubkey_b64": me.pubkey_b64,
        "role": "crewing",
        "crewing_id": crewing_id,
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.post(&url).json(&body).send()
        .map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().unwrap_or_default();
        return Err(format!("server returned {s}: {b}"));
    }
    Ok(me)
}

#[derive(Debug, Clone, Deserialize)]
struct PubkeyResp {
    pubkey_b64: String,
}

fn lookup_recipient_pk(user_id: &str) -> Result<PublicKey, String> {
    let url = format!("{}/api/messaging/pubkey/{}", PROD_API, user_id);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("recipient pubkey not found: {}", resp.status()));
    }
    let parsed: PubkeyResp = resp.json().map_err(|e| format!("bad JSON: {e}"))?;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(&parsed.pubkey_b64)
        .map_err(|e| format!("bad b64: {e}"))?;
    if raw.len() != 32 {
        return Err(format!("pubkey size {} != 32", raw.len()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&raw);
    Ok(PublicKey::from(arr))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaintextMessage {
    pub id: String,
    pub application_id: String,
    pub from_user_id: String,
    pub to_user_id: String,
    pub sender_role: String,
    pub plaintext: String,
    pub sent_at: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ServerMessage {
    id: String,
    application_id: String,
    from_user_id: String,
    to_user_id: String,
    sender_role: String,
    ciphertext_b64: String,
    sent_at: String,
}

#[tauri::command]
pub fn send_encrypted_message(
    application_id: String,
    to_user_id: String,
    plaintext: String,
) -> Result<PlaintextMessage, String> {
    let (sk, _pk, my_user_id) = ensure_keypair()?;
    let recipient_pk = lookup_recipient_pk(&to_user_id)?;
    let salsa = SalsaBox::new(&recipient_pk, &sk);
    let nonce = SalsaBox::generate_nonce(&mut OsRng);
    let ct = salsa.encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("encrypt: {e}"))?;
    // Wire format: 24-byte nonce || ciphertext, all base64.
    let mut payload = Vec::with_capacity(24 + ct.len());
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&ct);
    let ciphertext_b64 = base64::engine::general_purpose::STANDARD.encode(&payload);

    let url = format!("{}/api/messaging/threads/{}/messages", PROD_API, application_id);
    let body = serde_json::json!({
        "from_user_id": my_user_id,
        "to_user_id": to_user_id,
        "ciphertext_b64": ciphertext_b64,
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.post(&url).json(&body).send()
        .map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().unwrap_or_default();
        return Err(format!("server returned {s}: {b}"));
    }
    let server_msg: ServerMessage = resp.json().map_err(|e| format!("bad JSON: {e}"))?;
    Ok(PlaintextMessage {
        id: server_msg.id,
        application_id: server_msg.application_id,
        from_user_id: server_msg.from_user_id,
        to_user_id: server_msg.to_user_id,
        sender_role: server_msg.sender_role,
        plaintext,
        sent_at: server_msg.sent_at,
    })
}

#[tauri::command]
pub fn fetch_messages(application_id: String) -> Result<Vec<PlaintextMessage>, String> {
    let (sk, _pk, my_user_id) = ensure_keypair()?;
    let url = format!(
        "{}/api/messaging/threads/{}/messages?user_id={}",
        PROD_API, application_id, my_user_id
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }
    let server_msgs: Vec<ServerMessage> = resp.json().map_err(|e| format!("bad JSON: {e}"))?;
    let mut out = Vec::with_capacity(server_msgs.len());
    // Cache pubkey lookups so we do at most one HTTP call per counterpart,
    // not one per message. Was the cause of UI freezes on refresh.
    let mut pk_cache: std::collections::HashMap<String, crypto_box::PublicKey> =
        std::collections::HashMap::new();
    for m in server_msgs {
        let counterpart_id = if m.from_user_id == my_user_id {
            m.to_user_id.clone()
        } else {
            m.from_user_id.clone()
        };
        let counterpart_pk = if let Some(pk) = pk_cache.get(&counterpart_id) {
            pk.clone()
        } else {
            match lookup_recipient_pk(&counterpart_id) {
                Ok(pk) => { pk_cache.insert(counterpart_id.clone(), pk.clone()); pk }
                Err(_) => continue,
            }
        };
        let salsa = SalsaBox::new(&counterpart_pk, &sk);
        let raw = match base64::engine::general_purpose::STANDARD.decode(&m.ciphertext_b64) {
            Ok(r) => r, Err(_) => continue,
        };
        if raw.len() < 24 { continue; }
        let (nonce_bytes, ct) = raw.split_at(24);
        let nonce = crypto_box::Nonce::from_slice(nonce_bytes);
        let plaintext = match salsa.decrypt(nonce, ct) {
            Ok(pt) => pt,
            Err(_) => continue,
        };
        let plaintext = String::from_utf8_lossy(&plaintext).to_string();
        out.push(PlaintextMessage {
            id: m.id,
            application_id: m.application_id,
            from_user_id: m.from_user_id,
            to_user_id: m.to_user_id,
            sender_role: m.sender_role,
            plaintext,
            sent_at: m.sent_at,
        });
    }
    Ok(out)
}

// ----- E2E attachments ------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMeta {
    pub id: String,
    pub application_id: String,
    pub from_user_id: String,
    pub to_user_id: String,
    pub original_filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sent_at: String,
}

fn guess_mime_from_path(p: &std::path::Path) -> String {
    match p.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()).as_deref() {
        Some("pdf") => "application/pdf".into(),
        Some("zip") => "application/zip".into(),
        Some("png") => "image/png".into(),
        Some("jpg") | Some("jpeg") => "image/jpeg".into(),
        Some("doc") | Some("docx") => "application/msword".into(),
        Some("txt") => "text/plain".into(),
        _ => "application/octet-stream".into(),
    }
}

#[tauri::command]
pub fn upload_encrypted_attachment(
    application_id: String,
    to_user_id: String,
    file_path: String,
) -> Result<AttachmentMeta, String> {
    let (sk, _pk, my_user_id) = ensure_keypair()?;
    let recipient_pk = lookup_recipient_pk(&to_user_id)?;
    let path = std::path::Path::new(&file_path);
    let bytes = std::fs::read(path).map_err(|e| format!("read file: {e}"))?;
    if bytes.len() > 10 * 1024 * 1024 { return Err("file too large (>10 MB)".into()); }
    let original_filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("file.bin").to_string();
    let mime_type = guess_mime_from_path(path);
    let size_bytes = bytes.len() as u64;

    let salsa = SalsaBox::new(&recipient_pk, &sk);
    let nonce = SalsaBox::generate_nonce(&mut OsRng);
    let ct = salsa.encrypt(&nonce, bytes.as_slice()).map_err(|e| format!("encrypt: {e}"))?;
    let mut payload = Vec::with_capacity(24 + ct.len());
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&ct);
    let ciphertext_b64 = base64::engine::general_purpose::STANDARD.encode(&payload);

    let url = format!("{}/api/messaging/threads/{}/attachments", PROD_API, application_id);
    let body = serde_json::json!({
        "from_user_id": my_user_id,
        "to_user_id": to_user_id,
        "ciphertext_b64": ciphertext_b64,
        "original_filename": original_filename,
        "mime_type": mime_type,
        "size_bytes": size_bytes,
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build().map_err(|e| e.to_string())?;
    let resp = client.post(&url).json(&body).send().map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status(); let b = resp.text().unwrap_or_default();
        return Err(format!("server returned {s}: {b}"));
    }
    resp.json::<AttachmentMeta>().map_err(|e| format!("bad JSON: {e}"))
}

#[tauri::command]
pub fn download_encrypted_attachment(
    attachment_id: String,
    counterpart_user_id: String,
    original_filename: String,
) -> Result<String, String> {
    let (sk, _pk, my_user_id) = ensure_keypair()?;
    let counterpart_pk = lookup_recipient_pk(&counterpart_user_id)?;
    let url = format!("{}/api/messaging/attachments/{}/body?user_id={}", PROD_API, attachment_id, my_user_id);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build().map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }
    #[derive(Deserialize)] struct Body { ciphertext_b64: String }
    let parsed: Body = resp.json().map_err(|e| format!("bad JSON: {e}"))?;
    let raw = base64::engine::general_purpose::STANDARD.decode(&parsed.ciphertext_b64)
        .map_err(|e| format!("bad b64: {e}"))?;
    if raw.len() < 24 { return Err("ciphertext too short".into()); }
    let (nonce_bytes, ct) = raw.split_at(24);
    let nonce = crypto_box::Nonce::from_slice(nonce_bytes);
    let salsa = SalsaBox::new(&counterpart_pk, &sk);
    let plaintext = salsa.decrypt(nonce, ct).map_err(|e| format!("decrypt: {e}"))?;

    let home = std::env::var_os("HOME").map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    let dir = home.join("Downloads").join("Skipi").join("Inbox");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create dir: {e}"))?;
    let mut target = dir.join(&original_filename);
    let mut idx = 1;
    while target.exists() {
        let stem = std::path::Path::new(&original_filename).file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = std::path::Path::new(&original_filename).extension().and_then(|s| s.to_str()).unwrap_or("");
        let candidate = if ext.is_empty() { format!("{}_{}", stem, idx) } else { format!("{}_{}.{}", stem, idx, ext) };
        target = dir.join(candidate);
        idx += 1;
    }
    std::fs::write(&target, &plaintext).map_err(|e| format!("write: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path_with_default(path: String) -> Result<(), String> {
    let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    Ok(())
}
