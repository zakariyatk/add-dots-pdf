//! Printing straight to a printer, as Acrobat does, without the web view's
//! own print dialog.
//!
//! The page's Print dialog (js/print.js) asks for the computer's printers
//! (`printers`), what the one picked can do and how much of its paper it can
//! print on (`caps`), and opens that printer's own settings when asked
//! (`properties`, the driver's dialog). Printing, the page lays the sheets
//! out (js/printplan.js) and sends them with the PDF; PDFium draws each page
//! into the printer's drawing surface where the plan puts it (pdfium.rs
//! `print`), so what comes out is the document's own vectors and text at the
//! printer's resolution, never a picture of the screen.
//!
//! A printer's settings are a DEVMODE, the driver's own block of bytes. The
//! one a reader set up in Properties is kept, by printer, until the app
//! closes; the dialog's choices (paper, orientation, colour, both sides) are
//! written over it for each job.

use serde::{Deserialize, Serialize};

/// The dialog's choices for the printer, laid over its settings.
#[derive(Deserialize, Serialize, Clone, Default, Debug)]
pub struct Setup {
    /// "portrait" or "landscape"
    pub orientation: Option<String>,
    /// the driver's paper number (DMPAPER_*)
    pub paper: Option<i16>,
    /// false: black and white
    pub color: Option<bool>,
    /// "off", "long" or "short": which edge the paper turns over on
    pub duplex: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct Printers {
    pub list: Vec<String>,
    pub default: Option<String>,
}

/// A paper the printer takes, in points, portrait.
#[derive(Serialize, Debug, Clone)]
pub struct Paper {
    pub id: i16,
    pub name: String,
    pub w: f32,
    pub h: f32,
}

/// What a printer can do, and its paper as it is set now.
#[derive(Serialize, Debug)]
pub struct Caps {
    pub papers: Vec<Paper>,
    /// the paper set now
    pub paper: i16,
    /// its size in points, portrait
    pub size: [f32; 2],
    /// what it cannot print on at each edge, in points, portrait: left, top, right, bottom
    pub margins: [f32; 4],
    pub color: bool,
    pub duplex: bool,
    /// the settings as they are now (after Properties, say)
    pub setup: Setup,
}

/// One page of the document on a sheet: where, in points from the sheet's
/// top left, turned `rot` quarters clockwise (0, 1 or 3), cut to `clip` (x, y, w, h).
#[derive(Deserialize, Debug, Clone)]
pub struct Cell {
    pub page: u32,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub rot: u8,
    pub clip: [f32; 4],
    #[serde(default)]
    pub border: bool,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Sheet {
    pub cells: Vec<Cell>,
}

/// A job: which printer, set up how, and the sheets, `copies` times over.
#[derive(Deserialize, Debug, Clone)]
pub struct Job {
    pub printer: String,
    pub setup: Setup,
    pub title: String,
    pub copies: u32,
    /// drawn in shades of grey
    pub gray: bool,
    /// the document's comments and form fields drawn too
    pub annots: bool,
    pub sheets: Vec<Sheet>,
}

/// The most sheets a job may have and the most copies: a mistyped number
/// does not send a printer thousands of pages.
pub const MAX_SHEETS: usize = 20_000;
pub const MAX_COPIES: u32 = 999;

impl Job {
    pub fn check(&self) -> Result<(), String> {
        if self.sheets.is_empty() {
            return Err("nothing to print".into());
        }
        if self.sheets.len() > MAX_SHEETS || self.copies == 0 || self.copies > MAX_COPIES {
            return Err("too many sheets or copies".into());
        }
        let ok = |v: f32| v.is_finite() && v.abs() < 100_000.0;
        for s in &self.sheets {
            for c in &s.cells {
                if ![c.x, c.y, c.w, c.h].iter().chain(c.clip.iter()).all(|v| ok(*v)) || c.w <= 0.0 || c.h <= 0.0 {
                    return Err("a page placed off any paper".into());
                }
            }
        }
        Ok(())
    }
}

/// Draws page `page` (from 0) into the printer's surface `dc` in the box
/// x, y, w, h (device pixels), `rot` quarter turns clockwise, with PDFium's
/// `flags`.
pub type DrawPage<'a> = dyn FnMut(isize, u32, [i32; 4], i32, i32) -> Result<(), String> + 'a;

#[cfg(windows)]
pub use win::{caps, printers, properties, run};

#[cfg(not(windows))]
mod off {
    use super::*;
    const OFF: &str = "printing to a printer is in the Windows app only";
    pub fn printers() -> Result<Printers, String> {
        Err(OFF.into())
    }
    pub fn caps(_: &str, _: &Setup) -> Result<Caps, String> {
        Err(OFF.into())
    }
    pub fn properties(_: isize, _: &str, _: &Setup) -> Result<Option<Setup>, String> {
        Err(OFF.into())
    }
    pub fn run(_: &Job, _: &mut DrawPage) -> Result<u32, String> {
        Err(OFF.into())
    }
}
#[cfg(not(windows))]
pub use off::{caps, printers, properties, run};

#[cfg(windows)]
mod win {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    type Handle = isize;

