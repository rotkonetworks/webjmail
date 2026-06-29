// Age-encrypted credential vault + CORS-free JMAP proxy.
//
// Why this exists:
//  - The webview loads from `tauri://localhost`, so any fetch() to the JMAP
//    server is cross-origin and blocked by CORS. We proxy JMAP traffic through
//    reqwest on the Rust side instead, where CORS does not apply.
//  - Credentials live in an age-encrypted file decrypted by a local X25519
//    identity key. The plaintext password never enters the JS context — Rust
//    holds the Basic-auth token and attaches it to every request.
//
// Files (under the app config dir, override with $WEBJMAIL_CONFIG_DIR):
//   identity.txt     -> age X25519 secret key (the "master key"), 0600
//   credentials.age  -> age-encrypted JSON {server, username, password}, 0600

use std::io::{Read, Write};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;

use age::secrecy::ExposeSecret;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

/// One authenticated account: the JMAP server + its Basic-auth token.
#[derive(Clone)]
struct AccountAuth {
    // Read only on desktop (account switching); unused on mobile.
    #[cfg_attr(mobile, allow(dead_code))]
    server: String,
    token: String,
}

#[derive(Default)]
pub struct Vault {
    /// Legacy single-account token (manual login / credentials.age).
    token: Mutex<Option<String>>,
    /// Multi-account tokens keyed by account name, loaded from accounts.toml.
    accounts: Mutex<HashMap<String, AccountAuth>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Credentials {
    server: String,
    username: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    content_type: String,
    /// base64-encoded body
    data: String,
}

// ---------------------------------------------------------------------------
// Paths & filesystem helpers
// ---------------------------------------------------------------------------

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(d) = std::env::var("WEBJMAIL_CONFIG_DIR") {
        return Ok(PathBuf::from(d));
    }
    app.path().app_config_dir().map_err(|e| e.to_string())
}

#[cfg(unix)]
fn set_perms_600(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_perms_600(_p: &Path) {}

// ---------------------------------------------------------------------------
// Multi-account manifest (accounts.toml) — read your age store live
// ---------------------------------------------------------------------------
//
// The manifest contains POINTERS, never passwords: each account names the age
// file, the identity that decrypts it, and the JSON path to the password.
// Passwords are decrypted fresh on launch and held only in memory.

#[cfg(desktop)]
#[derive(Deserialize)]
struct Manifest {
    #[serde(default)]
    account: Vec<AccountSpec>,
}

#[cfg(desktop)]
#[derive(Deserialize, Clone)]
struct AccountSpec {
    name: String,
    server: String,
    username: String,
    file: String,
    identity: String,
    /// Path of keys/indices into the decrypted JSON, e.g. ["hq@rotko.net","password"].
    json_path: Vec<String>,
}

/// Account info safe to hand to the frontend — never includes the password.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPublic {
    name: String,
    server: String,
    username: String,
}

#[cfg(desktop)]
fn expand_tilde(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(p)
}

#[cfg(desktop)]
fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("accounts.toml")
}

#[cfg(desktop)]
fn load_manifest(dir: &Path) -> Result<Option<Manifest>, String> {
    let p = manifest_path(dir);
    if !p.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let manifest: Manifest = toml::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(manifest))
}

