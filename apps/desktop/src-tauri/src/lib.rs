//! Add Dots PDF on the desktop: the web app (apps/web/dist) in a window.
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
//!
//! Windows: each PDF opens in a tab of the window (js/tabs.js), and a tab can
//! be moved to a window of its own (`new_window`). The page puts the tab's
//! document in the browser storage the windows share and names it; the new
//! window opens with that name and takes it from there. A PDF handed over
//! later goes to the window used last.
//!
//! Printing: the page's Print dialog lists the printers and prints to the
//! one picked itself (print.rs), as Acrobat does, rather than through the
//! web view's own print dialog.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

mod ocr;
mod pdfium;
mod print;
mod store;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Opened {
    /// handed over (at start, or by a later start) and not yet taken by a
    /// page: a page still loading has nobody listening for `open-files`, so
    /// they wait here rather than being lost
    pending: Mutex<Vec<String>>,
    /// handed over by Explorer's "Combine files in Add Dots PDF" (--combine)
    /// and not yet taken: made into one document, not opened one by one
    combine: Mutex<Vec<String>>,
    /// every path the system handed over: the only ones read_file serves
    allowed: Mutex<HashSet<PathBuf>>,
    /// the window used last: where a PDF handed over later opens
    last: Mutex<String>,
    /// numbers the windows a tab is moved to
    windows: AtomicU32,
    /// big files kept open to be read a part at a time (`open_plan`), by id
    ranged: Mutex<HashMap<u32, Arc<Mutex<std::fs::File>>>>,
    next_range: AtomicU32,
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

/// Whether a start is Explorer's "Combine files in Add Dots PDF" (once for
/// each file picked, as Windows runs a verb: installer.nsh, AppxManifest.xml).
fn is_combine(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--combine")
}

/// The PDFs handed over to be combined and not yet taken, once.
#[tauri::command]
fn combine_files(state: tauri::State<'_, Opened>) -> Vec<String> {
    std::mem::take(&mut *state.combine.lock().unwrap())
}

/// The PDFs handed over and not yet opened, once: a reload does not open
/// them again. The page asks at start and again on each `open-files`.
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

/// How to open a handed-over file: its size, and whether it is big enough to
/// be read a part at a time (`read_range`) rather than whole. Over 150 MB,
/// where crash recovery does not keep a copy of a file anyway, so nothing is
/// lost by not holding one; ADDDOTS_RANGE_MB sets another size (the tests).
/// `keep` asks for that whatever its size (a tab moved to a new window).
/// When it is, the file is kept open and `id` names it: the parts are read
/// from the file as it was opened, so saving over it (a new file renamed
/// into its place) does not change what the open document reads, as with
/// PDFium (pdf_open_path). `range_close` lets it go.
#[derive(serde::Serialize)]
struct OpenPlan {
    size: u64,
    ranges: bool,
    id: Option<u32>,
}

#[tauri::command]
fn open_plan(
    path: String,
    keep: Option<bool>,
    state: tauri::State<'_, Opened>,
) -> Result<OpenPlan, String> {
    let p = PathBuf::from(&path);
    if !state.allowed.lock().unwrap().contains(&p) {
        return Err("not a file this app was asked to open".into());
    }
    let size = std::fs::metadata(&p)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;
    let mb: u64 = std::env::var("ADDDOTS_RANGE_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(150);
    let ranges = keep.unwrap_or(false) || size > mb * 1024 * 1024;
    let mut id = None;
    if ranges {
        let f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
        let n = state.next_range.fetch_add(1, Ordering::SeqCst) + 1;
        state
            .ranged
            .lock()
            .unwrap()
            .insert(n, Arc::new(Mutex::new(f)));
        id = Some(n);
    }
    Ok(OpenPlan { size, ranges, id })
}

/// `len` bytes of a file kept open by `open_plan`, from `offset` (fewer at
/// its end), as raw binary: what pdf.js asks for as it reads a big file.
#[tauri::command]
async fn read_range(
    id: u32,
    offset: u64,
    len: u32,
    state: tauri::State<'_, Opened>,
) -> Result<tauri::ipc::Response, String> {
    let f = state
        .ranged
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("that file is not open")?;
    tauri::async_runtime::spawn_blocking(move || range_of(&mut f.lock().unwrap(), offset, len))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
fn range_close(id: u32, state: tauri::State<'_, Opened>) {
    state.ranged.lock().unwrap().remove(&id);
}

fn range_of(f: &mut std::fs::File, offset: u64, len: u32) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    // room for what the file has left, not for whatever was asked: a len
    // of 4 GB would otherwise be set aside before a byte is read
    let left = f.metadata().map_err(|e| e.to_string())?.len().saturating_sub(offset);
    let mut out = Vec::with_capacity(left.min(len as u64) as usize);
    f.take(len as u64)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
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
    write_atomic(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Writes a file whole or not at all. The bytes go to a temporary file
/// beside it, are flushed to the disk, and then take its place in one
/// rename: a crash, a full disk or a power cut mid-save leaves the file as
/// it was, never cut short. (A rename replaces the old file on Windows too.)
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.{}.saving", std::process::id()));
    let res = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// The main window's settings in tauri.conf.json (which leaves creating it to this).
fn main_config(app: &tauri::AppHandle) -> tauri::utils::config::WindowConfig {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("a main window in tauri.conf.json")
}

/// A window made from those settings.
///
/// For the end-to-end test on Windows only: with ADDDOTS_DEVTOOLS_PORT set,
/// WebView2 also listens for DevTools on that local port, which is how
/// Playwright drives a WebView2 app. Edge's WebDriver cannot attach to this
/// app, as it looks for WebView2 in a data folder of its own choosing. Every
/// window gets the same arguments: WebView2 refuses a second window whose
/// arguments differ from the first's.
fn build_window(app: &tauri::AppHandle, config: &tauri::utils::config::WindowConfig) -> tauri::Result<()> {
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
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

/// A tab moved to a window of its own: the window opens the document the
/// page put away under `handoff` (js/tabs.js). The name is all it is given,
/// and only a short one of letters and digits is taken. A tab dragged out of
/// the bar gives where it was let go of (`x`, `y`, on the screen): the new
/// window opens there, under the pointer, as Acrobat's does.
#[tauri::command]
fn new_window(
    app: tauri::AppHandle,
    handoff: String,
    x: Option<f64>,
    y: Option<f64>,
    state: tauri::State<'_, Opened>,
) -> Result<(), String> {
    if handoff.is_empty() || handoff.len() > 40 || !handoff.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("not a document to move".into());
    }
    let n = state.windows.fetch_add(1, Ordering::Relaxed) + 1;
    let mut config = main_config(&app);
    config.label = format!("doc-{n}");
    config.url = tauri::WebviewUrl::App(format!("index.html?handoff={handoff}").into());
    if let (Some(x), Some(y)) = (x, y) {
        if x.is_finite() && y.is_finite() {
            // the pointer over the new window's top bar, a little in from its left
            config.center = false;
            config.x = Some((x - 160.0).max(0.0));
            config.y = Some((y - 16.0).max(0.0));
        }
    }
    build_window(&app, &config).map_err(|e| e.to_string())
}

/* ---------------- pages drawn natively (pdfium.rs) ---------------- */

/// Where PDFium is: bundled beside the app (its resources), else beside the
/// .exe (the Store package), else where scripts/get-pdfium.mjs put it (a
/// development build). ADDDOTS_NATIVE=off leaves it unloaded.
fn pdfium_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = pdfium::lib_name();
    let mut places = vec![];
    if let Ok(d) = app.path().resource_dir() {
        places.push(d.join(name));
    }
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        places.push(d.join(name));
    }
    if cfg!(debug_assertions) {
        places.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium").join(name));
    }
    places.into_iter().find(|p| p.exists())
}

/// Ok(where PDFium was loaded from), or Err(why pages are drawn as before).
#[tauri::command]
fn pdf_native_status(app: tauri::AppHandle) -> Result<String, String> {
    if std::env::var("ADDDOTS_NATIVE").map(|v| v == "off").unwrap_or(false) {
        return Err("turned off (ADDDOTS_NATIVE=off)".into());
    }
    let path = pdfium_path(&app).ok_or_else(|| format!("no {} beside the app", pdfium::lib_name()))?;
    pdfium::native().start(path)
}

/// Waits off the command thread for what the PDFium thread answers.
async fn answer<T: Send + 'static>(rx: std::sync::mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or_else(|_| Err("the PDFium thread stopped".into())))
        .await
        .map_err(|e| e.to_string())?
}

/// A document's bytes (the request's body) opened as `x-key`, with the
/// password in `x-password` if it has one. Ok(its page count).
#[tauri::command]
async fn pdf_open(request: tauri::ipc::Request<'_>) -> Result<u32, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the document's bytes".into());
    };
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(percent_decode);
    let key: u32 = h("x-key").and_then(|k| k.parse().ok()).ok_or("no x-key")?;
    let rx = pdfium::native().open(key, pdfium::From::Bytes(bytes.clone()), h("x-password"))?;
    answer(rx).await
}

