//! Pages drawn natively, with PDFium (pdfium.dll beside the app).
//!
//! In a browser the app draws pages with pdf.js in a worker. On Windows the
//! same pages are drawn here instead, by PDFium itself as native code: a
//! CAD sheet of hundreds of thousands of lines, which pdf.js takes seconds
//! over, is drawn in a fraction of that, and the drawing's memory is the
//! app's own rather than the web view's. The page asks for a page at a
//! matrix and a size (`pdf_render`) and gets the pixels back, RGBA.
//!
//! PDFium is not thread-safe, so one thread owns it: every document, page and
//! bitmap lives and dies there, and the commands talk to it over a channel.
//! Without the library (a build that did not bundle it) `pdf_native_status`
//! says so and the page draws as it always has.
//!
//! Printing (print.rs) is done here too: the document made for printing is
//! opened on this thread and each page drawn into the printer's surface.

use std::collections::{HashMap, HashSet};
use std::ffi::{c_int, c_void, CString};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};

type Doc = *mut c_void;
type Page = *mut c_void;
type Bitmap = *mut c_void;
type Annot = *mut c_void;

#[repr(C)]
struct FsMatrix {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    e: f32,
    f: f32,
}
#[repr(C)]
struct FsRectF {
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
}

/// The few PDFium functions the app uses, from the library loaded at run time.
struct Lib {
    _lib: libloading::Library,
    load_mem: unsafe extern "system" fn(*const c_void, usize, *const i8) -> Doc,
    load_custom: unsafe extern "system" fn(*mut FileAccess, *const i8) -> Doc,
    last_error: unsafe extern "system" fn() -> std::ffi::c_ulong,
    close_doc: unsafe extern "system" fn(Doc),
    page_count: unsafe extern "system" fn(Doc) -> c_int,
    load_page: unsafe extern "system" fn(Doc, c_int) -> Page,
    close_page: unsafe extern "system" fn(Page),
    bmp_create: unsafe extern "system" fn(c_int, c_int, c_int) -> Bitmap,
    bmp_fill: unsafe extern "system" fn(Bitmap, c_int, c_int, c_int, c_int, u32) -> c_int,
    bmp_buffer: unsafe extern "system" fn(Bitmap) -> *mut u8,
    bmp_stride: unsafe extern "system" fn(Bitmap) -> c_int,
    bmp_destroy: unsafe extern "system" fn(Bitmap),
    render: unsafe extern "system" fn(Bitmap, Page, *const FsMatrix, *const FsRectF, c_int),
    /// FPDF_RenderPageBitmap: a page into a bitmap at a size and a turn
    /// (print as image, print.rs)
    render_bmp: unsafe extern "system" fn(Bitmap, Page, c_int, c_int, c_int, c_int, c_int, c_int),
    annot_count: unsafe extern "system" fn(Page) -> c_int,
    annot_get: unsafe extern "system" fn(Page, c_int) -> Annot,
    annot_subtype: unsafe extern "system" fn(Annot) -> c_int,
    annot_close: unsafe extern "system" fn(Annot),
    /// FPDF_RenderPage, into a Windows drawing surface: a printer's (print.rs).
    /// Windows builds of PDFium only.
    render_dc: Option<unsafe extern "system" fn(isize, Page, c_int, c_int, c_int, c_int, c_int, c_int)>,
}

/// annotations drawn; bytes in R G B A order, as an ImageData wants them
const FLAGS: c_int = 0x01 | 0x10;
const ANNOT_WIDGET: c_int = 20;
/// a bigger request than this is refused (the page never asks for one)
const MAX_PX: u64 = 100_000_000;