/// Decrypt an age file by shelling out to the `age` CLI. This transparently
/// handles every recipient type the user has (X25519 and ssh-ed25519/rsa),
/// matching exactly how their store is documented to be decrypted.
///
/// Desktop-only: it spawns a process and reads identities from the user's home
/// (`~/.ssh`, `~/.age`), neither of which exists in a mobile app sandbox. Mobile
/// builds authenticate via the login form + credentials.age instead.
#[cfg(desktop)]
fn age_decrypt(identity: &str, file: &str) -> Result<Vec<u8>, String> {
    use std::process::Command;
    let age_bin = std::env::var("WEBJMAIL_AGE_BIN").unwrap_or_else(|_| "age".to_string());
    let out = Command::new(age_bin)
        .arg("-d")
        .arg("-i")
        .arg(expand_tilde(identity))
        .arg(expand_tilde(file))
        .output()
        .map_err(|e| format!("failed to run age: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "age failed for {file}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

/// Walk a JSON value by the manifest's json_path (object keys or array indices)
/// and return the final scalar as a string.
#[cfg(desktop)]
fn extract_at_path<'a>(mut v: &'a Value, path: &[String]) -> Option<&'a Value> {
    for key in path {
        v = match v {
            Value::Object(map) => map.get(key)?,
            Value::Array(arr) => arr.get(key.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(v)
}

/// Decrypt one account's secret and build its Basic-auth token.
#[cfg(desktop)]
fn resolve_account(spec: &AccountSpec) -> Result<AccountAuth, String> {
    let plaintext = age_decrypt(&spec.identity, &spec.file)?;
    let json: Value = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("{}: secret is not JSON: {e}", spec.name))?;
    let password = extract_at_path(&json, &spec.json_path)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{}: no string password at json_path", spec.name))?;
    Ok(AccountAuth {
        server: spec.server.clone(),
        token: make_token(&spec.username, password),
    })
}

// ---------------------------------------------------------------------------
// Age identity & credential encryption
// ---------------------------------------------------------------------------

fn read_identity(dir: &Path) -> Result<Option<age::x25519::Identity>, String> {
    let p = dir.join("identity.txt");
    if !p.exists() {
        return Ok(None);
    }
    let s = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let id = age::x25519::Identity::from_str(s.trim()).map_err(|e| e.to_string())?;
    Ok(Some(id))
}

/// Load the master key, generating (and persisting) one if it doesn't exist yet.
fn ensure_identity(dir: &Path) -> Result<age::x25519::Identity, String> {
    if let Some(id) = read_identity(dir)? {
        return Ok(id);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let id = age::x25519::Identity::generate();
    let p = dir.join("identity.txt");
    std::fs::write(&p, id.to_string().expose_secret().as_bytes()).map_err(|e| e.to_string())?;
    set_perms_600(&p);
    Ok(id)
}

#[allow(dead_code)] // legacy single-account writer; reads still supported for migration
fn encrypt_credentials(dir: &Path, creds: &Credentials) -> Result<(), String> {
    let id = ensure_identity(dir)?;
    let recipient = id.to_public();
    let plaintext = serde_json::to_vec(creds).map_err(|e| e.to_string())?;

    let encryptor = age::Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or_else(|| "no age recipients".to_string())?;
    let mut encrypted = vec![];
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|e| e.to_string())?;
    writer.write_all(&plaintext).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;

    let p = dir.join("credentials.age");
    std::fs::write(&p, &encrypted).map_err(|e| e.to_string())?;
    set_perms_600(&p);
    Ok(())
}

fn decrypt_credentials(dir: &Path) -> Result<Option<Credentials>, String> {
    let p = dir.join("credentials.age");
    if !p.exists() {
        return Ok(None);
    }
    let id = read_identity(dir)?.ok_or_else(|| "identity.txt is missing".to_string())?;
    let encrypted = std::fs::read(&p).map_err(|e| e.to_string())?;

    let decryptor = match age::Decryptor::new(&encrypted[..]).map_err(|e| e.to_string())? {
        age::Decryptor::Recipients(d) => d,
        age::Decryptor::Passphrase(_) => {
            return Err("credentials.age is passphrase-encrypted; expected key-based".into())
        }
    };
    let mut decrypted = vec![];
    let mut reader = decryptor
        .decrypt(std::iter::once(&id as &dyn age::Identity))
        .map_err(|e| e.to_string())?;
    reader
        .read_to_end(&mut decrypted)
        .map_err(|e| e.to_string())?;

    let creds: Credentials = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;
    Ok(Some(creds))
}

// ---------------------------------------------------------------------------
// UI-managed multi-account vault (accounts.age) — all platforms
// ---------------------------------------------------------------------------
//
// Unlike accounts.toml (manifest pointers into the user's live age store, desktop
// only), this is the app's OWN encrypted store of accounts the user added from the
// UI. Same age master key as credentials.age; the password never leaves Rust.

#[derive(Serialize, Deserialize, Clone)]
struct StoredAccount {
    name: String,
    server: String,
    username: String,
    password: String,
}

fn accounts_file_path(dir: &Path) -> PathBuf {
    dir.join("accounts.age")
}

fn load_stored_accounts(dir: &Path) -> Result<Vec<StoredAccount>, String> {
    let p = accounts_file_path(dir);
    if !p.exists() {
        return Ok(vec![]);
    }
    let id = read_identity(dir)?.ok_or_else(|| "identity.txt is missing".to_string())?;
    let encrypted = std::fs::read(&p).map_err(|e| e.to_string())?;
    let decryptor = match age::Decryptor::new(&encrypted[..]).map_err(|e| e.to_string())? {
        age::Decryptor::Recipients(d) => d,
        age::Decryptor::Passphrase(_) => {
            return Err("accounts.age is passphrase-encrypted; expected key-based".into())
        }
    };
    let mut decrypted = vec![];
    let mut reader = decryptor
        .decrypt(std::iter::once(&id as &dyn age::Identity))
        .map_err(|e| e.to_string())?;
    reader
        .read_to_end(&mut decrypted)
        .map_err(|e| e.to_string())?;
    let list: Vec<StoredAccount> = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;
    Ok(list)
}

fn save_stored_accounts(dir: &Path, accounts: &[StoredAccount]) -> Result<(), String> {
    let id = ensure_identity(dir)?;
    let recipient = id.to_public();
    let plaintext = serde_json::to_vec(accounts).map_err(|e| e.to_string())?;
    let encryptor = age::Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or_else(|| "no age recipients".to_string())?;
    let mut encrypted = vec![];
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|e| e.to_string())?;
    writer.write_all(&plaintext).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    let p = accounts_file_path(dir);
    std::fs::write(&p, &encrypted).map_err(|e| e.to_string())?;
    set_perms_600(&p);
    Ok(())
}

fn upsert_stored_account(dir: &Path, acct: StoredAccount) -> Result<(), String> {
    let mut list = load_stored_accounts(dir).unwrap_or_default();
    if let Some(existing) = list.iter_mut().find(|a| a.name == acct.name) {
        *existing = acct;
    } else {
        list.push(acct);
    }
    save_stored_accounts(dir, &list)
}

fn remove_stored_account(dir: &Path, name: &str) -> Result<(), String> {
    let mut list = load_stored_accounts(dir).unwrap_or_default();
    list.retain(|a| a.name != name);
    save_stored_accounts(dir, &list)
}

/// Resolve a named account's auth from: in-memory cache → accounts.age →
/// (desktop) accounts.toml manifest. Caches the result in the vault.
fn resolve_named_account(app: &AppHandle, vault: &Vault, name: &str) -> Result<AccountAuth, String> {
    if let Some(a) = vault.accounts.lock().unwrap().get(name).cloned() {
        return Ok(a);
    }
    let dir = config_dir(app)?;
    if let Ok(stored) = load_stored_accounts(&dir) {
        if let Some(a) = stored.iter().find(|a| a.name == name) {
            let auth = AccountAuth {
                server: a.server.clone(),
                token: make_token(&a.username, &a.password),
            };
            vault
                .accounts
                .lock()
                .unwrap()
                .insert(name.to_string(), auth.clone());
            return Ok(auth);
        }
    }
    #[cfg(desktop)]
    if let Some(manifest) = load_manifest(&dir)? {
        if let Some(spec) = manifest.account.iter().find(|s| s.name == name) {
            let a = resolve_account(spec)?;
            vault
                .accounts
                .lock()
                .unwrap()
                .insert(name.to_string(), a.clone());
            return Ok(a);
        }
    }
    Err(format!("unknown account: {name}"))
}

// ---------------------------------------------------------------------------
// HTTP (JMAP) helpers — run on the Rust side, so no browser CORS applies
// ---------------------------------------------------------------------------

fn make_token(username: &str, password: &str) -> String {
    let raw = format!("{}:{}", username, password);
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw)
    )
}

