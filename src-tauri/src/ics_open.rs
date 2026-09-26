//! .ics/.ical files opened with the app (double-click / "Open with"). Paths
//! arrive via argv at launch, or from a second launch forwarded by the
//! single-instance plugin. Contents are queued here until the frontend drains
//! them with `take_pending_ics`, so a file opened before login isn't lost.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct PendingIcs(Mutex<Vec<IcsFile>>);

#[derive(Serialize, Clone)]
pub struct IcsFile {
    name: String,
    text: String,
}

const MAX_BYTES: u64 = 10 * 1024 * 1024;

fn is_ics(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("ics" | "ical" | "icalendar" | "ifb" | "vcs")
    )
}

fn arg_to_path(arg: &str, cwd: &Path) -> Option<PathBuf> {
    // Desktop launchers may pass a file:// URI instead of a path.
    let p = if let Some(rest) = arg.strip_prefix("file://") {
        PathBuf::from(percent_decode(rest))
    } else {
        PathBuf::from(arg)
    };
    let p = if p.is_absolute() { p } else { cwd.join(p) };
    is_ics(&p).then_some(p)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn read_ics(p: &Path) -> Option<IcsFile> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        log::warn!("ignoring {}: not a file or too large", p.display());
        return None;
    }
    let bytes = std::fs::read(p).ok()?;
    Some(IcsFile {
        name: p.file_name()?.to_string_lossy().into_owned(),
        // Some Outlook exports are latin-1; lossy beats refusing the file.
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Queue any .ics files among `args` and tell the frontend. Returns true if
/// anything was queued.
pub fn handle_args(app: &AppHandle, args: &[String], cwd: &Path) -> bool {
    let files: Vec<IcsFile> = args
        .iter()
        .filter_map(|a| arg_to_path(a, cwd))
        .filter_map(|p| read_ics(&p))
        .collect();
    if files.is_empty() {
        return false;
    }
    app.state::<PendingIcs>().0.lock().unwrap().extend(files);
    let _ = app.emit("ics-open", ());
    true
}

#[tauri::command]
pub fn take_pending_ics(pending: State<'_, PendingIcs>) -> Vec<IcsFile> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}
