# The Windows app: architecture, bottlenecks and the performance plan

This is the analysis the Windows performance work starts from, and the plan
it follows. It is updated as each phase lands, with the measurements before
and after.

## 1. Current architecture

One codebase, three shells:

```
apps/web          the editor: index.html + public/js/*.js (classic scripts,
                  ~25k lines; core.js 8.7k) + CSS. Runs as the website.
packages/engine   PDF engine in TypeScript (no UI): page model, marks,
                  geometry, saving (pdf-lib), text, content editing.
                  Built into public/js/engine.js for the scripts above.
apps/desktop      the Windows app: apps/web in a Tauri 2 window, plus a
                  small Rust side (src-tauri/src/lib.rs, pdfium.rs).
apps/mobile       Android / iOS: apps/web in Capacitor.
legacy/api        PHP share-link API; Supabase for accounts.
```

`core.js` owns the document state (`S`: sources, page items, marks, undo)
and exposes `window.ADDPDF` to ~20 feature modules (draw, annotate, forms,
insert, organize, convert, ocr, books, tabs, editobj…). They talk only
through it.

## 2. Windows technology

Tauri 2. The window is Microsoft Edge **WebView2** (Chromium), so the UI
is HTML/CSS/JS drawn by Chromium, GPU-composited. The Rust side adds what a
browser tab cannot do:

- files handed over by Explorer (`launch_files`, `read_file`, single
  instance, `open-files` to the window used last);
- the native Save dialog (`save_file`);
- multiple windows (`new_window`, tabs dragged out);
- the Store page for updates (`open_store`);
- native page drawing with PDFium (`pdfium.rs`, `pdf_*` commands).

It installs per user (NSIS, no admin) and ships to the Microsoft Store
(MSIX). WebView2 is part of Windows 10/11.

## 3. PDF engines

| Job                                   | Engine                                                          | Where it runs         |
| ------------------------------------- | --------------------------------------------------------------- | --------------------- |
| Parse, page sizes, text, search       | pdf.js 3.11                                                     | pdf.js's worker       |
| Draw pages and thumbnails             | pdf.js, in the render worker (its own nested pdf.js worker)     | render worker         |
| Draw parts of heavy pages (zoomed in) | PDFium (WebAssembly)                                            | render worker         |
| Draw pages, Windows app               | **PDFium native** (pdfium.dll), chosen per document when faster | Rust thread           |
| Save, merge, split, extract           | pdf-lib + engine                                                | save worker (or page) |
| Edit Object (content editing)         | engine `content.ts`, `contenttext.ts` + pdf-lib                 | page thread           |
| OCR                                   | Tesseract.js (WebAssembly)                                      | its worker            |
| Convert (Word, Excel, DXF…)           | convert.js                                                      | page thread           |

## 4. Rendering pipeline

```
open → read bytes → pdf.js opens (page 1 first; others lazily)
     → pages laid out at page 1's size, real sizes as they load
     → visible pages queued (RQ, 2 at a time), drawn at DPR × zoom,
       capped at 22 MP (8 MP base when the detail layer is on)
     → zoomed past the cap: the detail layer draws only the visible part
     → text layer per page, marks as SVG over it
     → thumbnails queued (TQ) after the pages, at 0.6× resolution
     → the rest of the pages load and their text is indexed in the background
```

Drawing goes through `RW.render`: native PDFium (Windows) or the render
worker, else the page thread.

## 5. Memory management today

- Pages: only those near view keep a bitmap (`LIVE`); far ones give it
  back; a memory-pressure mode (`MEM.tight`) shrinks caps and frees more.
- Thumbnails: mounted near view only (`TMOUNTED`), bitmaps dropped far away.
- Page objects: `page.cleanup()` for pages far away.
- **The file itself is held several times**: `src.bytes` on the page,
  a copy in pdf.js's worker, a copy in the render worker and another in
  its nested pdf.js worker, a copy in PDFium (Windows), and one in the save
  worker when saving. Measured: an 85 MB scan takes the web view from
  626 MB to 1,254 MB.

## 6. Threading model

Page thread: UI, layout, marks, the text layer, search matching, Edit
Object, Convert. Off it: pdf.js's worker (parsing, text), the render worker
(drawing), the save worker (building PDFs), Tesseract's worker (OCR), and
in the Windows app one native PDFium thread (drawing) plus Tauri's async
pool (compression, file I/O).

## 7. Measured bottlenecks (baseline)

Real app, release build, Linux / WebKitGTK, no GPU (the Windows CI run
prints its own native numbers):

| File            | Size  | First page              | Web view RAM |
| --------------- | ----- | ----------------------- | ------------ |
| 12-page text    | 33 KB | 1.5 s warm (8.5 s cold) | 626 MB       |
| 300-page report | 2 MB  | 2.8 s                   | 749 MB       |
| 2,000-page text | 5 MB  | 3.2 s                   | 1,086 MB     |
| 40-page scans   | 85 MB | 5.8 s                   | 1,254 MB     |
| CAD, 8 sheets   | 13 MB | 2.3 s                   | 853 MB       |