/// Select the auth token for a request: the named account, or the active one.
fn token_for(vault: &Vault, account: &Option<String>) -> Result<String, String> {
    match account {
        Some(name) => vault
            .accounts
            .lock()
            .unwrap()
            .get(name)
            .map(|a| a.token.clone())
            .ok_or_else(|| format!("account not authenticated: {name}")),
        None => vault
            .token
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "Not authenticated".to_string()),
    }
}

/// Strip any path components from an attachment filename.
fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    if base.is_empty() {
        "attachment".to_string()
    } else {
        base.to_string()
    }
}

/// Return a non-colliding path in `dir` for `name` (appends " (n)" if needed).
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    for n in 1..1000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(name)
}

/// Return ("scheme://host[:port]", "host") for a URL string.
fn split_origin(u: &str) -> (String, String) {
    if let Some(se) = u.find("://") {
        let scheme = &u[..se];
        let after = &u[se + 3..];
        let path_rel = after.find('/').unwrap_or(after.len());
        let hostport = &after[..path_rel];
        let host = hostport.split(':').next().unwrap_or(hostport).to_string();
        return (format!("{scheme}://{hostport}"), host);
    }
    (String::new(), String::new())
}

/// Replace `scheme://host[:port]` of `url` with `new_origin`, only when the host
/// matches `match_host`. Pure string ops so `{placeholder}` templates survive.
fn rewrite_origin(url: &str, match_host: &str, new_origin: &str) -> String {
    if let Some(se) = url.find("://") {
        let after = &url[se + 3..];
        let path_rel = after.find('/').unwrap_or(after.len());
        let hostport = &after[..path_rel];
        let host = hostport.split(':').next().unwrap_or(hostport);
        if host == match_host {
            return format!("{}{}", new_origin, &after[path_rel..]);
        }
    }
    url.to_string()
}

