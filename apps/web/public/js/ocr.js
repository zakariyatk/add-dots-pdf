/* Add Dots PDF — OCR
   -----------------
   Reads the text on scanned pages and keeps it as an 'ocr' mark on each page:
   invisible, found by Find, copied with Copy text, and written into the
   saved PDF over the words it was read from (packages/engine, painters/ocr),
   so the file can be searched and selected in any reader.

   With "Make text editable" (as Acrobat edits a scan), each line read
   becomes a text box instead, where it was: the same baseline, slant and
   width, in the scan's ink colour, over a patch of the paper's colour that
   covers the scanned words. It is edited, moved and saved like any text
   (a double-click), and saved as real text in the page. A line the
   built-in fonts cannot write (Arabic) stays in the invisible 'ocr' mark.

   The page is drawn as it is seen (with its turn), the words come back in
   that picture's pixels, and each is turned into page points by the same
   viewport, so a rotated scan lands right too.

   Who reads: in the Windows app, Windows' own text reader (Windows.Media.Ocr,
   src-tauri/src/ocr.rs) when it has the language (for English and Arabic,
   both), much faster and with nothing to download; else, and on any error
   there, Tesseract (in
   js/vendor/tesseract, loaded only the first time it is needed).
   localStorage adpdf.ocr = 'tesseract' always uses Tesseract, to compare. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[ocr] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;

    /* ---------------- the button, on the Edit tab ---------------- */

    const pan = $('panEdit');
    const sep = document.createElement('span'); sep.className = 'sep';
    const grp = document.createElement('div'); grp.className = 'grp'; grp.id = 'grpOcr';
    const b = document.createElement('button');
    b.className = 'btn'; b.id = 'btnOcr'; b.dataset.label = 'OCR PDF';
    b.title = 'OCR PDF — read the text on scanned pages, so it can be searched, selected and copied';
    b.setAttribute('aria-label', 'OCR PDF');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/>' +
      '<path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/>' +
      '<path d="M8 15V9.5a1.5 1.5 0 0 1 3 0V15"/><line x1="8" y1="12.5" x2="11" y2="12.5"/>' +
      '<path d="M16.5 10a2 2 0 0 0-3.5 1.3v1.4a2 2 0 0 0 3.5 1.3"/></svg><span class="lbl">OCR PDF</span>';
    grp.appendChild(b);
    if (pan) { pan.appendChild(sep); pan.appendChild(grp); }

    /* ---------------- the dialog ---------------- */

    const dlg = document.createElement('div');
    dlg.className = 'pop blankdlg ocrdlg'; dlg.id = 'ocrPop'; dlg.hidden = true;
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'OCR PDF');
    dlg.innerHTML =
      '<header class="bdhead"><b>OCR PDF</b><span class="grow"></span>' +
      '<button class="x" id="ocrX" type="button" aria-label="Close">&times;</button></header>' +
      '<h4>Recognise text</h4>' +
      '<div class="bdgrid">' +
      '<label for="ocrLang">Language</label>' +
      '<select id="ocrLang"><option value="eng">English</option><option value="ara">Arabic</option>' +
      '<option value="eng+ara">English and Arabic</option></select>' +
      '</div>' +
      '<h4>Pages</h4>' +
      '<div class="bdwhere">' +
      '<label class="rad"><input type="radio" name="ocrWhich" value="cur" checked> Current page</label>' +
      '<label class="rad"><input type="radio" name="ocrWhich" value="all"> All pages</label>' +
      '<div class="bdpages"><label class="rad"><input type="radio" name="ocrWhich" value="pages"> Pages</label>' +
      '<input id="ocrPages" value="" aria-label="Pages" spellcheck="false"><span class="of" id="ocrOf"></span>' +
      '<span class="eg">Example: 1,8,1-10</span></div>' +
      '<label class="rad"><input type="checkbox" id="ocrSkip" checked> Skip pages that already have text</label>' +
      '</div>' +
      '<h4>Result</h4>' +
      '<div class="bdwhere">' +
      '<label class="rad" title="Each line becomes a text box where it was, in the same size and colour, ready to edit">' +
      '<input type="checkbox" id="ocrEdit"> Make text editable, in place</label>' +
      '</div>' +
      '<div class="ocrprog" id="ocrProg" hidden><div class="bar"><div class="fill" id="ocrBar"></div></div><span id="ocrStep"></span></div>' +
      '<p class="bdnote ocrnote" id="ocrNote"></p>' +
      '<footer>' +
      '<button class="btn" id="ocrCopy" hidden>Copy text</button>' +
      '<span class="grow"></span>' +
      '<button class="btn primary" id="ocrGo">Recognise text</button>' +
      '<button class="btn" id="ocrCancel">Close</button>' +
      '</footer>';
    document.body.appendChild(dlg);
    X.registerPop && X.registerPop('ocrPop', 'btnOcr');

    /* "Make text editable": on unless turned off, and remembered */
    const EDIT_KEY = 'adpdf.ocr.edit';
    try { $('ocrEdit').checked = localStorage.getItem(EDIT_KEY) !== '0'; } catch (e) { $('ocrEdit').checked = true; }
    $('ocrEdit').addEventListener('change', function () {
      try { localStorage.setItem(EDIT_KEY, $('ocrEdit').checked ? '1' : '0'); } catch (e) { /* not kept */ }
    });

    function open() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      $('ocrPages').value = String(S.current || 1);
      $('ocrOf').textContent = '/' + S.items.length;
      $('ocrNote').textContent = '';
      $('ocrProg').hidden = !busy;
      $('ocrCopy').hidden = !lastText;
      X.openPop ? X.openPop('ocrPop', b) : (dlg.hidden = false);
    }
    b.addEventListener('click', function () { dlg.hidden ? open() : X.closePops(); });
    X.openOcr = open;
    $('ocrX').addEventListener('click', function () { X.closePops(); });
    $('ocrCancel').addEventListener('click', function () { if (busy) stop = true; else X.closePops(); });
    $('ocrPages').addEventListener('focus', function () {
      dlg.querySelector('input[name="ocrWhich"][value="pages"]').checked = true;
    });
    $('ocrPages').addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') $('ocrGo').click(); });

    function which() {
      const r = dlg.querySelector('input[name="ocrWhich"]:checked');
      const n = S.items.length;
      if (!r || r.value === 'cur') return [S.current];
      if (r.value === 'all') return S.items.map(function (_, i) { return i + 1; });
      return window.ADDPDFEngine.parseRanges($('ocrPages').value, n);
    }

    /* ---------------- Tesseract, loaded once ---------------- */

    const BASE = 'js/vendor/tesseract/';
    let lib = null;
    const workers = {};            /* by language */

    function loadScript(src) {
      return new Promise(function (res, rej) {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
        document.head.appendChild(s);
      });
    }
    async function tesseract() {
      if (window.Tesseract) return window.Tesseract;
      if (!lib) lib = loadScript('js/vendor/tesseract/tesseract.min.js');
      await lib;
      return window.Tesseract;
    }
    function simd() {
      /* the smallest module that uses a SIMD instruction */
      try {
        return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
          2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
      } catch (e) { return false; }
    }
    let onProgress = null;
    async function workerFor(lang) {
      if (workers[lang]) return workers[lang];
      const T = await tesseract();
      const here = function (p) { return new URL(p, location.href).href; };
      workers[lang] = T.createWorker(lang.split('+'), 1, {
        workerPath: here('js/vendor/tesseract/worker.min.js'),
        corePath: here(BASE + (simd() ? 'tesseract-core-simd-lstm' : 'tesseract-core-lstm') + '.wasm.js'),
        langPath: here(BASE + 'lang'),
        gzip: true,
        workerBlobURL: false,
        logger: function (m) { if (onProgress) onProgress(m); }
      });
      try { return await workers[lang]; }
      catch (e) { delete workers[lang]; throw e; }
    }

    /* ---------------- Windows' own reader, in the Windows app ---------------- */

    const WIN = (function () {
      /* the desktop side, through the window when this is a document tab;
         asked each run (the smoke test stands one in late) */
      function desk() {
        let T = window.__TAURI__, U8 = Uint8Array;
        try {
          if (!T && window.parent !== window && window.parent.__TAURI__) { T = window.parent.__TAURI__; U8 = window.parent.Uint8Array; }
        } catch (e) { T = null; }
        return T && T.core ? { T: T, U8: U8 } : null;
      }
      let status = null, seen = null;
      const api = { max: 0 };
      /* Windows' tag for the dialog's language ('eng', 'ara'), or tags with
         a comma between for 'eng+ara' (each read by its recogniser and put
         together, src-tauri/src/ocr.rs merge); or null: not the Windows app,
         or no recogniser for one of them on this computer (a language pack
         Windows has not installed) */
      api.tag = async function (lang) {
        const d = desk();
        if (!d) return null;
        try { if (localStorage.getItem('adpdf.ocr') === 'tesseract') return null; } catch (e) { /* allowed */ }
        if (!status || seen !== d.T) {
          seen = d.T;
          status = d.T.core.invoke('ocr_status').catch(function (e) {
            console.warn('[ocr] Windows reader', e);
            return { languages: [], max: 0 };
          });
        }
        const st = await status;
        api.max = st.max || 0;
        if (!api.max) return null;
        const one = function (code) {
          const want = { eng: 'en', ara: 'ar' }[code];
          if (!want) return null;
          const tags = (st.languages || []).filter(function (t) {
            const l = String(t).toLowerCase();
            return l === want || l.indexOf(want + '-') === 0;
          });
          /* English as written in the US first, the usual pack; else any */
          return tags.filter(function (t) { return /^en-us$/i.test(t); })[0] || tags[0] || null;
        };
        const got = lang.split('+').map(one);
        return got.every(Boolean) ? got.join(',') : null;
      };
      /* the words on a canvas, as Tesseract gives them: text and box */
      api.read = async function (c, tag) {
        const d = desk();
        const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        const words = await d.T.core.invoke('ocr_page', new d.U8(img.data.buffer), {
          headers: { 'x-w': String(c.width), 'x-h': String(c.height), 'x-lang': tag }
        });
        return words.map(function (w) {
          return { text: w.text, confidence: 100, bbox: { x0: w.x, y0: w.y, x1: w.x + w.w, y1: w.y + w.h } };
        });
      };
      return api;
    })();
    /* who read the last run ('windows' or 'tesseract'): for the tests */
    X.ocrBy = null;

    /* ---------------- reading a page ---------------- */

    /* about 300 dpi, within what every browser's canvas can hold, and within
       the largest picture Windows' reader takes when it is the one reading */
    function renderScale(page, rotation, side) {
      const v = page.getViewport({ scale: 1, rotation: rotation });
      const k = Math.min(300 / 72, Math.min(4200, side || 4200) / Math.max(v.width, v.height));
      /* at least 1x, unless Windows' limit is smaller than the page */
      return side ? k : Math.max(1, k);
    }

    async function hasOwnText(it) {
      try {
        const tc = await it.page.getTextContent();
        return tc.items.some(function (x) { return x.str && x.str.trim(); });
      } catch (e) { return false; }
    }

    /* reader: { tag } for Windows' reader, else { worker } for Tesseract.
       Resolves to { words, lines }: every word, as the 'ocr' mark keeps it;
       and with editable, the lines made into text boxes (editLines), each
       with the words it took */
    async function readPage(it, reader, editable) {
      await X.ensurePage(it);
      const page = it.page;
      const rotation = ((page.rotate || 0) + (it.rot || 0)) % 360;
      const side = reader.tag ? WIN.max : 0;
      const vp = page.getViewport({ scale: renderScale(page, rotation, side), rotation: rotation });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const words = [], read = [];
      let lines = [];
      try {
        const found = reader.tag ? await WIN.read(c, reader.tag) : (await reader.worker.recognize(c)).data.words || [];
        found.forEach(function (w) {
          const t = (w.text || '').trim();
          if (!t || w.confidence < 25) return;
          const bb = w.bbox;
          /* the baseline, from the left end to the right, in page points */
          const base = w.baseline && w.baseline.has_baseline !== false && isFinite(w.baseline.y0)
            ? [w.baseline.x0, w.baseline.y0, w.baseline.x1, w.baseline.y1] : null;
          const p0 = vp.convertToPdfPoint(bb.x0, base ? base[1] : bb.y1);
          const p1 = vp.convertToPdfPoint(bb.x1, base ? base[3] : bb.y1);
          const top = vp.convertToPdfPoint(bb.x0, bb.y0);
          const h = Math.hypot(top[0] - p0[0], top[1] - p0[1]);
          const r = function (n) { return Math.round(n * 100) / 100; };
          const word = [r(p0[0]), r(p0[1]), r(p1[0]), r(p1[1]), r(Math.max(2, h)), t];
          words.push(word);
          /* and where it is in the picture, for the lines */
          const by = base ? (base[1] + base[3]) / 2 : bb.y1;
          read.push({ word: word, t: t, x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1, base: by, h: Math.max(2, by - bb.y0) });
        });
        /* the picture is still here: the paper's and the ink's colours */
        if (editable) lines = editLines(read, g, c, vp);
      } finally {
        c.width = c.height = 1;               /* give the memory back now */
      }
      return { words: words, lines: lines };
    }

    /* ---------------- editable text, in place ---------------- */

    /* what the built-in fonts (Helvetica) can write: Latin */
    const LATIN = /^[ -ÿ€–—‘’‚“”„•…]*$/;
    function median(a) { const b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
    function hex(rgb) {
      return '#' + rgb.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); })
        .join('').toUpperCase();
    }

    /* the words on one baseline, close enough together to be one line (a
       wide gap, as between a table's columns, starts another) */
    function groupLines(read) {
      const lines = [];
      read.slice().sort(function (a, b) { return a.x0 - b.x0; }).forEach(function (w) {
        let best = null, bd = Infinity;
        lines.forEach(function (l) {
          const h = Math.max(l.h, w.h);
          const d = Math.abs(l.base - w.base);
          const gap = w.x0 - l.x1;
          if (d < h * 0.45 && gap < h * 1.6 && gap > -h * 0.5 && d < bd) { best = l; bd = d; }
        });
        if (best) {
          best.ws.push(w);
          best.x1 = Math.max(best.x1, w.x1);
          best.h = Math.max(best.h, w.h);
        } else {
          lines.push({ ws: [w], x1: w.x1, base: w.base, h: w.h });
        }
      });
      return lines;
    }

    /* the paper: the commonest colour on a ring just outside the box; the
       ink: what in the box stands furthest from it; bold: strokes thicker
       than a regular face's (about a tenth of the capitals' height) */
    function colours(g, c, x0, y0, x1, y1, cap) {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(c.width, Math.ceil(x1)); y1 = Math.min(c.height, Math.ceil(y1));
      const w = x1 - x0, h = y1 - y0;
      if (w < 6 || h < 6) return { bg: '#FFFFFF', ink: '#1C1F24', bold: false };
      const d = g.getImageData(x0, y0, w, h).data;
      const counts = {};
      let bk = null, bn = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x > 1 && y > 1 && x < w - 2 && y < h - 2) continue;   /* the ring only */
          const i = (y * w + x) * 4;
          const k = (d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3);
          const n = counts[k] = (counts[k] || 0) + 1;
          if (n > bn) { bn = n; bk = k; }
        }
      }
      const bg = bk.split(',').map(function (v) { return v * 8 + 4; });
      let far = 0;
      const dist = new Float32Array(w * h);
      for (let j = 0; j < w * h; j++) {
        const i = j * 4;
        dist[j] = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
        if (dist[j] > far) far = dist[j];
      }
      if (far < 60) return { bg: hex(bg), ink: '#1C1F24', bold: false };
      const sum = [0, 0, 0];
      let n = 0;
      for (let j = 0; j < w * h; j++) {
        if (dist[j] < far * 0.6) continue;
        sum[0] += d[j * 4]; sum[1] += d[j * 4 + 1]; sum[2] += d[j * 4 + 2]; n++;
      }
      /* the strokes across: runs of ink along the rows of the box's middle */
      const runs = [];
      for (let y = Math.floor(h * 0.35); y < Math.ceil(h * 0.65); y++) {
        let run = 0;
        for (let x = 0; x < w; x++) {
          if (dist[y * w + x] >= far * 0.5) run++;
          else { if (run) runs.push(run); run = 0; }
        }
        if (run) runs.push(run);
      }
      const bold = runs.length > 4 && cap > 0 && median(runs) / cap > 0.16;
      return { bg: hex(bg), ink: n ? hex(sum.map(function (v) { return v / n; })) : '#1C1F24', bold: bold };
    }

    /* each line as a text box (core.js, the Edit Text tool's kind): its
       baseline where the scan's is, turned with it, sized to the scan's
       width in Helvetica, over a patch of paper that hides the scanned words */
    function editLines(read, g, c, vp) {
      const k = vp.scale;
      const out = [];
      groupLines(read).forEach(function (l) {
        const ws = l.ws;
        const text = ws.map(function (w) { return w.t; }).join(' ');
        if (!LATIN.test(text)) return;        /* stays in the invisible mark */
        const left = Math.min.apply(null, ws.map(function (w) { return w.x0; }));
        const right = Math.max.apply(null, ws.map(function (w) { return w.x1; }));
        const top = Math.min.apply(null, ws.map(function (w) { return w.y0; }));
        const bottom = Math.max.apply(null, ws.map(function (w) { return w.y1; }));
        const base = median(ws.map(function (w) { return w.base; }));
        const cap = median(ws.map(function (w) { return w.h; }));
        const pad = Math.max(2, Math.round(cap * 0.15));
        /* the tallest letters (capitals, ascenders) measure the strokes against */
        const tall = Math.max.apply(null, ws.map(function (w) { return w.h; }));
        const col = colours(g, c, left - pad - 2, top - pad - 2, right + pad + 2, bottom + pad + 2, tall);

        const a = vp.convertToPdfPoint(left, base);
        const e = vp.convertToPdfPoint(right, base);
        const rot = Math.atan2(e[1] - a[1], e[0] - a[0]) * 180 / Math.PI;
        const widthPt = Math.hypot(e[0] - a[0], e[1] - a[1]);
        /* the size that spans the scan's width, unless that is far from what
           the letters' height says (a misread word, a stretched font) */
        const byH = cap / k / 0.72;
        const w1 = X.textWidth ? X.textWidth({ f: 'helv', size: 1, b: col.bold, i: false }, text) : null;
        const byW = w1 ? widthPt / w1 : 0;
        const size = byW > byH * 0.6 && byW < byH * 1.6 ? byW : byH;
        const r = function (n) { return Math.round(n * 100) / 100; };
        const turn = Math.abs(rot) < 0.3 ? 0 : Math.round(rot * 10) / 10;
        const mark = {
          t: 'text', a: [r(a[0]), r(a[1])], text: text, size: Math.round(size * 10) / 10,
          c: col.ink, f: 'helv', b: col.bold, i: false, u: false, k: false, align: 'left', bg: null, bgOp: 1,
          /* in the text's own frame, before its turn about a */
          patch: {
            x: r(a[0] - pad / k), y: r(a[1] - (bottom - base + pad) / k),
            w: r((right - left + pad * 2) / k), h: r((bottom - top + pad * 2) / k), c: col.bg
          },
          ocr: 1
        };
        if (turn) mark.r = turn;
        out.push({ mark: mark, words: ws.map(function (w) { return w.word; }) });
      });
      return out;
    }

    /* ---------------- running it ---------------- */

    let busy = false, stop = false, lastText = '';

    function progress(done, total, what) {
      $('ocrProg').hidden = false;
      $('ocrBar').style.width = Math.round(100 * done / Math.max(1, total)) + '%';
      $('ocrStep').textContent = what;
    }

    async function run() {
      if (busy) return;
      const nums = which();
      if (!nums.length) { $('ocrNote').textContent = 'Type page numbers in this document, like 1,8,1-10.'; return; }
      const lang = $('ocrLang').value, skip = $('ocrSkip').checked, editable = $('ocrEdit').checked;
      busy = true; stop = false;
      $('ocrGo').disabled = true; $('ocrCancel').textContent = 'Stop';
      $('ocrNote').textContent = ''; $('ocrCopy').hidden = true;
      const texts = [];
      let pages = 0, words = 0, skipped = 0, boxes = 0;
      try {
        progress(0, nums.length, 'Starting the text reader…');
        let fraction = 0, at = 0;
        onProgress = function (m) {
          if (m.status === 'recognizing text') {
            fraction = m.progress || 0;
            progress(at + fraction, nums.length, 'Reading page ' + nums[at] + ' (' + (at + 1) + ' of ' + nums.length + ')…');
          } else if (/load|initializ/i.test(m.status || '') && !at) {
            progress(0, nums.length, 'Loading the text reader…');
          }
        };
        /* Windows' reader when it has the language, else Tesseract */
        const tag = await WIN.tag(lang);
        const reader = tag ? { tag: tag } : { worker: await workerFor(lang) };
        X.ocrBy = tag ? 'windows' : 'tesseract';
        X.snapshot();
        for (at = 0; at < nums.length; at++) {
          if (stop) break;
          const it = S.items[nums[at] - 1];
          if (!it) continue;
          await X.ensurePage(it);
          if (skip && await hasOwnText(it)) { skipped++; continue; }
          progress(at, nums.length, 'Reading page ' + nums[at] + ' (' + (at + 1) + ' of ' + nums.length + ')…');
          let got;
          try {
            got = await readPage(it, reader, editable);
          } catch (e) {
            if (!reader.tag) throw e;
            /* Windows' reader failed: Tesseract from here on */
            console.warn('[ocr] Windows reader, Tesseract instead', e);
            delete reader.tag;
            reader.worker = await workerFor(lang);
            X.ocrBy = 'tesseract';
            got = await readPage(it, reader, editable);
          }
          const list = got.words;
          /* a page read again replaces what was read before (its text boxes too) */
          it.shapes = it.shapes.filter(function (s) { return s.t !== 'ocr' && !(s.t === 'text' && s.ocr); });
          /* the lines made editable; the words left (Arabic) stay invisible */
          const taken = new Set();
          got.lines.forEach(function (l) {
            it.shapes.push(l.mark);
            l.words.forEach(function (w) { taken.add(w); });
          });
          boxes += got.lines.length;
          const rest = list.filter(function (w) { return !taken.has(w); });
          if (rest.length) it.shapes.push({ t: 'ocr', id: 'ocr' + Date.now().toString(36) + at, lang: lang, words: rest });
          words += list.length;
          pages++;
          texts.push('— Page ' + nums[at] + ' —\n' + lineText(list));
          if (it.anno) X.drawShapes(it);
          if (got.lines.length && X.drawThumb) X.drawThumb(it);
        }
        lastText = texts.join('\n\n');
        X.invalidateSearch();
        X.updateMeta();
        progress(1, 1, stop ? 'Stopped' : 'Done');
        $('ocrNote').className = 'bdnote ocrnote ok';
        $('ocrNote').textContent = (stop ? 'Stopped. ' : '') +
          (pages ? words + ' word' + (words === 1 ? '' : 's') + ' read on ' + pages + ' page' + (pages === 1 ? '' : 's') + '. ' : '') +
          (skipped ? skipped + ' page' + (skipped === 1 ? '' : 's') + ' already had text. ' : '') +
          (boxes ? boxes + ' line' + (boxes === 1 ? ' is' : 's are') + ' now text to edit: double-click one. ' : '') +
          (pages ? 'Find searches it now; Save to keep it in the PDF.' : '');
        $('ocrCopy').hidden = !lastText.trim();
        X.toast(pages ? 'Text read on <b>' + pages + '</b> page' + (pages === 1 ? '' : 's') + ' · Save to keep it in the PDF'
                      : 'Nothing to read');
      } catch (e) {
        console.error('[ocr]', e);
        $('ocrNote').className = 'bdnote ocrnote';
        $('ocrNote').textContent = 'The text could not be read: ' + ((e && e.message) || e);
      } finally {
        onProgress = null;
        busy = false; stop = false;
        $('ocrGo').disabled = false; $('ocrCancel').textContent = 'Close';
      }
    }
    $('ocrGo').addEventListener('click', run);

    /* the words in reading order, one line per baseline */
    function lineText(list) {
      const rows = [];
      list.slice().sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; }).forEach(function (w) {
        const row = rows.filter(function (r) { return Math.abs(r.y - w[1]) < w[4] * 0.5; })[0];
        if (row) row.w.push(w); else rows.push({ y: w[1], w: [w] });
      });
      return rows.map(function (r) {
        return r.w.sort(function (a, b) { return a[0] - b[0]; }).map(function (w) { return w[5]; }).join(' ');
      }).join('\n');
    }
    $('ocrCopy').addEventListener('click', function () {
      const done = function () { X.toast('Text copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastText).then(done, function () { fallbackCopy(lastText); done(); });
      } else { fallbackCopy(lastText); done(); }
    });
    function fallbackCopy(t) {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }

    /* ---------------- the mark ---------------- */

    /* nothing to see: the scan already shows the words */
    X.shapeRenderers.ocr = function () {
      const g = document.createElementNS(X.SVGNS, 'g');
      g.setAttribute('class', 'ocr-mk');
      g.style.pointerEvents = 'none';
      return g;
    };
    /* what Find reads on a page, besides the PDF's own text */
    X.ocrText = function (it) {
      return it.shapes.filter(function (s) { return s.t === 'ocr' || (s.t === 'text' && s.ocr); })
        .map(function (s) { return s.t === 'ocr' ? lineText(s.words || []).replace(/\n/g, ' ') : String(s.text || ''); })
        .join(' ');
    };
  });
})();
