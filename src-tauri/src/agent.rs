// Claude subscription (OAuth) auth for the in-app agent.
//
// Logically identical to ~/rotko/zish: reuse Claude Code's existing login at
// ~/.claude/.credentials.json (the `claudeAiOauth` token), refresh it via
// platform.claude.com when (nearly) expired, and call api.anthropic.com with
// `Authorization: Bearer` + the OAuth/Claude-Code beta headers. No API key, so
// usage draws on the user's Claude subscription, not pay-per-token credits.
//
// The token lives in Rust and is never exposed to the webview — the frontend
// only sends a Messages API request body to `claude_message` and gets the JSON
// response back, exactly like the JMAP proxy.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// The Claude Code OAuth client id (same one zish uses).
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// Beta flags Claude Code sends on OAuth requests (mirrors ~/rotko/zish exactly).
const ANTHROPIC_BETA: &str =
    "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05";
// First system block Claude Code prepends so the OAuth token is accepted as a
// Claude-Code-compatible client (zish's billing header — not a "You are Claude
// Code" identity line).
const CC_BILLING_HEADER: &str =
    "x-anthropic-billing-header: cc_version=2.1.81.df2; cc_entrypoint=cli; cch=a1b2c;";

// OAuth (PKCE, paste-code) endpoints — the Claude Code subscription flow.
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const REDIRECT_URI: &str = "https://console.anthropic.com/oauth/code/callback";
const OAUTH_SCOPES: &str = "org:create_api_key user:profile user:inference";

fn creds_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".claude/.credentials.json"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Webjmail's OWN OAuth credentials file. We never write to or delete Claude
/// Code's `~/.claude/.credentials.json` — that file belongs to Claude Code; we
/// only read it (read-only) as a fallback so an existing Claude Code login is
/// reused without forcing a re-login.
fn app_creds_path() -> Result<PathBuf, String> {
    if let Ok(d) = std::env::var("WEBJMAIL_CONFIG_DIR") {
        return Ok(PathBuf::from(d).join("claude_oauth.json"));
    }
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".config")))
        .map_err(|_| "no config dir (HOME/XDG_CONFIG_HOME unset)".to_string())?;
    Ok(base.join("net.rotko.webjmail").join("claude_oauth.json"))
}

/// Current OAuth object, preferring webjmail's own store, then Claude Code's
/// file (read-only). Returns `(oauth_object, from_app_store)`.
fn read_oauth_object() -> Option<(Value, bool)> {
    let has_token = |o: &Value| {
        o.get("accessToken").and_then(|x| x.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
    };
    // 1) Our own store (stored as the bare oauth object).
    if let Ok(p) = app_creds_path() {
        if let Some(v) = std::fs::read_to_string(&p).ok().and_then(|c| serde_json::from_str::<Value>(&c).ok()) {
            if has_token(&v) {
                return Some((v, true));
            }
        }
    }
    // 2) Fallback: Claude Code's login, read-only.
    if let Ok(p) = creds_path() {
        if let Some(full) = std::fs::read_to_string(&p).ok().and_then(|c| serde_json::from_str::<Value>(&c).ok()) {
            if let Some(o) = full.get("claudeAiOauth") {
                if has_token(o) {
                    return Some((o.clone(), false));
                }
            }
        }
    }
    None
}

/// Write tokens to webjmail's own store (0600). Never touches Claude Code's file.
fn write_app_oauth(
    access: &str,
    refresh: &str,
    expires_in: i64,
    scopes: Option<Value>,
    subscription_type: Option<&str>,
) -> Result<(), String> {
    let mut o = json!({
        "accessToken": access,
        "refreshToken": refresh,
        "expiresAt": now_ms() + expires_in * 1000,
        "subscriptionType": subscription_type.unwrap_or("unknown"),
    });
    if let Some(s) = scopes {
        o["scopes"] = s;
    }
    save_oauth_object(&o)
}

/// Write an oauth object verbatim to webjmail's own store (0600). Used both to
/// persist refreshed/new tokens and to ADOPT (copy) an existing Claude Code
/// login into our own store on first use, so we stop depending on their file.
fn save_oauth_object(o: &Value) -> Result<(), String> {
    let path = app_creds_path()?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&path, serde_json::to_string(o).unwrap_or_default()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// POST the refresh grant; persist the rotated tokens to OUR store, return the
/// new access token.
async fn refresh_into_app_store(refresh_token: &str, prev: &Value) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={refresh_token}&client_id={OAUTH_CLIENT_ID}"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("token refresh failed ({}): {text}", status.as_u16()));
    }
    let body: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("refresh response missing access_token")?
        .to_string();
    let new_refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    let expires_in = body.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(28800);
    write_app_oauth(
        &access,
        &new_refresh,
        expires_in,
        prev.get("scopes").cloned(),
        prev.get("subscriptionType").and_then(|v| v.as_str()),
    )?;
    Ok(access)
}

