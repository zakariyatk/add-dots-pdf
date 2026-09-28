(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const SVGNS = 'http://www.w3.org/2000/svg';

  if (!window.pdfjsLib || !window.PDFLib || !window.ADDPDFEngine) {
    $('errMsg').hidden = false;
    $('errMsg').textContent = 'The PDF libraries did not load. Check the connection and reload this page.';
    return;
  }
  /* The engine (packages/engine) now owns mark geometry, styling and saving.
     The functions below keep their names so every module calling them through
     ADDPDF is unchanged; they hand the work to the engine. */
  const E = window.ADDPDFEngine;
  /* Vendored locally: the worker used to come from a CDN, which quietly broke
     the "nothing leaves this device" promise and the offline story. */
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
  /* One pdf.js worker for every document. Without a port pdf.js starts a new
     worker thread per document, and the app opens documents for merges,
     blank pages and each redacted page, none of which ever went away. */
  try { pdfjsLib.GlobalWorkerOptions.workerPort = new Worker('js/vendor/pdf.worker.min.js'); }
  catch (e) { /* no workers here: pdf.js falls back to its own */ }

  /* Pages are drawn in a worker of their own (js/render-worker.js) and come
     back as finished bitmaps, so a page that takes seconds to draw never
     freezes the app. The worker opens its own copy of each document the first
     time one of its pages is drawn. Where it cannot run (no OffscreenCanvas,
     a page it fails on), pages are drawn here as before.

     A file being opened is sent to it as soon as it is read (open()), so it
     parses alongside the main thread's copy and page 1 does not wait for it.

     render() returns what pdf.js's page.render() does, { promise, cancel },
     so every caller that waits on or cancels a page's drawing is unchanged.
     The promise gives an ImageBitmap; it rejects with a
     RenderingCancelledException when cancelled and a RenderWorkerError when
     the worker could not draw the page. */
  const RW = (function () {
    let worker = null, rid = 0, nextKey = 0;
    const waiting = new Map();      /* rid -> { res, rej, key } */
    const keys = new WeakMap();     /* a source's bytes -> its document's key in the worker */
    const failed = new Set();       /* keys the worker could not open */
    const api = { state: 'off', ready: Promise.resolve(false) };
    function err(name, message) { const e = new Error(message); e.name = name; return e; }
    function stop() {
      api.state = 'off';
      if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
      waiting.forEach(function (w) { w.rej(err('RenderWorkerError', 'render worker stopped')); });
      waiting.clear();
    }
    try {
      if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
        worker = new Worker('js/render-worker.js');
        api.state = 'wait';
        api.ready = new Promise(function (res) {
          /* a worker that has not answered in a few seconds is not coming */
          const timer = setTimeout(function () { stop(); res(false); }, 4000);
          worker.onmessage = function (e) {
            const m = e.data;
            if (m.op === 'hello') {
              clearTimeout(timer);
              if (m.ok) api.state = 'on'; else stop();
              res(api.state === 'on');
              return;
            }
            const w = waiting.get(m.rid);
            if (!w) { if (m.bitmap) m.bitmap.close(); return; }
            waiting.delete(m.rid);
            if (m.bitmap) { if (w.task) w.task.engine = m.engine; w.res(m.bitmap); }
            else if (m.cancelled) w.rej(err('RenderingCancelledException', 'cancelled'));
            else {
              if (/^open failed/.test(m.error || '')) failed.add(w.key);
              w.rej(err('RenderWorkerError', m.error || 'render failed'));
            }
          };
          worker.onerror = function (e) { e.preventDefault(); clearTimeout(timer); stop(); res(false); };
          worker.postMessage({ op: 'hello' });
        });
      }
    } catch (e) { stop(); }

    /* opens (or, with a password now known, reopens) these bytes in the
       worker; given the file they were read from, the worker reads that
       itself rather than this thread copying them across */
    api.open = function (bytes, password, file) {
      if (api.state !== 'on' || !bytes) return;
      let key = keys.get(bytes);
      if (key == null) { key = ++nextKey; keys.set(bytes, key); }
      failed.delete(key);
      if (file) {
        worker.postMessage({ op: 'open', key: key, file: file, password: password || null });
        return;
      }
      const copy = bytes.slice(0);
      worker.postMessage({ op: 'open', key: key, bytes: copy, password: password || null }, [copy.buffer]);
    };
    function keyFor(src) {
      if (keys.get(src.bytes) == null) api.open(src.bytes, src.password);
      return keys.get(src.bytes);
    }
    /* can the worker draw this page? Not while it is still starting: a file
       opened the moment the app loads is drawn here rather than kept waiting */
    api.usable = function (it) {
      if (api.state !== 'on' || !it.src.bytes || !it.src.doc) return false;
      const key = keys.get(it.src.bytes);
      return key == null || !failed.has(key);
    };
    /* the page at viewport v into a w x h bitmap, v shifted/scaled by
       transform; drop frees what the worker holds for the page once drawn;
       intent is pdf.js's ('print' for file bytes rather than screen pixels);
       fast: a part of a page, which the worker may draw with PDFium (the
       task's engine says which drew it) */
    api.render = function (it, v, w, h, transform, drop, intent, fast) {
      const key = keyFor(it.src), id = ++rid;
      const promise = new Promise(function (res, rej) {
        waiting.set(id, { res: res, rej: rej, key: key });
      });
      worker.postMessage({
        op: 'render', rid: id, key: key, num: it.num,
        scale: v.scale, rotation: v.rotation, w: w, h: h, transform: transform || null, drop: !!drop,
        intent: intent || null, fast: !!fast
      });
      const task = {
        engine: null,
        promise: promise,
        cancel: function () {
          const wt = waiting.get(id);
          if (!wt) return;
          waiting.delete(id);
          if (worker) worker.postMessage({ op: 'cancel', rid: id });
          wt.rej(err('RenderingCancelledException', 'cancelled'));
        }
      };
      waiting.get(id).task = task;
      return task;
    };
    /* what the worker holds for one page, or for a whole document */
    api.release = function (it) {
      const key = it.src.bytes ? keys.get(it.src.bytes) : null;
      if (key != null && worker) worker.postMessage({ op: 'release', key: key, num: it.num });
    };
    api.close = function (bytes) {
      const key = bytes ? keys.get(bytes) : null;
      if (key == null) return;
      keys.delete(bytes);
      failed.delete(key);
      if (worker) worker.postMessage({ op: 'close', key: key });
    };
    return api;
  })();

  const stage = $('stage'), rail = $('rail');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  /* what one page canvas is allowed to cost: a side a mobile GPU will still
     take, and an area that stays cheap to paint every frame */
  /* Phone GPUs commonly refuse a canvas past 4096 on a side, and a big one costs
     a fortune to paint every frame. Desktops take more, so they get a sharper
     picture when zoomed right in. */
  const COARSE = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const MAX_CANVAS_SIDE = COARSE ? 4096 : 8192;
  const MAX_CANVAS_PX = COARSE ? 5.5e6 : 22e6;
  const THEMES = ['paper', 'sepia', 'dark'];
  const THEME_LABEL = { paper: 'Paper', sepia: 'Sepia', dark: 'Night' };
  /* the quick row: ten you reach for most. The full palette (theme colours
     with their shades, standard colours, recent and custom) opens from it. */
  const COLORS = ['#000000', '#FFFFFF', '#E2483D', '#F28C28', '#F2C14E',
                  '#22A06B', '#1BA1A1', '#3B82F6', '#1E3A8A', '#8B5CF6'];
  const STD_COLORS = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050',
                      '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
  const WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6];
  /* mark styling: dash patterns are multiples of the stroke width, so a thick
     dashed line keeps the same rhythm as a thin one */
  const CAP_CSS = ['butt', 'round', 'square'];
  const JOIN_CSS = ['miter', 'round', 'bevel'];
  const STYLE_NAME = ['Solid', 'Dashed', 'Dotted'];
  function shOp(s) { return E.shOp(s); }
  function shCap(s) { return E.shCap(s); }
  function shJoin(s) { return E.shJoin(s); }
  function dashOf(s, sw) { return E.dashOf(s, sw); }

  const S = {
    sources: [], items: [],
    scale: 1, fit: 'width', theme: 'paper', current: 1,
    baseName: 'document', metaBase: '', baseCount: 0,
    undo: [], hits: [], hitIndex: -1, query: '',
    textCache: new Map(), jumping: false,
    locs: {},            // photo-pin locations by id: {id, n, ref, desc, boq, note, photos}
    tool: 'select', color: '#E2483D', width: 0.5,   /* 0.5pt: a fine drawing line, not a marker stroke */
    font: 'helv', bold: false, ital: false, underline: false, strike: false, size: 11,
    align: 'left', bg: null, bgOp: 1,
    sel: null,           // {it, i} selected mark
    editing: null        // {it, item, i} open text editor
  };

  /* ---------------- helpers ---------------- */
  let toastTimer;
  let exBusy = false;          /* a split is running — keep its popover open */
  function toast(html) {
    const t = $('toast');
    t.innerHTML = html; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function bytesLabel(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  const ICON = {
    rotL: '<polyline points="3 4 3 10 9 10"/><path d="M3.5 14a8.5 8.5 0 1 0 2.1-7.4L3 9"/>',
    rotR: '<polyline points="21 4 21 10 15 10"/><path d="M20.5 14a8.5 8.5 0 1 1-2.1-7.4L21 9"/>',
    del: '<polyline points="4 7 20 7"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    crop: '<path d="M7 2v15h15"/><path d="M2 7h15v15"/>',
    up: '<polyline points="6 14 12 8 18 14"/>',
    down: '<polyline points="6 10 12 16 18 10"/>'
  };
  /* ---------------- extension bridge ----------------
     Feature modules (annotate, organize, forms, document ops) load after this
     file and plug in through EXT rather than growing core.js without end.
     Marks they invent are ordinary entries in it.shapes, so undo, save, the
     JPG export and the thumbnails all keep working with no extra wiring. */
  const EXT = window.ADDPDF || (window.ADDPDF = {
    shapeRenderers: {}, shapePainters: {}, fontNeeds: {}, handleKind: {},
    markPop: {},                 /* mark type -> {el, sync}: extra controls on the properties popover */
    prepare: [], finish: [],
    tools: {}, hints: {}, toolBtn: {}, listeners: {}, fired: {},
    /* 'ready' is sticky: core finishes booting before the feature modules are
       even parsed, so a listener that arrives late still has to run. */
    on: function (ev, fn) {
      (this.listeners[ev] || (this.listeners[ev] = [])).push(fn);
      if (ev === 'ready' && this.fired.ready) {
        try { fn(); } catch (e) { console.error('[ADDPDF ready]', e); }
      }
    },
    emit: function (ev, arg) {
      if (ev === 'ready') this.fired.ready = true;
      (this.listeners[ev] || []).forEach(function (fn) {
        try { fn(arg); } catch (e) { console.error('[ADDPDF ' + ev + ']', e); }
      });
    }
  });

  const FONTS = {
    helv:   [PDFLib.StandardFonts.Helvetica, PDFLib.StandardFonts.HelveticaBold,
             PDFLib.StandardFonts.HelveticaOblique, PDFLib.StandardFonts.HelveticaBoldOblique],
    times:  [PDFLib.StandardFonts.TimesRoman, PDFLib.StandardFonts.TimesRomanBold,
             PDFLib.StandardFonts.TimesRomanItalic, PDFLib.StandardFonts.TimesRomanBoldItalic],
    cour:   [PDFLib.StandardFonts.Courier, PDFLib.StandardFonts.CourierBold,
             PDFLib.StandardFonts.CourierOblique, PDFLib.StandardFonts.CourierBoldOblique]
  };
  const CSS_FONT = {
    helv: 'Helvetica, Arial, sans-serif',
    times: '"Times New Roman", Times, serif',
    cour: '"Courier New", Courier, monospace'
  };
  function fontIdx(b, i) { return E.fontIdx(b, i); }

  /* standard-font text widths; null for the moment it takes to embed the fonts */
  let measure = null;
  E.createTextMeasurer().then(function (m) { measure = m; }, function () { measure = null; });

  function textWidth(item, line) {
    return measure ? measure(item, line) : null;
  }
  const WINANSI_OK = /^[\u0000-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178\n]*$/;

  function hexRgb(h) { return E.hexRgb(h); }
  function arrowHead(ax, ay, bx, by, w) { return E.arrowHead(ax, ay, bx, by, w); }

  /* ---------------- opening ---------------- */
  let srcId = 0;
  function showError(m) {
    if (!homeShown()) showHome();
    $('errMsg').hidden = false; $('errMsg').textContent = m;
  }
  function isPdf(f) { return f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')); }
  async function readBytes(f) { return new Uint8Array(await f.arrayBuffer()); }

  let lastPassword = null;
  async function loadWithPassword(bytes) {
    lastPassword = null;
    const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    task.onPassword = function (cb, reason) {
      $('pwRow').classList.add('show');
      if (reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) showError('That password did not work. Try again.');
      /* the one that works is kept: the render worker opens the file too */
      const go = function () { if ($('pwIn').value) cb(lastPassword = $('pwIn').value); };
      $('pwBtn').onclick = go;
      $('pwIn').onkeydown = function (e) { if (e.key === 'Enter') go(); };
      $('pwIn').focus();
    };
    return task.promise;
  }

  async function openFile(file) {
    if (!isPdf(file)) { showError('That is not a PDF. Choose a file ending in .pdf.'); return false; }
    $('errMsg').hidden = true;
    let bytes, doc;
    try { bytes = await readBytes(file); }
    catch (e) { showError('The file could not be read from disk. Try again.'); return false; }
    RW.open(bytes, null, file);
    try { doc = await loadWithPassword(bytes); }
    catch (e) {
      RW.close(bytes);
      showError('This file could not be opened. It may be damaged or not a real PDF.'); return false;
    }
    if (lastPassword) RW.open(bytes, lastPassword, file);

    hardReset();
    if (S.tool !== 'select') setTool('select');
    const src = { id: ++srcId, name: file.name, bytes: bytes, doc: doc };
    if (lastPassword) src.password = lastPassword;
    S.sources.push(src);
    for (let i = 1; i <= doc.numPages; i++) S.items.push(newItem(src, i, 0, false));

    S.baseName = (file.name || 'document').replace(/\.pdf$/i, '');
    S.baseCount = doc.numPages;
    S.metaBase = '<b>' + esc(file.name) + '</b> · ' + bytesLabel(file.size);
    $('meta').innerHTML = S.metaBase;
    $('saveName').value = S.baseName + '-edited.pdf';

    $('openPanel').hidden = true;
    $('pwRow').classList.remove('show');
    /* set the rail flag only — syncAll below builds the thumbnails and lays out */
    if (!isMobile()) { rail.hidden = false; $('btnRail').classList.add('on'); }
    syncScrim();
    await syncAll();
    goTo(1);
    stage.focus();
    addRecent(file, doc.numPages);
    return true;
  }

  function newItem(src, num, rot, added) {
    return {
      src: src, num: num, rot: rot || 0, added: !!added,
      crop: null, shapes: [],
      page: null, vp: null, off: { left: 0, top: 0 },
      box: null, wrap: null, inner: null, canvas: null, tl: null, anno: null, capture: null,
      thumb: null, thumbCanvas: null, rendered: false, task: null, thumbDone: false,
      trPane: null, trBody: null, trLang: null, trEls: null,
      trBlocks: null, trOut: null, trState: 'idle', trKey: '', trJob: null
    };
  }

  function hardReset(keepDoc) {
    EXT.emit('reset');
    S.items.forEach(function (it) { if (it.task) { try { it.task.cancel(); } catch (e) {} } });
    DETAILED.forEach(dropDetail);
    LIVE.clear(); TLIVE.clear(); MOUNTED.clear(); TMOUNTED.clear();
    RQ.gen++; RQ.busy = 0; RQ.want.clear();
    TQ.gen++; TQ.busy = false; TQ.want.clear(); TQ.task = null; TQ.it = null; TQ.slow = false;
    RQ.idle.splice(0).forEach(function (res) { res(); });
    resizeQ.clear();
    jumpHold = null;
    loadEpoch++;
    TR.epoch++; TR.stop = false;
    /* the documents being closed: free them in the worker too */
    S.sources.forEach(function (src) {
      if (src.doc && src.doc !== keepDoc) { RW.close(src.bytes); try { src.doc.destroy(); } catch (e) {} }
    });
    S.sources = []; S.items = []; S.undo = []; S.textCache = new Map();
    S.hits = []; S.hitIndex = -1; S.query = ''; S.current = 1; S.fit = 'width'; S.sel = null;
    S.locs = {}; pinSel = null; closeLb();
    stage.innerHTML = ''; $('railPages').innerHTML = '';
    /* stop a smooth scroll still gliding through the old document (a search
       hit, a jump): left running, it carries on into the new one */
    stage.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    $('hitList').innerHTML = ''; hitsShown = 0; $('hitCount').textContent = ''; $('findIn').value = '';
    setUndoState();
  }

  /* ---------------- undo ---------------- */
  function snapshot() {
    S.undo.push(S.items.map(function (it) {
      return {
        ref: it, num: it.num, rot: it.rot, added: it.added,
        crop: it.crop ? { x: it.crop.x, y: it.crop.y, w: it.crop.w, h: it.crop.h } : null,
        shapes: it.shapes.map(function (s) { return Object.assign({}, s); })
      };
    }));
    if (S.undo.length > 60) S.undo.shift();
    setUndoState();
  }
  function setUndoState() { $('btnUndo').disabled = S.undo.length === 0; }

  async function undo() {
    const snap = S.undo.pop();
    if (!snap) return;
    setUndoState();
    S.sel = null;
    hideMarkPop();
    S.items = snap.map(function (s) {
      const it = s.ref;
      const heavy = it.rot !== s.rot;
      it.num = s.num; it.rot = s.rot; it.added = s.added;
      it.crop = s.crop; it.shapes = s.shapes;
      if (heavy) { it.rendered = false; it.thumbDone = false; if (it.tl) it.tl.innerHTML = ''; }
      it.thumbDone = false;
      return it;
    });
    await syncAll();
    toast('Undone');
  }

  /* ---------------- elements ---------------- */
  function ensureEls(it) {
    if (it.box) return;
    const box = document.createElement('div');
    box.className = 'pagebox' + (it.added ? ' added' : '');
    box._it = it;

    /* Everything in the page lives in `content`, a display:contents wrapper,
       so it lays out exactly as if it sat in the box. A page far from the
       screen takes its content out of the document (mountPage below): the
       elements stay in memory and every module keeps its references, but the
       browser has only one sized box per page to lay out. */
    const content = document.createElement('div'); content.className = 'pagebody';
    const tick = document.createElement('div'); tick.className = 'tick';
    const cflag = document.createElement('div'); cflag.className = 'cropflag'; cflag.textContent = 'CROP';
    content.appendChild(tick); content.appendChild(cflag);

    const wrap = document.createElement('div'); wrap.className = 'page';
    const inner = document.createElement('div'); inner.className = 'inner';
    const canvas = document.createElement('canvas');
    const tl = document.createElement('div'); tl.className = 'textLayer';
    const anno = document.createElementNS(SVGNS, 'svg'); anno.setAttribute('class', 'anno');
    inner.appendChild(canvas); inner.appendChild(tl); inner.appendChild(anno);
    wrap.appendChild(inner);

    const cap = document.createElement('div'); cap.className = 'capture';
    wrap.appendChild(cap);
    content.appendChild(wrap);

    it.box = box; it.wrap = wrap; it.inner = inner; it.canvas = canvas;
    it.tl = tl; it.anno = anno; it.capture = cap; it.tick = tick;
    it.content = content; it.mounted = false;
    /* The hover tools and the translation pane are made when first needed:
       with thousands of pages they were most of the document's elements. */
    if (TR.on) ensurePane(it);
    box.addEventListener('pointerenter', function () { ensurePageTools(it); });
    box.addEventListener('focusin', function () { ensurePageTools(it); });

    bindDraw(it);

    /* thumbnail: like the page, its content leaves the rail while far from
       view (mountThumb), and the .thumb holds its height meanwhile */
    const th = document.createElement('div'); th.className = 'thumb';
    const tbody = document.createElement('div'); tbody.className = 'thumbbody';
    const hit = document.createElement('button'); hit.className = 'hitbox';
    const shell = document.createElement('div'); shell.className = 'shell';
    const tc = document.createElement('canvas'); shell.appendChild(tc);
    const no = document.createElement('div'); no.className = 'no';
    hit.appendChild(shell); hit.appendChild(no);
    hit.addEventListener('click', function () {
      goTo(S.items.indexOf(it) + 1);
      if (isMobile()) setRail(false);
    });
    tbody.appendChild(hit);
    th.addEventListener('pointerenter', function () { ensureThumbTools(it); });
    th.addEventListener('focusin', function () { ensureThumbTools(it); });

    if (it.added) {
      const badge = document.createElement('div'); badge.className = 'badge'; badge.textContent = 'NEW';
      tbody.appendChild(badge);
    }
    it.thumb = th; it.thumbCanvas = tc; it.thumbShell = shell; it.thumbNo = no;
    it.thumbContent = tbody; it.thumbMounted = false;
  }

  /* facing panel that holds the translation of this page */
  function ensurePane(it) {
    if (it.trPane || !it.box) return;
    const pane = document.createElement('div'); pane.className = 'trpane';
    const phead = document.createElement('div'); phead.className = 'trhead';
    const plang = document.createElement('span'); plang.className = 'lang';
    const pgrow = document.createElement('span'); pgrow.className = 'grow';
    const pcopy = document.createElement('button'); pcopy.type = 'button'; pcopy.textContent = 'Copy';
    const predo = document.createElement('button'); predo.type = 'button'; predo.textContent = 'Retry';
    phead.appendChild(plang); phead.appendChild(pgrow); phead.appendChild(pcopy); phead.appendChild(predo);
    const pbody = document.createElement('div'); pbody.className = 'trbody';
    pane.appendChild(phead); pane.appendChild(pbody);
    pcopy.addEventListener('click', function () { copyTranslation(it); });
    predo.addEventListener('click', function () { translatePage(it, true); });
    it.wrap.after(pane);
    it.trPane = pane; it.trBody = pbody; it.trLang = plang;
  }

  /* rotate, crop, insert and remove, over the page's corner */
  function ensurePageTools(it) {
    if (it.ptools || !it.box) return;
    const tools = document.createElement('div'); tools.className = 'ptools';
    tools.innerHTML =
      '<button data-a="rotl" title="Rotate left">' + icon(ICON.rotL) + '</button>' +
      '<button data-a="rotr" title="Rotate right">' + icon(ICON.rotR) + '</button>' +
      '<button data-a="crop" title="Crop this page">' + icon(ICON.crop) + '</button>' +
      '<button data-a="add" title="Insert pages after this one">' + icon(ICON.plus) + '</button>' +
      '<button data-a="del" class="del" title="Remove this page">' + icon(ICON.del) + '</button>';
    tools.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      const i = S.items.indexOf(it); if (i < 0) return;
      setCurrent(i + 1);
      if (b.dataset.a === 'rotl') rotateItem(i, -90);
      if (b.dataset.a === 'rotr') rotateItem(i, 90);
      if (b.dataset.a === 'del') removeItem(i);
      if (b.dataset.a === 'crop') setTool('crop');
      if (b.dataset.a === 'add') openPop('addPop', $('btnAdd'));
    });
    it.content.appendChild(tools);
    it.ptools = tools;

  }

  /* move and remove, and the tick for extracting, over the thumbnail */
  function ensureThumbTools(it) {
    if (it.thumbTools || !it.thumb) return;
    const th = it.thumbContent;
    const tt = document.createElement('div'); tt.className = 'tools';
    tt.innerHTML =
      '<button data-a="up" title="Move up">' + icon(ICON.up) + '</button>' +
      '<button data-a="down" title="Move down">' + icon(ICON.down) + '</button>' +
      '<button data-a="del" class="del" title="Remove page">' + icon(ICON.del) + '</button>';
    tt.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      const i = S.items.indexOf(it); if (i < 0) return;
      if (b.dataset.a === 'up') moveItem(i, -1);
      if (b.dataset.a === 'down') moveItem(i, 1);
      if (b.dataset.a === 'del') removeItem(i);
    });
    th.appendChild(tt);
    it.thumbTools = tt;

    const tick2 = document.createElement('button');
    tick2.className = 'tickbox'; tick2.type = 'button';
    tick2.title = 'Tick this page for extracting';
    tick2.setAttribute('aria-pressed', 'false');
    tick2.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="5 13 10 18 19 6"/></svg>';
    tick2.addEventListener('click', function (e) {
      e.stopPropagation();
      it.pick = !it.pick;
      syncPicks();
    });
    th.appendChild(tick2);
    it.tickbox = tick2;
    tick2.classList.toggle('on', !!it.pick);
    tick2.setAttribute('aria-pressed', it.pick ? 'true' : 'false');
  }

  async function ensurePage(it) {
    if (!it.page) {
      it.page = await it.src.doc.getPage(it.num);
      /* laid out at a guessed size until now: put in the real one */
      if (it.estimated) queueResize(it);
    }
    return it.page;
  }

  /* Every page loaded, for the few operations that measure them all (crop
     every page, the document's page sizes). A few requests at a time, so the
     pdf.js worker can still answer the page being drawn. */
  async function ensureAllPages() {
    const todo = S.items.filter(function (it) { return !it.page; });
    for (let i = 0; i < todo.length; i += 16) {
      await Promise.all(todo.slice(i, i + 16).map(function (it) { return ensurePage(it).catch(function () {}); }));
    }
  }

  /* Opening does not wait for every page: page 1 is loaded, the rest are laid
     out at its size and drawn as they come near, and meanwhile the remaining
     pages load in the background, whenever nothing is being drawn. */
  let loadEpoch = 0;
  async function loadRestPages() {
    const epoch = ++loadEpoch;
    for (let i = 0; i < S.items.length; i++) {
      const it = S.items[i];
      if (!it || it.page) continue;
      await renderIdle();
      if (epoch !== loadEpoch) return;
      try { await ensurePage(it); } catch (e) {}
      if (epoch !== loadEpoch) return;
    }
    indexText(epoch);
  }

  /* Then the text of every page is read, in the background, a few pages at a
     time and only while no page is being drawn: a search looks through text
     already here instead of reading every page first (seven seconds for
     2,000 pages). */
  async function indexText(epoch) {
    for (let i = 0; i < S.items.length; i += 8) {
      await renderIdle();
      if (epoch !== loadEpoch) return;
      await Promise.all(S.items.slice(i, i + 8).map(textOf));
      if (epoch !== loadEpoch) return;
    }
  }

  /* Pages that just learned their real size are resized together once a
     frame, holding still whatever is under the middle of the screen. */
  const resizeQ = new Set();
  let resizeRaf = 0;
  /* The page a jump went to, held in view while the pages above it take their
     real size (flushResizes); let go by the reader or a zoom (goTo, zoomTo). */
  let jumpHold = null;
  function queueResize(it) {
    resizeQ.add(it);
    if (!resizeRaf) resizeRaf = requestAnimationFrame(flushResizes);
  }
  /* notes where the page under the middle of the screen starts; the function
     it returns scrolls by however far that page has since moved */
  function holdMiddle() {
    const at = S.items[Math.min(S.items.length - 1, firstBoxAt(stage.scrollTop + stage.clientHeight / 2))];
    if (!at || !at.box) return function () {};
    const before = at.box.offsetTop, top = stage.scrollTop;
    return function () {
      const moved = at.box.offsetTop - before;
      if (moved) stage.scrollTop = top + moved;
    };
  }
  function flushResizes() {
    resizeRaf = 0;
    const list = Array.from(resizeQ);
    resizeQ.clear();
    if (!list.length || !S.items.length) return;
    /* the page under the middle of the screen stays where it is: note where it
       starts, resize, then scroll by however far it moved. After a jump, the
       page jumped to is what stays: pages above it were laid out at a guessed
       size, and holding the middle instead left the reader pages short. */
    const target = jumpHold && jumpHold.box && jumpHold.box.isConnected ? jumpHold : null;
    const hold = target ? function () { stage.scrollTop = target.box.offsetTop - 14; } : holdMiddle();
    list.forEach(function (it) {
      if (!it.estimated || !it.page || !it.inner || !it.box || !it.box.isConnected) return;
      it.estimated = false;
      sizeItem(it, false);
    });
    hold();
    renderVisible();
  }

  async function syncAll() {
    S.items.forEach(ensureEls);
    stage.replaceChildren.apply(stage, S.items.map(function (it) { return it.box; }));
    $('railPages').replaceChildren.apply($('railPages'), S.items.map(function (it) { return it.thumb; }));
    S.items.forEach(function (it, i) {
      it.tick.textContent = String(i + 1).padStart(2, '0');
      it.thumbNo.textContent = String(i + 1);
      it.box.classList.toggle('cropped', !!it.crop);
    });
    $('pageTotal').textContent = '/ ' + S.items.length;
    document.body.classList.toggle('no-doc', !S.items.length);
    updateMeta(); observeAll(); syncPicks(); renderPins();
    EXT.emit('pages');
    await relayout();
    setCurrent(Math.min(S.current, S.items.length) || 1);
    loadRestPages();
  }

  function updateMeta() {
    const n = S.items.length;
    const changed = n !== S.baseCount || S.items.some(function (it) {
      return it.rot || it.added || it.crop || it.shapes.length;
    });
    const m = $('meta');
    m.innerHTML = S.metaBase + ' · ' + n + 'p' + (changed ? ' <span class="dirty">· edited</span>' : '');
    m.title = m.textContent;   /* the bar truncates it on narrow screens */
  }

  /* ---------------- layout ---------------- */
  function cropRectIn(vp, crop) {
    if (!crop) return null;
    const pts = [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]]
      .map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); });
    const xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    const l = Math.min.apply(null, xs), t = Math.min.apply(null, ys);
    return { left: l, top: t, width: Math.max.apply(null, xs) - l, height: Math.max.apply(null, ys) - t };
  }

  function computeFit() {
    const it = S.items[0];
    if (!it || !it.page) return;
    let avail = stage.clientWidth - 34;
    const availH = stage.clientHeight - 46;
    /* side by side, the page gets half of the stage less the gutter */
    if (trSideBySide()) avail = Math.max(120, (avail - TR.gap) / 2);
    const v = it.page.getViewport({ scale: 1, rotation: it.page.rotate + it.rot });
    const c = cropRectIn(v, it.crop);
    const w = c ? c.width : v.width, h = c ? c.height : v.height;
    if (S.fit === 'width') S.scale = Math.max(.15, avail / w);
    else if (S.fit === 'page') S.scale = Math.max(.15, Math.min(avail / w, availH / h));
  }

  /* Sizing is cheap: the canvas bitmap is stretched by CSS (.inner canvas is
     width:100%), so the page can change size on the spot and only needs a real
     pdf.js repaint once the gesture stops. That is what keeps zooming smooth.
     Mid-gesture the sizes come from each page's size at 100%, kept once, so a
     frame is plain arithmetic rather than a pdf.js viewport per page. */
  function baseSize(it) {
    const rot = it.page.rotate + it.rot;
    const ck = it.crop ? [it.crop.x, it.crop.y, it.crop.w, it.crop.h].join() : '';
    if (!it.base || it.base.rot !== rot || it.base.ck !== ck || it.base.page !== it.page) {
      const v1 = it.page.getViewport({ scale: 1, rotation: rot });
      it.base = { rot: rot, ck: ck, page: it.page, w: v1.width, h: v1.height, c: cropRectIn(v1, it.crop) };
    }
    return it.base;
  }
  function estSize(it) {
    const p0 = S.items[0] && S.items[0].page;
    const v = p0 ? p0.view : [0, 0, 612, 792];
    let w = v[2] - v[0], h = v[3] - v[1];
    if ((((p0 ? p0.rotate : 0) + it.rot) % 180 + 180) % 180 === 90) { const t = w; w = h; h = t; }
    return { w: w, h: h };
  }
  /* a page not loaded yet takes the guessed size, and the real one on arrival */
  function sizeEstimated(it) {
    const e = estSize(it), s = S.scale;
    const w = Math.floor(e.w * s), h = Math.floor(e.h * s);
    it.estimated = true;
    it.inner.style.width = w + 'px';
    it.inner.style.height = h + 'px';
    it.inner.style.left = '0px';
    it.inner.style.top = '0px';
    if (it.canvas) { it.canvas.style.width = w + 'px'; it.canvas.style.height = h + 'px'; }
    it.anno.setAttribute('width', w);
    it.anno.setAttribute('height', h);
    it.off = { left: 0, top: 0 };
    it.wrap.style.width = w + 'px';
    it.wrap.style.height = h + 'px';
    boxToWrap(it);
    sizeThumb(it, e.w, e.h);
  }
  function applySizes(live) {
    if (!live) { S.items.forEach(function (it) { sizeItem(it, false); }); return; }
    /* Mid-gesture only the pages around the screen follow the zoom. Resizing
       all of them made the browser lay out the whole document every frame;
       the rest catch up when the gesture settles (relayout). */
    const top = stage.scrollTop - stage.clientHeight, bot = stage.scrollTop + stage.clientHeight * 2;
    const list = [];
    for (let i = firstBoxAt(top); i < S.items.length; i++) {
      const it = S.items[i];
      if (it.box && it.box.offsetTop > bot) break;
      list.push(it);
    }
    list.forEach(function (it) { sizeItem(it, true); });
  }
  function sizeItem(it, live) {
    const s = S.scale;
    if (!it.inner) return;                      /* not built yet, relayout will size it */
    if (!it.page) { sizeEstimated(it); return; }
    it.estimated = false;
    const b = baseSize(it);
    let w = b.w * s, h = b.h * s;
    let c = b.c ? { left: b.c.left * s, top: b.c.top * s, width: b.c.width * s, height: b.c.height * s } : null;
    if (!live) {
      const v = it.page.getViewport({ scale: s, rotation: it.page.rotate + it.rot });
      it.vp = v; w = v.width; h = v.height;
      c = cropRectIn(v, it.crop);
    }
    it.inner.style.width = Math.floor(w) + 'px';
    it.inner.style.height = Math.floor(h) + 'px';
    /* the old bitmap is stretched to the new size and stays up until the
       sharp one replaces it, so the page never goes blank */
    if (it.canvas) {
      it.canvas.style.width = Math.floor(w) + 'px';
      it.canvas.style.height = Math.floor(h) + 'px';
    }
    it.anno.setAttribute('width', w);
    it.anno.setAttribute('height', h);
    setTextScale(it, s);
    /* Mid-gesture the viewBox is left where it was: the SVG then scales its own
       marks to the new size for free, so no page has to rebuild its overlay. */
    if (!live) it.anno.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    it.off = c ? { left: c.left, top: c.top } : { left: 0, top: 0 };
    it.wrap.style.width = Math.floor(c ? c.width : w) + 'px';
    it.wrap.style.height = Math.floor(c ? c.height : h) + 'px';
    it.inner.style.left = (-it.off.left) + 'px';
    it.inner.style.top = (-it.off.top) + 'px';
    boxToWrap(it);
    if (!live) sizeThumb(it, b.c ? b.c.width : b.w, b.c ? b.c.height : b.h);

    if (it.trPane) {
      it.trPane.style.width = Math.floor(c ? c.width : w) + 'px';
      it.trPane.style.minHeight = trSideBySide() ? Math.floor(c ? c.height : h) + 'px' : '0';
      if (!live && TR.on) paintPane(it);
    }
    if (!live) drawShapes(it);
  }

  async function relayout(opts) {
    if (!S.items.length) return;
    if (S.editing) closeEditor(true);
    /* page 1 sets the fit; the others arrive in the background (loadRestPages) */
    await ensurePage(S.items[0]);
    computeFit();
    $('zoomVal').textContent = Math.round(S.scale * 100) + '%';
    /* after a zoom, the pages away from the screen take their new size now:
       keep the page being read where it is */
    const hold = opts && opts.hold ? holdMiddle() : null;
    applySizes();
    if (hold) hold();
    DETAILED.forEach(dropDetail);
    S.items.forEach(function (it) {
      if (!it.canvas) return;
      if (it.task) { try { it.task.cancel(); } catch (e) {} it.task = null; }
      it.rendered = false;
      /* The picture is kept, stretched, until the repaint lands; the words
         follow the zoom already (--sf, set by sizeItem) */
    });
    renderVisible(); drawVisibleThumbs();
    detailSoon(0);
  }

  /* ---------------- smooth zooming ----------------
     The live part only resizes and keeps the scroll anchored on whatever the
     reader is looking at; the sharp repaint is debounced to the end. */
  let zoomTimer = null, zoomRaf = 0;
  function zoomPreview() {
    applySizes(true);
    $('zoomVal').textContent = Math.round(S.scale * 100) + '%';
  }
  /* Hold on to whatever page is under the fingers and put it back under them
     afterwards. Doing it off the real element beats scroll arithmetic, which
     would drift on the stage padding, the gaps between pages and the centring. */
  let anchorBox = null;            /* held for the length of a pinch, so each frame
                                      measures one element instead of every page */
  function grabAnchor(cx, cy) {
    if (anchorBox && anchorBox.isConnected) {
      const ar = anchorBox.getBoundingClientRect();
      if (ar.width && ar.height) {
        return { box: anchorBox, cx: cx, cy: cy,
                 u: (cx - ar.left) / ar.width, v: (cy - ar.top) / ar.height };
      }
    }
    let best = null, bestGap = Infinity;
    for (let i = 0; i < S.items.length; i++) {
      const box = S.items[i].box;
      if (!box) continue;
      const r = box.getBoundingClientRect();
      const gap = cy < r.top ? r.top - cy : (cy > r.bottom ? cy - r.bottom : 0);
      if (gap < bestGap) { bestGap = gap; best = { box: box, r: r }; }
      if (!gap) break;
    }
    if (!best || !best.r.width || !best.r.height) return null;
    return { box: best.box, cx: cx, cy: cy,
             u: (cx - best.r.left) / best.r.width,
             v: (cy - best.r.top) / best.r.height };
  }
  function putAnchorBack(a) {
    if (!a || !a.box) return;
    const r = a.box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    stage.scrollLeft += (r.left + a.u * r.width) - a.cx;
    stage.scrollTop += (r.top + a.v * r.height) - a.cy;
  }

  const ZOOM_MIN = 0.2, ZOOM_MAX = 6;
  function zoomTo(next, cx, cy) {
    if (!S.items.length) return;
    next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (Math.abs(next - S.scale) < 0.0005) return;
    if (S.editing) closeEditor(true);
    S.fit = null;
    jumpHold = null;
    const r = stage.getBoundingClientRect();
    const anchor = grabAnchor(cx == null ? r.left + r.width / 2 : cx,
                              cy == null ? r.top + r.height / 2 : cy);
    S.scale = next;
    document.body.classList.add('zooming');     /* scroll jumps, never animates */
    zoomPreview();
    putAnchorBack(anchor);
    hideMarkPop();
  }
  function zoomSettle(delay) {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(function () {
      document.body.classList.remove('zooming');
      anchorBox = pinch ? anchorBox : null;
      relayout({ hold: true });
    }, delay == null ? 170 : delay);
  }

  /* A mouse wheel notch, a + or − click and the keys glide to the new zoom
     over a few frames instead of jumping a fifth at once. Further notches
     while it moves add to where it is heading, so a quick spin zooms far and
     still lands softly. The point under the pointer stays put throughout. */
  const glide = { target: 0, x: 0, y: 0, raf: 0, last: 0 };
  function zoomGlide(next, cx, cy) {
    if (!S.items.length) return;
    glide.target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (cx == null) {
      const r = stage.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    }
    glide.x = cx; glide.y = cy;
    clearTimeout(zoomTimer);
    if (glide.raf) return;
    anchorBox = null;
    const a = grabAnchor(cx, cy);
    anchorBox = a ? a.box : null;
    glide.last = performance.now();
    glide.raf = requestAnimationFrame(glideStep);
  }
  function glideTarget() { return glide.raf ? glide.target : S.scale; }
  function glideStep(now) {
    glide.raf = 0;
    const dt = Math.max(1, Math.min(64, now - glide.last));
    glide.last = now;
    /* close the same share of the gap every 1/60 s — quick off the mark, soft
       at the end — and in log space, so zooming in and out feel the same */
    const k = 1 - Math.pow(0.7, dt / 16.7);
    const cur = Math.log(S.scale), goal = Math.log(glide.target);
    let next = Math.exp(cur + (goal - cur) * k);
    if (Math.abs(goal - Math.log(next)) < 0.004) next = glide.target;
    zoomTo(next, glide.x, glide.y);
    if (next !== glide.target) glide.raf = requestAnimationFrame(glideStep);
    else zoomSettle(90);
  }
  function glideStop() {
    if (glide.raf) { cancelAnimationFrame(glide.raf); glide.raf = 0; }
  }

  let io;
  function observeAll() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        const it = en.target._it;
        if (it && it.box === en.target) { renderItem(it); if (TR.on) translatePage(it); }
      });
    }, { root: stage, rootMargin: '700px 0px' });
    S.items.forEach(function (it) { io.observe(it.box); });
  }

  /* How far a page is from the screen, 0 when any of it is on it. */
  function screenGap(it) {
    const top = stage.scrollTop, bot = top + stage.clientHeight;
    const y = it.box.offsetTop, h = it.box.offsetHeight;
    return y + h < top ? top - (y + h) : (y > bot ? y - bot : 0);
  }
  /* The first page whose box reaches down to y, by bisection: the boxes stand
     in reading order, so a scroll frame reads a dozen positions, not one per
     page. */
  function firstBoxAt(y) {
    let lo = 0, hi = S.items.length - 1, ans = S.items.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, box = S.items[mid].box;
      if (box && box.offsetTop + box.offsetHeight >= y) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  /* Pages whose content is in the document (see ensureEls). */
  const MOUNTED = new Set();
  function mountPage(it) {
    if (!it || it.mounted || !it.box) return;
    it.box.style.width = it.box.style.height = '';
    it.box.appendChild(it.content);
    it.mounted = true;
    MOUNTED.add(it);
    /* a text layer built while away could not measure its words */
    if (it.tlFit) fitTextLayer(it);
  }
  /* A page keeps its content while it is being worked on: the one selected,
     one being retyped, one holding the focus, and every page side by side
     with its translation (whose height depends on the text). */
  function canUnmount(it) {
    if (TR.on) return false;
    if (S.sel && S.sel.it === it) return false;
    if (S.editing && S.editing.it === it) return false;
    const a = document.activeElement;
    return !(a && it.content.contains(a));
  }
  function unmountPage(it) {
    if (!it.mounted) return;
    it.box.style.width = it.wrap.style.width;
    it.box.style.height = it.wrap.style.height;
    it.content.remove();
    it.mounted = false;
    MOUNTED.delete(it);
  }
  /* A thumbnail is 176 points wide and as tall as its page's proportions,
     drawn or not, so the rail's layout is right before any is drawn. The
     rest of its height (the border, the page number) is measured once. */
  let thumbChrome = 0;
  function sizeThumb(it, w, h) {
    if (!it.thumbShell || !(w > 0)) return;
    const sh = Math.floor((176 * h) / w);
    if (!it.thumbDone) it.thumbShell.style.height = sh + 'px';
    if (!it.thumbMounted) it.thumb.style.height = (sh + (thumbChrome || 20)) + 'px';
  }
  function mountThumb(it) {
    if (!it.thumb || it.thumbMounted) return;
    it.thumb.style.height = '';
    it.thumb.appendChild(it.thumbContent);
    it.thumbMounted = true;
    TMOUNTED.add(it);
  }
  function unmountThumb(it, height) {
    if (!it.thumbMounted) return;
    it.thumb.style.height = height + 'px';
    it.thumbContent.remove();
    it.thumbMounted = false;
    TMOUNTED.delete(it);
  }
  const TMOUNTED = new Set();

  /* an unmounted box holds the page's size itself */
  function boxToWrap(it) {
    if (it.mounted || !it.box) return;
    it.box.style.width = it.wrap.style.width;
    it.box.style.height = it.wrap.style.height;
  }

  /* Pages holding a bitmap. Only these can be released, so a scroll frame
     looks at a handful of pages rather than every page in the document. */
  const LIVE = new Set();
  function releaseBitmap(it) {
    if (it.task) { try { it.task.cancel(); } catch (e) {} it.task = null; }
    it.rendered = false;
    if (it.canvas) it.canvas.width = it.canvas.height = 1;
    if (it.tl) it.tl.innerHTML = '';
    dropDetail(it);
    LIVE.delete(it);
    /* and what pdf.js holds for it: the drawing instructions and decoded
       images. pdf.js declines while the page is still being drawn (a
       thumbnail, say), which is fine: it is released next time. */
    if (it.page) { try { it.page.cleanup(); } catch (e) {} }
    RW.release(it);
  }

  /* which way the reader is going: pages ahead are drawn from further off */
  let lastTop = 0, heading = 1;
  function renderVisible() {
    if (!S.items.length) return;
    const st = stage.scrollTop;
    if (st !== lastTop) { heading = st > lastTop ? 1 : -1; lastTop = st; }
    const ahead = 1400, behind = 300;
    const nearTop = heading > 0 ? behind : ahead, nearBot = heading > 0 ? ahead : behind;
    /* A page long scrolled past gives its bitmap back, so a long document
       costs the memory of a few screens, not of every page ever looked at. */
    const keep = Math.max(3000, stage.clientHeight * 4);
    const top = stage.scrollTop, bot = top + stage.clientHeight;
    /* Every position is read before anything is written: a write between two
       reads makes the browser lay the whole document out again, and with
       thousands of pages that is what stalled scrolling. */
    const want = [];
    for (let i = firstBoxAt(top - nearTop); i < S.items.length; i++) {
      const it = S.items[i];
      if (!it.box) continue;
      if (it.box.offsetTop > bot + nearBot) break;
      want.push(it);
    }
    const drop = [], away = [];
    LIVE.forEach(function (it) {
      if (!it.box || !it.box.isConnected || screenGap(it) > keep) drop.push(it);
    });
    MOUNTED.forEach(function (it) {
      if (!it.box || !it.box.isConnected) MOUNTED.delete(it);
      else if (screenGap(it) > keep && canUnmount(it)) away.push(it);
    });
    drop.forEach(releaseBitmap);
    away.forEach(unmountPage);
    want.forEach(function (it) {
      renderItem(it);
      if (TR.on) translatePage(it);
    });
  }

  /* ---- the render queue ----
     Pages are painted nearest to the screen first and only two at a time, so
     the page being read is sharp soonest, and a quick scroll does not leave a
     backlog of pages it has already gone past. */
  /* gen: a document closed mid-draw can leave its promises unsettled, so each
     document gets a generation and the old one's work no longer counts */
  const RQ = { want: new Set(), busy: 0, idle: [], gen: 0 };
  /* A page drawn into a 2d canvas at viewport vp, for an export that wants
     its pixels (JPG, redaction, compression): in the render worker when it
     can, so a heavy page does not freeze the app, and here otherwise. A very
     large one is drawn here too, since the worker's copy would briefly double
     it. opts: transform, intent. */
  const WORKER_EXPORT_PX = 36e6;
  async function drawPageInto(it, vp, ctx, opts) {
    opts = opts || {};
    await ensurePage(it);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (RW.usable(it) && w * h <= WORKER_EXPORT_PX) {
      try {
        const bitmap = await RW.render(it, vp, w, h, opts.transform, !it.rendered, opts.intent).promise;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return;
      } catch (e) {
        if (!e || e.name !== 'RenderWorkerError') throw e;
      }
    }
    await it.page.render({
      canvasContext: ctx, viewport: vp, intent: opts.intent || 'display',
      transform: opts.transform || null, background: opts.background
    }).promise;
  }

  /* resolves once no page is being drawn or waiting to be */
  function renderIdle() {
    if (!RQ.busy && !RQ.want.size) return Promise.resolve();
    return new Promise(function (res) { RQ.idle.push(res); });
  }
  function renderItem(it) {
    if (!it) return;
    mountPage(it);
    ensurePageTools(it);
    if (it.rendered || it.task) return;
    RQ.want.add(it);
    pumpRender();
  }
  function pumpRender() {
    while (RQ.busy < 2 && RQ.want.size) {
      let best = null, bestGap = Infinity;
      RQ.want.forEach(function (it) {
        if (!it.box || !it.box.isConnected || it.rendered || it.task) {
          RQ.want.delete(it); return;
        }
        const gap = screenGap(it);
        if (gap > 1400) { RQ.want.delete(it); return; }   /* gone by — scrolling back asks again */
        if (gap < bestGap) { bestGap = gap; best = it; }
      });
      if (!best) break;
      RQ.want.delete(best);
      RQ.busy++;
      const gen = RQ.gen;
      paintItem(best).catch(function () {}).then(function () {
        if (gen !== RQ.gen) return;
        RQ.busy--;
        pumpRender();
      });
    }
    if (!RQ.busy && !RQ.want.size) {
      if (RQ.idle.length) RQ.idle.splice(0).forEach(function (res) { res(); });
      pumpThumbs();
    }
  }

  function sameView(a, b) {
    return a === b || (!!a && !!b && a.scale === b.scale && a.rotation === b.rotation &&
      a.width === b.width && a.height === b.height);
  }
  /* how much of full resolution one page bitmap may have at viewport v */
  function bitmapCap(v) {
    return Math.min(1,
      MAX_CANVAS_SIDE / Math.max(v.width * DPR, v.height * DPR),
      Math.sqrt(MAX_CANVAS_PX / Math.max(1, v.width * DPR * v.height * DPR)));
  }
  async function paintItem(it) {
    await ensurePage(it);
    if (it.rendered || it.task) return;
    const v = it.vp || it.page.getViewport({ scale: S.scale, rotation: it.page.rotate + it.rot });
    /* Zoomed right in, v.width * DPR runs past what a GPU will hold as a texture
       (phones commonly stop at 4096) and costs a fortune to composite. Cap the
       bitmap and let CSS stretch the last bit — far past screen resolution
       anyway, and it keeps panning and pinching on a phone at full speed. */
    let k = bitmapCap(v);
    /* past the cap, the detail layer draws what is on screen sharp: the page's
       own bitmap only fills the edges for a moment while scrolling, so it is
       kept small. A big one cost 90 MB and froze scrolling for 0.4 s while
       the browser stretched it over a page 14,000 pixels wide. */
    if (k < 1 && RW.usable(it)) {
      k = Math.min(k, Math.sqrt(BASE_PX_UNDER_DETAIL / Math.max(1, v.width * DPR * v.height * DPR)));
    }
    const rs = DPR * k;
    /* Painted off screen and swapped in whole: the stretched old picture stays
       up until then, so zooming never flashes white. */
    const fw = Math.max(1, Math.floor(v.width * rs)), fh = Math.max(1, Math.floor(v.height * rs));
    /* Zooming on past the cap would draw the same bitmap again: the whole
       page at the most pixels allowed. Keep it, stretched to the new size;
       the detail layer makes the part on screen sharp. */
    if (k < 1 && it.canvas && it.canvas.width === fw && it.canvas.height === fh &&
        it.baseRot === v.rotation && it.canvas.isConnected) {
      it.canvas.style.width = Math.floor(v.width) + 'px';
      it.canvas.style.height = Math.floor(v.height) + 'px';
      it.rendered = true;
      LIVE.add(it);
      buildTextLayer(it, v).then(function () { markAndReveal(it); });
      detailSoon(0);
      return;
    }
    const fresh = document.createElement('canvas');
    fresh.width = fw;
    fresh.height = fh;
    const transform = rs !== 1 ? [rs, 0, 0, rs, 0, 0] : null;
    let inWorker = RW.usable(it);
    for (;;) {
      const task = inWorker
        ? RW.render(it, v, fresh.width, fresh.height, transform)
        : it.page.render({
          canvasContext: fresh.getContext('2d', { alpha: false }),
          viewport: v, transform: transform
        });
      it.task = task;
      let bitmap = null;
      try { bitmap = await task.promise; }
      catch (e) {
        if (it.task === task) it.task = null;
        /* the worker could not draw it: draw it here, unless it was
           called off meanwhile */
        if (inWorker && e && e.name === 'RenderWorkerError' && !it.rendered && !it.task &&
            sameView(v, it.vp || v) && it.box && it.box.isConnected) {
          inWorker = false;
          continue;
        }
        /* cancelled for a newer zoom — and only clear the slot if it is still ours */
        fresh.width = fresh.height = 0;
        return;
      }
      if (it.task !== task || !sameView(v, it.vp || v)) {
        if (bitmap) bitmap.close();
        fresh.width = fresh.height = 0;
        return;
      }
      if (bitmap) {
        fresh.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
        bitmap.close();
      }
      break;
    }
    it.task = null;
    const old = it.canvas;
    fresh.style.width = Math.floor(v.width) + 'px';
    fresh.style.height = Math.floor(v.height) + 'px';
    if (old && old.parentNode) {
      old.parentNode.replaceChild(fresh, old);
      old.width = old.height = 0;                  /* hand the old bitmap back now */
    }
    it.canvas = fresh;
    it.baseRot = v.rotation;
    it.rendered = true;
    LIVE.add(it);
    if (it.src.synthetic && !it.blankMark) {
      it.blankMark = document.createElement('div');
      it.blankMark.className = 'blankmark';
      it.blankMark.textContent = 'BLANK PAGE';
      it.inner.appendChild(it.blankMark);
    }
    /* the words come after the picture and do not hold up the next page */
    buildTextLayer(it, v).then(function () { markAndReveal(it); });
    /* zoomed past what one bitmap holds: the part on screen, sharp */
    if (k < 1) detailSoon(0);
  }

  /* ---------------- the detail layer ----------------
     Zoomed right in, a page's bitmap is capped (MAX_CANVAS_SIDE / _PX) and
     CSS stretches it: fine lines go soft. Once scrolling or zooming settles,
     each page on screen whose bitmap is capped gets a second canvas over it,
     drawn sharp for just the part on screen (and a margin round it). It is
     drawn in the render worker; without the worker there is none, and the
     stretched bitmap stays as before. */
  const DETAIL_MARGIN = 0.25;         /* of the screen, each side */
  const BASE_PX_UNDER_DETAIL = 4e6;   /* a page's own bitmap, once a detail covers it */
  let detailTimer = 0;
  function detailSoon(delay) {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(updateDetails, delay == null ? 160 : delay);
  }
  function dropDetail(it) {
    if (it.detailTask) { try { it.detailTask.cancel(); } catch (e) {} it.detailTask = null; }
    if (it.detail) {
      it.detail.width = it.detail.height = 0;
      if (it.detail.parentNode) it.detail.parentNode.removeChild(it.detail);
      it.detail = null;
    }
    it.detailKey = '';
    DETAILED.delete(it);
  }
  const DETAILED = new Set();         /* pages with a detail canvas or one on the way */
  /* a bigger window shows more of the page than the detail covers */
  window.addEventListener('resize', function () { detailSoon(); });
  function updateDetails() {
    if (!S.items.length || document.body.classList.contains('zooming')) return;
    const sr = stage.getBoundingClientRect();
    const mx = sr.width * DETAIL_MARGIN, my = sr.height * DETAIL_MARGIN;
    const view = { l: sr.left - mx, t: sr.top - my, r: sr.right + mx, b: sr.bottom + my };
    /* read every position first, then write */
    const plan = [];
    /* not waiting for the page's own bitmap: after a zoom the old one stays
       up, stretched, while it is redrawn, and the detail can land first */
    LIVE.forEach(function (it) {
      if (!it.vp || !it.mounted || !it.inner || !RW.usable(it)) return;
      const v = it.vp;
      if (bitmapCap(v) >= 1) return;                   /* its bitmap will be sharp */
      const ir = it.inner.getBoundingClientRect();
      const wr = it.wrap.getBoundingClientRect();        /* the part shown, after a crop */
      const l = Math.max(view.l, wr.left, ir.left), t = Math.max(view.t, wr.top, ir.top);
      const r = Math.min(view.r, wr.right, ir.right), b = Math.min(view.b, wr.bottom, ir.bottom);
      if (r - l < 2 || b - t < 2) return;
      /* in the page's own CSS pixels, where the canvas sits */
      const x = Math.floor(l - ir.left), y = Math.floor(t - ir.top);
      const w = Math.ceil(r - ir.left) - x, h = Math.ceil(b - ir.top) - y;
      /* on screen now, without the margin: redrawn only once that leaves
         what the current detail covers */
      const sx = Math.max(sr.left, wr.left) - ir.left, sy = Math.max(sr.top, wr.top) - ir.top;
      const ex = Math.min(sr.right, wr.right) - ir.left, ey = Math.min(sr.bottom, wr.bottom) - ir.top;
      plan.push({ it: it, x: x, y: y, w: w, h: h, sx: sx, sy: sy, ex: ex, ey: ey });
    });
    const keep = new Set();
    plan.forEach(function (p) {
      const it = p.it, v = it.vp;
      keep.add(it);
      const key = v.scale + '/' + v.rotation;
      const d = it.detailRect;
      if (it.detailKey === key && d && p.sx >= d.x && p.sy >= d.y && p.ex <= d.x + d.w && p.ey <= d.y + d.h) return;
      drawDetail(it, v, key, p);
    });
    DETAILED.forEach(function (it) { if (!keep.has(it)) dropDetail(it); });
  }
  function drawDetail(it, v, key, p) {
    if (it.detailTask) { try { it.detailTask.cancel(); } catch (e) {} }
    const pw = Math.max(1, Math.round(p.w * DPR)), ph = Math.max(1, Math.round(p.h * DPR));
    const task = RW.render(it, v, pw, ph, [DPR, 0, 0, DPR, -p.x * DPR, -p.y * DPR], false, null, true);
    it.detailTask = task;
    DETAILED.add(it);
    task.promise.then(function (bitmap) {
      if (it.detailTask !== task) { bitmap.close(); return; }
      it.detailTask = null;
      /* the zoom or the page changed while it was drawn */
      if (!it.vp || !LIVE.has(it) || it.vp.scale + '/' + it.vp.rotation !== key) { bitmap.close(); return; }
      let c = it.detail;
      if (!c) {
        c = document.createElement('canvas');
        c.className = 'detail';
        it.detail = c;
      }
      c.width = pw; c.height = ph;
      c.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
      bitmap.close();
      c.style.left = p.x + 'px'; c.style.top = p.y + 'px';
      c.style.width = p.w + 'px'; c.style.height = p.h + 'px';
      if (c.parentNode !== it.inner) it.inner.insertBefore(c, it.tl);
      it.detailKey = key;
      it.detailRect = { x: p.x, y: p.y, w: p.w, h: p.h };
      it.detailEngine = task.engine;
    }, function () {
      if (it.detailTask === task) it.detailTask = null;
    });
  }

  /* The words are laid out once per turn of the page, at 100%, in units the
     layer's --sf (its zoom) scales: a zoom changes one CSS variable instead
     of asking pdf.js for the text again and rebuilding and re-measuring every
     word. The fit to each word's width (fitTextLayer) holds at any zoom. */
  async function buildTextLayer(it, viewport) {
    setTextScale(it, viewport.scale);
    if (it.tl.firstChild && it.tlRot === viewport.rotation) {
      it.tl.style.visibility = '';
      return;
    }
    const gen = it.tlGen = (it.tlGen || 0) + 1;
    let tc;
    try { tc = await it.page.getTextContent(); } catch (e) { return; }
    if (gen !== it.tlGen || (it.vp && it.vp.rotation !== viewport.rotation)) return;   /* turned again meanwhile */
    const unit = it.page.getViewport({ scale: 1, rotation: viewport.rotation });
    const frag = document.createDocumentFragment();
    tc.items.forEach(function (item) {
      if (!item.str || !item.str.trim()) return;
      const tx = pdfjsLib.Util.transform(unit.transform, item.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      const st = tc.styles ? tc.styles[item.fontName] : null;
      let asc = fh;
      if (st && st.ascent) asc = st.ascent * fh;
      else if (st && st.descent) asc = (1 + st.descent) * fh;
      const el = document.createElement('span');
      el.textContent = item.str;
      el.style.left = 'calc(var(--sf) * ' + tx[4] + 'px)';
      el.style.top = 'calc(var(--sf) * ' + (tx[5] - asc) + 'px)';
      el.style.fontSize = 'calc(var(--sf) * ' + fh + 'px)';
      el.style.fontFamily = (st && st.fontFamily) || 'sans-serif';
      /* at 100%: multiply by the zoom for screen pixels */
      el.dataset.top = tx[5] - asc; el.dataset.asc = asc; el.dataset.fh = fh;
      el.dataset.tw = item.width;
      frag.appendChild(el);
    });
    it.tl.innerHTML = '';
    it.tl.appendChild(frag);
    it.tlRot = viewport.rotation;
    it.tl.style.visibility = '';
    /* the words are stretched to their width on the page; that needs them
       measured, so a page out of the document fits them when it comes back */
    if (it.mounted) fitTextLayer(it); else it.tlFit = true;
  }
  function setTextScale(it, s) {
    if (it.tl && it.tlScale !== s) { it.tl.style.setProperty('--sf', s); it.tlScale = s; }
  }
  function fitTextLayer(it) {
    it.tlFit = false;
    const spans = Array.from(it.tl.children);
    const ws = spans.map(function (el) { return el.getBoundingClientRect().width; });
    const sf = it.tlScale || 1;
    spans.forEach(function (el, i) {
      const target = +el.dataset.tw * sf;
      if (ws[i] > 0 && target > 0) el.style.transform = 'scaleX(' + (target / ws[i]) + ')';
    });
  }

  /* ---------------- thumbnails ----------------
     Drawn only while no page is being drawn, one at a time, nearest the
     visible part of the rail first, so they never hold up the page being
     read. A page already on screen is copied from its own bitmap, which costs
     pdf.js nothing; the rest are rendered small. Far off ones give their
     bitmap back. */
  const TQ = { want: new Set(), busy: false, gen: 0, task: null, it: null, timer: 0, lastScroll: 0, hold: 0, slow: false };
  /* A reader scrolling the pages comes first: thumbnails wait until the page
     has been still a moment, and one being drawn is called off. */
  function thumbsYield() {
    TQ.lastScroll = performance.now();
    if (TQ.task) {
      try { TQ.task.cancel(); } catch (e) {}
      if (TQ.it) TQ.want.add(TQ.it);
    }
  }
  /* Saving and searching come first too: no thumbnail starts while they run.
     Pages of heavy drawings take a second or more each, even small. */
  function thumbsPause() { TQ.hold++; thumbsYield(); }
  function thumbsResume() { TQ.hold = Math.max(0, TQ.hold - 1); TQ.lastScroll = performance.now(); pumpThumbs(); }
  const TLIVE = new Set();
  function firstThumbAt(y) {
    let lo = 0, hi = S.items.length - 1, ans = S.items.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, th = S.items[mid].thumb;
      if (th && th.offsetTop + th.offsetHeight >= y) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }
  function drawVisibleThumbs() {
    if (rail.hidden || !S.items.length) return;
    const host = $('railPages');
    const top = host.scrollTop - 500, bot = host.scrollTop + host.clientHeight + 500;
    const keepTop = host.scrollTop - 4000, keepBot = host.scrollTop + host.clientHeight + 4000;
    /* read every position first, then write */
    let chrome = 0;
    if (!thumbChrome) {
      TMOUNTED.forEach(function (it) {
        if (!chrome && it.thumb.isConnected && it.thumbShell.style.height) {
          chrome = it.thumb.offsetHeight - parseFloat(it.thumbShell.style.height);
        }
      });
    }
    const near = [];
    for (let i = firstThumbAt(top); i < S.items.length; i++) {
      const it = S.items[i];
      if (!it.thumb) continue;
      if (it.thumb.offsetTop > bot) break;
      near.push(it);
    }
    const drop = [], away = [];
    TLIVE.forEach(function (it) {
      const th = it.thumb;
      if (!th || !th.isConnected || th.offsetTop + th.offsetHeight < keepTop || th.offsetTop > keepBot) drop.push(it);
    });
    TMOUNTED.forEach(function (it) {
      const th = it.thumb;
      if (!th || !th.isConnected) { TMOUNTED.delete(it); return; }
      if (th.offsetTop + th.offsetHeight < keepTop || th.offsetTop > keepBot) away.push([it, th.offsetHeight]);
    });
    /* the measured chrome replaces the guess on every thumbnail still held */
    if (chrome > 0 && chrome !== thumbChrome) {
      thumbChrome = chrome;
      S.items.forEach(function (it) {
        if (!it.thumbMounted && it.thumbShell && it.thumbShell.style.height) {
          it.thumb.style.height = (parseFloat(it.thumbShell.style.height) + chrome) + 'px';
        }
      });
    }
    drop.forEach(function (it) {
      it.thumbCanvas.width = it.thumbCanvas.height = 1;
      it.thumbDone = false;
      TLIVE.delete(it);
    });
    away.forEach(function (x) { unmountThumb(x[0], x[1]); });
    near.forEach(function (it) {
      mountThumb(it);
      ensureThumbTools(it);
      if (!it.thumbDone) TQ.want.add(it);
    });
    /* first thumbnails in: measure their chrome next frame */
    if (!thumbChrome && near.length) requestAnimationFrame(drawVisibleThumbs);
    pumpThumbs();
  }
  $('railPages').addEventListener('scroll', drawVisibleThumbs);

  /* asks for a page's thumbnail; it is drawn when its turn comes */
  function drawThumb(it) {
    if (!it || it.thumbDone || !it.thumb) return;
    TQ.want.add(it);
    pumpThumbs();
  }
  function pumpThumbs() {
    if (TQ.busy || !TQ.want.size || rail.hidden) return;
    if (RQ.busy || RQ.want.size || TQ.hold) return;  /* pages first: pumpRender calls back when idle */
    /* a document whose thumbnails are slow to draw waits for a longer pause */
    const quiet = TQ.slow ? 1500 : 400;
    const still = performance.now() - TQ.lastScroll;
    if (still < quiet) {
      clearTimeout(TQ.timer);
      TQ.timer = setTimeout(pumpThumbs, quiet + 20 - still);
      return;
    }
    const host = $('railPages');
    const mid = host.scrollTop + host.clientHeight / 2;
    let best = null, bestGap = Infinity;
    TQ.want.forEach(function (it) {
      if (!it.thumb || !it.thumb.isConnected || it.thumbDone) { TQ.want.delete(it); return; }
      const gap = Math.abs(it.thumb.offsetTop - mid);
      if (gap < bestGap) { bestGap = gap; best = it; }
    });
    if (!best) return;
    TQ.want.delete(best);
    TQ.busy = true;
    const gen = TQ.gen;
    paintThumb(best).catch(function () {}).then(function () {
      if (gen !== TQ.gen) return;
      TQ.busy = false;
      pumpThumbs();
    });
  }

  async function paintThumb(it) {
    if (it.thumbDone) return;
    it.thumbDone = true;
    await ensurePage(it);
    const rot = it.page.rotate + it.rot;
    const v1 = it.page.getViewport({ scale: 1, rotation: rot });
    const c1 = cropRectIn(v1, it.crop);
    const shown = c1 ? c1.width : v1.width;
    const sc = 176 / shown;
    const v = it.page.getViewport({ scale: sc, rotation: rot });
    const c = cropRectIn(v, it.crop);
    it.thumbCanvas.width = Math.floor(v.width);
    it.thumbCanvas.height = Math.floor(v.height);
    it.thumbCanvas.style.width = Math.floor(v.width) + 'px';
    it.thumbCanvas.style.height = Math.floor(v.height) + 'px';
    it.thumbCanvas.style.left = (c ? -c.left : 0) + 'px';
    it.thumbCanvas.style.top = (c ? -c.top : 0) + 'px';
    it.thumbShell.style.height = Math.floor(c ? c.height : v.height) + 'px';
    const ctx = it.thumbCanvas.getContext('2d');
    /* the page is on screen, sharp and turned the same way: shrink its bitmap */
    if (it.rendered && !it.task && it.canvas && it.canvas.width > 1 && it.vp &&
        it.vp.rotation === v.rotation) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(it.canvas, 0, 0, it.thumbCanvas.width, it.thumbCanvas.height);
      TLIVE.add(it);
      return;
    }
    let inWorker = RW.usable(it);
    const t0 = performance.now();
    for (;;) {
      const task = inWorker
        /* a page not on screen will not be drawn again soon: free it after */
        ? RW.render(it, v, it.thumbCanvas.width, it.thumbCanvas.height, null, !it.rendered)
        : it.page.render({ canvasContext: ctx, viewport: v });
      TQ.task = task; TQ.it = it;
      try {
        const bitmap = await task.promise;
        if (bitmap) { ctx.drawImage(bitmap, 0, 0); bitmap.close(); }
        TLIVE.add(it);
        if (performance.now() - t0 > 300) TQ.slow = true;
      } catch (e) {
        /* the worker could not draw it: draw it here */
        if (inWorker && e && e.name === 'RenderWorkerError' && TQ.task === task) { inWorker = false; continue; }
        it.thumbDone = false;
      } finally { if (TQ.task === task) { TQ.task = null; TQ.it = null; } }
      break;
    }
  }

  /* ---------------- shapes ---------------- */
  function drawShapes(it, ghost) {
    if (!it.anno) return;
    while (it.anno.firstChild) it.anno.removeChild(it.anno.firstChild);
    const vp = it.vp;
    if (!vp) return;
    it.shapes.forEach(function (s, idx) { it.anno.appendChild(shapeEl(it, s, vp, idx)); });
    if (ghost) it.anno.appendChild(shapeEl(it, ghost, vp, -1));
    if (!ghost && S.tool === 'select' && S.sel && S.sel.it === it) {
      const list = selList();
      if (list.length > 1) {
        /* a group: a dashed box round each member, no grips — you move a
           group, you resize one mark at a time */
        list.forEach(function (i) {
          const el = it.anno.children[i];
          if (!el || !el.getBBox) return;
          let b;
          try { b = el.getBBox(); } catch (e) { return; }
          const h = document.createElementNS(SVGNS, 'rect');
          h.setAttribute('class', 'halo multi');
          h.setAttribute('x', b.x - 3); h.setAttribute('y', b.y - 3);
          h.setAttribute('width', b.width + 6); h.setAttribute('height', b.height + 6);
          it.anno.appendChild(h);
        });
      } else {
        const sel = it.shapes[S.sel.i];
        if (sel && sel.t !== 'pin') it.anno.appendChild(handlesEl(it, sel, vp, S.sel.i));
      }
    }
  }

  function shapeEl(it, s, vp, idx) {
    if (s.t === 'text') return textEl(it, s, vp, idx);
    if (s.t === 'pin') return pinEl(it, s, vp, idx);
    if (EXT.shapeRenderers[s.t]) return EXT.shapeRenderers[s.t](it, s, vp, idx);
    const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
    const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
    const sw = Math.max(0.6, s.w * S.scale);
    const g = document.createElementNS(SVGNS, 'g');
    const selected = S.sel && S.sel.it === it && S.sel.i === idx;

    /* inline styles, because the sheet's .sh rule would win over attributes */
    function stroke(el, noDash) {
      el.setAttribute('class', 'sh');
      el.style.stroke = s.c;
      el.style.strokeWidth = sw;
      el.style.strokeOpacity = shOp(s);
      el.style.strokeLinecap = CAP_CSS[shCap(s)];
      el.style.strokeLinejoin = JOIN_CSS[shJoin(s)];
      const da = noDash ? null : dashOf(s, sw);
      el.style.strokeDasharray = da ? da.join(' ') : 'none';
      if (idx >= 0) el.addEventListener('pointerdown', function (e) {
        beginDrag(it, idx, e, 'move');
      });
      return el;
    }

    if (s.t === 'rect') {
      const q = rectCorners(s).map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); });
      const r = document.createElementNS(SVGNS, 'polygon');
      r.setAttribute('points', vpts(q));
      stroke(r);
      r.style.fill = s.fill || 'none';
      if (s.fill) {
        r.style.fillOpacity = shOp(s);
        r.style.pointerEvents = 'all';        /* a filled box is grabbable anywhere */
      }
      g.appendChild(r);
    } else {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]);
      l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]);
      g.appendChild(stroke(l));
      if (s.t === 'arrow') {
        const h = arrowHead(a[0], a[1], b[0], b[1], sw);
        const p = document.createElementNS(SVGNS, 'polyline');
        p.setAttribute('points', h[0][0] + ',' + h[0][1] + ' ' + b[0] + ',' + b[1] + ' ' + h[1][0] + ',' + h[1][1]);
        g.appendChild(stroke(p, true));
      }
    }
    return g;
  }

  /* direction of a PDF-space ray once mapped into the viewport (handles page rotation) */
  function dirAngle(vp, x, y, deg) {
    const t = (deg || 0) * Math.PI / 180;
    const o = vp.convertToViewportPoint(x, y);
    const u = vp.convertToViewportPoint(x + 10 * Math.cos(t), y + 10 * Math.sin(t));
    return Math.atan2(u[1] - o[1], u[0] - o[0]) * 180 / Math.PI;
  }
  function baseAngle(vp, x, y) { return dirAngle(vp, x, y, 0); }

  /* ---- mark geometry: every mark is stored in PDF points, so move, resize and
     rotate all happen in PDF space and the screen, the JPGs and the PDF agree ---- */
  function rotPt(p, c, deg) { return E.rotPt(p, c, deg); }
  function boxOf(s) { return E.boxOf(s); }
  function shapeMid(s) { return E.shapeMid(s); }
  /* the four corners of a box, turned by its own rotation */
  function rectCorners(s) { return E.rectCorners(s); }
  /* text turns about its own anchor, which is also where pdf-lib turns it */
  function rotCenter(s) { return E.rotCenter(s); }
  /* the un-turned footprint of a text mark, in PDF points */
  function textRect(s) { return E.textRect(s, textWidth); }
  /* that footprint as four viewport points, turned */
  function textQuad(s, vp) {
    const r = textRect(s), c = rotCenter(s);
    const q = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    return (s.r ? q.map(function (p) { return rotPt(p, c, s.r); }) : q)
      .map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); });
  }
  /* baseline origin of one line of a text mark, turned with the rest.
     lineWidth is that one line's own width — needed to offset centre- and
     right-aligned lines off the box's left edge, which is s.a[0] itself. */
  function lineOrigin(s, li, lineWidth) { return E.lineOrigin(s, li, lineWidth, textWidth); }
  function vpts(q) { return q.map(function (p) { return p[0] + ',' + p[1]; }).join(' '); }

  function textEl(it, s, vp, idx) {
    const g = document.createElementNS(SVGNS, 'g');
    const selected = S.sel && S.sel.it === it && S.sel.i === idx;
    const ang = dirAngle(vp, s.a[0], s.a[1], s.r || 0);

    function clicker(el) {
      if (idx >= 0) {
        el.addEventListener('pointerdown', function (e) {
          beginDrag(it, idx, e, 'move');
        });
        el.addEventListener('click', function (e) {
          if (S.tool !== 'text') return;
          e.stopPropagation();
          openEditor(it, null, idx);
        });
        /* a double-click opens it for editing from Select too, the way any
           other editor treats a text box — no need to pick up the Text tool
           first just to fix a typo */
        el.addEventListener('dblclick', function (e) {
          if (S.tool !== 'select') return;
          e.stopPropagation();
          openEditor(it, null, idx);
        });
      }
      return el;
    }

    if (s.bg) {
      const r = document.createElementNS(SVGNS, 'polygon');
      r.setAttribute('class', 'txbg');
      r.setAttribute('points', vpts(textQuad(s, vp)));
      r.setAttribute('fill', s.bg);
      r.style.fillOpacity = s.bgOp == null ? 1 : s.bgOp;
      g.appendChild(clicker(r));
    }
    if (s.patch) {
      const r = document.createElementNS(SVGNS, 'polygon');
      r.setAttribute('class', 'patch');
      r.setAttribute('points', vpts(textQuad(s, vp)));
      r.setAttribute('fill', s.patch.c);
      g.appendChild(clicker(r));
    }

    const lines = String(s.text).split('\n');
    lines.forEach(function (line, li) {
      if (!line) return;
      const w = textWidth(s, line);
      const lo = lineOrigin(s, li, w);
      const pt = vp.convertToViewportPoint(lo[0], lo[1]);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', 'tx');
      t.setAttribute('x', pt[0]); t.setAttribute('y', pt[1]);
      t.setAttribute('fill', s.c);
      t.style.fillOpacity = shOp(s);
      t.setAttribute('font-size', s.size * S.scale);
      t.setAttribute('font-family', CSS_FONT[s.f]);
      if (s.b) t.setAttribute('font-weight', 'bold');
      if (s.i) t.setAttribute('font-style', 'italic');
      if (s.u || s.k) t.style.textDecoration = textDecoLine(s);
      if (ang) t.setAttribute('transform', 'rotate(' + ang + ',' + pt[0] + ',' + pt[1] + ')');
      if (w) { t.setAttribute('textLength', w * S.scale); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      t.textContent = line;
      g.appendChild(clicker(t));
    });

    if (selected) {
      const h = document.createElementNS(SVGNS, 'polygon');
      h.setAttribute('class', 'halo');
      h.setAttribute('points', vpts(textQuad(s, vp)));
      g.appendChild(h);
    }
    return g;
  }

  /* viewport-space bounds of a text item — the box around it however it is turned */
  function textBox(s, vp) {
    const q = textQuad(s, vp);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    q.forEach(function (p) {
      x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
      x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
    });
    return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
  }

  /* ---------------- moving, resizing and turning a mark ---------------- */
  /* Marks live in PDF points, so one transform here is enough: the page, the
     JPG export and the vector PDF all read the same numbers back. */
  let dragOn = null;

  function annoPt(it, e) {
    const r = it.anno.getBoundingClientRect();
    return it.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
  }
  /* ---- multi-selection ----
     S.sel stays the one mark last touched; S.multi adds the rest of a group on
     the same page: {it, idx: [...], n}. The group only counts while it still
     matches — same page, same number of marks, and S.sel one of them — so any
     code that simply sets S.sel to a single mark ends a group without having
     to know groups exist. */
  const NOT_SELECTABLE = { pin: 1, wm: 1, hf: 1, bates: 1 };
  function selList() {
    if (!S.sel || !S.sel.it) return [];
    const m = S.multi;
    if (m && m.it === S.sel.it && m.n === S.sel.it.shapes.length && m.idx.indexOf(S.sel.i) >= 0) {
      return m.idx.slice();
    }
    return [S.sel.i];
  }
  function setGroup(it, idx) {
    idx = idx.filter(function (i, k) {
      const s = it.shapes[i];
      return s && !NOT_SELECTABLE[s.t] && idx.indexOf(i) === k;
    });
    if (!idx.length) { S.sel = null; S.multi = null; return; }
    S.sel = { it: it, i: idx[idx.length - 1] };
    S.multi = idx.length > 1 ? { it: it, idx: idx, n: it.shapes.length } : null;
  }
  /** Move one mark by (mx, my) from its state o — every kind of point it has. */
  function moveShape(s, o, mx, my) {
    if (o.a) s.a = [o.a[0] + mx, o.a[1] + my];
    if (o.b) s.b = [o.b[0] + mx, o.b[1] + my];
    if (o.m) s.m = [o.m[0] + mx, o.m[1] + my];    /* a third point, e.g. a Leader's elbow */
    if (o.patch) s.patch = Object.assign({}, o.patch, { x: o.patch.x + mx, y: o.patch.y + my });
    if (o.pts && !o.a) s.pts = o.pts.map(function (q) { return [q[0] + mx, q[1] + my]; });
  }

  function copyShape(s) {
    return Object.assign({}, s, {
      a: s.a ? s.a.slice() : null,
      b: s.b ? s.b.slice() : null,
      patch: s.patch ? Object.assign({}, s.patch) : null
    });
  }

  /* ---- Shift constrains, as in any drawing program ----
     A line snaps to horizontal, vertical or 45°, a box to a square. Page
     rotation is always a multiple of 90°, so snapping in PDF space is the
     same as snapping on screen. */
  function snapLine(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) return [b[0], b[1]];
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > ady * 2.414) return [b[0], a[1]];              /* under 22.5°: level */
    if (ady > adx * 2.414) return [a[0], b[1]];              /* over 67.5°: plumb */
    const m = (adx + ady) / 2;                                /* otherwise a true 45° */
    return [a[0] + Math.sign(dx) * m, a[1] + Math.sign(dy) * m];
  }
  function snapBox(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const r = Math.max(Math.abs(dx), Math.abs(dy));
    return [a[0] + Math.sign(dx || 1) * r, a[1] + Math.sign(dy || 1) * r];
  }
  const LINE_KINDS = { line: 1, arrow: 1, dim: 1, arc: 1 };
  const BOX_KINDS = { rect: 1, ellipse: 1, cloud: 1 };
  /** b as Shift would have it, for a two-point mark of kind t drawn from a. */
  function constrainPt(t, a, b) {
    if (LINE_KINDS[t]) return snapLine(a, b);
    if (BOX_KINDS[t]) return snapBox(a, b);
    return [b[0], b[1]];
  }

  function beginDrag(it, idx, e, mode, extra) {
    if (S.tool !== 'select' || !it.vp || e.button > 0) return;
    const s = it.shapes[idx];
    if (!s || s.t === 'pin') return;             /* pins have their own tool */
    e.preventDefault(); e.stopPropagation();
    const at = annoPt(it, e), c = rotCenter(s);
    /* grabbing a member of a group moves the whole group */
    const list = selList();
    const group = mode === 'move' && list.length > 1 && S.sel.it === it && list.indexOf(idx) >= 0
      ? list.map(function (i) { return { i: i, s0: copyShape(it.shapes[i]) }; }) : null;
    dragOn = {
      it: it, idx: idx, mode: mode, extra: extra, from: at, s0: copyShape(s),
      moved: false, snapped: false, group: group,
      a0: Math.atan2(at[1] - c[1], at[0] - c[0]) * 180 / Math.PI,
      d0: Math.hypot(at[0] - c[0], at[1] - c[1])
    };
    const fresh = !S.sel || S.sel.it !== it || S.sel.i !== idx;
    if (!group && mode === 'move') S.multi = null;
    S.sel = { it: it, i: idx };
    try { it.anno.setPointerCapture(e.pointerId); } catch (err) { /* mouse works without it */ }
    if (fresh) redrawAll(); else drawShapes(it);
    hideMarkPop();                               /* it comes back when the drag ends */
  }

  function resizeBox(s, o, ci, p, square) {
    const b = boxOf(o), c0 = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2], r = o.r || 0;
    const corners = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
    const fix = corners[(ci + 2) % 4];
    const loc = rotPt(p, c0, -r);                /* the pointer in the box's own frame */
    let x1 = Math.min(fix[0], loc[0]), x2 = Math.max(fix[0], loc[0]);
    let y1 = Math.min(fix[1], loc[1]), y2 = Math.max(fix[1], loc[1]);
    if (square) {
      const side = Math.max(x2 - x1, y2 - y1);
      if (loc[0] < fix[0]) x1 = fix[0] - side; else x2 = fix[0] + side;
      if (loc[1] < fix[1]) y1 = fix[1] - side; else y2 = fix[1] + side;
    }
    const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
    const c1 = rotPt([(x1 + x2) / 2, (y1 + y2) / 2], c0, r);
    s.a = [c1[0] - w / 2, c1[1] - h / 2];
    s.b = [c1[0] + w / 2, c1[1] + h / 2];
  }

  function turnShape(s, o, d, p, snap) {
    const c = rotCenter(o);
    let delta = Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI - d.a0;
    if (o.t === 'line' || o.t === 'arrow') {
      if (snap) delta = Math.round(delta / 15) * 15;
      s.a = rotPt(o.a, c, delta);
      s.b = rotPt(o.b, c, delta);
    } else {
      let deg = (o.r || 0) + delta;
      if (snap) deg = Math.round(deg / 15) * 15;
      s.r = ((deg % 360) + 360) % 360;
      if (!s.r) delete s.r;
    }
  }

  function dragMove(e) {
    const d = dragOn; if (!d) return;
    const s = d.it.shapes[d.idx];
    if (!s || !d.it.vp) { dragOn = null; return; }
    const p = annoPt(d.it, e);
    const dx = p[0] - d.from[0], dy = p[1] - d.from[1];
    if (!d.moved) {
      if (Math.abs(dx) < 0.7 && Math.abs(dy) < 0.7) return;   /* a tap, not a drag */
      d.moved = true;
      if (!d.snapped) { snapshot(); d.snapped = true; }        /* nothing is changed yet */
    }
    const o = d.s0;
    if (d.mode === 'move') {
      let mx = dx, my = dy;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; }   /* along one axis */
      if (d.group) {
        d.group.forEach(function (m) {
          const sh = d.it.shapes[m.i];
          if (sh) moveShape(sh, m.s0, mx, my);
        });
      } else {
        moveShape(s, o, mx, my);
      }
    } else if ((d.mode === 'pa' || d.mode === 'pb') && EXT.snapPt &&
               (d.snapTo = EXT.snapPt(d.it, p, e, { skip: d.idx }))) {
      /* an end dragged onto a snap point lands exactly on it */
      s[d.mode === 'pa' ? 'a' : 'b'] = d.snapTo;
    } else if (d.mode === 'pa' && e.shiftKey && o.b && LINE_KINDS[o.t]) {
      s.a = snapLine(o.b, p);
    } else if (d.mode === 'pb' && e.shiftKey && LINE_KINDS[o.t]) {
      s.b = snapLine(o.a, p);
    } else if (d.mode === 'pa') {
      s.a = [p[0], p[1]];
    } else if (d.mode === 'pb') {
      s.b = [p[0], p[1]];
    } else if (d.mode === 'corner') {
      resizeBox(s, o, d.extra, p, e.shiftKey);
    } else if (d.mode === 'turn') {
      turnShape(s, o, d, p, e.shiftKey);
    } else if (d.mode === 'size') {
      const c = rotCenter(o);
      const d1 = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d.d0 > 1) s.size = Math.max(4, Math.min(300, o.size * (d1 / d.d0)));
    }
    drawShapes(d.it);
  }

  function dragEnd() {
    const d = dragOn; if (!d) return;
    dragOn = null;
    if (EXT.snapHide) EXT.snapHide();
    if (d.moved) { drawShapes(d.it); updateMeta(); }
    syncMarkPop();
    if (!d.moved) toast('Mark selected · drag to move, corners to resize, ↻ to turn, <b>Delete</b> to remove');
  }
  document.addEventListener('pointermove', dragMove);
  document.addEventListener('pointerup', dragEnd);
  document.addEventListener('pointercancel', function () {
    const d = dragOn; if (!d) return;
    dragOn = null;
    if (d.moved) { d.it.shapes[d.idx] = d.s0; drawShapes(d.it); }
  });

  /* ---- properties of the selected mark ---- */
  /* The panel edits the mark in place: every control writes straight onto the
     shape and redraws, so what is on screen is what gets exported. */
  /* the modules' own marks are named here too, so the popover never has to
     fall back to the bare word "Mark" */
  const MARK_NAME = {
    rect: 'Box', line: 'Line', arrow: 'Arrow', text: 'Text',
    ellipse: 'Circle', cloud: 'Cloud', arc: 'Arc', dim: 'Dimension',
    dimr: 'Radius', dimd: 'Diameter', dima: 'Angle',
    markup: 'Markup', ink: 'Ink', note: 'Note', stamp: 'Stamp', sig: 'Signature',
    redact: 'Redaction', wm: 'Watermark', hf: 'Header / footer', bates: 'Bates',
    image: 'Image', video: 'Video', link: 'Link', table: 'Table', leader: 'Leader'
  };
  let mpBuilt = false;

  function selShape() {
    if (S.tool !== 'select' || !S.sel) return null;
    const it = S.sel.it, s = it && it.shapes ? it.shapes[S.sel.i] : null;
    return s && s.t !== 'pin' ? s : null;
  }
  function markEdit(fn) {
    const s = selShape(); if (!s) return;
    snapshot();
    /* a change made with a group selected goes to every member */
    const it = S.sel.it;
    selList().forEach(function (i) { const m = it.shapes[i]; if (m) fn(m); });
    drawShapes(it); updateMeta(); syncMarkPop();
  }

  function buildMarkPop() {
    if (mpBuilt) return;
    mpBuilt = true;
    $('mpFillBtn').addEventListener('click', function (e) {
      e.stopPropagation(); openSwatches('fill', this);
    });
    $('mpStrokeBtn').addEventListener('click', function (e) {
      e.stopPropagation(); openSwatches('c', this);
    });
    $('mpOpacity').addEventListener('change', function () {
      const v = parseFloat(this.value);
      if (isNaN(v)) { syncMarkPop(); return; }
      const o = Math.max(0, Math.min(100, v)) / 100;
      markEdit(function (s) { if (o >= 1) delete s.o; else s.o = o; });
    });
    $('mpWidth').addEventListener('change', function () {
      const v = parseFloat(this.value);
      if (isNaN(v)) { syncMarkPop(); return; }
      markEdit(function (s) { s.w = Math.max(0.2, Math.min(72, v)); });
    });
    $('mpStyle').addEventListener('change', function () {
      const v = +this.value; markEdit(function (s) { if (v) s.d = v; else delete s.d; });
    });
    $('mpCap').addEventListener('change', function () {
      const v = +this.value; markEdit(function (s) { if (v === 1) delete s.cap; else s.cap = v; });
    });
    $('mpJoin').addEventListener('change', function () {
      const v = +this.value; markEdit(function (s) { if (v === 1) delete s.j; else s.j = v; });
    });
    $('mpFont').addEventListener('change', function () {
      const v = this.value; markEdit(function (s) { s.f = v; });
    });
    $('mpBold').addEventListener('click', function () { markEdit(function (s) { s.b = !s.b; }); });
    $('mpItal').addEventListener('click', function () { markEdit(function (s) { s.i = !s.i; }); });
    $('mpSize').addEventListener('change', function () {
      const v = parseFloat(this.value);
      if (isNaN(v)) { syncMarkPop(); return; }
      markEdit(function (s) { s.size = Math.max(4, Math.min(300, v)); });
    });
    $('mpAngle').addEventListener('change', function () {
      const v = parseFloat(this.value);
      if (isNaN(v)) { syncMarkPop(); return; }
      markEdit(function (s) { setMarkAngle(s, v); });
    });
    ['mpOpacity', 'mpWidth', 'mpSize', 'mpAngle'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') this.blur();
      });
    });
    $('mpDel').addEventListener('click', function () { deleteSelected(); });
  }

  /* ---------------- the colour palette ----------------
     Laid out like Office's: each theme colour over five of its own tints and
     shades, then the standard row, the colours used lately, and a custom
     picker. Square swatches, so a grid of sixty still reads at a glance. */
  function mixHex(hex, to, k) {           /* k of the way from hex to the colour `to` */
    function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const a = rgb(hex), b = rgb(to);
    function ch(x, y) { return Math.round(x + (y - x) * k); }
    return '#' + [ch(a[0], b[0]), ch(a[1], b[1]), ch(a[2], b[2])]
      .map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  function shadesOf(c) {
    if (c === '#FFFFFF') return [0.05, 0.15, 0.25, 0.35, 0.5].map(function (k) { return mixHex(c, '#000000', k); });
    if (c === '#000000') return [0.5, 0.35, 0.25, 0.15, 0.05].map(function (k) { return mixHex(c, '#FFFFFF', 1 - k); });
    return [mixHex(c, '#FFFFFF', 0.8), mixHex(c, '#FFFFFF', 0.6), mixHex(c, '#FFFFFF', 0.4),
            mixHex(c, '#000000', 0.25), mixHex(c, '#000000', 0.5)];
  }
  const RECENT_KEY = 'adpdf.recentColors';
  function recentColors() {
    try { return (JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []).slice(0, 10); } catch (e) { return []; }
  }
  function noteRecent(c) {
    c = String(c).toUpperCase();
    const list = recentColors().filter(function (x) { return x !== c; });
    list.unshift(c);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) { /* private window */ }
  }
  /** Fill host with the full palette; onPick(colour) is called with the choice. */
  function buildPalette(host, current, onPick) {
    const cur = String(current || '').toUpperCase();
    function sq(c) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'psq'; b.style.background = c; b.title = c;
      b.dataset.c = c;
      if (c.toUpperCase() === cur) b.classList.add('on');
      b.addEventListener('click', function (e) { e.stopPropagation(); noteRecent(c); onPick(c); });
      return b;
    }
    function head(t) { const h = document.createElement('div'); h.className = 'phead'; h.textContent = t; host.appendChild(h); }
    function grid(list, cls) {
      const g = document.createElement('div'); g.className = 'pgrid' + (cls ? ' ' + cls : '');
      list.forEach(function (c) { g.appendChild(sq(c)); });
      host.appendChild(g);
    }
    head('Theme colours');
    grid(COLORS, 'base');
    const cols = COLORS.map(shadesOf);
    const shades = [];
    for (let r = 0; r < 5; r++) cols.forEach(function (s) { shades.push(s[r]); });
    grid(shades, 'shades');
    head('Standard colours');
    grid(STD_COLORS);
    const rec = recentColors();
    if (rec.length) { head('Recent'); grid(rec); }
    /* anything else: the system picker, or a hex code typed straight in */
    const row = document.createElement('div'); row.className = 'pcustom';
    const pick = document.createElement('input'); pick.type = 'color';
    pick.value = /^#[0-9A-F]{6}$/i.test(cur) ? cur.toLowerCase() : '#e2483d';
    pick.title = 'Custom colour';
    const hex = document.createElement('input'); hex.type = 'text'; hex.maxLength = 7;
    hex.value = /^#[0-9A-F]{6}$/i.test(cur) ? cur : ''; hex.placeholder = '#RRGGBB';
    hex.setAttribute('aria-label', 'Hex colour');
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn'; ok.textContent = 'Use';
    function useHex(v) {
      v = String(v).trim(); if (v[0] !== '#') v = '#' + v;
      if (!/^#[0-9A-F]{6}$/i.test(v)) { hex.classList.add('bad'); return; }
      v = v.toUpperCase(); noteRecent(v); onPick(v);
    }
    pick.addEventListener('input', function () { hex.value = pick.value.toUpperCase(); hex.classList.remove('bad'); });
    pick.addEventListener('change', function () { useHex(pick.value); });
    hex.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') useHex(hex.value); });
    hex.addEventListener('click', function (e) { e.stopPropagation(); });
    pick.addEventListener('click', function (e) { e.stopPropagation(); });
    ok.addEventListener('click', function (e) { e.stopPropagation(); useHex(hex.value || pick.value); });
    const lab = document.createElement('span'); lab.className = 'plab'; lab.textContent = 'Custom';
    row.appendChild(lab); row.appendChild(pick); row.appendChild(hex); row.appendChild(ok);
    host.appendChild(row);
  }

  /* the colour picker shared by Fill and Border */
  let swFor = null;
  function openSwatches(key, anchor) {
    const s = selShape(); if (!s) return;
    const pop = $('mpSwatches');
    if (swFor === key && !pop.hidden) { closeSwatches(); return; }
    swFor = key;
    pop.innerHTML = '';
    pop.classList.add('palette');
    if (key === 'fill') {
      const n = document.createElement('button');
      n.type = 'button';
      n.className = 'pnofill' + (s.fill ? '' : ' on');
      n.innerHTML = '<i></i>No fill';
      n.addEventListener('click', function (e) {
        e.stopPropagation(); markEdit(function (x) { delete x.fill; }); closeSwatches();
      });
      pop.appendChild(n);
    }
    buildPalette(pop, s[key], function (c) {
      markEdit(function (x) { x[key] = c; });
      closeSwatches();
    });
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.top = top + 'px';
  }
  function closeSwatches() { swFor = null; const p = $('mpSwatches'); if (p) p.hidden = true; }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#mpSwatches') && !e.target.closest('.cbtn')) closeSwatches();
  });

  /* the angle a mark reads as, and how to set it */
  function markAngle(s) {
    if (s.t === 'line' || s.t === 'arrow') {
      return Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180 / Math.PI;
    }
    return s.r || 0;
  }
  function setMarkAngle(s, deg) {
    if (s.t === 'line' || s.t === 'arrow') {
      const c = shapeMid(s), turn = deg - markAngle(s);
      s.a = rotPt(s.a, c, turn);
      s.b = rotPt(s.b, c, turn);
      return;
    }
    const v = ((deg % 360) + 360) % 360;
    if (v) s.r = v; else delete s.r;
  }

  function syncMarkPop() {
    const pop = $('markPop'), s = selShape();
    if (!s || dragOn) { pop.hidden = true; closeSwatches(); return; }
    buildMarkPop();
    const isText = s.t === 'text';
    const isBox = s.t === 'rect';
    const count = selList().length;
    $('mpTitle').textContent = count > 1 ? count + ' marks' : (MARK_NAME[s.t] || 'Mark');

    $('mpFillBtn').hidden = !isBox;
    $('mpFillChip').className = s.fill ? '' : 'none';
    $('mpFillChip').style.background = s.fill || '';
    $('mpStrokeChip').style.background = s.c;
    $('mpStrokeLbl').textContent = isText ? 'Text' : isBox ? 'Border' : 'Colour';

    $('mpStyleWrap').hidden = isText;
    $('mpWidthWrap').hidden = isText;
    $('mpCapWrap').hidden = isText;
    $('mpJoinWrap').hidden = !isBox;
    $('mpText').hidden = !isText;

    if (!isText) {
      $('mpStyle').value = String(s.d || 0);
      $('mpCap').value = String(shCap(s));
      if (document.activeElement !== $('mpWidth')) $('mpWidth').value = (Math.round(s.w * 10) / 10);
      if (isBox) $('mpJoin').value = String(shJoin(s));
    } else {
      $('mpFont').value = s.f || 'helv';
      $('mpBold').classList.toggle('on', !!s.b);
      $('mpItal').classList.toggle('on', !!s.i);
      if (document.activeElement !== $('mpSize')) $('mpSize').value = (Math.round(s.size * 10) / 10);
    }
    if (document.activeElement !== $('mpOpacity')) $('mpOpacity').value = Math.round(shOp(s) * 100);
    if (document.activeElement !== $('mpAngle')) $('mpAngle').value = Math.round(markAngle(s) * 10) / 10;

    /* whatever the module that owns this mark type wants alongside: for a
       dimension that is the drawing scale, which otherwise leaves with the
       ribbon the moment the tool is put down */
    const extra = EXT.markPop[s.t];
    $('mpExtDiv').hidden = !extra;
    $('mpExt').hidden = !extra;
    if (extra) {
      if (extra.el && extra.el.parentNode !== $('mpExt')) {
        $('mpExt').innerHTML = '';
        $('mpExt').appendChild(extra.el);
      }
      if (extra.sync) { try { extra.sync(s); } catch (e) { console.error('[markPop ' + s.t + ']', e); } }
    }

    pop.hidden = false;
    placeMarkPop();
  }

  /* park it just clear of the mark, kept inside the window */
  function placeMarkPop() {
    const pop = $('markPop'), s = selShape();
    if (!pop || pop.hidden || !s) return;
    const it = S.sel.it, vp = it.vp;
    if (!vp || !it.anno) { pop.hidden = true; return; }
    const q = s.t === 'text' ? textQuad(s, vp)
            : s.t === 'rect' ? rectCorners(s).map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); })
            : [vp.convertToViewportPoint(s.a[0], s.a[1]), vp.convertToViewportPoint(s.b[0], s.b[1])];
    const r = it.anno.getBoundingClientRect();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    q.forEach(function (p) {
      x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
      x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
    });
    const w = pop.offsetWidth, h = pop.offsetHeight, pad = 10;
    let left = r.left + (x1 + x2) / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.top + y2 + 34;                                  /* clear of the turn grip */
    if (top + h > window.innerHeight - pad) top = r.top + y1 - h - 34;
    top = Math.max(pad, Math.min(window.innerHeight - h - pad, top));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function hideMarkPop() { const p = $('markPop'); if (p) p.hidden = true; closeSwatches(); }

  /* the grab points drawn on the selected mark */
  function handlesEl(it, s, vp, idx) {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'hnd');
    function knob(v, mode, extra, turn) {
      const el = document.createElementNS(SVGNS, turn ? 'circle' : 'rect');
      if (turn) { el.setAttribute('cx', v[0]); el.setAttribute('cy', v[1]); el.setAttribute('r', 6); }
      else {
        el.setAttribute('x', v[0] - 5); el.setAttribute('y', v[1] - 5);
        el.setAttribute('width', 10); el.setAttribute('height', 10); el.setAttribute('rx', 2);
      }
      el.setAttribute('class', 'kn' + (turn ? ' turn' : ''));
      /* which cursor the grip wears: a point to drag, or a size to pull */
      el.dataset.cur = turn ? 'rotate' : (mode === 'pa' || mode === 'pb') ? 'point' : 'nwse';
      el.addEventListener('pointerdown', function (e) { beginDrag(it, idx, e, mode, extra); });
      g.appendChild(el);
      return el;
    }
    /* the turn grip sits off the top edge, along its outward normal */
    function turnGrip(p0, p1) {
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      let nx = p1[1] - p0[1], ny = -(p1[0] - p0[0]);
      const len = Math.hypot(nx, ny) || 1;
      nx = nx / len * 24; ny = ny / len * 24;
      const stem = document.createElementNS(SVGNS, 'line');
      stem.setAttribute('class', 'stem');
      stem.setAttribute('x1', mx); stem.setAttribute('y1', my);
      stem.setAttribute('x2', mx + nx); stem.setAttribute('y2', my + ny);
      g.appendChild(stem);
      knob([mx + nx, my + ny], 'turn', null, true);
    }

    /* A module mark says whether it grips like a box or like a chord; every
       mark here is two points either way, so the drag maths is already right. */
    const kind = EXT.handleKind[s.t] || s.t;

    if (kind === 'rect') {
      const q = rectCorners(s).map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); });
      const out = document.createElementNS(SVGNS, 'polygon');
      out.setAttribute('class', 'halo'); out.setAttribute('points', vpts(q));
      g.appendChild(out);
      /* each corner pulls along its own diagonal, as it sits on screen */
      const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
      q.forEach(function (v, i) {
        knob(v, 'corner', i).dataset.cur = (v[0] - cx) * (v[1] - cy) > 0 ? 'nwse' : 'nesw';
      });
      turnGrip(q[0], q[1]);
    } else if (kind === 'line' || kind === 'arrow' || kind === 'ends') {
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      const hl = document.createElementNS(SVGNS, 'line');
      hl.setAttribute('class', 'halo');
      hl.setAttribute('x1', a[0]); hl.setAttribute('y1', a[1]);
      hl.setAttribute('x2', b[0]); hl.setAttribute('y2', b[1]);
      g.appendChild(hl);
      knob(a, 'pa'); knob(b, 'pb');
      /* 'ends': two grips and nothing to turn — a radius or an angle is
         defined by where its points are, so rotating it means nothing */
      if (kind !== 'ends') turnGrip(a, b);
    } else if (s.t === 'text') {
      const q = textQuad(s, vp);
      knob(q[2], 'size');                       /* pull the far corner to resize the type */
      turnGrip(q[0], q[1]);
    }
    return g;
  }

  /* ---------------- pointer drawing ---------------- */
  /* Two fingers on the page always mean zoom and pan, never a mark. The second
     one to land throws away whatever the first had started — a ghost shape, a
     pin about to be dropped, a pin mid-drag — and nothing new begins until every
     finger is off again. Pins are placed on release, not on touch, so the first
     finger of a pinch can no longer leave one behind. */
  const capPointers = new Map();
  let capBlock = false, pinDragAbort = null, pendingPin = null;

  function cancelPageGesture() {
    pendingPin = null;
    if (pinDragAbort) { const f = pinDragAbort; pinDragAbort = null; f(); }
  }
  function releasePointer(id) {
    capPointers.delete(id);
    if (!capPointers.size) capBlock = false;
  }
  document.addEventListener('pointerup', function (e) { releasePointer(e.pointerId); }, true);
  document.addEventListener('pointercancel', function (e) { releasePointer(e.pointerId); }, true);

  function bindDraw(it) {
    let start = null, ghost = null;

    function pt(e) {
      const r = it.capture.getBoundingClientRect();
      return [e.clientX - r.left + it.off.left, e.clientY - r.top + it.off.top];
    }
    function dropGhost() {
      if (!start && !ghost) return;
      start = null; ghost = null;
      drawShapes(it);
    }

    it.capture.addEventListener('pointerdown', function (e) {
      capPointers.set(e.pointerId, 1);
      if (capPointers.size >= 2) {           /* a pinch, not a mark */
        capBlock = true;
        dropGhost();
        cancelPageGesture();
        const xc = EXT.tools[S.tool];
        if (xc && xc.cancel) xc.cancel(it);   /* throw away, do not commit */
        return;
      }
      if (capBlock) return;                  /* fingers left over from a pinch */
      if (S.tool === 'select' || !it.vp) return;

      const xt = EXT.tools[S.tool];
      if (xt && xt.down) { e.preventDefault(); xt.down(it, pt(e), e); return; }

      if (S.tool === 'pin') {
        e.preventDefault();
        const at = pt(e);
        const hit = pinAt(it, at);
        if (hit >= 0) { pinDrag(it, e, hit); return; }
        /* hold it until the finger lifts, in case a second one is on its way */
        pendingPin = { it: it, at: at, x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      if (S.tool === 'text') {
        e.preventDefault();
        pendingPin = { it: it, at: pt(e), x: e.clientX, y: e.clientY, id: e.pointerId, text: true };
        return;
      }
      e.preventDefault();
      try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* a mouse draws without it */ }
      const p = pt(e);
      start = it.vp.convertToPdfPoint(p[0], p[1]);
      /* object snap: start exactly on the point the marker shows */
      const s0 = S.tool !== 'crop' && EXT.snapPt ? EXT.snapPt(it, start, e) : null;
      if (s0) start = s0;
      ghost = {
        t: S.tool === 'crop' ? 'rect' : S.tool, a: start, b: start,
        c: S.tool === 'crop' ? '#F2C14E' : S.color,
        w: S.tool === 'crop' ? 1.2 / S.scale : S.width
      };
      drawShapes(it, ghost);
    });

    it.capture.addEventListener('pointermove', function (e) {
      /* the pinch guard has to come first: a module tool must not keep drawing
         while two fingers are zooming the page */
      const xtm = capBlock ? null : EXT.tools[S.tool];
      if (xtm && xtm.move) { xtm.move(it, pt(e), e); return; }
      if (pendingPin && pendingPin.id === e.pointerId) {
        /* a drag, not a tap: let it go so the page can be panned instead */
        if (Math.hypot(e.clientX - pendingPin.x, e.clientY - pendingPin.y) > 10) pendingPin = null;
      }
      if (!start || !ghost || capBlock) return;
      const p = pt(e);
      ghost.raw = it.vp.convertToPdfPoint(p[0], p[1]);
      /* a snap point wins over Shift, as object snap does over ortho in CAD */
      ghost.snap = S.tool !== 'crop' && EXT.snapPt ? EXT.snapPt(it, ghost.raw, e) : null;
      ghost.b = ghost.snap ? ghost.snap
        : (e.shiftKey && S.tool !== 'crop') ? constrainPt(ghost.t, ghost.a, ghost.raw) : ghost.raw;
      drawShapes(it, ghost);
    });

    function finish(e) {
      const xtu = capBlock ? null : EXT.tools[S.tool];
      if (xtu && xtu.up) { xtu.up(it, pt(e), e); return; }
      if (capBlock) {
        /* the gesture was abandoned when the second finger landed; it was
           already cancelled there, and calling up() here would commit it */
        return;
      }
      const pend = pendingPin;
      if (pend && pend.id === e.pointerId && pend.it === it && !capBlock) {
        pendingPin = null;
        if (pend.text) openEditor(it, pend.at, -1);
        else addPinAt(it, pend.at);
      }
      if (!start || !ghost) return;
      if (capBlock) { dropGhost(); return; }
      const g = ghost, shift = e && e.shiftKey;
      start = null; ghost = null;
      if (g.raw && S.tool !== 'crop') g.b = g.snap ? g.snap : shift ? constrainPt(g.t, g.a, g.raw) : g.raw;
      if (EXT.snapHide) EXT.snapHide();
      delete g.raw; delete g.snap;
      const dx = Math.abs(g.b[0] - g.a[0]), dy = Math.abs(g.b[1] - g.a[1]);
      if (S.tool === 'crop') {
        if (dx < 12 || dy < 12) { drawShapes(it); toast('Drag a larger area to crop'); return; }
        applyCrop(it, {
          x: Math.min(g.a[0], g.b[0]), y: Math.min(g.a[1], g.b[1]), w: dx, h: dy
        }, shift);
        return;
      }
      if (dx < 2 && dy < 2) { drawShapes(it); return; }
      snapshot();
      it.shapes.push({ t: g.t, a: g.a, b: g.b, c: g.c, w: g.w });
      drawShapes(it);
      updateMeta();
    }
    it.capture.addEventListener('pointerup', finish);
    it.capture.addEventListener('pointercancel', function () { dropGhost(); pendingPin = null; });
  }

  stage.addEventListener('click', function (e) {
    if (marqueeDone) { marqueeDone = false; return; }   /* the end of a box drag is not a click */
    if (S.tool === 'select' && S.sel && !e.target.closest('.anno')) {
      S.sel = null; S.multi = null;
      S.items.forEach(function (x) { drawShapes(x); });
      hideMarkPop();
    }
  });

  /* ---- picking several marks: Ctrl+click, a box drag, Ctrl+A ---- */

  /* which page and which mark a pointer event landed on, or null */
  function markUnder(target) {
    const anno = target && target.closest ? target.closest('.anno') : null;
    if (!anno) return null;
    const it = S.items.filter(function (x) { return x.anno === anno; })[0];
    if (!it) return null;
    let el = target;
    while (el && el.parentNode !== anno) el = el.parentNode;
    const i = el ? Array.prototype.indexOf.call(anno.children, el) : -1;
    if (i < 0 || i >= it.shapes.length || NOT_SELECTABLE[it.shapes[i].t]) return null;
    return { it: it, i: i };
  }

  /* Ctrl+click adds a mark to the selection, or takes it out. Capture phase,
     so it runs before the mark's own handler starts a drag. */
  stage.addEventListener('pointerdown', function (e) {
    if (S.tool !== 'select' || !(e.ctrlKey || e.metaKey) || e.button > 0) return;
    if (e.target.closest && e.target.closest('.kn')) return;
    const hit = markUnder(e.target);
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    const list = S.sel && S.sel.it === hit.it ? selList() : [];
    const at = list.indexOf(hit.i);
    if (at >= 0) list.splice(at, 1); else list.push(hit.i);
    setGroup(hit.it, list);
    redrawAll();
    if (S.sel) syncMarkPop(); else hideMarkPop();
    marqueeDone = true;                            /* swallow the click that follows */
  }, true);

  /* A box dragged over empty page selects every mark it touches. Starting on
     the page's own text still selects that text for copying, as before —
     unless Ctrl is held, which always draws the box. */
  let marquee = null, marqueeDone = false;
  const mqBox = document.createElement('div');
  mqBox.className = 'marquee'; mqBox.hidden = true;
  document.body.appendChild(mqBox);

  stage.addEventListener('pointerdown', function (e) {
    if (S.tool !== 'select' || e.button !== 0 || S.editing) return;
    marqueeDone = false;
    const t = e.target;
    const box = t.closest ? t.closest('.pagebox') : null;
    if (!box) return;
    if (t.closest('.anno') && markUnder(t)) return;          /* on a mark: that is a drag */
    if (t.closest('.kn, .texted, input, textarea, select, button, a')) return;
    if (!(e.ctrlKey || e.metaKey) && t.closest('.textLayer span')) return;
    const it = S.items.filter(function (x) { return x.box === box; })[0];
    if (!it || !it.anno) return;
    e.preventDefault();
    marquee = { it: it, x: e.clientX, y: e.clientY, add: e.ctrlKey || e.metaKey, id: e.pointerId };
  });
  document.addEventListener('pointermove', function (e) {
    if (!marquee || e.pointerId !== marquee.id) return;
    const x1 = Math.min(marquee.x, e.clientX), y1 = Math.min(marquee.y, e.clientY);
    const w = Math.abs(e.clientX - marquee.x), h = Math.abs(e.clientY - marquee.y);
    if (!marquee.live && w < 4 && h < 4) return;
    marquee.live = true;
    mqBox.hidden = false;
    mqBox.style.left = x1 + 'px'; mqBox.style.top = y1 + 'px';
    mqBox.style.width = w + 'px'; mqBox.style.height = h + 'px';
  });
  document.addEventListener('pointerup', function (e) {
    if (!marquee || e.pointerId !== marquee.id) return;
    const m = marquee; marquee = null;
    mqBox.hidden = true;
    if (!m.live) return;                                     /* a plain click: let it deselect */
    marqueeDone = true;
    const it = m.it, r = it.anno.getBoundingClientRect();
    const bx1 = Math.min(m.x, e.clientX) - r.left, by1 = Math.min(m.y, e.clientY) - r.top;
    const bx2 = Math.max(m.x, e.clientX) - r.left, by2 = Math.max(m.y, e.clientY) - r.top;
    const picked = m.add && S.sel && S.sel.it === it ? selList() : [];
    it.shapes.forEach(function (s, i) {
      if (NOT_SELECTABLE[s.t] || picked.indexOf(i) >= 0) return;
      const el = it.anno.children[i];
      if (!el || !el.getBBox) return;
      let b;
      try { b = el.getBBox(); } catch (err) { return; }
      /* touching is enough, as in Illustrator */
      if (b.x <= bx2 && b.x + b.width >= bx1 && b.y <= by2 && b.y + b.height >= by1) picked.push(i);
    });
    setGroup(it, picked);
    redrawAll();
    if (S.sel) {
      syncMarkPop();
      if (picked.length > 1) toast('<b>' + picked.length + ' marks</b> selected · drag one to move them all, <b>Delete</b> to remove');
    } else hideMarkPop();
  });
  document.addEventListener('pointercancel', function () { marquee = null; mqBox.hidden = true; });

  /* Ctrl+A with the Select tool: every mark on the page in view */
  document.addEventListener('keydown', function (e) {
    if (S.tool !== 'select' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
    if (e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) return;
    const it = S.items[S.current - 1];
    if (!it || !it.shapes.length) return;
    /* first, and alone: plain A is the Arrow tool's shortcut */
    e.preventDefault(); e.stopImmediatePropagation();
    setGroup(it, it.shapes.map(function (_, i) { return i; }));
    redrawAll();
    if (S.sel) syncMarkPop();
  }, true);
  /* the panel floats over the page, so it has to follow it */
  let mpTick = 0;
  function trackMarkPop() {
    if ($('markPop').hidden) return;
    if (mpTick) return;
    mpTick = requestAnimationFrame(function () { mpTick = 0; placeMarkPop(); });
  }
  stage.addEventListener('scroll', trackMarkPop, { passive: true });
  window.addEventListener('resize', trackMarkPop);

  function deleteSelected() {
    if (!S.sel) return false;
    snapshot();
    const it = S.sel.it;
    const list = selList().sort(function (a, b) { return b - a; });   /* from the end, so indexes hold */
    list.forEach(function (i) {
      const gone = it.shapes.splice(i, 1)[0];
      if (gone && gone.t === 'pin' && gone.id === pinSel) pinSel = null;
    });
    S.sel = null; S.multi = null;
    hideMarkPop();
    drawShapes(it); updateMeta(); renderPins();
    toast(list.length > 1 ? list.length + ' marks removed' : 'Mark removed');
    return true;
  }

  /* ---------------- photo pins (site photo locations) ---------------- */
  /* A pin is a shape {t:'pin', a:[x,y], id} so it moves, rotates, undoes and is
     removed together with its page. The location it points at — number, reference,
     photos — lives in S.locs, so undoing a delete brings the photos back too. */
  const PIN_R = 8;                 /* pin radius in PDF points */
  const PIN_COLOR = '#E03616';
  let pinSel = null;               /* id of the location open in the editor */
  let pinEdFor = null;             /* id the editor fields were last filled from */

  function uid() { return 'L' + Math.random().toString(36).slice(2, 9); }

  /* every pin in reading order: {it, idx, s, L, page} */
  function livePins() {
    const out = [];
    S.items.forEach(function (it, pi) {
      it.shapes.forEach(function (s, idx) {
        if (s.t === 'pin' && S.locs[s.id]) out.push({ it: it, idx: idx, s: s, L: S.locs[s.id], page: pi + 1 });
      });
    });
    return out;
  }
  function findPin(id) {
    const all = livePins();
    for (let i = 0; i < all.length; i++) if (all[i].s.id === id) return all[i];
    return null;
  }
  function nextNum() {
    let m = 0;
    livePins().forEach(function (p) { const v = parseInt(p.L.n, 10); if (!isNaN(v) && v > m) m = v; });
    return String(m + 1);
  }
  function pinRadius() { return Math.max(9, PIN_R * S.scale); }

  function pinEl(it, s, vp, idx) {
    const L = S.locs[s.id] || { n: '?', ref: '', photos: [] };
    const p = vp.convertToViewportPoint(s.a[0], s.a[1]);
    const r = pinRadius();
    const selected = idx >= 0 && S.sel && S.sel.it === it && S.sel.i === idx;
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'pin');
    if (selected || (idx >= 0 && pinSel === s.id)) {
      const ring = document.createElementNS(SVGNS, 'circle');
      ring.setAttribute('cx', p[0]); ring.setAttribute('cy', p[1]); ring.setAttribute('r', r + 6);
      ring.setAttribute('fill', 'rgba(59,130,246,.22)');
      ring.setAttribute('stroke', '#3B82F6'); ring.setAttribute('stroke-width', 2);
      g.appendChild(ring);
    }
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', r);
    c.setAttribute('fill', PIN_COLOR);
    c.setAttribute('stroke', '#FFFFFF'); c.setAttribute('stroke-width', Math.max(1.5, r * 0.18));
    g.appendChild(c);
    const label = String(L.n == null ? '' : L.n);
    const t = document.createElementNS(SVGNS, 'text');
    const fs = r * (label.length <= 2 ? 1.05 : 2.1 / label.length);
    t.setAttribute('x', p[0]); t.setAttribute('y', p[1] + fs * 0.36);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', fs);
    t.setAttribute('font-weight', '700');
    t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
    t.setAttribute('fill', '#FFFFFF');
    t.textContent = label;
    g.appendChild(t);
    if (idx >= 0) {
      const tip = document.createElementNS(SVGNS, 'title');
      tip.textContent = (L.ref || 'Location ' + label) + ' — ' + L.photos.length + ' photo(s)';
      g.appendChild(tip);
      g.addEventListener('click', function (e) {
        if (S.tool !== 'select') return;
        e.stopPropagation();
        selectPin(it, idx);
        if (L.photos.length) openLb(s.id, 0);
        else { showPinPanel(); toast('No photos on this pin yet · <b>Add photos</b> in the panel'); }
      });
    }
    return g;
  }

  function redrawAll() { S.items.forEach(function (x) { drawShapes(x); }); }

  function selectPin(it, idx) {
    const s = it.shapes[idx];
    S.sel = { it: it, i: idx };
    pinSel = s ? s.id : null;
    redrawAll(); renderPins();
  }

  /* bring the pin panel forward, ready for the reference to be typed */
  function showPinPanel(focusRef) {
    setRail(true);
    switchTab('pins');
    if (focusRef && pinSel && !isMobile()) {
      setTimeout(function () {
        const f = $('pe_ref');
        if (f && !$('pinEd').hidden) f.focus();
      }, 30);
    }
  }

  /* pin tool: press on a pin to drag it, tap it to edit, tap blank paper to add one */
  function pinAt(it, at) {
    const r = pinRadius() + 4;
    for (let i = it.shapes.length - 1; i >= 0; i--) {
      const s = it.shapes[i];
      if (s.t !== 'pin') continue;
      const q = it.vp.convertToViewportPoint(s.a[0], s.a[1]);
      if (Math.hypot(q[0] - at[0], q[1] - at[1]) <= r) return i;
    }
    return -1;
  }

  function addPinAt(it, at) {
    snapshot();
    const L = { id: uid(), n: nextNum(), ref: '', desc: '', boq: '', note: '', photos: [] };
    S.locs[L.id] = L;
    const vx = Math.max(0, Math.min(it.vp.width, at[0]));
    const vy = Math.max(0, Math.min(it.vp.height, at[1]));
    it.shapes.push({ t: 'pin', a: it.vp.convertToPdfPoint(vx, vy), id: L.id });
    /* one pin per Add pin: the tool lets go, so a stray tap cannot drop another */
    setTool('select');
    selectPin(it, it.shapes.length - 1);
    updateMeta();
    showPinPanel(true);
    toast('Pin <b>' + esc(L.n) + '</b> added · fill in the reference and add photos · <b>+ Add pin</b> for the next one');
  }

  /* dragging a pin that is already there — a second finger abandons the move */
  function pinDrag(it, e, hit) {
    const cap = it.capture, s0 = it.shapes[hit];
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, dead = false;
    try { cap.setPointerCapture(e.pointerId); } catch (err) { /* mouse works without it */ }
    function move(ev) {
      if (dead || capBlock) return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) { moved = true; snapshot(); }
      const rc = cap.getBoundingClientRect();
      const vx = Math.max(0, Math.min(it.vp.width, ev.clientX - rc.left + it.off.left));
      const vy = Math.max(0, Math.min(it.vp.height, ev.clientY - rc.top + it.off.top));
      it.shapes[hit] = Object.assign({}, s0, { a: it.vp.convertToPdfPoint(vx, vy) });
      drawShapes(it);
    }
    function detach() {
      cap.removeEventListener('pointermove', move);
      cap.removeEventListener('pointerup', up);
      cap.removeEventListener('pointercancel', up);
      pinDragAbort = null;
    }
    function up() {
      detach();
      if (dead) return;
      selectPin(it, hit);
      if (moved) { updateMeta(); toast('Pin moved'); }
      else showPinPanel(true);
    }
    pinDragAbort = function () {
      dead = true;
      if (moved) { it.shapes[hit] = s0; drawShapes(it); }   /* put it back */
      detach();
    };
    cap.addEventListener('pointermove', move);
    cap.addEventListener('pointerup', up);
    cap.addEventListener('pointercancel', up);
  }

  function deletePin(id) {
    const p = findPin(id);
    if (!p) return;
    snapshot();
    p.it.shapes.splice(p.idx, 1);
    if (S.sel && S.sel.it === p.it) S.sel = null;
    if (pinSel === id) pinSel = null;
    drawShapes(p.it); updateMeta(); renderPins();
    toast('Pin removed · <b>Ctrl+Z</b> to undo');
  }

  /* sidebar list + editor */
  function renderPins() {
    const list = $('pinList');
    if (!list) return;
    const pins = livePins();
    const np = pins.reduce(function (a, p) { return a + p.L.photos.length; }, 0);
    $('pinCount').textContent = pins.length
      ? pins.length + (pins.length === 1 ? ' location' : ' locations') + ' · ' + np + (np === 1 ? ' photo' : ' photos')
      : '';
    if (!viewerBusy) $('pinExpGo').disabled = !pins.length;
    if (!pins.length) {
      list.innerHTML = '<div class="pinempty">No pins yet. Choose <b>+ Add pin</b> (or press <b>M</b>) ' +
        'and click the spot on a drawing, then attach site photos to it.<br><br>' +
        'Have a Site Photo project? <b>Load…</b> opens its .json or viewer .html and places its pins on the current page.</div>';
    } else {
      list.innerHTML = pins.map(function (p) {
        const sub = [p.L.desc, p.L.boq ? 'BOQ ' + p.L.boq : '', 'p.' + p.page].filter(Boolean).join(' · ');
        return '<button class="loc' + (p.s.id === pinSel ? ' on' : '') + '" data-id="' + esc(p.s.id) + '">' +
          '<span class="num">' + esc(p.L.n) + '</span>' +
          '<span class="txt"><span class="ref">' + esc(p.L.ref || '(no reference)') + '</span>' +
          '<span class="sub">' + esc(sub) + '</span></span>' +
          '<span class="cnt">' + p.L.photos.length + '</span></button>';
      }).join('');
    }
    fillPinEditor();
  }

  function fillPinEditor() {
    const ed = $('pinEd');
    const p = pinSel ? findPin(pinSel) : null;
    $('pe_del').disabled = !p;
    if (!p) { ed.hidden = true; return; }
    ed.hidden = false;
    const L = p.L, same = pinEdFor === L.id;
    pinEdFor = L.id;
    [['pe_n', 'n'], ['pe_ref', 'ref'], ['pe_desc', 'desc'], ['pe_boq', 'boq'], ['pe_note', 'note']]
      .forEach(function (f) {
        /* leave a field alone while it is being typed in for this same pin */
        if (!same || document.activeElement !== $(f[0])) $(f[0]).value = L[f[1]] || '';
      });
    const g = $('pe_ph');
    if (!L.photos.length) {
      g.innerHTML = '<div class="pinempty" style="grid-column:1/-1;padding:2px">No photos yet.</div>';
    } else {
      g.innerHTML = L.photos.map(function (ph, k) {
        return '<figure data-k="' + k + '"><img src="' + esc(ph.src) + '" alt="' + esc(ph.cap || '') + '" title="' +
          esc(ph.cap || '') + '" data-a="view"><div class="ops">' +
          '<span data-a="l" title="Move left">&#8249;</span><span data-a="r" title="Move right">&#8250;</span>' +
          '<span data-a="mark" title="Mark up / measure this photo">&#9998;</span>' +
          '<span data-a="rep" title="Replace">&#8635;</span>' +
          '<span class="del" data-a="del" title="Remove">&times;</span></div></figure>';
      }).join('');
    }
  }

  $('pinList').addEventListener('click', function (e) {
    const b = e.target.closest('.loc'); if (!b) return;
    const p = findPin(b.dataset.id); if (!p) return;
    selectPin(p.it, p.idx);
    goTo(p.page);
  });

  [['pe_n', 'n'], ['pe_ref', 'ref'], ['pe_desc', 'desc'], ['pe_boq', 'boq'], ['pe_note', 'note']]
    .forEach(function (f) {
      $(f[0]).addEventListener('input', function () {
        const p = pinSel ? findPin(pinSel) : null; if (!p) return;
        p.L[f[1]] = this.value;
        if (f[1] === 'n') drawShapes(p.it);
        const row = $('pinList').querySelector('.loc.on');
        if (row) {
          row.querySelector('.num').textContent = p.L.n;
          row.querySelector('.ref').textContent = p.L.ref || '(no reference)';
          row.querySelector('.sub').textContent =
            [p.L.desc, p.L.boq ? 'BOQ ' + p.L.boq : '', 'p.' + p.page].filter(Boolean).join(' · ');
        }
      });
      $(f[0]).addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') this.blur();
      });
    });

  let replaceIdx = -1;
  $('pe_ph').addEventListener('click', function (e) {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const fig = t.closest('figure'); if (!fig) return;
    const p = pinSel ? findPin(pinSel) : null; if (!p) return;
    const k = +fig.dataset.k, ph = p.L.photos, a = t.dataset.a;
    if (a === 'view') { openLb(p.s.id, k); return; }
    if (a === 'mark') { openPm(p.L, k); return; }
    if (a === 'rep') { replaceIdx = k; $('pinOneIn').click(); return; }
    if (a === 'del') ph.splice(k, 1);
    else if (a === 'l' && k > 0) ph.splice(k - 1, 0, ph.splice(k, 1)[0]);
    else if (a === 'r' && k < ph.length - 1) ph.splice(k + 1, 0, ph.splice(k, 1)[0]);
    else return;
    drawShapes(p.it); renderPins();
  });

  /* paint(ctx, w, h) draws on the photo before it is encoded — the camera
     stamp uses it, so the date is part of the picture itself */
  function shrink(file, max, q, paint) {
    return new Promise(function (res, rej) {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        let w = im.naturalWidth, h = im.naturalHeight;
        const k = Math.min(1, max / Math.max(w, h));
        w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h);
        g.drawImage(im, 0, 0, w, h);
        if (paint) paint(g, w, h);
        URL.revokeObjectURL(u);
        res({ src: c.toDataURL('image/jpeg', q), cap: (file.name || '').replace(/\.[^.]+$/, '') });
      };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Could not read ' + file.name)); };
      im.src = u;
    });
  }

  /* stamp: true for shots from the device camera app, which get the same
     date and text as the live camera — stamped with when the file was made */
  async function addPhotoFiles(files, stamp) {
    const p = pinSel ? findPin(pinSel) : null; if (!p || !files.length) return;
    toast('Adding ' + files.length + ' photo(s)…');
    let ok = 0;
    for (const f of files) {
      const when = new Date(f.lastModified || Date.now());
      const lines = stamp ? stampLines(p, when) : [];
      try {
        const ph = await shrink(f, 1500, 0.72, lines.length ? function (g, w, h) { paintStamp(g, w, h, lines); } : null);
        if (stamp) ph.cap = camStamp(when);
        p.L.photos.push(ph); ok++;
      }
      catch (err) { toast(esc(err.message)); }
    }
    drawShapes(p.it); renderPins(); updateMeta();
    toast('<b>' + ok + '</b> photo(s) added to pin ' + esc(p.L.n));
  }

  $('pe_add').addEventListener('click', function () { if (pinSel) $('pinPhotoIn').click(); });
  $('pinPhotoIn').addEventListener('change', function (e) {
    const files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
    addPhotoFiles(files);
  });
  $('pinCamIn').addEventListener('change', function (e) {
    const files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
    addPhotoFiles(files, true);
  });
  $('pinOneIn').addEventListener('change', async function (e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    const p = pinSel ? findPin(pinSel) : null;
    if (!f || !p || replaceIdx < 0) return;
    try { p.L.photos[replaceIdx] = await shrink(f, 1500, 0.72); renderPins(); toast('Photo replaced'); }
    catch (err) { toast(esc(err.message)); }
    replaceIdx = -1;
  });
  const UNIT_END = /[a-z°"']$/i;   /* a size that already names its own unit
                                         is left exactly as typed */
  /* ---- marking up a site photo ----
     Marks are kept in 0..1 coordinates across the photo, so one set of numbers
     draws correctly in the editor, on the thumbnail and at full resolution when
     the photo is flattened. The picture and its canvas are sized here in JS to
     exactly the fitted photo: left to CSS, a portrait photo came out taller
     than its canvas, the marks were stretched to fit, and every mark moved
     when it was saved.
     The flattened image goes in ph.src, which is what the PDF, the viewer and
     the lightbox read. The clean photo and the marks stay in ph.orig/ph.marks,
     so the marks can be picked up and changed again later. */
  const PM = { ph: null, loc: null, k: -1, marks: [], tool: 'dim', color: '#E2483D',
               img: null, src: '', draw: null, pending: null,
               /* Select tool: which mark is picked up, and what the drag is
                  doing to it. editIdx is set while the value box is retyping
                  an existing mark rather than naming a new one. */
               sel: -1, grab: null, editIdx: -1,
               /* every change to the marks or the photo, so it can be undone */
               undo: [], redo: [], dirty: false,
               crop: null };
  const PM_LINE = { dim: 1, arrow: 1, line: 1 };   /* two ends and a turn grip */
  const PM_BOX = { rect: 1, ellipse: 1 };          /* four corner grips */

  function loadImg(src) {
    return new Promise(function (res, rej) {
      const im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('That photo could not be read')); };
      im.src = src;
    });
  }
  function headPts(ax, ay, bx, by, size) {
    const a = Math.atan2(by - ay, bx - ax), w = 0.42;
    return [[bx - size * Math.cos(a - w), by - size * Math.sin(a - w)],
            [bx - size * Math.cos(a + w), by - size * Math.sin(a + w)]];
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);         ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function pmClone(m) {
    const o = Object.assign({}, m, { a: m.a.slice(), b: m.b ? m.b.slice() : null });
    if (m.p) o.p = m.p.map(function (q) { return q.slice(); });
    return o;
  }
  /* run every point of a mark through f — moving, turning and cropping all do this */
  function pmMapMark(m, f) {
    const o = pmClone(m);
    o.a = f(o.a);
    if (o.b) o.b = f(o.b);
    if (o.p) o.p = o.p.map(f);
    return o;
  }
  function pmBounds(m) {
    const pts = m.p ? m.p : (m.b ? [m.a, m.b] : [m.a]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (q) {
      x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]);
      x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
    });
    return [x0, y0, x1, y1];
  }

  /* Line width and lettering are fractions of the photo, never fixed pixels,
     so the editor, the thumbnail and the full-size copy all look the same. */
  function pmLw(m, base) { return Math.max(base / 1400, (m.w || 3) * base / 1000); }
  function pmLabelBox(ctx, m, W, H) {
    const label = m.v || '';
    if (!label) return null;
    const base = Math.max(W, H), lw = pmLw(m, base);
    const fs = Math.max(base * 0.011, lw * 4.6);
    ctx.font = '700 ' + fs.toFixed(1) + 'px ' + CSS_FONT.helv;
    const tw = ctx.measureText(label).width;
    const pad = fs * 0.42, bw = tw + pad * 2, bh = fs + pad * 1.1;
    const ax = m.a[0] * W, ay = m.a[1] * H;
    const bx = m.b ? m.b[0] * W : ax, by = m.b ? m.b[1] * H : ay;
    return { cx: m.t === 'text' ? ax + bw / 2 : (ax + bx) / 2,
             cy: m.t === 'text' ? ay : (ay + by) / 2,
             w: bw, h: bh, fs: fs, lw: lw, label: label };
  }

  /* draws one set of marks onto any canvas at any size */
  function pmPaint(ctx, marks, W, H) {
    const base = Math.max(W, H);
    marks.forEach(function (m) {
      const lw = pmLw(m, base);
      const ax = m.a[0] * W, ay = m.a[1] * H;
      const bx = m.b ? m.b[0] * W : ax, by = m.b ? m.b[1] * H : ay;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = m.c; ctx.fillStyle = m.c; ctx.lineWidth = lw;

      if (PM_LINE[m.t]) {
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        if (m.t !== 'line') {
          const hs = lw * 4.5;
          const hb = headPts(ax, ay, bx, by, hs);
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hb[0][0], hb[0][1]); ctx.lineTo(hb[1][0], hb[1][1]);
          ctx.closePath(); ctx.fill();
        }
        if (m.t === 'dim') {
          const ha = headPts(bx, by, ax, ay, lw * 4.5);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ha[0][0], ha[0][1]); ctx.lineTo(ha[1][0], ha[1][1]);
          ctx.closePath(); ctx.fill();
          /* witness ticks square to the run, the way a drawing marks an extent */
          const an = Math.atan2(by - ay, bx - ax);
          const tx = Math.sin(an) * lw * 3.2, ty = -Math.cos(an) * lw * 3.2;
          ctx.beginPath();
          ctx.moveTo(ax - tx, ay - ty); ctx.lineTo(ax + tx, ay + ty);
          ctx.moveTo(bx - tx, by - ty); ctx.lineTo(bx + tx, by + ty);
          ctx.stroke();
        }
      } else if (m.t === 'rect') {
        ctx.lineJoin = 'miter';
        ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      } else if (m.t === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse((ax + bx) / 2, (ay + by) / 2,
                    Math.max(0.5, Math.abs(bx - ax) / 2), Math.max(0.5, Math.abs(by - ay) / 2),
                    0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (m.t === 'pen' && m.p && m.p.length > 1) {
        /* through the midpoints, so a quick scribble still comes out smooth */
        const P = m.p;
        ctx.beginPath();
        ctx.moveTo(P[0][0] * W, P[0][1] * H);
        for (let i = 1; i < P.length - 1; i++) {
          const x = P[i][0] * W, y = P[i][1] * H;
          ctx.quadraticCurveTo(x, y, (x + P[i + 1][0] * W) / 2, (y + P[i + 1][1] * H) / 2);
        }
        ctx.lineTo(P[P.length - 1][0] * W, P[P.length - 1][1] * H);
        ctx.stroke();
      }

      const box = pmLabelBox(ctx, m, W, H);
      if (box) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h, box.fs * 0.28);
        ctx.fill();
        const ink = /^#fff(fff)?$/i.test(m.c) ? '#1C1F24' : m.c;   /* white on white reads as nothing */
        ctx.lineWidth = Math.max(1, lw * 0.5); ctx.strokeStyle = ink; ctx.stroke();
        ctx.fillStyle = ink;
        ctx.fillText(box.label, box.cx, box.cy + box.fs * 0.04);
      }
      ctx.restore();
    });
  }

  /* the canvas's own pixels, and how many of them one screen pixel covers at
     the current zoom — grips and tolerances stay the same size on screen */
  function pmSpace() {
    const cv = $('pmcv'), r = cv.getBoundingClientRect();
    return { W: cv.width || 1, H: cv.height || 1, s: (cv.width || 1) / (r.width || 1) };
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* Which mark is under the pointer. Outlines and labels are tried first, so a
     mark drawn inside a box can still be picked; the inside of a box or circle
     counts only when nothing else is hit. Generous, because a fingertip is not
     precise. */
  function pmHit(p) {
    const sp = pmSpace(), W = sp.W, H = sp.H, tol = 14 * sp.s;
    const ctx = $('pmcv').getContext('2d');
    const px = p[0] * W, py = p[1] * H;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = PM.marks.length - 1; i >= 0; i--) {
        const m = PM.marks[i];
        const ax = m.a[0] * W, ay = m.a[1] * H;
        const bx = m.b ? m.b[0] * W : ax, by = m.b ? m.b[1] * H : ay;
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
        const rx = Math.max(1, (x1 - x0) / 2), ry = Math.max(1, (y1 - y0) / 2);
        const d = Math.hypot((px - (x0 + rx)) / rx, (py - (y0 + ry)) / ry);
        if (pass === 1) {
          if (m.t === 'rect' && px > x0 && px < x1 && py > y0 && py < y1) return i;
          if (m.t === 'ellipse' && d < 1) return i;
          continue;
        }
        const box = pmLabelBox(ctx, m, W, H);
        if (box && Math.abs(px - box.cx) <= box.w / 2 + tol / 2 &&
                   Math.abs(py - box.cy) <= box.h / 2 + tol / 2) return i;
        if (m.t === 'text' && Math.hypot(px - ax, py - ay) < tol * 2) return i;
        if (PM_LINE[m.t] && segDist(px, py, ax, ay, bx, by) < tol) return i;
        if (m.t === 'rect' && px > x0 - tol && px < x1 + tol && py > y0 - tol && py < y1 + tol &&
            (Math.abs(px - x0) < tol || Math.abs(px - x1) < tol ||
             Math.abs(py - y0) < tol || Math.abs(py - y1) < tol)) return i;
        if (m.t === 'ellipse' && Math.abs(d - 1) * Math.min(rx, ry) < tol) return i;
        if (m.t === 'pen' && m.p) {
          for (let k = 1; k < m.p.length; k++) {
            if (segDist(px, py, m.p[k - 1][0] * W, m.p[k - 1][1] * H, m.p[k][0] * W, m.p[k][1] * H) < tol) return i;
          }
        }
      }
    }
    return -1;
  }

  /* The turn grip sits off the middle of a line, along its normal. */
  function pmRotPoint(m, sp) {
    const mx = (m.a[0] + m.b[0]) / 2, my = (m.a[1] + m.b[1]) / 2;
    const dx = (m.b[0] - m.a[0]) * sp.W, dy = (m.b[1] - m.a[1]) * sp.H;
    const len = Math.hypot(dx, dy) || 1, off = 30 * sp.s;
    return [mx + (dy / len) * off / sp.W, my - (dx / len) * off / sp.H];
  }
  /* The grips on a picked-up mark. A corner's id says which end gives its x
     and which its y: 'ba' is b's x with a's y. */
  function pmGrips(m, sp) {
    if (PM_LINE[m.t]) {
      const rp = pmRotPoint(m, sp);
      return [{ id: 'a', x: m.a[0], y: m.a[1] }, { id: 'b', x: m.b[0], y: m.b[1] },
              { id: 'rot', x: rp[0], y: rp[1], round: true }];
    }
    if (PM_BOX[m.t]) {
      return [{ id: 'aa', x: m.a[0], y: m.a[1] }, { id: 'bb', x: m.b[0], y: m.b[1] },
              { id: 'ba', x: m.b[0], y: m.a[1] }, { id: 'ab', x: m.a[0], y: m.b[1] }];
    }
    return [];
  }
  function pmGrip(p) {
    const m = PM.marks[PM.sel];
    if (!m) return null;
    const sp = pmSpace();
    const g = pmGrips(m, sp).filter(function (q) {
      return Math.hypot((p[0] - q.x) * sp.W, (p[1] - q.y) * sp.H) < 16 * sp.s;
    });
    return g.length ? g[0].id : null;
  }

  /* Grips for the picked-up mark, drawn over the marks themselves. */
  function pmHandles(ctx, W, H) {
    if (PM.tool !== 'select' || PM.sel < 0) return;
    const m = PM.marks[PM.sel];
    if (!m) return;
    const sp = pmSpace(), k = sp.s;
    ctx.save();
    ctx.setLineDash([6 * k, 4 * k]);
    ctx.lineWidth = 1.5 * k;
    ctx.strokeStyle = '#1F6FEB';
    if (PM_LINE[m.t]) {
      const rp = pmRotPoint(m, sp);
      ctx.beginPath();
      ctx.moveTo(m.a[0] * W, m.a[1] * H); ctx.lineTo(m.b[0] * W, m.b[1] * H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(((m.a[0] + m.b[0]) / 2) * W, ((m.a[1] + m.b[1]) / 2) * H);
      ctx.lineTo(rp[0] * W, rp[1] * H);
      ctx.stroke();
    } else {
      let bb = pmBounds(m);
      let x0 = bb[0] * W, y0 = bb[1] * H, x1 = bb[2] * W, y1 = bb[3] * H;
      const box = pmLabelBox(ctx, m, W, H);
      if (box) {
        x0 = Math.min(x0, box.cx - box.w / 2); x1 = Math.max(x1, box.cx + box.w / 2);
        y0 = Math.min(y0, box.cy - box.h / 2); y1 = Math.max(y1, box.cy + box.h / 2);
      }
      const pad = PM_BOX[m.t] ? 0 : 6 * k;
      ctx.strokeRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
    }
    ctx.restore();
    pmGrips(m, sp).forEach(function (q) {
      const x = q.x * W, y = q.y * H, sz = 7 * k;
      ctx.beginPath();
      if (q.round) ctx.arc(x, y, sz, 0, Math.PI * 2);
      else ctx.rect(x - sz, y - sz, sz * 2, sz * 2);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.lineWidth = 2 * k; ctx.strokeStyle = '#1F6FEB'; ctx.stroke();
    });
  }

  /* the box being dragged out with Crop: dim everything that will go */
  function pmCropRect() {
    const c = PM.crop;
    if (!c) return null;
    return [Math.min(c.a[0], c.b[0]), Math.min(c.a[1], c.b[1]),
            Math.max(c.a[0], c.b[0]), Math.max(c.a[1], c.b[1])];
  }
  function pmCropPaint(ctx, W, H) {
    const r = pmCropRect();
    if (!r) return;
    const k = pmSpace().s;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(r[0] * W, r[1] * H, (r[2] - r[0]) * W, (r[3] - r[1]) * H);
    ctx.fill('evenodd');
    ctx.setLineDash([6 * k, 4 * k]);
    ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#FFFFFF';
    ctx.strokeRect(r[0] * W, r[1] * H, (r[2] - r[0]) * W, (r[3] - r[1]) * H);
    ctx.restore();
  }

  /* size the picture to fit the stage exactly; the canvas fills the same box */
  function pmFit() {
    const st = $('pmstage'), im = PM.img;
    if (!im) return;
    const cs = getComputedStyle(st);
    const aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const k = Math.min(aw / im.naturalWidth, ah / im.naturalHeight);
    const wrap = $('pmwrap');
    wrap.style.width = Math.max(1, Math.floor(im.naturalWidth * k)) + 'px';
    wrap.style.height = Math.max(1, Math.floor(im.naturalHeight * k)) + 'px';
  }

  function pmRender() {
    const cv = $('pmcv');
    if (!PM.img) return;
    /* the untransformed size: zooming must not keep growing the backing store */
    const w = $('pmwrap').offsetWidth, h = $('pmwrap').offsetHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const list = PM.draw ? PM.marks.concat([PM.draw]) : PM.marks;
    pmPaint(ctx, list, cv.width, cv.height);
    pmHandles(ctx, cv.width, cv.height);
    pmCropPaint(ctx, cv.width, cv.height);
  }

  /* burn the marks into a fresh JPEG at the photo's own resolution */
  function pmFlatten(img, marks, q) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    pmPaint(ctx, marks, c.width, c.height);
    const out = c.toDataURL('image/jpeg', q == null ? 0.82 : q);
    c.width = c.height = 1;
    return out;
  }

  /* ---- undo and redo ----
     A step holds the marks and the photo they sit on, so turning and cropping
     undo just like marks do. The photo is a string, so keeping it costs a
     reference, not a copy. */
  function pmState() { return { marks: PM.marks.map(pmClone), src: PM.src }; }
  function pmPush() {
    PM.undo.push(pmState());
    if (PM.undo.length > 100) PM.undo.shift();
    PM.redo = [];
    PM.dirty = true;
    pmSyncBtns();
  }
  async function pmRestore(st) {
    PM.marks = st.marks.map(pmClone);
    PM.sel = -1; PM.grab = null; PM.draw = null;
    pmCropCancel();
    if (st.src !== PM.src) await pmSetImage(st.src, true);
    pmSyncSel(); pmSyncBtns(); pmRender();
  }
  function pmUndo() {
    if (PM.pending) commitVal(false);
    if (!PM.undo.length) return;
    PM.redo.push(pmState());
    PM.dirty = true;
    pmRestore(PM.undo.pop());
  }
  function pmRedo() {
    if (PM.pending) commitVal(false);
    if (!PM.redo.length) return;
    PM.undo.push(pmState());
    PM.dirty = true;
    pmRestore(PM.redo.pop());
  }
  function pmSyncBtns() {
    $('pmUndo').disabled = !PM.undo.length;
    $('pmRedo').disabled = !PM.redo.length;
    $('pmClear').disabled = !PM.marks.length;
  }

  /* Picking a mark up shows its colour and size, and changing either while it
     is picked up changes the mark. */
  function pmSyncSel() {
    const m = PM.tool === 'select' ? PM.marks[PM.sel] : null;
    $('pmEdit').disabled = !(m && (m.t === 'dim' || m.t === 'text'));
    $('pmDel').disabled = !m;
    $('pmDup').disabled = !m;
    if (m) {
      $('pmSize').value = +(m.w || 3).toFixed(1);
      Array.prototype.forEach.call($('pmswatch').children, function (x) {
        x.classList.toggle('on', x.dataset.c.toLowerCase() === String(m.c).toLowerCase());
      });
    }
    pmSyncBtns();
  }

  /* Retype the selected mark in place, rather than adding another. */
  function pmEditSel() {
    const m = PM.marks[PM.sel];
    if (!m || (m.t !== 'dim' && m.t !== 'text')) return;
    PM.editIdx = PM.sel;
    askVal(m);
    const box = $('pmval');
    box.value = m.v || '';
    box.select();
  }
  function pmDeleteSel() {
    if (!PM.marks[PM.sel]) return;
    pmPush();
    PM.marks.splice(PM.sel, 1);
    PM.sel = -1; PM.grab = null;
    pmSyncSel(); pmRender();
  }
  /* a copy a little down and to the right, picked up ready to drag */
  function pmDupSel() {
    const m = PM.marks[PM.sel];
    if (!m) return;
    pmPush();
    const bb = pmBounds(m), sp = pmSpace();
    const dx = Math.min(24 * sp.s / sp.W, 1 - bb[2]), dy = Math.min(24 * sp.s / sp.H, 1 - bb[3]);
    PM.marks.push(pmMapMark(m, function (q) { return [q[0] + dx, q[1] + dy]; }));
    PM.sel = PM.marks.length - 1;
    pmSyncSel(); pmRender();
  }
  function pmNudge(dx, dy) {
    const m = PM.marks[PM.sel];
    if (!m) return;
    if (!PM.grab || PM.grab.mode !== 'nudge') { pmPush(); PM.grab = { mode: 'nudge' }; }
    const bb = pmBounds(m);
    dx = Math.max(Math.min(-bb[0], 0), Math.min(Math.max(1 - bb[2], 0), dx));
    dy = Math.max(Math.min(-bb[1], 0), Math.min(Math.max(1 - bb[3], 0), dy));
    PM.marks[PM.sel] = pmMapMark(m, function (q) { return [q[0] + dx, q[1] + dy]; });
    pmRender();
  }

  /* ---- turning and cropping the photo ----
     Both make a new clean photo and carry the marks across with it, so
     nothing already marked moves off the thing it was marking. */
  async function pmSetImage(src, keepView) {
    let im;
    try { im = await loadImg(src); }
    catch (err) { toast(esc(err.message)); return false; }
    PM.img = im; PM.src = src;
    $('pmimg').src = src;
    pmFit();
    if (!keepView || PV.k === 1) pvReset(); else { pvClamp(); pvApply(); }
    pmRender();
    return true;
  }
  async function pmRotate(dir) {             /* 1 turns clockwise, -1 back */
    if (!PM.img) return;
    if (PM.pending) commitVal(true);
    pmCropCancel();
    pmPush();
    const nw = PM.img.naturalWidth, nh = PM.img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = nh; c.height = nw;
    const ctx = c.getContext('2d');
    ctx.translate(dir > 0 ? nh : 0, dir > 0 ? 0 : nw);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(PM.img, 0, 0);
    const src = c.toDataURL('image/jpeg', 0.92);
    c.width = c.height = 1;
    PM.marks = PM.marks.map(function (m) {
      return pmMapMark(m, dir > 0 ? function (q) { return [1 - q[1], q[0]]; }
                                  : function (q) { return [q[1], 1 - q[0]]; });
    });
    PM.sel = -1; pmSyncSel();
    await pmSetImage(src);
  }
  function pmCropCancel() {
    PM.crop = null;
    const bar = $('pmcrop');
    if (bar) bar.hidden = true;
  }
  async function pmApplyCrop() {
    const r = pmCropRect();
    pmCropCancel();
    if (!r || !PM.img) { pmRender(); return; }
    const nw = PM.img.naturalWidth, nh = PM.img.naturalHeight;
    const x0 = Math.floor(r[0] * nw), y0 = Math.floor(r[1] * nh);
    const w = Math.ceil(r[2] * nw) - x0, h = Math.ceil(r[3] * nh) - y0;
    if (w < 24 || h < 24) { toast('That crop is too small'); pmRender(); return; }
    pmPush();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(PM.img, x0, y0, w, h, 0, 0, w, h);
    const src = c.toDataURL('image/jpeg', 0.92);
    c.width = c.height = 1;
    const fx = x0 / nw, fy = y0 / nh, fw = w / nw, fh = h / nh;
    /* widths are a fraction of the photo, which just got smaller */
    const grow = Math.max(nw, nh) / Math.max(w, h);
    PM.marks = PM.marks.filter(function (m) {
      const bb = pmBounds(m);
      return bb[2] >= fx && bb[0] <= fx + fw && bb[3] >= fy && bb[1] <= fy + fh;
    }).map(function (m) {
      const o = pmMapMark(m, function (q) { return [(q[0] - fx) / fw, (q[1] - fy) / fh]; });
      o.w = +((m.w || 3) * grow).toFixed(2);
      return o;
    });
    PM.sel = -1; pmSyncSel();
    await pmSetImage(src);
    toast('Photo cropped · <b>Undo</b> brings it back');
  }

  /* ---- moving and zooming the photo while marking it ----
     Two fingers always mean zoom and pan, never a mark: the moment a second
     finger lands, any half-drawn mark is dropped and nothing new can start
     until every finger is off again. One finger draws, or pans with the Pan
     tool. The wrap carries a CSS transform, so the canvas keeps its own
     resolution and marks stay in 0..1 photo coordinates either way. */
  const PV = { k: 1, tx: 0, ty: 0 };
  const pvPointers = new Map();
  let pvGesture = null;      /* live two-finger pinch */
  let pvPan = null;          /* one-finger drag with the Pan tool */
  let pvBlock = false;       /* fingers still down after a pinch */

  function pvApply() {
    $('pmwrap').style.transform =
      'translate(' + PV.tx.toFixed(2) + 'px,' + PV.ty.toFixed(2) + 'px) scale(' + PV.k.toFixed(4) + ')';
    $('pmLvl').textContent = Math.round(PV.k * 100) + '%';
  }
  function pvReset() {
    PV.k = 1; PV.tx = 0; PV.ty = 0;
    pvApply();
  }
  /* the wrap's position with no transform on it */
  function pvLayout() {
    const r = $('pmwrap').getBoundingClientRect();
    return { left: r.left - PV.tx, top: r.top - PV.ty,
             w: $('pmwrap').offsetWidth || 1, h: $('pmwrap').offsetHeight || 1 };
  }
  /* keep at least a corner of the photo on screen */
  function pvClamp() {
    const L = pvLayout(), st = $('pmstage').getBoundingClientRect();
    const w = L.w * PV.k, h = L.h * PV.k;
    const minX = st.left - L.left - w + 60, maxX = st.right - L.left - 60;
    const minY = st.top - L.top - h + 60, maxY = st.bottom - L.top - 60;
    PV.tx = Math.max(minX, Math.min(maxX, PV.tx));
    PV.ty = Math.max(minY, Math.min(maxY, PV.ty));
  }
  /* scale about a point on the screen, so it stays under the finger */
  function pvZoomAt(next, cx, cy) {
    next = Math.max(1, Math.min(8, next));
    const L = pvLayout();
    const u = (cx - L.left - PV.tx) / (L.w * PV.k);
    const v = (cy - L.top - PV.ty) / (L.h * PV.k);
    PV.k = next;
    PV.tx = cx - L.left - u * L.w * PV.k;
    PV.ty = cy - L.top - v * L.h * PV.k;
    if (PV.k === 1) { PV.tx = 0; PV.ty = 0; } else pvClamp();
    pvApply();
    pmRender();                /* grips keep their size on screen */
  }
  function pvZoomCentre(mult) {
    const st = $('pmstage').getBoundingClientRect();
    pvZoomAt(PV.k * mult, st.left + st.width / 2, st.top + st.height / 2);
  }

  function pvSpan(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pvTwo() {
    const it = pvPointers.values();
    return [it.next().value, it.next().value];
  }
  function pvStartPinch() {
    const t = pvTwo();
    const mid = { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 };
    const L = pvLayout();
    pvGesture = {
      span: pvSpan(t[0], t[1]) || 1, k: PV.k, L: L,
      u: (mid.x - L.left - PV.tx) / (L.w * PV.k),
      v: (mid.y - L.top - PV.ty) / (L.h * PV.k)
    };
  }
  function pvMovePinch() {
    if (!pvGesture || pvPointers.size < 2) return;
    const t = pvTwo();
    const mid = { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 };
    const g = pvGesture;
    PV.k = Math.max(1, Math.min(8, g.k * (pvSpan(t[0], t[1]) / g.span)));
    PV.tx = mid.x - g.L.left - g.u * g.L.w * PV.k;
    PV.ty = mid.y - g.L.top - g.v * g.L.h * PV.k;
    if (PV.k === 1) { PV.tx = 0; PV.ty = 0; } else pvClamp();
    pvApply();
  }

  const PM_TOOLS = { pmSelect: 'select', pmPan: 'pan', pmDim: 'dim', pmArrow: 'arrow', pmLine: 'line',
                     pmRect: 'rect', pmEllipse: 'ellipse', pmPen: 'pen', pmText: 'text', pmCrop: 'crop' };
  const PM_KEYS = { v: 'select', h: 'pan', d: 'dim', a: 'arrow', l: 'line', b: 'rect',
                    e: 'ellipse', p: 'pen', t: 'text', c: 'crop' };
  const PM_HINT = {
    dim: 'Drag across what you are measuring, then type the size · Shift keeps it straight',
    arrow: 'Drag to point at something · Shift keeps it straight',
    line: 'Drag to draw a straight line · Shift keeps it straight',
    rect: 'Drag to box something in · Shift makes a square',
    ellipse: 'Drag to ring something · Shift makes a circle',
    pen: 'Draw freehand',
    select: 'Tap a mark to pick it up · drag to move, drag a grip to stretch or turn · '
          + 'double-tap to retype · colour and size change it',
    text: 'Tap where the note belongs, then type it',
    pan: 'Drag to move the photo · two fingers zoom at any time',
    crop: 'Drag a box around the part of the photo to keep'
  };
  function pmSetTool(t) {
    if (PM.pending) commitVal(true);
    pmCropCancel();
    PM.tool = t;
    Object.keys(PM_TOOLS).forEach(function (id) { $(id).classList.toggle('on', PM_TOOLS[id] === t); });
    document.body.classList.toggle('pmpan', t === 'pan');
    document.body.classList.toggle('pmsel', t === 'select');
    const hint = $('pmhint');
    hint.textContent = PM_HINT[t];
    hint.classList.remove('gone');
    clearTimeout(pmSetTool.fade);
    pmSetTool.fade = setTimeout(function () { hint.classList.add('gone'); }, 3500);
    if (t !== 'select') PM.sel = -1;   /* a mark stays picked up only in Select */
    PM.grab = null;
    pmSyncSel();
    pmRender();
  }

  let pmBuilt = false;
  function pmBuild() {
    if (pmBuilt) return;
    pmBuilt = true;
    COLORS.forEach(function (c) {
      const b = document.createElement('button');
      b.style.background = c; b.title = c; b.dataset.c = c;
      if (c === PM.color) b.classList.add('on');
      b.addEventListener('click', function () {
        PM.color = c;
        Array.prototype.forEach.call($('pmswatch').children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        const m = PM.tool === 'select' ? PM.marks[PM.sel] : null;
        if (m && m.c !== c) { pmPush(); m.c = c; pmRender(); }
      });
      $('pmswatch').appendChild(b);
    });
    Object.keys(PM_TOOLS).forEach(function (id) {
      $(id).addEventListener('click', function () { pmSetTool(PM_TOOLS[id]); });
    });
    $('pmSize').addEventListener('change', function () {
      const m = PM.tool === 'select' ? PM.marks[PM.sel] : null;
      const w = Math.max(0.5, Math.min(40, parseFloat(this.value) || 3));
      this.value = w;
      if (m && m.w !== w) { pmPush(); m.w = w; pmRender(); }
    });
    $('pmUndo').addEventListener('click', pmUndo);
    $('pmRedo').addEventListener('click', pmRedo);
    $('pmClear').addEventListener('click', function () {
      if (!PM.marks.length) return;
      pmPush();
      PM.marks = []; PM.sel = -1; PM.grab = null;
      pmSyncSel(); pmRender();
      toast('All marks removed · <b>Undo</b> brings them back');
    });
    $('pmRotL').addEventListener('click', function () { pmRotate(-1); });
    $('pmRotR').addEventListener('click', function () { pmRotate(1); });
    $('pmCropOk').addEventListener('click', pmApplyCrop);
    $('pmCropNo').addEventListener('click', function () { pmCropCancel(); pmRender(); });
    $('pmEdit').addEventListener('click', pmEditSel);
    $('pmDel').addEventListener('click', pmDeleteSel);
    $('pmDup').addEventListener('click', pmDupSel);
    $('pmCancel').addEventListener('click', function () { closePm(); });
    $('pmSave').addEventListener('click', savePm);
    $('pmval').addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitVal(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commitVal(false); }
    });
    $('pmval').addEventListener('blur', function () { if (PM.pending) commitVal(true); });
    bindPmCanvas();
    window.addEventListener('resize', function () {
      if ($('pm').hidden) return;
      pmFit();
      if (PV.k > 1) pvClamp();
      pvApply();
      pmRender();
      if (PM.pending) placeVal(PM.pending);
    });
  }

  function pmPt(e) {
    const r = $('pmcv').getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  }
  /* Shift: lines snap to 45°, boxes and rings come out square */
  function pmConstrain(d, on) {
    if (!on || (!PM_LINE[d.t] && !PM_BOX[d.t])) return;
    const sp = pmSpace();
    let dx = (d.b[0] - d.a[0]) * sp.W, dy = (d.b[1] - d.a[1]) * sp.H;
    if (PM_LINE[d.t]) {
      const len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      dx = Math.cos(ang) * len; dy = Math.sin(ang) * len;
    } else {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * s; dy = (dy < 0 ? -1 : 1) * s;
    }
    d.b = [clamp01(d.a[0] + dx / sp.W), clamp01(d.a[1] + dy / sp.H)];
  }

  function bindPmCanvas() {
    const cv = $('pmcv');
    let lastTap = 0;

    cv.addEventListener('pointerdown', function (e) {
      pvPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* mouse works without it */ }

      if (pvPointers.size >= 2) {
        /* a second finger landed: throw away anything half-drawn and pinch instead */
        if (PM.grab && PM.grab.pushed) {        /* put a half-moved mark back */
          PM.marks[PM.sel] = PM.grab.orig;
          PM.undo.pop(); pmSyncBtns();
        }
        PM.draw = null;
        PM.grab = null;
        pvPan = null;
        pvBlock = true;
        if (PM.crop && PM.crop.live) pmCropCancel();
        if (PM.pending) commitVal(false);
        pvStartPinch();
        pmRender();
        return;
      }
      if (pvBlock) return;                       /* fingers left over from a pinch */
      e.preventDefault();
      if (PM.pending) { commitVal(true); return; }

      if (PM.tool === 'pan') {
        pvPan = { x: e.clientX, y: e.clientY, tx: PV.tx, ty: PV.ty };
        return;
      }
      const p = pmPt(e);

      if (PM.tool === 'crop') {
        $('pmcrop').hidden = true;
        PM.crop = { a: p, b: p, live: true };
        pmRender();
        return;
      }

      if (PM.tool === 'select') {
        /* a second tap on the same mark retypes it — dblclick is unreliable on touch */
        const now = Date.now(), again = now - lastTap < 350;
        lastTap = now;
        /* a grip on the mark already picked up wins over picking another */
        const grip = pmGrip(p);
        const hit = grip ? PM.sel : pmHit(p);
        if (again && hit >= 0 && hit === PM.sel && !grip) {
          PM.grab = null;
          pmEditSel();
          return;
        }
        PM.sel = hit;
        const m = PM.marks[hit];
        PM.grab = m ? { mode: grip || 'move', from: p, orig: pmClone(m), bb: pmBounds(m), pushed: false } : null;
        pmSyncSel();
        pmRender();
        return;
      }

      const w = Math.max(0.5, parseFloat($('pmSize').value) || 3);
      if (PM.tool === 'text') {
        PM.draw = null;
        askVal({ t: 'text', a: p, b: p, c: PM.color, w: w, v: '' });
        return;
      }
      PM.draw = { t: PM.tool, a: p, b: p, c: PM.color, w: w, v: '' };
      if (PM.tool === 'pen') PM.draw.p = [p];
      pmRender();
    });

    cv.addEventListener('pointermove', function (e) {
      if (pvPointers.has(e.pointerId)) pvPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pvGesture) { e.preventDefault(); pvMovePinch(); return; }
      if (pvPan) {
        e.preventDefault();
        PV.tx = pvPan.tx + (e.clientX - pvPan.x);
        PV.ty = pvPan.ty + (e.clientY - pvPan.y);
        pvClamp(); pvApply();
        return;
      }
      if (PM.crop && PM.crop.live) {
        e.preventDefault();
        PM.crop.b = pmPt(e);
        pmRender();
        return;
      }
      if (PM.grab && PM.tool === 'select' && PM.grab.orig) {
        e.preventDefault();
        const g = PM.grab, o = g.orig, p = pmPt(e), sp = pmSpace();
        if (!g.pushed) {
          /* a tap that barely moves is a pick, not a move */
          if (Math.hypot((p[0] - g.from[0]) * sp.W, (p[1] - g.from[1]) * sp.H) < 3 * sp.s) return;
          g.pushed = true;
          pmPush();
        }
        let m;
        if (g.mode === 'move') {
          const bb = g.bb;
          const dx = Math.max(Math.min(-bb[0], 0), Math.min(Math.max(1 - bb[2], 0), p[0] - g.from[0]));
          const dy = Math.max(Math.min(-bb[1], 0), Math.min(Math.max(1 - bb[3], 0), p[1] - g.from[1]));
          m = pmMapMark(o, function (q) { return [q[0] + dx, q[1] + dy]; });
        } else if (g.mode === 'a' || g.mode === 'b') {
          m = pmClone(o);
          m[g.mode] = p;
          if (e.shiftKey) {                    /* keep the other end fixed, snap the angle */
            const fixed = g.mode === 'a' ? 'b' : 'a';
            const d = { t: m.t, a: m[fixed], b: p };
            pmConstrain(d, true);
            m[g.mode] = d.b;
          }
        } else if (g.mode === 'rot') {
          /* turn about the middle, keeping the length — dragging an end
             would stretch it, and sometimes you only want the angle */
          const mx = (o.a[0] + o.b[0]) / 2, my = (o.a[1] + o.b[1]) / 2;
          const half = Math.hypot((o.b[0] - o.a[0]) * sp.W, (o.b[1] - o.a[1]) * sp.H) / 2;
          /* the grip leads the line by a quarter turn, so take that back off */
          let ang = Math.atan2((p[1] - my) * sp.H, (p[0] - mx) * sp.W) + Math.PI / 2;
          if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
          const ox = Math.cos(ang) * half / sp.W, oy = Math.sin(ang) * half / sp.H;
          m = pmClone(o);
          m.a = [clamp01(mx - ox), clamp01(my - oy)];
          m.b = [clamp01(mx + ox), clamp01(my + oy)];
        } else {                               /* a box corner: 'ba' = b's x, a's y */
          m = pmClone(o);
          m[g.mode[0]][0] = p[0];
          m[g.mode[1]][1] = p[1];
        }
        PM.marks[PM.sel] = m;
        pmRender();
        return;
      }

      if (!PM.draw) return;
      e.preventDefault();
      const p = pmPt(e);
      if (PM.draw.t === 'pen') {
        const P = PM.draw.p, last = P[P.length - 1], sp = pmSpace();
        if (Math.hypot((p[0] - last[0]) * sp.W, (p[1] - last[1]) * sp.H) < 2 * sp.s) return;
        P.push(p);
        PM.draw.b = p;
      } else {
        PM.draw.b = p;
        pmConstrain(PM.draw, e.shiftKey);
      }
      pmRender();
    });

    function lift(e) {
      pvPointers.delete(e.pointerId);
      if (pvPointers.size < 2 && pvGesture) pvGesture = null;
      if (!pvPointers.size) pvBlock = false;
      if (pvPan && !pvPointers.size) { pvPan = null; return; }
      if (PM.crop && PM.crop.live) {
        PM.crop.live = false;
        const r = pmCropRect(), sp = pmSpace();
        if ((r[2] - r[0]) * sp.W < 20 * sp.s || (r[3] - r[1]) * sp.H < 20 * sp.s) { pmCropCancel(); }
        else $('pmcrop').hidden = false;
        pmRender();
        return;
      }
      if (PM.grab) { PM.grab = null; pmSyncSel(); pmRender(); return; }
      if (pvGesture || pvBlock) return;
      const d = PM.draw; if (!d) return;
      PM.draw = null;
      const sp = pmSpace();
      if (d.t === 'pen') {
        if (d.p.length < 2) { pmRender(); return; }
      } else {
        const dx = (d.b[0] - d.a[0]) * sp.W, dy = (d.b[1] - d.a[1]) * sp.H;
        if (Math.hypot(dx, dy) < 8 * sp.s) { pmRender(); return; }
      }
      if (d.t === 'dim') { askVal(d); return; }
      pmPush();
      PM.marks.push(d);
      pmSyncBtns();
      pmRender();
    }
    cv.addEventListener('pointerup', lift);
    cv.addEventListener('pointercancel', function (e) {
      pvPointers.delete(e.pointerId);
      if (pvPointers.size < 2) pvGesture = null;
      if (!pvPointers.size) { pvBlock = false; pvPan = null; }
      if (PM.crop && PM.crop.live) pmCropCancel();
      PM.draw = null; PM.grab = null; pmRender();
    });
    cv.addEventListener('dblclick', function (e) {
      if (PM.tool !== 'select') return;
      const hit = pmHit(pmPt(e));
      if (hit < 0) return;
      e.preventDefault();
      PM.sel = hit; pmSyncSel();
      if (!PM.pending) pmEditSel();
    });

    /* wheel zooms on a mouse, anchored at the pointer */
    $('pmstage').addEventListener('wheel', function (e) {
      if ($('pm').hidden) return;
      e.preventDefault();
      pvZoomAt(PV.k * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    }, { passive: false });

    $('pmIn').addEventListener('click', function () { pvZoomCentre(1.25); });
    $('pmOut').addEventListener('click', function () { pvZoomCentre(1 / 1.25); });
    $('pmFit').addEventListener('click', function () { pvReset(); pmRender(); });
  }

  /* the little box that asks for the measurement, parked on the mark */
  function placeVal(m) {
    const box = $('pmval');
    const r = $('pmcv').getBoundingClientRect(), st = $('pmstage').getBoundingClientRect();
    const bw = box.offsetWidth || 104, bh = box.offsetHeight || 30;
    /* a note's text starts where it was tapped; a size sits on the middle of its line */
    const x = m.t === 'text' ? (r.left - st.left) + m.a[0] * r.width - 6
                             : (r.left - st.left) + (m.a[0] + m.b[0]) / 2 * r.width - bw / 2;
    const y = (r.top - st.top) + (m.t === 'text' ? m.a[1] : (m.a[1] + m.b[1]) / 2) * r.height - bh / 2;
    box.style.left = Math.max(4, Math.min(st.width - bw - 4, x)) + 'px';
    box.style.top = Math.max(4, Math.min(st.height - bh - 4, y)) + 'px';
  }
  function askVal(m) {
    PM.pending = m;
    const box = $('pmval');
    box.hidden = false;
    box.value = '';
    box.placeholder = m.t === 'text' ? 'note' : 'size';
    placeVal(m);
    box.focus();
    pmRender();
  }
  function withUnit(raw) {
    const unit = ($('pmUnit').value || '').trim();
    return raw ? (unit && !UNIT_END.test(raw) ? raw + ' ' + unit : raw) : '';
  }
  function commitVal(keep) {
    const m = PM.pending; if (!m) return;
    PM.pending = null;
    const box = $('pmval');
    const raw = box.value.trim();
    box.hidden = true; box.value = '';

    /* Retyping an existing mark: change it where it is, and never append. */
    if (PM.editIdx >= 0) {
      const idx = PM.editIdx;
      PM.editIdx = -1;
      const cur = PM.marks[idx];
      if (keep && cur) {
        const v = cur.t === 'text' ? raw : withUnit(raw);
        if (cur.t === 'text' && !v) {
          pmPush(); PM.marks.splice(idx, 1); PM.sel = -1;   /* an emptied note is gone */
        } else if (v !== (cur.v || '')) {
          pmPush(); cur.v = v;
        }
      }
      pmSyncSel();
      pmRender();
      return;
    }

    if (keep) {
      if (m.t === 'text') {
        if (raw) { pmPush(); m.v = raw; PM.marks.push(m); }
      } else {
        pmPush();
        m.v = withUnit(raw);
        PM.marks.push(m);
      }
    }
    pmSyncBtns();
    pmRender();
  }

  async function openPm(L, k) {
    const ph = L && L.photos ? L.photos[k] : null;
    if (!ph) return;
    pmBuild();
    PM.loc = L; PM.k = k; PM.ph = ph;
    PM.marks = (ph.marks || []).map(pmClone);
    PM.draw = null; PM.pending = null;
    PM.sel = -1; PM.grab = null; PM.editIdx = -1;
    PM.undo = []; PM.redo = []; PM.dirty = false;
    pmCropCancel();
    pvPointers.clear(); pvGesture = null; pvPan = null; pvBlock = false;
    $('pmval').hidden = true;
    $('pmHeadTitle').textContent = (L.ref || 'Location ' + L.n) + (ph.cap ? '  ·  ' + ph.cap : '');
    const src = ph.orig || ph.src;
    try { PM.img = await loadImg(src); }
    catch (err) { toast(esc(err.message)); return; }
    PM.src = src;
    $('pmimg').src = src;
    $('pm').hidden = false;
    pmSetTool(PM.tool);
    pmFit();                         /* reading the stage's size lays it out now */
    pvReset();
    pmRender();
  }
  /* force skips the question — Save uses it once the work is kept */
  function closePm(force) {
    const pm = $('pm');
    if (!pm || pm.hidden) return false;
    if (force !== true && PM.dirty && PM.undo.length &&
        !confirm('Discard the changes to this photo?')) return true;
    PM.pending = null; PM.draw = null; PM.img = null; PM.src = '';
    PM.sel = -1; PM.grab = null; PM.editIdx = -1;
    PM.undo = []; PM.redo = []; PM.dirty = false;
    pmCropCancel();
    pvPointers.clear(); pvGesture = null; pvPan = null; pvBlock = false;
    document.body.classList.remove('pmpan', 'pmsel');
    $('pmval').hidden = true;
    $('pmimg').removeAttribute('src');
    pm.hidden = true;
    return true;
  }
  function savePm() {
    const ph = PM.ph;
    if (!ph || !PM.img) { closePm(true); return; }
    if (PM.pending) commitVal(true);
    pmCropCancel();
    const n = PM.marks.length;
    const changedPhoto = PM.src !== (ph.orig || ph.src);
    if (!n) {
      ph.src = PM.src; delete ph.orig; delete ph.marks;
    } else {
      ph.orig = PM.src;
      ph.marks = PM.marks.map(pmClone);
      ph.src = pmFlatten(PM.img, PM.marks, 0.85);
    }
    closePm(true);
    renderPins(); updateMeta();
    toast(n ? '<b>' + n + '</b> mark(s) saved onto the photo'
            : changedPhoto ? 'Photo saved' : 'Marks cleared from the photo');
  }
  document.addEventListener('keydown', function (e) {
    if ($('pm').hidden) return;
    if (e.target === $('pmval') || e.target === $('pmUnit') || e.target === $('pmSize')) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    e.stopImmediatePropagation();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) pmRedo(); else pmUndo(); return; }
    if (mod && key === 'y') { e.preventDefault(); pmRedo(); return; }
    if (mod && key === 'd') { e.preventDefault(); pmDupSel(); return; }
    if (mod && key === 's') { e.preventDefault(); savePm(); return; }
    if (e.key === 'Enter' && PM.crop && !PM.crop.live) { e.preventDefault(); pmApplyCrop(); return; }
    const sel = PM.tool === 'select' && PM.sel >= 0 && !PM.pending;
    if (sel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); pmDeleteSel(); return; }
    if (sel && e.key.indexOf('Arrow') === 0) {
      e.preventDefault();
      const sp = pmSpace(), step = (e.shiftKey ? 10 : 1) * sp.s;
      pmNudge(e.key === 'ArrowLeft' ? -step / sp.W : e.key === 'ArrowRight' ? step / sp.W : 0,
              e.key === 'ArrowUp' ? -step / sp.H : e.key === 'ArrowDown' ? step / sp.H : 0);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      /* let go of a crop or a mark first; a second Escape closes the photo */
      if (PM.crop) { pmCropCancel(); pmRender(); return; }
      if (sel) { PM.sel = -1; PM.grab = null; pmSyncSel(); pmRender(); return; }
      closePm();
      return;
    }
    if (!mod && !e.altKey && PM_KEYS[key]) { e.preventDefault(); pmSetTool(PM_KEYS[key]); }
  }, true);
  document.addEventListener('keyup', function (e) {
    /* a run of arrow-key nudges is one undo step */
    if (!$('pm').hidden && e.key.indexOf('Arrow') === 0 && PM.grab && PM.grab.mode === 'nudge') PM.grab = null;
  }, true);

  /* ---- take photo: live camera on this device ---- */
  const CAM = { stream: null, face: 'environment', shots: 0, id: null, fallback: false };

  function camCanUse() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext !== false);
  }
  function camStop() {
    if (CAM.stream) { CAM.stream.getTracks().forEach(function (t) { t.stop(); }); CAM.stream = null; }
    const v = $('camvid');
    v.srcObject = null; v.removeAttribute('src');
  }
  async function camStart(face) {
    camStop();
    const v = $('camvid');
    const st = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: face }, width: { ideal: 2560 }, height: { ideal: 1920 } }
    });
    CAM.stream = st; CAM.face = face;
    v.srcObject = st;
    v.classList.toggle('mir', face === 'user');
    try { await v.play(); } catch (err) { /* autoplay attribute covers this */ }
    $('camwait').hidden = true;
    $('camshot').disabled = false;
  }
  function camInfo() {
    const p = CAM.id ? findPin(CAM.id) : null;
    $('camtitle').textContent = p ? 'Pin ' + p.L.n + (p.L.ref ? '  ·  ' + p.L.ref : '') : 'Take photo';
    $('cammeta').textContent = p
      ? [p.L.photos.length + (p.L.photos.length === 1 ? ' photo' : ' photos') + ' on this pin',
         CAM.shots ? CAM.shots + ' taken now' : ''].filter(Boolean).join('  ·  ')
      : '';
    $('camMeasure').disabled = !(p && p.L.photos.length);
  }
  function camStamp(when) {
    const d = when || new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' +
           z(d.getHours()) + ':' + z(d.getMinutes());
  }
  /* ---- the stamp burned into a shot: date and time, the pin, and a line of
     the user's own text. It is part of the picture, like a site camera's, so
     it survives into the PDF, the viewer and anything the photo is copied to.
     The choices are remembered on this device. */
  const STAMP_KEY = 'adpdf-camstamp';
  const STAMP = (function () {
    const d = { date: true, pin: true, text: '' };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(STAMP_KEY) || '{}')); }
    catch (err) { return d; }
  })();
  function stampSave() {
    try { localStorage.setItem(STAMP_KEY, JSON.stringify(STAMP)); } catch (err) { /* private window */ }
  }
  function stampWhen(d) {
    try {
      return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + '  ' +
             d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (err) { return camStamp(d); }
  }
  function stampLines(p, when) {
    const out = [];
    if (STAMP.date) out.push(stampWhen(when || new Date()));
    if (STAMP.pin && p) out.push('Pin ' + p.L.n + (p.L.ref ? '  ·  ' + p.L.ref : ''));
    const t = (STAMP.text || '').trim();
    if (t) out.push(t);
    return out;
  }
  /* bottom right, white on a dark band, sized to the photo so it reads the
     same on a thumbnail and at full size */
  function paintStamp(g, w, h, lines) {
    if (!lines.length) return;
    const fs = Math.max(12, Math.round(Math.max(w, h) * 0.024));
    const pad = Math.round(fs * 0.5), lh = Math.round(fs * 1.3), edge = Math.round(fs * 0.7);
    g.save();
    g.font = '600 ' + fs + 'px ' + CSS_FONT.helv;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const tw = Math.min(w - edge * 2 - pad * 2,
                        Math.max.apply(null, lines.map(function (l) { return g.measureText(l).width; })));
    const bw = tw + pad * 2, bh = lines.length * lh + pad;
    const x = w - edge - bw, y = h - edge - bh;
    g.fillStyle = 'rgba(0,0,0,.55)';
    roundRect(g, x, y, bw, bh, fs * 0.3);
    g.fill();
    lines.forEach(function (l, i) {
      g.fillStyle = i === 0 && STAMP.date ? '#FFD34D' : '#FFFFFF';
      g.fillText(l, w - edge - pad, y + pad / 2 + lh * (i + 0.5), tw);
    });
    g.restore();
  }

  /* the live preview: the same lines, laid over the picture where they will go */
  let stampTimer = null;
  function stampPreview() {
    const box = $('camstampview'), v = $('camvid');
    const p = CAM.id ? findPin(CAM.id) : null;
    const lines = stampLines(p);
    if (!lines.length || !v.videoWidth) { box.hidden = true; return; }
    /* where the picture actually is inside the video element (object-fit: contain) */
    const vr = v.getBoundingClientRect(), mr = $('cammain').getBoundingClientRect();
    const k = Math.min(vr.width / v.videoWidth, vr.height / v.videoHeight);
    const pw = v.videoWidth * k, ph = v.videoHeight * k;
    const px = vr.left - mr.left + (vr.width - pw) / 2, py = vr.top - mr.top + (vr.height - ph) / 2;
    const fs = Math.max(7, Math.max(pw, ph) * 0.024);
    box.hidden = false;
    box.style.fontSize = fs.toFixed(1) + 'px';
    box.style.right = (mr.width - px - pw + fs * 0.7) + 'px';
    box.style.bottom = (mr.height - py - ph + fs * 0.7) + 'px';
    box.style.maxWidth = Math.max(40, pw - fs * 1.4) + 'px';
    box.innerHTML = lines.map(function (l, i) {
      return '<div' + (i === 0 && STAMP.date ? ' class="d"' : '') + '>' + esc(l) + '</div>';
    }).join('');
  }
  function stampSync() {
    $('camStDate').classList.toggle('on', STAMP.date);
    $('camStPin').classList.toggle('on', STAMP.pin);
    $('camStDate').setAttribute('aria-pressed', STAMP.date);
    $('camStPin').setAttribute('aria-pressed', STAMP.pin);
    if ($('camStText').value !== STAMP.text) $('camStText').value = STAMP.text;
    stampPreview();
  }
  $('camStDate').addEventListener('click', function () { STAMP.date = !STAMP.date; stampSave(); stampSync(); });
  $('camStPin').addEventListener('click', function () { STAMP.pin = !STAMP.pin; stampSave(); stampSync(); });
  $('camStText').addEventListener('input', function () { STAMP.text = this.value; stampSave(); stampPreview(); });
  $('camStText').addEventListener('keydown', function (e) {
    e.stopPropagation();                 /* Space types a space here, not a shot */
    if (e.key === 'Enter' || e.key === 'Escape') this.blur();
  });
  $('camvid').addEventListener('loadedmetadata', stampPreview);
  window.addEventListener('resize', function () { if (!$('cam').hidden) stampPreview(); });

  function camShoot() {
    const p = CAM.id ? findPin(CAM.id) : null;
    const v = $('camvid');
    if (!p) { closeCam(); return; }
    if (!v.videoWidth) { toast('The camera is still warming up…'); return; }
    let w = v.videoWidth, h = v.videoHeight;
    const k = Math.min(1, 1500 / Math.max(w, h));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h);
    g.drawImage(v, 0, 0, w, h);
    const now = new Date();
    paintStamp(g, w, h, stampLines(p, now));
    const src = c.toDataURL('image/jpeg', 0.72);
    c.width = c.height = 1;
    p.L.photos.push({ src: src, cap: camStamp(now) });
    CAM.shots++;
    const th = new Image(); th.src = src; th.alt = '';
    const strip = $('camstrip');
    strip.appendChild(th); strip.scrollLeft = strip.scrollWidth;
    const f = $('camflash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    camInfo();
    drawShapes(p.it); renderPins(); updateMeta();
  }
  async function openCam() {
    const p = pinSel ? findPin(pinSel) : null; if (!p) return;
    CAM.id = pinSel; CAM.shots = 0;
    $('camstrip').innerHTML = '';
    if (!camCanUse() || CAM.fallback) {      /* no getUserMedia, or it was refused — use the device camera app */
      $('pinCamIn').click();
      return;
    }
    $('cam').hidden = false;
    $('camwait').hidden = false;
    $('camshot').disabled = true;
    camInfo();
    stampSync();
    clearInterval(stampTimer);
    stampTimer = setInterval(stampPreview, 1000);      /* the clock in the preview keeps time */
    try { await camStart(CAM.face); stampPreview(); }
    catch (err) {
      $('cam').hidden = true; camStop();
      clearInterval(stampTimer); stampTimer = null;
      CAM.fallback = true;                   /* from now on go straight to the device camera app */
      toast('Camera unavailable — ' + esc(err && err.message ? err.message : 'permission denied') +
            ' · tap <b>Take photo</b> again for the device camera');
      $('pinCamIn').click();
    }
  }
  function closeCam() {
    const c = $('cam');
    if (!c || c.hidden) return false;
    camStop(); c.hidden = true;
    clearInterval(stampTimer); stampTimer = null;
    const p = CAM.id ? findPin(CAM.id) : null;
    if (CAM.shots && p) toast('<b>' + CAM.shots + '</b> photo(s) added to pin ' + esc(p.L.n));
    CAM.id = null; CAM.shots = 0;
    return true;
  }

  $('pe_cam').addEventListener('click', openCam);
  $('camshot').addEventListener('click', camShoot);
  /* measure without having to press Done and hunt for the photo in the grid */
  function camMeasureShot(k) {
    const p = CAM.id ? findPin(CAM.id) : null;
    if (!p || !p.L.photos.length) return;
    const idx = k == null ? p.L.photos.length - 1 : k;
    const L = p.L;
    closeCam();                       /* the camera stops; the shots are already saved */
    openPm(L, Math.max(0, Math.min(L.photos.length - 1, idx)));
  }
  $('camMeasure').addEventListener('click', function () { camMeasureShot(null); });
  $('camstrip').addEventListener('click', function (e) {
    if (e.target.tagName !== 'IMG') return;
    const kids = Array.prototype.slice.call(this.children);
    const n = kids.indexOf(e.target);
    const p = CAM.id ? findPin(CAM.id) : null;
    if (n < 0 || !p) return;
    /* the strip only shows this session's shots, which sit at the end of the pin */
    camMeasureShot(p.L.photos.length - CAM.shots + n);
  });
  $('camdone').addEventListener('click', closeCam);
  $('camswap').addEventListener('click', async function () {
    if (!CAM.stream) return;
    const was = CAM.face, now = was === 'environment' ? 'user' : 'environment';
    $('camshot').disabled = true;
    try { await camStart(now); }
    catch (err) {
      toast('Only one camera on this device');
      try { await camStart(was); } catch (e2) { closeCam(); }
    }
  });
  document.addEventListener('keydown', function (e) {
    if ($('cam').hidden) return;
    /* typing the stamp text: Space and Enter are letters here, not the shutter */
    if (e.target === $('camStText')) { e.stopImmediatePropagation(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeCam(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); camShoot(); }
    else e.stopImmediatePropagation();
  }, true);
  window.addEventListener('pagehide', camStop);

  /* Done puts the details away; picking or dropping a pin brings them back.
     A pin left with no reference and no photos carries nothing worth keeping,
     so it is removed instead of sitting on the page as an empty dot. */
  function closePinEditor() {
    const empty = pinSel ? findPin(pinSel) : null;
    const dropId = (empty && !empty.L.ref && !(empty.L.photos && empty.L.photos.length)) ? pinSel : null;
    pinSel = null;
    pinEdFor = null;
    const sel = S.sel && S.sel.it && S.sel.it.shapes ? S.sel.it.shapes[S.sel.i] : null;
    if (sel && sel.t === 'pin') S.sel = null;
    $('pinEd').hidden = true;
    if (dropId) deletePin(dropId);
    redrawAll(); renderPins();
  }
  $('pe_done').addEventListener('click', closePinEditor);
  $('pe_go').addEventListener('click', function () {
    const p = pinSel ? findPin(pinSel) : null; if (!p) return;
    goTo(p.page);
    if (isMobile()) setRail(false);
    setTimeout(function () {
      const q = p.it.vp.convertToViewportPoint(p.s.a[0], p.s.a[1]);
      stage.scrollTop = p.it.box.offsetTop + p.it.wrap.offsetTop + q[1] - p.it.off.top - stage.clientHeight / 2;
      stage.scrollLeft = Math.max(0, p.it.box.offsetLeft + q[0] - p.it.off.left - stage.clientWidth / 2);
    }, 40);
  });
  $('pe_del').addEventListener('click', function () {
    const p = pinSel ? findPin(pinSel) : null; if (!p) return;
    if (p.L.photos.length && !confirm('Delete pin ' + p.L.n + (p.L.ref ? ' (' + p.L.ref + ')' : '') +
        ' and its ' + p.L.photos.length + ' photo(s)?')) return;
    deletePin(pinSel);
  });
  $('pinAddMode').addEventListener('click', function () {
    setTool('pin');
    if (isMobile()) setRail(false);
  });
  $('pinShowList').addEventListener('click', function () { showPinPanel(); });
  $('pinRenum').addEventListener('click', function () {
    const pins = livePins();
    if (!pins.length) return;
    pins.forEach(function (p, i) { p.L.n = String(i + 1); });
    redrawAll(); renderPins();
    toast('Renumbered 1–' + pins.length + ' in page order');
  });

  /* ---- photo viewer ---- */
  let lbId = null, lbK = 0;
  function openLb(id, k) {
    const L = S.locs[id];
    if (!L || !L.photos.length) { toast('No photos on this pin yet'); return; }
    lbId = id;
    const p = findPin(id);
    $('lbtitle').textContent = L.n + '. ' + (L.ref || 'Location') + (L.desc ? ' — ' + L.desc : '');
    $('lbmeta').textContent = [L.boq ? 'BOQ ' + L.boq : '', p ? 'page ' + p.page : '',
                               L.photos.length + (L.photos.length === 1 ? ' photo' : ' photos')]
                               .filter(Boolean).join('  ·  ');
    $('lbnote').textContent = L.note || '';
    const many = L.photos.length > 1;
    $('lbstrip').innerHTML = many ? L.photos.map(function (ph, i) {
      return '<img src="' + esc(ph.src) + '" alt="" data-k="' + i + '">';
    }).join('') : '';
    $('lbprev').hidden = $('lbnext').hidden = !many;
    $('lb').hidden = false;
    showLb(k || 0);
  }
  function showLb(k) {
    const L = S.locs[lbId]; if (!L || !L.photos.length) { closeLb(); return; }
    lbK = (k + L.photos.length) % L.photos.length;
    $('lbimg').src = L.photos[lbK].src;
    $('lbcap').textContent = (L.photos[lbK].cap || '') + (L.photos.length > 1 ? '   ' + (lbK + 1) + ' / ' + L.photos.length : '');
    Array.prototype.forEach.call($('lbstrip').children, function (c, i) { c.classList.toggle('on', i === lbK); });
  }
  function closeLb() {
    const lb = $('lb');
    if (!lb || lb.hidden) return false;
    lb.hidden = true; $('lbimg').removeAttribute('src'); lbId = null;
    return true;
  }
  $('lbprev').addEventListener('click', function () { showLb(lbK - 1); });
  $('lbnext').addEventListener('click', function () { showLb(lbK + 1); });
  $('lbclose').addEventListener('click', closeLb);
  $('lbstrip').addEventListener('click', function (e) { if (e.target.dataset.k) showLb(+e.target.dataset.k); });
  $('lb').addEventListener('click', function (e) { if (e.target.id === 'lb' || e.target.id === 'lbmain') closeLb(); });
  document.addEventListener('keydown', function (e) {
    if ($('lb').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeLb(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); showLb(lbK - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); showLb(lbK + 1); }
    else e.stopImmediatePropagation();
  }, true);

  /* ---- pins project files ---- */
  $('pinSave').addEventListener('click', function () {
    if (!S.items.length) { toast('Open a drawing first'); return; }
    const btn = this;
    btn.disabled = true; btn.textContent = 'Saving…';
    /* let the button repaint before the base64 pass locks the thread */
    setTimeout(function () {
      try {
        const data = buildProject();
        const text = JSON.stringify(data);
        const name = S.baseName + '-project.json';
        download(text, name, 'application/json');
        toast('Saved <b>' + esc(name) + '</b> · ' + bytesLabel(text.length) +
              ' · drawing, marks, pins and photos are all inside it');
      } catch (err) {
        toast('This project could not be saved — it may be too large for the browser');
      } finally {
        btn.disabled = false; btn.textContent = 'Save project';
      }
    }, 30);
  });
  $('pinLoad').addEventListener('click', function () {
    if (!S.items.length) return;
    $('pinProjIn').click();
  });

  /* ---- exports from the Properties tab ---- */
  /* The single Export Report button opens a chooser; whichever format is picked
     runs here and shows its progress on that same button. */
  $('pinExpGo').addEventListener('click', function () {
    if (!livePins().length) { toast('Add at least one pin first'); return; }
    if (viewerBusy) return;
    $('expPop').hidden ? openPop('expPop', this) : closePops();
  });

  $('expAsPdf').addEventListener('click', async function () {
    closePops();
    if (!livePins().length) { toast('Add at least one pin first'); return; }
    const btn = $('pinExpGo');
    btn.disabled = true; btn.textContent = 'Building…';
    try {
      const name = S.baseName + '-pins.pdf';
      download(await buildPdf(S.items, null, { photos: true }), name);
      toast('Exported <b>' + esc(name) + '</b> · pins link to their photo pages');
    } catch (err) {
      toast(esc(saveError(err, 'The report could not be built')));
    } finally {
      btn.disabled = false; btn.textContent = 'Export Report';
    }
  });

  /* View-only HTML file plus an assets folder beside it: the page images and every
     photo are real .jpg files the HTML links to. With a folder picker (Chrome, Edge)
     both are written straight into the folder you choose; otherwise a .zip carries
     the same layout — unzip it and open the .html. */
  let viewerBusy = false;
  function slugName(t) {
    return String(t == null ? '' : t).replace(/[^\w -]+/g, ' ').trim()
      .replace(/\s+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
  }
  function dataUrlBlob(u) {
    const str = String(u), i = str.indexOf(',');
    const mime = str.slice(5, i).split(';')[0] || 'image/jpeg';
    return new Blob([dataUrlBytes(u)], { type: mime });
  }
  async function pickFolder() {
    if (!window.showDirectoryPicker) return null;
    try { return await window.showDirectoryPicker({ mode: 'readwrite', id: 'adddots-viewer' }); }
    catch (err) { return null; }            /* cancelled — fall back to a zip */
  }
  async function writeInto(dir, name, blob) {
    const h = await dir.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(blob); await w.close();
  }

  $('expAsView').addEventListener('click', async function () {
    closePops();
    if (!livePins().length) { toast('Add at least one pin first'); return; }
    if (viewerBusy) return;
    viewerBusy = true;
    const btn = $('pinExpGo');
    btn.disabled = true;
    /* ask for the folder first, while the click still counts as a user gesture */
    const dir = await pickFolder();
    const base = S.baseName.replace(/[^\w.-]+/g, '-') || 'document';
    const assetDir = base + '-assets';
    try {
      const withPins = S.items.filter(function (it) {
        return it.shapes.some(function (s) { return s.t === 'pin' && S.locs[s.id]; });
      });
      const pages = [], locs = {}, assets = [], used = {};
      const pad = String(S.items.length).length < 2 ? 2 : String(S.items.length).length;
      function unique(name) {
        const dot = name.lastIndexOf('.'), stem = name.slice(0, dot), ext = name.slice(dot);
        let out = name, c = 2;
        while (used[out.toLowerCase()]) out = stem + '-' + (c++) + ext;
        used[out.toLowerCase()] = 1;
        return out;
      }

      for (let k = 0; k < withPins.length; k++) {
        const it = withPins[k];
        btn.textContent = 'Page ' + (k + 1) + ' / ' + withPins.length + '…';
        await breathe();
        await ensurePage(it);
        const v1 = it.page.getViewport({ scale: 1, rotation: it.page.rotate + it.rot });
        const c1 = cropRectIn(v1, it.crop);
        const dpi = 2400 * 72 / Math.max(c1 ? c1.width : v1.width, c1 ? c1.height : v1.height);
        const label = String(S.items.indexOf(it) + 1);
        const file = unique('page-' + label.padStart(pad, '0') + '.jpg');
        assets.push({ name: file, blob: await pageToJpeg(it, dpi, 0.85, true) });
        const vp = jpgViewport(it, dpi), c = cropRectIn(vp, it.crop);
        const w = c ? c.width : vp.width, h = c ? c.height : vp.height;
        const ox = c ? c.left : 0, oy = c ? c.top : 0;
        const list = [];
        it.shapes.forEach(function (s) {
          if (s.t !== 'pin' || !S.locs[s.id]) return;
          const q = vp.convertToViewportPoint(s.a[0], s.a[1]);
          list.push({ id: s.id, x: +((q[0] - ox) / w * 100).toFixed(3), y: +((q[1] - oy) / h * 100).toFixed(3) });
          if (locs[s.id]) return;
          const L = cleanLoc(S.locs[s.id], s.id);
          const stem = String(L.n).padStart(2, '0') + '-' + (slugName(L.ref) || slugName(L.desc) || 'pin');
          L.photos = L.photos.map(function (ph, i) {
            const ext = /^data:image\/png/i.test(ph.src) ? '.png' : '.jpg';
            const name = unique(stem + '-' + (i + 1) + ext);
            assets.push({ name: name, blob: dataUrlBlob(ph.src) });
            return { src: assetDir + '/' + name, cap: ph.cap };
          });
          locs[s.id] = L;
        });
        pages.push({ label: label, src: assetDir + '/' + file, w: Math.round(w), h: Math.round(h), pins: list });
      }

      const json = JSON.stringify({ title: S.baseName, pages: pages, locs: locs }).replace(/</g, '\\u003c');
      const body = $('pinViewerTpl').innerHTML.replace('/*VDATA*/', function () { return json; });
      const html = new Blob(['<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + esc(S.baseName) + ' — pins</title></head><body>' + body + '</body></html>'],
        { type: 'text/html' });
      const htmlName = base + '-viewer.html';

      btn.textContent = 'Saving…';
      if (dir) {
        try {
          await writeInto(dir, htmlName, html);
          const sub = await dir.getDirectoryHandle(assetDir, { create: true });
          for (const a of assets) await writeInto(sub, a.name, a.blob);
          toast('Saved <b>' + esc(htmlName) + '</b> and the <b>' + esc(assetDir) + '</b> folder (' +
                assets.length + ' files) — keep them together');
          return;
        } catch (err) {
          toast('That folder could not be written to — downloading a .zip instead');
        }
      }
      const top = base + '-viewer/';
      const entries = [{ name: top + htmlName, data: new Uint8Array(await html.arrayBuffer()) }];
      for (const a of assets) {
        entries.push({ name: top + assetDir + '/' + a.name, data: new Uint8Array(await a.blob.arrayBuffer()) });
      }
      const zipName = base + '-viewer.zip';
      download(zipStore(entries), zipName, 'application/zip');
      toast('Saved <b>' + esc(zipName) + '</b> — unzip it, then open <b>' + esc(htmlName) +
            '</b> (the <b>' + esc(assetDir) + '</b> folder sits beside it)');
    } catch (err) {
      toast('The viewer could not be built — try again');
    } finally {
      viewerBusy = false;
      btn.disabled = false; btn.textContent = 'Export Report';
    }
  });

  /* ---- opening a saved report back into the editor ----
     A pins .json carries its photos inline. An exported Web Viewer .html keeps its
     page images and photos in the sibling -assets folder, so those files can be
     picked alongside it and are matched back up by file name. */
  function isProjectFile(f) {
    return f && /\.(json|html?|htm)$/i.test(f.name || '');
  }
  function isImageFile(f) {
    return f && (/^image\//.test(f.type || '') || /\.(jpe?g|png|webp)$/i.test(f.name || ''));
  }
  function baseNameOf(pathish) {
    return String(pathish || '').split(/[\\/]/).pop().toLowerCase();
  }
  function readText(f) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('The file could not be read')); };
      r.readAsText(f);
    });
  }
  function readDataUrl(f) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('The file could not be read')); };
      r.readAsDataURL(f);
    });
  }
  /* file name -> data URL, for the assets that came with a viewer export */
  async function assetPool(files) {
    const pool = {};
    for (const f of files) {
      try { pool[baseNameOf(f.name)] = await readDataUrl(f); } catch (err) { /* skip it */ }
    }
    return pool;
  }

  /* the shape an exported Web Viewer stores in its #vdata block */
  function isViewerData(d) {
    return d && Array.isArray(d.pages) && d.locs && typeof d.locs === 'object';
  }

  function loadViewerProject(d, pool) {
    const byLabel = {};
    S.items.forEach(function (it, i) { byLabel[String(i + 1)] = it; });
    snapshot();
    let placed = 0, skipped = 0, gotPhotos = 0, lostPhotos = 0;
    const seen = {};
    d.pages.forEach(function (P) {
      const it = byLabel[String(P.label)] || S.items[0];
      if (!it || !it.vp) { skipped += (P.pins || []).length; return; }
      const vp = it.vp, c = cropRectIn(vp, it.crop);
      const w = c ? c.width : vp.width, h = c ? c.height : vp.height;
      (P.pins || []).forEach(function (q) {
        const L = d.locs[q.id];
        if (!L) { skipped++; return; }
        let id = q.id;
        if (seen[id] || S.locs[id]) id = uid();
        seen[id] = 1;
        const clean = cleanLoc(L, id);
        clean.photos = (clean.photos || []).map(function (ph) {
          const hit = pool ? pool[baseNameOf(ph.src)] : null;
          if (hit) { gotPhotos++; return { src: hit, cap: ph.cap || '' }; }
          if (/^data:/i.test(ph.src)) { gotPhotos++; return ph; }
          lostPhotos++;
          return null;
        }).filter(Boolean);
        S.locs[id] = clean;
        const vx = it.off.left + (+q.x / 100) * w, vy = it.off.top + (+q.y / 100) * h;
        it.shapes.push({ t: 'pin', a: vp.convertToPdfPoint(vx, vy), id: id });
        placed++;
      });
    });
    redrawAll(); updateMeta(); renderPins(); showPinPanel();
    let msg = 'Loaded <b>' + placed + '</b> pins';
    if (gotPhotos) msg += ' · ' + gotPhotos + ' photos';
    if (skipped) msg += ' · ' + skipped + ' skipped (page not in this PDF)';
    toast(msg);
    if (lostPhotos) {
      toast('<b>' + lostPhotos + '</b> photo(s) not found · pick the <b>-assets</b> folder’s ' +
            'images together with the .html to bring them back');
    }
  }

  /* ---- the whole job in one file ----
     A project carries the source PDFs byte for byte, the page order with every
     rotation and crop, all the marks, and every pin with its photos. Opening one
     rebuilds the session exactly, so it is a real save, not just a pin list. */
  function bytesToB64(u8) {
    let out = '';
    const CH = 0x8000;                       /* chunked, or a big drawing blows the stack */
    for (let i = 0; i < u8.length; i += CH) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(out);
  }
  function b64ToBytes(b) {
    const bin = atob(String(b || ''));
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function buildProject() {
    const used = {};
    S.items.forEach(function (it) { if (it.src) used[it.src.id] = it.src; });
    const locs = {};
    Object.keys(S.locs).forEach(function (id) { locs[id] = cleanLoc(S.locs[id], id); });
    return {
      app: 'add-dots-project', version: 2,
      baseName: S.baseName, current: S.current,
      sources: Object.keys(used).map(function (k) {
        const s = used[k];
        return { id: s.id, name: s.name, synthetic: !!s.synthetic, b64: bytesToB64(s.bytes) };
      }),
      items: S.items.map(function (it) {
        return {
          s: it.src ? it.src.id : null, num: it.num, rot: it.rot || 0, added: !!it.added,
          crop: it.crop ? { x: it.crop.x, y: it.crop.y, w: it.crop.w, h: it.crop.h } : null,
          shapes: (it.shapes || []).map(function (sh) { return Object.assign({}, sh); })
        };
      }),
      locs: locs
    };
  }

  async function openProject(d) {
    if (S.items.length && !okToReplace()) return false;
    toast('Opening the project…');
    let srcs;
    try {
      srcs = [];
      for (const s of (d.sources || [])) {
        const bytes = b64ToBytes(s.b64);
        const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        srcs.push({ old: s.id, name: s.name || 'document.pdf', synthetic: !!s.synthetic,
                    bytes: bytes, doc: doc });
      }
    } catch (err) {
      toast('The drawing inside that project could not be opened');
      return false;
    }
    if (!srcs.length) { toast('That project has no drawing in it'); return false; }

    hardReset();
    if (S.tool !== 'select') setTool('select');
    const byOld = {};
    srcs.forEach(function (s) {
      const src = { id: ++srcId, name: s.name, bytes: s.bytes, doc: s.doc };
      if (s.synthetic) src.synthetic = true;
      S.sources.push(src);
      byOld[s.old] = src;
    });

    (d.items || []).forEach(function (i) {
      const src = byOld[i.s];
      if (!src || i.num < 1 || i.num > src.doc.numPages) return;
      const it = newItem(src, i.num, i.rot || 0, !!i.added);
      it.crop = i.crop || null;
      it.shapes = (Array.isArray(i.shapes) ? i.shapes : []).filter(function (sh) {
        return sh && typeof sh === 'object' && typeof sh.t === 'string';
      }).map(cleanShape);
      S.items.push(it);
    });
    if (!S.items.length) {
      srcs.forEach(function (s) {
        for (let n = 1; n <= s.doc.numPages; n++) S.items.push(newItem(byOld[s.old], n, 0, false));
      });
    }

    S.locs = {};
    Object.keys(d.locs || {}).forEach(function (id) { S.locs[id] = cleanLoc(d.locs[id], id); });

    S.baseName = d.baseName || 'project';
    S.baseCount = S.items.length;
    const nPins = livePins().length;
    S.metaBase = '<b>' + esc(S.baseName) + '</b> · project';
    $('meta').innerHTML = S.metaBase;
    $('saveName').value = S.baseName + '-edited.pdf';

    $('openPanel').hidden = true;
    $('errMsg').hidden = true;
    $('pwRow').classList.remove('show');
    if (!isMobile()) { rail.hidden = false; $('btnRail').classList.add('on'); }
    syncScrim();
    await syncAll();
    goTo(Math.max(1, Math.min(S.items.length, d.current || 1)));
    stage.focus();
    renderPins();
    if (nPins) showPinPanel();
    const nPhotos = Object.keys(S.locs).reduce(function (a, k) {
      return a + ((S.locs[k].photos || []).length);
    }, 0);
    toast('Project open · <b>' + S.items.length + '</b> pages · <b>' + nPins + '</b> pins · ' +
          '<b>' + nPhotos + '</b> photos');
    return true;
  }

  /* one door for every kind of saved report */
  async function applyProject(d, pool, name) {
    /* a full project brings its own drawing, so it opens on its own */
    if (d && d.app === 'add-dots-project' && Array.isArray(d.sources)) {
      await openProject(d);
      return 'ok';
    }
    if (!S.items.length) return 'need-pdf';
    if (d && d.app === 'add-dots-pins' && Array.isArray(d.pins)) { loadOwnPins(d); return 'ok'; }
    if (isViewerData(d)) { loadViewerProject(d, pool); return 'ok'; }
    if (d && d.plan && Array.isArray(d.locations)) { loadSiteProject(d, name); return 'ok'; }
    toast('That file has no pin or project data in it');
    return 'bad';
  }

  /* a report picked before any drawing waits here until a PDF is opened */
  let pendingProject = null;
  function stashProject(d, pool, name) {
    pendingProject = { d: d, pool: pool, name: name };
    toast('Report <b>' + esc(name) + '</b> is ready · now choose the PDF drawing it belongs to');
  }
  function flushProject() {
    const p = pendingProject;
    if (!p || !S.items.length) return;
    pendingProject = null;
    setTimeout(function () { applyProject(p.d, p.pool, p.name); }, 80);
  }

  /* pulls the project + its assets out of whatever the user picked */
  async function takeProjectFiles(files) {
    const proj = files.filter(isProjectFile);
    if (!proj.length) return null;
    const imgs = files.filter(isImageFile);
    let d;
    try { d = readProject(await readText(proj[0])); }
    catch (err) { toast('That file has no pin or project data in it'); return null; }
    const pool = imgs.length ? await assetPool(imgs) : null;
    return { d: d, pool: pool, name: proj[0].name };
  }

  function readProject(text) {
    const t = String(text).replace(/^﻿/, '').trim();
    if (t.charAt(0) === '{') return JSON.parse(t);
    const doc = new DOMParser().parseFromString(t, 'text/html');
    /* #vdata is what this app's own Web Viewer writes; #pdata is the older layout */
    const node = doc.querySelector('#vdata') || doc.querySelector('#pdata');
    if (!node) throw new Error('no data');
    return JSON.parse(node.textContent);
  }
  /* A project, report or viewer file may come from anyone, so what it says a
     photo is and what colour a mark is gets checked before it is used. A photo
     is image data, a blob, or a plain relative file name to be matched against
     the images picked with it — never anything that could close an attribute. */
  function safeSrc(u) {
    u = typeof u === 'string' ? u.trim() : '';
    if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(u)) return u;
    if (/^blob:https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (/^[\w\- .()%/]+\.(png|jpe?g|gif|webp|bmp)$/i.test(u) && u.indexOf('..') < 0) return u;
    return '';
  }
  function safeColour(c, fallback) {
    return (typeof c === 'string' && /^(#[0-9a-f]{3,8}|none|transparent)$/i.test(c.trim())) ? c.trim() : fallback;
  }
  function cleanShape(sh) {
    const o = Object.assign({}, sh);
    if ('c' in o) o.c = safeColour(o.c, '#E2483D');
    if ('fill' in o) o.fill = safeColour(o.fill, null);
    if (o.note && typeof o.note === 'object') {
      o.note = Object.assign({}, o.note, {
        text: String(o.note.text || ''),
        replies: Array.isArray(o.note.replies) ? o.note.replies : []
      });
    }
    return o;
  }
  function cleanLoc(L, id) {
    return {
      id: id, n: String(L.n == null ? '' : L.n), ref: String(L.ref || ''), desc: String(L.desc || ''),
      boq: String(L.boq || ''), note: String(L.note || ''),
      photos: (L.photos || []).filter(function (ph) { return ph && safeSrc(ph.src); })
        .map(function (ph) {
          const o = { src: safeSrc(ph.src), cap: String(ph.cap || '') };
          /* the clean original and the marks travel too, so measurements stay editable */
          if (Array.isArray(ph.marks) && ph.marks.length) {
            o.marks = ph.marks;
            o.orig = safeSrc(ph.orig) || o.src;
          }
          return o;
        })
    };
  }

  $('pinProjIn').addEventListener('change', async function (e) {
    const files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    toast('Reading ' + esc(files[0].name) + '…');
    const proj = await takeProjectFiles(files);
    if (proj && await applyProject(proj.d, proj.pool, proj.name) === 'need-pdf') {
      toast('Open the drawing first, then load this report');
    }
  });

  function loadOwnPins(d) {
    const byId = {};
    (d.locations || []).forEach(function (L) { byId[L.id] = L; });
    snapshot();
    let n = 0, skipped = 0;
    d.pins.forEach(function (p) {
      const it = S.items[(p.page | 0) - 1];
      if (!it || !byId[p.id]) { skipped++; return; }
      const id = S.locs[p.id] ? uid() : p.id;
      S.locs[id] = cleanLoc(byId[p.id], id);
      it.shapes.push({ t: 'pin', a: [+p.x, +p.y], id: id });
      n++;
    });
    redrawAll(); updateMeta(); renderPins(); showPinPanel();
    toast('Loaded <b>' + n + '</b> pins' + (skipped ? ' · ' + skipped + ' skipped (page not in this PDF)' : ''));
  }

  /* A Site Photo project marks an image of the drawing in percent. Those percentages
     land on the page on screen, as it is shown — rotated and cropped. */
  function loadSiteProject(d, name) {
    const it = S.items[S.current - 1];
    if (!it || !it.vp) { toast('Open the drawing page first'); return; }
    const vp = it.vp, c = cropRectIn(vp, it.crop);
    const w = c ? c.width : vp.width, h = c ? c.height : vp.height;
    const locs = d.locations.filter(function (L) { return L && isFinite(L.x) && isFinite(L.y); });
    if (!locs.length) { toast('That project has no locations'); return; }
    snapshot();
    locs.forEach(function (L) {
      const id = (L.id && !S.locs[L.id]) ? L.id : uid();
      S.locs[id] = cleanLoc(L, id);
      const vx = it.off.left + (+L.x / 100) * w, vy = it.off.top + (+L.y / 100) * h;
      it.shapes.push({ t: 'pin', a: vp.convertToPdfPoint(vx, vy), id: id });
    });
    redrawAll(); updateMeta(); renderPins(); showPinPanel();
    let warn = '';
    if (d.plan && d.plan.w && d.plan.h) {
      const a1 = d.plan.w / d.plan.h, a2 = w / h;
      if (Math.abs(a1 - a2) / a2 > 0.03) warn = ' · <b>plan shape differs from this page</b> — check positions';
    }
    const np = locs.reduce(function (a, L) { return a + ((L.photos || []).length); }, 0);
    toast('Placed <b>' + locs.length + '</b> pins (' + np + ' photos) on page ' + S.current + warn);
  }

  /* ---- pins in the saved PDF ----
     The discs, the photo appendix and their links are drawn by the engine
     (packages/engine/src/pins.ts); see buildPdf. */
  function dataUrlBytes(u) { return E.dataUrlBytes(u); }

  /* ---------------- text editing ---------------- */

  /* find the whole line of original text under a point (inner coords) */
  function lineUnder(it, x, y) {
    const spans = it.tl.querySelectorAll('span');
    const sf = it.tlScale || S.scale;   /* the word sizes are stored at 100% */
    if (!spans.length) return null;
    const ir = it.inner.getBoundingClientRect();
    let hit = null, hitR = null;
    for (let i = 0; i < spans.length; i++) {
      const r = spans[i].getBoundingClientRect();
      const bx = r.left - ir.left, by = r.top - ir.top;
      if (x >= bx - 1 && x <= bx + r.width + 1 && y >= by - 1 && y <= by + r.height + 1) {
        hit = spans[i]; hitR = { x: bx, y: by, w: r.width, h: r.height };
        break;
      }
    }
    if (!hit) return null;

    const group = [];
    for (let i = 0; i < spans.length; i++) {
      const r = spans[i].getBoundingClientRect();
      const by = r.top - ir.top, bh = r.height;
      const overlap = Math.min(by + bh, hitR.y + hitR.h) - Math.max(by, hitR.y);
      if (overlap > Math.min(bh, hitR.h) * 0.55) {
        group.push({ el: spans[i], x: r.left - ir.left, y: by, w: r.width, h: bh });
      }
    }
    group.sort(function (a, b) { return a.x - b.x; });

    let text = '', prev = null;
    group.forEach(function (g) {
      if (prev && g.x - (prev.x + prev.w) > parseFloat(prev.el.dataset.fh || 8) * sf * 0.25) text += ' ';
      text += g.el.textContent;
      prev = g;
    });

    const left = group[0].x;
    const top = Math.min.apply(null, group.map(function (g) { return g.y; }));
    const right = Math.max.apply(null, group.map(function (g) { return g.x + g.w; }));
    const bottom = Math.max.apply(null, group.map(function (g) { return g.y + g.h; }));
    const fh = parseFloat(hit.dataset.fh || 12) * sf;
    const asc = parseFloat(hit.dataset.asc || 12 * 0.78) * sf;
    return {
      text: text, left: left, top: top, width: right - left, height: bottom - top,
      baseline: parseFloat(hit.dataset.top || 0) * sf + asc, sizePx: fh
    };
  }

  /* dominant colour just outside a box, so the patch blends in */
  function sampleBg(it, box) {
    try {
      const ctx = it.canvas.getContext('2d', { willReadFrequently: true });
      const counts = {};
      const pad = 3;
      const pts = [];
      for (let f = 0; f <= 1; f += 0.2) {
        pts.push([box.left + box.width * f, box.top - pad]);
        pts.push([box.left + box.width * f, box.top + box.height + pad]);
      }
      pts.push([box.left - pad, box.top + box.height / 2]);
      pts.push([box.left + box.width + pad, box.top + box.height / 2]);
      pts.forEach(function (q) {
        const x = Math.round(q[0] * DPR), y = Math.round(q[1] * DPR);
        if (x < 0 || y < 0 || x >= it.canvas.width || y >= it.canvas.height) return;
        const d = ctx.getImageData(x, y, 1, 1).data;
        const k = d[0] + ',' + d[1] + ',' + d[2];
        counts[k] = (counts[k] || 0) + 1;
      });
      let best = null, n = -1;
      Object.keys(counts).forEach(function (k) { if (counts[k] > n) { n = counts[k]; best = k; } });
      if (!best) return '#FFFFFF';
      const p = best.split(',').map(Number);
      return '#' + p.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase();
    } catch (e) { return '#FFFFFF'; }
  }

  function closeEditor(commit) {
    const ed = S.editing;
    if (!ed) return;
    const val = ed.box.querySelector('textarea').value;
    S.editing = null;
    document.body.classList.remove('editing');
    ed.box.remove();

    if (!commit) { drawShapes(ed.it); return; }
    if (!WINANSI_OK.test(val)) {
      toast('Built-in fonts cover Latin text only');
      drawShapes(ed.it);
      return;
    }
    const empty = !val.trim();
    if (empty && !ed.item.patch) { drawShapes(ed.it); return; }

    snapshot();
    /* every style field lives on ed.item already (liveStyle keeps it in sync
       as the toolbar is used) — carry all of it over rather than hand-picking
       fields here, which is exactly how underline/strike went missing before */
    const next = Object.assign({}, ed.item, { text: val });
    if (ed.idx >= 0) ed.it.shapes[ed.idx] = next; else ed.it.shapes.push(next);
    drawShapes(ed.it);
    updateMeta();
    toast(empty ? 'Text covered' : 'Text set');
  }

  /* on-screen size of the editing box — never below 16px on phones,
     or the mobile browser zooms the whole page when the field takes focus */
  function editPx(item) {
    const px = item.size * S.scale;
    return isMobile() ? Math.max(16, px) : px;
  }

  function openEditor(it, pt, idx) {
    if (S.editing) closeEditor(true);
    const vp = it.vp;
    if (!vp) return;

    let item, box;
    if (idx >= 0) {
      /* re-open an existing text item */
      const s0 = it.shapes[idx];
      item = Object.assign({}, s0);
      box = textBox(s0, vp);
    } else {
      const line = lineUnder(it, pt[0], pt[1]);
      if (line) {
        const size = line.sizePx / S.scale;
        const pad = 2;
        const b = { left: line.left - pad, top: line.top - pad, width: line.width + pad * 2, height: line.height + pad * 2 };
        const tl = vp.convertToPdfPoint(b.left, b.top);
        const br = vp.convertToPdfPoint(b.left + b.width, b.top + b.height);
        const base = vp.convertToPdfPoint(line.left, line.baseline);
        item = {
          t: 'text', a: base, text: line.text, size: Math.round(size * 10) / 10,
          c: '#1C1F24', f: S.font, b: S.bold, i: S.ital, u: S.underline, k: S.strike,
          align: S.align, bg: null, bgOp: S.bgOp,
          patch: {
            x: Math.min(tl[0], br[0]), y: Math.min(tl[1], br[1]),
            w: Math.abs(br[0] - tl[0]), h: Math.abs(br[1] - tl[1]),
            c: sampleBg(it, b)
          }
        };
        box = b;
        $('txSize').value = item.size;
      } else {
        const size = S.size;
        const base = vp.convertToPdfPoint(pt[0], pt[1] + size * S.scale * 0.82);
        item = {
          t: 'text', a: base, text: '', size: size, c: S.color, f: S.font, b: S.bold, i: S.ital,
          u: S.underline, k: S.strike, align: S.align, bg: S.bg, bgOp: S.bgOp, patch: null
        };
        box = { left: pt[0], top: pt[1], width: Math.max(160, size * S.scale * 10), height: size * S.scale * 1.5 };
      }
    }

    const wrapEl = document.createElement('div');
    wrapEl.className = 'texted';
    wrapEl.style.left = box.left + 'px';
    wrapEl.style.top = box.top + 'px';
    wrapEl.style.width = Math.max(isMobile() ? 150 : 90, box.width) + 'px';

    const ta = document.createElement('textarea');
    ta.value = item.text;
    ta.rows = 1;
    ta.style.fontFamily = CSS_FONT[item.f];
    ta.style.fontSize = editPx(item) + 'px';
    ta.style.fontWeight = item.b ? '700' : '400';
    ta.style.fontStyle = item.i ? 'italic' : 'normal';
    ta.style.textDecoration = textDecoLine(item);
    ta.style.textAlign = item.align || 'left';
    ta.style.color = item.c;
    ta.style.background = item.bg ? cssRgba(item.bg, item.bgOp == null ? 1 : item.bgOp)
                          : item.patch ? item.patch.c : 'rgba(255,255,255,.94)';
    ta.style.height = Math.max(box.height, editPx(item) * 1.35) + 'px';

    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.innerHTML = '<button class="ok" data-a="ok">Apply</button><button data-a="no">Cancel</button>';
    acts.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      e.stopPropagation();
      closeEditor(b.dataset.a === 'ok');
    });

    wrapEl.appendChild(ta); wrapEl.appendChild(acts);
    it.inner.appendChild(wrapEl);
    document.body.classList.add('editing');
    S.editing = { it: it, item: item, idx: idx, box: wrapEl, at: Date.now() };

    /* hide the live item while its editor is open */
    if (idx >= 0) {
      const keep = it.shapes[idx];
      it.shapes[idx] = Object.assign({}, keep, { text: '' });
      drawShapes(it);
      it.shapes[idx] = keep;
    }

    function grow() { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', function (e) {
      e.stopPropagation();
      /* Enter drops to the next line, like a normal text editor — it does not
         close the box. Apply, click outside, or Escape finish editing. */
      if ((e.key === 'Enter' || e.key === 'Return') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeEditor(true); }
      if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
    });
    ta.focus(); ta.select(); grow();
  }

  /* ---------------- crop ---------------- */
  async function applyCrop(it, rect, all) {
    snapshot();
    if (all) {
      await ensureAllPages();
      /* same crop insets on every page, measured from each page's own box */
      const ref = it.page.view;
      const dl = rect.x - ref[0], db = rect.y - ref[1];
      const dr = (ref[2] - (rect.x + rect.w)), dt = (ref[3] - (rect.y + rect.h));
      S.items.forEach(function (x) {
        if (!x.page) return;
        const v = x.page.view;
        const nx = v[0] + dl, ny = v[1] + db;
        const nw = (v[2] - dr) - nx, nh = (v[3] - dt) - ny;
        if (nw > 20 && nh > 20) { x.crop = { x: nx, y: ny, w: nw, h: nh }; x.thumbDone = false; }
      });
      toast('Cropped every page · <b>Ctrl+Z</b> to undo');
    } else {
      it.crop = rect;
      it.thumbDone = false;
      toast('Page cropped · Shift-drag crops all pages');
    }
    S.items.forEach(function (x) { x.box.classList.toggle('cropped', !!x.crop); });
    relayout().then(function () { drawVisibleThumbs(); updateMeta(); });
  }

  function resetCrop(allPages) {
    snapshot();
    const list = allPages ? S.items : [S.items[S.current - 1]];
    list.forEach(function (x) { if (x) { x.crop = null; x.thumbDone = false; x.box.classList.remove('cropped'); } });
    relayout().then(function () { drawVisibleThumbs(); updateMeta(); });
    toast(allPages ? 'Crop reset on all pages' : 'Crop reset');
  }

  /* ---------------- page editing ---------------- */
  function removeItem(i) {
    if (S.items.length <= 1) { toast('A PDF needs at least one page'); return; }
    snapshot();
    const it = S.items[i];
    if (it.task) { try { it.task.cancel(); } catch (e) {} }
    if (S.sel && S.sel.it === it) S.sel = null;
    S.items.splice(i, 1);
    if (S.query) invalidateSearch();
    syncAll().then(function () {
      setCurrent(Math.min(i + 1, S.items.length));
      toast('Page removed · <b>Ctrl+Z</b> to undo');
    });
  }

  function moveItem(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= S.items.length) return;
    snapshot();
    const it = S.items[i];
    S.items.splice(i, 1); S.items.splice(j, 0, it);
    syncAll().then(function () { goTo(j + 1); });
  }

  function rotateItem(i, deg) {
    const it = S.items[i]; if (!it) return;
    snapshot();
    it.rot = ((it.rot + deg) % 360 + 360) % 360;
    it.thumbDone = false; it.rendered = false; it.tl.innerHTML = '';
    relayout().then(function () { drawThumb(it); updateMeta(); });
  }

  function rotateAll(deg) {
    snapshot();
    S.items.forEach(function (it) {
      it.rot = ((it.rot + deg) % 360 + 360) % 360;
      it.thumbDone = false; it.rendered = false; it.tl.innerHTML = '';
    });
    relayout().then(function () { drawVisibleThumbs(); updateMeta(); });
    toast('All pages rotated');
  }

  /* Merge one or many PDFs in. `at` is the slot they land in — S.current inserts
     after the page on screen, S.items.length joins them on at the end. The whole
     batch is a single undo step. */
  let merging = false;
  async function insertPdfs(list, at) {
    if (merging) { toast('Still adding the last batch — one moment'); return; }
    const files = Array.prototype.slice.call(list || []);
    const pdfs = files.filter(isPdf);
    const skipped = files.length - pdfs.length;
    if (!pdfs.length) {
      toast(files.length > 1 ? 'None of those are PDFs' : 'That is not a PDF');
      return;
    }

    merging = true;
    if (pdfs.length > 1) toast('Reading <b>' + pdfs.length + '</b> PDFs…');
    const loaded = [], failed = [];
    try {
      for (const f of pdfs) {
        try {
          const bytes = await readBytes(f);
          const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
          loaded.push({ name: f.name, bytes: bytes, doc: doc });
        } catch (e) { failed.push(f.name); }
      }
    } finally { merging = false; }

    if (!loaded.length) {
      toast(failed.length > 1 ? 'None of those PDFs could be opened' : 'That PDF could not be opened');
      return;
    }

    if (at == null) at = S.current;
    at = Math.max(0, Math.min(S.items.length, at));

    snapshot();
    const added = [];
    loaded.forEach(function (L) {
      const src = { id: ++srcId, name: L.name, bytes: L.bytes, doc: L.doc };
      S.sources.push(src);
      for (let i = 1; i <= L.doc.numPages; i++) added.push(newItem(src, i, 0, true));
    });
    S.items.splice.apply(S.items, [at, 0].concat(added));
    invalidateSearch();
    await syncAll();
    goTo(at + 1);

    const bits = [added.length + (added.length === 1 ? ' page' : ' pages') + ' added'];
    if (loaded.length > 1) bits.push('from <b>' + loaded.length + '</b> files');
    if (failed.length) bits.push(failed.length + ' could not be opened');
    else if (skipped) bits.push(skipped + ' skipped');
    toast(bits.join(' · '));
  }

  /* Register a PDF the modules produced (merge, insert, blank, stamp sheet)
     so its pages can join S.items like any opened file. */
  async function addSource(name, bytes, synthetic) {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const src = { id: ++srcId, name: name, bytes: bytes, doc: doc };
    if (synthetic) src.synthetic = true;
    S.sources.push(src);
    return src;
  }

  async function insertBlank() {
    const ref = S.items[S.current - 1];
    await ensurePage(ref);
    const v = ref.page.view;
    const d = await PDFLib.PDFDocument.create();
    d.addPage([v[2] - v[0], v[3] - v[1]]);
    const bytes = await d.save();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    snapshot();
    const src = { id: ++srcId, name: 'Blank page', bytes: bytes, doc: doc, synthetic: true };
    S.sources.push(src);
    S.items.splice(S.current, 0, newItem(src, 1, 0, true));
    await syncAll();
    goTo(S.current + 1);
    toast('Blank page added');
  }

  /* ---------------- saving ---------------- */
  /* Source documents are kept in an optional cache so that splitting a file page by
     page does not re-parse the same original once for every page it produces. */
  async function loadSrc(s, cache) { return E.loadSrc(s, cache); }

  /* rebuilds the given items into a fresh PDF, carrying rotation, crop, marks and
     text. The work is in the engine; core supplies what only it knows: the
     modules' painters and hooks, and how photo pins are drawn. */
  /* Characters the standard PDF fonts cannot draw (✓ →, Greek, Cyrillic…) are
     saved in DejaVu Sans, and emoji in Noto Emoji, each embedded as a subset.
     They and fontkit, which pdf-lib needs to embed them, load the first time a
     save needs them. The service worker installs fontkit and DejaVu Sans with
     the app (1.5 MB); Noto Emoji (1.9 MB) is cached the first time it is used. */
  let unicodeFont = null;
  function loadUnicodeFont() {
    if (!unicodeFont) {
      const kit = window.fontkit ? Promise.resolve(window.fontkit) : new Promise(function (ok, fail) {
        const sc = document.createElement('script');
        sc.src = 'js/vendor/fontkit.umd.min.js';
        sc.onload = function () { window.fontkit ? ok(window.fontkit) : fail(new Error('fontkit missing')); };
        sc.onerror = function () { sc.remove(); fail(new Error('fontkit did not load')); };
        document.head.appendChild(sc);
      });
      const font = fetch('assets/fonts/DejaVuSans.ttf').then(function (r) {
        if (!r.ok) throw new Error('font: HTTP ' + r.status);
        return r.arrayBuffer();
      });
      unicodeFont = Promise.all([kit, font]).then(function (got) {
        return { fontkit: got[0], bytes: new Uint8Array(got[1]) };
      });
      /* a failed load (offline before it was ever cached) is tried again next save */
      unicodeFont.catch(function () { unicodeFont = null; });
    }
    return unicodeFont;
  }

  let emojiFont = null;
  function loadEmojiFont() {
    if (!emojiFont) {
      emojiFont = fetch('assets/fonts/NotoEmoji.ttf').then(function (r) {
        if (!r.ok) throw new Error('emoji font: HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) { return new Uint8Array(buf); });
      emojiFont.catch(function () { emojiFont = null; });
    }
    return emojiFont;
  }

  async function buildPdf(items, cache, opts) {
    thumbsPause();
    try { return await buildPdfNow(items, cache, opts); }
    finally { thumbsResume(); }
  }
  function buildPdfNow(items, cache, opts) {
    return E.buildPdf(items, cache, opts, {
      measure: textWidth,
      unicode: { load: loadUnicodeFont, loadEmoji: loadEmojiFont },
      fontNeeds: EXT.fontNeeds,
      shapePainters: EXT.shapePainters,
      prepare: EXT.prepare,
      finish: EXT.finish,
      pins: E.pinHooks(S.locs, { docName: function () { return S.baseName; }, breathe: breathe })
    });
  }

  /* What went wrong in building a PDF, for the reader: an encrypted source
     (the engine refuses it, since its pages would come out blank) or
     anything else, with the error's own words. Plain text; esc() it for
     HTML. */
  function saveError(err, what) {
    const doing = what || 'This PDF could not be built';
    if (err && err.name === 'EncryptedSourceError') {
      return doing + ': the original is password-protected (encrypted), and its pages would come ' +
        'out blank. Save an unprotected copy of it in the app that made it, then open that.';
    }
    const why = err && err.message ? String(err.message).slice(0, 160) : 'an unexpected error';
    return doing + ' (' + why + '). Nothing is lost: the document is still open. Try again; if it ' +
      'keeps failing, the original file may be damaged.';
  }

  async function saveAs(name) {
    const btn = $('saveGo');
    btn.disabled = true; btn.textContent = 'Building…';
    try {
      const photos = !$('savePhotosRow').hidden && $('savePhotos').checked;
      if (photos) toast('Building the PDF with photo pages…');
      download(await buildPdf(S.items, null, { photos: photos }), name);
      closePops();
      toast('Saved <b>' + esc(name) + '</b>');
      S.baseCount = S.items.length;
    } catch (e) {
      $('saveNote').innerHTML = '<span style="color:var(--danger)">' + esc(saveError(e)) + '</span>';
    } finally {
      btn.disabled = false; btn.textContent = 'Save PDF';
    }
  }

  function download(bytes, name, type) {
    /* the browser is copying the file out and writing it to disk: thumbnails,
       drawn in a worker alongside, wait until that is done rather than
       compete with it */
    thumbsPause();
    setTimeout(thumbsResume, 1500);
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/pdf' }));
    try {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { window.open(url, '_blank'); }
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  /* ---------------- extracting pages ---------------- */
  /* A store-only zip. PDF streams are already compressed, so deflating them again
     would cost time and save almost nothing — and this keeps the writer tiny. */
  function zipStore(files) { return new Blob([E.zipStore(files)], { type: 'application/zip' }); }

  /* "2, 5-7, 4" -> [2,4,5,6,7], clamped to the pages that exist */
  function parseRanges(str, max) { return E.parseRanges(str, max); }
  function formatRanges(nums) { return E.formatRanges(nums); }
  function rangeTag(nums) { return E.rangeTag(nums); }
  function allPages() { return S.items.map(function (_, i) { return i + 1; }); }
  function pickedPages() {
    const out = [];
    S.items.forEach(function (it, i) { if (it.pick) out.push(i + 1); });
    return out;
  }
  /* let the browser paint the progress line between builds; a backgrounded tab
     never fires requestAnimationFrame, so a timer has to be able to win the race */
  function breathe() {
    return new Promise(function (r) {
      let done = false;
      const go = function () { if (!done) { done = true; r(); } };
      requestAnimationFrame(function () { setTimeout(go, 0); });
      setTimeout(go, 60);
    });
  }

  /* pages ticked in the sidebar */
  function syncPicks() {
    let n = 0;
    S.items.forEach(function (it) {
      if (it.pick) n++;
      if (it.tickbox) {
        it.tickbox.classList.toggle('on', !!it.pick);
        it.tickbox.setAttribute('aria-pressed', it.pick ? 'true' : 'false');
      }
      if (it.thumb) it.thumb.classList.toggle('picked', !!it.pick);
    });
    document.body.classList.toggle('picking', n > 0);
    const c = $('exCount');
    c.textContent = n ? String(n) : '';
    c.hidden = !n;
    $('btnExtract').classList.toggle('on', n > 0);
    if (!$('extractPop').hidden) exUpdate();
    if (!$('jpgPop').hidden) jpgUpdate();
    return n;
  }
  function setPicks(nums) {
    const want = {};
    nums.forEach(function (n) { want[n] = 1; });
    S.items.forEach(function (it, i) { it.pick = !!want[i + 1]; });
    syncPicks();
  }

  function exNums() { return parseRanges($('exRange').value, S.items.length); }

  function exUpdate() {
    const n = S.items.length, picked = pickedPages().length;
    const chips = $('exChips');
    const chipPick = chips.querySelector('[data-r="pick"]');
    const chipClear = chips.querySelector('[data-r="clear"]');
    chipPick.disabled = !picked;
    chipPick.textContent = picked ? 'Ticked (' + picked + ')' : 'Ticked';
    chipClear.disabled = !picked;
    $('exAllNote').textContent = n === 1
      ? 'One click \u00b7 this document has a single page'
      : 'One click \u00b7 ' + n + ' pages \u2192 ' + n + ' files in one .zip';

    const p = exNums();
    $('exOne').disabled = $('exSep').disabled = !p.length || exBusy;
    $('exSep').textContent = p.length === 1 ? 'Separate PDF' : 'Separate PDFs';
    if (exBusy) return;
    $('exNote').innerHTML = p.length
      ? '<b>' + p.length + '</b> of ' + n + ' pages \u00b7 ' + esc(formatRanges(p)) +
        '<br>Numbers follow the order shown in the sidebar.'
      : 'Type page numbers \u2014 <b>1-3, 7, 12-15</b> \u2014 or tick pages in the sidebar.';
  }

  function prepExtract() {
    const picked = pickedPages();
    if (picked.length) $('exRange').value = formatRanges(picked);
    else if (!exNums().length) $('exRange').value = formatRanges(allPages());
    exUpdate();
  }

  async function runExtract(nums, separate) {
    if (exBusy || !nums.length || !S.items.length) return;
    exBusy = true;
    const note = $('exNote');
    $('exAll').disabled = $('exOne').disabled = $('exSep').disabled = true;
    try {
      if (!separate || nums.length === 1) {
        note.textContent = 'Building\u2026';
        await breathe();
        const bytes = await buildPdf(nums.map(function (i) { return S.items[i - 1]; }), new Map());
        const name = S.baseName + '-p' + rangeTag(nums) + '.pdf';
        download(bytes, name);
        toast('Extracted <b>' + nums.length + '</b> ' + (nums.length === 1 ? 'page' : 'pages') +
              ' to <b>' + esc(name) + '</b>');
      } else {
        const cache = new Map(), files = [];
        const pad = String(S.items.length).length;
        for (let i = 0; i < nums.length; i++) {
          note.textContent = 'Building page ' + nums[i] + ' \u2014 ' + (i + 1) + ' of ' + nums.length + '\u2026';
          await breathe();
          const bytes = await buildPdf([S.items[nums[i] - 1]], cache);
          files.push({
            name: S.baseName + '-p' + String(nums[i]).padStart(pad, '0') + '.pdf',
            data: new Uint8Array(bytes)
          });
        }
        note.textContent = 'Packing ' + files.length + ' files into a .zip\u2026';
        await breathe();
        const name = S.baseName + '-pages.zip';
        download(zipStore(files), name, 'application/zip');
        toast('Extracted <b>' + files.length + '</b> separate PDFs to <b>' + esc(name) + '</b>');
      }
      exBusy = false;
      closePops(true);
    } catch (err) {
      note.innerHTML = '<span style="color:var(--danger)">' +
        esc(saveError(err, 'These pages could not be extracted')) + '</span>';
    } finally {
      exBusy = false;
      $('exAll').disabled = false;
      if (!$('extractPop').hidden) exUpdate();
    }
  }

  /* ---------------- pages as JPG ---------------- */
  /* A page becomes an image exactly as it reads on screen — rotated, cropped and
     with every mark burned in. The reading theme is a screen filter only, so the
     paper in the file always comes out white. */
  let jpgBusy = false;
  const JPG_MAX_SIDE = 10000;   /* past this a canvas quietly fails on phones */

  function jpgNums() { return parseRanges($('jpgRange').value, S.items.length); }
  function jpgDpi() { return parseInt($('jpgDpi').value, 10) || 150; }
  function jpgQuality() { return parseFloat($('jpgQ').value) || 0.92; }

  function jpgViewport(it, dpi) {
    const rot = it.page.rotate + it.rot;
    let scale = dpi / 72;
    const v1 = it.page.getViewport({ scale: 1, rotation: rot });
    const c1 = cropRectIn(v1, it.crop);
    const cap = JPG_MAX_SIDE / Math.max(c1 ? c1.width : v1.width, c1 ? c1.height : v1.height);
    if (scale > cap) scale = cap;
    return it.page.getViewport({ scale: scale, rotation: rot });
  }

  /* the marks, rebuilt at export size — S.scale drives their stroke and type
     sizes, so it stands in for the export scale while the tree is built */
  function annoSvg(it, vp, noPins) {
    const list = it.shapes.filter(function (sh) { return !(noPins && sh.t === 'pin'); });
    if (!list.length) return null;
    const keepScale = S.scale, keepSel = S.sel;
    S.scale = vp.scale; S.sel = null;
    const svg = document.createElementNS(SVGNS, 'svg');
    try {
      svg.setAttribute('xmlns', SVGNS);
      svg.setAttribute('width', vp.width);
      svg.setAttribute('height', vp.height);
      svg.setAttribute('viewBox', '0 0 ' + vp.width + ' ' + vp.height);
      /* the page stylesheet does not travel with a serialised SVG */
      const st = document.createElementNS(SVGNS, 'style');
      st.textContent = '.sh{fill:none;stroke-linecap:round;stroke-linejoin:round}' +
                       '.tx{stroke:none;white-space:pre}.patch{stroke:none}';
      svg.appendChild(st);
      list.forEach(function (sh) { svg.appendChild(shapeEl(it, sh, vp, -1)); });
    } finally { S.scale = keepScale; S.sel = keepSel; }
    return svg;
  }

  function svgImage(svg) {
    return new Promise(function (res) {
      const xml = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }

  function canvasJpeg(cv, q) {
    return new Promise(function (res, rej) {
      if (cv.toBlob) {
        cv.toBlob(function (b) { b ? res(b) : rej(new Error('encode failed')); }, 'image/jpeg', q);
        return;
      }
      const bin = atob(cv.toDataURL('image/jpeg', q).split(',')[1]);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      res(new Blob([u], { type: 'image/jpeg' }));
    });
  }

  async function pageToJpeg(it, dpi, q, noPins) {
    await ensurePage(it);
    /* the viewer may be painting this same page — let that finish first */
    if (it.task) { try { await it.task.promise; } catch (e) {} }
    const vp = jpgViewport(it, dpi);
    const c = cropRectIn(vp, it.crop);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(c ? c.width : vp.width));
    cv.height = Math.max(1, Math.round(c ? c.height : vp.height));
    const ctx = cv.getContext('2d', { alpha: false });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const ox = c ? -c.left : 0, oy = c ? -c.top : 0;
    await drawPageInto(it, vp, ctx, {
      background: '#FFFFFF', transform: (ox || oy) ? [1, 0, 0, 1, ox, oy] : null
    });
    const svg = annoSvg(it, vp, noPins);
    if (svg) {
      const img = await svgImage(svg);
      if (img) ctx.drawImage(img, ox, oy, vp.width, vp.height);
    }
    const blob = await canvasJpeg(cv, q);
    cv.width = cv.height = 1;     /* drop the bitmap before the next page starts */
    return blob;
  }

  function jpgUpdate(keepNote) {
    const n = S.items.length, picked = pickedPages().length;
    const chips = $('jpgChips');
    const chipPick = chips.querySelector('[data-r="pick"]');
    const chipClear = chips.querySelector('[data-r="clear"]');
    chipPick.disabled = !picked;
    chipPick.textContent = picked ? 'Ticked (' + picked + ')' : 'Ticked';
    chipClear.disabled = !picked;
    $('jpgAllNote').textContent = n === 1
      ? 'One click \u00b7 this document has a single page'
      : 'One click \u00b7 ' + n + ' pages \u2192 ' + n + ' images in one .zip';

    const p = jpgNums();
    $('jpgGo').disabled = !p.length || jpgBusy;
    $('jpgGo').textContent = p.length === 1 ? 'Save JPG' : 'Save JPGs';
    $('jpgAll').disabled = jpgBusy;
    if (jpgBusy || keepNote) return;
    $('jpgNote').innerHTML = p.length
      ? '<b>' + p.length + '</b> of ' + n + ' ' + (n === 1 ? 'page' : 'pages') + ' \u00b7 ' +
        esc(formatRanges(p)) +
        (p.length === 1 ? '<br>One .jpg, at the size you pick above.'
                        : '<br>One .jpg per page, delivered together in a .zip.')
      : 'Type page numbers \u2014 <b>1-3, 7, 12-15</b> \u2014 or tick pages in the sidebar.';
  }

  function prepJpg() {
    const picked = pickedPages();
    if (picked.length) $('jpgRange').value = formatRanges(picked);
    else if (!jpgNums().length) $('jpgRange').value = formatRanges(allPages());
    jpgUpdate();
  }

  async function runJpg(nums) {
    if (jpgBusy || !nums.length || !S.items.length) return;
    jpgBusy = true;
    let failed = false;
    const note = $('jpgNote'), dpi = jpgDpi(), q = jpgQuality();
    const pad = String(S.items.length).length;
    $('jpgAll').disabled = $('jpgGo').disabled = true;
    try {
      if (nums.length === 1) {
        note.textContent = 'Rendering page ' + nums[0] + '\u2026';
        await breathe();
        const blob = await pageToJpeg(S.items[nums[0] - 1], dpi, q);
        const name = S.baseName + '-p' + String(nums[0]).padStart(pad, '0') + '.jpg';
        download(blob, name, 'image/jpeg');
        toast('Saved <b>' + esc(name) + '</b> \u00b7 ' + bytesLabel(blob.size));
      } else {
        const files = [];
        let total = 0;
        for (let i = 0; i < nums.length; i++) {
          note.textContent = 'Rendering page ' + nums[i] + ' \u2014 ' + (i + 1) +
                             ' of ' + nums.length + '\u2026';
          await breathe();
          const blob = await pageToJpeg(S.items[nums[i] - 1], dpi, q);
          total += blob.size;
          files.push({
            name: S.baseName + '-p' + String(nums[i]).padStart(pad, '0') + '.jpg',
            data: new Uint8Array(await blob.arrayBuffer())
          });
        }
        note.textContent = 'Packing ' + files.length + ' images into a .zip\u2026';
        await breathe();
        const name = S.baseName + '-jpg.zip';
        download(zipStore(files), name, 'application/zip');
        toast('Saved <b>' + files.length + '</b> JPGs to <b>' + esc(name) + '</b> \u00b7 ' +
              bytesLabel(total));
      }
      jpgBusy = false;
      closePops(true);
    } catch (err) {
      failed = true;
      note.innerHTML = '<span style="color:var(--danger)">These pages could not be turned into ' +
        'images \u2014 try a lower detail setting, or fewer pages at a time.</span>';
    } finally {
      jpgBusy = false;
      if (!$('jpgPop').hidden) jpgUpdate(failed);
      else { $('jpgAll').disabled = false; $('jpgGo').disabled = false; }
    }
  }

  /* ---------------- navigation ---------------- */
  /* a jump holds its page in view while pages load (see jumpHold); the
     reader scrolling, touching, clicking or typing in the pages lets go */
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) {
    stage.addEventListener(type, function () { jumpHold = null; }, { passive: true });
  });

  function goTo(n) {
    n = Math.max(1, Math.min(S.items.length, n));
    const it = S.items[n - 1]; if (!it) return;
    S.jumping = true;
    stage.scrollTop = it.box.offsetTop - 14;
    jumpHold = it;
    mountPage(it);
    setCurrent(n);
    setTimeout(function () { S.jumping = false; }, 320);
  }

  let curMarked = null;
  function setCurrent(n) {
    S.current = Math.max(1, Math.min(S.items.length, n));
    $('pageIn').value = String(S.current);
    const it = S.items[S.current - 1];
    /* only the page that stops being current and the one that starts */
    if (curMarked && curMarked !== it) {
      curMarked.thumb && curMarked.thumb.classList.remove('active');
      curMarked.box && curMarked.box.classList.remove('cur');
    }
    if (it) {
      it.thumb && it.thumb.classList.add('active');
      it.box && it.box.classList.add('cur');
    }
    curMarked = it || null;
    if (it && it.thumb && !rail.hidden) {
      const host = $('railPages'), t = it.thumb.offsetTop;
      if (t < host.scrollTop || t > host.scrollTop + host.clientHeight - 70) host.scrollTop = t - 40;
    }
  }

  let rafPending = false;
  stage.addEventListener('scroll', function () {
    if (!S.items.length) return;
    thumbsYield();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      if (!S.jumping) {
        /* the last page starting above the reading line, by bisection */
        const mid = stage.scrollTop + stage.clientHeight * .35;
        let lo = 0, hi = S.items.length - 1, best = 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          if (S.items[m].box.offsetTop <= mid) { best = m + 1; lo = m + 1; } else hi = m - 1;
        }
        if (best !== S.current) setCurrent(best);
      }
      renderVisible();
      detailSoon();
    });
  });

  /* ---------------- search ---------------- */
  function invalidateSearch() { S.hits = []; S.hitIndex = -1; $('hitList').innerHTML = ''; hitsShown = 0; if (S.query) runSearch(); }

  async function textOf(it) {
    const key = it.src.id + ':' + it.num;
    if (S.textCache.has(key)) return S.textCache.get(key);
    /* a page pdf.js cannot load reads as empty, and is tried again next time */
    try { await ensurePage(it); } catch (e) { return ''; }
    let s = '';
    try {
      const tc = await it.page.getTextContent();
      s = tc.items.map(function (x) { return x.str; }).join(' ');
    } catch (e) {}
    S.textCache.set(key, s);
    return s;
  }

  let findTimer;
  $('findIn').addEventListener('input', function () {
    clearTimeout(findTimer); findTimer = setTimeout(runSearch, 220);
  });
  $('findIn').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (S.hits.length) stepHit(e.shiftKey ? -1 : 1); }
  });

  async function runSearch() {
    thumbsPause();
    try { await searchNow(); }
    finally { thumbsResume(); }
  }
  async function searchNow() {
    const q = $('findIn').value.trim();
    S.query = q; S.hits = []; S.hitIndex = -1;
    $('hitList').innerHTML = ''; hitsShown = 0; revealFor = null; clearMarks();
    if (q.length < 2) { $('hitCount').textContent = q ? 'Type at least two characters' : ''; return; }
    $('hitCount').textContent = 'Reading text…';
    const needle = q.toLowerCase();
    /* pages are read a few at a time, so the pdf.js worker always has the next
       one to work on, and looked through in order */
    const items = S.items.slice(), total = items.length, BATCH = 8;
    for (let at = 0; at < total; at += BATCH) {
      const texts = await Promise.all(items.slice(at, at + BATCH).map(textOf));
      if (S.query !== q) return;
      for (let k = 0; k < texts.length; k++) {
        const t = texts[k], hay = t.toLowerCase();
        let from = 0, idx, nth = 0;
        /* every match (the list is written as it is read, see showHits); only
           a word found tens of thousands of times stops early. There used to
           be a limit of 400 that stopped only the page it was reached on, so
           every later page then listed just its first match. */
        while (S.hits.length < MAX_HITS && (idx = hay.indexOf(needle, from)) !== -1) {
          S.hits.push({ page: at + k + 1, nth: nth++, snippet: snippetOf(t, idx, q.length) });
          from = idx + needle.length;
        }
      }
      if (S.hits.length >= MAX_HITS) break;
      if (total > 40) $('hitCount').textContent = 'Reading text… ' + Math.min(total, at + BATCH) + ' of ' + total + ' pages';
    }
    $('hitCount').textContent = S.hits.length >= MAX_HITS
      ? 'The first ' + MAX_HITS.toLocaleString() + ' matches · Enter to step through'
      : S.hits.length
        ? S.hits.length + (S.hits.length === 1 ? ' match' : ' matches') + ' · Enter to step through'
        : 'No matches';
    hitsShown = 0;
    showHits(HIT_CHUNK);
    S.items.forEach(function (it) { if (it.rendered) markItem(it); });
    if (S.hits.length) activateHit(0);
  }

  /* The list of results is written a chunk at a time: the first ones, and
     more as it is scrolled near its end or a step reaches past them. A word
     found thousands of times made thousands of rows (7,000 elements for
     2,376 matches), most of them never looked at. */
  const HIT_CHUNK = 150;
  const MAX_HITS = 50000;
  let hitsShown = 0;
  function showHits(upTo) {
    const n = Math.min(S.hits.length, upTo);
    if (n <= hitsShown) return;
    const frag = document.createDocumentFragment();
    for (let i = hitsShown; i < n; i++) {
      const h = S.hits[i];
      const b = document.createElement('button');
      b.className = 'hit-item';
      b.dataset.i = i;
      if (i === S.hitIndex) b.classList.add('active');
      b.innerHTML = '<span class="pg">Page ' + h.page + '</span>' + h.snippet;
      frag.appendChild(b);
    }
    $('hitList').appendChild(frag);
    hitsShown = n;
  }
  $('hitList').addEventListener('click', function (e) {
    const b = e.target.closest('.hit-item');
    if (!b) return;
    activateHit(+b.dataset.i);
    if (isMobile()) setRail(false);
  });
  $('railFind').addEventListener('scroll', function () {
    const r = $('railFind');
    if (hitsShown < S.hits.length && r.scrollTop + r.clientHeight > r.scrollHeight - 600) {
      showHits(hitsShown + HIT_CHUNK);
    }
  }, { passive: true });

  function snippetOf(t, at, len) {
    const a = Math.max(0, at - 42), b = Math.min(t.length, at + len + 52);
    return (a > 0 ? '…' : '') + esc(t.slice(a, at)) + '<mark>' + esc(t.slice(at, at + len)) +
           '</mark>' + esc(t.slice(at + len, b)) + (b < t.length ? '…' : '');
  }

  function activateHit(i) {
    if (!S.hits[i]) return;
    const was = $('hitList').children[S.hitIndex];
    if (was) was.classList.remove('active');
    S.hitIndex = i;
    showHits(i + 1);                              /* a step past the rows written so far */
    const el = $('hitList').children[i];
    if (el) el.classList.add('active');
    if (el) el.scrollIntoView({ block: 'nearest' });
    const hit = S.hits[i];
    const it = S.items[hit.page - 1];
    if (!it) return;
    /* the match stepped from may be on another page: it is current no more */
    stage.querySelectorAll('mark.hitw.now').forEach(function (m) { m.classList.remove('now'); });
    /* the match is shown where it is on its page: a step to the next match
       on the page being read scrolls there, rather than back to the top */
    revealFor = it;
    if (it.box && it.mounted && it.tl && it.tl.firstChild && screenGap(it) === 0) markAndReveal(it);
    else {
      goTo(hit.page);
      /* hold the hit itself: a new search may have emptied the list by then;
         a page drawn meanwhile marks and reveals it itself (paintItem) */
      setTimeout(function () { markAndReveal(it); }, 280);
    }
  }
  function stepHit(d) { if (S.hits.length) activateHit((S.hitIndex + d + S.hits.length) % S.hits.length); }
  /* Each match is marked where it is in the words of the page, not the whole
     run of text around it, and the one stepped to more strongly. The run's
     text is split around its matches; clearing puts it back whole. */
  let revealFor = null;          /* the page whose current match still wants showing */
  function clearMarks() {
    S.items.forEach(function (it) { if (it.tl) unmark(it); });
  }
  function unmark(it) {
    it.tl.querySelectorAll('mark.hitw').forEach(function (m) {
      const span = m.parentNode;
      if (span && span.parentNode) { const whole = span.textContent; span.textContent = whole; }
    });
  }
  function markItem(it) {
    if (!it.tl) return;
    unmark(it);
    if (!S.query) return;
    const q = S.query.toLowerCase();
    const cur = S.hits[S.hitIndex];
    const nth = cur && S.items[cur.page - 1] === it ? cur.nth : -1;
    const marks = [];
    it.tl.querySelectorAll('span').forEach(function (span) {
      const t = span.textContent, low = t.toLowerCase();
      let idx = low.indexOf(q);
      if (idx === -1) return;
      const frag = document.createDocumentFragment();
      let from = 0;
      while (idx !== -1) {
        if (idx > from) frag.appendChild(document.createTextNode(t.slice(from, idx)));
        const m = document.createElement('mark');
        m.className = 'hitw';
        m.textContent = t.slice(idx, idx + q.length);
        frag.appendChild(m);
        marks.push(m);
        from = idx + q.length;
        idx = low.indexOf(q, from);
      }
      if (from < t.length) frag.appendChild(document.createTextNode(t.slice(from)));
      span.textContent = '';
      span.appendChild(frag);
    });
    /* a match the search found across two runs of text has no mark of its
       own: the last one on the page stands in */
    if (nth >= 0 && marks.length) marks[Math.min(nth, marks.length - 1)].classList.add('now');
  }
  function markAndReveal(it) {
    if (!S.query) return;
    markItem(it);
    if (revealFor !== it) return;
    const m = it.tl && it.tl.querySelector('mark.hitw.now');
    if (!m) return;
    revealFor = null;
    const r = m.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const dy = r.top < sr.top + 40 || r.bottom > sr.bottom - 40 ? r.top - (sr.top + sr.height / 2) : 0;
    const dx = r.left < sr.left || r.right > sr.right ? r.left - (sr.left + sr.width / 2) : 0;
    /* the reader's place is the match now: a jump's hold on the top of its
       page (flushResizes) must not pull the view back there */
    jumpHold = null;
    if (dx || dy) stage.scrollBy({ top: dy, left: dx, behavior: 'instant' });
  }

  /* ---------------- tools & mode bar ---------------- */
  const TOOL_BTN = { select: 'tSelect', rect: 'tRect', line: 'tLine', arrow: 'tArrow', text: 'tText', crop: 'tCrop', pin: 'tPin' };
  const HINTS = {
    rect: 'Drag on a page to draw a box. Hold <b>Shift</b> for a square.',
    line: 'Drag on a page to draw a line. Hold <b>Shift</b> to keep it level, plumb or at 45°.',
    arrow: 'Drag from the tail to the head. Hold <b>Shift</b> to keep it level, plumb or at 45°.',
    pin: 'Click a drawing to drop a numbered <b>photo pin</b>. Drag a pin to move it, tap it to edit and add photos.',
    crop: 'Drag on a page to crop it. <b>Shift-drag</b> applies the same crop to every page.',
    text: 'Click a line to retype it, or click blank space to add text. <b>Enter</b> starts a new line; <b>Apply</b> or click away to finish, <b>Esc</b> cancels.'
  };

  var ribOn = 'ribView', ribbonReady = false;   /* var: setTool may run before the ribbon is wired */

  function setTool(t) {
    if (S.editing) closeEditor(true);
    S.tool = t;
    S.sel = null;
    document.body.dataset.tool = t;
    const BTNS = Object.assign({}, TOOL_BTN, EXT.toolBtn);   /* modules register after boot */
    Object.keys(BTNS).forEach(function (k) {
      const el = $(BTNS[k]); if (el) el.classList.toggle('on', k === t);
    });
    /* a second button for the same tool — Select appears on more than one tab */
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool-btn]'), function (el) {
      el.classList.toggle('on', el.dataset.toolBtn === t);
    });
    /* Show the tab the tool actually lives on. It used to always jump to Edit,
       which was right when that was the only tool tab — but the drawing tools
       have their own now, and picking a circle would have thrown you back to
       Edit every time. */
    /* ...unless the tab you are on already has a button for it — Pan and
       Select sit on every tab, and picking them must not move you. */
    const onPan = ribbonReady && $(RIBBON.filter(function (r) { return r[0] === ribOn; })[0][1]);
    const here = onPan && (onPan.querySelector('[data-tool-btn="' + t + '"]') ||
                           (BTNS[t] && onPan.contains($(BTNS[t]))));
    if (ribbonReady && t !== 'select' && !here && !isMobile()) {
      const btn = $(BTNS[t]) || document.querySelector('[data-tool-btn="' + t + '"]');
      const pan = btn && btn.closest ? btn.closest('.rpan') : null;
      const pair = pan && RIBBON.filter(function (r) { return r[1] === pan.id; })[0];
      if (pair && ribOn !== pair[0]) setRibbon(pair[0]);
    }
    hideMarkPop();
    const bar = $('modeBar');
    const extTool = EXT.tools[t];
    /* A view tool such as Pan is not an editing mode: there is nothing to
       configure and nothing to finish, so it declares itself bare and the
       mode bar stays out of the way. */
    if (t === 'select' || (extTool && extTool.bare)) { bar.classList.remove('show'); }
    else {
      bar.classList.add('show');
      $('modeHint').innerHTML = HINTS[t] || EXT.hints[t] || '';
      const ext = EXT.tools[t];
      const shape = (t === 'rect' || t === 'line' || t === 'arrow') || (ext && ext.colors && ext.widths);
      $('swatches').style.display = (shape || t === 'text' || (ext && ext.colors)) ? 'flex' : 'none';
      $('widths').style.display = (shape || (ext && ext.widths)) ? 'flex' : 'none';
      $('txctl').hidden = t !== 'text';
      $('pinShowList').hidden = t !== 'pin';
      $('cropAll').hidden = t !== 'crop';
      $('cropReset').hidden = t !== 'crop';
    }
    EXT.emit('tool', t);
    S.items.forEach(function (x) { drawShapes(x); });
  }

  /* the tool's colour: ten quick squares, and "More" for the whole palette */
  function pickToolColor(c) {
    S.color = c;
    Array.prototype.forEach.call($('swatches').querySelectorAll('.sw'), function (x) {
      x.classList.toggle('on', x.dataset.c.toUpperCase() === String(c).toUpperCase());
    });
    $('swMoreChip').style.background = c;
    if (S.editing) {
      S.editing.item.c = c;
      S.editing.box.querySelector('textarea').style.color = c;
    }
  }
  /* one dropdown for the colour: the chip shows it, the palette chooses it */
  (function () {
    const more = document.createElement('button');
    more.className = 'swmore'; more.id = 'swMore'; more.type = 'button';
    more.title = 'Colour';
    more.innerHTML = '<i id="swMoreChip"></i><span>Colour</span><b>▾</b>';
    $('swatches').appendChild(more);
    $('swMoreChip').style.background = S.color;
    const pop = document.createElement('div');
    pop.className = 'swpop palette'; pop.id = 'toolPalette'; pop.hidden = true;
    document.body.appendChild(pop);
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!pop.hidden) { pop.hidden = true; return; }
      pop.innerHTML = '';
      buildPalette(pop, S.color, function (c) { pickToolColor(c); pop.hidden = true; });
      pop.hidden = false;
      const r = more.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      pop.style.top = top + 'px';
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !more.contains(e.target)) pop.hidden = true;
    });
  })();
  /* line width: one dropdown, each choice drawn at its own weight */
  (function () {
    function linePx(w) { return Math.max(1, Math.min(6, Math.round(w * 1.2 * 2) / 2)); }
    const btn = document.createElement('button');
    btn.className = 'wdrop'; btn.id = 'wdDrop'; btn.type = 'button'; btn.title = 'Line width';
    $('widths').appendChild(btn);
    const menu = document.createElement('div');
    menu.className = 'wdmenu'; menu.id = 'wdMenu'; menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    document.body.appendChild(menu);
    function paint() {
      btn.innerHTML = '<i style="height:' + linePx(S.width) + 'px"></i><span>' + S.width + ' pt</span><b>▾</b>';
    }
    paint();
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.innerHTML = WIDTHS.map(function (w) {
        return '<button type="button" role="option" data-w="' + w + '" class="' + (w === S.width ? 'on' : '') + '">' +
          '<i style="height:' + linePx(w) + 'px"></i><span>' + w + ' pt</span></button>';
      }).join('');
      menu.hidden = false;
      const r = btn.getBoundingClientRect(), h = menu.offsetHeight;
      menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left)) + 'px';
      let top = r.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
      menu.style.top = top + 'px';
    });
    menu.addEventListener('click', function (e) {
      const o = e.target.closest('button'); if (!o) return;
      e.stopPropagation();
      S.width = parseFloat(o.dataset.w);
      menu.hidden = true;
      paint();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) menu.hidden = true;
    });
  })();

  /* A tool button is a toggle: press it to pick the tool up, press it again to
     put it down. Before this, the only way out of a tool was the Done button
     in the mode bar, which is not where anyone looks for it. */
  function toggleTool(t) { setTool(S.tool === t ? 'select' : t); }

  /* Anything a module has put on top of the page and that owns Escape itself. */
  function overlayOpen() {
    const on = document.querySelector(
      '.sigmodal:not([hidden]), .docmodal:not([hidden]), .sharemodal:not([hidden]), ' +
      '.orgview:not([hidden]), .cthread:not([hidden]), .sheet.show, .pop:not([hidden])'
    );
    return !!on;
  }

  $('tSelect').addEventListener('click', function () { setTool('select'); });
  $('tRect').addEventListener('click', function () { toggleTool('rect'); });
  $('tLine').addEventListener('click', function () { toggleTool('line'); });
  $('tArrow').addEventListener('click', function () { toggleTool('arrow'); });
  $('tText').addEventListener('click', function () { toggleTool('text'); });
  $('tCrop').addEventListener('click', function () { toggleTool('crop'); });
  $('tPin').addEventListener('click', function () { toggleTool('pin'); });
  $('txFont').addEventListener('change', function () { S.font = $('txFont').value; liveStyle(); });
  $('txBold').addEventListener('click', function () {
    S.bold = !S.bold; $('txBold').classList.toggle('on', S.bold); liveStyle();
  });
  $('txItal').addEventListener('click', function () {
    S.ital = !S.ital; $('txItal').classList.toggle('on', S.ital); liveStyle();
  });
  $('txUnd').addEventListener('click', function () {
    S.underline = !S.underline; $('txUnd').classList.toggle('on', S.underline); liveStyle();
  });
  $('txStrike').addEventListener('click', function () {
    S.strike = !S.strike; $('txStrike').classList.toggle('on', S.strike); liveStyle();
  });
  $('txSize').addEventListener('change', function () {
    const v = parseFloat($('txSize').value);
    if (v > 0 && v < 400) S.size = v; else $('txSize').value = S.size;
    liveStyle();
  });
  function setAlign(v) {
    S.align = v;
    ['L', 'C', 'R'].forEach(function (k) {
      $('txAlign' + k).classList.toggle('on', v === ({ L: 'left', C: 'center', R: 'right' })[k]);
    });
    liveStyle();
  }
  $('txAlignL').addEventListener('click', function () { setAlign('left'); });
  $('txAlignC').addEventListener('click', function () { setAlign('center'); });
  $('txAlignR').addEventListener('click', function () { setAlign('right'); });
  setAlign(S.align);

  /* background fill: a colour-picker dropdown, same shape as the main tool
     colour swatch, plus an opacity slider and a "No background" escape */
  function paintBgChip() { $('txBgChip').style.background = S.bg || 'transparent'; }
  function setBg(c) { S.bg = c; paintBgChip(); liveStyle(); }
  (function () {
    const btn = $('txBgBtn'), pop = $('txBgPop');
    paintBgChip();
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!pop.hidden) { pop.hidden = true; return; }
      const existing = pop.querySelector('.pgrid,.phead,.pcustom');
      if (existing) { Array.prototype.slice.call(pop.querySelectorAll('.pgrid,.phead,.pcustom')).forEach(function (x) { x.remove(); }); }
      buildPalette(pop, S.bg || '', function (c) { setBg(c); pop.hidden = true; });
      $('txBgNone').classList.toggle('on', !S.bg);
      pop.hidden = false;
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      pop.style.top = top + 'px';
    });
    $('txBgNone').addEventListener('click', function (e) {
      e.stopPropagation(); setBg(null); pop.hidden = true;
    });
    $('txBgOp').addEventListener('input', function () {
      S.bgOp = parseFloat($('txBgOp').value) / 100; liveStyle();
    });
    $('txBgOp').addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) pop.hidden = true;
    });
  })();

  /* apply font choices to an editor that is currently open */
  function liveStyle() {
    const ed = S.editing;
    if (!ed) return;
    ed.item.f = S.font; ed.item.b = S.bold; ed.item.i = S.ital;
    ed.item.u = S.underline; ed.item.k = S.strike;
    ed.item.align = S.align; ed.item.bg = S.bg; ed.item.bgOp = S.bgOp;
    const v = parseFloat($('txSize').value);
    if (v > 0 && v < 400) ed.item.size = v;
    const ta = ed.box.querySelector('textarea');
    ta.style.fontFamily = CSS_FONT[ed.item.f];
    ta.style.fontWeight = ed.item.b ? '700' : '400';
    ta.style.fontStyle = ed.item.i ? 'italic' : 'normal';
    ta.style.textDecoration = textDecoLine(ed.item);
    ta.style.textAlign = ed.item.align || 'left';
    if (ed.item.bg) {
      ta.style.background = cssRgba(ed.item.bg, ed.item.bgOp == null ? 1 : ed.item.bgOp);
    } else if (!ed.item.patch) {
      ta.style.background = 'rgba(255,255,255,.94)';
    }
    ta.style.fontSize = editPx(ed.item) + 'px';
  }
  /* a hex colour at a given opacity, for the one place CSS needs it rather
     than an SVG fillOpacity attribute */
  function cssRgba(hex, op) {
    const n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + op + ')';
  }
  /* underline and strikethrough are independent toggles, so the CSS value
     is built from whichever of the two are on */
  function textDecoLine(item) {
    const parts = [];
    if (item.u) parts.push('underline');
    if (item.k) parts.push('line-through');
    return parts.length ? parts.join(' ') : 'none';
  }
  $('modeDone').addEventListener('click', function () { setTool('select'); });
  $('cropReset').addEventListener('click', function () { resetCrop(false); });
  $('cropAll').addEventListener('click', function () {
    const it = S.items[S.current - 1];
    if (!it || !it.crop) { toast('Crop one page first, then apply it to the rest'); return; }
    applyCrop(it, it.crop, true);
  });

  /* ---------------- parallel translation ---------------- */
  /* The page keeps its own column; the facing panel carries the same paragraphs in
     another language, so the two read side by side the way a bilingual edition does. */

  const LANGS = [
    ['en', 'English'], ['hi', 'Hindi — हिन्दी'], ['ml', 'Malayalam — മലയാളം'],
    ['ta', 'Tamil — தமிழ்'], ['te', 'Telugu — తెలుగు'], ['kn', 'Kannada — ಕನ್ನಡ'],
    ['mr', 'Marathi — मराठी'], ['gu', 'Gujarati — ગુજરાતી'], ['bn', 'Bengali — বাংলা'],
    ['pa', 'Punjabi — ਪੰਜਾਬੀ'], ['or', 'Odia — ଓଡ଼ିଆ'], ['as', 'Assamese — অসমীয়া'],
    ['ne', 'Nepali — नेपाली'], ['si', 'Sinhala — සිංහල'], ['ur', 'Urdu — اردو'],
    ['ar', 'Arabic — العربية'], ['fa', 'Persian — فارسی'], ['he', 'Hebrew — עברית'],
    ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
    ['ja', 'Japanese — 日本語'], ['ko', 'Korean — 한국어'],
    ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['pt', 'Portuguese'],
    ['it', 'Italian'], ['nl', 'Dutch'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
    ['pl', 'Polish'], ['tr', 'Turkish'], ['vi', 'Vietnamese'], ['th', 'Thai'],
    ['id', 'Indonesian'], ['ms', 'Malay'], ['sw', 'Swahili'], ['el', 'Greek'],
    ['sv', 'Swedish'], ['fi', 'Finnish'], ['cs', 'Czech'], ['ro', 'Romanian'],
    ['hu', 'Hungarian'], ['da', 'Danish'], ['no', 'Norwegian'], ['tl', 'Filipino']
  ];
  const LANG_NAME = {};
  LANGS.forEach(function (l) { LANG_NAME[l[0]] = l[1].split(' — ')[0]; });
  LANG_NAME.auto = 'Detected';

  const TR = {
    on: false, from: 'auto', to: 'en', prov: 'google', url: '', key: '',
    cache: new Map(), epoch: 0, gap: 16, stop: false, running: 0
  };

  function trSideBySide() { return TR.on && !isMobile(); }
  function trPair() {
    return (LANG_NAME[TR.from] || TR.from) + ' → ' + (LANG_NAME[TR.to] || TR.to);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* --- remembered settings --- */
  function trLoad() {
    try {
      const raw = localStorage.getItem('adddots.translate');
      if (!raw) return;
      const v = JSON.parse(raw);
      if (v.from) TR.from = v.from;
      if (v.to) TR.to = v.to;
      if (v.prov) TR.prov = v.prov;
      if (v.url) TR.url = v.url;
      if (v.key) TR.key = v.key;
    } catch (e) {}
  }
  function trSave() {
    try {
      localStorage.setItem('adddots.translate', JSON.stringify(
        { from: TR.from, to: TR.to, prov: TR.prov, url: TR.url, key: TR.key }));
    } catch (e) {}
  }

  /* --- paragraphs out of a page --- */
  function joinLine(L) {
    L.parts.sort(function (a, b) { return a.x - b.x; });
    let s = '';
    L.parts.forEach(function (p, i) {
      if (i) {
        const q = L.parts[i - 1];
        const gap = p.x - (q.x + q.w);
        if (gap > q.h * 0.16 && !/\s$/.test(s) && !/^\s/.test(p.s)) s += ' ';
      }
      s += p.s;
    });
    return s.replace(/\s+/g, ' ').trim();
  }

  /* Two-column pages are common in papers and reports. Lines on the two sides share
     a baseline, so they have to be separated before anything is joined up, otherwise
     the columns interleave. Look for a clear vertical gutter no word crosses. */
  function gutterOf(raw, pageW) {
    if (raw.length < 12) return null;
    const lo = pageW * 0.3, hi = pageW * 0.7;
    const step = Math.max(1.5, pageW / 240);
    const slack = Math.max(1, Math.floor(raw.length * 0.04));
    let run = null, best = null;
    for (let x = lo; x <= hi; x += step) {
      let cross = 0, left = 0, right = 0;
      for (let i = 0; i < raw.length; i++) {
        const o = raw[i];
        if (o.x < x - 1 && o.x + o.w > x + 1) cross++;
        else if (o.x + o.w <= x) left++;
        else right++;
      }
      const ok = cross <= slack && left >= raw.length * 0.25 && right >= raw.length * 0.25;
      if (ok) {
        if (!run) run = { a: x, b: x };
        else run.b = x;
        if (!best || run.b - run.a > best.b - best.a) best = { a: run.a, b: run.b };
      } else run = null;
    }
    if (!best || best.b - best.a < pageW * 0.02) return null;
    return (best.a + best.b) / 2;
  }

  function paragraphs(lines, med, widest) {
    const out = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i], prev = lines[i - 1];
      let brk = !cur;
      if (cur && prev) {
        const gap = prev.y - L.y;
        if (gap > Math.max(prev.h, L.h) * 1.44) brk = true;
        if (Math.abs(L.h - prev.h) > Math.max(1.1, med * 0.22)) brk = true;
        if (Math.abs(L.x0 - cur.x0) > med * 1.1) brk = true;
        if ((prev.x1 - cur.x0) < widest * 0.66) brk = true;
        if (/^([•·●▪‣⁃]|[-–—]\s|\(?\d{1,3}[.)]\s|[a-z]\)\s)/.test(L.text)) brk = true;
      }
      if (brk) {
        cur = { text: L.text, h: L.h, x0: L.x0, head: L.h > med * 1.16 };
        out.push(cur);
      } else {
        if (/[-‐­]$/.test(cur.text) && /^[a-zà-ÿ]/.test(L.text)) {
          cur.text = cur.text.replace(/[-‐­]$/, '') + L.text;
        } else cur.text += ' ' + L.text;
        cur.h = Math.max(cur.h, L.h);
      }
    }
    return out;
  }

  function blocksFrom(raw) {
    const lines = [];
    raw.forEach(function (o) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(L.y - o.y) <= Math.max(1.5, o.h * 0.55)) {
        L.parts.push(o);
        L.h = Math.max(L.h, o.h);
        L.x0 = Math.min(L.x0, o.x);
        L.x1 = Math.max(L.x1, o.x + o.w);
      } else lines.push({ y: o.y, h: o.h, x0: o.x, x1: o.x + o.w, parts: [o] });
    });
    lines.forEach(function (L) { L.text = joinLine(L); });
    const good = lines.filter(function (L) { return L.text; });
    if (!good.length) return [];
    const hs = good.map(function (L) { return L.h; }).sort(function (a, b) { return a - b; });
    const med = hs[Math.floor(hs.length / 2)] || 10;
    const widest = Math.max.apply(null, good.map(function (L) { return L.x1 - L.x0; })) || 1;
    return paragraphs(good, med, widest);
  }

  async function blocksOf(it) {
    await ensurePage(it);
    let tc;
    try { tc = await it.page.getTextContent(); } catch (e) { return []; }
    const raw = [];
    tc.items.forEach(function (x) {
      if (!x.str || !x.str.trim()) return;
      const t = x.transform;
      const h = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || 10;
      raw.push({ s: x.str, x: t[4], y: t[5], w: x.width || 0, h: h });
    });
    if (!raw.length) return [];
    raw.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });

    const pageW = it.page.getViewport({ scale: 1 }).width || 612;
    const g = gutterOf(raw, pageW);
    let out;
    if (g == null) out = blocksFrom(raw);
    else {
      /* anything straddling the gutter is a banner or a footer: it reads first */
      const span = [], left = [], right = [];
      raw.forEach(function (o) {
        if (o.x < g - 1 && o.x + o.w > g + 1) span.push(o);
        else (o.x + o.w <= g ? left : right).push(o);
      });
      out = blocksFrom(span).concat(blocksFrom(left), blocksFrom(right));
    }
    return out.filter(function (b) { return /\S/.test(b.text); });
  }

  /* --- the services --- */
  function trChunks(text, max) {
    if (text.length <= max) return [text];
    const out = [];
    let s = text;
    while (s.length > max) {
      let cut = s.lastIndexOf('. ', max);
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut < max * 0.3) cut = max; else cut += 1;
      out.push(s.slice(0, cut));
      s = s.slice(cut);
    }
    if (s) out.push(s);
    return out;
  }

  async function viaGoogle(text, from, to) {
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
      encodeURIComponent(from) + '&tl=' + encodeURIComponent(to) +
      '&dt=t&q=' + encodeURIComponent(text);
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status === 429 ? 'busy' : 'http ' + r.status);
    const j = await r.json();
    if (!j || !j[0]) throw new Error('empty');
    return j[0].map(function (s) { return (s && s[0]) || ''; }).join('');
  }
  async function viaMyMemory(text, from, to) {
    const src = from === 'auto' ? 'en' : from;
    const u = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) +
      '&langpair=' + encodeURIComponent(src + '|' + to);
    const r = await fetch(u);
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(t)) throw new Error('limit');
    return t;
  }
  async function viaCustom(text, from, to) {
    if (!TR.url) throw new Error('no endpoint');
    const body = { q: text, source: from === 'auto' ? 'auto' : from, target: to, format: 'text' };
    if (TR.key) body.api_key = TR.key;
    const r = await fetch(TR.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const t = j && (j.translatedText ||
      (j.data && j.data.translations && j.data.translations[0] && j.data.translations[0].translatedText));
    if (!t) throw new Error('empty');
    return t;
  }

  async function trCall(text, from, to) {
    let err;
    for (let a = 0; a < 3; a++) {
      try {
        if (TR.prov === 'mymemory') return await viaMyMemory(text, from, to);
        if (TR.prov === 'custom') return await viaCustom(text, from, to);
        return await viaGoogle(text, from, to);
      } catch (e) {
        err = e;
        if (a < 2) await sleep(420 * (a + 1) + Math.random() * 320);
      }
    }
    throw err || new Error('failed');
  }

  async function trText(text, from, to) {
    const max = TR.prov === 'mymemory' ? 450 : 1500;
    const parts = trChunks(text, max), out = [];
    for (let i = 0; i < parts.length; i++) out.push(await trCall(parts[i], from, to));
    return out.join(' ');
  }

  /* --- painting the facing panel --- */
  function paneFont(h) {
    return Math.max(9, Math.min(44, h * S.scale * 1.02));
  }

  function paintPane(it) {
    ensurePane(it);
    if (!it.trPane) return;
    it.trLang.textContent = trPair();
    const b = it.trBody;
    b.replaceChildren();
    it.trEls = [];
    if (!it.trBlocks || !it.trBlocks.length) {
      const s = document.createElement('div');
      s.className = 'trstate';
      if (it.trState === 'busy') { s.appendChild(dot()); s.appendChild(document.createTextNode('Reading this page…')); }
      else if (!it.trBlocks) s.textContent = 'Scroll here to translate this page.';
      else s.textContent = 'No text to translate on this page.';
      b.appendChild(s);
      return;
    }
    it.trBlocks.forEach(function (bl, i) {
      const p = document.createElement('p');
      const t = it.trOut && it.trOut[i];
      p.textContent = t != null ? t : bl.text;
      if (t == null) p.className = 'raw';
      if (bl.head) p.classList.add('head');
      p.style.fontSize = paneFont(bl.h).toFixed(1) + 'px';
      b.appendChild(p);
      it.trEls.push(p);
    });
    const s = document.createElement('div');
    if (it.trState === 'busy') {
      s.className = 'trstate';
      s.appendChild(dot());
      const n = (it.trOut || []).filter(function (x) { return x != null; }).length;
      s.appendChild(document.createTextNode('Translating ' + n + ' / ' + it.trBlocks.length + ' paragraphs'));
      b.appendChild(s);
    } else if (it.trState === 'err' || it.trState === 'part') {
      s.className = 'trstate bad';
      s.textContent = it.trState === 'err'
        ? 'The translation service did not answer.'
        : 'Some paragraphs came back empty.';
      const r = document.createElement('button');
      r.type = 'button'; r.textContent = 'Try again';
      r.addEventListener('click', function () { translatePage(it, true); });
      s.appendChild(r);
      b.appendChild(s);
    }
  }
  function dot() { const d = document.createElement('span'); d.className = 'trdot'; return d; }

  function setBlockText(it, i, text) {
    const el = it.trEls && it.trEls[i];
    if (!el) return;
    el.textContent = text;
    el.classList.remove('raw');
  }
  function bumpCount(it) {
    if (it.trState !== 'busy' || !it.trBody) return;
    const s = it.trBody.querySelector('.trstate');
    if (!s || !it.trBlocks) return;
    const n = (it.trOut || []).filter(function (x) { return x != null; }).length;
    s.lastChild.textContent = 'Translating ' + n + ' / ' + it.trBlocks.length + ' paragraphs';
  }

  /* --- one page at a time, three paragraphs in flight --- */
  function trStamp() { return TR.prov + '|' + TR.from + '|' + TR.to + '|' + TR.url; }

  function translatePage(it, force) {
    if (!TR.on || !it) return Promise.resolve();
    const stamp = trStamp();
    if (!force && it.trKey === stamp && it.trState !== 'idle' && it.trState !== 'err') {
      return it.trJob || Promise.resolve();
    }
    it.trKey = stamp;
    it.trJob = runPage(it, TR.epoch);
    return it.trJob;
  }

  async function runPage(it, epoch) {
    it.trState = 'busy';
    if (!it.trBlocks || it.trSrcKey !== it.src.id + ':' + it.num) {
      paintPane(it);
      it.trBlocks = await blocksOf(it);
      it.trSrcKey = it.src.id + ':' + it.num;
    }
    if (epoch !== TR.epoch) return;
    it.trOut = new Array(it.trBlocks.length).fill(null);

    const from = TR.from, to = TR.to;
    it.trBlocks.forEach(function (bl, i) {
      const k = TR.prov + '|' + from + '|' + to + '|' + bl.text;
      if (TR.cache.has(k)) it.trOut[i] = TR.cache.get(k);
    });
    if (!it.trBlocks.length) { it.trState = 'done'; paintPane(it); return; }
    paintPane(it);

    let next = 0, failed = 0;
    TR.running++;
    async function worker() {
      while (next < it.trBlocks.length) {
        const i = next++;
        if (epoch !== TR.epoch || !TR.on || TR.stop) return;
        if (it.trOut[i] != null) continue;
        const src = it.trBlocks[i].text;
        const k = TR.prov + '|' + from + '|' + to + '|' + src;
        try {
          const t = await trText(src, from, to);
          TR.cache.set(k, t);
          if (epoch !== TR.epoch) return;
          it.trOut[i] = t;
          setBlockText(it, i, t);
        } catch (e) { failed++; }
        if (epoch === TR.epoch) bumpCount(it);
      }
    }
    const n = Math.min(3, it.trBlocks.length);
    const jobs = [];
    for (let i = 0; i < n; i++) jobs.push(worker());
    try { await Promise.all(jobs); } finally { TR.running--; }

    if (epoch !== TR.epoch) return;
    it.trState = failed === 0 ? 'done' : (failed >= it.trBlocks.length ? 'err' : 'part');
    paintPane(it);
  }

  function copyTranslation(it) {
    const lines = (it.trBlocks || []).map(function (b, i) {
      return (it.trOut && it.trOut[i]) || b.text;
    });
    const text = lines.join('\n\n');
    if (!text) { toast('Nothing to copy yet'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('Translation copied'); },
        function () { toast('Copying was blocked by the browser'); });
    } else toast('Copying is not available here');
  }

  function resetTranslations() {
    TR.epoch++;
    S.items.forEach(function (it) {
      it.trBlocks = null; it.trOut = null; it.trState = 'idle'; it.trKey = ''; it.trJob = null;
      if (it.trBody) it.trBody.replaceChildren();
    });
  }

  function setParallel(on) {
    if (TR.on === on) return;
    TR.on = on;
    if (on) S.items.forEach(function (it) { mountPage(it); ensurePane(it); });
    document.body.classList.toggle('parallel', on);
    $('btnTr').classList.toggle('on', on);
    $('btnTr').dataset.label = on ? 'Translation on' : 'Translate';
    if (!on) TR.epoch++;
    relayout().then(function () {
      if (!on) return;
      renderVisible();
      const it = S.items[S.current - 1];
      if (it) translatePage(it);
    });
    toast(on ? 'Parallel translation · <b>' + trPair() + '</b>' : 'Parallel translation off');
  }

  /* --- whole document as a text file --- */
  async function exportTranslation() {
    if (!S.items.length) return;
    TR.stop = false;
    const was = TR.on;
    if (!was) { TR.on = true; }
    const parts = [];
    for (let i = 0; i < S.items.length; i++) {
      if (TR.stop) { toast('Stopped — nothing saved'); TR.on = was; return; }
      toast('Translating page <b>' + (i + 1) + '</b> of ' + S.items.length + ' · Esc stops');
      const it = S.items[i];
      try { await translatePage(it, true); } catch (e) {}
      const body = (it.trBlocks || []).map(function (b, k) {
        return (it.trOut && it.trOut[k]) || b.text;
      }).join('\n\n');
      parts.push('—— Page ' + (i + 1) + ' ——\n\n' + (body || '(no text)'));
    }
    TR.on = was;
    const head = S.baseName + '\n' + trPair() + '\n\n';
    download(head + parts.join('\n\n\n'), S.baseName + '-' + TR.to + '.txt', 'text/plain;charset=utf-8');
    toast('Saved the translation as a text file');
  }

  /* --- wiring --- */
  (function buildTrUI() {
    trLoad();
    const from = $('trFrom'), to = $('trTo');
    const auto = document.createElement('option');
    auto.value = 'auto'; auto.textContent = 'Detect language';
    from.appendChild(auto);
    LANGS.forEach(function (l) {
      const a = document.createElement('option');
      a.value = l[0]; a.textContent = l[1]; from.appendChild(a);
      const b = document.createElement('option');
      b.value = l[0]; b.textContent = l[1]; to.appendChild(b);
    });
    from.value = TR.from; to.value = TR.to;
    $('trProv').value = TR.prov;
    $('trUrl').value = TR.url; $('trKey').value = TR.key;
    $('trCustom').hidden = TR.prov !== 'custom';
  })();

  $('btnTr').addEventListener('click', function () {
    if (!S.items.length) return;
    if ($('trPop').hidden) openPop('trPop', $('btnTr'));
    else closePops();
  });
  $('trProv').addEventListener('change', function () {
    $('trCustom').hidden = this.value !== 'custom';
  });
  $('trSwap').addEventListener('click', function () {
    const f = $('trFrom'), t = $('trTo');
    if (f.value === 'auto') { f.value = t.value; return; }
    const a = f.value; f.value = t.value; t.value = a;
  });
  $('trCancel').addEventListener('click', function () {
    closePops();
    if (TR.on) setParallel(false);
  });

  function readTrForm() {
    const from = $('trFrom').value, to = $('trTo').value;
    const prov = $('trProv').value, url = $('trUrl').value.trim(), key = $('trKey').value.trim();
    if (prov === 'custom' && !url) { toast('Add the address of your translation server'); return false; }
    if (from !== 'auto' && from === to) { toast('Pick two different languages'); return false; }
    const changed = from !== TR.from || to !== TR.to || prov !== TR.prov || url !== TR.url || key !== TR.key;
    TR.from = from; TR.to = to; TR.prov = prov; TR.url = url; TR.key = key;
    trSave();
    if (changed) resetTranslations();
    return true;
  }

  $('trGo').addEventListener('click', function () {
    if (!S.items.length) return;
    if (!readTrForm()) return;
    closePops();
    if (TR.on) {
      /* already open — the languages may have changed, so redraw what is on screen */
      S.items.forEach(function (it) { if (it.trPane) it.trLang.textContent = trPair(); });
      renderVisible();
      const it = S.items[S.current - 1];
      if (it) translatePage(it);
      toast('Translating into <b>' + (LANG_NAME[TR.to] || TR.to) + '</b>');
    } else setParallel(true);
  });
  $('trTxt').addEventListener('click', function () {
    if (!S.items.length) return;
    if (!readTrForm()) return;
    closePops();
    exportTranslation();
  });

  /* ---------------- responsive layout ---------------- */
  const MOBILE = window.matchMedia('(max-width:760px)');
  function isMobile() { return MOBILE.matches; }

  /* groups that relocate between the top bar, the bottom dock and the more-sheet */
  const MOVES = ['meta', 'grpTools', 'grpZoom', 'grpPage', 'grpExtract', 'grpImages',
                 'grpTr', 'grpView', 'grpUi'].map(function (id) {
    const el = $(id);
    return { node: el, parent: el.parentNode, next: el.nextSibling };
  });

  /* A module tab is invisible on a phone, where the ribbon is replaced by the
     dock. Anything registered here rides into the more-sheet instead, so the
     Form and Document tools are not simply unreachable there. */
  /* Tool groups that belong in the phone dock beside grpTools. */
  const DOCK_EXTRA = [];
  EXT.dockGroup = function (el) {
    if (!el || DOCK_EXTRA.some(function (x) { return x.node === el; })) return;
    const entry = { node: el, parent: el.parentNode, next: el.nextSibling };
    DOCK_EXTRA.push(entry);
    MOVES.push(entry);
    if (laidOut === true) $('dock').appendChild(el);
  };

  const SHEET_EXTRA = [];
  EXT.mobileSheet = function (el) {
    if (!el || SHEET_EXTRA.some(function (x) { return x.node === el; })) return;
    const entry = { node: el, parent: el.parentNode, next: el.nextSibling };
    SHEET_EXTRA.push(entry);
    MOVES.push(entry);
    if (laidOut === true) $('moreBody').appendChild(el);   /* already on a phone */
  };

  var laidOut = null;                       /* var: mobileSheet reads it early */
  function applyLayout() {
    const m = isMobile();
    if (laidOut === m) return;
    laidOut = m;
    if (m) {
      $('dock').appendChild($('grpTools'));
      /* file name heads the sheet, then zoom, page ops, view */
      ['meta', 'grpZoom', 'grpPage', 'grpExtract', 'grpImages', 'grpTr', 'grpView', 'grpUi']
        .forEach(function (id) {
        $('moreBody').appendChild($(id));
      });
      DOCK_EXTRA.forEach(function (x) { $('dock').appendChild(x.node); });
      SHEET_EXTRA.forEach(function (x) { $('moreBody').appendChild(x.node); });
      $('btnMore').hidden = false;
      if (!rail.hidden) setRail(false);   /* the rail is a drawer here, not a column */
    } else {
      closeSheet(true);
      MOVES.forEach(function (x) { x.parent.insertBefore(x.node, x.next); });
      $('btnMore').hidden = true;
    }
    closePops();
    syncScrim();
    if (S.items.length && S.fit) relayout();
  }
  if (MOBILE.addEventListener) MOBILE.addEventListener('change', applyLayout);
  else if (MOBILE.addListener) MOBILE.addListener(applyLayout);
  /* Belt and braces. applyLayout is a no-op when the breakpoint has not
     actually changed, so the cost is a comparison. */
  window.addEventListener('resize', applyLayout);
  window.addEventListener('orientationchange', applyLayout);

  /* ---------------- drawer, sheet, scrim ---------------- */
  let sheetOpen = false;

  function syncScrim() {
    $('scrim').classList.toggle('show', isMobile() && (sheetOpen || !rail.hidden));
  }

  function setRail(open) {
    if (!rail.hidden === !!open) { syncScrim(); return; }
    rail.hidden = !open;
    $('btnRail').classList.toggle('on', !!open);
    syncScrim();
    if (!isMobile() && S.fit) relayout();
    if (open) drawVisibleThumbs();
  }

  function openSheet() {
    const s = $('moreSheet');
    closePops();
    s.hidden = false;
    sheetOpen = true;
    $('btnMore').setAttribute('aria-expanded', 'true');
    void s.offsetHeight;            /* flush layout so the slide-in animates */
    s.classList.add('show');
    syncScrim();
  }
  let sheetTimer;
  function closeSheet(now) {
    const s = $('moreSheet');
    sheetOpen = false;
    $('btnMore').setAttribute('aria-expanded', 'false');
    s.classList.remove('show');
    clearTimeout(sheetTimer);
    if (now) s.hidden = true;
    else sheetTimer = setTimeout(function () { if (!sheetOpen) s.hidden = true; }, 240);
    syncScrim();
  }

  $('btnMore').addEventListener('click', function () { sheetOpen ? closeSheet() : openSheet(); });
  $('moreClose').addEventListener('click', function () { closeSheet(); });
  $('scrim').addEventListener('click', function () {
    closeSheet(); setRail(false); closePops();
  });
  /* one-shot actions dismiss the sheet; zoom and theme stay put for repeat taps */
  $('moreBody').addEventListener('click', function (e) {
    const b = e.target.closest('.btn');
    if (!b || b.id === 'btnIn' || b.id === 'btnOut' || b.id === 'btnTheme' || b.id === 'btnUi') return;
    closeSheet();
  });

  /* ---------------- popovers ---------------- */
  function openPop(id, anchor) {
    closePops();
    const p = $(id); p.hidden = false;
    if (id === 'extractPop') prepExtract();
    if (id === 'jpgPop') prepJpg();
    if (id === 'savePop') $('savePhotosRow').hidden = !livePins().length;
    if (id === 'trPop') {
      $('trGo').textContent = TR.on ? 'Update translation' : 'Show translation';
      $('trCancel').textContent = TR.on ? 'Turn off' : 'Cancel';
    }
    const r = anchor.getBoundingClientRect(), w = p.offsetWidth;
    p.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    let top = r.bottom + 6;
    const h = p.offsetHeight;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - h);
    p.style.top = top + 'px';
    if (id === 'savePop') { $('saveNote').textContent = summary(); $('saveName').focus(); $('saveName').select(); }
  }
  function closePops(force) {
    $('addPop').hidden = true; $('savePop').hidden = true; $('trPop').hidden = true;
    $('expPop').hidden = true;
    /* a running split owns its popover — that is where its progress is shown */
    if (!exBusy || force) $('extractPop').hidden = true;
    if (!jpgBusy || force) $('jpgPop').hidden = true;
    EXT_POPS.forEach(function (x) { const p = $(x.id); if (p) p.hidden = true; });
  }

  /* Popovers a module owns. Registering one is what lets closePops shut it,
     which is what makes its button toggle like every other. */
  const EXT_POPS = [];
  /* Entries are objects, never bare strings: the click guard reads `.anchor`,
     and a string has a built-in `.anchor` method that would sail past a
     truthiness check and then blow up as a selector. */
  EXT.registerPop = function (id, anchorId) {
    if (typeof id !== 'string' || !id) return;
    if (EXT_POPS.some(function (p) { return p.id === id; })) return;
    EXT_POPS.push({ id: id, anchor: typeof anchorId === 'string' ? anchorId : null });
  };
  /* One definition of "press the button again to put it away". */
  EXT.togglePop = function (id, anchor) {
    const p = $(id);
    if (!p) return;
    if (p.hidden) openPop(id, anchor);
    else closePops(true);
  };
  EXT.popOpen = function (id) {
    const p = $(id);
    return !!p && !p.hidden;
  };

  function summary() {
    const n = S.items.length;
    const added = S.items.filter(function (it) { return it.added; }).length;
    const rot = S.items.filter(function (it) { return it.rot; }).length;
    const cropped = S.items.filter(function (it) { return it.crop; }).length;
    const marks = S.items.reduce(function (a, it) {
      return a + it.shapes.filter(function (s) { return s.t !== 'text' && s.t !== 'pin'; }).length;
    }, 0);
    const texts = S.items.reduce(function (a, it) {
      return a + it.shapes.filter(function (s) { return s.t === 'text'; }).length;
    }, 0);
    const removed = Math.max(0, S.baseCount - (n - added));
    const bits = [n + ' pages'];
    if (removed) bits.push(removed + ' removed');
    if (added) bits.push(added + ' added');
    if (rot) bits.push(rot + ' rotated');
    if (cropped) bits.push(cropped + ' cropped');
    if (marks) bits.push(marks + ' marks');
    const pins = livePins().length;
    if (pins) bits.push(pins + ' photo pins');
    if (texts) bits.push(texts + ' text edits');
    return bits.join(' · ');
  }

  document.addEventListener('click', function (e) {
    if (S.editing && !e.target.closest('.texted') && !e.target.closest('.modebar') &&
        Date.now() - S.editing.at > 350) {
      closeEditor(true);
    }
    if (e.target.closest('.pop') || e.target.closest('#btnAdd') ||
        e.target.closest('#btnSave') || e.target.closest('#btnTr') ||
        e.target.closest('#btnExtract') || e.target.closest('#btnJpg') ||
        e.target.closest('#pinExpGo')) return;
    if (e.target.closest('[data-a="add"]')) return;
    /* the same courtesy for a popover a module owns */
    if (EXT_POPS.some(function (x) {
      return typeof x.anchor === 'string' && x.anchor && e.target.closest('#' + x.anchor);
    })) return;
    closePops();
  });

  /* ---------------- wiring ---------------- */
  function setZoom(m) { zoomGlide(glideTarget() * m); }
  $('btnIn').addEventListener('click', function () { setZoom(1.2); });
  $('btnOut').addEventListener('click', function () { setZoom(1 / 1.2); });
  $('btnFitW').addEventListener('click', function () { S.fit = 'width'; relayout(); });
  $('btnRotL').addEventListener('click', function (e) { e.shiftKey ? rotateAll(-90) : rotateItem(S.current - 1, -90); });
  $('btnRotR').addEventListener('click', function (e) { e.shiftKey ? rotateAll(90) : rotateItem(S.current - 1, 90); });
  $('btnDel').addEventListener('click', function () { if (S.items.length) removeItem(S.current - 1); });
  $('btnUndo').addEventListener('click', undo);

  $('btnAdd').addEventListener('click', function () {
    if (!S.items.length) return;
    $('addPop').hidden ? openPop('addPop', $('btnAdd')) : closePops();
  });
  let addMode = 'after';
  $('addPdf').addEventListener('click', function () { closePops(); addMode = 'after'; $('fileAdd').click(); });
  $('addMerge').addEventListener('click', function () { closePops(); addMode = 'end'; $('fileAdd').click(); });
  $('addBlank').addEventListener('click', function () {
    closePops();
    if (EXT.openBlankPageDialog) EXT.openBlankPageDialog(); else insertBlank();
  });
  $('fileAdd').addEventListener('change', function (e) {
    const files = e.target.files;
    if (files && files.length) insertPdfs(files, addMode === 'end' ? S.items.length : S.current);
    addMode = 'after';
    e.target.value = '';
  });

  $('btnExtract').addEventListener('click', function () {
    if (!S.items.length) return;
    $('extractPop').hidden ? openPop('extractPop', $('btnExtract')) : closePops();
  });
  $('exAll').addEventListener('click', function () { runExtract(allPages(), true); });
  $('exOne').addEventListener('click', function () { runExtract(exNums(), false); });
  $('exSep').addEventListener('click', function () { runExtract(exNums(), true); });
  $('exCancel').addEventListener('click', function () { closePops(); });
  $('exRange').addEventListener('input', exUpdate);
  $('exRange').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('exOne').click(); }
  });
  $('exChips').addEventListener('click', function (e) {
    const b = e.target.closest('.chip');
    if (!b || b.disabled) return;
    const f = $('exRange');
    if (b.dataset.r === 'all') f.value = formatRanges(allPages());
    if (b.dataset.r === 'cur') f.value = String(S.current);
    if (b.dataset.r === 'odd') f.value = formatRanges(allPages().filter(function (i) { return i % 2; }));
    if (b.dataset.r === 'even') f.value = formatRanges(allPages().filter(function (i) { return !(i % 2); }));
    if (b.dataset.r === 'pick') f.value = formatRanges(pickedPages());
    if (b.dataset.r === 'clear') { setPicks([]); f.value = formatRanges(allPages()); }
    exUpdate();
  });

  $('btnJpg').addEventListener('click', function () {
    if (!S.items.length) return;
    $('jpgPop').hidden ? openPop('jpgPop', $('btnJpg')) : closePops();
  });
  $('jpgAll').addEventListener('click', function () { runJpg(allPages()); });
  $('jpgGo').addEventListener('click', function () { runJpg(jpgNums()); });
  $('jpgCancel').addEventListener('click', function () { closePops(); });
  $('jpgRange').addEventListener('input', function () { jpgUpdate(); });
  $('jpgRange').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('jpgGo').click(); }
  });
  $('jpgDpi').addEventListener('change', function () { jpgUpdate(); });
  $('jpgQ').addEventListener('change', function () { jpgUpdate(); });
  $('jpgChips').addEventListener('click', function (e) {
    const b = e.target.closest('.chip');
    if (!b || b.disabled) return;
    const f = $('jpgRange');
    if (b.dataset.r === 'all') f.value = formatRanges(allPages());
    if (b.dataset.r === 'cur') f.value = String(S.current);
    if (b.dataset.r === 'odd') f.value = formatRanges(allPages().filter(function (i) { return i % 2; }));
    if (b.dataset.r === 'even') f.value = formatRanges(allPages().filter(function (i) { return !(i % 2); }));
    if (b.dataset.r === 'pick') f.value = formatRanges(pickedPages());
    if (b.dataset.r === 'clear') { setPicks([]); f.value = formatRanges(allPages()); }
    jpgUpdate();
  });

  $('btnSave').addEventListener('click', function () {
    if (!S.items.length) return;
    $('savePop').hidden ? openPop('savePop', $('btnSave')) : closePops();
  });
  $('saveCancel').addEventListener('click', closePops);
  $('saveGo').addEventListener('click', function () {
    let n = $('saveName').value.trim() || (S.baseName + '-edited.pdf');
    if (!/\.pdf$/i.test(n)) n += '.pdf';
    saveAs(n);
  });
  $('saveName').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('saveGo').click(); });

  /* Light or dark interface, remembered on this device. The page's reading
     theme (Paper, Sepia, Night) is its own choice and is not touched. */
  function setUi(mode) {
    mode = mode === 'dark' ? 'dark' : 'light';
    document.body.dataset.ui = mode;
    try { localStorage.setItem('adpdf-ui', mode); } catch (e) { /* private window */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#FFFFFF' : '#050505');
    const next = mode === 'light' ? 'dark' : 'light';
    ['btnUi', 'hUi'].forEach(function (id) {
      const b = $(id); if (!b) return;
      b.title = 'Switch to ' + next + ' interface';
      b.setAttribute('aria-label', b.title);
      b.dataset.label = next === 'dark' ? 'Dark mode' : 'Light mode';
    });
    if ($('hUiLbl')) $('hUiLbl').textContent = next === 'dark' ? 'Dark mode' : 'Light mode';
  }
  ['btnUi', 'hUi'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      setUi(document.body.dataset.ui === 'light' ? 'dark' : 'light');
    });
  });
  setUi(document.body.dataset.ui);

  $('btnTheme').addEventListener('click', function () {
    S.theme = THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length];
    document.body.dataset.theme = S.theme;
    $('themeLbl').textContent = THEME_LABEL[S.theme];
    $('btnTheme').dataset.label = 'Reading theme · ' + THEME_LABEL[S.theme];
  });
  $('btnPrev').addEventListener('click', function () { goTo(S.current - 1); });
  $('btnNext').addEventListener('click', function () { goTo(S.current + 1); });
  $('pageIn').addEventListener('change', function () {
    const v = parseInt($('pageIn').value, 10);
    if (!isNaN(v)) goTo(v); else $('pageIn').value = String(S.current);
  });
  /* ---------------- ribbon tabs ---------------- */
  const RIBBON = [['ribView', 'panView'], ['ribEdit', 'panEdit'], ['ribPage', 'panPage']];
  EXT.addRibbonTab = function (tabId, panId) {
    if (RIBBON.some(function (r) { return r[0] === tabId; })) return;
    RIBBON.push([tabId, panId]);
    $(tabId).addEventListener('click', function () { setRibbon(tabId); });
  };
  function setRibbon(tab) {
    ribOn = tab;
    RIBBON.forEach(function (r) {
      const on = r[0] === tab;
      $(r[0]).classList.toggle('on', on);
      $(r[0]).setAttribute('aria-selected', on ? 'true' : 'false');
      $(r[1]).hidden = !on;
    });
    closePops();
  }
  RIBBON.forEach(function (r) {
    $(r[0]).addEventListener('click', function () { setRibbon(r[0]); });
  });
  ribbonReady = true;
  setRibbon('ribView');          /* land on View, whatever the markup says */

  /* Home tab shortcuts into the sidebar panels */
  $('btnFind').addEventListener('click', function () {
    if (!S.items.length) return;
    if (rail.hidden) setRail(true);
    switchTab('find');
  });
  $('btnPinPanel').addEventListener('click', function () {
    if (!S.items.length) return;
    if (rail.hidden) setRail(true);
    switchTab('pins');
  });

  $('btnRail').addEventListener('click', function () { setRail(rail.hidden); });
  $('tabPages').addEventListener('click', function () { switchTab('pages'); });
  $('tabFind').addEventListener('click', function () { switchTab('find'); });
  $('railClose').addEventListener('click', function () { setRail(false); });
  $('tabPins').addEventListener('click', function () { switchTab('pins'); });
  function switchTab(w) {
    const f = w === 'find', pn = w === 'pins';
    $('railPages').hidden = f || pn; $('railFind').hidden = !f; $('railPins').hidden = !pn;
    $('tabPages').classList.toggle('on', !f && !pn); $('tabFind').classList.toggle('on', f);
    $('tabPins').classList.toggle('on', pn);
    if (f) $('findIn').focus();
    else if (pn) renderPins();
    else drawVisibleThumbs();
  }

  /* ---------------- home screen ---------------- */
  let pendingTool = null;

  function isDirty() {
    return !!S.items.length && (S.items.length !== S.baseCount ||
      S.items.some(function (it) { return it.shapes.length || it.crop || it.rot; }));
  }
  function homeShown() { return !$('openPanel').hidden; }
  function docName() { return (S.sources[0] && S.sources[0].name) || (S.baseName + '.pdf'); }

  function showHome() {
    closePops();
    if (S.editing) closeEditor(true);
    closeLb();
    if (sheetOpen) closeSheet(true);
    $('hResume').hidden = !S.items.length;
    $('hResumeName').textContent = docName();
    $('openPanel').hidden = false;
    $('hMain').scrollTop = 0;
    navOn('hTop');
    renderRecent();
  }
  function hideHome() {
    if (!S.items.length) return;
    $('openPanel').hidden = true;
    $('errMsg').hidden = true;
    stage.focus();
  }

  /* ask before a new file replaces unsaved work */
  function okToReplace() {
    return !isDirty() || confirm('Open another file? Unsaved changes to "' + docName() + '" will be lost.');
  }
  function pickNew(tool) {
    if (!okToReplace()) return;
    pendingTool = tool || null;
    $('fileIn').click();
  }

  function runTool(t) {
    if (!S.items.length) return;
    if (t === 'text' || t === 'crop') setTool(t);
    else if (t === 'mark') setTool('rect');
    else if (t === 'pin') { setTool('pin'); showPinPanel(); }
    else if (t === 'organize') { setRail(true); switchTab('pages'); toast('Use the arrows on each thumbnail to reorder · <b>Add</b> inserts pages'); }
    else if (t === 'extract') openPop('extractPop', $('btnExtract'));
    else if (t === 'jpg') openPop('jpgPop', $('btnJpg'));
    else if (t === 'translate') openPop('trPop', $('btnTr'));
    else if (t === 'merge') toast('Merged · use <b>Add</b> to join more PDFs');
  }

  $('toolGrid').addEventListener('click', function (e) {
    const c = e.target.closest('.tcard'); if (!c) return;
    const t = c.dataset.tool;
    if (S.items.length) {
      /* a document is open: the tool works on it */
      hideHome();
      if (t === 'merge') { addMode = 'end'; $('fileAdd').click(); return; }
      setTimeout(function () { runTool(t); }, 0);   /* after this click finishes bubbling */
      return;
    }
    if (t === 'merge') toast('Select two or more PDFs — they are joined in the order you pick them');
    pickNew(t);
  });

  $('hResume').addEventListener('click', hideHome);
  $('btnHome').addEventListener('click', showHome);

  function navOn(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.hnav nav button'), function (b) {
      b.classList.toggle('on', b.dataset.go === id);
    });
  }
  document.querySelector('.hnav nav').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    navOn(b.dataset.go);
    if (b.dataset.go === 'hTop') $('hMain').scrollTo({ top: 0, behavior: 'smooth' });
    else $(b.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---- recent files: kept in this browser (IndexedDB) so they reopen in one click ---- */
  const RECENT_MAX = 8, RECENT_KEEP = 60 * 1048576;
  function idb() {
    return new Promise(function (res, rej) {
      try {
        const r = indexedDB.open('adddots-pdf', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('recent', { keyPath: 'key' }); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
  }
  function idbRun(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        const tx = db.transaction('recent', mode), st = tx.objectStore('recent');
        const q = fn(st);
        tx.oncomplete = function () { db.close(); res(q && q.result); };
        tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
      });
    });
  }
  function recentAll() {
    return idbRun('readonly', function (st) { return st.getAll(); })
      .then(function (a) { return (a || []).sort(function (x, y) { return y.time - x.time; }); })
      .catch(function () { return []; });
  }
  async function addRecent(file, pages) {
    try {
      const rec = {
        key: file.name + '|' + file.size, name: file.name, size: file.size, pages: pages,
        time: Date.now(), blob: file.size <= RECENT_KEEP ? file : null
      };
      await idbRun('readwrite', function (st) { st.put(rec); });
      const all = await recentAll();
      const extra = all.slice(RECENT_MAX);
      if (extra.length) await idbRun('readwrite', function (st) { extra.forEach(function (r) { st.delete(r.key); }); });
    } catch (e) { /* private window or storage blocked — the list just stays empty */ }
  }

  function whenLabel(t) {
    const d = new Date(t), now = new Date();
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = 86400000, start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (t >= start) return 'Today, ' + hm;
    if (t >= start - day) return 'Yesterday, ' + hm;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let recentToken = 0, recentRecs = [];
  async function renderRecent() {
    const my = ++recentToken;
    const all = await recentAll();
    if (my !== recentToken) return;
    recentRecs = all;
    $('hHello').textContent = all.length ? 'Welcome back' : 'Welcome to Add Dots PDF';
    $('recentClear').hidden = !all.length;
    const list = $('recentList');
    if (!all.length) {
      list.innerHTML = '<div class="rempty">Files you open will appear here, so you can pick up where you left off.</div>';
      return;
    }
    list.innerHTML = all.map(function (r, i) {
      const bits = [bytesLabel(r.size)];
      if (r.pages) bits.push(r.pages + (r.pages === 1 ? ' page' : ' pages'));
      if (!r.blob) bits.push('select again to open');
      return '<div class="rrow" role="button" tabindex="0" data-i="' + i + '">' +
        '<span class="fi"></span>' +
        '<span class="nm"><b>' + esc(r.name) + '</b><small>' + esc(bits.join(' · ')) + '</small></span>' +
        '<span class="when">' + esc(whenLabel(r.time)) + '</span>' +
        '<button class="x" data-x="' + i + '" title="Remove from list" aria-label="Remove ' + esc(r.name) + ' from list">&times;</button>' +
        '</div>';
    }).join('');
  }

  async function openRecent(i) {
    const r = recentRecs[i]; if (!r) return;
    if (!r.blob) { toast('That file was too large to keep here — select it again'); pickNew(); return; }
    if (!okToReplace()) return;
    await openFile(new File([r.blob], r.name, { type: 'application/pdf' }));
  }
  $('recentList').addEventListener('click', async function (e) {
    const x = e.target.closest('[data-x]');
    if (x) {
      e.stopPropagation();
      const r = recentRecs[+x.dataset.x];
      if (r) { try { await idbRun('readwrite', function (st) { st.delete(r.key); }); } catch (err) {} }
      renderRecent();
      return;
    }
    const row = e.target.closest('.rrow');
    if (row) openRecent(+row.dataset.i);
  });
  $('recentList').addEventListener('keydown', function (e) {
    const row = e.target.closest('.rrow');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRecent(+row.dataset.i); }
  });
  $('recentClear').addEventListener('click', async function () {
    try { await idbRun('readwrite', function (st) { st.clear(); }); } catch (e) {}
    renderRecent();
  });

  $('btnOpen').addEventListener('click', function () { pickNew(); });
  $('pickBtn').addEventListener('click', function () { pickNew(); });
  /* The picker, and anything else that arrives holding File objects — the
     desktop app hands PDFs here when the operating system opens one with it. */
  async function takeFiles(files) {
    if (!files.length) return;
    const pdfs = files.filter(isPdf);
    const tool = pendingTool; pendingTool = null;
    const proj = await takeProjectFiles(files);
    if (!pdfs.length) {
      /* a report on its own: hold it until the drawing is opened */
      if (proj) {
        if (await applyProject(proj.d, proj.pool, proj.name) === 'need-pdf') {
          stashProject(proj.d, proj.pool, proj.name);
        }
        return;
      }
      openFile(files[0]);                               /* lets openFile report why */
      return;
    }
    if (!(await openFile(pdfs[0]))) return;
    /* everything else merges on, non-PDFs included so they show up in the tally */
    const rest = files.filter(function (f) {
      return f !== pdfs[0] && !isProjectFile(f) && !isImageFile(f);
    });
    if (rest.length && S.items.length) await insertPdfs(rest, S.items.length);
    if (proj && S.items.length) await applyProject(proj.d, proj.pool, proj.name);
    else flushProject();
    if (tool) setTimeout(function () { runTool(tool); }, 60);
  }

  $('fileIn').addEventListener('change', function (e) {
    const files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    takeFiles(files);
  });

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hot'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'dragleave' && e.relatedTarget) return;
      drop.classList.remove('hot');
    });
  });
  document.addEventListener('drop', async function (e) {
    const dropped = e.dataTransfer && e.dataTransfer.files;
    if (!dropped || !dropped.length) return;
    if (S.items.length && !homeShown()) { insertPdfs(dropped, S.current); return; }
    if (S.items.length && !okToReplace()) return;

    /* nothing open yet: the first PDF becomes the document, the rest merge onto it */
    $('openPanel').hidden = false;
    const all = Array.prototype.slice.call(dropped);
    const pdfs = all.filter(isPdf);
    const proj = await takeProjectFiles(all);
    if (!pdfs.length) {
      if (proj) {
        if (await applyProject(proj.d, proj.pool, proj.name) === 'need-pdf') {
          stashProject(proj.d, proj.pool, proj.name);
        }
        return;
      }
      openFile(all[0]); return;
    }
    await openFile(pdfs[0]);
    const rest = all.filter(function (f) {
      return f !== pdfs[0] && !isProjectFile(f) && !isImageFile(f);
    });
    if (rest.length && S.items.length) await insertPdfs(rest, S.items.length);
    if (proj && S.items.length) await applyProject(proj.d, proj.pool, proj.name);
    else flushProject();
  });

  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';
    const mod = e.ctrlKey || e.metaKey;

    if (homeShown()) {
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickNew(); }
      else if (e.key === 'Escape' && S.items.length) hideHome();
      return;
    }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickNew(); return; }

    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault(); setRail(true); switchTab('find'); return;
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('btnSave').click(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape') {
      closePops();
      TR.stop = true;
      if (sheetOpen) { closeSheet(); return; }
      if (S.editing) { closeEditor(false); return; }
      if (isMobile() && !rail.hidden) { setRail(false); return; }
      /* A dialog on top owns Escape. Dropping the tool as well would be a
         second, unasked-for thing happening on one key press. */
      if (overlayOpen()) return;
      if (S.tool !== 'select') setTool('select');
      return;
    }
    if (typing || !S.items.length) return;
    /* every case below is a bare-letter tool shortcut — Ctrl/Cmd plus that
       same letter usually means something else entirely (Ctrl+C is Copy,
       not the Crop tool), so a held modifier here falls through untouched
       rather than hijacking it */
    if (mod) return;

    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case 'j': e.preventDefault(); goTo(S.current + 1); break;
      case 'ArrowLeft': case 'PageUp': case 'k': e.preventDefault(); goTo(S.current - 1); break;
      case 'Home': e.preventDefault(); goTo(1); break;
      case 'End': e.preventDefault(); goTo(S.items.length); break;
      case '+': case '=': e.preventDefault(); setZoom(1.2); break;
      case '-': e.preventDefault(); setZoom(1 / 1.2); break;
      case 'w': S.fit = 'width'; relayout(); break;
      case 'p': S.fit = 'page'; relayout(); break;
      case 'v': setTool('select'); break;
      case 'x': setTool('rect'); break;
      case 'l': setTool('line'); break;
      case 'a': setTool('arrow'); break;
      case 'e': setTool('text'); break;
      case 'c': setTool('crop'); break;
      case 'm': setTool('pin'); break;
      case 'M': setRail(true); switchTab('pins'); break;
      case 'r': case 'R': e.shiftKey ? rotateAll(90) : rotateItem(S.current - 1, 90); break;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        if (!deleteSelected() && S.tool === 'select') removeItem(S.current - 1);
        break;
      case 'E': $('btnExtract').click(); break;
      case 'J': $('btnJpg').click(); break;
      case 't': $('btnTheme').click(); break;
      case 'g': TR.on ? setParallel(false) : $('btnTr').click(); break;
      case 's': $('btnRail').click(); break;
      case 'o': e.preventDefault(); pickNew(); break;
      case 'h': showHome(); break;
      case '/': e.preventDefault(); setRail(true); switchTab('find'); break;
    }
  });

  stage.addEventListener('wheel', function (e) {
    if (!e.ctrlKey || !S.items.length) return;
    e.preventDefault();
    /* a trackpad sends many small deltas — scale by the amount, not a fixed
       step; Firefox counts in lines or pages rather than pixels */
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33; else if (e.deltaMode === 2) dy *= 600;
    const k = Math.exp(-dy * 0.0022);
    zoomGlide(glideTarget() * Math.max(0.8, Math.min(1.25, k)), e.clientX, e.clientY);
  }, { passive: false });

  /* ---------------- pinch to zoom ---------------- */
  function touchSpan(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }
  function touchMid(t) {
    return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  }
  let pinch = null;
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 2 || !S.items.length) return;
    if (S.editing) closeEditor(true);
    glideStop();
    clearTimeout(zoomTimer);
    document.body.classList.add('zooming');
    pinch = { d: touchSpan(e.touches) || 1, s: S.scale, want: null };
    S.fit = null;
    const mid0 = touchMid(e.touches);
    anchorBox = null;
    const a0 = grabAnchor(mid0[0], mid0[1]);
    anchorBox = a0 ? a0.box : null;      /* the page under the fingers, held for the gesture */
  }, { passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const mid = touchMid(e.touches);
    pinch.want = { s: pinch.s * (touchSpan(e.touches) / pinch.d), x: mid[0], y: mid[1] };
    /* one resize per frame, so the fingers never outrun the page */
    if (zoomRaf) return;
    zoomRaf = requestAnimationFrame(function () {
      zoomRaf = 0;
      const w = pinch && pinch.want;
      if (w) zoomTo(w.s, w.x, w.y);
    });
  }, { passive: false });
  function endPinch(e) {
    if (!pinch || (e.touches && e.touches.length > 1)) return;
    pinch = null;
    anchorBox = null;
    if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = 0; }
    zoomSettle(60);
  }
  stage.addEventListener('touchend', endPinch, { passive: true });
  stage.addEventListener('touchcancel', endPinch, { passive: true });

  /* A phone keyboard opening fires resize with the same width — re-fitting then
     would close the text editor mid-edit, so only a real width change refits. */
  let rsTimer, lastFitKey = '';
  function onResize() {
    applyLayout();
    if (!S.items.length || !S.fit || S.editing) return;
    const key = stage.clientWidth + (S.fit === 'page' ? 'x' + stage.clientHeight : '');
    if (key === lastFitKey) return;
    lastFitKey = key;
    clearTimeout(rsTimer); rsTimer = setTimeout(relayout, 160);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  window.addEventListener('beforeunload', function (e) {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  document.body.dataset.theme = 'paper';
  document.body.dataset.tool = 'select';
  document.body.classList.add('no-doc');
  $('btnTheme').dataset.label = 'Reading theme · Paper';
  applyLayout();
  renderRecent();

  /* ---- hand the feature modules what they need, and nothing more ---- */
  Object.assign(EXT, {
    S: S, SVGNS: SVGNS, COLORS: COLORS, WIDTHS: WIDTHS, FONTS: FONTS,
    $: $, toast: toast, esc: esc, icon: icon, ICON: ICON, download: download, zipStore: zipStore,
    snapLine: snapLine, snapBox: snapBox, constrainPt: constrainPt,
    selList: selList, setGroup: setGroup,
    snapshot: snapshot, setUndoState: setUndoState,
    drawShapes: drawShapes, drawThumb: drawThumb, drawVisibleThumbs: drawVisibleThumbs,
    relayout: relayout, syncAll: syncAll, applyLayout: applyLayout,
    setTool: setTool, toggleTool: toggleTool, setCurrent: setCurrent,
    goTo: goTo, updateMeta: updateMeta,
    setRibbon: function (id) { setRibbon(id); },
    setRail: setRail, openSheet: openSheet,
    removeItem: removeItem, moveItem: moveItem, rotateItem: rotateItem,
    newItem: newItem, ensureEls: ensureEls,
    buildPdf: buildPdf, loadSrc: loadSrc, addSource: addSource, saveError: saveError,
    insertBlank: insertBlank, ensurePage: ensurePage, ensureAllPages: ensureAllPages, renderIdle: renderIdle,
    drawPageInto: drawPageInto,
    /* 'on' when pages are drawn in the render worker, 'wait' while it starts, 'off' */
    renderWorker: function () { return RW.state; },
    /* zoomed past the bitmap cap, the part on screen is drawn sharp (Stage D2) */
    hasDetail: true,
    pdfjsLib: pdfjsLib, PDFLib: PDFLib,
    hexRgb: hexRgb, rotPt: rotPt, boxOf: boxOf, shapeMid: shapeMid,
    beginDrag: beginDrag, rectCorners: rectCorners, arrowHead: arrowHead,
    dashOf: dashOf, CAP_CSS: CAP_CSS, JOIN_CSS: JOIN_CSS,
    shCap: shCap, shJoin: shJoin,
    vpts: vpts, textWidth: textWidth, fontIdx: fontIdx,
    dirAngle: dirAngle, shOp: shOp,
    openPop: openPop, closePops: closePops,
    invalidateSearch: invalidateSearch,
    isMobile: isMobile,
    openFiles: takeFiles,
    okToReplace: okToReplace,
    hasDoc: function () { return !!S.items.length; }
  });
  EXT.emit('ready');
})();
