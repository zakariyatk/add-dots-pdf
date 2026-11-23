/* Add Dots PDF — the Print dialog
   ------------------------------
   Print (the button, the page menu, Ctrl+P) opens the app's own dialog, laid
   out as Acrobat's: the printer and copies, which pages, how they go on the
   paper (Size, Poster, Multiple, Booklet), the paper's way round, whether
   the marks are printed, and a preview of each sheet as it will come out.

   The sheets are planned by js/printplan.js (ADDPRINT.plan) and drawn here
   into a PDF of their own, one PDF page a sheet, with each document page
   placed, scaled, turned and cut to its place on it. The Windows app sends
   that straight to the printer chosen (the desktop side lists the printers
   and prints, js/desktop.js); a browser cannot name a printer, so there the
   sheets go to the browser's own print dialog, which asks for one.

   Beside the printer, as in Acrobat: Properties opens the printer's own
   settings from its driver (on Windows its Printing Preferences: trays,
   quality, stapling, which the job then prints with), and Advanced the
   finer choices: which edge a two-sided sheet flips on, collating, the
   resolution the sheets go at, and printing through the system's own
   print dialog. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[printdlg] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const P = window.ADDPRINT;
    const L = window.PDFLib;
    if (!P || !L) return;

    const KEEP = 'adpdf.print';
    const MM = 72 / 25.4;
    const MARGIN = 12;                              /* a printer's usual unprintable edge, in points */
    const DEFAULTS = {
      printer: '', copies: 1, gray: false, paper: 'a4',
      pick: 'all', range: '', subset: 'all', reverse: false,
      mode: 'size', fit: 'fit', scale: 100, byPage: false,
      tile: 100, overlap: 0, largeOnly: false,
      per: 2, order: 'h', border: false,
      side: 'both', binding: 'left',
      orient: 'auto', markups: true,
      duplex: false, flip: 'long', collate: true, dpi: 'auto'
    };
    function kept() {
      try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEEP) || '{}')); }
      catch (e) { return Object.assign({}, DEFAULTS); }
    }
    function keep(o) {
      const k = {};
      ['printer', 'copies', 'gray', 'paper', 'mode', 'fit', 'scale', 'byPage', 'tile', 'overlap', 'largeOnly',
        'per', 'order', 'border', 'side', 'binding', 'orient', 'markups', 'duplex', 'flip', 'collate', 'dpi'].forEach(function (n) { k[n] = o[n]; });
      try { localStorage.setItem(KEEP, JSON.stringify(k)); } catch (e) { /* this time only */ }
    }

    const desk = function () { return typeof X.printers === 'function' && typeof X.printPages === 'function'; };

    /* ---------------- the document, as it prints ---------------- */

    /* the document built as it is now (with its marks painted in, or
       without them), loaded for drawing onto sheets; kept while the dialog
       is open, rebuilt when the marks are switched on or off */
    let src = null;                                   /* { markups, doc, pages, sizes } */
    async function source(markups) {
      if (src && src.markups === markups) return src;
      const items = markups ? S.items : S.items.map(function (it) { return Object.assign({}, it, { shapes: [] }); });
      const bytes = await X.buildPdf(items, null, { photos: false, annots: false });
      const doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = doc.getPages();
      const sizes = pages.map(function (pg) {
        const r = ((pg.getRotation().angle % 360) + 360) % 360;
        const box = pg.getCropBox ? pg.getCropBox() : pg.getMediaBox();
        const quarter = r === 90 || r === 270;
        return { w: quarter ? box.height : box.width, h: quarter ? box.width : box.height, r: r, box: box };
      });
      src = { markups: markups, doc: doc, pages: pages, sizes: sizes };
      return src;
    }

    /* the choices as ADDPRINT.plan takes them */
    function planFor(o, s) {
      const paper = P.PAPERS.filter(function (p) { return p.id === o.paper; })[0] || P.PAPERS[0];
      return P.plan(s.sizes.map(function (z) { return { w: z.w, h: z.h, r: z.r }; }), {
        pick: o.pick, current: S.current - 1, range: o.range, subset: o.subset, reverse: o.reverse,
        mode: o.mode, fit: o.fit, scale: o.scale, byPage: o.byPage, papers: P.PAPERS,
        tile: o.tile, overlap: o.overlap * MM, largeOnly: o.largeOnly,
        per: o.per, order: o.order, border: o.border,
        side: o.side, binding: o.binding,
        orient: o.orient, paper: paper,
        margins: { l: MARGIN, t: MARGIN, r: MARGIN, b: MARGIN }
      });
    }

    /* Sheets `which` of plan `pl` as a PDF of their own. A cell gives the box
       a page fills on the sheet (from its top left, y down), its quarter turn
       on top of the page's own, and the part of the sheet it is cut to. */
    async function compose(s, pl, which) {
      const out = await L.PDFDocument.create();
      const used = {};
      which.forEach(function (k) { pl.sheets[k].cells.forEach(function (c) { used[c.page] = 1; }); });
      const idx = Object.keys(used).map(Number);
      const emb = {};
      const embedded = await out.embedPages(idx.map(function (i) { return s.pages[i]; }),
        idx.map(function (i) {
          const b = s.sizes[i].box;
          return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height };
        }));
      idx.forEach(function (i, n) { emb[i] = embedded[n]; });
      which.forEach(function (k) {
        const sh = pl.sheets[k];
        const W = sh.w || pl.w, H = sh.h || pl.h;
        const page = out.addPage([W, H]);
        sh.cells.forEach(function (c) {
          const e = emb[c.page], z = s.sizes[c.page];
          const T = (z.r + (c.rot || 0) * 90) % 360;
          const quarter = T === 90 || T === 270;
          const sc = c.w / (quarter ? e.height : e.width);
          const w0 = e.width * sc, h0 = e.height * sc;
          /* the box, in the PDF's own way up */
          const X0 = c.x, Y0 = H - c.y - c.h;
          let ox = X0, oy = Y0;
          if (T === 90) { oy = Y0 + w0; }
          else if (T === 180) { ox = X0 + w0; oy = Y0 + h0; }
          else if (T === 270) { ox = X0 + h0; }
          const cl = c.clip;
          page.pushOperators(L.pushGraphicsState(),
            L.rectangle(cl.x, H - cl.y - cl.h, cl.w, cl.h), L.clip(), L.endPath());
          page.drawPage(e, { x: ox, y: oy, width: w0, height: h0, rotate: L.degrees(-T) });
          page.pushOperators(L.popGraphicsState());
          if (c.border) {
            page.drawRectangle({ x: X0, y: Y0, width: c.w, height: c.h, borderColor: L.rgb(0, 0, 0), borderWidth: 0.5 });
          }
        });
      });
      return out.save();
    }

    /* ---------------- the dialog ---------------- */

    const wrap = document.createElement('div');
    wrap.className = 'wdwrap prwrap'; wrap.hidden = true;
    wrap.innerHTML =
      '<form class="wdbox prbox" role="dialog" aria-modal="true" aria-label="Print" novalidate>' +
        '<div class="wdhead"><h2 class="wdtitle">Print</h2>' +
          '<button type="button" class="wdx" id="prX" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
        '<div class="prtop">' +
          '<div class="prrow prprinter"><label class="prrow"><span>Printer:</span><select class="wdsel prwide" id="prPrinter"></select></label>' +
            '<span class="prdrv" id="prDrv">' +
              '<button type="button" class="wdbtn" id="prProps" title="The printer\'s own settings: paper tray, quality, stapling">Properties</button>' +
              '<button type="button" class="wdbtn" id="prAdv" aria-haspopup="dialog">Advanced</button>' +
            '</span></div>' +
          '<label class="prrow"><span>Copies:</span><input class="wdin prnum" id="prCopies" type="number" min="1" max="999" step="1"></label>' +
          '<label class="prchk" id="prGrayWrap"><input type="checkbox" id="prGray"> Print in grayscale (black and white)</label>' +
          '<label class="prchk" id="prDuplexWrap"><input type="checkbox" id="prDuplex"> Print on both sides of paper</label>' +
          '<label class="prrow"><span>Paper:</span><select class="wdsel" id="prPaper"></select></label>' +
        '</div>' +
        '<div class="prmain">' +
          '<div class="prleft">' +
            '<fieldset class="prset"><legend>Pages to Print</legend>' +
              '<div class="prline">' +
                '<label><input type="radio" name="prPick" value="all"> All</label>' +
                '<label><input type="radio" name="prPick" value="current"> Current</label>' +
                '<label><input type="radio" name="prPick" value="range"> Pages</label>' +
                '<input class="wdin prrange" id="prRange" placeholder="1 - 13" aria-label="Pages to print">' +
              '</div>' +
              '<details class="prmore"><summary>More Options</summary>' +
                '<div class="prline"><label class="prrow"><span>Odd or even pages:</span><select class="wdsel" id="prSubset">' +
                  '<option value="all">All pages in range</option><option value="odd">Odd pages only</option><option value="even">Even pages only</option></select></label>' +
                '<label class="prchk"><input type="checkbox" id="prReverse"> Reverse pages</label></div>' +
              '</details>' +
            '</fieldset>' +
            '<fieldset class="prset"><legend>Page Sizing &amp; Handling</legend>' +
              '<div class="prmodes" role="tablist">' +
                ['size', 'poster', 'multiple', 'booklet'].map(function (m) {
                  return '<button type="button" class="prmode" role="tab" data-mode="' + m + '">' + m[0].toUpperCase() + m.slice(1) + '</button>';
                }).join('') +
              '</div>' +
              '<div class="prpane" data-pane="size">' +
                '<div class="prgrid">' +
                  '<label><input type="radio" name="prFit" value="fit"> Fit</label>' +
                  '<label><input type="radio" name="prFit" value="actual"> Actual size</label>' +
                  '<label><input type="radio" name="prFit" value="shrink"> Shrink oversized pages</label>' +
                  '<label><input type="radio" name="prFit" value="custom"> Custom Scale: <input class="wdin prnum" id="prScale" type="number" min="1" max="1000"> %</label>' +
                '</div>' +
                '<label class="prchk"><input type="checkbox" id="prByPage"> Choose paper source by PDF page size</label>' +
              '</div>' +
              '<div class="prpane" data-pane="poster">' +
                '<div class="prgrid">' +
                  '<label class="prrow"><span>Tile Scale:</span><input class="wdin prnum" id="prTile" type="number" min="1" max="1000"> %</label>' +
                  '<label class="prrow"><span>Overlap:</span><input class="wdin prnum" id="prOverlap" type="number" min="0" max="100"> mm</label>' +
                '</div>' +
                '<label class="prchk"><input type="checkbox" id="prLarge"> Tile large pages only</label>' +
              '</div>' +
              '<div class="prpane" data-pane="multiple">' +
                '<div class="prgrid">' +
                  '<label class="prrow"><span>Pages per sheet:</span><select class="wdsel" id="prPer">' +
                    [2, 4, 6, 9, 16].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('') + '</select></label>' +
                  '<label class="prrow"><span>Page order:</span><select class="wdsel" id="prOrder">' +
                    '<option value="h">Horizontal</option><option value="hr">Horizontal Reversed</option>' +
                    '<option value="v">Vertical</option><option value="vr">Vertical Reversed</option></select></label>' +
                '</div>' +
                '<label class="prchk"><input type="checkbox" id="prBorder"> Print page border</label>' +
              '</div>' +
              '<div class="prpane" data-pane="booklet">' +
                '<div class="prgrid">' +
                  '<label class="prrow"><span>Booklet subset:</span><select class="wdsel" id="prSide">' +
                    '<option value="both">Both sides</option><option value="front">Front side only</option><option value="back">Back side only</option></select></label>' +
                  '<label class="prrow"><span>Binding:</span><select class="wdsel" id="prBinding">' +
                    '<option value="left">Left</option><option value="right">Right</option></select></label>' +
                '</div>' +
              '</div>' +
            '</fieldset>' +
            '<fieldset class="prset"><legend>Orientation</legend>' +
              '<div class="prline">' +
                '<label><input type="radio" name="prOrient" value="auto"> Auto</label>' +
                '<label><input type="radio" name="prOrient" value="portrait"> Portrait</label>' +
                '<label><input type="radio" name="prOrient" value="landscape"> Landscape</label>' +
              '</div>' +
            '</fieldset>' +
            '<fieldset class="prset"><legend>Comments &amp; Forms</legend>' +
              '<select class="wdsel prwide" id="prMarks"><option value="1">Document and Markups</option><option value="0">Document</option></select>' +
            '</fieldset>' +
          '</div>' +
          '<div class="prright">' +
            '<div class="prscale" id="prScaleNote">Scale: 100%</div>' +
            '<div class="prsize" id="prSizeNote"></div>' +
            '<div class="prview"><canvas id="prCanvas" aria-label="Preview of the sheet"></canvas><div class="prbusy" id="prBusy" hidden>Preparing…</div></div>' +
            '<div class="prnav">' +
              '<button type="button" class="wdbtn prstep" id="prPrev" aria-label="Previous sheet">‹</button>' +
              '<input type="range" id="prSlider" min="1" max="1" value="1" aria-label="Sheet">' +
              '<button type="button" class="wdbtn prstep" id="prNext" aria-label="Next sheet">›</button>' +
            '</div>' +
            '<div class="prcount" id="prCount"></div>' +
            '<p class="wderr prerr" id="prErr" role="alert" hidden></p>' +
          '</div>' +
        '</div>' +
        '<div class="wdfoot prfoot">' +
          '<span class="prnote" id="prNote"></span>' +
          '<button type="submit" class="wdbtn wdok" id="prGo">Print</button>' +
          '<button type="button" class="wdbtn" id="prCancel">Cancel</button>' +
        '</div>' +
        '<div class="pradvwrap" id="prAdvWrap" hidden>' +
          '<div class="pradv" role="dialog" aria-modal="true" aria-labelledby="prAdvTitle">' +
            '<h3 class="pradvtitle" id="prAdvTitle">Advanced Print Setup</h3>' +
            '<div class="pradvbody">' +
              '<label class="prrow"><span>Two-sided:</span><select class="wdsel prwide" id="prFlip">' +
                '<option value="long">Flip on long edge</option><option value="short">Flip on short edge</option></select></label>' +
              '<label class="prrow"><span>Print resolution:</span><select class="wdsel prwide" id="prDpi">' +
                '<option value="auto">Automatic (by job length)</option><option value="150">150 dpi (draft)</option>' +
                '<option value="300">300 dpi</option><option value="600">600 dpi (fine)</option></select></label>' +
              '<label class="prchk"><input type="checkbox" id="prCollate"> Collate copies</label>' +
              '<div class="pradvsys">' +
                '<button type="button" class="wdbtn" id="prSys">Print using system dialog…</button>' +
                '<p class="wdnote">Prints these sheets through the system\'s own print dialog, with every option the printer\'s driver has.</p>' +
              '</div>' +
            '</div>' +
            '<div class="pradvfoot">' +
              '<button type="button" class="wdbtn wdok" id="prAdvOk">OK</button>' +
              '<button type="button" class="wdbtn" id="prAdvCancel">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</form>';
    document.body.appendChild(wrap);
    const box = wrap.firstChild;
    const q = function (sel) { return box.querySelector(sel); };
    P.PAPERS.forEach(function (p) {
      const op = document.createElement('option');
      op.value = p.id;
      op.textContent = p.name + ' (' + Math.round(p.w / MM) + ' × ' + Math.round(p.h / MM) + ' mm)';
      $('prPaper').appendChild(op);
    });

    let o = kept();
    let pl = null, at = 0, drawSeq = 0, was = null, busy = false;

    function radios(name, v) {
      box.querySelectorAll('input[name="' + name + '"]').forEach(function (r) { r.checked = r.value === String(v); });
    }
    function radio(name) {
      const r = box.querySelector('input[name="' + name + '"]:checked');
      return r ? r.value : null;
    }
    function fill() {
      $('prCopies').value = o.copies;
      $('prGray').checked = !!o.gray;
      $('prDuplex').checked = !!o.duplex;
      $('prPaper').value = o.paper;
      radios('prPick', o.pick);
      $('prRange').value = o.range || ('1 - ' + S.items.length);
      $('prRange').placeholder = '1 - ' + S.items.length;
      $('prSubset').value = o.subset; $('prReverse').checked = !!o.reverse;
      radios('prFit', o.fit); $('prScale').value = o.scale; $('prByPage').checked = !!o.byPage;
      $('prTile').value = o.tile; $('prOverlap').value = o.overlap; $('prLarge').checked = !!o.largeOnly;
      $('prPer').value = String(o.per); $('prOrder').value = o.order; $('prBorder').checked = !!o.border;
      $('prSide').value = o.side; $('prBinding').value = o.binding;
      radios('prOrient', o.orient);
      $('prMarks').value = o.markups ? '1' : '0';
      paintModes();
    }
    function read() {
      o.printer = $('prPrinter').value;
      o.copies = Math.max(1, Math.min(999, parseInt($('prCopies').value, 10) || 1));
      o.gray = $('prGray').checked;
      o.duplex = $('prDuplex').checked;
      o.paper = $('prPaper').value;
      o.pick = radio('prPick') || 'all';
      o.range = $('prRange').value;
      o.subset = $('prSubset').value; o.reverse = $('prReverse').checked;
      o.fit = radio('prFit') || 'fit';
      o.scale = Math.max(1, Math.min(1000, parseFloat($('prScale').value) || 100));
      o.byPage = $('prByPage').checked;
      o.tile = Math.max(1, Math.min(1000, parseFloat($('prTile').value) || 100));
      o.overlap = Math.max(0, Math.min(100, parseFloat($('prOverlap').value) || 0));
      o.largeOnly = $('prLarge').checked;
      o.per = +$('prPer').value; o.order = $('prOrder').value; o.border = $('prBorder').checked;
      o.side = $('prSide').value; o.binding = $('prBinding').value;
      o.orient = radio('prOrient') || 'auto';
      o.markups = $('prMarks').value === '1';
    }
    function paintModes() {
      box.querySelectorAll('.prmode').forEach(function (b) {
        const on = b.dataset.mode === o.mode;
        b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      box.querySelectorAll('.prpane').forEach(function (p) { p.hidden = p.dataset.pane !== o.mode; });
      $('prRange').disabled = o.pick !== 'range';
      $('prScale').disabled = o.fit !== 'custom';
    }

    function sizeNote(w, h) {
      const mm = function (v) { return Math.round(v / MM); };
      const inch = function (v) { return (v / 72).toFixed(2); };
      return inch(w) + ' × ' + inch(h) + ' in  (' + mm(w) + ' × ' + mm(h) + ' mm)';
    }
    function err(msg) { $('prErr').textContent = msg || ''; $('prErr').hidden = !msg; $('prGo').disabled = !!msg; }

    /* the plan anew, and the sheet in view drawn */
    async function replan() {
      read();
      paintModes();
      const seq = ++drawSeq;
      let s;
      try { s = await source(o.markups); } catch (e) { err('The document could not be prepared: ' + String((e && e.message) || e)); return; }
      if (seq !== drawSeq) return;
      pl = planFor(o, s);
      if (pl.error) { err(pl.error); clearCanvas(); $('prCount').textContent = ''; return; }
      err('');
      const n = pl.sheets.length;
      at = Math.min(at, n - 1);
      $('prSlider').max = String(n); $('prSlider').value = String(at + 1);
      $('prScaleNote').textContent = 'Scale: ' + Math.round((pl.scale || 1) * 100) + '%';
      await drawSheet(seq);
    }
    function clearCanvas() {
      const c = $('prCanvas'), g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
    }
    async function drawSheet(seq) {
      if (!pl || pl.error || !src) return;
      seq = seq || ++drawSeq;
      const sh = pl.sheets[at], W = sh.w || pl.w, H = sh.h || pl.h;
      $('prCount').textContent = 'Page ' + (at + 1) + ' of ' + pl.sheets.length;
      $('prSizeNote').textContent = sizeNote(W, H);
      $('prPrev').disabled = at <= 0; $('prNext').disabled = at >= pl.sheets.length - 1;
      const bytes = await compose(src, pl, [at]);
      if (seq !== drawSeq) return;
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      try {
        const page = await pdf.getPage(1);
        if (seq !== drawSeq) return;
        const view = q('.prview');
        const maxW = view.clientWidth - 16, maxH = view.clientHeight - 16;
        const fit = Math.min(maxW / W, maxH / H);
        const dpr = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: fit * dpr });
        const c = $('prCanvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        c.style.width = Math.round(vp.width / dpr) + 'px'; c.style.height = Math.round(vp.height / dpr) + 'px';
        const g = c.getContext('2d');
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
        if (o.gray && desk()) {
          const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            d[i] = d[i + 1] = d[i + 2] = v;
          }
          g.putImageData(img, 0, 0);
        }
      } finally { pdf.destroy(); }
    }

    /* ---------------- printing ---------------- */

    /* each sheet as a picture, for the desktop side to print: sharp enough
       for print, lighter as the job gets longer */
    async function sheetPictures(bytes, n) {
      const dpi = o.dpi !== 'auto' && +o.dpi > 0 ? +o.dpi : n <= 20 ? 300 : n <= 80 ? 200 : 150;
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      const out = [];
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          $('prBusy').textContent = 'Preparing sheet ' + i + ' of ' + pdf.numPages + '…';
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: dpi / 72 });
          const c = document.createElement('canvas');
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const g = c.getContext('2d');
          g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
          const blob = await new Promise(function (res) { c.toBlob(res, 'image/png'); });
          out.push(new Uint8Array(await blob.arrayBuffer()));
          c.width = c.height = 0;
          page.cleanup();
        }
      } finally { pdf.destroy(); }
      return out;
    }

    async function go(viaSystem) {
      if (busy) return;
      read();
      if (!pl || pl.error) return;
      keep(o);
      busy = true; $('prGo').disabled = true; $('prBusy').hidden = false; $('prBusy').textContent = 'Preparing…';
      try {
        const all = pl.sheets.map(function (_, k) { return k; });
        const bytes = await compose(src, pl, all);
        if (desk()) {
          const pics = await sheetPictures(bytes, all.length);
          $('prBusy').textContent = viaSystem ? 'Waiting for the system print dialog…' : 'Sending to the printer…';
          const r = await X.printPages({
            pages: pics, w: pl.w, h: pl.h, paper: o.paper,
            printer: o.printer, copies: o.copies, color: !o.gray,
            duplex: o.duplex ? (o.flip === 'short' ? 'shortEdge' : 'longEdge') : 'simplex',
            collate: o.collate, dialog: viaSystem === true
          });
          if (r && r.cancelled) return;
          close();
          X.toast(viaSystem ? 'Sent to the printer'
            : 'Sent to <b>' + X.esc(o.printer || 'the printer') + '</b>' + (o.copies > 1 ? ', ' + o.copies + ' copies' : ''), true);
        } else {
          close();
          X.printFrame(bytes);                  /* the browser asks for the printer */
        }
      } catch (e) {
        err('Could not print: ' + String((e && e.message) || e).slice(0, 200));
      } finally {
        busy = false; $('prBusy').hidden = true;
        if (!wrap.hidden) $('prGo').disabled = !pl || !!pl.error;
      }
    }

    /* ---------------- open and close ---------------- */

    async function open() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      o = kept();
      if (o.pick === 'range') o.pick = 'all';
      src = null; pl = null; at = 0;
      was = document.activeElement;
      /* printers: the desktop app's own list; a browser picks one itself */
      const sel = $('prPrinter');
      sel.innerHTML = '';
      $('prGrayWrap').hidden = !desk();
      $('prDuplexWrap').hidden = !desk();
      $('prDrv').hidden = !desk();
      $('prProps').hidden = typeof X.printerProperties !== 'function';
      $('prAdvWrap').hidden = true;
      $('prCopies').closest('.prrow').hidden = !desk();
      if (desk()) {
        let list = [];
        try { list = await X.printers(); } catch (e) { list = []; }
        if (!list.length) {
          sel.innerHTML = '<option value="">No printer found</option>';
        } else {
          list.forEach(function (p) {
            const op = document.createElement('option');
            op.value = p.name; op.textContent = p.displayName || p.name;
            sel.appendChild(op);
          });
          const def = list.filter(function (p) { return p.isDefault; })[0];
          sel.value = list.some(function (p) { return p.name === o.printer; }) ? o.printer : (def || list[0]).name;
        }
        $('prNote').textContent = '';
      } else {
        sel.innerHTML = '<option value="">Chosen in the next step</option>';
        $('prNote').textContent = 'Your browser asks which printer to use next.';
      }
      fill();
      wrap.hidden = false;
      $('prGo').focus();
      $('prBusy').hidden = false; $('prBusy').textContent = 'Preparing…';
      try { await replan(); } finally { $('prBusy').hidden = true; }
    }
    function close() {
      wrap.hidden = true;
      $('prAdvWrap').hidden = true;
      src = null; pl = null;
      if (was && was.focus) try { was.focus(); } catch (e) { /* gone */ }
    }
    X.openPrintDialog = open;
    /* pages still arriving (a big file loads a part at a time), or the
       document changed under the dialog: plan again from what it is now */
    X.on('pages', function () {
      if (wrap.hidden || busy) return;
      src = null;
      soon();
    });

    /* ---------------- wiring ---------------- */

    let tick = 0;
    function soon() { clearTimeout(tick); tick = setTimeout(replan, 150); }
    box.addEventListener('change', function (e) {
      if (e.target.closest('#prAdvWrap')) return;
      if (e.target.id === 'prPrinter' || e.target.id === 'prCopies' || e.target.id === 'prDuplex') { read(); return; }
      if (e.target.name === 'prPick' && radio('prPick') === 'range') setTimeout(function () { $('prRange').focus(); $('prRange').select(); });
      soon();
    });
    box.addEventListener('input', function (e) {
      if (e.target.matches('#prRange, #prScale, #prTile, #prOverlap')) soon();
    });
    box.querySelectorAll('.prmode').forEach(function (b) {
      b.addEventListener('click', function () { o.mode = b.dataset.mode; paintModes(); soon(); });
    });
    $('prSlider').addEventListener('input', function () { at = (+this.value || 1) - 1; drawSheet(); });
    $('prPrev').addEventListener('click', function () { if (at > 0) { at--; $('prSlider').value = String(at + 1); drawSheet(); } });
    $('prNext').addEventListener('click', function () {
      if (pl && at < pl.sheets.length - 1) { at++; $('prSlider').value = String(at + 1); drawSheet(); }
    });
    box.addEventListener('submit', function (e) { e.preventDefault(); if ($('prAdvWrap').hidden) go(); });

    /* Properties: the printer's own settings, in its driver's window; the
       list is read again after, in case the printer was renamed */
    $('prProps').addEventListener('click', async function () {
      if (busy || typeof X.printerProperties !== 'function') return;
      read();
      const btn = this;
      btn.disabled = true;
      try {
        await X.printerProperties(o.printer);
      } catch (e) {
        X.toast('Could not open the printer\'s properties: ' + X.esc(String((e && e.message) || e).slice(0, 160)));
      } finally { btn.disabled = false; btn.focus(); }
    });

    /* Advanced: the finer choices, in a panel over the dialog */
    function advOpen() {
      read();
      $('prFlip').value = o.flip; $('prDpi').value = String(o.dpi); $('prCollate').checked = o.collate !== false;
      $('prCollate').disabled = o.copies < 2;
      $('prAdvWrap').hidden = false;
      $('prFlip').focus();
    }
    function advRead() {
      o.flip = $('prFlip').value === 'short' ? 'short' : 'long';
      o.dpi = $('prDpi').value;
      o.collate = $('prCollate').checked;
    }
    function advClose() { $('prAdvWrap').hidden = true; $('prAdv').focus(); }
    $('prAdv').addEventListener('click', advOpen);
    $('prAdvOk').addEventListener('click', function () { advRead(); keep(o); advClose(); });
    $('prAdvCancel').addEventListener('click', advClose);
    $('prSys').addEventListener('click', function () { advRead(); $('prAdvWrap').hidden = true; go(true); });
    $('prCancel').addEventListener('click', close);
    $('prX').addEventListener('click', close);
    wrap.addEventListener('keydown', function (e) {
      e.stopPropagation();                      /* the app's own keys stay out of the dialog */
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!$('prAdvWrap').hidden) advClose(); else if (!busy) close();
      }
    });
  });
})();