    #[repr(C)]
    struct PrinterInfo4 {
        name: *mut u16,
        server: *mut u16,
        attributes: u32,
    }

    #[repr(C)]
    struct DocInfo {
        size: i32,
        name: *const u16,
        output: *const u16,
        datatype: *const u16,
        kind: u32,
    }

    #[link(name = "winspool")]
    extern "system" {
        fn EnumPrintersW(flags: u32, name: *const u16, level: u32, buf: *mut u8, cb: u32, needed: *mut u32, got: *mut u32) -> i32;
        fn GetDefaultPrinterW(buf: *mut u16, len: *mut u32) -> i32;
        fn OpenPrinterW(name: *const u16, printer: *mut Handle, defaults: *const c_void) -> i32;
        fn ClosePrinter(printer: Handle) -> i32;
        fn DocumentPropertiesW(hwnd: isize, printer: Handle, name: *const u16, out: *mut u8, inp: *const u8, mode: u32) -> i32;
        fn DeviceCapabilitiesW(device: *const u16, port: *const u16, cap: u16, out: *mut u16, dm: *const u8) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateDCW(driver: *const u16, device: *const u16, port: *const u16, dm: *const u8) -> isize;
        fn DeleteDC(dc: isize) -> i32;
        fn GetDeviceCaps(dc: isize, index: i32) -> i32;
        fn StartDocW(dc: isize, info: *const DocInfo) -> i32;
        fn EndDoc(dc: isize) -> i32;
        fn AbortDoc(dc: isize) -> i32;
        fn StartPage(dc: isize) -> i32;
        fn EndPage(dc: isize) -> i32;
        fn SaveDC(dc: isize) -> i32;
        fn RestoreDC(dc: isize, saved: i32) -> i32;
        fn IntersectClipRect(dc: isize, l: i32, t: i32, r: i32, b: i32) -> i32;
        fn GetStockObject(kind: i32) -> isize;
        fn SelectObject(dc: isize, obj: isize) -> isize;
        fn Rectangle(dc: isize, l: i32, t: i32, r: i32, b: i32) -> i32;
    }

    const PRINTER_ENUM_LOCAL: u32 = 2;
    const PRINTER_ENUM_CONNECTIONS: u32 = 4;
    const DM_OUT_BUFFER: u32 = 2;
    const DM_IN_PROMPT: u32 = 4;
    const DM_IN_BUFFER: u32 = 8;
    const IDOK: i32 = 1;
    const DC_PAPERS: u16 = 2;
    const DC_PAPERSIZE: u16 = 3;
    const DC_DUPLEX: u16 = 7;
    const DC_PAPERNAMES: u16 = 16;
    const DC_COLORDEVICE: u16 = 32;
    const HORZRES: i32 = 8;
    const VERTRES: i32 = 10;
    const LOGPIXELSX: i32 = 88;
    const LOGPIXELSY: i32 = 90;
    const PHYSICALWIDTH: i32 = 110;
    const PHYSICALHEIGHT: i32 = 111;
    const PHYSICALOFFSETX: i32 = 112;
    const PHYSICALOFFSETY: i32 = 113;
    const NULL_BRUSH: i32 = 5;
    const BLACK_PEN: i32 = 7;