/// Stalwart (and JMAP servers behind a reverse proxy) sometimes advertise their
/// INTERNAL bind address in the session — e.g. `http://mail.rotko.net:18080/jmap/`
/// — instead of the public URL the client reached. That URL is unreachable from
/// outside, so every request hangs. Trust the origin we actually connected to:
/// rewrite apiUrl/downloadUrl/uploadUrl/eventSourceUrl to the discovery origin
/// whenever the host matches (scheme/port differences only). A genuinely
/// different host (e.g. Fastmail's api.fastmail.com) is left untouched.
fn normalize_session_urls(session: &str, discovery: &str) -> String {
    let (origin, host) = split_origin(discovery);
    if host.is_empty() {
        return session.to_string();
    }
    let mut v: Value = match serde_json::from_str(session) {
        Ok(v) => v,
        Err(_) => return session.to_string(),
    };
    for key in ["apiUrl", "downloadUrl", "uploadUrl", "eventSourceUrl"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            let fixed = rewrite_origin(s, &host, &origin);
            if fixed != s {
                v[key] = Value::String(fixed);
            }
        }
    }
    serde_json::to_string(&v).unwrap_or_else(|_| session.to_string())
}

async fn http_get_session(server: &str, token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(server)
        .header("Authorization", token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Cannot connect to server: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "Invalid username or password",
            404 => "JMAP endpoint not found. Check the server URL.",
            _ => "Authentication failed",
        };
        return Err(format!("{hint} ({})", status.as_u16()));
    }
    // Repoint server-advertised URLs at the origin we actually reached.
    Ok(normalize_session_urls(&text, server))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Decrypt stored credentials and authenticate. Returns the JMAP session JSON,
