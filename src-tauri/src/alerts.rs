//! Outgoing alerts: freedesktop desktop notifications (shown by dunst, mako,
//! GNOME, …) and ntfy pushes. The frontend decides *what* to alert on; these
//! commands only deliver.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAlert {
    title: String,
    body: String,
    /// "low" | "normal" | "critical" — dunst styles/sorts by urgency.
    urgency: Option<String>,
    /// Opaque id echoed back in an `alert-click` event when the user clicks it.
    click_id: Option<String>,
    /// Notification category hint, e.g. "email.arrived", "network.error".
    category: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AlertClick {
    click_id: String,
}

// async: `show()` is a blocking D-Bus call; keep it off the main thread so a
// wedged notification daemon can't freeze the UI.
#[tauri::command(async)]
pub fn notify_desktop(app: AppHandle, alert: DesktopAlert) -> Result<(), String> {
    let mut n = notify_rust::Notification::new();
    n.summary(&alert.title)
        .body(&alert.body)
        .appname("Webjmail")
        .icon(&app_icon());

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use notify_rust::{Hint, Urgency};
        n.urgency(match alert.urgency.as_deref() {
            Some("low") => Urgency::Low,
            Some("critical") => Urgency::Critical,
            _ => Urgency::Normal,
        });
        if let Some(c) = &alert.category {
            n.hint(Hint::Category(c.clone()));
        }
        n.hint(Hint::DesktopEntry("webjmail".into()));
        if alert.click_id.is_some() {
            // "default" is what dunst/mako invoke on a plain click.
            n.action("default", "Open");
        }
    }
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    let _ = (&alert.urgency, &alert.category);

    let handle = n.show().map_err(|e| format!("Desktop notification failed: {e}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(click_id) = alert.click_id {
        // Blocks until the notification is clicked or closed, so park it on a
        // thread of its own.
        std::thread::spawn(move || {
            handle.wait_for_action(|action| {
                if action == "default" {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("alert-click", AlertClick { click_id });
                }
            });
        });
    }
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    let _ = (handle, app, alert.click_id);

    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NtfyAlert {
    /// Server base URL, e.g. "https://ntfy.sh".
    server: String,
    topic: String,
    title: String,
    message: String,
    /// 1 (min) … 5 (max); ntfy's default is 3.
    priority: Option<u8>,
    tags: Option<Vec<String>>,
    /// Access token ("tk_…") or "user:password" for protected topics.
    auth: Option<String>,
}

/// The installed icon by absolute path when present (not every daemon searches
/// ~/.local/share/icons for bare names), else the themed name.
fn app_icon() -> String {
    std::env::var_os("HOME")
        .map(|h| std::path::PathBuf::from(h).join(".local/share/icons/webjmail.png"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "webjmail".into())
}

#[tauri::command]
pub async fn ntfy_publish(alert: NtfyAlert) -> Result<(), String> {
    let server = alert.server.trim().trim_end_matches('/');
    if !(server.starts_with("https://") || server.starts_with("http://")) {
        return Err("ntfy server must be an http(s) URL".into());
    }
    let topic = alert.topic.trim();
    if topic.is_empty() {
        return Err("ntfy topic is empty".into());
    }
    // JSON publishing (POST to the server root) keeps non-ASCII titles intact,
    // which header-based publishing can't.
    let mut body = serde_json::json!({
        "topic": topic,
        "title": alert.title,
        "message": alert.message,
    });
    if let Some(p) = alert.priority {
        body["priority"] = p.clamp(1, 5).into();
    }
    if let Some(t) = alert.tags.filter(|t| !t.is_empty()) {
        body["tags"] = t.into();
    }

    let mut req = reqwest::Client::new()
        .post(server)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .timeout(std::time::Duration::from_secs(15));
    if let Some(auth) = alert.auth.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        req = match auth.split_once(':') {
            Some((user, pass)) if !auth.starts_with("tk_") => req.basic_auth(user, Some(pass)),
            _ => req.bearer_auth(auth),
        };
    }
    let resp = req.send().await.map_err(|e| format!("ntfy: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("ntfy returned {status}: {}", text.trim()));
    }
    Ok(())
}
