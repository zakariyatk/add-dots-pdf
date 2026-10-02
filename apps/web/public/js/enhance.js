/* ADD DOTS PDF — Round 2 enhancements
   ------------------------------------
   Everything from the second feedback pass that isn't a new Insert-tab mark
   (those extend js/insert.js instead): the blank-page dialog, copy/paste for
   selected marks, text-box polish (double-click to edit, alignment,
   background fill), and the Leader tool. Same plugin pattern as every other
   module — reaches the rest of the app only through window.ADDPDF. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[enhance] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, PDFLib = X.PDFLib, SVGNS = X.SVGNS;

    /* ================= blank page dialog ================= */

    const MM = 72 / 25.4;
    const SIZES = {
      a4: [210 * MM, 297 * MM],
      letter: [215.9 * MM, 279.4 * MM],
      a3: [297 * MM, 420 * MM]
    };
    let blankOrient = 'p';
    const BLANK_COLORS = ['#FFFFFF', '#F5F5F0', '#FDF6E3', '#EAF2FF', '#111214'];

    function paintBlankColors() {
      const host = $('blankColors');
      host.innerHTML = '';
      BLANK_COLORS.forEach(function (c, i) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sw' + (i === 0 ? ' on' : '');
        b.style.cssText = 'width:26px;height:26px;border-radius:6px;border:1px solid var(--line);background:' + c;
        b.dataset.c = c;
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

    $('blankSize').addEventListener('change', function () {
      $('blankCustomRow').hidden = this.value !== 'custom';
    });
    function setOrient(o) {
      blankOrient = o;
      $('blankPortrait').classList.toggle('primary', o === 'p');
      $('blankLandscape').classList.toggle('primary', o === 'l');
    }
    $('blankPortrait').addEventListener('click', function () { setOrient('p'); });
    $('blankLandscape').addEventListener('click', function () { setOrient('l'); });

    function currentPageSize() {
      const it = S.items[S.current - 1];
      if (!it || !it.page) return [612, 792];
      const v = it.page.view;
      return [v[2] - v[0], v[3] - v[1]];
    }

    function blankPageSize() {
      let wh;
      const choice = $('blankSize').value;
      if (choice === 'same') wh = currentPageSize();
      else if (choice === 'custom') {
        const w = parseFloat($('blankW').value) || 210, h = parseFloat($('blankH').value) || 297;
        wh = [w * MM, h * MM];
      } else wh = SIZES[choice] || SIZES.a4;
      let [w, h] = wh;
      if (blankOrient === 'l' && w < h) { const t = w; w = h; h = t; }
      if (blankOrient === 'p' && w > h) { const t = w; w = h; h = t; }
      return [w, h];
    }

    async function addBlankPages() {
      const it = S.items[S.current - 1];
      if (!it) { X.toast('Open a PDF first'); return; }
      await X.ensurePage(it);
      const [w, h] = blankPageSize();
      const qty = Math.max(1, Math.min(50, parseInt($('blankQty').value, 10) || 1));
      const color = blankColor();
      const fill = color.toUpperCase() === '#FFFFFF' ? null : X.hexRgb(color);

      const d = await PDFLib.PDFDocument.create();
      for (let i = 0; i < qty; i++) {
        const page = d.addPage([w, h]);
        if (fill) page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: fill });
      }
      const bytes = await d.save();
      const doc = await X.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

      X.snapshot();
      const src = { id: 'blank' + Date.now().toString(36), name: 'Blank page', bytes: bytes, doc: doc, synthetic: true };
      S.sources.push(src);
      for (let i = 0; i < qty; i++) S.items.splice(S.current + i, 0, X.newItem(src, i + 1, 0, true));
      await X.syncAll();
      X.goTo(S.current + 1);
      X.toast(qty > 1 ? (qty + ' blank pages added') : 'Blank page added');
    }

    $('btnAdd') && X.registerPop && X.registerPop('blankPop', 'btnAdd');
    X.openBlankPageDialog = function () {
      paintBlankColors();
      setOrient('p');
      $('blankQty').value = '1';
      $('blankSize').value = 'same';
      $('blankCustomRow').hidden = true;
      X.openPop ? X.openPop('blankPop', $('btnAdd')) : ($('blankPop').hidden = false);
    };
    $('blankCancel').addEventListener('click', function () { X.closePops(); });
    $('blankGo').addEventListener('click', function () {
      X.closePops();
      addBlankPages();
    });
    ['blankW', 'blankH', 'blankQty'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { e.stopPropagation(); });
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

    /* ================= Leader tool ================= */
    /* Arrowhead (or dot) at the tip, a diagonal leader line, then a
       horizontal landing line — a callout, not a rectangle, so it gets its
       own three point-handles rather than the generic box corners. */

    let leaderHead = 'arrow';

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
    function leaderGhost(a, m, b) { return { t: 'leader', a: a, m: m, b: b, c: S.color, w: S.width, head: leaderHead }; }
    function commitLeader(it, a, m, b) {
      X.snapshot();
      it.shapes.push({ t: 'leader', id: freshId('ldr'), a: a, m: m, b: b, c: S.color, w: S.width, head: leaderHead });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.toast('Leader placed');
    }

    let leaderPick = null;   /* {it, stage, a, m} — stage: dragFirst | waitSecond | dragSecond */
    X.hints.leader = 'Drag from the point to the elbow, then drag the landing line.';
    X.tools.leader = {
      colors: true, widths: true,
      down: function (it, at) {
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!leaderPick || leaderPick.it !== it) leaderPick = { it: it, stage: 'dragFirst' };
        if (leaderPick.stage === 'dragFirst') leaderPick.a = p;
        else if (leaderPick.stage === 'waitSecond') leaderPick.stage = 'dragSecond';
      },
      move: function (it, at, e) {
        if (!leaderPick || leaderPick.it !== it) return;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        if (leaderPick.stage === 'dragFirst' && leaderPick.a) {
          X.drawShapes(it, leaderGhost(leaderPick.a, p, p));
        } else if (leaderPick.stage === 'waitSecond') {
          X.drawShapes(it, leaderGhost(leaderPick.a, leaderPick.m, leaderPick.m));
        } else if (leaderPick.stage === 'dragSecond') {
          const b = (e && e.shiftKey) ? p : [p[0], leaderPick.m[1]];
          X.drawShapes(it, leaderGhost(leaderPick.a, leaderPick.m, b));
        }
      },
      up: function (it, at, e) {
        if (!leaderPick || leaderPick.it !== it) return;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        if (leaderPick.stage === 'dragFirst') {
          if (Math.hypot(p[0] - leaderPick.a[0], p[1] - leaderPick.a[1]) < 2) { leaderPick = null; X.drawShapes(it); return; }
          leaderPick.m = p;
          leaderPick.stage = 'waitSecond';
          X.drawShapes(it, leaderGhost(leaderPick.a, leaderPick.m, leaderPick.m));
          X.toast('Now drag the landing line');
        } else if (leaderPick.stage === 'dragSecond') {
          const b = (e && e.shiftKey) ? p : [p[0], leaderPick.m[1]];
          commitLeader(it, leaderPick.a, leaderPick.m, b);
          leaderPick = null;
        }
      },
      cancel: function () { leaderPick = null; }
    };
    X.on('tool', function (t) { if (t !== 'leader') leaderPick = null; });

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

    $('tLeader') && $('tLeader').addEventListener('click', function () { X.toggleTool('leader'); });
  });
})();