/// or `None` if no credentials are stored yet (frontend then shows the form).
#[tauri::command]
pub async fn jmap_unlock(app: AppHandle, vault: State<'_, Vault>) -> Result<Option<String>, String> {
    let dir = config_dir(&app)?;

    // 1) UI-managed multi-account vault (accounts.age) — all platforms. Build the
    //    switchable map (plus manifest accounts on desktop) and auto-login the first.
    let stored = load_stored_accounts(&dir).unwrap_or_default();
    if !stored.is_empty() {
        let mut map: HashMap<String, AccountAuth> = HashMap::new();
        for a in &stored {
            map.insert(
                a.name.clone(),
                AccountAuth {
                    server: a.server.clone(),
                    token: make_token(&a.username, &a.password),
                },
            );
        }
        #[cfg(desktop)]
        if let Some(manifest) = load_manifest(&dir)? {
            for spec in &manifest.account {
                if map.contains_key(&spec.name) {
                    continue;
                }
                if let Ok(auth) = resolve_account(spec) {
                    map.insert(spec.name.clone(), auth);
                }
            }
        }
        let first = &stored[0];
        let token = make_token(&first.username, &first.password);
        let session = http_get_session(&first.server, &token).await?;
        *vault.token.lock().unwrap() = Some(token);
        *vault.accounts.lock().unwrap() = map;
        return Ok(Some(session));
    }

    // 2) Legacy single-account vault (persisted by a manual login).
    if let Some(creds) = decrypt_credentials(&dir)? {
        let token = make_token(&creds.username, &creds.password);
        let session = http_get_session(&creds.server, &token).await?;
        *vault.token.lock().unwrap() = Some(token);
        return Ok(Some(session));
    }

    // 3) Multi-account manifest: resolve every account, auto-login the first.
    //    Desktop-only — reads the user's live age store (CLI + ~/.ssh identities),
    //    which doesn't exist on mobile. Mobile falls through to the login form.
    #[cfg(desktop)]
    if let Some(manifest) = load_manifest(&dir)? {
        let mut map: HashMap<String, AccountAuth> = HashMap::new();
        for spec in &manifest.account {
            match resolve_account(spec) {
                Ok(auth) => {
                    map.insert(spec.name.clone(), auth);
                }
                Err(e) => log::warn!("account {} skipped: {e}", spec.name),
            }
        }

        let first = manifest
            .account
            .iter()
            .find(|s| map.contains_key(&s.name))
            .and_then(|s| map.get(&s.name).cloned());

        let session = if let Some(auth) = first {
            let session = http_get_session(&auth.server, &auth.token).await?;
            *vault.token.lock().unwrap() = Some(auth.token.clone());
            Some(session)
        } else {
            None
        };

        *vault.accounts.lock().unwrap() = map;
        return Ok(session);
    }

    Ok(None)
}

/// List configured accounts for the UI switcher. Merges the UI-managed vault
/// (accounts.age, all platforms) with the accounts.toml manifest (desktop only),
/// caching each resolved token in memory. Passwords are never returned.
#[tauri::command]
pub fn accounts_list(app: AppHandle, vault: State<'_, Vault>) -> Result<Vec<AccountPublic>, String> {
    let dir = config_dir(&app)?;
    let mut map: HashMap<String, AccountAuth> = HashMap::new();
    let mut list: Vec<AccountPublic> = vec![];

    // UI-added accounts (accounts.age) — works on desktop AND mobile/web-Tauri.
    if let Ok(stored) = load_stored_accounts(&dir) {
        for a in stored {
            map.insert(
                a.name.clone(),
                AccountAuth {
                    server: a.server.clone(),
                    token: make_token(&a.username, &a.password),
                },
            );
            list.push(AccountPublic {
                name: a.name,
                server: a.server,
                username: a.username,
            });
        }
    }

    // Manifest accounts (pointers into the live age store) — desktop only.
    #[cfg(desktop)]
    if let Some(manifest) = load_manifest(&dir)? {
        for spec in &manifest.account {
            if list.iter().any(|x| x.name == spec.name) {
                continue;
            }
            list.push(AccountPublic {
                name: spec.name.clone(),
                server: spec.server.clone(),
                username: spec.username.clone(),
            });
            match resolve_account(spec) {
                Ok(auth) => {
                    map.insert(spec.name.clone(), auth);
                }
                Err(e) => log::warn!("account {} did not resolve: {e}", spec.name),
            }
        }
    }

    *vault.accounts.lock().unwrap() = map;
    Ok(list)
}