    /* DEVMODEW, by offset: only the printer fields the dialog sets */
    const DM_FIELDS: usize = 72;
    const DM_ORIENTATION: usize = 76;
    const DM_PAPERSIZE: usize = 78;
    const DM_COLOR: usize = 92;
    const DM_DUPLEX: usize = 94;
    const F_ORIENTATION: u32 = 0x1;
    const F_PAPERSIZE: u32 = 0x2;
    const F_COLOR: u32 = 0x800;
    const F_DUPLEX: u32 = 0x1000;
    /// dmSize + dmDriverExtra past these is the driver's own
    const DM_MIN: usize = 220;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn from_wide(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }

    fn get16(dm: &[u8], at: usize) -> i16 {
        i16::from_le_bytes([dm[at], dm[at + 1]])
    }
    fn set16(dm: &mut [u8], at: usize, v: i16) {
        dm[at..at + 2].copy_from_slice(&v.to_le_bytes());
    }
    fn fields(dm: &mut [u8], f: u32) {
        let v = u32::from_le_bytes(dm[DM_FIELDS..DM_FIELDS + 4].try_into().unwrap()) | f;
        dm[DM_FIELDS..DM_FIELDS + 4].copy_from_slice(&v.to_le_bytes());
    }

    /// Settings a reader chose in a printer's Properties, by printer.
    fn kept() -> &'static Mutex<HashMap<String, Vec<u8>>> {
        static K: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
        K.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// An open printer, closed when dropped.
    struct Open(Handle, Vec<u16>);
    impl Open {
        fn new(name: &str) -> Result<Open, String> {
            let w = wide(name);
            let mut h: Handle = 0;
            if unsafe { OpenPrinterW(w.as_ptr(), &mut h, std::ptr::null()) } == 0 || h == 0 {
                return Err(format!("the printer {name} could not be opened"));
            }
            Ok(Open(h, w))
        }
        /// the driver's settings: kept ones, else its defaults; `over` written over them
        fn devmode(&self, name: &str, over: &Setup) -> Result<Vec<u8>, String> {
            let size = unsafe { DocumentPropertiesW(0, self.0, self.1.as_ptr(), std::ptr::null_mut(), std::ptr::null(), 0) };
            if size < DM_MIN as i32 {
                return Err(format!("the printer {name} gave no settings"));
            }
            let mut base = kept().lock().unwrap().get(name).cloned().unwrap_or_default();
            if base.len() != size as usize {
                base = vec![0u8; size as usize];
                let r = unsafe { DocumentPropertiesW(0, self.0, self.1.as_ptr(), base.as_mut_ptr(), std::ptr::null(), DM_OUT_BUFFER) };
                if r < 0 {
                    return Err(format!("the printer {name} gave no settings"));
                }
            }
            apply(&mut base, over);
            // the driver checks the merge and fills in what follows from it
            let mut out = vec![0u8; size as usize];
            let r = unsafe {
                DocumentPropertiesW(0, self.0, self.1.as_ptr(), out.as_mut_ptr(), base.as_ptr(), DM_IN_BUFFER | DM_OUT_BUFFER)
            };
            Ok(if r < 0 { base } else { out })
        }
    }
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe { ClosePrinter(self.0) };
        }
    }

    fn apply(dm: &mut [u8], s: &Setup) {
        if let Some(o) = &s.orientation {
            set16(dm, DM_ORIENTATION, if o == "landscape" { 2 } else { 1 });
            fields(dm, F_ORIENTATION);
        }
        if let Some(p) = s.paper {
            set16(dm, DM_PAPERSIZE, p);
            fields(dm, F_PAPERSIZE);
        }
        if let Some(c) = s.color {
            set16(dm, DM_COLOR, if c { 2 } else { 1 });
            fields(dm, F_COLOR);
        }
        if let Some(d) = &s.duplex {
            set16(dm, DM_DUPLEX, match d.as_str() { "long" => 2, "short" => 3, _ => 1 });
            fields(dm, F_DUPLEX);
        }
    }

