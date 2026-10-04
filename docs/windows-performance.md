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
3. **Big files.** Open from disk by byte ranges (pdf.js range transport,
   native `read_range`), so a 500 MB file is not read whole before page 1.
4. **Off the page thread.** Search matching and Edit Object parsing in a
   worker; Convert in a worker or native.
5. **Windows OCR.** Windows.Media.Ocr through the Rust side, Tesseract
   kept for the web.
6. **Professional UI.** Dark theme pass, icon audit, toolbar groups,
   two-page view, DPI audit, print, context menus.
7. **Security.** A CSP for the window; validation of every path and
   file the Rust side accepts (already: read only handed-over files,
   write only where the Save dialog said).