Native vs pdf.js drawing, ms per megapixel: CAD 640 vs 1,433, text 155
vs 303, scans 550 vs 112 (hence the per-document choice).

Bottlenecks, largest first:

1. **RAM: the file held 4–6 times**, and a 600 MB floor from four
   JavaScript engines (page, pdf.js worker, render worker, its nested
   worker).
2. **First page waits for the whole file**: read whole, copied, then parsed.
3. **Convert, Edit Object, search matching on the page thread**: a long
   job can still hold up input.
4. **OCR in WebAssembly**: seconds per page; Windows has a native engine.
5. **Saving writes over the file in place** (`std::fs::write`): a crash
   mid-save can leave it cut short.
6. **No performance readout** on Windows to measure against.

## 8. What should change

- Atomic saves; a performance readout (open time, first page, renders by
  engine, RAM).
- One copy of the file where possible: native-first drawing on Windows so
  the render worker need not hold the file; pdf.js fed by byte ranges from
  disk for big files.
- Heavy jobs off the page thread (Convert, Edit Object parsing, search
  matching) into workers or native code.
- Windows OCR (Windows.Media.Ocr) instead of Tesseract on Windows.
- Professional dark UI pass, consistent icon set, toolbar groups,
  two-page view, High-DPI audit, Windows print, context menus.
- A content security policy for the window (it has none: `csp: null`).

## 9. What should not change

- The web app's behaviour, and the shared engine and modules: the Windows
  app keeps using them and adds native paths behind the same interfaces
  (`RW`, `saveFile`, `X.*`), each with a fallback.
- The document model, undo, recovery, projects and every tool.
- The tests: each phase adds its own and keeps the 150+ smoke checks green.

## 10. Plan, in phases

Each phase: measure, change, test every existing feature, measure again.

1. **Safety and measurement.** Atomic saves (temp file, flush, rename);
   a performance panel (Ctrl+Shift+F12) with open/first-page times, render
   times by engine, JS heap and native memory.
2. **Memory.** Windows: draw natively first and open the file in the
   render worker only when native cannot draw a page; free PDFium pages
   under memory pressure; measure RAM with the 85 MB and 2,000-page files.
3. **Big files.** ✅ Open from disk by byte ranges (pdf.js range transport,
   native `read_range`), so a 500 MB file is not read whole before page 1.
4. **Off the page thread.** ✅ Measured first: search was already off it;
   Edit Object's work moved to the save worker; DXF conversion yields.
5. **Windows OCR.** Windows.Media.Ocr through the Rust side, Tesseract
   kept for the web.
6. **Professional UI.** Dark theme pass, icon audit, toolbar groups,
   two-page view, DPI audit, print, context menus.
7. **Security.** A CSP for the window; validation of every path and
   file the Rust side accepts (already: read only handed-over files,
   write only where the Save dialog said).

## Phase 1: done

Atomic saves (`write_atomic` in `lib.rs`) and the performance panel
(Ctrl+Shift+P, `js/perf.js`, `perf_native`).

## Phase 2: memory — done

- PDFium reads a file opened from Explorer **from disk**, a block at a
  time (`FPDF_LoadCustomDocument`), instead of a copy of all of it; only
  files the system handed over can be opened this way (`pdf_open_path`).
  Saving over the open file still works (tested on Windows in CI).
- The render worker (pdf.js twice over and a copy of each file) is **not
  started** in the Windows app until a page needs it: one PDFium leaves to
  pdf.js (form fields), no PDFium at all, or PDFium measuring slow for the
  file (over 250 ms per megapixel; thumbnails do not count). Drawings
  asked for while PDFium starts wait for it.
- The save worker lets go of a big file's copy (over 32 MB) after saving.
- Memory running short: PDFium drops the pages it keeps loaded
  (`pdf_trim`).

Release build, Linux, 8 s after the first page:

| File                 | Web view before → after   | App before → after | First page before → after |
| -------------------- | ------------------------- | ------------------ | ------------------------- |
| 40-page scans, 85 MB | 1,273 → **778 MB** (−39%) | 312 → **221 MB**   | 6.5 → **3.8 s**           |
| 2,000-page text      | 1,065 → 1,038 MB          | 212 → 195 MB       | 3.1 → 2.7 s               |
| 300-page report      | 755 → 705 MB              | 199 → 198 MB       | 2.5 → 2.2 s               |
| CAD, 8 sheets        | 885 → 876 MB              | 249 → 234 MB       | 2.3 → 2.1 s               |

What remains of the floor (~700 MB with a small file here) is the web view
itself, the page and pdf.js's worker; and on the page the file is still held
by `src.bytes` and pdf.js. Phase 3 (opening by byte ranges) is the next cut.

## Phase 3: big files — done

- A file over 150 MB handed over by Explorer is **not read whole**. The
  desktop side keeps it open (`open_plan`), and pdf.js asks for the parts
  it needs (`read_range`, through `PDFDataRangeTransport`). The page holds
  no copy of it (`src.lazy`; `src.bytes` stays empty).
