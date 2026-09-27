/* Draws pages off the main thread.

   The viewer asks for a page at a size and gets back a finished bitmap, so a
   page that takes seconds to draw (a CAD sheet with tens of thousands of
   lines) never freezes scrolling, typing or the tools. pdf.js runs here in
   full: its display layer draws on an OffscreenCanvas, and its parser runs in
   a worker of its own, started from this one.

   Messages in:
     { op: 'hello' }                                    -> { op: 'hello', ok }
     { op: 'open', key, bytes | file, password }        opens a document (again)
     { op: 'close', key }                               frees it
     { op: 'render', rid, key, num, scale, rotation, w, h, transform, intent, drop, fast }
                                                        -> { rid, bitmap, engine } | { rid, cancelled } | { rid, error }
                                                        (an error starting "open failed" means the document)
     { op: 'cancel', rid }                              stops that render
     { op: 'release', key, num }                        frees a page's drawing data
   (drop: free the page's drawing data once drawn, for a one-off like a
   thumbnail; fast: a part of a page, which PDFium may draw, below)

   A document is opened on its first render, from bytes the viewer sends
   once. Renders of one document wait for it to open. */
'use strict';

/* The parts of `document` pdf.js reaches for while drawing, backed by what a
   worker has: canvases are OffscreenCanvas, and fonts go into the worker's
   own font set. Anything else (SVG filters for a few rare transfer
   functions) throws, and the viewer draws that page itself instead. */
const docShim = {
  fonts: self.fonts,
  createElement: function (tag) {
    if (tag === 'canvas') return new OffscreenCanvas(1, 1);
    throw new Error('render worker: no <' + tag + '> here');
  },
  createElementNS: function (ns, tag) { throw new Error('render worker: no <' + tag + '> here'); },
  baseURI: self.location.href
};

let ready = false, whyNot = '';
try {
  importScripts('vendor/pdf.min.js');
  /* pdf.js decides its worker from window.location, which a worker lacks:
     hand it one directly */
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker('vendor/pdf.worker.min.js');
  ready = typeof OffscreenCanvas !== 'undefined' &&
    !!new OffscreenCanvas(1, 1).getContext('2d') &&
    typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
  if (!ready) whyNot = 'no OffscreenCanvas 2d';
} catch (e) {
  whyNot = String(e && e.message || e);
}

/* pdf.js draws in chunks of about 15 ms and, with no window here, goes on
   to the next chunk straight away, as a microtask: the worker would read
   no message (a cancel, a detail wanted now) until the whole page is done,
   which for a CAD sheet is over a second. Between chunks it now gives way
   to the message queue; a MessageChannel does that without setTimeout's
   4 ms clamp. */
const yieldQ = [];
const yieldCh = new MessageChannel();
yieldCh.port1.onmessage = function () { const next = yieldQ.shift(); if (next) next(); };
function yieldThen(next) { yieldQ.push(next); yieldCh.port2.postMessage(0); }

const docs = new Map();      /* key -> { task, promise, file, raw, slow, fx } */
const renders = new Map();   /* rid -> pdf.js RenderTask, or null while it starts */

function openDoc(m) {
  /* the same key again: reopened, say now with its password */
  const old = docs.get(m.key);
  if (old && old.task) old.task.destroy().catch(function () {});
  /* a file is read here; bytes arrive already read */
  const data = m.file ? m.file.arrayBuffer().then(function (b) { return new Uint8Array(b); })
    : Promise.resolve(m.bytes);
  /* pdf.js takes the bytes it is given (they are detached): PDFium, if a
     page turns out to need it, reads the file again or uses the original */
  const entry = { task: null, promise: null, file: m.file || null, raw: m.file ? null : m.bytes,
                  password: m.password || null, slow: new Map(), fx: null };
  if (old) closePdfium(old);
  entry.promise = data.then(function (bytes) {
    if (docs.get(m.key) !== entry) throw new Error('closed');
    entry.task = openTask(m, entry.raw ? bytes.slice(0) : bytes);
    return entry.task.promise;
  });
  /* a rejected open is reported by the render that waits on it */
  entry.promise.catch(function () {});
  docs.set(m.key, entry);
}

