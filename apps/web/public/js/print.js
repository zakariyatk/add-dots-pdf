/* Add Dots PDF — Print (the Windows app)
   ----------------------------------------
   The Print dialog, laid out as Acrobat's: the printer, its Properties and
   Advanced, copies, grey, which pages, how they sit on the paper (Size,
   Poster, Multiple, Booklet), both sides, the paper's way round, comments
   and forms, Page Setup (paper and tray), and a preview of each sheet.

   The sheets are planned by js/printplan.js and the job goes straight to
   the printer picked here (src-tauri/src/print.rs), drawn there by PDFium.

   Only in the Windows app: a website cannot reach a printer, so there (and
   in the phone apps) Print is the browser's own dialog, as it always was
   (core.js printSystem). The link at the bottom does the same here. */
(function () {
  'use strict';

  const X = window.ADDPDF, PL = window.ADDPRINT;
  if (!X || !PL) { console.error('[print] core bridge missing'); return; }

  X.on('ready', function () {
    let T = window.__TAURI__;
    try { if (!T && window.parent !== window) T = window.parent.__TAURI__; } catch (e) { T = null; }
    if (!T || !T.core) return;               /* a browser: its own print dialog */

    const S = X.S, $ = X.$;
    const KEEP = 'adddots.print';
    const KEPT = ['printer', 'gray', 'mode', 'fit', 'scale', 'per', 'order', 'border', 'binding', 'orient',
      'paper', 'source', 'both', 'flip', 'annots', 'byPage', 'tile', 'overlap', 'largeOnly', 'image', 'dpi'];

    /* the choices, as last used (not which pages: that is per document) */
    const o = {
      printer: '', copies: 1, gray: false, pick: 'all', range: '', subset: 'all', reverse: false,
      mode: 'size', fit: 'fit', scale: 100, per: 2, order: 'h', border: false, binding: 'left', side: 'both',
      orient: 'auto', paper: 9, source: 7, both: false, flip: 'long', annots: 'all',
      byPage: false, tile: 100, overlap: 0.5, largeOnly: false, image: false, dpi: 300
    };
    try {
      const k = JSON.parse(localStorage.getItem(KEEP) || '{}');
      KEPT.forEach(function (n) { if (k[n] !== undefined && typeof k[n] === typeof o[n]) o[n] = k[n]; });
    } catch (e) { /* nothing kept */ }
    function keep() {
      try {
        const k = {};
        KEPT.forEach(function (n) { k[n] = o[n]; });
        localStorage.setItem(KEEP, JSON.stringify(k));
      } catch (e) { /* not kept */ }
    }

    /* ---------------- the dialog ---------------- */

    function radio(name, value, label) {
      return '<label class="prchk"><input type="radio" name="' + name + '" value="' + value + '"><span>' + label + '</span></label>';
    }
    function check(id, label) {
      return '<label class="prchk"><input type="checkbox" id="' + id + '"><span>' + label + '</span></label>';
    }
    const dlg = document.createElement('div');
    dlg.className = 'docmodal prmodal'; dlg.id = 'printModal'; dlg.hidden = true;
    dlg.innerHTML = '<div class="docbox prbox" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<header><b id="prTitle">Print</b><span class="grow"></span>' +
      '<button class="x" id="prClose" type="button" aria-label="Close">&times;</button></header>' +
      '<div class="prbody">' +
      '<div class="prleft">' +
        '<div class="prtop">' +
          '<label class="drow"><span>Printer</span><select id="prPrinter"></select>' +
          '<button class="btn" id="prProps" type="button">Properties</button>' +
          '<button class="btn" id="prAdvanced" type="button">Advanced</button></label>' +
          '<label class="drow"><span>Copies</span><input id="prCopies" type="number" min="1" max="999" value="1">' +
          check('prGray', 'Print in grayscale (black and white)') + '</label>' +
        '</div>' +
        '<fieldset class="prset"><legend>Pages to Print</legend>' +
          '<div class="prline">' + radio('prPick', 'all', 'All') + radio('prPick', 'current', 'Current page') +
          radio('prPick', 'range', 'Pages') + '<input id="prRange" placeholder="e.g. 1-5, 8, 11-13" aria-label="Pages"></div>' +
          '<button class="prmore" id="prMore" type="button" aria-expanded="false">More Options</button>' +
          '<div class="prmoreb" id="prMoreBox" hidden>' +
            '<label class="drow"><span>Odd or even</span><select id="prSubset">' +
            '<option value="all">All pages in range</option><option value="odd">Odd pages only</option>' +
            '<option value="even">Even pages only</option></select></label>' +
            check('prReverse', 'Reverse pages') +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="prset"><legend>Page Sizing &amp; Handling</legend>' +
          '<div class="prseg" role="tablist">' +
            '<button type="button" role="tab" data-mode="size">Size</button>' +
            '<button type="button" role="tab" data-mode="poster">Poster</button>' +
            '<button type="button" role="tab" data-mode="multiple">Multiple</button>' +
            '<button type="button" role="tab" data-mode="booklet">Booklet</button></div>' +
          '<div class="prmode" data-for="size">' +
            '<div class="prgrid">' + radio('prFit', 'fit', 'Fit') + radio('prFit', 'actual', 'Actual size') +
            radio('prFit', 'shrink', 'Shrink oversized pages') +
            '<label class="prchk"><input type="radio" name="prFit" value="custom"><span>Custom Scale:</span>' +
            '<input id="prScale" type="number" min="1" max="1000" value="100" aria-label="Custom scale"><span>%</span></label></div>' +
            check('prByPage', 'Choose paper source by PDF page size') +
          '</div>' +
          '<div class="prmode" data-for="poster" hidden>' +
            '<label class="drow"><span>Tile Scale</span><input id="prTile" type="number" min="10" max="1000" value="100">' +
            '<span class="prunit">%</span></label>' +
            '<label class="drow"><span>Overlap</span><input id="prOverlap" type="number" min="0" max="5" step="0.05" value="0.5">' +
            '<span class="prunit">in</span></label>' +
            check('prLargeOnly', 'Tile only large pages') +
          '</div>' +
          '<div class="prmode" data-for="multiple" hidden>' +
            '<label class="drow"><span>Pages per sheet</span><select id="prPer">' +
            '<option>2</option><option>4</option><option>6</option><option>9</option><option>16</option></select></label>' +
            '<label class="drow"><span>Page order</span><select id="prOrder">' +
            '<option value="h">Horizontal</option><option value="hr">Horizontal Reversed</option>' +
            '<option value="v">Vertical</option><option value="vr">Vertical Reversed</option></select></label>' +
            check('prBorder', 'Print page border') +
          '</div>' +
          '<div class="prmode" data-for="booklet" hidden>' +
            '<label class="drow"><span>Booklet subset</span><select id="prSide">' +
            '<option value="both">Both sides</option><option value="front">Front side only</option>' +
            '<option value="back">Back side only</option></select></label>' +
            '<label class="drow"><span>Binding</span><select id="prBinding">' +
            '<option value="left">Left</option><option value="right">Right</option></select></label>' +
          '</div>' +
        '</fieldset>' +
        '<fieldset class="prset">' +
          check('prBoth', 'Print on both sides of paper') +
          '<div class="prline prsub">' + radio('prFlip', 'long', 'Flip on long edge') + radio('prFlip', 'short', 'Flip on short edge') + '</div>' +
          '<div class="prline"><span class="prlab">Orientation:</span>' + radio('prOrient', 'auto', 'Auto') +
          radio('prOrient', 'portrait', 'Portrait') + radio('prOrient', 'landscape', 'Landscape') + '</div>' +
        '</fieldset>' +
        '<fieldset class="prset"><legend>Comments &amp; Forms</legend>' +
          '<select id="prAnnots" aria-label="Comments and forms"><option value="all">Document and Markups</option>' +
          '<option value="doc">Document</option></select>' +
        '</fieldset>' +
      '</div>' +
      '<div class="prright">' +
        '<div class="prfacts"><span id="prScaleV">Scale: 100%</span><span id="prSizeV"></span></div>' +
        '<div class="prpaper" id="prStage"><canvas id="prCanvas" aria-label="Preview of the sheet"></canvas>' +
        '<div class="prwait" id="prWait">Preparing…</div></div>' +
        '<div class="prnav"><button class="btn" id="prPrev" type="button" aria-label="Previous sheet">&lsaquo;</button>' +
        '<input id="prSlide" type="range" min="1" max="1" value="1" aria-label="Sheet">' +
        '<button class="btn" id="prNext" type="button" aria-label="Next sheet">&rsaquo;</button></div>' +
        '<div class="prof" id="prOf">Page 1 of 1</div>' +
      '</div>' +
      '</div>' +
      '<footer><button class="btn" id="prSetup" type="button">Page Setup…</button>' +
      '<button class="prlink" id="prSystem" type="button">Print using system dialog…</button>' +
      '<span class="docnote" id="prNote"></span><span class="grow"></span>' +
      '<button class="btn primary" id="prGo" type="button">Print</button>' +
      '<button class="btn" id="prCancel" type="button">Cancel</button></footer>' +
      /* Advanced and Page Setup: small dialogs over this one, as Acrobat's */
      '<div class="prpop" id="prAdvBox" hidden role="dialog" aria-modal="true" aria-labelledby="prAdvT">' +
        '<div class="prpopb"><b id="prAdvT">Advanced Print Setup</b>' +
        check('prImage', 'Print As Image') +
        '<label class="drow"><span>Resolution</span><select id="prDpi">' +
        '<option value="150">150 dpi</option><option value="300">300 dpi</option><option value="600">600 dpi</option></select></label>' +
        '<p class="dhint">For a printer that stops or prints a drawing wrongly: each page is sent as a picture. ' +
        'Slower, and the text is no longer text.</p>' +
        '<div class="prpopf"><button class="btn primary" type="button" data-pop="ok">OK</button></div></div></div>' +
      '<div class="prpop" id="prSetupBox" hidden role="dialog" aria-modal="true" aria-labelledby="prSetupT">' +
        '<div class="prpopb"><b id="prSetupT">Page Setup</b>' +
        '<label class="drow"><span>Size</span><select id="prPaper"></select></label>' +
        '<label class="drow"><span>Source</span><select id="prSource"></select></label>' +
        '<div class="prpopf"><button class="btn primary" type="button" data-pop="ok">OK</button></div></div></div>' +
      '</div>';
    document.body.appendChild(dlg);

    const all = function (sel) { return Array.prototype.slice.call(dlg.querySelectorAll(sel)); };
    const val = function (name) { const r = dlg.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };
    const setVal = function (name, v) { all('input[name="' + name + '"]').forEach(function (r) { r.checked = r.value === String(v); }); };

    /* ---------------- the document, as it prints ---------------- */

    /* the PDF made for printing (marks painted in, or left out), and pdf.js
       open on it for the preview and the pages' sizes */
    let made = null;
    function makeDoc() {
      const key = o.annots;
      if (made && made.key === key) return made.ready;
      if (made && made.pdf) made.pdf.destroy();
      const m = { key: key, bytes: null, pdf: null, sizes: null, cache: new Map() };
      made = m;
      const items = key === 'doc'
        ? S.items.map(function (it) { return Object.assign({}, it, { shapes: [] }); })
        : S.items;
      m.ready = (async function () {
        const b = await X.buildPdf(items, null, { photos: false, annots: false });
        m.bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
        m.pdf = await X.pdfjsLib.getDocument({ data: m.bytes.slice(), isEvalSupported: false }).promise;
        const sizes = [];
        for (let i = 1; i <= m.pdf.numPages; i++) {
          const v = (await m.pdf.getPage(i)).getViewport({ scale: 1 });
          sizes.push({ w: v.width, h: v.height, r: v.rotation });
        }
        m.sizes = sizes;
        return m;
      })();
      m.ready.catch(function () { if (made === m) made = null; });
      return m.ready;
    }

    /* ---------------- the printer ---------------- */

    let caps = null;                       /* print_caps for the printer picked */
    /* without a printer, the usual papers by their Windows numbers */
    const STOCK = [[9, 'a4'], [8, 'a3'], [11, 'a5'], [1, 'letter'], [5, 'legal'], [3, 'tabloid']].map(function (x) {
      const p = PL.PAPERS.find(function (q) { return q.id === x[1]; });
      return { id: x[0], name: p.name, w: p.w, h: p.h };
    });
    let papers = STOCK, bins = [];

    function setup(plan) {
      return {
        orientation: plan && plan.landscape ? 'landscape' : 'portrait',
        paper: o.paper, color: !o.gray, duplex: duplex(),
        source: bins.length ? o.source : null
      };
    }
    function duplex() {
      if (o.mode === 'booklet' && o.side === 'both') return 'short';
      return o.both ? o.flip : 'off';
    }

    async function loadPrinters() {
      const sel = $('prPrinter');
      sel.innerHTML = '<option>Finding printers…</option>';
      let p;
      try { p = await T.core.invoke('print_printers'); } catch (e) { p = { list: [], default: null }; }
      if (!p.list.length) {
        sel.innerHTML = '<option value="">No printer found</option>';
        o.printer = '';
        await loadCaps();
        return;
      }
      sel.innerHTML = p.list.map(function (n) { return '<option>' + X.esc(n) + '</option>'; }).join('');
      if (p.list.indexOf(o.printer) < 0) o.printer = p.default && p.list.indexOf(p.default) >= 0 ? p.default : p.list[0];
      sel.value = o.printer;
      await loadCaps();
    }

    async function loadCaps(fromProps) {
      caps = null;
      if (o.printer) {
        try {
          const s = fromProps || setup(null);
          if (!fromProps) s.orientation = null;
          caps = await T.core.invoke('print_caps', { name: o.printer, setup: s });
        } catch (e) { caps = null; note(X.esc(String(e))); }
      }
      papers = caps && caps.papers.length ? caps.papers : STOCK;
      bins = caps ? caps.bins : [];
      if (!papers.some(function (p) { return p.id === o.paper; })) o.paper = caps ? caps.paper : papers[0].id;
      if (bins.length && !bins.some(function (b) { return b.id === o.source; })) {
        o.source = caps.setup && caps.setup.source != null && bins.some(function (b) { return b.id === caps.setup.source; })
          ? caps.setup.source : bins[0].id;
      }
      $('prGray').disabled = !!caps && !caps.color;
      if (caps && !caps.color) o.gray = true;
      $('prProps').disabled = !o.printer;
      fillPaper();
    }

    function fillPaper() {
      $('prPaper').innerHTML = papers.map(function (p) {
        return '<option value="' + p.id + '">' + X.esc(p.name) + '</option>';
      }).join('');
      $('prPaper').value = String(o.paper);
      $('prSource').innerHTML = bins.length
        ? bins.map(function (b) { return '<option value="' + b.id + '">' + X.esc(b.name) + '</option>'; }).join('')
        : '<option value="">The printer chooses</option>';
      $('prSource').disabled = !bins.length;
      if (bins.length) $('prSource').value = String(o.source);
    }

    function paperNow() {
      const p = papers.find(function (x) { return x.id === o.paper; }) || papers[0];
      /* the printer's own measure of the paper set, when it is this one */
      if (caps && caps.paper === p.id) return { w: caps.size[0], h: caps.size[1] };
      return { w: p.w, h: p.h };
    }
    function margins() {
      if (caps) return { l: caps.margins[0], t: caps.margins[1], r: caps.margins[2], b: caps.margins[3] };
      return { l: 0, t: 0, r: 0, b: 0 };
    }

    /* ---------------- the plan and its preview ---------------- */

    let plan = null, sheet = 0;

    function readForm() {
      o.copies = Math.min(999, Math.max(1, parseInt($('prCopies').value, 10) || 1));
      o.gray = $('prGray').checked;
      o.pick = val('prPick') || 'all';
      o.range = $('prRange').value;
      o.subset = $('prSubset').value;
      o.reverse = $('prReverse').checked;
      o.fit = val('prFit') || 'fit';
      o.scale = Math.min(1000, Math.max(1, parseFloat($('prScale').value) || 100));
      o.byPage = $('prByPage').checked;
      o.tile = Math.min(1000, Math.max(10, parseFloat($('prTile').value) || 100));
      o.overlap = Math.min(5, Math.max(0, parseFloat($('prOverlap').value) || 0));
      o.largeOnly = $('prLargeOnly').checked;
      o.per = +$('prPer').value;
      o.order = $('prOrder').value;
      o.border = $('prBorder').checked;
      o.side = $('prSide').value;
      o.binding = $('prBinding').value;
      if ($('prPaper').value) o.paper = +$('prPaper').value;
      if (bins.length && $('prSource').value) o.source = +$('prSource').value;
      o.both = $('prBoth').checked;
      o.flip = val('prFlip') || 'long';
      o.orient = val('prOrient') || 'auto';
      o.annots = $('prAnnots').value;
      o.image = $('prImage').checked;
      o.dpi = +$('prDpi').value || 300;
    }
    function writeForm() {
      $('prCopies').value = o.copies;
      $('prGray').checked = o.gray;
      setVal('prPick', o.pick);
      $('prRange').value = o.range;
      $('prSubset').value = o.subset;
      $('prReverse').checked = o.reverse;
      setVal('prFit', o.fit);
      $('prScale').value = o.scale;
      $('prByPage').checked = o.byPage;
      $('prTile').value = o.tile;
      $('prOverlap').value = o.overlap;
      $('prLargeOnly').checked = o.largeOnly;
      $('prPer').value = String(o.per);
      $('prOrder').value = o.order;
      $('prBorder').checked = o.border;
      $('prSide').value = o.side;
      $('prBinding').value = o.binding;
      $('prPaper').value = String(o.paper);
      if (bins.length) $('prSource').value = String(o.source);
      $('prBoth').checked = o.both;
      setVal('prFlip', o.flip);
      setVal('prOrient', o.orient);
      $('prAnnots').value = o.annots;
      $('prImage').checked = o.image;
      $('prDpi').value = String(o.dpi);
      $('prDpi').disabled = !o.image;
      all('.prseg button').forEach(function (b) {
        const on = b.dataset.mode === o.mode;
        b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      all('.prmode').forEach(function (m) { m.hidden = m.dataset.for !== o.mode; });
      const booklet = o.mode === 'booklet';
      $('prBoth').disabled = booklet || (!!caps && !caps.duplex);
      all('input[name="prFlip"]').forEach(function (r) { r.disabled = !o.both || $('prBoth').disabled; });
      $('prScale').disabled = o.fit !== 'custom';
      /* paper by page size picks each sheet's paper and its way round */
      all('input[name="prOrient"]').forEach(function (r) { r.disabled = o.mode === 'size' && o.byPage; });
    }

    function replan() {
      if (!made || !made.sizes) return;
      plan = PL.plan(made.sizes, {
        pick: o.pick, current: S.current - 1, range: o.range, subset: o.subset, reverse: o.reverse,
        mode: o.mode, fit: o.fit, scale: o.scale, per: o.per, order: o.order, border: o.border,
        binding: o.binding, side: o.side, orient: o.orient, paper: paperNow(), margins: margins(),
        byPage: o.byPage, papers: papers, tile: o.tile, overlap: o.overlap * 72, largeOnly: o.largeOnly
      });
      const n = plan.error ? 0 : plan.sheets.length;
      sheet = Math.min(sheet, Math.max(0, n - 1));
      $('prSlide').max = String(Math.max(1, n));
      $('prSlide').value = String(sheet + 1);
      $('prOf').textContent = n ? 'Page ' + (sheet + 1) + ' of ' + n : '';
      $('prGo').disabled = !!plan.error || !o.printer;
      $('prRange').classList.toggle('bad', !!plan.error && o.pick === 'range');
      if (plan.error) {
        note(X.esc(plan.error));
        $('prScaleV').textContent = ''; $('prSizeV').textContent = '';
      } else {
        note(!o.printer ? 'No printer found: add one in Windows Settings' : '');
        $('prScaleV').textContent = 'Scale: ' + Math.round(plan.scale * 100) + '%';
      }
      draw();
    }

    /* the sheet's own paper when it has one (paper by page size, a poster), else the plan's */
    function sheetBox(sh) {
      return sh.w ? { w: sh.w, h: sh.h, landscape: sh.landscape } : { w: plan.w, h: plan.h, landscape: plan.landscape };
    }

    let drawing = 0;
    async function draw() {
      const my = ++drawing;
      const cv = $('prCanvas'), box = $('prStage');
      if (!plan || plan.error) { cv.width = cv.height = 0; return; }
      const sh = plan.sheets[sheet], P = sheetBox(sh);
      $('prSizeV').textContent = (P.w / 72).toFixed(2) + ' x ' + (P.h / 72).toFixed(2) + ' Inches' +
        (sh.cells[0] && sh.cells[0].tile ? ' · tile ' + sh.cells[0].tile.join(', ') : '');
      const dpr = window.devicePixelRatio || 1;
      const k = Math.min((box.clientWidth - 16) / P.w, (box.clientHeight - 16) / P.h);
      const W = Math.max(1, Math.round(P.w * k)), H = Math.max(1, Math.round(P.h * k));
      const off = document.createElement('canvas');
      off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      const c = off.getContext('2d');
      c.scale(k * dpr, k * dpr);
      c.fillStyle = '#fff'; c.fillRect(0, 0, P.w, P.h);
      for (const cell of sh.cells) {
        const img = await pageImage(cell.page, cell.w * k * dpr);
        if (my !== drawing) return;
        c.save();
        c.beginPath(); c.rect(cell.clip.x, cell.clip.y, cell.clip.w, cell.clip.h); c.clip();
        if (o.gray) c.filter = 'grayscale(1)';
        c.translate(cell.x, cell.y);
        if (cell.rot === 1) { c.translate(cell.w, 0); c.rotate(Math.PI / 2); }
        else if (cell.rot === 3) { c.translate(0, cell.h); c.rotate(-Math.PI / 2); }
        const w = cell.rot ? cell.h : cell.w, h = cell.rot ? cell.w : cell.h;
        if (img) c.drawImage(img, 0, 0, w, h);
        c.restore();
        if (cell.border) { c.lineWidth = 0.75 / k; c.strokeStyle = '#000'; c.strokeRect(cell.x, cell.y, cell.w, cell.h); }
      }
      /* the part the printer cannot reach, outlined */
      const m = margins();
      if (m.l || m.t) {
        c.strokeStyle = 'rgba(0,0,0,.25)'; c.setLineDash([3 / k, 3 / k]); c.lineWidth = 0.75 / k;
        const lr = Math.max(m.l, m.r), tb = Math.max(m.t, m.b);
        const x = P.landscape ? tb : lr, y = P.landscape ? lr : tb;
        c.strokeRect(x, y, P.w - 2 * x, P.h - 2 * y);
      }
      if (my !== drawing) return;
      cv.width = off.width; cv.height = off.height;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      cv.getContext('2d').drawImage(off, 0, 0);
    }

    /* page `i` drawn about `px` wide, kept for the next sheets */
    async function pageImage(i, px) {
      const m = made;
      const want = Math.min(1600, Math.max(64, Math.ceil(px / 64) * 64));
      const key = i + ':' + want;
      if (m.cache.has(key)) return m.cache.get(key);
      const page = await m.pdf.getPage(i + 1);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: want / v1.width });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      try {
        await page.render({
          canvasContext: ctx, viewport: vp, intent: 'print',
          annotationMode: o.annots === 'doc' ? X.pdfjsLib.AnnotationMode.DISABLE : X.pdfjsLib.AnnotationMode.ENABLE_FORMS
        }).promise;
      } catch (e) { return null; }
      if (m.cache.size > 40) m.cache.delete(m.cache.keys().next().value);
      m.cache.set(key, cv);
      return cv;
    }

    function note(html) { $('prNote').innerHTML = html; }

    /* ---------------- Advanced and Page Setup ---------------- */

    let popOpen = null;
    function pop(id) {
      popOpen = $(id);
      popOpen.hidden = false;
      const f = popOpen.querySelector('input,select');
      if (f) f.focus();
    }
    function unpop() {
      if (!popOpen) return;
      popOpen.hidden = true;
      popOpen = null;
    }
    all('.prpop [data-pop="ok"]').forEach(function (b) { b.addEventListener('click', unpop); });
    all('.prpop').forEach(function (p) { p.addEventListener('mousedown', function (e) { if (e.target === p) unpop(); }); });
    $('prAdvanced').addEventListener('click', function () { pop('prAdvBox'); });
    $('prSetup').addEventListener('click', function () { pop('prSetupBox'); });

    /* ---------------- opening, choosing, printing ---------------- */

    let opening = null;
    async function open() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!dlg.hidden || opening) return;
      o.copies = 1; o.pick = 'all'; o.range = ''; o.subset = 'all'; o.reverse = false;
      /* made again each time: the marks may have changed since */
      if (made && made.pdf) made.pdf.destroy();
      made = null;
      plan = null; sheet = 0;
      unpop();
      dlg.hidden = false;
      $('prWait').hidden = false; $('prWait').textContent = 'Preparing…';
      $('prGo').disabled = true;
      note('');
      writeForm();
      setTimeout(function () { $('prGo').focus(); }, 0);
      opening = Promise.all([loadPrinters(), makeDoc()]).then(function () {
        writeForm();
        $('prWait').hidden = true;
        replan();
      }, function (e) {
        $('prWait').textContent = 'This document could not be prepared for printing';
        note('<span class="bad">' + X.esc(X.saveError(e, 'This document could not be prepared for printing')) + '</span>');
      }).finally(function () { opening = null; });
      return opening;
    }
    function close() {
      unpop();
      dlg.hidden = true;
      drawing++;
    }

    let timer = 0;
    function changed(e) {
      const id = e && e.target && e.target.id;
      readForm();
      writeForm();
      keep();
      clearTimeout(timer);
      if (id === 'prAnnots') {
        $('prWait').hidden = false;
        makeDoc().then(function () { $('prWait').hidden = true; replan(); }, function () {});
        return;
      }
      /* another paper or tray: the printer says how much of it it can reach */
      if ((id === 'prPaper' || id === 'prSource') && caps) {
        loadCaps(setup(plan)).then(function () { writeForm(); replan(); });
        return;
      }
      /* typing a range or a number: the preview waits for a pause */
      const slow = /^pr(Range|Scale|Copies|Tile|Overlap)$/.test(id || '');
      timer = setTimeout(replan, slow ? 250 : 0);
    }
    dlg.addEventListener('input', changed);
    dlg.addEventListener('change', changed);
    $('prRange').addEventListener('focus', function () { setVal('prPick', 'range'); readForm(); writeForm(); });
    $('prRange').addEventListener('mousedown', function () {
      if (o.pick !== 'range') { setVal('prPick', 'range'); readForm(); writeForm(); $('prRange').focus(); }
    });
    all('.prseg button').forEach(function (b) {
      b.addEventListener('click', function () { o.mode = b.dataset.mode; writeForm(); keep(); replan(); });
    });
    $('prMore').addEventListener('click', function () {
      const box = $('prMoreBox');
      box.hidden = !box.hidden;
      this.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
    });
    $('prPrinter').addEventListener('change', function () {
      o.printer = this.value; keep();
      loadCaps().then(function () { writeForm(); replan(); });
    });
    $('prProps').addEventListener('click', async function () {
      if (!o.printer) return;
      try {
        const s = await T.core.invoke('print_properties', { name: o.printer, setup: setup(plan) });
        if (!s) return;
        if (s.orientation) o.orient = s.orientation;
        if (s.duplex) { o.both = s.duplex !== 'off'; if (o.both) o.flip = s.duplex; }
        if (s.color !== undefined && s.color !== null) o.gray = !s.color;
        if (s.paper) o.paper = s.paper;
        if (s.source) o.source = s.source;
        keep();
        await loadCaps(s);
        writeForm();
        replan();
      } catch (e) { note('<span class="bad">' + X.esc(String(e)) + '</span>'); }
    });
    function go(by) {
      sheet = Math.min(Math.max(0, sheet + by), plan && !plan.error ? plan.sheets.length - 1 : 0);
      replan();
    }
    $('prPrev').addEventListener('click', function () { go(-1); });
    $('prNext').addEventListener('click', function () { go(1); });
    $('prSlide').addEventListener('input', function (e) { e.stopPropagation(); sheet = (+this.value || 1) - 1; replan(); });
    $('prClose').addEventListener('click', close);
    $('prCancel').addEventListener('click', close);
    dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); if (popOpen) unpop(); else close(); }
      else if (e.key === 'PageDown') { e.preventDefault(); go(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); go(-1); }
    });
    window.addEventListener('resize', function () { if (!dlg.hidden) draw(); });
    $('prSystem').addEventListener('click', function () { close(); X.printSystem(); });

    $('prGo').addEventListener('click', async function () {
      readForm();
      if (!plan || plan.error || !made || !made.bytes || !o.printer) return;
      const b = $('prGo');
      b.disabled = true;
      try {
        await printHere();
      } catch (e) {
        note('<span class="bad">' + X.esc(typeof e === 'string' ? e : X.saveError(e, 'The document could not be printed')) + '</span>');
      } finally { b.disabled = false; }
    });

    /* straight to the printer */
    async function printHere() {
      const job = {
        printer: o.printer, setup: setup(plan), title: S.baseName || 'Add Dots PDF', copies: o.copies,
        gray: o.gray, annots: o.annots !== 'doc', image: o.image ? o.dpi : null,
        sheets: plan.sheets.map(function (s) {
          return {
            paper: s.paper != null ? s.paper : null,
            landscape: s.w ? !!s.landscape : null,
            cells: s.cells.map(function (c) {
              return { page: c.page, x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rot,
                clip: [c.clip.x, c.clip.y, c.clip.w, c.clip.h], border: c.border };
            })
          };
        })
      };
      const json = new TextEncoder().encode(JSON.stringify(job));
      const body = new Uint8Array(4 + json.length + made.bytes.length);
      new DataView(body.buffer).setUint32(0, json.length, true);
      body.set(json, 4); body.set(made.bytes, 4 + json.length);
      note('Sending to ' + X.esc(o.printer) + '…');
      const n = await T.core.invoke('print_send', body);
      close();
      X.toast('Sent <b>' + n + '</b> sheet' + (n === 1 ? '' : 's') + ' to ' + X.esc(o.printer));
    }

    X.on('reset', function () { if (made && made.pdf) made.pdf.destroy(); made = null; close(); });
    X.on('pages', function () { if (made && made.pdf) made.pdf.destroy(); made = null; });

    X.printDialog = { open: open, close: close, isOpen: function () { return !dlg.hidden; } };
  });
})();
