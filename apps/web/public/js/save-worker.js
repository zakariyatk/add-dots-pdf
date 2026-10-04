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
                                                    -> { rid, out, appended } | { rid, error: { name, message } }
   opts.append asks for the marks to be saved onto the original (an
   incremental update, E.appendPdf) when the pages allow it; appended says
   whether they were, else the file was rebuilt.
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

/* A Google Font's file (js/fonts.js picks the same one: the nearest style
   the family has), with fontkit to embed it */
const fileFonts = {};
function loadFileFont(f, style) {
  if (!self.ADDDOTS_FONT_LIST) importScripts('fonts-list.js');
  const fam = (self.ADDDOTS_FONT_LIST || []).filter(function (x) { return 'g:' + x.id === f; })[0];
  if (!fam) return Promise.resolve(null);
  const near = [[0], [1, 0], [2, 0], [3, 1, 2, 0]][style] || [0];
  const k = near.filter(function (i) { return fam.styles[i]; })[0] || 0;
  const path = '../assets/fonts/google/' + fam.id + '-' + ['r', 'b', 'i', 'bi'][k] + '.ttf';
  if (!fileFonts[path]) {
    fileFonts[path] = Promise.all([loadUnicodeFont(), fetchBytes(path)]).then(function (got) {
      return { fontkit: got[0].fontkit, bytes: got[1] };
    });
    fileFonts[path].catch(function () { delete fileFonts[path]; });
  }
  return fileFonts[path];
}

function joined(parts) {
  const out = new Uint8Array(parts.reduce(function (n, p) { return n + p.length; }, 0));
  let at = 0;
  parts.forEach(function (p) { out.set(p, at); at += p.length; });
  return out;
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
  const hooks = function () {
    return E.saveHooks(m.state, {
      measure: function (item, line) { return measure ? measure(item, line) : null; },
      unicode: { load: loadUnicodeFont, loadEmoji: loadEmojiFont },
      fonts: { load: loadFileFont }
    });
  };
  const opts = m.opts || {};
  if (opts.append) {
    const got = await E.appendPdf(items, opts, hooks());
    if (got) return { parts: [got.src.bytes, got.update], appended: true };
  }
  return { parts: [await E.buildPdf(items, cache.map, opts, hooks())], appended: false };
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
  build(m).then(function (r) {
    if (m.blob) {
      self.postMessage({ rid: m.rid, out: new Blob(r.parts, { type: 'application/pdf' }), appended: r.appended });
      return;
    }
    const bytes = r.parts.length === 1 ? r.parts[0] : joined(r.parts);
    self.postMessage({ rid: m.rid, out: bytes, appended: r.appended }, [bytes.buffer]);
  }, function (err) {
    self.postMessage({ rid: m.rid, error: { name: err && err.name || 'Error', message: String(err && err.message || err) } });
  });
};