/// Authenticate a specific account and make it the active session.
#[tauri::command]
pub async fn account_authenticate(
    app: AppHandle,
    vault: State<'_, Vault>,
    name: String,
) -> Result<String, String> {
    let auth = resolve_named_account(&app, vault.inner(), &name)?;
    let session = http_get_session(&auth.server, &auth.token).await?;
    *vault.token.lock().unwrap() = Some(auth.token.clone());
    Ok(session)
}

/// Like `account_authenticate`, but returns the account's JMAP session WITHOUT
/// changing the active account. Used by the unified inbox to query each account
/// in parallel.
#[tauri::command]
pub async fn account_session(
    app: AppHandle,
    vault: State<'_, Vault>,
    name: String,
) -> Result<String, String> {
    let auth = resolve_named_account(&app, vault.inner(), &name)?;
    http_get_session(&auth.server, &auth.token).await
}

/// Add an account from the UI: authenticate, persist to the multi-account vault
/// (accounts.age — password stays in Rust), and make it the active session.
/// Works on all platforms.
#[tauri::command]
pub async fn account_add(
    app: AppHandle,
    vault: State<'_, Vault>,
    server: String,
    username: String,
    password: String,
    name: Option<String>,
) -> Result<String, String> {
    let token = make_token(&username, &password);
    let session = http_get_session(&server, &token).await?;

    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| username.clone());
    let dir = config_dir(&app)?;
    if let Err(e) = upsert_stored_account(
        &dir,
        StoredAccount {
            name: name.clone(),
            server: server.clone(),
            username,
            password,
        },
    ) {
        log::warn!("failed to persist account to vault: {e}");
    }

    vault.accounts.lock().unwrap().insert(
        name.clone(),
        AccountAuth {
            server,
            token: token.clone(),
        },
    );
    *vault.token.lock().unwrap() = Some(token);
    Ok(session)
}

/// Remove a UI-managed account from the vault (accounts.age). Manifest accounts
/// can't be removed here — they live in accounts.toml.
#[tauri::command]
pub fn account_remove(app: AppHandle, vault: State<'_, Vault>, name: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    remove_stored_account(&dir, &name)?;
    vault.accounts.lock().unwrap().remove(&name);
    Ok(())
}

/// Authenticate with explicit credentials (the login-form fallback) and, on
/// success, persist them to the age vault so future launches are passwordless.
#[tauri::command]
pub async fn jmap_login(
    app: AppHandle,
    vault: State<'_, Vault>,
    server: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let token = make_token(&username, &password);
    let session = http_get_session(&server, &token).await?;

    // Persist into the multi-account vault (accounts.age) so the account shows in
    // the switcher and survives restarts. Best effort — must not fail the login.
    let name = username.clone();
    let dir = config_dir(&app)?;
    if let Err(e) = upsert_stored_account(
        &dir,
        StoredAccount {
            name: name.clone(),
            server: server.clone(),
            username,
            password,
        },
    ) {
        log::warn!("failed to persist account to vault: {e}");
    }

    vault.accounts.lock().unwrap().insert(
        name,
        AccountAuth {
            server,
            token: token.clone(),
        },
    );
    *vault.token.lock().unwrap() = Some(token);
    Ok(session)
}

