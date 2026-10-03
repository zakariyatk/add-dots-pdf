//! ADD DOTS PDF on the desktop: the web app (apps/web/dist) in a window.
//!
//! The only thing the desktop side adds is PDFs handed over by the system.
//! Double-clicking a PDF in Explorer starts the app with the file's path as
//! an argument; if the app is already running, that second start hands its
//! arguments to the first one (single instance) and quits. Either way the
//! page asks for the paths (`launch_files`) or hears of them (`open-files`),
//! then reads each one's bytes (`read_file`).
//!
//! The page can read only the files it was handed this way, never any other
//! path: `read_file` checks the path against the ones the system gave.
//!
//! Saving: the page sends the file's bytes (`save_file`) and the desktop side
//! asks where with the system's Save dialog, then writes it there. The page
//! never names a path to write to.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Opened {
    /// given at start, not yet asked for by the page
    pending: Mutex<Vec<String>>,
    /// every path the system handed over: the only ones read_file serves
    allowed: Mutex<HashSet<PathBuf>>,
}

/// PDFs among a start's arguments (the first argument is the program itself),
/// resolved against the directory that start was made from.
fn pdf_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .filter(|p| {
            p.extension()
                .map(|e| e.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false)
        })
        .collect()
}

fn remember(state: &Opened, paths: &[PathBuf]) -> Vec<String> {
    let mut allowed = state.allowed.lock().unwrap();
    paths
        .iter()
        .map(|p| {
            allowed.insert(p.clone());
            p.to_string_lossy().into_owned()
        })
        .collect()
}

/// The PDFs the app was started with, once: a reload does not open them again.
#[tauri::command]
fn launch_files(state: tauri::State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

/// A handed-over file's bytes, sent as raw binary rather than a JSON array.
#[tauri::command]
fn read_file(path: String, state: tauri::State<'_, Opened>) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !state.allowed.lock().unwrap().contains(&p) {
        return Err("not a file this app was asked to open".into());
    }
    std::fs::read(&p)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// `%XX` escapes undone (the page sends the name through encodeURIComponent,
/// since a header carries ASCII only).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
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

/// A name the Save dialog can offer: no folders, nothing Windows refuses.
fn safe_name(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let n = n.trim().trim_matches('.').to_string();
    if n.is_empty() { "document.pdf".into() } else { n }
}

/// The bytes in the request's body, written where the reader picks.
/// Ok(None) when the dialog was cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .map(|n| safe_name(&n))
        .unwrap_or_else(|| "document.pdf".into());
    // For the tests: write into this folder without asking.
    let path = if let Ok(dir) = std::env::var("ADDDOTS_SAVE_TO") {
        Some(PathBuf::from(dir).join(&name))
    } else {
        let mut d = app.dialog().file().set_file_name(&name);
        if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
            d = d.add_filter(ext.to_uppercase(), &[ext]);
        }
        d.blocking_save_file().and_then(|f| f.into_path().ok())
    };
    let Some(path) = path else { return Ok(None) };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The window, from tauri.conf.json (which leaves creating it to this).
///
/// For the end-to-end test on Windows only: with ADDDOTS_DEVTOOLS_PORT set,
/// WebView2 also listens for DevTools on that local port, which is how
/// Playwright drives a WebView2 app. Edge's WebDriver cannot attach to this
/// app, as it looks for WebView2 in a data folder of its own choosing.
fn main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("a main window in tauri.conf.json");
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    #[cfg(windows)]
    if let Some(port) = std::env::var("ADDDOTS_DEVTOOLS_PORT").ok().and_then(|p| p.parse::<u16>().ok()) {
        // wry's own defaults, which setting any arguments replaces; and, as
        // a test runs on a machine with no one looking, no pausing of a
        // window Windows thinks hidden (drawing stopped, timers slowed to
        // once a minute: no page was ever drawn in CI)
        builder = builder.additional_browser_args(&format!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
             --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
             --disable-background-timer-throttling --remote-debugging-port={port}"
        ));
    }
    builder.build()?;
    Ok(())
}

/// This app's page in the Microsoft Store, where an update is installed
/// (the update notice in js/update.js). One fixed address: the page cannot
/// hand it any other to open.
const STORE_PAGE: &str = "ms-windows-store://pdp/?productid=9PGHPBRMLQMS";

#[tauri::command]
fn open_store() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(STORE_PAGE)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err(format!("the Microsoft Store ({STORE_PAGE}) is on Windows only"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // first, so a second start is caught before it opens a window of its own
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = pdf_args(&args, Path::new(&cwd));
            let state = app.state::<Opened>();
            let files = remember(&state, &paths);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Opened::default())
        .setup(|app| {
            // the files first: the page asks for them as soon as it loads
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let paths = pdf_args(&args, &cwd);
            let state = app.state::<Opened>();
            let files = remember(&state, &paths);
            *state.pending.lock().unwrap() = files;
            main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![launch_files, read_file, save_file, open_store])
        .run(tauri::generate_context!())
        .expect("error while running ADD DOTS PDF");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_pdfs_after_the_program_are_taken() {
        let cwd = std::env::temp_dir();
        let abs = cwd.join("elsewhere").join("b.pdf");
        let got = pdf_args(
            &args(&["adddots-pdf", "--flag", "plan.PDF", "notes.txt", &abs.to_string_lossy()]),
            &cwd,
        );
        assert_eq!(got, vec![cwd.join("plan.PDF"), abs]);
    }

    #[test]
    fn the_program_itself_is_never_a_file() {
        assert!(pdf_args(&args(&["odd.pdf"]), &std::env::temp_dir()).is_empty());
    }

    #[test]
    fn names_come_back_whole_and_safe() {
        assert_eq!(percent_decode("Plan%20A%C3%A9.pdf"), "Plan A\u{e9}.pdf");
        assert_eq!(percent_decode("50%"), "50%");
        assert_eq!(safe_name("..\\x/y:z?.pdf"), "_x_y_z_.pdf");
        assert_eq!(safe_name("  "), "document.pdf");
    }

    #[test]
    fn only_handed_over_paths_are_allowed() {
        let state = Opened::default();
        let b = std::env::temp_dir().join("b.pdf");
        let files = remember(&state, &[b.clone()]);
        assert_eq!(files, vec![b.to_string_lossy().into_owned()]);
        let allowed = state.allowed.lock().unwrap();
        assert!(allowed.contains(&b));
        assert!(!allowed.contains(&std::env::temp_dir().join("other.pdf")));
    }
}
