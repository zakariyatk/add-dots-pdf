/* Builds the PDF to save off the main thread.

   Saving copies every page's content, images included, into a new file and
   writes it out in one piece: on an 84 MB file of scans the page froze for
   three-quarters of a second at a time, 2.7 s in all. Here the same engine
   builds it (pdf-lib and js/engine.js, with the hooks from saveHooks), and
   the finished file goes back as a Blob, so the page does not copy it again
   to download it.

   Messages in:
     { op: 'hello' }                                -> { op: 'hello', ok }
     { op: 'source', id, bytes | file, name }       a source file, sent once
     { op: 'forget', id }                           frees it
     { op: 'build', rid, items, state, opts, cacheId, blob }
                                                    -> { rid, out } | { rid, error: { name, message } }
   items are { src: id, num, rot, crop, shapes, fields }. Builds that share a
   cacheId (the pages of one file split up) parse each source once. */
'use strict';

let ready = false, whyNot = '';
try {
  importScripts('vendor/pdf-lib.min.js', 'engine.js');
  ready = !!(self.PDFLib && self.ADDPDFEngine);
} catch (e) { whyNot = String(e && e.message || e); }
const E = self.ADDPDFEngine;

const sources = new Map();
let cache = { id: null, map: null };

let measure = null;
const measured = ready ? E.createTextMeasurer().then(function (m) { measure = m; }, function () {}) : null;

/* the fonts for text the standard fonts cannot draw, as the page loads them */
let unicodeFont = null, emojiFont = null;
function fetchBytes(path) {
  return fetch(new URL(path, self.location.href)).then(function (r) {
    if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
    return r.arrayBuffer();
  }).then(function (b) { return new Uint8Array(b); });
}
function loadUnicodeFont() {
  if (!unicodeFont) {
    unicodeFont = fetchBytes('../assets/fonts/DejaVuSans.ttf').then(function (bytes) {
      if (!self.fontkit) importScripts('vendor/fontkit.umd.min.js');
      if (!self.fontkit) throw new Error('fontkit missing');
      return { fontkit: self.fontkit, bytes: bytes };
    });
    unicodeFont.catch(function () { unicodeFont = null; });
  }
  return unicodeFont;
}
function loadEmojiFont() {
  if (!emojiFont) {
    emojiFont = fetchBytes('../assets/fonts/NotoEmoji.ttf');
    emojiFont.catch(function () { emojiFont = null; });
  }
  return emojiFont;
}

async function build(m) {
  await measured;
  const srcs = new Map();
  for (const it of m.items) {
    if (srcs.has(it.src)) continue;
    const s = sources.get(it.src);
    if (!s) throw new Error('save worker: source ' + it.src + ' was not sent');
    /* a file being read is a promise until it has been; one changed on disk
       since it was opened cannot be read, and the page sends its bytes */
    let bytes;
    try { bytes = await s.bytes; } catch (err) {
      sources.delete(it.src);
      const e = new Error('save worker: source ' + it.src + ' could not be read (' + (err && err.message) + ')');
      e.name = 'SaveSourceUnreadable';
      throw e;
    }
    srcs.set(it.src, { id: it.src, bytes: bytes, name: s.name });
  }
  const items = m.items.map(function (it) { return Object.assign({}, it, { src: srcs.get(it.src) }); });
  if (m.cacheId !== cache.id) cache = { id: m.cacheId, map: m.cacheId == null ? null : new Map() };
  const hooks = E.saveHooks(m.state, {
    measure: function (item, line) { return measure ? measure(item, line) : null; },
    unicode: { load: loadUnicodeFont, loadEmoji: loadEmojiFont }
  });
  return E.buildPdf(items, cache.map, m.opts || {}, hooks);
}

self.onmessage = function (e) {
  const m = e.data;
  if (m.op === 'hello') { self.postMessage({ op: 'hello', ok: ready, why: whyNot }); return; }
  if (m.op === 'source') {
    const bytes = m.file ? m.file.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : m.bytes;
    sources.set(m.id, { bytes: bytes, name: m.name });
    return;
  }
  if (m.op === 'forget') { sources.delete(m.id); if (cache.map) cache.map.delete(m.id); return; }
  if (m.op !== 'build') return;
  build(m).then(function (bytes) {
    if (m.blob) self.postMessage({ rid: m.rid, out: new Blob([bytes], { type: 'application/pdf' }) });
    else self.postMessage({ rid: m.rid, out: bytes }, [bytes.buffer]);
  }, function (err) {
    self.postMessage({ rid: m.rid, error: { name: err && err.name || 'Error', message: String(err && err.message || err) } });
  });
};
