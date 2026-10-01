//! JMAP push for the active account (RFC 8620 §7.3 EventSource).
//!
//! A long-poll loop: each GET uses `closeafter=state`, so the server ends the
//! response right after the first StateChange and we reconnect. That also works
//! through reverse proxies that buffer streamed responses (mail.rotko.net's
//! nginx does — a never-ending stream would never reach us). Each StateChange's
//! JSON is forwarded to the webview over a Channel; "ping" is sent after every
//! successful round so the UI knows push is live and can poll less.

use std::sync::Mutex;
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;
use tauri::State;

use crate::vault::{http, token_for, Vault};

#[derive(Default)]
pub struct Push {
    task: Mutex<Option<JoinHandle<()>>>,
}

/// Start (or restart, e.g. after an account switch) push for the active account.
#[tauri::command]
pub fn push_start(
    push: State<'_, Push>,
    vault: State<'_, Vault>,
    url: String,
    on_event: Channel<String>,
) -> Result<(), String> {
    let token = token_for(vault.inner(), &None)?;
    let handle = tauri::async_runtime::spawn(run(url, token, on_event));
    if let Some(old) = push.task.lock().unwrap().replace(handle) {
        old.abort();
    }
    Ok(())
}

#[tauri::command]
pub fn push_stop(push: State<'_, Push>) {
    if let Some(task) = push.task.lock().unwrap().take() {
        task.abort();
    }
}

async fn run(url: String, token: String, ch: Channel<String>) {
    let mut backoff = 1u64;
    loop {
        match listen(&url, &token, &ch).await {
            Ok(()) => {
                backoff = 1;
                // The webview is gone (channel closed) → stop.
                if ch.send("ping".into()).is_err() {
                    return;
                }
            }
            Err(e) => {
                log::debug!("push: {e}; retry in {backoff}s");
                tokio::time::sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(60);
            }
        }
    }
}

/// One long-poll round. Returns Ok when the server (or a proxy timeout) closed
/// the response normally.
async fn listen(url: &str, token: &str, ch: &Channel<String>) -> Result<(), String> {
    let mut resp = http()
        .get(url)
        .header("Authorization", token)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let mut parser = SseParser::default();
    loop {
        // Bound a silent connection so a dead socket can't stall push forever.
        let chunk = match tokio::time::timeout(Duration::from_secs(300), resp.chunk()).await {
            Err(_) => return Ok(()),
            Ok(r) => r.map_err(|e| e.to_string())?,
        };
        let Some(chunk) = chunk else { return Ok(()) };
        for data in parser.feed(&chunk) {
            ch.send(data).map_err(|e| e.to_string())?;
        }
    }
}

/// Minimal SSE parser: yields the `data` of each `state` event. Handles events
/// split across chunks and CRLF line endings.
#[derive(Default)]
struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend(chunk.iter().filter(|&&b| b != b'\r'));
        let mut out = vec![];
        while let Some(pos) = self.buf.windows(2).position(|w| w == b"\n\n") {
            let block: Vec<u8> = self.buf.drain(..pos + 2).collect();
            let text = String::from_utf8_lossy(&block);
            let mut event = "message";
            let mut data = String::new();
            for line in text.lines() {
                if let Some(v) = line.strip_prefix("event:") {
                    event = v.trim();
                } else if let Some(v) = line.strip_prefix("data:") {
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(v.strip_prefix(' ').unwrap_or(v));
                }
            }
            if event == "state" && !data.is_empty() {
                out.push(data);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::SseParser;

    #[test]
    fn parses_state_events_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.feed(b"event: ping\r\ndata: {\"interval\": 30000}\r\n\r\nevent: st").is_empty());
        let got = p.feed(b"ate\r\ndata: {\"changed\":{\"et\":{\"Email\":\"s1\"}}}\r\n\r\n");
        assert_eq!(got, vec![r#"{"changed":{"et":{"Email":"s1"}}}"#.to_string()]);
        let got = p.feed(b"event: state\ndata: a\n\nevent: state\ndata: b\n\n");
        assert_eq!(got, vec!["a".to_string(), "b".to_string()]);
    }
}