impl Lib {
    fn load(path: &Path) -> Result<Lib, String> {
        unsafe {
            let lib = libloading::Library::new(path).map_err(|e| format!("{}: {e}", path.display()))?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get(concat!($name, "\0").as_bytes())
                        .map_err(|e| format!("{}: {e}", $name))?
                };
            }
            let init: unsafe extern "system" fn() = sym!("FPDF_InitLibrary");
            init();
            Ok(Lib {
                load_mem: sym!("FPDF_LoadMemDocument64"),
                load_custom: sym!("FPDF_LoadCustomDocument"),
                last_error: sym!("FPDF_GetLastError"),
                close_doc: sym!("FPDF_CloseDocument"),
                page_count: sym!("FPDF_GetPageCount"),
                load_page: sym!("FPDF_LoadPage"),
                close_page: sym!("FPDF_ClosePage"),
                bmp_create: sym!("FPDFBitmap_Create"),
                bmp_fill: sym!("FPDFBitmap_FillRect"),
                bmp_buffer: sym!("FPDFBitmap_GetBuffer"),
                bmp_stride: sym!("FPDFBitmap_GetStride"),
                bmp_destroy: sym!("FPDFBitmap_Destroy"),
                render: sym!("FPDF_RenderPageBitmapWithMatrix"),
                render_bmp: sym!("FPDF_RenderPageBitmap"),
                annot_count: sym!("FPDFPage_GetAnnotCount"),
                annot_get: sym!("FPDFPage_GetAnnot"),
                annot_subtype: sym!("FPDFAnnot_GetSubtype"),
                annot_close: sym!("FPDFPage_CloseAnnot"),
                render_dc: lib.get(b"FPDF_RenderPage\0").ok().map(|f| *f),
                _lib: lib,
            })
        }
    }
}

/// PDFium's FPDF_FILEACCESS: it asks for blocks of the file as it needs them.
#[repr(C)]
struct FileAccess {
    len: std::ffi::c_ulong,
    get_block: extern "C" fn(*mut c_void, std::ffi::c_ulong, *mut u8, std::ffi::c_ulong) -> c_int,
    param: *mut c_void,
}

/// A file PDFium reads from disk, a block at a time, rather than from a
/// copy of all of it in memory.
struct Reader {
    access: FileAccess,
    file: std::fs::File,
}

// c_ulong is 32 bits on Windows and 64 elsewhere: the conversion is real there
#[allow(clippy::useless_conversion)]
extern "C" fn get_block(param: *mut c_void, pos: std::ffi::c_ulong, buf: *mut u8, size: std::ffi::c_ulong) -> c_int {
    use std::io::{Read, Seek, SeekFrom};
    let file = unsafe { &mut *(param as *mut std::fs::File) };
    let out = unsafe { std::slice::from_raw_parts_mut(buf, size as usize) };
    match file.seek(SeekFrom::Start(u64::from(pos))).and_then(|_| file.read_exact(out)) {
        Ok(()) => 1,
        Err(_) => 0,
    }
}