/// A valid subscription access token, refreshed (into our own store) if within
/// 5 min of expiry.
async fn claude_token() -> Result<String, String> {
    let (oauth, from_app) = read_oauth_object().ok_or_else(|| {
        "Not signed in to Claude — sign in from the assistant panel (gear → Claude).".to_string()
    })?;
    // First use of a reused Claude Code login: adopt it into our own store so we
    // operate self-contained from here on and never touch their file again.
    if !from_app {
        let _ = save_oauth_object(&oauth);
    }
    let access = oauth
        .get("accessToken")
        .and_then(|v| v.as_str())
        .ok_or("stored credentials have no accessToken")?
        .to_string();
    let expires_at = oauth.get("expiresAt").and_then(|v| v.as_i64()).unwrap_or(0);
    if now_ms() >= expires_at - 300_000 {
        if let Some(rt) = oauth.get("refreshToken").and_then(|v| v.as_str()) {
            if let Ok(new) = refresh_into_app_store(rt, &oauth).await {
                return Ok(new);
            }
        }
    }
    Ok(access)
}

/// Rewrite `system` into the Claude-Code-compatible array Claude Code sends on
/// OAuth requests: a billing-header text block first, then the caller's own
/// system prompt (cached). Matches ~/rotko/zish, which is what makes the
/// subscription token accepted by the API.
fn inject_system_identity(v: &mut Value) {
    let billing = json!({ "type": "text", "text": CC_BILLING_HEADER });
    let mut blocks = vec![billing];
    match v.get("system").cloned() {
        Some(Value::String(s)) => blocks.push(json!({
            "type": "text",
            "text": s,
            "cache_control": { "type": "ephemeral", "ttl": "1h" }
        })),
        Some(Value::Array(arr)) => blocks.extend(arr),
        _ => {}
    }
    v["system"] = Value::Array(blocks);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAuthStatus {
    logged_in: bool,
    subscription_type: Option<String>,
    expired: bool,
    /// Where the token came from: "app" (webjmail's own login) or "claude-code"
    /// (reused Claude Code login, read-only). null when not signed in.
    source: Option<String>,
}

/// Whether a Claude subscription login is available (for the UI to show state).
#[tauri::command]
pub fn claude_auth_status() -> ClaudeAuthStatus {
    match read_oauth_object() {
        Some((oauth, from_app)) => {
            let expires_at = oauth.get("expiresAt").and_then(|v| v.as_i64()).unwrap_or(0);
            ClaudeAuthStatus {
                logged_in: true,
                subscription_type: oauth.get("subscriptionType").and_then(|v| v.as_str()).map(|s| s.to_string()),
                expired: now_ms() >= expires_at,
                source: Some(if from_app { "app".into() } else { "claude-code".into() }),
            }
        }
        None => ClaudeAuthStatus { logged_in: false, subscription_type: None, expired: false, source: None },
    }
}

/// Sign out of webjmail's OWN Claude login (deletes only our `claude_oauth.json`).
/// Claude Code's `~/.claude/.credentials.json` is never touched.
#[tauri::command]
pub fn claude_logout() -> Result<(), String> {
    let path = app_creds_path()?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Attach the exact headers Claude Code sends on an OAuth Messages request, so
/// the subscription token is accepted. Lifted verbatim from ~/rotko/zish.
fn cc_message_request(client: &reqwest::Client, token: &str, body: String) -> reqwest::RequestBuilder {
    client
        .post("https://api.anthropic.com/v1/messages?beta=true")
        .header("authorization", format!("Bearer {token}"))
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", ANTHROPIC_BETA)
        .header("anthropic-dangerous-direct-browser-access", "true")
        .header("x-app", "cli")
        .header("user-agent", "claude-cli/2.1.81 (external, cli)")
        .header("x-service-name", "claude-code")
        .header("x-stainless-lang", "js")
        .header("x-stainless-package-version", "0.74.0")
        .header("x-stainless-runtime", "node")
        .header("x-stainless-runtime-version", "v25.7.0")
        .header("x-stainless-os", "Linux")
        .header("x-stainless-arch", "x64")
        .header("x-stainless-retry-count", "0")
        .header("x-stainless-timeout", "120")
        .header("content-type", "application/json")
        .body(body)
}

/// Proxy a Claude Messages API call using the subscription token. `body` is the
/// full /v1/messages request JSON; returns the response JSON.
#[tauri::command]
pub async fn claude_message(body: String) -> Result<String, String> {
    let token = claude_token().await?;
    let mut v: Value = serde_json::from_str(&body).map_err(|e| format!("invalid request body: {e}"))?;
    inject_system_identity(&mut v);

    let client = reqwest::Client::new();
    let resp = cc_message_request(&client, &token, serde_json::to_string(&v).map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Claude API {}: {text}", status.as_u16()));
    }
    Ok(text)
}

/// Streaming variant: relays raw SSE chunks from the Messages API to the JS
/// caller over a Tauri Channel; the frontend parses the Anthropic event stream.
#[tauri::command]
pub async fn claude_message_stream(
    body: String,
    on_chunk: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    let token = claude_token().await?;
    let mut v: Value = serde_json::from_str(&body).map_err(|e| format!("invalid request body: {e}"))?;
    inject_system_identity(&mut v);
    v["stream"] = json!(true);

    let client = reqwest::Client::new();
    let mut resp = cc_message_request(&client, &token, serde_json::to_string(&v).map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API {}: {text}", status.as_u16()));
    }
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        let s = String::from_utf8_lossy(&chunk).to_string();
        on_chunk.send(s).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// OAuth login (PKCE, paste-code) — sign in to the Claude subscription without
// Claude Code installed. Mirrors `ant auth login --no-browser`: we open the
// authorize URL in the system browser, the user approves and copies the
// `code#state` shown on the callback page, pastes it back, and we exchange it
// for tokens stored in ~/.claude/.credentials.json (the same file the proxy
// reads). No client secret — this is a public OAuth client + PKCE.
// ---------------------------------------------------------------------------

fn base64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Generate a PKCE (verifier, S256 challenge) pair.
fn pkce_pair() -> (String, String) {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let verifier = base64url(&raw);
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn random_state() -> String {
    let mut raw = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut raw);
    base64url(&raw)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    /// Authorize URL to open in the browser.
    url: String,
    /// PKCE verifier the frontend must echo back to `claude_login_finish`.
    verifier: String,
}

/// Begin the OAuth flow: build the authorize URL + PKCE verifier. The frontend
/// opens `url` externally, then collects the pasted `code#state` and calls
/// `claude_login_finish` with that code plus this `verifier`.
#[tauri::command]
pub fn claude_login_start() -> Result<LoginStart, String> {
    let (verifier, challenge) = pkce_pair();
    let state = random_state();
    let url = reqwest::Url::parse_with_params(
        AUTHORIZE_URL,
        &[
            ("code", "true"),
            ("client_id", OAUTH_CLIENT_ID),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT_URI),
            ("scope", OAUTH_SCOPES),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(LoginStart { url: url.to_string(), verifier })
}

/// application/x-www-form-urlencoded encoding for a single value.
fn form_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// POST the `authorization_code` grant to one host with one body encoding.
/// Returns the parsed token JSON on 2xx, else an error string.
async fn exchange_code(
    client: &reqwest::Client,
    host: &str,
    code: &str,
    state: &Option<String>,
    verifier: &str,
    as_json: bool,
) -> Result<Value, String> {
    let url = format!("{host}/v1/oauth/token");
    let req = if as_json {
        let mut body = json!({
            "grant_type": "authorization_code",
            "code": code,
            "client_id": OAUTH_CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
        });
        if let Some(s) = state {
            body["state"] = json!(s);
        }
        client
            .post(&url)
            .header("content-type", "application/json")
            .body(serde_json::to_string(&body).map_err(|e| e.to_string())?)
    } else {
        let mut form = format!(
            "grant_type=authorization_code&code={}&client_id={}&redirect_uri={}&code_verifier={}",
            form_encode(code),
            form_encode(OAUTH_CLIENT_ID),
            form_encode(REDIRECT_URI),
            form_encode(verifier),
        );
        if let Some(s) = state {
            form.push_str(&format!("&state={}", form_encode(s)));
        }
        client
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form)
    };
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{} {}", status.as_u16(), text.chars().take(180).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|e| format!("bad token response: {e}"))
}

/// Complete the OAuth flow: exchange the pasted `code` (may be `code#state`)
/// plus the PKCE `verifier` for tokens, store them, and report auth status.
#[tauri::command]
pub async fn claude_login_finish(code: String, verifier: String) -> Result<ClaudeAuthStatus, String> {
    let trimmed = code.trim();
    let (auth_code, state) = match trimmed.split_once('#') {
        Some((c, s)) => (c.to_string(), Some(s.to_string())),
        None => (trimmed.to_string(), None),
    };
    if auth_code.is_empty() {
        return Err("No code provided".into());
    }

    // Exchange the code. The canonical Claude Code flow posts JSON to
    // console.anthropic.com, but that host sometimes hits a Cloudflare
    // challenge, and platform.claude.com (the refresh host) also serves the
    // token endpoint. We can't interactively verify which combo the live
    // server wants, so try both hosts × both encodings until one returns 2xx.
    let client = reqwest::Client::new();
    let mut errors: Vec<String> = vec![];
    let mut token_json: Option<Value> = None;
    'outer: for host in ["https://console.anthropic.com", "https://platform.claude.com"] {
        for as_json in [true, false] {
            match exchange_code(&client, host, &auth_code, &state, &verifier, as_json).await {
                Ok(v) => {
                    token_json = Some(v);
                    break 'outer;
                }
                Err(e) => errors.push(format!("{host} ({}): {e}", if as_json { "json" } else { "form" })),
            }
        }
    }
    let v = token_json.ok_or_else(|| format!("Sign-in failed. {}", errors.join(" | ")))?;

    let access = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or("token response missing access_token")?
        .to_string();
    let refresh = v.get("refresh_token").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(28800);
    let scopes = v
        .get("scope")
        .and_then(|x| x.as_str())
        .map(|s| json!(s.split(' ').filter(|x| !x.is_empty()).collect::<Vec<_>>()));

    write_app_oauth(&access, &refresh, expires_in, scopes, None)?;
    Ok(claude_auth_status())
}