    fn read(dm: &[u8]) -> Setup {
        Setup {
            orientation: Some(if get16(dm, DM_ORIENTATION) == 2 { "landscape" } else { "portrait" }.into()),
            paper: Some(get16(dm, DM_PAPERSIZE)),
            color: Some(get16(dm, DM_COLOR) != 1),
            duplex: Some(match get16(dm, DM_DUPLEX) { 2 => "long", 3 => "short", _ => "off" }.into()),
        }
    }

    /// A printer's drawing surface, deleted when dropped.
    struct Dc(isize);
    impl Dc {
        fn new(name: &[u16], dm: &[u8]) -> Result<Dc, String> {
            let spool = wide("WINSPOOL");
            let dc = unsafe { CreateDCW(spool.as_ptr(), name.as_ptr(), std::ptr::null(), dm.as_ptr()) };
            if dc == 0 {
                return Err("the printer could not be prepared".into());
            }
            Ok(Dc(dc))
        }
        fn cap(&self, i: i32) -> i32 {
            unsafe { GetDeviceCaps(self.0, i) }
        }
    }
    impl Drop for Dc {
        fn drop(&mut self) {
            unsafe { DeleteDC(self.0) };
        }
    }

    pub fn printers() -> Result<Printers, String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut need, mut got) = (0u32, 0u32);
        unsafe { EnumPrintersW(flags, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut need, &mut got) };
        let mut list = vec![];
        if need > 0 {
            // u64s, so the records in it are aligned for their pointers
            let mut buf = vec![0u64; (need as usize).div_ceil(8)];
            let ok = unsafe { EnumPrintersW(flags, std::ptr::null(), 4, buf.as_mut_ptr() as *mut u8, need, &mut need, &mut got) };
            if ok != 0 {
                let recs = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const PrinterInfo4, got as usize) };
                list = recs.iter().map(|r| unsafe { from_wide(r.name) }).filter(|n| !n.is_empty()).collect();
            }
        }
        let mut len = 0u32;
        unsafe { GetDefaultPrinterW(std::ptr::null_mut(), &mut len) };
        let mut default = None;
        if len > 0 {
            let mut b = vec![0u16; len as usize];
            if unsafe { GetDefaultPrinterW(b.as_mut_ptr(), &mut len) } != 0 {
                default = Some(unsafe { from_wide(b.as_ptr()) });
            }
        }
        Ok(Printers { list, default })
    }

    pub fn caps(name: &str, over: &Setup) -> Result<Caps, String> {
        let p = Open::new(name)?;
        let mut dm = p.devmode(name, over)?;
        let setup = read(&dm);
        let dev = p.1.as_ptr();
        let dc_cap = |cap: u16, out: *mut u16, dm: &[u8]| unsafe { DeviceCapabilitiesW(dev, std::ptr::null(), cap, out, dm.as_ptr()) };
        let n = dc_cap(DC_PAPERS, std::ptr::null_mut(), &dm).max(0) as usize;
        let mut papers = vec![];
        if n > 0 && n < 2000 {
            let mut ids = vec![0u16; n];
            let mut names = vec![0u16; n * 64];
            let mut sizes = vec![0i32; n * 2];
            dc_cap(DC_PAPERS, ids.as_mut_ptr(), &dm);
            dc_cap(DC_PAPERNAMES, names.as_mut_ptr(), &dm);
            dc_cap(DC_PAPERSIZE, sizes.as_mut_ptr() as *mut u16, &dm);
            for i in 0..n {
                let raw = &names[i * 64..i * 64 + 64];
                let end = raw.iter().position(|c| *c == 0).unwrap_or(64);
                // tenths of a millimetre, to points
                let pt = |v: i32| v as f32 / 254.0 * 72.0;
                let (w, h) = (pt(sizes[i * 2]), pt(sizes[i * 2 + 1]));
                if w > 0.0 && h > 0.0 {
                    papers.push(Paper { id: ids[i] as i16, name: String::from_utf16_lossy(&raw[..end]), w: w.min(h), h: w.max(h) });
                }
            }
        }
        let color = dc_cap(DC_COLORDEVICE, std::ptr::null_mut(), &dm) == 1;
        let duplex = dc_cap(DC_DUPLEX, std::ptr::null_mut(), &dm) == 1;
        // the paper's size and its margins, measured portrait
        set16(&mut dm, DM_ORIENTATION, 1);
        fields(&mut dm, F_ORIENTATION);
        let dc = Dc::new(&p.1, &dm)?;
        let (dx, dy) = (dc.cap(LOGPIXELSX).max(1) as f32, dc.cap(LOGPIXELSY).max(1) as f32);
        let (pw, ph) = (dc.cap(PHYSICALWIDTH) as f32, dc.cap(PHYSICALHEIGHT) as f32);
        let (ox, oy) = (dc.cap(PHYSICALOFFSETX) as f32, dc.cap(PHYSICALOFFSETY) as f32);
        let (hw, vh) = (dc.cap(HORZRES) as f32, dc.cap(VERTRES) as f32);
        let x = |v: f32| (v / dx * 72.0).max(0.0);
        let y = |v: f32| (v / dy * 72.0).max(0.0);
        Ok(Caps {
            papers,
            paper: setup.paper.unwrap_or(0),
            size: [x(pw), y(ph)],
            margins: [x(ox), y(oy), x(pw - ox - hw), y(ph - oy - vh)],
            color,
            duplex,
            setup,
        })
    }

    /// The printer's own settings dialog over window `hwnd`, starting from
    /// the dialog's choices. Some(the settings) when OK was pressed; they
    /// are kept for this printer.
    pub fn properties(hwnd: isize, name: &str, over: &Setup) -> Result<Option<Setup>, String> {
        let p = Open::new(name)?;
        let dm = p.devmode(name, over)?;
        let mut out = vec![0u8; dm.len()];
        let r = unsafe {
            DocumentPropertiesW(hwnd, p.0, p.1.as_ptr(), out.as_mut_ptr(), dm.as_ptr(), DM_IN_BUFFER | DM_OUT_BUFFER | DM_IN_PROMPT)
        };
        if r != IDOK {
            return Ok(None);
        }
        let s = read(&out);
        kept().lock().unwrap().insert(name.to_string(), out);
        Ok(Some(s))
    }

    /// Prints `job`, each page drawn by `draw`. Ok(the sheets printed).
    pub fn run(job: &Job, draw: &mut DrawPage) -> Result<u32, String> {
        job.check()?;
        let p = Open::new(&job.printer)?;
        let mut over = job.setup.clone();
        if job.gray {
            over.color = Some(false);
        }
        let dm = p.devmode(&job.printer, &over)?;
        let dc = Dc::new(&p.1, &dm)?;
        let title = wide(if job.title.is_empty() { "ADD DOTS PDF" } else { &job.title });
        let info = DocInfo { size: std::mem::size_of::<DocInfo>() as i32, name: title.as_ptr(), output: std::ptr::null(), datatype: std::ptr::null(), kind: 0 };
        if unsafe { StartDocW(dc.0, &info) } <= 0 {
            return Err("the printer did not take the job".into());
        }
        // points from the paper's corner to the printer's pixels from where it starts printing
        let (sx, sy) = (dc.cap(LOGPIXELSX) as f32 / 72.0, dc.cap(LOGPIXELSY) as f32 / 72.0);
        let (ox, oy) = (dc.cap(PHYSICALOFFSETX) as f32, dc.cap(PHYSICALOFFSETY) as f32);
        let px = |x: f32| (x * sx - ox).round() as i32;
        let py = |y: f32| (y * sy - oy).round() as i32;
        // the flags PDFium draws with: comments and fields, for a printer, in grey
        let flags = (if job.annots { 0x01 } else { 0 }) | 0x800 | (if job.gray { 0x08 } else { 0 });
        let both = job.setup.duplex.as_deref().is_some_and(|d| d != "off");
        let mut printed = 0u32;
        let res = (|| {
            for copy in 0..job.copies {
                // printed on both sides, each copy starts on a sheet of its own
                if copy > 0 && both && job.sheets.len() % 2 == 1 {
                    page(dc.0, |_| Ok(()))?;
                }
                for s in &job.sheets {
                    page(dc.0, |dc| {
                        for c in &s.cells {
                            let saved = unsafe { SaveDC(dc) };
                            let [cx, cy, cw, ch] = c.clip;
                            unsafe { IntersectClipRect(dc, px(cx), py(cy), px(cx + cw), py(cy + ch)) };
                            let (l, t) = (px(c.x), py(c.y));
                            let rect = [l, t, px(c.x + c.w) - l, py(c.y + c.h) - t];
                            let r = draw(dc, c.page, rect, (c.rot % 4) as i32, flags);
                            unsafe { RestoreDC(dc, saved) };
                            r?;
                            if c.border {
                                unsafe {
                                    let b = SelectObject(dc, GetStockObject(NULL_BRUSH));
                                    let pen = SelectObject(dc, GetStockObject(BLACK_PEN));
                                    Rectangle(dc, px(c.x), py(c.y), px(c.x + c.w), py(c.y + c.h));
                                    SelectObject(dc, b);
                                    SelectObject(dc, pen);
                                }
                            }
                        }
                        Ok(())
                    })?;
                    printed += 1;
                }
            }
            Ok::<(), String>(())
        })();
        match res {
            Ok(()) => {
                unsafe { EndDoc(dc.0) };
                Ok(printed)
            }
            Err(e) => {
                unsafe { AbortDoc(dc.0) };
                Err(e)
            }
        }
    }

    fn page(dc: isize, f: impl FnOnce(isize) -> Result<(), String>) -> Result<(), String> {
        if unsafe { StartPage(dc) } <= 0 {
            return Err("the printer stopped taking pages".into());
        }
        let r = f(dc);
        if unsafe { EndPage(dc) } <= 0 && r.is_ok() {
            return Err("the printer stopped taking pages".into());
        }
        r
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn settings_written_into_a_devmode_read_back() {
            let mut dm = vec![0u8; DM_MIN];
            apply(
                &mut dm,
                &Setup { orientation: Some("landscape".into()), paper: Some(8), color: Some(false), duplex: Some("short".into()) },
            );
            let s = read(&dm);
            assert_eq!(s.orientation.as_deref(), Some("landscape"));
            assert_eq!(s.paper, Some(8));
            assert_eq!(s.color, Some(false));
            assert_eq!(s.duplex.as_deref(), Some("short"));
            let f = u32::from_le_bytes(dm[DM_FIELDS..DM_FIELDS + 4].try_into().unwrap());
            assert_eq!(f, F_ORIENTATION | F_PAPERSIZE | F_COLOR | F_DUPLEX);
        }

        #[test]
        fn the_printers_can_be_listed() {
            // a runner may have none: the list is all that is asked of it
            let p = printers().expect("the printers are listed");
            if let Some(d) = &p.default {
                assert!(p.list.contains(d), "the default {d} is among {:?}", p.list);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(w: f32) -> Cell {
        Cell { page: 0, x: 0.0, y: 0.0, w, h: 10.0, rot: 0, clip: [0.0, 0.0, 10.0, 10.0], border: false }
    }
    fn job(sheets: Vec<Sheet>, copies: u32) -> Job {
        Job { printer: "p".into(), setup: Setup::default(), title: String::new(), copies, gray: false, annots: true, sheets }
    }

    #[test]
    fn a_job_is_checked_before_it_reaches_a_printer() {
        assert!(job(vec![Sheet { cells: vec![cell(10.0)] }], 1).check().is_ok());
        assert!(job(vec![], 1).check().is_err(), "no sheets");
        assert!(job(vec![Sheet { cells: vec![cell(10.0)] }], 0).check().is_err(), "no copies");
        assert!(job(vec![Sheet { cells: vec![cell(10.0)] }], MAX_COPIES + 1).check().is_err());
        assert!(job(vec![Sheet { cells: vec![cell(f32::NAN)] }], 1).check().is_err());
        assert!(job(vec![Sheet { cells: vec![cell(-1.0)] }], 1).check().is_err());
    }
}
