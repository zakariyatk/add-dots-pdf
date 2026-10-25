/* Add Dots PDF — Round 2 enhancements
   ------------------------------------
   Everything from the second feedback pass that isn't a new Insert-tab mark
   (those extend js/insert.js instead): the blank-page dialog, copy/paste for
   selected marks, text-box polish (double-click to edit, alignment,
   background fill), and how Leader marks from older documents are drawn.
   Same plugin pattern as every other module — reaches the rest of the app
   only through window.ADDPDF. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[enhance] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, PDFLib = X.PDFLib, SVGNS = X.SVGNS;

    /* ================= blank page dialog ================= */

    /* As WPS lays it out: a size (the current page's by default, or a
       standard one, or typed in mm), orientation, how many, and where —
       at the start, at the end, or before or after any list of pages. */
    const MM = 72 / 25.4;
    const SIZES = [
      ['a4', 'A4 (210x297 mm)', 210, 297], ['a3', 'A3 (297x420 mm)', 297, 420],
      ['a5', 'A5 (148x210 mm)', 148, 210], ['letter', 'Letter (216x279 mm)', 215.9, 279.4],
      ['legal', 'Legal (216x356 mm)', 215.9, 355.6], ['tabloid', 'Tabloid (279x432 mm)', 279.4, 431.8]
    ];
    const BLANK_COLORS = ['#FFFFFF', '#F5F5F0', '#FDF6E3', '#EAF2FF', '#111214'];
    const BLANK_MAX = 2000;
    const mm = function (pt) { return Math.round(pt / MM); };

    function paintBlankColors() {
      const host = $('blankColors');
      host.innerHTML = '';
      BLANK_COLORS.forEach(function (c, i) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sw' + (i === 0 ? ' on' : '');
        b.style.cssText = 'width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:' + c;
        b.dataset.c = c; b.title = c;
        b.addEventListener('click', function () {
          host.querySelectorAll('.sw').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
        });
        host.appendChild(b);
      });
    }
    function blankColor() {
      const on = $('blankColors').querySelector('.sw.on');
      return on ? on.dataset.c : '#FFFFFF';
    }

    function currentPageSize() {
      const it = S.items[S.current - 1];
      if (!it || !it.page) return [612, 792];
      const v = it.page.view;
      const w = v[2] - v[0], h = v[3] - v[1];
      return (it.page.rotate + (it.rot || 0)) % 180 ? [h, w] : [w, h];
    }

    /* the size list, its first entry the page on screen */
    function fillSizes() {
      const cur = currentPageSize();
      $('blankSize').innerHTML =
        '<option value="default">Default (' + mm(cur[0]) + 'x' + mm(cur[1]) + ' mm)</option>' +
        SIZES.map(function (z) { return '<option value="' + z[0] + '">' + z[1] + '</option>'; }).join('') +
        '<option value="custom">Custom</option>';
    }
    function sizeMm(v) {
      if (v === 'default') { const c = currentPageSize(); return [c[0] / MM, c[1] / MM]; }
      const z = SIZES.filter(function (x) { return x[0] === v; })[0];
      return z ? [z[2], z[3]] : null;
    }
    /* a size picked: its numbers, turned to the orientation chosen */
    function applySize() {
      const wh = sizeMm($('blankSize').value);
      if (!wh) return;
      let w = wh[0], h = wh[1];
      if ($('blankSize').value === 'default') $('blankOrient').value = w > h ? 'l' : 'p';
      else if (($('blankOrient').value === 'l') !== (w > h)) { const t = w; w = h; h = t; }
      $('blankW').value = Math.round(w); $('blankH').value = Math.round(h);
    }
    $('blankSize').addEventListener('change', applySize);
    $('blankOrient').addEventListener('change', function () {
      const w = +$('blankW').value, h = +$('blankH').value;
      if (($('blankOrient').value === 'l') !== (w > h)) { $('blankW').value = h; $('blankH').value = w; }
    });
    ['blankW', 'blankH'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        $('blankSize').value = 'custom';
        $('blankOrient').value = +$('blankW').value > +$('blankH').value ? 'l' : 'p';
      });
    });
    function where() {
      const r = document.querySelector('input[name="blankWhere"]:checked');
      return r ? r.value : 'pages';
    }
    $('blankPages').addEventListener('focus', function () {
      document.querySelector('input[name="blankWhere"][value="pages"]').checked = true;
    });

    /* the gaps to fill, as indexes into S.items, from the last back */
    function insertAt() {
      const n = S.items.length, w = where();
      if (w === 'start') return [0];
      if (w === 'end') return [n];
      const pages = window.ADDPDFEngine.parseRanges($('blankPages').value, n);
      const after = $('blankPos').value === 'after';
      const seen = {};
      return pages.filter(function (p) { return p >= 1 && p <= n; })
        .map(function (p) { return after ? p : p - 1; })
        .filter(function (i) { if (seen[i]) return false; seen[i] = 1; return true; })
        .sort(function (a, b) { return b - a; });
    }

    async function addBlankPages() {
      const it = S.items[S.current - 1];
      if (!it) { X.toast('Open a PDF first'); return false; }
      await X.ensurePage(it);
      const wmm = parseFloat($('blankW').value), hmm = parseFloat($('blankH').value);
      if (!(wmm >= 10 && hmm >= 10 && wmm <= 5000 && hmm <= 5000)) { $('blankNote').textContent = 'Width and height: 10 to 5000 mm.'; return false; }
      const gaps = insertAt();
      if (!gaps.length) { $('blankNote').textContent = 'Type page numbers that are in this document, like 1,8,1-10.'; return false; }
      /* as many as asked for; a cap only stops a typo (50000) freezing the tab */
      const asked = Math.max(1, parseInt($('blankQty').value, 10) || 1);
      const qty = Math.min(BLANK_MAX, asked);
      const w = wmm * MM, h = hmm * MM;
      const color = blankColor();
      const fill = color.toUpperCase() === '#FFFFFF' ? null : X.hexRgb(color);

      const d = await PDFLib.PDFDocument.create();
      for (let i = 0; i < qty; i++) {
        const page = d.addPage([w, h]);
        if (fill) page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: fill });
      }
      const bytes = await d.save();
      const src = await X.addSource('Blank page', bytes, true, true);

      X.snapshot();
      gaps.forEach(function (at) {
        const add = [];
        for (let i = 0; i < qty; i++) add.push(X.newItem(src, i + 1, 0, true));
        S.items.splice.apply(S.items, [at, 0].concat(add));
      });
      X.invalidateSearch();
      await X.syncAll();
      const first = gaps[gaps.length - 1];
      X.goTo(Math.min(S.items.length, first + 1));
      const total = qty * gaps.length;
      X.toast((total > 1 ? total + ' blank pages added' : 'Blank page added') +
        (asked > qty ? ' · at most ' + BLANK_MAX + ' at a time' : ''));
      return true;
    }

    X.openBlankPageDialog = function () {
      paintBlankColors();
      fillSizes();
      $('blankSize').value = 'default';
      applySize();
      $('blankQty').value = '1';
      $('blankPages').value = String(S.current || 1);
      $('blankOf').textContent = '/' + S.items.length;
      $('blankPos').value = 'after';
      document.querySelector('input[name="blankWhere"][value="pages"]').checked = true;
      $('blankNote').textContent = '';
      X.openPop ? X.openPop('blankPop', $('btnAdd')) : ($('blankPop').hidden = false);
    };
    $('btnAdd') && X.registerPop && X.registerPop('blankPop', 'btnAdd');
    $('blankCancel').addEventListener('click', function () { X.closePops(); });
    $('blankX').addEventListener('click', function () { X.closePops(); });
    $('blankGo').addEventListener('click', async function () {
      if (await addBlankPages()) X.closePops();
    });
    ['blankW', 'blankH', 'blankQty', 'blankPages'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') $('blankGo').click();
      });
    });

    /* ================= copy / paste for selected marks ================= */

    let clipboard = null;   /* { shapes: [...] } | null */

    /* every kind of point a mark can carry, offset the same way moveShape
       does for a drag — so a pasted text keeps its background patch aligned,
       and a future multi-point mark (e.g. Leader) moves as one piece too */
    function nudgeShape(s, dx, dy) {
      if (s.a) s.a = [s.a[0] + dx, s.a[1] + dy];
      if (s.b) s.b = [s.b[0] + dx, s.b[1] + dy];
      if (s.m) s.m = [s.m[0] + dx, s.m[1] + dy];
      if (s.patch) s.patch = Object.assign({}, s.patch, { x: s.patch.x + dx, y: s.patch.y + dy });
      if (s.pts) s.pts = s.pts.map(function (q) { return [q[0] + dx, q[1] + dy]; });
    }
    function freshId(t) { return (t || 'mk') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      if (S.tool !== 'select' || S.editing) return;
      const el = e.target;
      if (el && el.matches && el.matches('input,textarea,select,[contenteditable]')) return;

      if (key === 'c') {
        const it = S.sel && S.sel.it;
        if (!it) return;
        const idx = X.selList();
        const shapes = idx.map(function (i) { return it.shapes[i]; })
          .filter(function (s) { return s && s.t !== 'pin'; });
        if (!shapes.length) return;
        clipboard = { shapes: JSON.parse(JSON.stringify(shapes)) };
        X.toast(shapes.length > 1 ? (shapes.length + ' marks copied') : 'Mark copied');
      } else {
        if (!clipboard || !clipboard.shapes.length) return;
        const target = (S.sel && S.sel.it) || S.items[S.current - 1];
        if (!target) return;
        e.preventDefault();
        X.snapshot();
        const startLen = target.shapes.length;
        clipboard.shapes.forEach(function (s0) {
          const s = JSON.parse(JSON.stringify(s0));
          if (s.id) s.id = freshId(s.t);
          nudgeShape(s, 14, 14);
          target.shapes.push(s);
        });
        const pasted = [];
        for (let i = startLen; i < target.shapes.length; i++) pasted.push(i);
        X.setGroup(target, pasted);
        X.drawShapes(target); X.drawThumb(target); X.updateMeta();
        X.toast(pasted.length > 1 ? (pasted.length + ' marks pasted') : 'Mark pasted');
      }
    });

    /* ================= Leader marks ================= */
    /* Arrowhead (or dot) at the tip, a diagonal leader line, then a
       horizontal landing line — a callout, not a rectangle, so it gets its
       own three point-handles rather than the generic box corners. The tool
       that drew them is gone; documents that already have one still show
       and edit it. */

    function leaderPoly(a, m, b, wScreen) {
      const wing = X.arrowHead(m[0], m[1], a[0], a[1], wScreen);
      return wing;
    }
    X.shapeRenderers.leader = function (it, s, vp, idx) {
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const m = vp.convertToViewportPoint(s.m[0], s.m[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      const selected = idx >= 0 && S.sel && S.sel.it === it && S.sel.i === idx;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'ins-mk');
      const sw = Math.max(0.6, (s.w || 1.2) * S.scale);
      function seg(p0, p1) {
        const l = document.createElementNS(SVGNS, 'line');
        l.setAttribute('x1', p0[0]); l.setAttribute('y1', p0[1]);
        l.setAttribute('x2', p1[0]); l.setAttribute('y2', p1[1]);
        l.style.stroke = s.c; l.style.strokeWidth = sw; l.style.strokeLinecap = 'round';
        l.style.pointerEvents = 'stroke'; l.style.cursor = 'move';
        g.appendChild(l);
      }
      seg(a, m); seg(m, b);
      if (s.head === 'dot') {
        const dot = document.createElementNS(SVGNS, 'circle');
        dot.setAttribute('cx', a[0]); dot.setAttribute('cy', a[1]); dot.setAttribute('r', Math.max(2.5, sw * 1.6));
        dot.setAttribute('fill', s.c);
        g.appendChild(dot);
      } else {
        const wing = leaderPoly(a, m, b, sw);
        const tri = document.createElementNS(SVGNS, 'polygon');
        tri.setAttribute('points', wing[0][0] + ',' + wing[0][1] + ' ' + a[0] + ',' + a[1] + ' ' + wing[1][0] + ',' + wing[1][1]);
        tri.setAttribute('fill', s.c);
        g.appendChild(tri);
      }
      /* the whole mark drags as one piece from either segment, via the same
         generic move core.js already gives every a/b(/m) mark */
      if (idx >= 0) {
        g.addEventListener('pointerdown', function (e) {
          if (e.target.tagName === 'line') X.beginDrag(it, idx, e, 'move');
        });
      }
      if (selected) {
        function knob(p, onDrag) {
          const k = document.createElementNS(SVGNS, 'circle');
          k.setAttribute('cx', p[0]); k.setAttribute('cy', p[1]); k.setAttribute('r', 5);
          k.setAttribute('class', 'kn'); k.style.cursor = 'pointer'; k.style.pointerEvents = 'all';
          k.addEventListener('pointerdown', function (e) {
            e.stopPropagation(); e.preventDefault();
            let moved = false;
            function move(ev) {
              moved = true;
              /* .capture is hidden in Select mode, where these knobs live —
                 .anno (already inside the crop-shifted .inner) is the one
                 that's actually laid out then */
              const r = it.anno.getBoundingClientRect();
              const p2 = it.vp.convertToPdfPoint(ev.clientX - r.left, ev.clientY - r.top);
              onDrag(p2);
              X.drawShapes(it);
            }
            function up() {
              document.removeEventListener('pointermove', move);
              document.removeEventListener('pointerup', up);
              if (moved) { X.updateMeta(); X.drawThumb(it); }
            }
            X.snapshot();
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
          });
          g.appendChild(k);
        }
        knob(a, function (p2) { s.a = p2; });
        knob(m, function (p2) { s.m = p2; });
        knob(b, function (p2) { s.b = [p2[0], s.m[1]]; });   /* the landing line stays level */
      }
      return g;
    };

    /* head-style toggle on the properties popover, the same extension point
       Insert's image Crop button uses */
    (function () {
      const el = document.createElement('div');
      el.innerHTML =
        '<div class="row" style="gap:6px"><button class="btn" id="mpLeaderArrow" style="flex:1">Arrow</button>' +
        '<button class="btn" id="mpLeaderDot" style="flex:1">Dot</button></div>';
      X.markPop.leader = {
        el: el,
        sync: function (s) {
          el.querySelector('#mpLeaderArrow').classList.toggle('on', s.head !== 'dot');
          el.querySelector('#mpLeaderDot').classList.toggle('on', s.head === 'dot');
        }
      };
      function setHead(v) {
        if (!S.sel) return;
        const s = S.sel.it.shapes[S.sel.i];
        if (!s || s.t !== 'leader') return;
        X.snapshot(); s.head = v;
        X.drawShapes(S.sel.it); X.drawThumb(S.sel.it); X.updateMeta();
      }
      el.querySelector('#mpLeaderArrow').addEventListener('click', function (e) { e.stopPropagation(); setHead('arrow'); });
      el.querySelector('#mpLeaderDot').addEventListener('click', function (e) { e.stopPropagation(); setHead('dot'); });
    })();

  });
})();