- The open file is what gets read, not the path. Saving over it (a new
  file renamed into its place) leaves the open document reading what it
  opened, as PDFium does since Phase 2.
- The whole file is read only for a job that needs it: saving or
  exporting (`buildPdf`), a project, or Edit Object (`withBytes`). It is
  read 32 MB at a time and let go of afterwards.
- A tab moved to a new window takes the file's place on disk, not its
  bytes, and the new window opens it again the same way.
- Crash recovery already skips files this big (`REC_MAX_BYTES`), so the
  150 MB cut-off changes nothing there. `ADDDOTS_RANGE_MB` sets another
  cut-off. CI runs the desktop end-to-end test a second time with it at
  0, so every file goes through this path.

Release build, Linux, a 257 MB file (120 scanned pages), 8 s after the
first page:

|                        | Before (Phase 2) | After          |
| ---------------------- | ---------------- | -------------- |
| First page             | 16–21 s          | **2.6 s**      |
| Web view               | 1,127 MB         | 945–1,077 MB   |
| WebKit network process | 303 MB           | **58 MB**      |
| App (Rust, PDFium)     | 230 MB           | 261 MB         |
| Total                  | 1,660 MB         | 1,264–1,396 MB |

The big gain is the time to the first page: it no longer waits for the
whole file to be read and copied. The web view stays high for two reasons:
pdf.js sets aside room for the whole file in its worker, and it fills that
room as the background text indexing reads every page. Not indexing big
files in the background would be the next cut, at the price of search
starting later.

## Phase 4: off the page thread — done

Measured first (`apps/web/bench/longtasks.mjs`). It counts the page
thread's long tasks (over 50 ms, when the page cannot answer input) during
each job, in Chrome, after the file has settled:

| Job                                 | Long tasks before        | After                |
| ----------------------------------- | ------------------------ | -------------------- |
| Search 2,000 pages (and again)      | none                     | none                 |
| Edit Object, first point, CAD sheet | 1,198 ms (one of 882 ms) | **93 ms**            |
| Edit Object, lift a shape, CAD      | 605 ms (max 419)         | **205 ms** (max 125) |
| Edit Object, 300-page report        | none                     | none                 |
| Convert to Word / Excel, 300 pages  | none                     | none                 |
| Convert to DXF, CAD 8 sheets        | 2,683 ms (one of 1,989)  | **759 ms** (max 261) |

DXF conversion also got faster (5.5 → 3.0 s), and its output is
byte-identical.

- **Search needed nothing.** pdf.js's worker already extracts the text,
  and matching cached text across 2,000 pages takes 35 ms in all.
- **Edit Object** reads a page's shapes and lines of text, and cuts them
  out, in the **save worker** (`op: 'eo'`). That worker already has
  pdf-lib, the engine and each file. It keeps the parsed document per file
  until the file is let go of. The page thread still does the same work
  when the worker cannot (`X.editedBy` says which did it; the smoke test
  checks it was the worker).
- **DXF**: the time went to joining and encoding the finished file in one
  piece (46 MB of text). It is now written 4,000 lines at a time, with a
  pause whenever 30 ms have run, and so is the walk through each sheet's
  drawing. What is left is about 60–80 ms per sheet while pdf.js hands
  over the sheet's drawing operations.

## Phase 7: security — done

- **A content security policy for the window** (`tauri.conf.json`, was
  `csp: null`). Scripts only from the app itself (and the update check's
  `latest.js`, below), WebAssembly allowed but no `eval`, workers from the
  app or `blob:`, frames only the app's own (tabs, printing), no plugins
  (`object-src 'none'`), no form posts. Connections stay open to `https:`:
  the translation tool's endpoint is the reader's to set. Tauri adds the
  hashes of the inline scripts when it builds; `style-src` is left as
  written, as the page sets inline `style=` attributes, which a hash would
  turn off.
- **The update check no longer runs the website's script with the app's
  rights.** `latest.js` used to be loaded into the page itself, where (in
  the Windows app) it could call every command of the desktop side; a
  website taken over could have run code in every installed app. It now
  runs in a frame sandboxed to an origin of its own (`latest-frame.html`),
  which hands back only a build id, a time and up to four notes.
- **`read_range`** sets aside room for what the file has left, not for
  whatever length was asked (a length of 4 GB was set aside before a byte
  was read).
- Reviewed and already sound: `read_file`, `open_plan`, `pdf_open_path`
  serve only files the system handed over; `save_file` writes only where the
  Save dialog says, with the name cleaned; `new_window` takes only a short
  name of letters and digits; `pdf_render` refuses bitmaps over `MAX_PX`;
  `open_store` opens one fixed address.

Tests: the desktop end-to-end test checks the policy is in force (no `eval`)
and that the update frame still answers. The whole smoke test (155 checks,
every tool) runs a second time in CI under the same policy
(`ADDDOTS_CSP=1`: `vite preview` sends it, with the inline scripts' hashes as
Tauri adds them). The sandboxed frame does not match `'self'`, so the app's
own origins are named in `script-src` (`tauri://localhost` on Linux and
macOS, `http://tauri.localhost` on Windows).