/// A document opened from its file on disk, read a block at a time as
/// PDFium needs it, so the app holds no copy of it. Only a file the system
/// handed over (opened from Explorer) can be read this way.
#[tauri::command]
async fn pdf_open_path(
    key: u32,
    path: String,
    password: Option<String>,
    state: tauri::State<'_, Opened>,
) -> Result<u32, String> {
    let p = PathBuf::from(&path);
    if !state.allowed.lock().unwrap().contains(&p) {
        return Err("not a file this app was asked to open".into());
    }
    let rx = pdfium::native().open(key, pdfium::From::Path(p), password)?;
    answer(rx).await
}

/// Memory running short: PDFium lets go of the pages it keeps loaded.
#[tauri::command]
fn pdf_trim() {
    pdfium::native().trim();
}

#[tauri::command]
fn pdf_close(key: u32) {
    pdfium::native().close(key);
}

/// Page `page` (from 0) of document `key` into a w x h bitmap at matrix m:
/// its pixels, RGBA, as raw bytes; with z, zlib-compressed (fast). Handing
/// the page 32 MB of pixels took longer than PDFium took to draw them, and a
/// page is mostly white: compressed, it is a tenth or less to hand over, and
/// the page unpacks it natively (DecompressionStream). Compressed here, off
/// PDFium's thread, so the next page is being drawn meanwhile.
#[tauri::command]
async fn pdf_render(
    rid: u32,
    key: u32,
    page: u32,
    m: [f32; 6],
    w: u32,
    h: u32,
    z: Option<bool>,
) -> Result<tauri::ipc::Response, String> {
    let rx = pdfium::native().render(rid, pdfium::Ask { key, page, m, w, h })?;
    let px = answer(rx).await?;
    if !z.unwrap_or(false) {
        return Ok(tauri::ipc::Response::new(px));
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        let mut e = flate2::write::ZlibEncoder::new(Vec::with_capacity(px.len() / 8), flate2::Compression::fast());
        e.write_all(&px).and_then(|_| e.finish()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
fn pdf_cancel(rid: u32) {
    pdfium::native().cancel(rid);
}

/* ---------------- printing (print.rs) ---------------- */

/// The computer's printers, and which is its default.
#[tauri::command]
async fn print_printers() -> Result<print::Printers, String> {
    tauri::async_runtime::spawn_blocking(print::printers)
        .await
        .map_err(|e| e.to_string())?
}

/// What printer `name` can do, set up as `setup`: its papers, the paper's
/// size and margins, colour and both sides.
#[tauri::command]
async fn print_caps(name: String, setup: print::Setup) -> Result<print::Caps, String> {
    tauri::async_runtime::spawn_blocking(move || print::caps(&name, &setup))
        .await
        .map_err(|e| e.to_string())?
}

/// The printer's own settings dialog, over this window. Null when it was
/// cancelled, else the settings chosen (kept for the printer's next jobs).
#[tauri::command]
async fn print_properties(
    window: tauri::WebviewWindow,
    name: String,
    setup: print::Setup,
) -> Result<Option<print::Setup>, String> {
    #[cfg(windows)]
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let hwnd = {
        let _ = window;
        0
    };
    tauri::async_runtime::spawn_blocking(move || print::properties(hwnd, &name, &setup))
        .await
        .map_err(|e| e.to_string())?
}

/// A job printed: the request's body is the job's JSON (print::Job), its
/// length first as 4 bytes (little-endian), then the PDF made for printing.
/// Ok(the sheets printed).
#[tauri::command]
async fn print_send(request: tauri::ipc::Request<'_>) -> Result<u32, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("expected the job and the document".into());
    };
    let (job, pdf) = split_job(body)?;
    let rx = pdfium::native().print(pdf.to_vec(), job)?;
    answer(rx).await
}

fn split_job(body: &[u8]) -> Result<(print::Job, &[u8]), String> {
    let n = body
        .get(..4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("no job")?;
    let json = body.get(4..4 + n).ok_or("the job is cut short")?;
    let job: print::Job = serde_json::from_slice(json).map_err(|e| format!("not a print job: {e}"))?;
    Ok((job, &body[4 + n..]))
}

/* ---------------- text read by Windows (ocr.rs) ---------------- */

/// The languages Windows can read on this computer, and the largest side
/// of a picture it takes; no languages off Windows (js/ocr.js then uses
/// Tesseract).
#[tauri::command]
async fn ocr_status() -> Result<ocr::Status, String> {
    tauri::async_runtime::spawn_blocking(ocr::status)
        .await
        .map_err(|e| e.to_string())
}

/// The words on a page's picture: its pixels (RGBA) in the request's body,
/// `x-w` x `x-h`, read in the language `x-lang` (or languages, with commas
/// between: ocr::merge).
#[tauri::command]
async fn ocr_page(request: tauri::ipc::Request<'_>) -> Result<Vec<ocr::Word>, String> {
    let tauri::ipc::InvokeBody::Raw(px) = request.body() else {
        return Err("expected the picture's pixels".into());
    };
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let n = |k: &str| h(k).and_then(|v| v.parse::<u32>().ok()).ok_or(format!("no {k}"));
    let (w, ht) = (n("x-w")?, n("x-h")?);
    let lang = h("x-lang").ok_or("no x-lang")?;
    ocr::languages(&lang)?;
    let px = px.clone();
    tauri::async_runtime::spawn_blocking(move || ocr::read(px, w, ht, &lang))
        .await
        .map_err(|e| e.to_string())?
}

/* ---------------- the performance panel (js/perf.js) ---------------- */

/// The app's own memory, in bytes: working set now and at its peak. (The
/// web view's processes report theirs to the page: performance.memory.)
#[derive(serde::Serialize)]
struct NativeMemory {
    now: u64,
    peak: u64,
}

#[cfg(windows)]
fn native_memory() -> Option<NativeMemory> {
    #[repr(C)]
    struct Counters {
        cb: u32,
        page_faults: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged: usize,
        quota_paged: usize,
        quota_peak_nonpaged: usize,
        quota_nonpaged: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }
    extern "system" {
        fn GetCurrentProcess() -> *mut std::ffi::c_void;
        fn K32GetProcessMemoryInfo(p: *mut std::ffi::c_void, c: *mut Counters, cb: u32) -> i32;
    }
    let mut c: Counters = unsafe { std::mem::zeroed() };
    c.cb = std::mem::size_of::<Counters>() as u32;
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
    (ok != 0).then(|| NativeMemory { now: c.working_set as u64, peak: c.peak_working_set as u64 })
}

#[cfg(not(windows))]
fn native_memory() -> Option<NativeMemory> {
    let s = std::fs::read_to_string("/proc/self/status").ok()?;
    let kb = |k: &str| {
        s.lines()
            .find(|l| l.starts_with(k))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse::<u64>().ok())
            .map(|v| v * 1024)
    };
    Some(NativeMemory { now: kb("VmRSS:")?, peak: kb("VmHWM:")? })
}

#[tauri::command]
fn perf_native() -> Option<NativeMemory> {
    native_memory()
}

/// Where a PDF handed over later goes: the window used last, if it is
/// still open, else any window of the app.
fn target_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let last = app.state::<Opened>().last.lock().unwrap().clone();
    app.get_webview_window(&last)
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| app.webview_windows().into_values().next())
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

/// The Add Dots pages the top bar opens in the browser (js/appbar.js), by
/// name: the page cannot hand it any other address to open.
const SITES: &[(&str, &str)] = &[
    ("about", "https://www.adddots.com/about.html"),
    ("privacy", "https://pdf.adddots.com/privacy.html"),
    ("opbuilder", "https://opbuilder.adddots.com/"),
    ("call", "https://call.adddots.com/"),
];

#[tauri::command]
fn open_site(name: String) -> Result<(), String> {
    let url = SITES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, u)| *u)
        .ok_or_else(|| "not a page this app opens".to_string())?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err(format!("{url} opens from the Windows app only"))
    }
}