/// Proxy a JMAP API call (POST) with the stored auth token attached.
#[tauri::command]
pub async fn jmap_request(
    vault: State<'_, Vault>,
    api_url: String,
    body: String,
    account: Option<String>,
) -> Result<String, String> {
    // Pick the named account's token if given, else the active/legacy one.
    let token = match account {
        Some(name) => vault
            .accounts
            .lock()
            .unwrap()
            .get(&name)
            .map(|a| a.token.clone())
            .ok_or_else(|| format!("account not authenticated: {name}"))?,
        None => vault
            .token
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "Not authenticated".to_string())?,
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&api_url)
        .header("Authorization", &token)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Request failed: {} {}", status.as_u16(), text));
    }
    Ok(text)
}

/// Download a blob (attachment/inline image) with auth, returned as base64.
#[tauri::command]
pub async fn jmap_download(
    vault: State<'_, Vault>,
    url: String,
) -> Result<DownloadResult, String> {
    let token = vault
        .token
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", &token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Download failed: {}", status.as_u16()));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(DownloadResult {
        content_type,
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// Download a blob (attachment) with auth and save it to the OS Downloads
/// directory. Returns the saved file path. This is how the desktop build
/// downloads attachments — an `<a download>` in the webview can't send the
/// auth header and WebKitGTK won't save a cross-origin file.
#[tauri::command]
pub async fn jmap_download_save(
    app: AppHandle,
    vault: State<'_, Vault>,
    url: String,
    filename: String,
    account: Option<String>,
) -> Result<String, String> {
    let token = token_for(vault.inner(), &account)?;

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", &token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: {}", resp.status().as_u16()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = unique_path(&dir, &sanitize_filename(&filename));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Upload a blob (attachment) with auth. `data_base64` is the file bytes; returns
/// the JMAP upload response JSON ({accountId, blobId, type, size}).
#[tauri::command]
pub async fn jmap_upload(
    vault: State<'_, Vault>,
    upload_url: String,
    content_type: String,
    data_base64: String,
    account: Option<String>,
) -> Result<String, String> {
    let token = token_for(vault.inner(), &account)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;

    let client = reqwest::Client::new();
    let resp = client
        .post(&upload_url)
        .header("Authorization", &token)
        .header("Content-Type", content_type)
        .body(bytes)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Upload failed: {} {}", status.as_u16(), text));
    }
    Ok(text)
}

/// Clear the in-memory token (ends the current session). The age vault is left
/// in place, so relaunching the app logs back in automatically.
#[tauri::command]
pub fn jmap_logout(vault: State<'_, Vault>) -> Result<(), String> {
    *vault.token.lock().unwrap() = None;
    Ok(())
}

/// Delete the stored credentials (true sign-out). The master key is kept.
#[tauri::command]
pub fn jmap_forget(app: AppHandle, vault: State<'_, Vault>) -> Result<(), String> {
    *vault.token.lock().unwrap() = None;
    vault.accounts.lock().unwrap().clear();
    let dir = config_dir(&app)?;
    for f in ["credentials.age", "accounts.age"] {
        let p = dir.join(f);
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Open a URL or file path with the OS default handler (browser / default app).
/// Used for email links and opening downloaded attachments — a webview can't do
/// either safely on its own. Routed through the cross-platform opener plugin so
/// the same command works on desktop and on Android/iOS (where spawning
/// `xdg-open`/`open` is impossible — the plugin issues a platform intent).
#[tauri::command]
pub fn open_external(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let opener = app.opener();
    let result = if target.contains("://") {
        opener.open_url(target, None::<&str>)
    } else {
        opener.open_path(target, None::<&str>)
    };
    result.map_err(|e| e.to_string())
}
