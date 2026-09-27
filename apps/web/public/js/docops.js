/* ADD DOTS PDF — Document operations
   ----------------------------------
   Watermark, header & footer, Bates numbering, redaction, print, document
   properties and compression.

   Two of these need the page pixels rather than the page objects. Redaction
   has to actually remove what it covers — a black rectangle drawn over live
   text is the classic way to leak a document — and compression only bites if
   the vector content is replaced. Both therefore re-render the affected pages
   through pdf.js and put the result back as an image page, which is a real,
   visible change to the document rather than a cosmetic one. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[docops] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, PDFLib = X.PDFLib, pdfjsLib = X.pdfjsLib;

    /* ---------------- ribbon tab ---------------- */

    const tab = document.createElement('button');
    tab.className = 'tab'; tab.id = 'ribDoc'; tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panDoc');
    tab.textContent = 'Document';
    $('ribTabs').appendChild(tab);

    const pan = document.createElement('div');
    pan.className = 'rpan'; pan.id = 'panDoc'; pan.hidden = true;
    pan.setAttribute('role', 'tabpanel'); pan.setAttribute('aria-labelledby', 'ribDoc');
    $('ribbon').appendChild(pan);
    X.addRibbonTab('ribDoc', 'panDoc');

    function grp() {
      if (pan.children.length) {
        const sep = document.createElement('span'); sep.className = 'sep'; pan.appendChild(sep);
      }
      const g = document.createElement('div'); g.className = 'grp';
      pan.appendChild(g); return g;
    }
    function btn(host, id, label, title, path, fn) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = id; b.title = title; b.dataset.label = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = '<svg viewBox="0 0 24 24">' + path + '</svg><span class="lbl">' + label + '</span>';
      b.addEventListener('click', fn); host.appendChild(b); return b;
    }

    const g1 = grp();
    btn(g1, 'btnWatermark', 'Watermark', 'Stamp text or a logo across the pages',
      '<path d="M12 3l7 6v6l-7 6-7-6V9z"/><line x1="7" y1="16" x2="17" y2="8"/>', function () { openPanel('wm'); });
    btn(g1, 'btnHF', 'Header & footer', 'Add running text to the top and bottom of every page',
      '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="21" y2="16"/>',
      function () { openPanel('hf'); });
    btn(g1, 'btnBates', 'Bates', 'Number every page with a prefix and a running index',
      '<path d="M4 4h16v16H4z"/><text x="12" y="16" font-size="10" text-anchor="middle" fill="currentColor" stroke="none">01</text>',
      function () { openPanel('bates'); });

    const g2 = grp();
    btn(g2, 'btnRedact', 'Redact', 'Black out and permanently remove content (Shift+X)',
      '<rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor" stroke="none"/>',
      function () { X.toggleTool('redact'); });
    btn(g2, 'btnRedactApply', 'Apply', 'Burn in the redactions — each marked page is rebuilt as a flat image, so the covered content is removed for good',
      '<path d="M20 6L9 17l-5-5"/>', applyRedactions);

    const g3 = grp();
    btn(g3, 'btnPrint', 'Print', 'Print this document (Ctrl+P)',
      '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M6 16h12v5H6z"/>', doPrint);
    btn(g3, 'btnExportText', 'Text', 'Save every page of text as a .txt file',
      '<path d="M14 3v5h5"/><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z"/>' +
      '<line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>', exportText);
    btn(g3, 'btnCompress', 'Compress', 'Make the file smaller by re-encoding the pages',
      '<path d="M4 9l8-6 8 6"/><path d="M4 15l8 6 8-6"/><line x1="4" y1="12" x2="20" y2="12"/>',
      function () { openPanel('zip'); });

    const g4 = grp();
    btn(g4, 'btnProps', 'Properties', 'Title, author and the rest of the document details',
      '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="1"/>',
      function () { openPanel('props'); });

    /* ---------------- one panel, several jobs ---------------- */

    const dlg = document.createElement('div');
    dlg.className = 'docmodal'; dlg.id = 'docModal'; dlg.hidden = true;
    dlg.innerHTML = '<div class="docbox" role="dialog" aria-modal="true">' +
      '<header><b id="docTitle"></b><span class="grow"></span>' +
      '<button class="x" id="docClose" aria-label="Close">&times;</button></header>' +
      '<div class="docbody" id="docBody"></div>' +
      '<footer><span class="docnote" id="docNote"></span><span class="grow"></span>' +
      '<button class="btn" id="docCancel">Cancel</button>' +
      '<button class="btn primary" id="docGo">Apply</button></footer></div>';
    document.body.appendChild(dlg);

    $('docClose').addEventListener('click', close);
    $('docCancel').addEventListener('click', close);
    dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(); });
    function close() { dlg.hidden = true; openKind = null; }

    let openKind = null;
    function openPanel(kind) {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      /* pressing the same button again puts the panel away */
      if (!dlg.hidden && openKind === kind) { close(); return; }
      openKind = kind;
      dlg.hidden = false;
      $('docNote').textContent = '';
      $('docGo').disabled = false;
      $('docGo').textContent = 'Apply';
      $('docBody').oninput = null;          /* a panel's live preview is its own, never the last one's */
      PANELS[kind]();
    }

    function rangeRow(id) {
      return '<label class="drow"><span>Pages</span>' +
        '<input id="' + id + '" placeholder="all, or 1-3, 7" value="all"></label>';
    }
    function pagesFrom(id) {
      const v = String($(id).value || 'all').trim().toLowerCase();
      if (!v || v === 'all') return S.items.map(function (_, i) { return i; });
      const groups = X.organize.parseRanges(v, S.items.length);
      const set = {};
      groups.forEach(function (g) { g.forEach(function (i) { set[i] = 1; }); });
      return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    }

    const PANELS = {};

    /* --- watermark --- */
    PANELS.wm = function () {
      $('docTitle').textContent = 'Watermark';
      $('docBody').innerHTML =
        '<label class="drow"><span>Text</span><input id="wmText" value="DRAFT"></label>' +
        '<label class="drow"><span>Size</span><input id="wmSize" value="64" inputmode="numeric"></label>' +
        '<label class="drow"><span>Angle</span><input id="wmAngle" value="45" inputmode="numeric"></label>' +
        '<label class="drow"><span>Opacity</span><input id="wmOp" type="range" min="5" max="100" value="18">' +
        '<output id="wmOpV">18%</output></label>' +
        '<label class="drow"><span>Colour</span><input id="wmColor" type="color" value="#D23C2E"></label>' +
        '<label class="drow"><span>Tile</span><input id="wmTile" type="checkbox">' +
        '<span class="dhint">repeat across the whole page</span></label>' +
        rangeRow('wmPages');
      $('wmOp').addEventListener('input', function () { $('wmOpV').textContent = this.value + '%'; });
      $('docGo').onclick = applyWatermark;
    };

    function applyWatermark() {
      const text = $('wmText').value.trim();
      if (!text) { note('Type something to stamp across the page'); return; }
      const size = clamp(parseFloat($('wmSize').value) || 64, 6, 400);
      const angle = parseFloat($('wmAngle').value) || 0;
      const op = clamp((parseFloat($('wmOp').value) || 18) / 100, 0.02, 1);
      const col = $('wmColor').value;
      const tile = $('wmTile').checked;
      const pages = pagesFrom('wmPages');
      if (!pages.length) { note('That page range is empty'); return; }
      X.snapshot();
      pages.forEach(function (i) {
        const it = S.items[i];
        /* strip a previous watermark so re-applying does not stack them up */
        it.shapes = it.shapes.filter(function (s) { return s.t !== 'wm'; });
        it.shapes.push({ t: 'wm', text: text, size: size, r: angle, o: op, c: col, tile: tile });
        X.drawShapes(it); X.drawThumb(it);
      });
      X.updateMeta(); close();
      X.toast('Watermark added to <b>' + pages.length + '</b> page' + (pages.length === 1 ? '' : 's'));
    }

    /* --- header & footer --- */
    PANELS.hf = function () {
      $('docTitle').textContent = 'Header & footer';
      $('docBody').innerHTML =
        '<p class="dhint block">Use <b>{page}</b>, <b>{pages}</b>, <b>{date}</b> and <b>{file}</b> ' +
        'and they are filled in per page.</p>' +
        '<div class="dgrid3"><span class="dlab">Header</span>' +
        '<input id="hfHL" placeholder="left"><input id="hfHC" placeholder="centre"><input id="hfHR" placeholder="right"></div>' +
        '<div class="dgrid3"><span class="dlab">Footer</span>' +
        '<input id="hfFL" placeholder="left"><input id="hfFC" placeholder="Page {page} of {pages}"><input id="hfFR" placeholder="right"></div>' +
        '<label class="drow"><span>Size</span><input id="hfSize" value="9" inputmode="numeric"></label>' +
        '<label class="drow"><span>Margin</span><input id="hfMargin" value="28" inputmode="numeric"></label>' +
        '<label class="drow"><span>Colour</span><input id="hfColor" type="color" value="#444444"></label>' +
        rangeRow('hfPages');
      $('docGo').onclick = applyHF;
    };

    function applyHF() {
      const cfg = {
        hl: $('hfHL').value, hc: $('hfHC').value, hr: $('hfHR').value,
        fl: $('hfFL').value, fc: $('hfFC').value, fr: $('hfFR').value
      };
      if (!Object.keys(cfg).some(function (k) { return cfg[k].trim(); })) {
        note('Fill at least one of the six boxes'); return;
      }
      const size = clamp(parseFloat($('hfSize').value) || 9, 4, 48);
      const margin = clamp(parseFloat($('hfMargin').value) || 28, 4, 200);
      const col = $('hfColor').value;
      const pages = pagesFrom('hfPages');
      X.snapshot();
      pages.forEach(function (i) {
        const it = S.items[i];
        it.shapes = it.shapes.filter(function (s) { return s.t !== 'hf'; });
        it.shapes.push({ t: 'hf', cfg: cfg, size: size, margin: margin, c: col, page: i + 1 });
        X.drawShapes(it); X.drawThumb(it);
      });
      X.updateMeta(); close();
      X.toast('Header and footer added to <b>' + pages.length + '</b> page' + (pages.length === 1 ? '' : 's'));
    }

    /* --- Bates --- */
    PANELS.bates = function () {
      $('docTitle').textContent = 'Bates numbering';
      $('docBody').innerHTML =
        '<label class="drow"><span>Prefix</span><input id="btPrefix" placeholder="ADD-"></label>' +
        '<label class="drow"><span>Suffix</span><input id="btSuffix" placeholder=""></label>' +
        '<label class="drow"><span>Start at</span><input id="btStart" value="1" inputmode="numeric"></label>' +
        '<label class="drow"><span>Digits</span><input id="btDigits" value="6" inputmode="numeric"></label>' +
        '<label class="drow"><span>Position</span><select id="btPos">' +
        '<option value="br">Bottom right</option><option value="bl">Bottom left</option>' +
        '<option value="bc">Bottom centre</option><option value="tr">Top right</option>' +
        '<option value="tl">Top left</option></select></label>' +
        '<label class="drow"><span>Size</span><input id="btSize" value="9" inputmode="numeric"></label>' +
        '<p class="dhint block" id="btPrev"></p>' +
        rangeRow('btPages');
      const prev = function () {
        const n = parseInt($('btStart').value, 10) || 1;
        const d = clamp(parseInt($('btDigits').value, 10) || 6, 1, 12);
        $('btPrev').innerHTML = 'First page reads <b>' +
          X.esc($('btPrefix').value + String(n).padStart(d, '0') + $('btSuffix').value) + '</b>';
      };
      $('docBody').oninput = prev;
      prev();
      $('docGo').onclick = applyBates;
    };

    function applyBates() {
      const prefix = $('btPrefix').value, suffix = $('btSuffix').value;
      const start = parseInt($('btStart').value, 10) || 1;
      const digits = clamp(parseInt($('btDigits').value, 10) || 6, 1, 12);
      const pos = $('btPos').value;
      const size = clamp(parseFloat($('btSize').value) || 9, 4, 36);
      const pages = pagesFrom('btPages');
      X.snapshot();
      pages.forEach(function (i, k) {
        const it = S.items[i];
        it.shapes = it.shapes.filter(function (s) { return s.t !== 'bates'; });
        it.shapes.push({
          t: 'bates', size: size, pos: pos, c: '#222222',
          label: prefix + String(start + k).padStart(digits, '0') + suffix
        });
        X.drawShapes(it); X.drawThumb(it);
      });
      X.updateMeta(); close();
      X.toast('Bates numbers added to <b>' + pages.length + '</b> page' + (pages.length === 1 ? '' : 's'));
    }

    /* --- compress --- */
    PANELS.zip = function () {
      $('docTitle').textContent = 'Compress';
      $('docBody').innerHTML =
        '<p class="dhint block">Every page is re-rendered as an image at the quality you pick. ' +
        'That is what actually shrinks a scan-heavy file — but the text stops being selectable ' +
        'and stops being searchable, so keep the original.</p>' +
        '<label class="drow"><span>Detail</span><select id="zpDpi">' +
        '<option value="72">Screen · 72 dpi</option>' +
        '<option value="110" selected>Email · 110 dpi</option>' +
        '<option value="150">Print · 150 dpi</option>' +
        '<option value="200">Fine · 200 dpi</option></select></label>' +
        '<label class="drow"><span>Quality</span><input id="zpQ" type="range" min="30" max="95" value="68">' +
        '<output id="zpQV">68%</output></label>';
      $('zpQ').addEventListener('input', function () { $('zpQV').textContent = this.value + '%'; });
      $('docGo').textContent = 'Compress & save';
      $('docGo').onclick = runCompress;
    };

    async function runCompress() {
      const dpi = parseInt($('zpDpi').value, 10);
      const q = (parseInt($('zpQ').value, 10) || 68) / 100;
      const go = $('docGo');
      go.disabled = true;
      try {
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < S.items.length; i++) {
          go.textContent = 'Page ' + (i + 1) + '/' + S.items.length + '…';
          const shot = await rasterise(S.items[i], dpi, 'image/jpeg', q);
          const img = await out.embedJpg(shot.bytes);
          const page = out.addPage([shot.ptW, shot.ptH]);
          page.drawImage(img, { x: 0, y: 0, width: shot.ptW, height: shot.ptH });
        }
        const bytes = await out.save();
        X.download(bytes, S.baseName + ' — compressed.pdf');
        close();
        X.toast('Saved at <b>' + fmtBytes(bytes.length) + '</b>');
      } catch (e) {
        note('Could not compress this file — ' + (e && e.message ? e.message : 'unknown error'));
      } finally {
        go.disabled = false; go.textContent = 'Compress & save';
      }
    }

    /* --- properties --- */
    PANELS.props = async function () {
      $('docTitle').textContent = 'Document properties';
      $('docBody').innerHTML = '<p class="dhint block">Reading…</p>';
      $('docGo').textContent = 'Save changes';
      const src = S.sources[0];
      let info = {};
      try { info = (await src.doc.getMetadata()).info || {}; } catch (e) {}
      const it = S.items[S.current - 1];
      await X.ensurePage(it);
      await X.ensureAllPages();         /* the page sizes below count every page */
      const v = it.page.view;
      const sizes = {};
      S.items.forEach(function (x) {
        if (!x.page) return;
        const vv = x.page.view;
        const key = Math.round(vv[2] - vv[0]) + '×' + Math.round(vv[3] - vv[1]);
        sizes[key] = (sizes[key] || 0) + 1;
      });
      $('docBody').innerHTML =
        '<label class="drow"><span>Title</span><input id="pmTitle"></label>' +
        '<label class="drow"><span>Author</span><input id="pmAuthor"></label>' +
        '<label class="drow"><span>Subject</span><input id="pmSubject"></label>' +
        '<label class="drow"><span>Keywords</span><input id="pmKeywords"></label>' +
        '<div class="dfacts">' +
        fact('File', S.sources.map(function (s) { return s.name; }).join(', ')) +
        fact('Pages', String(S.items.length)) +
        fact('Current page', Math.round(v[2] - v[0]) + ' × ' + Math.round(v[3] - v[1]) + ' pt · ' +
          mm(v[2] - v[0]) + ' × ' + mm(v[3] - v[1]) + ' mm') +
        fact('Page sizes', Object.keys(sizes).map(function (k) { return k + ' pt ×' + sizes[k]; }).join(', ')) +
        fact('PDF version', info.PDFFormatVersion || '—') +
        fact('Producer', info.Producer || '—') +
        fact('Creator', info.Creator || '—') +
        fact('Created', info.CreationDate ? String(info.CreationDate) : '—') +
        fact('Encrypted', info.IsEncrypted ? 'Yes' : 'No') +
        fact('Linearised', info.IsLinearized ? 'Yes' : 'No') +
        '</div>';
      $('pmTitle').value = info.Title || '';
      $('pmAuthor').value = info.Author || '';
      $('pmSubject').value = info.Subject || '';
      $('pmKeywords').value = info.Keywords || '';
      $('docGo').onclick = saveProps;
    };
    function fact(k, v) {
      return '<div class="dfact"><span>' + X.esc(k) + '</span><b>' + X.esc(v || '—') + '</b></div>';
    }
    function mm(pt) { return Math.round(pt * 25.4 / 72); }

    function saveProps() {
      meta.title = $('pmTitle').value;
      meta.author = $('pmAuthor').value;
      meta.subject = $('pmSubject').value;
      meta.keywords = $('pmKeywords').value;
      close();
      X.toast('Details saved — they go into the file when you next <b>Save</b>');
    }

    const meta = { title: '', author: '', subject: '', keywords: '' };
    X.finish.push(async function (out) {
      try {
        if (meta.title) out.setTitle(meta.title);
        if (meta.author) out.setAuthor(meta.author);
        if (meta.subject) out.setSubject(meta.subject);
        if (meta.keywords) out.setKeywords(meta.keywords.split(/\s*[,;]\s*/).filter(Boolean));
        out.setProducer('ADD DOTS PDF Editor');
        out.setModificationDate(new Date());
      } catch (e) {}
    });

    function note(msg) { $('docNote').innerHTML = '<span class="bad">' + X.esc(msg) + '</span>'; }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function fmtBytes(n) {
      return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
    }

    /* ---------------- redaction ---------------- */

    let redDrag = null;
    X.hints.redact = 'Drag over anything that must not survive, then choose <b>Apply</b>. ' +
      'Each redacted page is rebuilt as a flat image, so the covered content is gone for good — ' +
      'and the text on that page stops being selectable. Keep your original.';
    X.toolBtn.redact = 'btnRedact';

    X.tools.redact = {
      down: function (it, at) {
        if (!it.vp) return;
        redDrag = { it: it, a: it.vp.convertToPdfPoint(at[0], at[1]) };
      },
      move: function (it, at) {
        if (!redDrag || redDrag.it !== it) return;
        X.drawShapes(it, { t: 'redact', a: redDrag.a, b: it.vp.convertToPdfPoint(at[0], at[1]) });
      },
      cancel: function (it) {
        if (!redDrag) return;
        redDrag = null;
        X.drawShapes(it);
      },
      up: function (it, at) {
        if (!redDrag || redDrag.it !== it) return;
        const a = redDrag.a, b = it.vp.convertToPdfPoint(at[0], at[1]);
        redDrag = null;
        if (Math.abs(b[0] - a[0]) < 3 || Math.abs(b[1] - a[1]) < 3) { X.drawShapes(it); return; }
        X.snapshot();
        it.shapes.push({ t: 'redact', a: a, b: b });
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
        syncRedact();
      }
    };

    X.shapeRenderers.redact = function (it, s, vp, idx) {
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      const g = document.createElementNS(X.SVGNS, 'g');
      const r = document.createElementNS(X.SVGNS, 'rect');
      r.setAttribute('x', Math.min(a[0], b[0])); r.setAttribute('y', Math.min(a[1], b[1]));
      r.setAttribute('width', Math.abs(b[0] - a[0])); r.setAttribute('height', Math.abs(b[1] - a[1]));
      r.setAttribute('class', 'redact-mk');
      g.appendChild(r);
      if (idx >= 0) {
        r.style.pointerEvents = 'all';
        r.addEventListener('pointerdown', function (e) {
          if (S.tool === 'select') {
            e.stopPropagation();
            S.sel = { it: it, i: idx };
            S.items.forEach(function (x) { X.drawShapes(x); });
          }
        });
      }
      return g;
    };

    /* Until they are applied, redactions still save as solid black boxes, so a
       file saved halfway through is covered — just not yet scrubbed. */
    /* (the redact painter is in the engine, with the other document marks) */
    function redactCount() {
      return S.items.reduce(function (n, it) {
        return n + it.shapes.filter(function (s) { return s.t === 'redact'; }).length;
      }, 0);
    }
    function syncRedact() {
      const n = redactCount();
      $('btnRedactApply').disabled = !n;
      $('btnRedactApply').dataset.label = n ? 'Apply (' + n + ')' : 'Apply';
    }

    /* Re-render each affected page with the black boxes painted on, then swap
       the page for that image. The words underneath are not covered — they are
       no longer in the file at all. */
    async function applyRedactions() {
      const marked = S.items.filter(function (it) {
        return it.shapes.some(function (s) { return s.t === 'redact'; });
      });
      if (!marked.length) { X.toast('Draw a redaction box first'); return; }
      const b = $('btnRedactApply');
      b.disabled = true;
      const label = b.querySelector('.lbl');
      const was = label ? label.textContent : '';
      try {
        X.snapshot();
        for (let k = 0; k < marked.length; k++) {
          if (label) label.textContent = (k + 1) + '/' + marked.length;
          const it = marked[k];
          const shot = await rasterise(it, 200, 'image/png', 1, true);
          const doc = await PDFLib.PDFDocument.create();
          const img = await doc.embedPng(shot.bytes);
          const page = doc.addPage([shot.ptW, shot.ptH]);
          page.drawImage(img, { x: 0, y: 0, width: shot.ptW, height: shot.ptH });
          const bytes = await doc.save();
          const src = await X.addSource('Redacted page', bytes, true);

          const i = S.items.indexOf(it);
          const fresh = X.newItem(src, 1, 0, false);
          /* keep every other mark, drop the redaction boxes now baked in */
          fresh.shapes = it.shapes
            .filter(function (s) { return s.t !== 'redact'; })
            .map(function (s) { return JSON.parse(JSON.stringify(s)); });
          if (it.task) { try { it.task.cancel(); } catch (e) {} }
          S.items[i] = fresh;
        }
        X.invalidateSearch();
        await X.syncAll();
        X.setTool('select');
        X.toast('<b>' + marked.length + '</b> page' + (marked.length === 1 ? '' : 's') +
          ' redacted — the covered content is gone and ' +
          (marked.length === 1 ? 'that page is' : 'those pages are') + ' now flat images');
      } catch (e) {
        X.toast('Redaction failed — ' + (e && e.message ? e.message : 'unknown error'));
      } finally {
        if (label) label.textContent = was || 'Apply';
        syncRedact();
      }
    }

    /* ---------------- rasterising a page ---------------- */

    /* Render one item through pdf.js at the given dpi, optionally painting its
       redaction boxes in solid black, and hand back encoded bytes. */
    async function rasterise(it, dpi, mime, quality, withRedactions) {
      await X.ensurePage(it);
      const scale = dpi / 72;
      const vp = it.page.getViewport({ scale: scale, rotation: it.page.rotate + it.rot });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vp.width));
      cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, cv.width, cv.height);
      /* 'print' intent, because this render produces file bytes rather than
         screen pixels. pdf.js then steps the render off a promise instead of
         requestAnimationFrame, so redacting and compressing still finish when
         the tab is in the background or the window is minimised. */
      await it.page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;

      if (withRedactions) {
        ctx.fillStyle = '#000000';
        it.shapes.forEach(function (s) {
          if (s.t !== 'redact') return;
          const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
          const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
          ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]),
                       Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        });
      }

      const blob = await new Promise(function (res) { cv.toBlob(res, mime, quality); });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { bytes: bytes, ptW: vp.width / scale, ptH: vp.height / scale };
    }

    /* ---------------- painters for the running marks ---------------- */

    Object.assign(X.fontNeeds, window.ADDPDFEngine.docopsFontNeeds);
    const docEnv = {
      totalPages: function () { return S.items.length; },
      fileName: function () { return S.baseName; },
      today: function () { return new Date().toLocaleDateString(); }
    };
    Object.assign(X.shapePainters, window.ADDPDFEngine.docopsPainters(docEnv));
    /* the file name or date may need the Unicode font; it is embedded up front */
    X.prepare.push(window.ADDPDFEngine.docopsPrepare(docEnv));

    /* ---------------- the same marks, on screen ---------------- */

    X.shapeRenderers.wm = function (it, s, vp) {
      const g = document.createElementNS(X.SVGNS, 'g');
      g.setAttribute('class', 'wm-mk');
      const v = it.page ? it.page.view : [0, 0, 595, 842];
      const W = v[2] - v[0], H = v[3] - v[1];
      const put = function (cxp, cyp) {
        const c = vp.convertToViewportPoint(cxp, cyp);
        const t = document.createElementNS(X.SVGNS, 'text');
        t.setAttribute('x', c[0]); t.setAttribute('y', c[1]);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('transform', 'rotate(' + (-(s.r || 0)) + ' ' + c[0] + ' ' + c[1] + ')');
        t.textContent = s.text;
        t.style.fill = s.c; t.style.fillOpacity = s.o;
        t.style.fontFamily = 'Helvetica, Arial, sans-serif';
        t.style.fontWeight = '700';
        t.style.fontSize = (s.size * S.scale) + 'px';
        g.appendChild(t);
      };
      if (s.tile) {
        const stepX = Math.max(90, s.text.length * s.size * 0.62 * 1.35);
        const stepY = Math.max(70, s.size * 3.4);
        for (let y = stepY / 2; y < H + stepY; y += stepY) {
          for (let x = stepX / 2; x < W + stepX; x += stepX) put(v[0] + x, v[1] + y);
        }
      } else {
        put(v[0] + W / 2, v[1] + H / 2);
      }
      return g;
    };

    X.shapeRenderers.hf = function (it, s, vp) {
      const g = document.createElementNS(X.SVGNS, 'g');
      const v = it.page ? it.page.view : [0, 0, 595, 842];
      const W = v[2] - v[0], H = v[3] - v[1];
      const total = S.items.length, idx = S.items.indexOf(it);
      const fill = function (t) {
        return String(t || '')
          .replace(/\{page\}/g, String(idx + 1))
          .replace(/\{pages\}/g, String(total))
          .replace(/\{date\}/g, new Date().toLocaleDateString())
          .replace(/\{file\}/g, S.baseName);
      };
      const put = function (raw, align, y) {
        const t = fill(raw);
        if (!t.trim()) return;
        const x = align === 'l' ? v[0] + s.margin : align === 'r' ? v[0] + W - s.margin : v[0] + W / 2;
        const c = vp.convertToViewportPoint(x, y);
        const el = document.createElementNS(X.SVGNS, 'text');
        el.setAttribute('x', c[0]); el.setAttribute('y', c[1]);
        el.setAttribute('text-anchor', align === 'l' ? 'start' : align === 'r' ? 'end' : 'middle');
        el.textContent = t;
        el.style.fill = s.c;
        el.style.fontFamily = 'Helvetica, Arial, sans-serif';
        el.style.fontSize = (s.size * S.scale) + 'px';
        g.appendChild(el);
      };
      const top = v[1] + H - s.margin, bot = v[1] + s.margin - s.size;
      put(s.cfg.hl, 'l', top); put(s.cfg.hc, 'c', top); put(s.cfg.hr, 'r', top);
      put(s.cfg.fl, 'l', bot); put(s.cfg.fc, 'c', bot); put(s.cfg.fr, 'r', bot);
      return g;
    };

    X.shapeRenderers.bates = function (it, s, vp) {
      const g = document.createElementNS(X.SVGNS, 'g');
      const v = it.page ? it.page.view : [0, 0, 595, 842];
      const W = v[2] - v[0], H = v[3] - v[1], m = 26;
      const x = /r$/.test(s.pos) ? v[0] + W - m : /l$/.test(s.pos) ? v[0] + m : v[0] + W / 2;
      const y = s.pos.charAt(0) === 't' ? v[1] + H - m : v[1] + m - s.size;
      const c = vp.convertToViewportPoint(x, y);
      const el = document.createElementNS(X.SVGNS, 'text');
      el.setAttribute('x', c[0]); el.setAttribute('y', c[1]);
      el.setAttribute('text-anchor', /r$/.test(s.pos) ? 'end' : /l$/.test(s.pos) ? 'start' : 'middle');
      el.textContent = s.label;
      el.style.fill = s.c;
      el.style.fontFamily = 'Helvetica, Arial, sans-serif';
      el.style.fontSize = (s.size * S.scale) + 'px';
      g.appendChild(el);
      return g;
    };

    /* ---------------- print ---------------- */

    async function doPrint() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      X.toast('Preparing the document for printing…');
      try {
        const bytes = await X.buildPdf(S.items, null, {});
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        frame.src = url;
        /* the frame has to outlive its print dialog, so the last one is
           cleared when the next print starts rather than piling up */
        if (doPrint.frame && doPrint.frame.parentNode) doPrint.frame.parentNode.removeChild(doPrint.frame);
        doPrint.frame = frame;
        frame.onload = function () {
          try { frame.contentWindow.focus(); frame.contentWindow.print(); }
          catch (e) { window.open(url, '_blank'); }
          /* leave it alive: removing the frame cancels the print dialog */
          setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
        };
        document.body.appendChild(frame);
      } catch (e) {
        X.toast('Could not prepare this file for printing');
      }
    }

    /* ---------------- export text ---------------- */

    async function exportText() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      const b = $('btnExportText');
      b.disabled = true;
      try {
        const out = [];
        for (let i = 0; i < S.items.length; i++) {
          const it = S.items[i];
          await X.ensurePage(it);
          let tc;
          try { tc = await it.page.getTextContent(); } catch (e) { tc = { items: [] }; }
          out.push('── Page ' + (i + 1) + ' ──');
          /* group by baseline so the .txt keeps the document's line breaks */
          const lines = [];
          let last = null;
          tc.items.forEach(function (item) {
            const y = Math.round(item.transform[5]);
            if (last === null || Math.abs(y - last) > 2) { lines.push([]); last = y; }
            lines[lines.length - 1].push(item.str);
          });
          out.push(lines.map(function (l) { return l.join('').trimEnd(); })
            .filter(function (l) { return l.trim(); }).join('\n'));
          out.push('');
        }
        const blob = new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = S.baseName + '.txt';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        X.toast('Text saved');
      } finally { b.disabled = false; }
    }

    /* ---------------- wiring ---------------- */

    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (!dlg.hidden && e.key === 'Escape') { close(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && S.items.length) {
        e.preventDefault(); doPrint(); return;
      }
      /* Shift+X, not R: core already rotates the page on r, and both
         handlers were firing — the page turned every time you reached for
         the redaction tool. */
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
          && e.key.toLowerCase() === 'x' && S.items.length) {
        e.preventDefault(); X.toggleTool('redact');
      }
    });

    X.on('pages', syncRedact);
    X.on('reset', function () {
      meta.title = meta.author = meta.subject = meta.keywords = '';
      close();
    });
    syncRedact();

    X.docops = {
      rasterise: rasterise, print: doPrint, exportText: exportText,
      applyRedactions: applyRedactions, meta: meta
    };
  });
})();