/// Where a document's bytes are while it is open: PDFium reads from them.
enum Keep {
    Bytes(#[allow(dead_code)] Vec<u8>),
    File(#[allow(dead_code)] Box<Reader>),
}

/// What a document is opened from.
pub enum From {
    /// its bytes, sent by the page
    Bytes(Vec<u8>),
    /// the file on disk, read as needed: no copy of it in memory
    Path(PathBuf),
}

/// An open document.
struct Open {
    doc: Doc,
    _keep: Keep,
    pages: c_int,
}

/// Pages kept loaded, most recent last: PDFium parses a page when it loads
/// it and keeps its decoded pictures with it, so drawing one again (zooming,
/// scrolling back) skips that work.
const KEEP_PAGES: usize = 12;
struct Loaded {
    key: u32,
    num: u32,
    page: Page,
    /// it has form fields (pdf.js draws those)
    widgets: bool,
}

/// What one render asks for.
pub struct Ask {
    pub key: u32,
    pub page: u32,
    pub m: [f32; 6],
    pub w: u32,
    pub h: u32,
}

enum Job {
    Open {
        key: u32,
        from: From,
        password: Option<String>,
        reply: Sender<Result<u32, String>>,
    },
    Close {
        key: u32,
    },
    /// memory running short: let go of every page kept loaded
    Trim,
    Render {
        rid: u32,
        ask: Ask,
        reply: Sender<Result<Vec<u8>, String>>,
    },
    /// a document's bytes, printed as `job` lays them out: Ok(sheets printed)
    Print {
        bytes: Vec<u8>,
        job: crate::print::Job,
        reply: Sender<Result<u32, String>>,
    },
}

/// The thread that owns PDFium, and the renders called off before it got to them.
pub struct Native {
    jobs: Mutex<Option<Sender<Job>>>,
    status: Mutex<Option<Result<String, String>>>,
    cancelled: Arc<Mutex<HashSet<u32>>>,
}

/// The one PDFium the app has: it can be started only once in a process.
pub fn native() -> &'static Native {
    static N: OnceLock<Native> = OnceLock::new();
    N.get_or_init(Native::new)
}

impl Native {
    fn new() -> Native {
        Native {
            jobs: Mutex::new(None),
            status: Mutex::new(None),
            cancelled: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Starts the thread with the library at `path`, once. Ok(where it was
    /// loaded from) or Err(why not).
    pub fn start(&self, path: PathBuf) -> Result<String, String> {
        let mut st = self.status.lock().unwrap();
        if let Some(s) = st.as_ref() {
            return s.clone();
        }
        let (tx, rx) = channel::<Job>();
        let (ok_tx, ok_rx) = channel::<Result<(), String>>();
        let cancelled = self.cancelled.clone();
        let p = path.clone();
        std::thread::Builder::new()
            .name("pdfium".into())
            .spawn(move || match Lib::load(&p) {
                Ok(lib) => {
                    let _ = ok_tx.send(Ok(()));
                    serve(lib, rx, cancelled);
                }
                Err(e) => {
                    let _ = ok_tx.send(Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
        let res = ok_rx
            .recv()
            .unwrap_or_else(|_| Err("the PDFium thread stopped".into()))
            .map(|_| path.display().to_string());
        if res.is_ok() {
            *self.jobs.lock().unwrap() = Some(tx);
        }
        *st = Some(res.clone());
        res
    }

    fn send(&self, job: Job) -> Result<(), String> {
        self.jobs
            .lock()
            .unwrap()
            .as_ref()
            .ok_or_else(|| "PDFium is not loaded".to_string())?
            .send(job)
            .map_err(|_| "the PDFium thread stopped".into())
    }

    /// Opens a document as `key`: Ok(its page count).
    pub fn open(&self, key: u32, from: From, password: Option<String>) -> Result<Receiver<Result<u32, String>>, String> {
        let (reply, rx) = channel();
        self.send(Job::Open { key, from, password, reply })?;
        Ok(rx)
    }

    /// Lets go of every page kept loaded (their decoded pictures with them).
    pub fn trim(&self) {
        let _ = self.send(Job::Trim);
    }

    pub fn close(&self, key: u32) {
        let _ = self.send(Job::Close { key });
    }

    pub fn render(&self, rid: u32, ask: Ask) -> Result<Receiver<Result<Vec<u8>, String>>, String> {
        if ask.w == 0 || ask.h == 0 || ask.w as u64 * ask.h as u64 > MAX_PX {
            return Err(format!("a {}x{} bitmap is not drawn", ask.w, ask.h));
        }
        let (reply, rx) = channel();
        self.send(Job::Render { rid, ask, reply })?;
        Ok(rx)
    }

    /// Prints a document (its bytes) as the job lays it out.
    pub fn print(&self, bytes: Vec<u8>, job: crate::print::Job) -> Result<Receiver<Result<u32, String>>, String> {
        job.check()?;
        let (reply, rx) = channel();
        self.send(Job::Print { bytes, job, reply })?;
        Ok(rx)
    }

    /// A render the page no longer wants: skipped if it has not started.
    pub fn cancel(&self, rid: u32) {
        self.cancelled.lock().unwrap().insert(rid);
    }
}

fn serve(lib: Lib, jobs: Receiver<Job>, cancelled: Arc<Mutex<HashSet<u32>>>) {
    let mut docs: HashMap<u32, Open> = HashMap::new();
    let mut pages: Vec<Loaded> = Vec::new();
    let drop_doc = |pages: &mut Vec<Loaded>, key: u32| {
        pages.retain(|l| {
            if l.key == key {
                unsafe { (lib.close_page)(l.page) };
            }
            l.key != key
        });
    };
    while let Ok(job) = jobs.recv() {
        match job {
            Job::Trim => {
                for l in pages.drain(..) {
                    unsafe { (lib.close_page)(l.page) };
                }
            }
            Job::Open { key, from, password, reply } => {
                drop_doc(&mut pages, key);
                if let Some(old) = docs.remove(&key) {
                    unsafe { (lib.close_doc)(old.doc) };
                }
                let _ = reply.send(open_doc(&lib, from, password).map(|o| {
                    let n = o.pages as u32;
                    docs.insert(key, o);
                    n
                }));
            }
            Job::Close { key } => {
                drop_doc(&mut pages, key);
                if let Some(old) = docs.remove(&key) {
                    unsafe { (lib.close_doc)(old.doc) };
                }
            }
            Job::Render { rid, ask, reply } => {
                if cancelled.lock().unwrap().remove(&rid) {
                    let _ = reply.send(Err("cancelled".into()));
                    continue;
                }
                let got = match docs.get(&ask.key) {
                    Some(o) => load(&lib, o, &mut pages, &ask).and_then(|l| draw(&lib, l, &ask)),
                    None => Err(format!("document {} is not open", ask.key)),
                };
                let _ = reply.send(got);
            }
            Job::Print { bytes, job, reply } => {
                let _ = reply.send(print(&lib, bytes, &job));
            }
        }
    }
    for l in pages.drain(..) {
        unsafe { (lib.close_page)(l.page) };
    }
    for (_, o) in docs.drain() {
        unsafe { (lib.close_doc)(o.doc) };
    }
}

fn open_doc(lib: &Lib, from: From, password: Option<String>) -> Result<Open, String> {
    let pw = password
        .map(|p| CString::new(p).map_err(|_| "a password with a zero byte".to_string()))
        .transpose()?;
    let pw_ptr = pw.as_ref().map_or(std::ptr::null(), |p| p.as_ptr());
    let (doc, keep) = match from {
        From::Bytes(bytes) => {
            let doc = unsafe { (lib.load_mem)(bytes.as_ptr() as *const c_void, bytes.len(), pw_ptr) };
            (doc, Keep::Bytes(bytes))
        }
        From::Path(path) => {
            let file = std::fs::File::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let len = file.metadata().map_err(|e| e.to_string())?.len();
            let len = std::ffi::c_ulong::try_from(len).map_err(|_| "too big to read in blocks".to_string())?;
            let mut r = Box::new(Reader {
                access: FileAccess { len, get_block, param: std::ptr::null_mut() },
                file,
            });
            r.access.param = &mut r.file as *mut std::fs::File as *mut c_void;
            let doc = unsafe { (lib.load_custom)(&mut r.access, pw_ptr) };
            (doc, Keep::File(r))
        }
    };
    if doc.is_null() {
        let code = unsafe { (lib.last_error)() };
        return Err(format!("PDFium could not open it (error {code})"));
    }
    let pages = unsafe { (lib.page_count)(doc) };
    Ok(Open { doc, _keep: keep, pages })
}

/// Page `ask.page` (from 0), loaded or kept from before.
fn load<'a>(lib: &Lib, o: &Open, pages: &'a mut Vec<Loaded>, ask: &Ask) -> Result<&'a Loaded, String> {
    if ask.page as c_int >= o.pages {
        return Err(format!("no page {}", ask.page + 1));
    }
    if let Some(i) = pages.iter().position(|l| l.key == ask.key && l.num == ask.page) {
        let l = pages.remove(i);
        pages.push(l);
        return Ok(pages.last().unwrap());
    }
    unsafe {
        let page = (lib.load_page)(o.doc, ask.page as c_int);
        if page.is_null() {
            return Err(format!("PDFium could not load page {}", ask.page + 1));
        }
        let widgets = (0..(lib.annot_count)(page)).any(|i| {
            let a = (lib.annot_get)(page, i);
            if a.is_null() {
                return false;
            }
            let t = (lib.annot_subtype)(a);
            (lib.annot_close)(a);
            t == ANNOT_WIDGET
        });
        if pages.len() >= KEEP_PAGES {
            let old = pages.remove(0);
            (lib.close_page)(old.page);
        }
        pages.push(Loaded { key: ask.key, num: ask.page, page, widgets });
    }
    Ok(pages.last().unwrap())
}

/// The page drawn into a w x h bitmap at matrix m, white underneath. A page
/// with form fields is left to pdf.js, which the app draws its fields over
/// (as the render worker does).
fn draw(lib: &Lib, l: &Loaded, ask: &Ask) -> Result<Vec<u8>, String> {
    if l.widgets {
        return Err("form fields: drawn by pdf.js".into());
    }
    let page = l.page;
    unsafe {
        let (w, h) = (ask.w as c_int, ask.h as c_int);
        let bmp = (lib.bmp_create)(w, h, 1);
        if bmp.is_null() {
            return Err(format!("no memory for a {w}x{h} bitmap"));
        }
        (lib.bmp_fill)(bmp, 0, 0, w, h, 0xFFFF_FFFF);
        let m = FsMatrix {
            a: ask.m[0],
            b: ask.m[1],
            c: ask.m[2],
            d: ask.m[3],
            e: ask.m[4],
            f: ask.m[5],
        };
        let clip = FsRectF {
            left: 0.0,
            top: 0.0,
            right: w as f32,
            bottom: h as f32,
        };
        (lib.render)(bmp, page, &m, &clip, FLAGS);
        let buf = (lib.bmp_buffer)(bmp);
        let stride = (lib.bmp_stride)(bmp) as usize;
        let row = ask.w as usize * 4;
        let mut out = Vec::with_capacity(row * ask.h as usize);
        for y in 0..ask.h as usize {
            out.extend_from_slice(std::slice::from_raw_parts(buf.add(y * stride), row));
        }
        (lib.bmp_destroy)(bmp);
        Ok(out)
    }
}

/// `job` printed from the document `bytes`, each page loaded as it is drawn
/// and let go after: a print of a thousand pages holds one at a time.
fn print(lib: &Lib, bytes: Vec<u8>, job: &crate::print::Job) -> Result<u32, String> {
    let render = lib.render_dc.ok_or("this PDFium cannot draw for a printer")?;
    let o = open_doc(lib, From::Bytes(bytes), None)?;
    let res = crate::print::run(job, &mut |dc, num, r, rot, flags, raster| {
        if num as c_int >= o.pages {
            return Err(format!("no page {}", num + 1));
        }
        unsafe {
            let page = (lib.load_page)(o.doc, num as c_int);
            if page.is_null() {
                return Err(format!("PDFium could not load page {}", num + 1));
            }
            match raster {
                None => render(dc, page, r[0], r[1], r[2], r[3], rot, flags),
                Some([w, h]) => {
                    // BGRx, as a Windows picture has it: no 0x10 (RGBA) in the flags
                    let bmp = (lib.bmp_create)(w, h, 0);
                    if bmp.is_null() {
                        (lib.close_page)(page);
                        return Err(format!("no memory to print page {} as a {w}x{h} picture", num + 1));
                    }
                    (lib.bmp_fill)(bmp, 0, 0, w, h, 0xFFFF_FFFF);
                    (lib.render_bmp)(bmp, page, 0, 0, w, h, rot, flags);
                    crate::print::blit(dc, r, w, h, (lib.bmp_stride)(bmp), (lib.bmp_buffer)(bmp));
                    (lib.bmp_destroy)(bmp);
                }
            }
            (lib.close_page)(page);
        }
        Ok(())
    });
    unsafe { (lib.close_doc)(o.doc) };
    res
}

/// The library's file name on this system.
pub fn lib_name() -> &'static str {
    if cfg!(windows) {
        "pdfium.dll"
    } else if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else {
        "libpdfium.so"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The library fetched by scripts/get-pdfium.mjs (pdfium/ beside this
    /// crate), or PDFIUM_PATH. Without it there is nothing to test here.
    fn lib_path() -> Option<PathBuf> {
        let p = std::env::var("PDFIUM_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium").join(lib_name()));
        if p.exists() {
            Some(p)
        } else {
            eprintln!("no PDFium at {}: run `node scripts/get-pdfium.mjs`", p.display());
            None
        }
    }

    /// One 200 x 100 page with a black box filling its left half.
    fn pdf() -> Vec<u8> {
        let content = "0 0 0 rg 0 0 100 100 re f";
        let objs = [
            "<</Type/Catalog/Pages 2 0 R>>".to_string(),
            "<</Type/Pages/Kids[3 0 R]/Count 1>>".to_string(),
            "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R>>".to_string(),
            format!("<</Length {}>>stream\n{content}\nendstream", content.len() + 1),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offs = vec![];
        for (i, o) in objs.iter().enumerate() {
            offs.push(out.len());
            out.extend(format!("{} 0 obj{o}endobj\n", i + 1).bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).bytes());
        for o in offs {
            out.extend(format!("{o:010} 00000 n \n").bytes());
        }
        out.extend(format!("trailer<</Size {}/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).bytes());
        out
    }

    #[test]
    fn draws_a_page_at_a_matrix() {
        let Some(path) = lib_path() else { return };
        let n = native();
        n.start(path).expect("PDFium loads");
        let pages = n.open(1, From::Bytes(pdf()), None).unwrap().recv().unwrap().expect("opens");
        assert_eq!(pages, 1);
        // the page at 100%, the right way up: PDF y runs up, the bitmap's down
        let m = [1.0, 0.0, 0.0, -1.0, 0.0, 100.0];
        let px = n.render(1, Ask { key: 1, page: 0, m, w: 200, h: 100 }).unwrap().recv().unwrap().unwrap();
        assert_eq!(px.len(), 200 * 100 * 4);
        let at = |x: usize, y: usize| &px[(y * 200 + x) * 4..(y * 200 + x) * 4 + 4];
        assert_eq!(at(50, 50), &[0, 0, 0, 255], "the box, black");
        assert_eq!(at(150, 50), &[255, 255, 255, 255], "the rest, white");
        // twice the size, shifted: the box's edge moves with it
        let m2 = [2.0, 0.0, 0.0, -2.0, -100.0, 200.0];
        let px2 = n.render(2, Ask { key: 1, page: 0, m: m2, w: 200, h: 100 }).unwrap().recv().unwrap().unwrap();
        let at2 = |x: usize, y: usize| px2[(y * 200 + x) * 4];
        assert_eq!(at2(90, 50), 0);
        assert_eq!(at2(110, 50), 255);
    }

    #[test]
    fn reads_a_file_from_disk_and_lets_it_be_saved_over() {
        let Some(path) = lib_path() else { return };
        let n = native();
        n.start(path).unwrap();
        let dir = std::env::temp_dir().join(format!("adddots-pdfium-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("on disk.pdf");
        std::fs::write(&file, pdf()).unwrap();
        assert_eq!(n.open(21, From::Path(file.clone()), None).unwrap().recv().unwrap(), Ok(1));
        let m = [1.0, 0.0, 0.0, -1.0, 0.0, 100.0];
        let px = n.render(21, Ask { key: 21, page: 0, m, w: 200, h: 100 }).unwrap().recv().unwrap().unwrap();
        assert_eq!(&px[(50 * 200 + 50) * 4..(50 * 200 + 50) * 4 + 4], &[0, 0, 0, 255]);
        // saving over the open file, as Save does: a new file renamed into its
        // place while PDFium still holds the old one open (Windows included)
        let tmp = dir.join("on disk.pdf.saving");
        std::fs::write(&tmp, b"%PDF-1.4 new").unwrap();
        std::fs::rename(&tmp, &file).expect("the open file can be replaced");
        assert_eq!(std::fs::read(&file).unwrap(), b"%PDF-1.4 new");
        n.trim();
        n.close(21);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_what_it_cannot_do() {
        let Some(path) = lib_path() else { return };
        let n = native();
        n.start(path).unwrap();
        assert!(n.open(7, From::Bytes(b"not a pdf".to_vec()), None).unwrap().recv().unwrap().is_err());
        let m = [1.0, 0.0, 0.0, -1.0, 0.0, 100.0];
        assert!(n.render(1, Ask { key: 99, page: 0, m, w: 10, h: 10 }).unwrap().recv().unwrap().is_err());
        assert!(n.render(2, Ask { key: 99, page: 0, m, w: 20000, h: 20000 }).is_err());
        n.cancel(3);
        n.open(8, From::Bytes(pdf()), None).unwrap().recv().unwrap().unwrap();
        let r = n.render(3, Ask { key: 8, page: 0, m, w: 10, h: 10 }).unwrap().recv().unwrap();
        assert_eq!(r.unwrap_err(), "cancelled");
    }
}
