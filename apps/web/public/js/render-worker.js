/* Draws pages off the main thread.

   The viewer asks for a page at a size and gets back a finished bitmap, so a
   page that takes seconds to draw (a CAD sheet with tens of thousands of
   lines) never freezes scrolling, typing or the tools. pdf.js runs here in
   full: its display layer draws on an OffscreenCanvas, and its parser runs in
   a worker of its own, started from this one.

   Messages in:
     { op: 'hello' }                                    -> { op: 'hello', ok }
     { op: 'open', key, bytes, password }               opens a document
     { op: 'close', key }                               frees it
     { op: 'render', rid, key, num, scale, rotation, w, h, transform, intent, drop }
                                                        -> { rid, bitmap } | { rid, cancelled } | { rid, error }
                                                        (an error starting "open failed" means the document)
     { op: 'cancel', rid }                              stops that render
     { op: 'release', key, num }                        frees a page's drawing data
   (drop: free the page's drawing data once drawn, for a one-off like a
   thumbnail)

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

const docs = new Map();      /* key -> { task, promise } */
const renders = new Map();   /* rid -> pdf.js RenderTask, or null while it starts */

function openDoc(m) {
  const task = pdfjsLib.getDocument({
    data: m.bytes,
    password: m.password || undefined,
    ownerDocument: docShim,
    /* without a font set, pdf.js draws each glyph as a path itself */
    disableFontFace: !self.fonts
  });
  const entry = { task: task, promise: task.promise };
  /* a rejected open is reported by the render that waits on it */
  entry.promise.catch(function () {});
  docs.set(m.key, entry);
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
  const canvas = new OffscreenCanvas(m.w, m.h);
  const task = page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport: viewport,
    transform: m.transform || null,
    intent: m.intent || 'display'
  });
  renders.set(m.rid, task);
  try { await task.promise; }
  catch (e) {
    canvas.width = canvas.height = 0;
    if (e && e.name === 'RenderingCancelledException') return { cancelled: true };
    throw e;
  }
  const bitmap = canvas.transferToImageBitmap();
  if (m.drop) page.cleanup();
  return { bitmap: bitmap };
}

self.onmessage = function (e) {
  const m = e.data;
  if (m.op === 'hello') { postMessage({ op: 'hello', ok: ready, why: whyNot }); return; }
  if (m.op === 'open') { openDoc(m); return; }
  if (m.op === 'close') {
    const entry = docs.get(m.key);
    docs.delete(m.key);
    if (entry) entry.task.destroy().catch(function () {});
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
      if (out.bitmap) postMessage({ rid: m.rid, bitmap: out.bitmap }, [out.bitmap]);
      else postMessage({ rid: m.rid, cancelled: true });
    }, function (err) {
      renders.delete(m.rid);
      postMessage({ rid: m.rid, error: String(err && err.message || err) });
    });
  }
};
