/* ADD DOTS PDF — Convert
   ---------------------
   The Convert tab: the open PDF out to Word, Excel, PowerPoint, pictures and
   plain text, all on this device.

   Every converter starts from the document as it is now — edits, marks and
   page order included — by rebuilding it with core's buildPdf and reading that
   back with pdf.js. Text comes from pdf.js's text layer, laid out into lines,
   paragraphs and columns by position; pages come from pdf.js's renderer.

   The Office files are written by hand: each is a zip of a few XML parts, and
   core already has a store-only zip writer. No library, nothing uploaded. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[convert] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pdfjs = X.pdfjsLib;
    const enc = new TextEncoder();

    /* ---------------- ribbon tab, after Document ---------------- */

    const tab = document.createElement('button');
    tab.className = 'tab'; tab.id = 'ribConvert'; tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panConvert');
    tab.textContent = 'Convert';
    const docTab = $('ribDoc');
    if (docTab) docTab.insertAdjacentElement('afterend', tab); else $('ribTabs').appendChild(tab);

    const pan = document.createElement('div');
    pan.className = 'rpan'; pan.id = 'panConvert'; pan.hidden = true;
    pan.setAttribute('role', 'tabpanel'); pan.setAttribute('aria-labelledby', 'ribConvert');
    const docPan = $('panDoc');
    if (docPan) docPan.insertAdjacentElement('afterend', pan); else $('ribbon').appendChild(pan);
    X.addRibbonTab('ribConvert', 'panConvert');

    const grp = document.createElement('div');
    grp.className = 'grp'; grp.id = 'grpConvert';
    grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', 'Convert');
    pan.appendChild(grp);

    /* a sheet of paper with a coloured badge naming the format */
    function fileIcon(badge, color) {
      return '<svg viewBox="0 0 24 24"><path d="M14 3v5h5"/>' +
        '<path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z"/>' +
        '<rect x="2.5" y="11" width="13" height="8" rx="1.6" fill="' + color + '" stroke="none"/>' +
        '<text x="9" y="17.1" font-size="5.6" font-weight="700" text-anchor="middle" ' +
        'fill="#fff" stroke="none" font-family="Arial,sans-serif">' + badge + '</text></svg>';
    }
    const TOOLS = [
      { id: 'btnToWord', kind: 'word', label: 'Word', badge: 'DOC', color: '#2B579A',
        title: 'PDF to Word — save as an editable .docx' },
      { id: 'btnToExcel', kind: 'excel', label: 'Excel', badge: 'XLS', color: '#217346',
        title: 'PDF to Excel — tables and text into a .xlsx workbook' },
      { id: 'btnToPpt', kind: 'ppt', label: 'PowerPoint', badge: 'PPT', color: '#C43E1C',
        title: 'PDF to PowerPoint — one slide per page, as a .pptx' },
      { id: 'btnToImg', kind: 'img', label: 'Picture', badge: 'IMG', color: '#7B4FC9',
        title: 'PDF to Picture — every page as a JPG or PNG' },
      { id: 'btnToTxt', kind: 'txt', label: 'Text', badge: 'TXT', color: '#5F6B7A',
        title: 'PDF to TXT — the text of every page as a .txt file' },
      { id: 'btnToCad', kind: 'cad', label: 'CAD (DXF)', badge: 'DXF', color: '#C62828',
        title: 'PDF to CAD — an AutoCAD DXF drawing with real lines and text (Save As DWG from AutoCAD)' }
    ];
    TOOLS.forEach(function (T) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = T.id; b.type = 'button';
      b.title = T.title; b.dataset.label = 'To ' + T.label;
      b.setAttribute('aria-label', T.title);
      b.innerHTML = fileIcon(T.badge, T.color) + '<span class="lbl">' + T.label + '</span>';
      b.addEventListener('click', function () { openPanel(T.kind); });
      grp.appendChild(b);
    });

    /* ---------------- the dialog ---------------- */

    const dlg = document.createElement('div');
    dlg.className = 'docmodal'; dlg.id = 'cvModal'; dlg.hidden = true;
    dlg.innerHTML = '<div class="docbox" role="dialog" aria-modal="true" aria-labelledby="cvTitle">' +
      '<header><b id="cvTitle"></b><span class="grow"></span>' +
      '<button class="x" id="cvClose" aria-label="Close">&times;</button></header>' +
      '<div class="docbody" id="cvBody"></div>' +
      '<div class="cvprog" id="cvProg" hidden><i id="cvBar"></i></div>' +
      '<footer><span class="docnote" id="cvNote"></span><span class="grow"></span>' +
      '<button class="btn" id="cvCancel">Cancel</button>' +
      '<button class="btn primary" id="cvGo">Convert</button></footer></div>';
    document.body.appendChild(dlg);

    let openKind = null, busy = false, stop = false;

    function close() {
      if (busy) { stop = true; return; }          /* finish the page in hand, then give up */
      dlg.hidden = true; openKind = null;
    }
    $('cvClose').addEventListener('click', close);
    $('cvCancel').addEventListener('click', close);
    dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(); });
    document.addEventListener('keydown', function (e) {
      if (!dlg.hidden && e.key === 'Escape') { e.preventDefault(); close(); }
    });
    $('cvGo').addEventListener('click', function () { if (!busy && openKind) run(openKind); });

    function row(label, control) {
      return '<label class="drow"><span>' + label + '</span>' + control + '</label>';
    }
    function select(id, opts) {
      return '<select id="' + id + '">' + opts.map(function (o) {
        return '<option value="' + o[0] + '">' + o[1] + '</option>';
      }).join('') + '</select>';
    }
    const pagesRow = row('Pages', '<input id="cvPages" value="all" placeholder="all, or 1-3, 7">');

    const PANELS = {
      word: {
        title: 'PDF to Word',
        body: function () {
          return row('Layout', select('cvMode', [
              ['text', 'Editable text — paragraphs you can retype'],
              ['image', 'Exact look — each page as a picture']])) +
            pagesRow +
            '<p class="dhint block">Editable text keeps the words, sizes and headings in ' +
            'reading order. Pages with no text in them (scans) are placed as pictures, ' +
            'so nothing is left out.</p>';
        }
      },
      excel: {
        title: 'PDF to Excel',
        body: function () {
          return row('Sheets', select('cvSheets', [
              ['page', 'One sheet per page'],
              ['one', 'Everything on one sheet']])) +
            pagesRow +
            '<p class="dhint block">Text is split into cells where the page leaves a ' +
            'column gap, and lined up into columns by position. Numbers come across as ' +
            'numbers, so they add up.</p>';
        }
      },
      ppt: {
        title: 'PDF to PowerPoint',
        body: function () {
          return row('Slides', select('cvMode', [
              ['image', 'Exact look — each page as a picture'],
              ['text', 'Editable — text boxes over the page artwork']])) +
            row('Quality', select('cvDpi', [['150', 'Standard (150 dpi)'], ['220', 'High (220 dpi)'],
              ['96', 'Small file (96 dpi)']])) +
            pagesRow +
            '<p class="dhint block">Slides take the size of the page. In editable mode the ' +
            'text is lifted off the artwork into text boxes you can change.</p>';
        }
      },
      img: {
        title: 'PDF to Picture',
        body: function () {
          return row('Format', select('cvFmt', [['jpg', 'JPG — smaller files'],
              ['png', 'PNG — sharp lines, no artefacts']])) +
            row('Resolution', select('cvDpi', [['150', '150 dpi — screen'], ['300', '300 dpi — print'],
              ['96', '96 dpi — small'], ['600', '600 dpi — fine detail']])) +
            pagesRow +
            '<p class="dhint block">One page saves as a single picture; several come in one ' +
            '.zip, named by page number.</p>';
        }
      },
      cad: {
        title: 'PDF to CAD (DWG / DXF)',
        body: function () {
          return row('Units', select('cvUnit', [['mm', 'Millimetres'], ['in', 'Inches'], ['pt', 'PDF points (1/72 in)']])) +
            row('Drawing scale', '<span class="dhint" style="flex:none">1 :</span>' +
              '<input id="cvScale" value="1" inputmode="decimal" aria-label="Drawing scale">') +
            row('Filled areas', '<input id="cvFill" type="checkbox" checked>' +
              '<span class="dhint">outline them on their own layer</span>') +
            row('Sheets', select('cvLay', [['side', 'All pages in one drawing, side by side'],
              ['zip', 'One DXF per page (.zip)']])) +
            pagesRow +
            '<p class="dhint block">Saves a <b>DXF</b> — AutoCAD\u2019s own exchange format. AutoCAD, BricsCAD, ' +
            'DraftSight and LibreCAD open it as real, editable lines and text; in AutoCAD use ' +
            '<b>Save As \u203a DWG</b> for a .dwg. Set the scale the drawing was plotted at (for example ' +
            '1 : 50) and lengths come out at real size. Only drawings made in CAD carry lines — a scan ' +
            'is a picture and has none.</p>';
        }
      },
      txt: {
        title: 'PDF to TXT',
        body: function () {
          return row('Layout', select('cvMode', [
              ['plain', 'Plain — lines in reading order'],
              ['layout', 'Keep layout — columns lined up with spaces']])) +
            row('Page breaks', '<input id="cvSep" type="checkbox" checked>' +
              '<span class="dhint">mark where each page starts</span>') +
            pagesRow;
        }
      }
    };

    function openPanel(kind) {
      if (X.winOnly && X.winOnly('convert')) return;
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (busy) return;
      if (!dlg.hidden && openKind === kind) { close(); return; }
      openKind = kind;
      const P = PANELS[kind];
      $('cvTitle').textContent = P.title;
      $('cvBody').innerHTML = P.body();
      $('cvNote').textContent = S.items.length + (S.items.length === 1 ? ' page' : ' pages');
      $('cvGo').textContent = 'Convert';
      $('cvGo').disabled = false;
      $('cvProg').hidden = true;
      dlg.hidden = false;
      setTimeout(function () { const f = $('cvBody').querySelector('select,input'); if (f) f.focus(); }, 0);
    }

    function pagesFrom() {
      const n = S.items.length;
      const v = String(($('cvPages') && $('cvPages').value) || 'all').trim().toLowerCase();
      if (!v || v === 'all') return S.items.map(function (_, i) { return i; });
      const set = {};
      X.organize.parseRanges(v, n).forEach(function (g) { g.forEach(function (i) { set[i] = 1; }); });
      return Object.keys(set).map(Number).filter(function (i) { return i >= 0 && i < n; })
        .sort(function (a, b) { return a - b; });
    }

    function progress(done, total, what) {
      $('cvProg').hidden = false;
      $('cvBar').style.width = Math.round(100 * done / Math.max(1, total)) + '%';
      $('cvNote').textContent = what;
    }

    async function run(kind) {
      let pages;
      try { pages = pagesFrom(); } catch (e) { pages = null; }
      if (!pages || !pages.length) { $('cvNote').textContent = 'No pages in that range'; return; }
      const opts = {
        mode: $('cvMode') ? $('cvMode').value : '',
        sheets: $('cvSheets') ? $('cvSheets').value : '',
        fmt: $('cvFmt') ? $('cvFmt').value : '',
        dpi: $('cvDpi') ? parseInt($('cvDpi').value, 10) : 150,
        sep: $('cvSep') ? $('cvSep').checked : true,
        unit: $('cvUnit') ? $('cvUnit').value : 'mm',
        scale: $('cvScale') ? (parseFloat(String($('cvScale').value).replace(',', '.')) || 1) : 1,
        fills: $('cvFill') ? $('cvFill').checked : true,
        lay: $('cvLay') ? $('cvLay').value : 'side'
      };
      busy = true; stop = false;
      $('cvGo').disabled = true; $('cvGo').textContent = 'Converting…';
      $('cvCancel').textContent = 'Stop';
      let doc = null;
      try {
        progress(0, 1, 'Preparing the document…');
        doc = await openCurrent(pages);
        const out = await CONVERT[kind](doc, opts);
        if (stop) throw new Error('stopped');
        X.download(out.data, out.name, out.type);
        busy = false;
        dlg.hidden = true; openKind = null;
        X.toast('Saved <b>' + X.esc(out.name) + '</b>' + (out.note ? ' · ' + out.note : ''));
      } catch (e) {
        if (e && e.message === 'stopped') {
          $('cvNote').textContent = 'Stopped';
        } else {
          console.error('[convert]', e);
          $('cvNote').innerHTML = '<span style="color:var(--danger)">Could not convert — ' +
            X.esc((e && e.message) || 'unknown error') + '</span>';
        }
      } finally {
        busy = false;
        if (doc && doc.destroy) { try { doc.destroy(); } catch (e) { /* already gone */ } }
        $('cvGo').disabled = false; $('cvGo').textContent = 'Convert';
        $('cvCancel').textContent = 'Cancel';
        $('cvProg').hidden = true;
      }
    }

    /* ---------------- the document as it stands ---------------- */

    /* The chosen pages rebuilt with every edit, then read back with pdf.js.
       If the rebuild fails (an encrypted original), fall back to the pages as
       they were opened, which still converts — just without the marks. */
    async function openCurrent(pages) {
      const items = pages.map(function (i) { return S.items[i]; });
      try {
        const bytes = await X.buildPdf(items, null, {});
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        return {
          count: pdf.numPages, label: function (i) { return pages[i] + 1; },
          page: function (i) { return pdf.getPage(i + 1); },
          destroy: function () { pdf.destroy(); }
        };
      } catch (e) {
        console.warn('[convert] rebuild failed, using the original pages', e);
        return {
          count: items.length, label: function (i) { return pages[i] + 1; },
          page: async function (i) { await X.ensurePage(items[i]); return items[i].page; },
          destroy: null
        };
      }
    }

    function check() { if (stop) throw new Error('stopped'); }

    /* ---------------- reading text by position ---------------- */

    /* One run per text item, in top-left page points: x, baseline y, width,
       font size. Rotation and the page's own rotation are already applied. */
    async function textRuns(page) {
      const vp = page.getViewport({ scale: 1 });
      let tc;
      try { tc = await page.getTextContent(); } catch (e) { tc = { items: [] }; }
      const runs = [];
      tc.items.forEach(function (it) {
        if (!it.str) return;
        const m = pdfjs.Util.transform(vp.transform, it.transform);
        const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 10;
        if (!it.str.trim()) return;
        runs.push({ x: m[4], y: m[5], w: Math.abs(it.width || 0), size: size, str: it.str });
      });
      return { runs: runs, w: vp.width, h: vp.height };
    }

    /* Runs gathered into lines, and each line into segments split wherever the
       gap is wide enough to be a column rather than a space. */
    function toLines(runs) {
      const sorted = runs.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      const lines = [];
      sorted.forEach(function (r) {
        const tol = Math.max(2, r.size * 0.45);
        let ln = null;
        for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
          if (Math.abs(lines[i].y - r.y) <= tol) { ln = lines[i]; break; }
        }
        if (!ln) { ln = { y: r.y, runs: [] }; lines.push(ln); }
        ln.runs.push(r);
      });
      lines.forEach(function (ln) {
        ln.runs.sort(function (a, b) { return a.x - b.x; });
        ln.size = Math.max.apply(null, ln.runs.map(function (r) { return r.size; }));
        ln.segs = [];
        let seg = null, prev = null;
        ln.runs.forEach(function (r) {
          const gap = prev ? r.x - (prev.x + prev.w) : 0;
          const colGap = Math.max(r.size, prev ? prev.size : 0) * 1.1;
          if (!seg || gap > colGap) {
            seg = { x: r.x, x2: r.x + r.w, text: r.str, size: r.size };
            ln.segs.push(seg);
          } else {
            const space = gap > r.size * 0.18 && !/\s$/.test(seg.text) && !/^\s/.test(r.str);
            seg.text += (space ? ' ' : '') + r.str;
            seg.x2 = Math.max(seg.x2, r.x + r.w);
          }
          prev = r;
        });
        ln.segs.forEach(function (s) { s.text = s.text.replace(/\s+/g, ' ').trim(); });
        ln.segs = ln.segs.filter(function (s) { return s.text; });
        ln.x = ln.segs.length ? ln.segs[0].x : 0;
        ln.x2 = ln.segs.length ? ln.segs[ln.segs.length - 1].x2 : 0;
        ln.text = ln.segs.map(function (s) { return s.text; }).join(' ');
      });
      return lines.filter(function (ln) { return ln.segs.length; });
    }

    /* The size most of the page's characters are set in — "body text". */
    function bodySize(lines) {
      const tally = {};
      lines.forEach(function (ln) {
        const k = Math.round(ln.size * 2) / 2;
        tally[k] = (tally[k] || 0) + ln.text.length;
      });
      let best = 10, n = -1;
      Object.keys(tally).forEach(function (k) { if (tally[k] > n) { n = tally[k]; best = +k; } });
      return best;
    }

    /* Lines into paragraphs: a new one at a bigger gap, a change of size, or
       after a line that stops well short of the measure. */
    function toParagraphs(lines, pageW) {
      const paras = [];
      const measure = Math.max.apply(null, lines.map(function (l) { return l.x2 - l.x; }).concat([1]));
      let cur = null, prev = null;
      lines.forEach(function (ln) {
        const lead = prev ? ln.y - prev.y : 0;
        const brk = !cur ||
          ln.segs.length > 1 || prev.segs.length > 1 ||
          lead > Math.max(prev.size, ln.size) * 1.75 ||
          Math.abs(ln.size - prev.size) > prev.size * 0.15 ||
          (prev.x2 - prev.x) < measure * 0.62;
        if (brk) {
          cur = { size: ln.size, lines: [ln], x: ln.x, x2: ln.x2 };
          paras.push(cur);
        } else {
          cur.lines.push(ln);
          cur.x = Math.min(cur.x, ln.x); cur.x2 = Math.max(cur.x2, ln.x2);
        }
        prev = ln;
      });
      paras.forEach(function (p) {
        if (p.lines.length === 1 && p.lines[0].segs.length > 1) {
          p.cells = p.lines[0].segs.map(function (s) { return s.text; });
          p.text = p.cells.join('\t');
        } else {
          let t = '';
          p.lines.forEach(function (ln) {
            if (!t) t = ln.text;
            else if (/[A-Za-z]-$/.test(t) && /^[a-z]/.test(ln.text)) t = t.slice(0, -1) + ln.text;
            else t += ' ' + ln.text;
          });
          p.text = t;
        }
        const mid = (p.x + p.x2) / 2;
        p.center = p.lines.length <= 2 && (p.x2 - p.x) < pageW * 0.7 &&
          Math.abs(mid - pageW / 2) < pageW * 0.04 && p.x > pageW * 0.12;
      });
      return paras;
    }

    /* ---------------- rendering pages ---------------- */

    const MAX_SIDE = 12000, MAX_AREA = 60e6;      /* inside every browser's canvas limit */

    /** The page as an image. `noText` leaves the text off, for slides that
        carry their text in editable boxes instead. */
    async function renderPage(page, dpi, type, quality, noText) {
      let scale = dpi / 72;
      const base = page.getViewport({ scale: 1 });
      scale = Math.min(scale, MAX_SIDE / base.width, MAX_SIDE / base.height,
        Math.sqrt(MAX_AREA / (base.width * base.height)));
      const vp = page.getViewport({ scale: scale });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vp.width));
      cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      if (noText) { ctx.fillText = function () {}; ctx.strokeText = function () {}; }
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(function (res) { cv.toBlob(res, type, quality); });
      const data = new Uint8Array(await blob.arrayBuffer());
      cv.width = cv.height = 0;                    /* hand the memory back now */
      return { data: data, w: base.width, h: base.height, capped: scale < dpi / 72 - 1e-6 };
    }

    /* ---------------- XML ---------------- */

    function x(s) {
      return String(s)
        /* characters XML 1.0 does not allow at all */
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    function file(name, text) { return { name: name, data: enc.encode(text) }; }
    const EMU = 12700;                             /* EMUs in a point */

    /* ---------------- the converters ---------------- */

    const CONVERT = {};

    /* ---- Word ---- */
    CONVERT.word = async function (doc, o) {
      const body = [], media = [], rels = [];
      let firstSize = null, pics = 0;

      function picture(img, maxW, maxH) {
        pics++;
        const id = 'rIdImg' + pics, nm = 'image' + pics + '.jpeg';
        media.push({ name: 'word/media/' + nm, data: img.data });
        rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + nm + '"/>');
        const k = Math.min(maxW / img.w, maxH / img.h, 1);
        const cx = Math.round(img.w * k * EMU), cy = Math.round(img.h * k * EMU);
        return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
          '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
          '<wp:docPr id="' + pics + '" name="Page ' + pics + '"/>' +
          '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<pic:nvPicPr><pic:cNvPr id="' + pics + '" name="' + nm + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
          '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
          '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
          '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
          '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
      }

      const imageMode = o.mode === 'image';
      const margin = imageMode ? 20 : 72;          /* points */
      for (let i = 0; i < doc.count; i++) {
        check();
        progress(i, doc.count, 'Page ' + (i + 1) + ' of ' + doc.count + '…');
        const page = await doc.page(i);
        const vp = page.getViewport({ scale: 1 });
        if (!firstSize) firstSize = [vp.width, vp.height];
        const contentW = firstSize[0] - margin * 2, contentH = firstSize[1] - margin * 2 - 4;
        if (i) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

        if (imageMode) {
          body.push(picture(await renderPage(page, 200, 'image/jpeg', 0.9), contentW, contentH));
          continue;
        }
        const t = await textRuns(page);
        const lines = toLines(t.runs);
        if (!lines.length) {                       /* a scan: keep it as a picture */
          body.push(picture(await renderPage(page, 200, 'image/jpeg', 0.9), contentW, contentH));
          continue;
        }
        const bs = bodySize(lines);
        toParagraphs(lines, t.w).forEach(function (p) {
          const sz = Math.max(12, Math.min(144, Math.round(p.size * 2)));
          const bold = p.size >= bs * 1.2;
          const rpr = '<w:rPr>' + (bold ? '<w:b/>' : '') + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
          let runs;
          if (p.cells) {
            runs = p.cells.map(function (c, k) {
              return (k ? '<w:r>' + rpr + '<w:tab/></w:r>' : '') +
                '<w:r>' + rpr + '<w:t xml:space="preserve">' + x(c) + '</w:t></w:r>';
            }).join('');
          } else {
            runs = '<w:r>' + rpr + '<w:t xml:space="preserve">' + x(p.text) + '</w:t></w:r>';
          }
          const ind = Math.max(0, Math.round((p.x - margin) * 20));
          body.push('<w:p><w:pPr><w:spacing w:before="0" w:after="' + Math.round(p.size * 8) + '"/>' +
            (p.center ? '<w:jc w:val="center"/>' : (ind > 200 && !p.cells ? '<w:ind w:left="' + Math.min(ind, 5000) + '"/>' : '')) +
            '</w:pPr>' + runs + '</w:p>');
        });
      }
      check();
      progress(doc.count, doc.count, 'Writing the .docx…');

      const W = Math.round(firstSize[0] * 20), H = Math.round(firstSize[1] * 20), M = margin * 20;
      const landscape = firstSize[0] > firstSize[1];
      body.push('<w:sectPr><w:pgSz w:w="' + W + '" w:h="' + H + '"' + (landscape ? ' w:orient="landscape"' : '') + '/>' +
        '<w:pgMar w:top="' + M + '" w:right="' + M + '" w:bottom="' + M + '" w:left="' + M + '" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>');

      const files = [
        file('[Content_Types].xml', XML +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '</Types>'),
        file('_rels/.rels', XML +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>'),
        file('word/_rels/document.xml.rels', XML +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          rels.join('') + '</Relationships>'),
        file('word/styles.xml', XML +
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
          '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
          '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
          '</w:styles>'),
        file('word/document.xml', XML +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
          'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
          '<w:body>' + body.join('') + '</w:body></w:document>')
      ].concat(media);
      return {
        data: X.zipStore(files), name: S.baseName + '.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
    };

    /* ---- Excel ---- */

    function colName(n) {                          /* 0 -> A, 26 -> AA */
      let s = ''; n++;
      while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
      return s;
    }
    const NUM = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
    function cellXml(ref, v) {
      const t = String(v).trim();
      if (NUM.test(t) && !/^[-+]?0\d/.test(t) && t.replace(/[^\d]/g, '').length < 16) {
        return '<c r="' + ref + '"><v>' + parseFloat(t.replace(/,/g, '')) + '</v></c>';
      }
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + x(t) + '</t></is></c>';
    }

    /* Lines onto a grid: the left edges of every segment are clustered into
       columns, and each segment drops into the column nearest its edge. */
    function toGrid(lines) {
      /* Only rows that split into cells say where the columns are. A title or
         a paragraph line is one cell, and goes in the first column — letting
         it vote would open an empty column through the middle of a table. */
      const xs = [];
      lines.forEach(function (ln) {
        if (ln.segs.length > 1) ln.segs.forEach(function (s) { xs.push(s.x); });
      });
      if (!xs.length) xs.push(0);
      xs.sort(function (a, b) { return a - b; });
      const cols = [];
      xs.forEach(function (v) {
        const c = cols[cols.length - 1];
        if (c && v - c.max <= 9) { c.max = v; c.sum += v; c.n++; }
        else cols.push({ min: v, max: v, sum: v, n: 1 });
      });
      const centres = cols.map(function (c) { return c.sum / c.n; });
      const rows = [];
      let prev = null;
      lines.forEach(function (ln) {
        if (prev && ln.y - prev.y > Math.max(ln.size, prev.size) * 2.6) rows.push([]);   /* a gap between blocks */
        const r = [];
        if (ln.segs.length === 1) { r[0] = ln.segs[0].text; rows.push(r); prev = ln; return; }
        ln.segs.forEach(function (s) {
          let best = 0, d = Infinity;
          centres.forEach(function (c, k) { const dd = Math.abs(c - s.x); if (dd < d) { d = dd; best = k; } });
          while (r[best] !== undefined && best < centres.length - 1) best++;   /* never overwrite */
          r[best] = r[best] !== undefined ? r[best] + ' ' + s.text : s.text;
        });
        rows.push(r);
        prev = ln;
      });
      return rows;
    }

    CONVERT.excel = async function (doc, o) {
      const sheets = [];                           /* {name, rows} */
      let empty = 0;
      for (let i = 0; i < doc.count; i++) {
        check();
        progress(i, doc.count, 'Reading page ' + (i + 1) + ' of ' + doc.count + '…');
        const page = await doc.page(i);
        const t = await textRuns(page);
        const rows = toGrid(toLines(t.runs));
        if (!rows.length) empty++;
        if (o.sheets === 'one') {
          if (!sheets.length) sheets.push({ name: 'Document', rows: [] });
          const all = sheets[0].rows;
          if (all.length) all.push([]);
          all.push(['Page ' + doc.label(i)]);
          Array.prototype.push.apply(all, rows);
        } else {
          sheets.push({ name: 'Page ' + doc.label(i), rows: rows.length ? rows : [['(no text on this page)']] });
        }
      }
      check();
      if (empty === doc.count) throw new Error('no text found — the pages look scanned');
      progress(doc.count, doc.count, 'Writing the .xlsx…');

      const files = [];
      const sheetXml = sheets.map(function (sh, si) {
        const widths = [];
        const rowsXml = sh.rows.map(function (r, ri) {
          let cells = '';
          for (let c = 0; c < r.length; c++) {
            if (r[c] === undefined || r[c] === '') continue;
            widths[c] = Math.max(widths[c] || 0, String(r[c]).length);
            cells += cellXml(colName(c) + (ri + 1), r[c]);
          }
          return '<row r="' + (ri + 1) + '">' + cells + '</row>';
        }).join('');
        const cols = widths.length ? '<cols>' + widths.map(function (w, c) {
          const wd = Math.max(8, Math.min(70, (w || 0) + 2));
          return '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + wd + '" customWidth="1"/>';
        }).join('') + '</cols>' : '';
        files.push(file('xl/worksheets/sheet' + (si + 1) + '.xml', XML +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          cols + '<sheetData>' + rowsXml + '</sheetData></worksheet>'));
        return '<sheet name="' + x(sh.name.slice(0, 31)) + '" sheetId="' + (si + 1) + '" r:id="rId' + (si + 1) + '"/>';
      });

      files.unshift(
        file('[Content_Types].xml', XML +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map(function (_, si) {
            return '<Override PartName="/xl/worksheets/sheet' + (si + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
          }).join('') + '</Types>'),
        file('_rels/.rels', XML +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'),
        file('xl/workbook.xml', XML +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets>' + sheetXml.join('') + '</sheets></workbook>'),
        file('xl/_rels/workbook.xml.rels', XML +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map(function (_, si) {
            return '<Relationship Id="rId' + (si + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (si + 1) + '.xml"/>';
          }).join('') +
          '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'),
        file('xl/styles.xml', XML +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
          '</styleSheet>')
      );
      return {
        data: X.zipStore(files), name: S.baseName + '.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        note: empty ? empty + ' page' + (empty > 1 ? 's' : '') + ' had no text' : ''
      };
    };

    /* ---- PowerPoint ---- */

    const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
    const THEME = XML +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>' +
      '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
      '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
      '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
      '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
      '<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
      '<a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
      '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
      '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
      '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
      '</a:themeElements></a:theme>';

    CONVERT.ppt = async function (doc, o) {
      const slides = [], media = [];
      let sw = 0, sh = 0, k = 1;
      const editable = o.mode === 'text';
      for (let i = 0; i < doc.count; i++) {
        check();
        progress(i, doc.count, 'Slide ' + (i + 1) + ' of ' + doc.count + '…');
        const page = await doc.page(i);
        if (!sw) {
          const vp = page.getViewport({ scale: 1 });
          /* slide size from the first page, inside PowerPoint's 1"–56" range */
          k = Math.min(1, 51206400 / (vp.width * EMU), 51206400 / (vp.height * EMU));
          k = Math.max(k, 914400 / (Math.min(vp.width, vp.height) * EMU));
          sw = Math.round(vp.width * EMU * k); sh = Math.round(vp.height * EMU * k);
        }
        const img = await renderPage(page, o.dpi || 150, 'image/jpeg', 0.88, editable);
        media.push({ name: 'ppt/media/image' + (i + 1) + '.jpeg', data: img.data });
        /* fit this page to the slide, centred — pages need not share a size */
        const f = Math.min(sw / (img.w * EMU), sh / (img.h * EMU));
        const pw = Math.round(img.w * EMU * f), ph = Math.round(img.h * EMU * f);
        const ox = Math.round((sw - pw) / 2), oy = Math.round((sh - ph) / 2);
        let tree = '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ' + doc.label(i) + '"/>' +
          '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
          '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
          '<p:spPr><a:xfrm><a:off x="' + ox + '" y="' + oy + '"/><a:ext cx="' + pw + '" cy="' + ph + '"/></a:xfrm>' +
          '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
        if (editable) {
          const t = await textRuns(page);
          let id = 3;
          toLines(t.runs).forEach(function (ln) {
            ln.segs.forEach(function (s) {
              const size = s.size * f * EMU / 12700;             /* points on the slide */
              const bx = ox + Math.round(s.x * EMU * f);
              const by = oy + Math.round((ln.y - s.size * 0.86) * EMU * f);
              const bw = Math.max(12700, Math.round((s.x2 - s.x) * EMU * f * 1.04));
              const bh = Math.max(12700, Math.round(s.size * 1.2 * EMU * f));
              const sz = Math.max(100, Math.min(400000, Math.round(size * 100)));
              tree += '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Text ' + id + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
                '<p:spPr><a:xfrm><a:off x="' + bx + '" y="' + by + '"/><a:ext cx="' + bw + '" cy="' + bh + '"/></a:xfrm>' +
                '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
                '<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>' +
                '<a:p><a:r><a:rPr lang="en-US" sz="' + sz + '" dirty="0"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr>' +
                '<a:t>' + x(s.text) + '</a:t></a:r></a:p></p:txBody></p:sp>';
              id++;
            });
          });
        }
        slides.push(XML + '<p:sld ' + P_NS + '><p:cSld><p:spTree>' + EMPTY_TREE + tree + '</p:spTree></p:cSld>' +
          '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
      }
      check();
      progress(doc.count, doc.count, 'Writing the .pptx…');

      const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
      const RELS = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
      const files = [
        file('[Content_Types].xml', XML +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
          '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
          '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
          '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
          '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
          slides.map(function (_, i) {
            return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
          }).join('') + '</Types>'),
        file('_rels/.rels', XML + RELS +
          '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="ppt/presentation.xml"/></Relationships>'),
        file('ppt/presentation.xml', XML + '<p:presentation ' + P_NS + ' saveSubsetFonts="1">' +
          '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
          '<p:sldIdLst>' + slides.map(function (_, i) {
            return '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 3) + '"/>';
          }).join('') + '</p:sldIdLst>' +
          '<p:sldSz cx="' + sw + '" cy="' + sh + '"/><p:notesSz cx="6858000" cy="9144000"/>' +
          '<p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="en-US"/></a:lvl1pPr></p:defaultTextStyle>' +
          '</p:presentation>'),
        file('ppt/_rels/presentation.xml.rels', XML + RELS +
          '<Relationship Id="rId1" Type="' + REL + 'slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
          '<Relationship Id="rId2" Type="' + REL + 'theme" Target="theme/theme1.xml"/>' +
          slides.map(function (_, i) {
            return '<Relationship Id="rId' + (i + 3) + '" Type="' + REL + 'slide" Target="slides/slide' + (i + 1) + '.xml"/>';
          }).join('') + '</Relationships>'),
        file('ppt/slideMasters/slideMaster1.xml', XML + '<p:sldMaster ' + P_NS + '>' +
          '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + EMPTY_TREE + '</p:spTree></p:cSld>' +
          '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
          'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
          '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
          '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>' +
          '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>' +
          '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>' +
          '</p:sldMaster>'),
        file('ppt/slideMasters/_rels/slideMaster1.xml.rels', XML + RELS +
          '<Relationship Id="rId1" Type="' + REL + 'slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
          '<Relationship Id="rId2" Type="' + REL + 'theme" Target="../theme/theme1.xml"/></Relationships>'),
        file('ppt/slideLayouts/slideLayout1.xml', XML + '<p:sldLayout ' + P_NS + ' type="blank" preserve="1">' +
          '<p:cSld name="Blank"><p:spTree>' + EMPTY_TREE + '</p:spTree></p:cSld>' +
          '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'),
        file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', XML + RELS +
          '<Relationship Id="rId1" Type="' + REL + 'slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'),
        file('ppt/theme/theme1.xml', THEME)
      ];
      slides.forEach(function (sx, i) {
        files.push(file('ppt/slides/slide' + (i + 1) + '.xml', sx));
        files.push(file('ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', XML + RELS +
          '<Relationship Id="rId1" Type="' + REL + 'slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
          '<Relationship Id="rId2" Type="' + REL + 'image" Target="../media/image' + (i + 1) + '.jpeg"/></Relationships>'));
      });
      return {
        data: X.zipStore(files.concat(media)), name: S.baseName + '.pptx',
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      };
    };

    /* ---- Picture ---- */
    CONVERT.img = async function (doc, o) {
      const png = o.fmt === 'png', ext = png ? 'png' : 'jpg';
      const out = [];
      let capped = false;
      const width = String(doc.count).length;
      for (let i = 0; i < doc.count; i++) {
        check();
        progress(i, doc.count, 'Page ' + (i + 1) + ' of ' + doc.count + '…');
        const img = await renderPage(await doc.page(i), o.dpi || 150, png ? 'image/png' : 'image/jpeg', 0.92);
        capped = capped || img.capped;
        const n = String(doc.label(i));
        out.push({ name: S.baseName + ' - page ' + (n.length < width ? '0'.repeat(width - n.length) + n : n) + '.' + ext, data: img.data });
      }
      check();
      const note = capped ? 'very large pages were kept under the browser’s size limit' : '';
      if (out.length === 1) {
        return { data: out[0].data, name: out[0].name, type: png ? 'image/png' : 'image/jpeg', note: note };
      }
      progress(doc.count, doc.count, 'Packing the .zip…');
      return { data: X.zipStore(out), name: S.baseName + ' - ' + ext.toUpperCase() + '.zip', type: 'application/zip', note: note };
    };

    /* ---- Text ---- */
    CONVERT.txt = async function (doc, o) {
      const out = [];
      let chars = 0;
      for (let i = 0; i < doc.count; i++) {
        check();
        progress(i, doc.count, 'Page ' + (i + 1) + ' of ' + doc.count + '…');
        const page = await doc.page(i);
        const t = await textRuns(page);
        const lines = toLines(t.runs);
        if (o.sep) {
          if (i) out.push('');
          out.push('── Page ' + doc.label(i) + ' ──');
        }
        if (o.mode === 'layout') {
          /* a fixed grid: one character per half body-size, one line per leading */
          const cw = Math.max(2.5, bodySize(lines) * 0.5);
          let prevY = null;
          lines.forEach(function (ln) {
            if (prevY !== null && ln.y - prevY > ln.size * 2.2) out.push('');
            let s = '';
            ln.segs.forEach(function (sg) {
              const col = Math.max(0, Math.round(sg.x / cw));
              if (s.length < col) s += ' '.repeat(col - s.length);
              else if (s) s += '  ';
              s += sg.text;
            });
            out.push(s.replace(/\s+$/, ''));
            prevY = ln.y;
          });
        } else {
          toParagraphs(lines, t.w).forEach(function (p) { out.push(p.text); });
        }
        lines.forEach(function (ln) { chars += ln.text.length; });
      }
      check();
      if (!chars) throw new Error('no text found — the pages look scanned');
      return {
        data: enc.encode('\uFEFF' + out.join('\r\n') + '\r\n'),   /* BOM so Notepad reads it as UTF-8 */
        name: S.baseName + '.txt', type: 'text/plain;charset=utf-8'
      };
    };

    /* ---- CAD (DXF) ----
       DWG is Autodesk's closed binary format and DWF is for viewing only, so
       the drawing goes out as DXF — AutoCAD's own open exchange format, which
       it opens straight into real, editable lines and text (and Save As DWG
       from there). Everything comes from the PDF's vector content: each path
       is followed through its transforms, curves are traced into short
       polylines, and every piece of text keeps its place, size and angle.
       Written as DXF R12, the version every CAD program reads. */

    /* AutoCAD colour index: the few that matter on a drawing. Black and
       white are both 7 — AutoCAD shows it as the contrast to its background. */
    const ACI = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255],
      [6, 255, 0, 255], [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [40, 255, 191, 0],
      [140, 0, 127, 255], [150, 0, 63, 255], [10, 255, 63, 63], [94, 0, 153, 0], [250, 51, 51, 51],
      [251, 91, 91, 91], [252, 132, 132, 132], [253, 173, 173, 173], [254, 214, 214, 214]];
    function aciOf(c) {
      if (!c) return 7;
      const r = c[0], g = c[1], b = c[2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 45 || mn > 235) return 7;
      let best = 7, bd = Infinity;
      ACI.forEach(function (a) {
        const d = (a[1] - r) * (a[1] - r) + (a[2] - g) * (a[2] - g) + (a[3] - b) * (a[3] - b);
        if (d < bd) { bd = d; best = a[0]; }
      });
      return best;
    }
    function rgbArgs(args) {
      if (!args) return null;
      if (typeof args[0] === 'string' && args[0][0] === '#') {
        const n = parseInt(args[0].slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      if (args.length >= 3) return [args[0], args[1], args[2]].map(function (v) { return v <= 1 && v >= 0 && !Number.isInteger(v) ? Math.round(v * 255) : v; });
      return null;
    }

    function dxfText(s) {
      let o = '';
      for (const ch of String(s).replace(/[\r\n\t]+/g, ' ')) {
        const c = ch.codePointAt(0);
        o += c < 32 ? ' ' : c < 127 ? ch : '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
      }
      return o;
    }

    function DxfOut() {
      const L = [];
      const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      function n(v) { return (Math.round(v * 10000) / 10000).toString(); }
      function grow(x, y) {
        if (x < box.x1) box.x1 = x; if (y < box.y1) box.y1 = y;
        if (x > box.x2) box.x2 = x; if (y > box.y2) box.y2 = y;
      }
      function pair(code, v) { L.push(String(code), String(v)); }
      return {
        count: 0,
        line: function (layer, col, a, b) {
          pair(0, 'LINE'); pair(8, layer); pair(62, col);
          pair(10, n(a[0])); pair(20, n(a[1])); pair(30, 0);
          pair(11, n(b[0])); pair(21, n(b[1])); pair(31, 0);
          grow(a[0], a[1]); grow(b[0], b[1]); this.count++;
        },
        poly: function (layer, col, pts, closed) {
          if (pts.length < 2) return;
          if (pts.length === 2 && !closed) { this.line(layer, col, pts[0], pts[1]); return; }
          pair(0, 'POLYLINE'); pair(8, layer); pair(62, col); pair(66, 1);
          pair(10, 0); pair(20, 0); pair(30, 0); pair(70, closed ? 1 : 0);
          pts.forEach(function (p) {
            pair(0, 'VERTEX'); pair(8, layer); pair(10, n(p[0])); pair(20, n(p[1])); pair(30, 0);
            grow(p[0], p[1]);
          });
          pair(0, 'SEQEND'); pair(8, layer);
          this.count++;
        },
        text: function (layer, col, p, h, rot, str) {
          const t = dxfText(str).trim();
          if (!t || !(h > 0)) return;
          pair(0, 'TEXT'); pair(8, layer); pair(62, col);
          pair(10, n(p[0])); pair(20, n(p[1])); pair(30, 0);
          pair(40, n(h)); pair(1, t);
          if (Math.abs(rot) > 0.01) pair(50, n(rot));
          grow(p[0], p[1]); this.count++;
        },
        file: function (layers) {
          const H = [];
          function hp(code, v) { H.push(String(code), String(v)); }
          const b = isFinite(box.x1) ? box : { x1: 0, y1: 0, x2: 100, y2: 100 };
          hp(0, 'SECTION'); hp(2, 'HEADER');
          hp(9, '$ACADVER'); hp(1, 'AC1009');
          hp(9, '$INSBASE'); hp(10, 0); hp(20, 0); hp(30, 0);
          hp(9, '$EXTMIN'); hp(10, n(b.x1)); hp(20, n(b.y1)); hp(30, 0);
          hp(9, '$EXTMAX'); hp(10, n(b.x2)); hp(20, n(b.y2)); hp(30, 0);
          hp(9, '$LIMMIN'); hp(10, n(b.x1)); hp(20, n(b.y1));
          hp(9, '$LIMMAX'); hp(10, n(b.x2)); hp(20, n(b.y2));
          hp(0, 'ENDSEC');
          hp(0, 'SECTION'); hp(2, 'TABLES');
          hp(0, 'TABLE'); hp(2, 'LTYPE'); hp(70, 1);
          hp(0, 'LTYPE'); hp(2, 'CONTINUOUS'); hp(70, 0); hp(3, 'Solid line'); hp(72, 65); hp(73, 0); hp(40, '0.0');
          hp(0, 'ENDTAB');
          hp(0, 'TABLE'); hp(2, 'LAYER'); hp(70, layers.length);
          layers.forEach(function (l) { hp(0, 'LAYER'); hp(2, l[0]); hp(70, 0); hp(62, l[1]); hp(6, 'CONTINUOUS'); });
          hp(0, 'ENDTAB');
          hp(0, 'TABLE'); hp(2, 'STYLE'); hp(70, 1);
          hp(0, 'STYLE'); hp(2, 'STANDARD'); hp(70, 0); hp(40, '0.0'); hp(41, '1.0'); hp(50, '0.0');
          hp(71, 0); hp(42, '2.5'); hp(3, 'txt'); hp(4, '');
          hp(0, 'ENDTAB');
          hp(0, 'ENDSEC');
          hp(0, 'SECTION'); hp(2, 'BLOCKS'); hp(0, 'ENDSEC');
          hp(0, 'SECTION'); hp(2, 'ENTITIES');
          const tail = ['0', 'ENDSEC', '0', 'EOF'];
          return H.concat(L, tail).join('\r\n') + '\r\n';
        }
      };
    }
    const CAD_LAYERS = [['PDF-LINES', 7], ['PDF-FILLS', 8], ['PDF-TEXT', 7], ['PAGE-FRAME', 9]];

    /* One page into the drawing, its lower-left corner at (ox, oy). f turns
       PDF points into drawing units. */
    async function cadPage(page, out, f, ox, oy, o) {
      const vp = page.getViewport({ scale: 1 });
      const U = pdfjs.Util, OPS = pdfjs.OPS;
      function P(x, y) {
        const v = vp.convertToViewportPoint(x, y);
        return [ox + v[0] * f, oy + (vp.height - v[1]) * f];
      }
      /* the sheet itself, so pages sit on their own frames */
      out.poly('PAGE-FRAME', 9, [[ox, oy], [ox + vp.width * f, oy],
        [ox + vp.width * f, oy + vp.height * f], [ox, oy + vp.height * f]], true);

      const ol = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      let stroke = null, fill = null;
      const stack = [];
      let subs = [], cur = null;
      function T(x, y) { const q = U.applyTransform([x, y], ctm); return P(q[0], q[1]); }
      function begin(p) { cur = { pts: [p], closed: false }; subs.push(cur); }
      function to(p) { if (!cur) begin(p); else cur.pts.push(p); }
      function bez(p0, c1, c2, p3) {
        const len = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
                    Math.hypot(p3[0] - c2[0], p3[1] - c2[1]);
        const nSeg = Math.max(4, Math.min(32, Math.ceil(len / (2 * f + 1e-9) / 3)));
        for (let i = 1; i <= nSeg; i++) {
          const t = i / nSeg, u = 1 - t;
          const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
          to([a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]]);
        }
      }
      function paint(layer, colour) {
        const col = aciOf(colour);
        subs.forEach(function (s) {
          /* drop repeated points, which CAD reads as zero-length segments */
          const pts = s.pts.filter(function (p, i) {
            return !i || Math.hypot(p[0] - s.pts[i - 1][0], p[1] - s.pts[i - 1][1]) > 1e-6;
          });
          if (pts.length >= 2) out.poly(layer, col, pts, s.closed);
        });
      }
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i], args = ol.argsArray[i];
        if (fn === OPS.save) stack.push({ ctm: ctm, stroke: stroke, fill: fill });
        else if (fn === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; stroke = s.stroke; fill = s.fill; } }
        else if (fn === OPS.transform) ctm = U.transform(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push({ ctm: ctm, stroke: stroke, fill: fill });
          if (args && args[0]) ctm = U.transform(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) { ctm = s.ctm; stroke = s.stroke; fill = s.fill; } }
        else if (fn === OPS.setStrokeRGBColor) stroke = rgbArgs(args);
        else if (fn === OPS.setFillRGBColor) fill = rgbArgs(args);
        else if (fn === OPS.constructPath) {
          const ops = args[0], co = args[1];
          let j = 0;
          for (let k = 0; k < ops.length; k++) {
            const op = ops[k];
            if (op === OPS.moveTo) { begin(T(co[j], co[j + 1])); j += 2; }
            else if (op === OPS.lineTo) { to(T(co[j], co[j + 1])); j += 2; }
            else if (op === OPS.curveTo) {
              const p0 = cur ? cur.pts[cur.pts.length - 1] : T(co[j], co[j + 1]);
              bez(p0, T(co[j], co[j + 1]), T(co[j + 2], co[j + 3]), T(co[j + 4], co[j + 5])); j += 6;
            } else if (op === OPS.curveTo2) {
              const p0 = cur ? cur.pts[cur.pts.length - 1] : T(co[j], co[j + 1]);
              bez(p0, p0, T(co[j], co[j + 1]), T(co[j + 2], co[j + 3])); j += 4;
            } else if (op === OPS.curveTo3) {
              const p0 = cur ? cur.pts[cur.pts.length - 1] : T(co[j], co[j + 1]);
              const e = T(co[j + 2], co[j + 3]);
              bez(p0, T(co[j], co[j + 1]), e, e); j += 4;
            } else if (op === OPS.rectangle) {
              const x = co[j], y = co[j + 1], w = co[j + 2], h = co[j + 3]; j += 4;
              begin(T(x, y)); to(T(x + w, y)); to(T(x + w, y + h)); to(T(x, y + h));
              cur.closed = true; cur = null;
            } else if (op === OPS.closePath) { if (cur) { cur.closed = true; cur = null; } }
          }
        } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
          if (fn === OPS.closeStroke && cur) cur.closed = true;
          paint('PDF-LINES', stroke); subs = []; cur = null;
        } else if (fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
                   fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
          subs.forEach(function (s) { s.closed = true; });
          paint('PDF-LINES', stroke); subs = []; cur = null;
        } else if (fn === OPS.fill || fn === OPS.eoFill) {
          if (o.fills) { subs.forEach(function (s) { s.closed = true; }); paint('PDF-FILLS', fill); }
          subs = []; cur = null;
        } else if (fn === OPS.endPath) { subs = []; cur = null; }
      }

      /* the text, as TEXT entities where it sits on the sheet */
      let tc;
      try { tc = await page.getTextContent(); } catch (e) { tc = { items: [] }; }
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        const t = it.transform;
        const p = P(t[4], t[5]);
        const q = P(t[4] + t[0], t[5] + t[1]);
        const rot = Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI;
        const h = Math.hypot(t[2], t[3]) * f;
        out.text('PDF-TEXT', 7, p, h * 0.72, rot, it.str);   /* cap height, as CAD measures text */
      });
      return { w: vp.width * f, h: vp.height * f };
    }

    CONVERT.cad = async function (doc, o) {
      const per = o.unit === 'in' ? 1 / 72 : o.unit === 'pt' ? 1 : 25.4 / 72;
      const f = per * Math.max(0.0001, o.scale || 1);
      const files = [];
      let out = DxfOut(), ox = 0, n = 0;
      for (let i = 0; i < doc.count; i++) {
        check();
        progress(i, doc.count, 'Drawing page ' + (i + 1) + ' of ' + doc.count + '…');
        const page = await doc.page(i);
        if (o.lay === 'zip') { out = DxfOut(); ox = 0; }
        const size = await cadPage(page, out, f, ox, 0, o);
        ox += size.w + size.w * 0.1;                 /* the next sheet sits alongside */
        if (o.lay === 'zip') {
          files.push({ name: S.baseName + ' - page ' + doc.label(i) + '.dxf',
                       data: new TextEncoder().encode(out.file(CAD_LAYERS)) });
          n += out.count;
        }
      }
      check();
      progress(doc.count, doc.count, 'Writing the drawing…');
      const unit = o.unit === 'in' ? 'inches' : o.unit === 'pt' ? 'points' : 'mm';
      const note = 'units: ' + unit + (o.scale && o.scale !== 1 ? ' at 1:' + o.scale : '');
      if (o.lay === 'zip' && files.length > 1) {
        return { data: X.zipStore(files), name: S.baseName + ' - DXF.zip', type: 'application/zip', note: note };
      }
      if (o.lay === 'zip') return { data: files[0].data, name: files[0].name, type: 'application/dxf', note: note };
      n = out.count;
      if (!n) throw new Error('no drawing found — the pages look scanned');
      return { data: new TextEncoder().encode(out.file(CAD_LAYERS)), name: S.baseName + '.dxf',
               type: 'application/dxf', note: note };
    };

    X.convert = { open: openPanel, run: run };
  });
})();
