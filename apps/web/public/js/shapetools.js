/* Add Dots PDF — Rounded Rectangle, Polygon, Star and Spiral
   ---------------------------------------------------------
   The shape tools the Rectangle and Ellipse did not already cover, as
   Illustrator draws them, in its Rectangle tool group (js/toolgroups.js):

   Rounded Rectangle  corner to corner, as the Rectangle (it is one: core's
                      'rect' with its corners rounded, s.rr), with its own
                      radius, kept; ↑ ↓ round the corners while drawing,
                      ← squares them, → rounds them fully.
   Polygon            dragged out from its centre, a corner following the
                      pointer (Shift: upright); ↑ ↓ add or take a side.
   Star               the same, its points and how deep they go (the inner
                      radius, as a share of the outer); ↑ ↓ a point more or less.
   Spiral             from its centre out to the pointer, in quarter turns
                      each smaller by the decay; ↑ ↓ a turn more or less.

   Each makes a mark the app already has — a 'rect', or a 'pen' path — so
   selecting, the bounding box, Direct Selection, the Properties panel,
   layers, undo, Save and the thumbnails are the ones every shape uses. The
   drag, snapping, Space to move, Esc and a click to type the size are the
   Rectangle tool's own (X.drawKit, js/draw.js). A new shape takes the
   Rectangle tool's look (fill, stroke, dash, opacity) and the colour and
   width in hand. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[shapetools] core bridge missing'); return; }
  const E = window.ADDPDFEngine;

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const K = X.drawKit;
    if (!K || !X.tools) { console.error('[shapetools] draw.js kit missing'); return; }

    /* ---------------- what each tool keeps between uses ---------------- */

    const KEY = 'adpdf.shapeTools';
    const DEF = { rr: 12, sides: 6, points: 5, inner: 50, decay: 80, segs: 10, ccw: true,
                  rrWH: [72, 48], polyR: 36, starR: [36, 18], spiralR: 36 };
    const opt = (function () {
      try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); }
      catch (e) { return Object.assign({}, DEF); }
    })();
    function keep() { try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch (e) { /* this session only */ } }
    const clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    const r2 = K.rr2;

    /* ---------------- the geometry, as Pen paths ---------------- */

    /** a closed path through the corners, straight between them */
    function closedPath(V) {
      const pts = [V[0].slice()];
      for (let i = 1; i <= V.length; i++) {
        const p = V[(i - 1) % V.length], q = V[i % V.length];
        pts.push(p.slice(), q.slice(), q.slice());
      }
      return pts;
    }
    function ring(c, n, radius, rot) {
      const V = [];
      for (let i = 0; i < n; i++) {
        const t = rot + i * 2 * Math.PI / n;
        V.push([c[0] + radius(i) * Math.cos(t), c[1] + radius(i) * Math.sin(t)]);
      }
      return V;
    }
    function polygonPts(c, R, n, rot) { return closedPath(ring(c, n, function () { return R; }, rot)); }
    function starPts(c, R, n, inner, rot) {
      return closedPath(ring(c, n * 2, function (i) { return i % 2 ? R * inner : R; }, rot));
    }
    /** a spiral from R at angle rot, in n quarter turns, each decay times the
        last, as Bézier quarters along the curve's own tangent */
    function spiralPts(c, R, n, decay, rot, ccw) {
      const q = Math.PI / 2, dir = ccw ? 1 : -1, k = Math.log(decay) / q;
      const at = function (j) {
        const t = rot + dir * j * q, rho = R * Math.pow(decay, j);
        const cs = Math.cos(t), sn = Math.sin(t);
        /* dP/dθ, for the handles a third of the way along */
        const dx = (rho * k * cs - rho * sn) * dir, dy = (rho * k * sn + rho * cs) * dir;
        return { p: [c[0] + rho * cs, c[1] + rho * sn], d: [dx * q / 3, dy * q / 3] };
      };
      let prev = at(0);
      const pts = [prev.p];
      for (let j = 1; j <= n; j++) {
        const cur = at(j);
        pts.push([prev.p[0] + prev.d[0], prev.p[1] + prev.d[1]], [cur.p[0] - cur.d[0], cur.p[1] - cur.d[1]], cur.p);
        prev = cur;
      }
      return pts;
    }
    function bbox(pts) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      pts.forEach(function (p) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); });
      return { a: [x1, y1], b: [x2, y2] };
    }
    function penMark(pts, open) {
      const m = K.look({ t: 'pen', pts: pts.map(function (p) { return [r2(p[0]), r2(p[1])]; }), c: S.color, w: S.width });
      if (open) { m.open = true; delete m.fill; }
      return m;
    }

    /** a drag from the centre: the radius to the pointer, and the angle a
        corner sits at (Shift: straight up, as the page is seen) */
    function radial(d) {
      const R = Math.hypot(d.p[0] - d.a[0], d.p[1] - d.a[1]);
      let rot = Math.atan2(d.p[1] - d.a[1], d.p[0] - d.a[0]);
      if (d.shift) rot = upright(d.it, d.a);
      return { c: d.a, R: R, rot: rot };
    }
    /** "up" on the screen at c, as an angle on the page (whatever its turn) */
    function upright(it, c) {
      if (!it || !it.vp) return Math.PI / 2;
      const v = it.vp.convertToViewportPoint(c[0], c[1]);
      const q = it.vp.convertToPdfPoint(v[0], v[1] - 10);
      return Math.atan2(q[1] - c[1], q[0] - c[0]);
    }
    const tinyPath = function (m) { const b = bbox(m.pts); return b.b[0] - b.a[0] < 0.5 && b.b[1] - b.a[1] < 0.5; };
    function readPath(extra) {
      return function (it, m, p) { K.readBox(it, bbox(m.pts), p, extra()); };
    }

    /* ---------------- the tools ---------------- */

    /** ↑ ↓ step a count while drawing */
    function stepper(get, set, lo, hi, sync) {
      return function (e, down) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        if (!down) return true;
        set(clamp(get() + (e.key === 'ArrowUp' ? 1 : -1), lo, hi));
        keep(); sync();
        return true;
      };
    }

    /** Illustrator's dialog at a click: the numbers, then the shape there */
    function ask(title, fields, make) {
      return function (it, at) {
        X.dialog({
          title: title, ok: 'OK', width: 360,
          body: fields.map(function (f) {
            return '<div class="wdrow ellwh"><label class="wdlabel" for="' + f.id + '">' + f.label + '</label>' +
              '<span class="unit"><input class="wdin" id="' + f.id + '" inputmode="decimal" value="' + f.value() + '">' +
              (f.unit ? '<em>' + f.unit + '</em>' : '') + '</span></div>';
          }).join(''),
          value: function (box) {
            const v = {};
            for (let i = 0; i < fields.length; i++) {
              const f = fields[i];
              const n = parseFloat(String(box.querySelector('#' + f.id).value).replace(',', '.'));
              if (!(n >= f.min && n <= f.max)) return { error: f.label + ': from ' + f.min + ' to ' + f.max, field: '#' + f.id };
              v[f.key] = f.int ? Math.round(n) : n;
            }
            return v;
          }
        }).then(function (v) {
          if (!v) return;
          const m = make(it, at, v);
          keep(); syncAll();
          X.snapshot();
          it.shapes.push(m);
          X.drawShapes(it); X.drawThumb(it); X.updateMeta();
        });
      };
    }

    X.tools.rrect = K.boxTool({
      t: 'rrect', label: 'Rounded Rectangle',
      mark: function (g, d) { return K.rectMark(g.a, g.b, d && d.rr != null ? d.rr : opt.rr); },
      read: function (it, m, p) { K.readBox(it, m, p, 'R ' + r2(m.rr ? E.rectRadii(m)[0] : 0)); },
      key: function (e, down, d) {
        if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return false;
        if (!down) return true;
        const g = { a: [Math.min(d.a[0], d.p[0]), Math.min(d.a[1], d.p[1])], b: [Math.max(d.a[0], d.p[0]), Math.max(d.a[1], d.p[1])] };
        const max = E.rectMaxRadius ? E.rectMaxRadius(g) : 10000;
        let r = Math.min(d.rr != null ? d.rr : opt.rr, max);
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') r = Math.min(max, r + step);
        else if (e.key === 'ArrowDown') r = Math.max(0, r - step);
        else if (e.key === 'ArrowLeft') r = 0;
        else r = max;
        d.rr = r2(r); opt.rr = d.rr; keep(); syncAll();
        return true;
      },
      ask: ask('Rounded Rectangle', [
        { id: 'stW', key: 'w', label: 'Width', unit: 'pt', min: 0.1, max: 20000, value: function () { return opt.rrWH[0]; } },
        { id: 'stH', key: 'h', label: 'Height', unit: 'pt', min: 0.1, max: 20000, value: function () { return opt.rrWH[1]; } },
        { id: 'stR', key: 'r', label: 'Corner radius', unit: 'pt', min: 0, max: 10000, value: function () { return opt.rr; } }
      ], function (it, at, v) {
        opt.rrWH = [v.w, v.h]; opt.rr = v.r;
        const g = K.boxAtClick(it, at, false, v.w, v.h);
        return K.rectMark(g.a, g.b, v.r);
      })
    });

    X.tools.polygon = K.boxTool({
      t: 'polygon', label: 'Polygon',
      mark: function (g, d) { const q = radial(d); return penMark(polygonPts(q.c, q.R, opt.sides, q.rot)); },
      tiny: tinyPath,
      read: readPath(function () { return 'Sides ' + opt.sides; }),
      key: stepper(function () { return opt.sides; }, function (v) { opt.sides = v; }, 3, 100, function () { syncAll(); }),
      ask: ask('Polygon', [
        { id: 'stR', key: 'r', label: 'Radius', unit: 'pt', min: 0.1, max: 10000, value: function () { return opt.polyR; } },
        { id: 'stN', key: 'n', label: 'Sides', min: 3, max: 100, int: true, value: function () { return opt.sides; } }
      ], function (it, at, v) {
        opt.polyR = v.r; opt.sides = v.n;
        return penMark(polygonPts(at, v.r, v.n, upright(it, at)));
      })
    });

    X.tools.star = K.boxTool({
      t: 'star', label: 'Star',
      mark: function (g, d) { const q = radial(d); return penMark(starPts(q.c, q.R, opt.points, opt.inner / 100, q.rot)); },
      tiny: tinyPath,
      read: readPath(function () { return 'Points ' + opt.points; }),
      key: stepper(function () { return opt.points; }, function (v) { opt.points = v; }, 3, 100, function () { syncAll(); }),
      ask: ask('Star', [
        { id: 'stR1', key: 'r1', label: 'Radius 1', unit: 'pt', min: 0.1, max: 10000, value: function () { return opt.starR[0]; } },
        { id: 'stR2', key: 'r2', label: 'Radius 2', unit: 'pt', min: 0.1, max: 10000, value: function () { return opt.starR[1]; } },
        { id: 'stN', key: 'n', label: 'Points', min: 3, max: 100, int: true, value: function () { return opt.points; } }
      ], function (it, at, v) {
        const R = Math.max(v.r1, v.r2), r = Math.min(v.r1, v.r2);
        opt.starR = [v.r1, v.r2]; opt.points = v.n; opt.inner = Math.round(r / R * 100);
        return penMark(starPts(at, R, v.n, r / R, upright(it, at)));
      })
    });

    X.tools.spiral = K.boxTool({
      t: 'spiral', label: 'Spiral',
      mark: function (g, d) {
        const q = radial(d);
        return penMark(spiralPts(q.c, q.R, opt.segs, opt.decay / 100, q.rot, opt.ccw), true);
      },
      tiny: tinyPath,
      read: readPath(function () { return 'Segments ' + opt.segs; }),
      key: stepper(function () { return opt.segs; }, function (v) { opt.segs = v; }, 2, 200, function () { syncAll(); }),
      ask: ask('Spiral', [
        { id: 'stR', key: 'r', label: 'Radius', unit: 'pt', min: 0.1, max: 10000, value: function () { return opt.spiralR; } },
        { id: 'stD', key: 'd', label: 'Decay', unit: '%', min: 5, max: 99, value: function () { return opt.decay; } },
        { id: 'stN', key: 'n', label: 'Segments', min: 2, max: 200, int: true, value: function () { return opt.segs; } }
      ], function (it, at, v) {
        opt.spiralR = v.r; opt.decay = v.d; opt.segs = v.n;
        return penMark(spiralPts(at, v.r, v.n, v.d / 100, upright(it, at), opt.ccw), true);
      })
    });

    /* ---------------- each tool's bar: the numbers its next shape takes ---------------- */

    const num = function (id, label, min, max, unit, title) {
      return '<span class="anno-lbl"' + (title ? ' title="' + title + '"' : '') + '>' + label + '</span>' +
        '<input type="number" id="' + id + '" min="' + min + '" max="' + max + '" step="1" aria-label="' + label + '">' +
        (unit ? '<span class="anno-lbl">' + unit + '</span>' : '');
    };
    const BARS = {
      rrect: K.ctl('rrectCtl', num('rrectRad', 'Corners', 0, 10000, 'pt', 'Corner radius: ↑ and ↓ change it while drawing')),
      polygon: K.ctl('polygonCtl', num('polySides', 'Sides', 3, 100, '', '↑ and ↓ add or take a side while drawing')),
      star: K.ctl('starCtl', num('starPoints', 'Points', 3, 100, '', '↑ and ↓ add or take a point while drawing') +
        num('starInner', 'Inner radius', 5, 95, '%', 'How deep the points go: the inner radius as a share of the outer')),
      spiral: K.ctl('spiralCtl', num('spiralDecay', 'Decay', 5, 99, '%', 'Each quarter turn this share of the one before') +
        num('spiralSegs', 'Segments', 2, 200, '', '↑ and ↓ a quarter turn more or less while drawing') +
        '<select id="spiralDir" aria-label="Direction"><option value="ccw">Anticlockwise</option><option value="cw">Clockwise</option></select>')
    };
    const FIELDS = {
      rrectRad: ['rr', 0, 10000], polySides: ['sides', 3, 100], starPoints: ['points', 3, 100],
      starInner: ['inner', 5, 95], spiralDecay: ['decay', 5, 99], spiralSegs: ['segs', 2, 200]
    };
    function syncAll() {
      Object.keys(FIELDS).forEach(function (id) {
        const el = $(id);
        if (el && document.activeElement !== el) el.value = opt[FIELDS[id][0]];
      });
      if ($('spiralDir')) $('spiralDir').value = opt.ccw ? 'ccw' : 'cw';
    }
    Object.keys(BARS).forEach(function (t) {
      BARS[t].addEventListener('change', function (e) {
        const f = FIELDS[e.target.id];
        if (f) {
          const v = parseFloat(e.target.value);
          if (isFinite(v)) opt[f[0]] = f[0] === 'rr' ? r2(clamp(v, f[1], f[2])) : Math.round(clamp(v, f[1], f[2]));
        } else if (e.target.id === 'spiralDir') opt.ccw = e.target.value === 'ccw';
        keep(); syncAll();
      });
    });
    X.on('tool', function (t) {
      Object.keys(BARS).forEach(function (k) { BARS[k].hidden = k !== t; });
      if (BARS[t]) syncAll();
    });
    syncAll();

    /* ---------------- the buttons, beside the Rectangle on Draw ---------------- */

    const TOOLS = [
      { t: 'rrect', id: 'tRRect', label: 'Rounded Rectangle',
        hint: 'Drag from corner to corner. <b>↑ ↓</b> round the corners while drawing, <b>←</b> squares them, <b>→</b> rounds them fully. ' +
              '<b>Shift</b> a square, <b>Alt</b> from the centre. A click asks for the size.',
        path: '<rect x="3.5" y="5.5" width="17" height="13" rx="4.5"/>' },
      { t: 'polygon', id: 'tPolygon', label: 'Polygon',
        hint: 'Drag out from the <b>centre</b>; a corner follows the pointer. <b>↑ ↓</b> add or take a side, <b>Shift</b> keeps it upright. ' +
              'A click asks for the radius and sides.',
        path: '<polygon points="12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5"/>' },
      { t: 'star', id: 'tStar', label: 'Star',
        hint: 'Drag out from the <b>centre</b>. <b>↑ ↓</b> add or take a point, <b>Shift</b> keeps it upright; the bar sets how deep the points go. ' +
              'A click asks for the two radii and the points.',
        path: '<polygon points="12 3 14.6 9.2 21.2 9.6 16.1 13.8 17.7 20.3 12 16.8 6.3 20.3 7.9 13.8 2.8 9.6 9.4 9.2"/>' },
      { t: 'spiral', id: 'tSpiral', label: 'Spiral',
        hint: 'Drag out from the <b>centre</b> to where it starts. <b>↑ ↓</b> a quarter turn more or less; the bar sets the decay and the direction. ' +
              'A click asks for the radius, decay and segments.',
        path: '<path d="M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0a7.5 7.5 0 0 1 15 0"/>' }
    ];
    const home = $('grpTools');
    TOOLS.forEach(function (T) {
      X.hints[T.t] = T.hint;
      X.toolBtn[T.t] = T.id;
      if (!home || $(T.id)) return;
      const b = document.createElement('button');
      b.className = 'btn'; b.id = T.id; b.type = 'button';
      b.title = T.label;
      b.setAttribute('aria-label', T.label);
      b.dataset.label = T.label;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + T.path + '</svg>';
      b.addEventListener('click', function () { X.toggleTool(T.t); });
      home.appendChild(b);
    });

    /* for the tests */
    X.shapeTools = { opt: opt, polygonPts: polygonPts, starPts: starPts, spiralPts: spiralPts };
  });
})();