function openTask(m, bytes) {
  return pdfjsLib.getDocument({
    data: bytes,
    password: m.password || undefined,
    ownerDocument: docShim,
    /* without a font set, pdf.js draws each glyph as a path itself */
    disableFontFace: !self.fonts
  });
}

async function render(m) {
  renders.set(m.rid, null);
  const entry = docs.get(m.key);
  if (!entry) throw new Error('open failed: document ' + m.key + ' is not open');
  let doc;
  try { doc = await entry.promise; }
  catch (e) { throw new Error('open failed: ' + (e && e.message || e)); }
  if (!renders.has(m.rid)) return { cancelled: true };
  const page = await doc.getPage(m.num);
  if (!renders.has(m.rid)) return { cancelled: true };
  const viewport = page.getViewport({ scale: m.scale, rotation: m.rotation });
  if (m.fast && (entry.slow.get(m.num) || 0) > HEAVY_MS) {
    try {
      const bitmap = await drawWithPdfium(entry, page, viewport, m);
      if (!renders.has(m.rid)) { bitmap.close(); return { cancelled: true }; }
      return { bitmap: bitmap, engine: 'pdfium' };
    } catch (e) { /* not loaded, or failed on this page: pdf.js draws it */ }
    if (!renders.has(m.rid)) return { cancelled: true };
  }
  const canvas = new OffscreenCanvas(m.w, m.h);
  const task = page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport: viewport,
    transform: m.transform || null,
    intent: m.intent || 'display'
  });
  task.onContinue = yieldThen;
  renders.set(m.rid, task);
  const t0 = performance.now();
  try { await task.promise; }
  catch (e) {
    canvas.width = canvas.height = 0;
    if (e && e.name === 'RenderingCancelledException') return { cancelled: true };
    throw e;
  }
  /* pdf.js runs every drawing command of the page whatever part is shown:
     its time for the page decides whether PDFium draws the parts */
  const took = performance.now() - t0;
  entry.slow.set(m.num, Math.max(entry.slow.get(m.num) || 0, took));
  /* a heavy page is one people zoom into: have PDFium ready by then */
  if (took > HEAVY_MS && !entry.fx) pdfiumDoc(entry);
  const bitmap = canvas.transferToImageBitmap();
  if (m.drop) page.cleanup();
  return { bitmap: bitmap, engine: 'pdfjs' };
}

/* ---------------- PDFium, for the parts of heavy pages ----------------
   pdf.js runs all of a page's drawing commands for any part of it, so a
   zoomed-in part of a CAD sheet costs as much as the whole sheet (over a
   second). PDFium skips what falls outside the part: about 15 times faster
   there. It is 2 MB (compressed) of WebAssembly, so it loads only the first
   time a page proves heavy, and draws only parts ("fast" renders) of such
   pages; the whole-page bitmaps stay pdf.js's. Pages with form fields stay
   with pdf.js too: it leaves the fields to the app's own controls, where
   PDFium would draw them into the picture. */
const HEAVY_MS = 250;
let pdfiumP = null;
function pdfium() {
  if (!pdfiumP) {
    pdfiumP = (async function () {
      const mod = await import('./vendor/pdfium/pdfium.esm.js');
      const wasm = await (await fetch('vendor/pdfium/pdfium.wasm')).arrayBuffer();
      const P = await mod.init({ wasmBinary: wasm });
      P.PDFiumExt_Init();
      return P;
    })();
  }
  return pdfiumP;
}

/* does the page have form fields? Asked of PDFium: pdf.js would ask its
   parser, which is busy with the page's drawing commands just then */
const FPDF_ANNOT_WIDGET = 20;
function hasWidgets(P, pg) {
  const n = P.FPDFPage_GetAnnotCount(pg);
  for (let i = 0; i < n; i++) {
    const a = P.FPDFPage_GetAnnot(pg, i);
    if (!a) continue;
    const widget = P.FPDFAnnot_GetSubtype(a) === FPDF_ANNOT_WIDGET;
    P.FPDFPage_CloseAnnot(a);
    if (widget) return true;
  }
  return false;
}