/// This app's version, for "What is new": the Store package's (1.0.N, a
/// higher N each release) when it is one, else the setup .exe's, from
/// tauri.conf.json.
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    store::version().unwrap_or_else(|| app.package_info().version.to_string())
}

/// Whether the Microsoft Store has a newer version of this app; null when
/// this is not a Store install, such as the setup .exe (store.rs).
#[tauri::command]
async fn store_update() -> Result<Option<bool>, String> {
    tauri::async_runtime::spawn_blocking(store::available)
        .await
        .map_err(|e| e.to_string())?
}

/// Installs the Store's update from the app: Windows asks in a dialog of its
/// own, closes the app, updates it and starts it again (store.rs).
#[tauri::command]
async fn store_install(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<store::Installed, String> {
    #[cfg(windows)]
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let hwnd = {
        let _ = window;
        0
    };
    let on_main: store::OnMain =
        Box::new(move |f| app.run_on_main_thread(f).map_err(|e| e.to_string()));
    tauri::async_runtime::spawn_blocking(move || store::install(hwnd, on_main))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // first, so a second start is caught before it opens a window of its own
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = pdf_args(&args, Path::new(&cwd));
            let state = app.state::<Opened>();
            let files = remember(&state, &paths);
            // kept until a page takes them (`launch_files`, `combine_files`):
            // several PDFs opened or combined together from Explorer each
            // start the app, often while the page is still loading
            let combine = is_combine(&args);
            let queue = if combine { &state.combine } else { &state.pending };
            queue.lock().unwrap().extend(files.iter().cloned());
            if let Some(w) = target_window(app) {
                let _ = w.unminimize();
                let _ = w.set_focus();
                if !files.is_empty() {
                    let event = if combine { "combine-files" } else { "open-files" };
                    let _ = app.emit_to(w.label(), event, files);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Opened { last: Mutex::new("main".into()), ..Default::default() })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(true) = e {
                *w.state::<Opened>().last.lock().unwrap() = w.label().to_string();
            }
        })
        .setup(|app| {
            // the files first: the page asks for them as soon as it loads
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let paths = pdf_args(&args, &cwd);
            let state = app.state::<Opened>();
            let files = remember(&state, &paths);
            if is_combine(&args) {
                *state.combine.lock().unwrap() = files;
            } else {
                *state.pending.lock().unwrap() = files;
            }
            build_window(app.handle(), &main_config(app.handle()))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_files,
            combine_files,
            read_file,
            open_plan,
            read_range,
            range_close,
            save_file,
            open_store,
            open_site,
            store_update,
            app_version,
            store_install,
            new_window,
            pdf_native_status,
            pdf_open,
            pdf_open_path,
            pdf_trim,
            pdf_close,
            pdf_render,
            pdf_cancel,
            print_printers,
            print_caps,
            print_properties,
            print_send,
            ocr_status,
            ocr_page,
            perf_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running Add Dots PDF");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_range_of_a_file_and_its_end_even_once_saved_over() {
        let dir = std::env::temp_dir().join(format!("adddots-range-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("r.pdf");
        std::fs::write(&p, b"0123456789").unwrap();
        let mut f = std::fs::File::open(&p).unwrap();
        assert_eq!(range_of(&mut f, 2, 3).unwrap(), b"234");
        assert_eq!(range_of(&mut f, 8, 100).unwrap(), b"89");
        assert_eq!(range_of(&mut f, 20, 5).unwrap(), b"");
        assert_eq!(range_of(&mut f, 4, u32::MAX).unwrap(), b"456789", "a huge ask is the file's end");
        /* saved over (as Save does it) while open: still the file as opened */
        write_atomic(&p, b"abcdefghij").unwrap();
        assert_eq!(range_of(&mut f, 0, 4).unwrap(), b"0123");
        drop(f);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_app_knows_its_own_memory() {
        let m = native_memory().expect("memory readable");
        assert!(m.now > 1_000_000 && m.peak >= m.now);
    }

    #[test]
    fn saving_replaces_the_file_whole_and_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("adddots-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.pdf");
        std::fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new contents").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new contents");
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left.len(), 1, "no temporary file left: {left:?}");
        // a folder that cannot be written to: an error, and the old file untouched
        assert!(write_atomic(&dir.join("missing").join("b.pdf"), b"x").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
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
    fn explorers_combine_is_told_from_an_open() {
        assert!(is_combine(&args(&["adddots-pdf", "--combine", "a.pdf"])));
        assert!(!is_combine(&args(&["adddots-pdf", "a.pdf"])));
        // the program's own name is not an argument
        assert!(!is_combine(&args(&["--combine"])));
        // and the file still comes through
        let cwd = std::env::temp_dir();
        assert_eq!(pdf_args(&args(&["adddots-pdf", "--combine", "a.pdf"]), &cwd), vec![cwd.join("a.pdf")]);
    }

    #[test]
    fn a_print_job_comes_apart_from_its_document() {
        let json = br#"{"printer":"P","setup":{"duplex":"long"},"title":"t","copies":2,"gray":false,"annots":true,
            "sheets":[{"cells":[{"page":0,"x":1,"y":2,"w":3,"h":4,"rot":1,"clip":[0,0,10,10]}]}]}"#;
        let mut body = (json.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(json);
        body.extend_from_slice(b"%PDF-1.7");
        let (job, pdf) = split_job(&body).unwrap();
        assert_eq!(pdf, b"%PDF-1.7");
        assert_eq!(job.copies, 2);
        assert_eq!(job.setup.duplex.as_deref(), Some("long"));
        assert_eq!(job.sheets[0].cells[0].rot, 1);
        assert!(!job.sheets[0].cells[0].border);
        assert!(split_job(&body[..10]).is_err(), "cut short");
        assert!(split_job(b"\x02\0\0\0{}").is_err(), "not a job");
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