/* the document in PDFium: its bytes copied into WebAssembly memory once */
function pdfiumDoc(entry) {
  if (!entry.fx) {
    entry.fx = (async function () {
      const P = await pdfium();
      const bytes = entry.file ? new Uint8Array(await entry.file.arrayBuffer()) : entry.raw;
      const M = P.pdfium;
      const ptr = M.wasmExports.malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      const doc = P.FPDF_LoadMemDocument(ptr, bytes.length, entry.password || '');
      if (!doc) { M.wasmExports.free(ptr); throw new Error('PDFium could not open it: ' + P.FPDF_GetLastError()); }
      return { P: P, doc: doc, ptr: ptr };
    })();
    entry.fx.catch(function () {});
  }
  return entry.fx;
}
function closePdfium(entry) {
  if (!entry.fx) return;
  entry.fx.then(function (fx) {
    fx.P.FPDF_CloseDocument(fx.doc);
    fx.P.pdfium.wasmExports.free(fx.ptr);
  }, function () {});
  entry.fx = null;
}

/* a * b, pdf.js's [a b c d e f] matrices */
function mul(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
          a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
          a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function inv(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d,
          (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

async function drawWithPdfium(entry, page, viewport, m) {
  const fx = await pdfiumDoc(entry);
  const P = fx.P, M = P.pdfium;
  /* PDFium starts from the page as pdf.js lays it out at 100%, turned as
     the file says (/Rotate); from there, the same turn, zoom and shift
     pdf.js's viewport and the request's transform make */
  const base = page.getViewport({ scale: 1, rotation: page.rotate }).transform;
  const t = mul(m.transform || [1, 0, 0, 1, 0, 0], mul(viewport.transform, inv(base)));
  const w = m.w, h = m.h;
  const pg = P.FPDF_LoadPage(fx.doc, m.num - 1);
  if (!pg) throw new Error('PDFium could not load page ' + m.num);
  if (hasWidgets(P, pg)) { P.FPDF_ClosePage(pg); throw new Error('form fields: pdf.js draws this page'); }
  const bmp = P.FPDFBitmap_Create(w, h, 1);
  const mat = M.wasmExports.malloc(24), clip = M.wasmExports.malloc(16);
  try {
    P.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xFFFFFFFF);
    M.HEAPF32.set(t, mat >> 2);
    M.HEAPF32.set([0, 0, w, h], clip >> 2);
    P.FPDF_RenderPageBitmapWithMatrix(bmp, pg, mat, clip, 0x01 | 0x10);   /* annotations; RGBA */
    const buf = P.FPDFBitmap_GetBuffer(bmp), stride = P.FPDFBitmap_GetStride(bmp);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) rgba.set(M.HEAPU8.subarray(buf + y * stride, buf + y * stride + w * 4), y * w * 4);
    return await createImageBitmap(new ImageData(rgba, w, h));
  } finally {
    M.wasmExports.free(mat); M.wasmExports.free(clip);
    P.FPDFBitmap_Destroy(bmp);
    P.FPDF_ClosePage(pg);
  }
}

self.onmessage = function (e) {
  const m = e.data;
  if (m.op === 'hello') { postMessage({ op: 'hello', ok: ready, why: whyNot }); return; }
  if (m.op === 'open') { openDoc(m); return; }
  if (m.op === 'close') {
    const entry = docs.get(m.key);
    docs.delete(m.key);
    if (entry) closePdfium(entry);
    if (entry && entry.task) entry.task.destroy().catch(function () {});
    return;
  }
  if (m.op === 'cancel') {
    const task = renders.get(m.rid);
    renders.delete(m.rid);
    if (task) { try { task.cancel(); } catch (err) {} }
    return;
  }
  if (m.op === 'release') {
    const entry = docs.get(m.key);
    if (entry) {
      entry.promise.then(function (doc) { return doc.getPage(m.num); })
        .then(function (page) { page.cleanup(); })
        .catch(function () {});
    }
    return;
  }
  if (m.op === 'render') {
    render(m).then(function (out) {
      renders.delete(m.rid);
      if (out.bitmap) postMessage({ rid: m.rid, bitmap: out.bitmap, engine: out.engine }, [out.bitmap]);
      else postMessage({ rid: m.rid, cancelled: true });
    }, function (err) {
      renders.delete(m.rid);
      postMessage({ rid: m.rid, error: String(err && err.message || err) });
    });
  }
};
