/* ADD DOTS PDF — Drawing tools
   ----------------------------
   Circle, revision cloud, arc and linear dimension.

   Every one of them is two points — a and b, in PDF points — which is the same
   shape core's own box and line marks take. That is deliberate: selecting,
   moving, resizing and rotating then come straight from core, and so does
   undo, Save, the JPG export and the thumbnails.

   Curves are written into the PDF as short straight segments rather than as
   an SVG path. pdf-lib's path drawing has its own flipped coordinate system
   and its own idea of where the origin sits; approximating a curve the same
   way on screen and on paper is a few more operators but it is exactly right
   in both places, which matters more on a drawing someone builds from. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[draw] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, SVGNS = X.SVGNS, PDFLib = X.PDFLib;

    /* ---------------- geometry ---------------- */

    function box(s) {
      return {
        x1: Math.min(s.a[0], s.b[0]), y1: Math.min(s.a[1], s.b[1]),
        x2: Math.max(s.a[0], s.b[0]), y2: Math.max(s.a[1], s.b[1])
      };
    }

    /** An ellipse as a ring of points, in PDF space, turned by s.r. */
    function ellipsePts(s, steps) {
      const b = box(s);
      const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      const rx = (b.x2 - b.x1) / 2, ry = (b.y2 - b.y1) / 2;
      const out = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const p = [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
        out.push(s.r ? X.rotPt(p, [cx, cy], s.r) : p);
      }
      return out;
    }

    /**
     * A circular arc through a and b, bulging by `bulge` of the chord length.
     * Returned as points so the screen and the PDF draw the identical curve.
     */
    function arcPts(s, steps) {
      const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
      const dx = bx - ax, dy = by - ay;
      const chord = Math.hypot(dx, dy);
      const k = s.bulge == null ? 0.25 : s.bulge;
      const h = chord * k;                       /* sagitta */
      if (chord < 0.01) return [[ax, ay], [bx, by]];
      if (Math.abs(h) < 0.01) return [[ax, ay], [bx, by]];

      /* unit normal to the chord — which side it bulges */
      const nx = -dy / chord, ny = dx / chord;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const peak = [mx + nx * h, my + ny * h];

      /* circle through a, peak, b: R from chord and sagitta */
      const R = (Math.abs(h) / 2) + (chord * chord) / (8 * Math.abs(h));
      const sign = h >= 0 ? 1 : -1;
      const cxc = mx + nx * (h - sign * R);
      const cyc = my + ny * (h - sign * R);

      let a0 = Math.atan2(ay - cyc, ax - cxc);
      let a1 = Math.atan2(by - cyc, bx - cxc);
      const ap = Math.atan2(peak[1] - cyc, peak[0] - cxc);

      /* walk the way round that actually passes through the peak */
      const norm = function (t) { while (t < 0) t += Math.PI * 2; while (t >= Math.PI * 2) t -= Math.PI * 2; return t; };
      let sweep = norm(a1 - a0);
      const toPeak = norm(ap - a0);
      if (toPeak > sweep) sweep -= Math.PI * 2;

      const out = [];
      for (let i = 0; i <= steps; i++) {
        const t = a0 + sweep * (i / steps);
        out.push([cxc + R * Math.cos(t), cyc + R * Math.sin(t)]);
      }
      return out;
    }

    /**
     * A revision cloud: the box perimeter walked with semicircular bumps
     * pushed outward. The scallop size is kept honest across a long edge by
     * dividing the edge evenly rather than leaving a stub at the end.
     */
    function cloudPts(s, perBump) {
      const b = box(s);
      const r = Math.max(4, s.arc == null ? 9 : s.arc);
      const corners = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
      const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      const out = [];

      for (let e = 0; e < 4; e++) {
        const p0 = corners[e], p1 = corners[(e + 1) % 4];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const n = Math.max(1, Math.round(len / (r * 2)));
        const ux = (p1[0] - p0[0]) / len, uy = (p1[1] - p0[1]) / len;
        /* outward normal: the edges run clockwise, so this points away */
        const nx = uy, ny = -ux;
        const step = len / n;

        for (let i = 0; i < n; i++) {
          const s0 = [p0[0] + ux * step * i, p0[1] + uy * step * i];
          const mx = s0[0] + ux * step / 2, my = s0[1] + uy * step / 2;
          const rad = step / 2;
          const peak = [mx + nx * rad, my + ny * rad];
          /* a half turn from s0 to s1, bulging through peak */
          const base = Math.atan2(s0[1] - my, s0[0] - mx);
          const dir = ((peak[0] - mx) * -Math.sin(base) + (peak[1] - my) * Math.cos(base)) >= 0 ? 1 : -1;
          for (let k = 0; k <= perBump; k++) {
            const t = base + dir * Math.PI * (k / perBump);
            out.push([mx + rad * Math.cos(t), my + rad * Math.sin(t)]);
          }
        }
      }
      out.push(out[0]);
      return s.r ? out.map(function (p) { return X.rotPt(p, [cx, cy], s.r); }) : out;
    }

    /* ---------------- measuring ---------------- */

    /* A PDF point is 1/72 inch. A drawing issued at 1:50 is not, which is what
       calibration is for: measure something you know, say what it really is,
       and every dimension after that reads in those units. */
    /* How much of this unit one PDF point covers at 1:1. A point is 1/72in. */
    const UNITS = {
      mm: { label: 'mm', per: 25.4 / 72,   dp: 0 },
      cm: { label: 'cm', per: 2.54 / 72,   dp: 1 },
      m:  { label: 'm',  per: 0.0254 / 72, dp: 3 },
      in: { label: 'in', per: 1 / 72,      dp: 2 },
      pt: { label: 'pt', per: 1,           dp: 0 }
    };

    /* Drawing scales. A plan issued at 1:50 draws a 50mm wall as 1mm of paper,
       so a paper measurement is multiplied by the denominator to read back as
       the real thing. */
    const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

    /* `denom` is the drawing scale and `unit` what to print. `custom` holds a
       points-to-unit factor worked out by calibrating, which overrides both. */
    let scale = { unit: 'mm', denom: 1, custom: null };

    function perPoint() {
      if (scale.custom) return scale.custom;
      return (UNITS[scale.unit] || UNITS.pt).per * scale.denom;
    }

    function measure(s) {
      return measureLen(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]));
    }

    /** A length in PDF points, as the reading for the current scale and unit. */
    function measureLen(d) {
      const v = d * perPoint();
      const u = UNITS[scale.unit] || UNITS.pt;
      /* a calibrated reading has no tidy unit behind it, so take the precision
         from the size of the number instead */
      const dp = scale.custom ? (v < 10 ? 2 : v < 100 ? 1 : 0) : u.dp;
      return v.toFixed(dp) + ' ' + u.label;
    }

    function dimLabel(s) {
      if (s.label != null && s.label !== '') return s.label;
      if (s.t === 'dimr') return 'R' + measureLen(s.rad);
      if (s.t === 'dimd') return 'Ø' + measureLen(s.rad * 2);
      if (s.t === 'dima') {
        const deg = Math.abs(angGeom(s).sweep) * 180 / Math.PI;
        return (Math.abs(deg - Math.round(deg)) < 0.05 ? String(Math.round(deg)) : deg.toFixed(1)) + '°';
      }
      return measure(s);
    }

    /* ---- radius, diameter and angle geometry, all in PDF points ---- */

    /** a: centre, rad: radius, b: where the reading sits. */
    function radGeom(s) {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const d = Math.hypot(dx, dy);
      const u = d > 0.01 ? [dx / d, dy / d] : [1, 0];
      return {
        u: u,
        near: [s.a[0] + u[0] * s.rad, s.a[1] + u[1] * s.rad],
        far: [s.a[0] - u[0] * s.rad, s.a[1] - u[1] * s.rad],
        outside: d > s.rad + 0.5
      };
    }

    function normAng(v) { const T = Math.PI * 2; return ((v % T) + T) % T; }

    /** a: vertex, a1/a2: the two arms' directions, l1/l2: how far along each
        the picks were, b: a point on the arc. The arc takes whichever side of
        the arms b is on — so the same corner can read 60° or 300°. */
    function angGeom(s) {
      const r = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const pa = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      const d = normAng(s.a2 - s.a1);
      return normAng(pa - s.a1) <= d
        ? { r: r, start: s.a1, sweep: d }
        : { r: r, start: s.a2, sweep: Math.PI * 2 - d };
    }
    function angPt(s, ang, r) { return [s.a[0] + Math.cos(ang) * r, s.a[1] + Math.sin(ang) * r]; }
    function arcPtsOf(s, g) {
      const n = Math.max(12, Math.ceil(Math.abs(g.sweep) * 24));
      const out = [];
      for (let i = 0; i <= n; i++) out.push(angPt(s, g.start + g.sweep * i / n, g.r));
      return out;
    }

    /** The circle through three points, or null if they are (near enough) in a line. */
    function circle3(p, q, r) {
      const ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = r[0], cy = r[1];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-6) return null;
      const A = ax * ax + ay * ay, B = bx * bx + by * by, C = cx * cx + cy * cy;
      const ux = (A * (by - cy) + B * (cy - ay) + C * (ay - by)) / d;
      const uy = (A * (cx - bx) + B * (ax - cx) + C * (bx - ax)) / d;
      const rad = Math.hypot(ax - ux, ay - uy);
      return rad > 20000 ? null : { c: [ux, uy], r: rad };
    }

    /* ---------------- toolbar ---------------- */

    const TOOLS = [
      { t: 'ellipse', id: 'tEllipse', label: 'Circle', key: 'C', shift: true,
        hint: 'Drag to draw an ellipse. Hold <b>Shift</b> for a true circle.',
        path: '<ellipse cx="12" cy="12" rx="9" ry="7"/>' },
      { t: 'cloud', id: 'tCloud', label: 'Cloud', key: 'L', shift: true,
        hint: 'Drag a box and it becomes a revision cloud around it. ' +
              'The <b>Scallop</b> control sets how big the bumps are. Hold <b>Shift</b> for a square.',
        path: '<path d="M6.5 18a3.5 3.5 0 0 1-.4-7 4.5 4.5 0 0 1 8.2-2.5A3.5 3.5 0 0 1 19 11a3.5 3.5 0 0 1-.5 7z"/>' },
      { t: 'arc', id: 'tArc', label: 'Arc', key: 'A', shift: true,
        hint: 'Drag from one end to the other. <b>Bulge</b> sets how far it ' +
              'curves, <b>Alt</b> flips which way, and <b>Shift</b> keeps it level, plumb or at 45°.',
        path: '<path d="M3 19a13 13 0 0 1 18-12"/><circle cx="3" cy="19" r="1.6"/><circle cx="21" cy="7" r="1.6"/>' },
      { t: 'dim', id: 'tDim', label: 'Dimension', key: 'D', shift: true,
        hint: 'Drag between the two points you want measured. Set the drawing ' +
              '<b>Scale</b> to match the sheet, or <b>Calibrate</b> against ' +
              'something you already know. Hold <b>Shift</b> to measure level, plumb or at 45°. ' +
              'Double-click a dimension to retype it.',
        path: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="7" x2="3" y2="17"/>' +
              '<line x1="21" y1="7" x2="21" y2="17"/><polyline points="7 9 4 12 7 15"/>' +
              '<polyline points="17 9 20 12 17 15"/>' },
      { t: 'dimc', id: 'tDimC', label: 'Continuous', key: 'Q', shift: true,
        hint: 'Click the first point, then each next point: every click adds a dimension ' +
              'that carries on from the last, in line with the first. <b>Enter</b>, <b>Esc</b>, ' +
              'double-click or right-click ends the chain. Hold <b>Shift</b> to keep the first ' +
              'one level, plumb or at 45°.',
        path: '<line x1="3" y1="6" x2="3" y2="18"/><line x1="12" y1="6" x2="12" y2="18"/>' +
              '<line x1="21" y1="6" x2="21" y2="18"/><line x1="3" y1="11" x2="21" y2="11"/>' +
              '<polyline points="5.6 9.2 3.4 11 5.6 12.8"/><polyline points="9.4 9.2 11.6 11 9.4 12.8"/>' +
              '<polyline points="14.6 9.2 12.4 11 14.6 12.8"/><polyline points="18.4 9.2 20.6 11 18.4 12.8"/>' },
      { t: 'dimr', id: 'tDimR', label: 'Radius', key: null,
        hint: 'Click <b>three points</b> on the edge of a circle or arc, then click where the ' +
              'reading goes. <b>Esc</b> starts again.',
        path: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="12" x2="18" y2="6"/>' +
              '<polyline points="14.9 6.1 18 6 17.9 9.1"/>' +
              '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>' },
      { t: 'dimd', id: 'tDimD', label: 'Diameter', key: null,
        hint: 'Click <b>three points</b> on the edge of a circle or arc, then click where the ' +
              '<b>Ø</b> reading goes. <b>Esc</b> starts again.',
        path: '<circle cx="12" cy="12" r="8.5"/><line x1="5" y1="19" x2="19" y2="5"/>' },
      { t: 'dima', id: 'tDimA', label: 'Angular', key: null,
        hint: 'Click the <b>first line</b>, then the <b>second line</b> — the corner is where they ' +
              'meet. Move to choose the side and size of the arc, and click to place it. ' +
              '<b>Esc</b> starts again.',
        path: '<line x1="3" y1="20" x2="21" y2="20"/><line x1="3" y1="20" x2="14" y2="4"/>' +
              '<path d="M12 20A9 9 0 0 0 8.1 12.6"/>' }
    ];

    const grpTools = $('grpTools');
    TOOLS.forEach(function (T) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = T.id;
      b.title = T.label + (T.key ? ' (' + (T.shift ? 'Shift+' : '') + T.key + ')' : '');
      b.setAttribute('aria-label', T.label);
      b.dataset.label = T.label;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + T.path + '</svg>';
      b.addEventListener('click', function () { X.toggleTool(T.t); });
      grpTools.appendChild(b);
      X.toolBtn[T.t] = T.id;
      X.hints[T.t] = T.hint;
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const hit = TOOLS.filter(function (T) {
        return T.key && T.key.toLowerCase() === k && !!T.shift === !!e.shiftKey;
      })[0];
      if (hit && S.items.length) {
        e.preventDefault();
        X.toggleTool(hit.t);
      }
    });

    /* ---------------- mode-bar controls ---------------- */

    const modeBar = $('modeBar');
    function ctl(id, html) {
      const d = document.createElement('div');
      d.className = 'txctl anno-ctl'; d.id = id; d.hidden = true;
      d.innerHTML = html;
      modeBar.insertBefore(d, $('pinShowList'));
      return d;
    }

    const arcCtl = ctl('arcCtl',
      '<span class="anno-lbl">Bulge</span>' +
      '<select id="arcBulge" aria-label="Arc bulge">' +
      '<option value="0.12">Shallow</option>' +
      '<option value="0.25" selected>Medium</option>' +
      '<option value="0.45">Deep</option>' +
      '<option value="0.65">Half round</option></select>');

    const cloudCtl = ctl('cloudCtl',
      '<span class="anno-lbl">Scallop</span>' +
      '<select id="cloudArc" aria-label="Cloud scallop size">' +
      '<option value="6">Fine</option>' +
      '<option value="9" selected>Medium</option>' +
      '<option value="14">Broad</option></select>');

    /* How a dimension closes its ends: arrowheads (the reading sits on the
       line), architectural ticks, or dots (both with the reading above). */
    const DIM_STYLES = [['arrow', 'Arrow'], ['tick', 'Tick'], ['dot', 'Dot']];
    const STYLE_OPTS = DIM_STYLES.map(function (d) {
      return '<option value="' + d[0] + '">' + d[1] + '</option>';
    }).join('');
    let dimStyle = 'arrow';

    const dimCtl = ctl('dimCtl',
      '<span class="anno-lbl">Scale</span>' +
      '<select id="dimScale" aria-label="Drawing scale">' +
      SCALES.map(function (n) {
        return '<option value="' + n + '"' + (n === 1 ? ' selected' : '') + '>1:' + n + '</option>';
      }).join('') +
      '<option value="custom">Calibrate...</option>' +
      '</select>' +
      '<span class="anno-lbl">Units</span>' +
      '<select id="dimUnit" aria-label="Dimension units">' +
      Object.keys(UNITS).map(function (u) {
        return '<option value="' + u + '"' + (u === 'mm' ? ' selected' : '') + '>' +
          UNITS[u].label + '</option>';
      }).join('') +
      '</select>' +
      '<span class="anno-lbl">Style</span>' +
      '<select id="dimStyle" aria-label="Dimension style">' + STYLE_OPTS + '</select>' +
      '<button class="tg" id="dimCal" title="Measure something whose real length you know and have the scale worked out from it">Calibrate</button>' +
      '<span class="anno-lbl" id="dimScaleNote"></span>');

    let bulge = 0.25, scallop = 9;
    $('dimStyle').addEventListener('change', function () { dimStyle = this.value; });
    $('arcBulge').addEventListener('change', function () { bulge = parseFloat(this.value); });
    $('cloudArc').addEventListener('change', function () { scallop = parseFloat(this.value); });
    function redrawDims() {
      S.items.forEach(function (it) { X.drawShapes(it); X.drawThumb(it); });
    }

    $('dimUnit').addEventListener('change', function () {
      scale.unit = this.value;
      noteScale(); redrawDims();
    });

    $('dimScale').addEventListener('change', function () {
      if (this.value === 'custom') {
        this.value = String(scale.denom);   /* the list entry is a shortcut */
        startCalibration();
        return;
      }
      scale.denom = parseFloat(this.value) || 1;
      scale.custom = null;
      noteScale(); redrawDims();
    });

    function noteScale() {
      $('dimScale').value = String(scale.denom);
      $('dimScaleNote').textContent = scale.custom
        ? 'calibrated'
        : (scale.denom === 1 ? 'actual size' : '1:' + scale.denom);
      /* keep the copy on the properties popover in step */
      if ($('mpDimScale')) {
        $('mpDimScale').value = String(scale.denom);
        $('mpDimUnit').value = scale.unit;
      }
    }
    noteScale();

    /* --- the same three controls, on the properties popover ---
       A dimension is normally drawn and then the tool put down, which takes
       the ribbon row away with it — and with it the scale, at exactly the
       moment someone looks at the number and wants to correct it. So the
       scale rides along on the popover for a selected dimension. */
    const mpScale = document.createElement('div');
    mpScale.className = 'mfield mpscale';
    mpScale.innerHTML =
      '<span>Scale</span>' +
      '<select id="mpDimScale" aria-label="Drawing scale">' +
      SCALES.map(function (n) { return '<option value="' + n + '">1:' + n + '</option>'; }).join('') +
      '</select>' +
      '<select id="mpDimUnit" aria-label="Dimension units">' +
      Object.keys(UNITS).map(function (u) {
        return '<option value="' + u + '">' + UNITS[u].label + '</option>';
      }).join('') +
      '</select>' +
      '<select id="mpDimStyle" aria-label="Dimension style">' + STYLE_OPTS + '</select>' +
      '<button class="cbtn" id="mpDimCal" title="Measure something whose real length you know ' +
      'and have the scale worked out from it">Calibrate</button>';

    mpScale.addEventListener('change', function (e) {
      if (e.target.id === 'mpDimStyle') {
        /* the style belongs to this one dimension, not to the drawing */
        const sh = S.sel && S.sel.it.shapes[S.sel.i];
        if (!sh || !/^dim[rda]?$/.test(sh.t)) return;
        X.snapshot();
        /* every dimension in a group takes the style */
        X.selList().forEach(function (i) {
          const m = S.sel.it.shapes[i];
          if (m && /^dim[rda]?$/.test(m.t)) m.ds = e.target.value;
        });
        sh.ds = e.target.value;
        dimStyle = sh.ds; $('dimStyle').value = dimStyle;   /* and the next one follows it */
        X.drawShapes(S.sel.it); X.drawThumb(S.sel.it); X.updateMeta();
        return;
      }
      if (e.target.id === 'mpDimScale') {
        scale.denom = parseFloat(e.target.value) || 1;
        scale.custom = null;
      } else if (e.target.id === 'mpDimUnit') {
        scale.unit = e.target.value;
      } else return;
      noteScale(); redrawDims();
    });
    mpScale.addEventListener('click', function (e) {
      if (e.target.id !== 'mpDimCal') return;
      /* calibrating means drawing a line of known length, which needs the
         dimension tool in hand */
      X.setTool('dim');
      startCalibration();
    });
    /* core shows this whenever a dim is the selected mark */
    X.markPop.dim = {
      el: mpScale,
      sync: function (sh) { noteScale(); $('mpDimStyle').value = (sh && sh.ds) || 'arrow'; }
    };
    X.markPop.dimr = X.markPop.dim;
    X.markPop.dimd = X.markPop.dim;
    X.markPop.dima = X.markPop.dim;

    X.on('tool', function (t) {
      arcCtl.hidden = t !== 'arc';
      cloudCtl.hidden = t !== 'cloud';
      dimCtl.hidden = !/^dim[crda]?$/.test(t);
    });

    /* --- calibration --- */

    let calibrating = false;
    function startCalibration() {
      if (S.tool !== 'dim') X.setTool('dim');     /* calibrating is a single drag */
      calibrating = !calibrating;
      $('dimCal').classList.toggle('on', calibrating);
      $('modeHint').innerHTML = calibrating
        ? 'Drag along something whose real length you know, then type it in.'
        : X.hints.dim;
    }
    $('dimCal').addEventListener('click', startCalibration);

    function finishCalibration(s) {
      calibrating = false;
      $('dimCal').classList.remove('on');
      $('modeHint').innerHTML = X.hints.dim;

      const pts = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      if (pts < 2) { X.toast('That line is too short to calibrate from'); return; }

      const answer = window.prompt(
        'How long is that line in real life?\n\n' +
        'Type the number and the unit, for example "1200 mm" or "4 ft".', '1200 mm');
      if (!answer) return;

      const m = String(answer).trim().match(/^([\d.,]+)\s*([A-Za-z"']*)$/);
      if (!m) { X.toast('Could not read that — try something like <b>1200 mm</b>'); return; }
      const value = parseFloat(m[1].replace(/,/g, ''));
      if (!isFinite(value) || value <= 0) { X.toast('That is not a length'); return; }

      let unit = String(m[2] || scale.unit).toLowerCase().replace(/[^a-z]/g, '');
      if (m[2] === '"') unit = 'in';
      if (!UNITS[unit]) unit = scale.unit;
      scale.unit = unit;
      scale.custom = value / pts;
      /* report it back as a drawing scale, which is what it really is */
      scale.denom = Math.max(1, Math.round((value / pts) / UNITS[unit].per));
      noteScale(); redrawDims();
      X.toast('Calibrated — about <b>1:' + scale.denom + '</b>, reading in ' + unit);
    }

    /* ---------------- drawing on screen ---------------- */

    function stroked(el, s, idx, it) {
      const sw = Math.max(0.6, s.w * S.scale);
      el.setAttribute('class', 'sh');
      el.style.stroke = s.c;
      el.style.strokeWidth = sw;
      el.style.strokeOpacity = X.shOp(s);
      el.style.strokeLinecap = X.CAP_CSS[X.shCap(s)];
      el.style.strokeLinejoin = X.JOIN_CSS[X.shJoin(s)];
      const da = X.dashOf(s, sw);
      el.style.strokeDasharray = da ? da.join(' ') : 'none';
      el.style.fill = 'none';
      if (idx >= 0) el.addEventListener('pointerdown', function (e) { X.beginDrag(it, idx, e, 'move'); });
      return el;
    }

    function polyline(pts, vp, close) {
      const el = document.createElementNS(SVGNS, close ? 'polygon' : 'polyline');
      el.setAttribute('points', pts.map(function (p) {
        const v = vp.convertToViewportPoint(p[0], p[1]);
        return v[0] + ',' + v[1];
      }).join(' '));
      return el;
    }

    X.shapeRenderers.ellipse = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const el = polyline(ellipsePts(s, 72), vp, true);
      stroked(el, s, idx, it);
      if (s.fill) {
        el.style.fill = s.fill;
        el.style.fillOpacity = X.shOp(s);
        el.style.pointerEvents = 'all';
      }
      g.appendChild(el);
      return g;
    };

    X.shapeRenderers.cloud = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      g.appendChild(stroked(polyline(cloudPts(s, 6), vp, false), s, idx, it));
      return g;
    };

    X.shapeRenderers.arc = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      g.appendChild(stroked(polyline(arcPts(s, 48), vp, false), s, idx, it));
      return g;
    };

    X.shapeRenderers.dim = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const a = vp.convertToViewportPoint(s.a[0], s.a[1]);
      const b = vp.convertToViewportPoint(s.b[0], s.b[1]);
      const sw = Math.max(0.6, s.w * S.scale);
      const st = s.ds || 'arrow';
      const k = S.scale;                          /* points to screen pixels */

      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', a[0]); line.setAttribute('y1', a[1]);
      line.setAttribute('x2', b[0]); line.setAttribute('y2', b[1]);
      g.appendChild(stroked(line, s, idx, it));

      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      function solid(el) {
        const e2 = stroked(el, s, idx, it);
        e2.style.strokeDasharray = 'none';
        return e2;
      }

      /* the extension bars that close each end, perpendicular to the run */
      const ext = st === 'arrow' ? 6 + sw : (6 + s.w) * k;
      const nx = -uy * ext, ny = ux * ext;
      [a, b].forEach(function (end) {
        const t = document.createElementNS(SVGNS, 'line');
        t.setAttribute('x1', end[0] - nx); t.setAttribute('y1', end[1] - ny);
        t.setAttribute('x2', end[0] + nx); t.setAttribute('y2', end[1] + ny);
        g.appendChild(st === 'arrow' ? stroked(t, s, idx, it) : solid(t));
      });

      if (st === 'tick') {
        /* architectural ticks: a heavier 45° slash through each end */
        const h = (3.5 + s.w * 1.2) * k;
        const tx = (ux + uy) / Math.SQRT2 * h, ty = (uy - ux) / Math.SQRT2 * h;
        [a, b].forEach(function (end) {
          const t = document.createElementNS(SVGNS, 'line');
          t.setAttribute('x1', end[0] - tx); t.setAttribute('y1', end[1] - ty);
          t.setAttribute('x2', end[0] + tx); t.setAttribute('y2', end[1] + ty);
          const el = solid(t);
          el.style.strokeWidth = sw * 1.8;
          el.style.strokeLinecap = 'butt';
          g.appendChild(el);
        });
      } else if (st === 'dot') {
        const r = (1.6 + s.w * 0.9) * k;
        [a, b].forEach(function (end) {
          const c = document.createElementNS(SVGNS, 'circle');
          c.setAttribute('cx', end[0]); c.setAttribute('cy', end[1]); c.setAttribute('r', r);
          const el = solid(c);
          el.style.fill = s.c; el.style.fillOpacity = X.shOp(s);
          g.appendChild(el);
        });
      } else {
        /* arrowheads pointing outward into the ends */
        [[b, a], [a, b]].forEach(function (pair) {
          const h = X.arrowHead(pair[1][0], pair[1][1], pair[0][0], pair[0][1], sw * 1.1);
          const p = document.createElementNS(SVGNS, 'polyline');
          p.setAttribute('points',
            h[0][0] + ',' + h[0][1] + ' ' + pair[0][0] + ',' + pair[0][1] + ' ' + h[1][0] + ',' + h[1][1]);
          g.appendChild(solid(p));
        });
      }

      /* the reading, kept the right way up */
      const text = dimLabel(s);
      let mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      let size;

      if (st === 'arrow') {
        /* sitting on the line, on a pale plate */
        size = Math.max(9, Math.min(20, 11 * S.scale));
        const pad = document.createElementNS(SVGNS, 'rect');
        const wGuess = text.length * size * 0.56 + 8;
        pad.setAttribute('x', mx - wGuess / 2); pad.setAttribute('y', my - size * 0.78);
        pad.setAttribute('width', wGuess); pad.setAttribute('height', size * 1.5);
        pad.setAttribute('rx', 3);
        pad.setAttribute('transform', 'rotate(' + ang + ' ' + mx + ' ' + my + ')');
        pad.style.fill = 'rgba(255,255,255,.82)';
        g.appendChild(pad);
      } else {
        /* above the line and clear of it, at the size the PDF will print */
        size = Math.max(7, dimTextPt(s) * k);
        const t0 = ang * Math.PI / 180;
        const lift = (s.w + 2) * k + size * 0.5;
        mx += Math.sin(t0) * lift; my -= Math.cos(t0) * lift;
      }

      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', mx); t.setAttribute('y', my);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('transform', 'rotate(' + ang + ' ' + mx + ' ' + my + ')');
      t.textContent = text;
      t.style.fill = s.c;
      t.style.fontFamily = 'Helvetica, Arial, sans-serif';
      t.style.fontWeight = '600';
      t.style.fontSize = size + 'px';
      t.style.pointerEvents = 'none';
      g.appendChild(t);
      return g;
    };

    /** The reading's size on paper, in points — shared by screen and PDF. */
    function dimTextPt(s) { return Math.max(10, Math.min(14, s.w * 4 + 6)); }   /* thin lines keep a readable 10pt reading */

    /* core draws the grips; tell it which style each mark wants */
    X.handleKind.ellipse = 'rect';
    X.handleKind.cloud = 'rect';
    X.handleKind.arc = 'line';
    X.handleKind.dim = 'line';

    /* ---------------- writing into the PDF ---------------- */

    X.fontNeeds.dim = function () { return 'HelveticaBold'; };

    function paintPts(p, pts, s, solid) {
      const col = X.hexRgb(s.c), th = s.w;
      const op = X.shOp(s);
      const da = solid ? null : X.dashOf(s, th);
      const cap = [PDFLib.LineCapStyle.Butt, PDFLib.LineCapStyle.Round,
                   PDFLib.LineCapStyle.Projecting][X.shCap(s)];
      for (let i = 1; i < pts.length; i++) {
        const line = {
          start: { x: pts[i - 1][0], y: pts[i - 1][1] },
          end:   { x: pts[i][0],     y: pts[i][1] },
          thickness: th, color: col, opacity: op, lineCap: cap
        };
        if (da) { line.dashArray = da; line.dashPhase = 0; }
        p.drawLine(line);
      }
    }

    X.shapePainters.ellipse = function (p, s) {
      /* a filled ellipse is one operator and hairline-accurate, so use the
         native call whenever there is no dash pattern to honour */
      const b = box(s);
      if (!s.dash && !s.r) {
        const opts = {
          x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2,
          xScale: (b.x2 - b.x1) / 2, yScale: (b.y2 - b.y1) / 2,
          borderColor: X.hexRgb(s.c), borderWidth: s.w, borderOpacity: X.shOp(s)
        };
        if (s.fill) { opts.color = X.hexRgb(s.fill); opts.opacity = X.shOp(s); }
        p.drawEllipse(opts);
        return;
      }
      paintPts(p, ellipsePts(s, 96), s);
    };

    X.shapePainters.cloud = function (p, s) { paintPts(p, cloudPts(s, 8), s, true); };
    X.shapePainters.arc   = function (p, s) { paintPts(p, arcPts(s, 64), s); };

    X.shapePainters.dim = function (p, s, ctx) {
      const col = X.hexRgb(s.c), th = s.w, op = X.shOp(s);
      const st = s.ds || 'arrow';
      const A = { x: s.a[0], y: s.a[1] }, B = { x: s.b[0], y: s.b[1] };
      p.drawLine({ start: A, end: B, thickness: th, color: col, opacity: op });

      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const tick = st === 'arrow' ? 4 + th : 6 + th;
      const nx = -uy * tick, ny = ux * tick;
      [A, B].forEach(function (e) {
        p.drawLine({
          start: { x: e.x - nx, y: e.y - ny }, end: { x: e.x + nx, y: e.y + ny },
          thickness: th, color: col, opacity: op
        });
      });
      if (st === 'tick') {
        /* the 45° slash; page space runs y up, so this is the screen's
           slash seen the right way round */
        const h = 3.5 + th * 1.2;
        const tx = (ux - uy) / Math.SQRT2 * h, ty = (uy + ux) / Math.SQRT2 * h;
        [A, B].forEach(function (e) {
          p.drawLine({
            start: { x: e.x - tx, y: e.y - ty }, end: { x: e.x + tx, y: e.y + ty },
            thickness: th * 1.8, color: col, opacity: op
          });
        });
      } else if (st === 'dot') {
        const r = 1.6 + th * 0.9;
        [A, B].forEach(function (e) {
          p.drawCircle({ x: e.x, y: e.y, size: r, color: col, opacity: op, borderWidth: 0 });
        });
      } else {
        [[B, A], [A, B]].forEach(function (pair) {
          const h = X.arrowHead(pair[1].x, pair[1].y, pair[0].x, pair[0].y, th * 1.1);
          h.forEach(function (q) {
            p.drawLine({
              start: { x: q[0], y: q[1] }, end: { x: pair[0].x, y: pair[0].y },
              thickness: th, color: col, opacity: op
            });
          });
        });
      }

      const font = ctx.fonts.HelveticaBold;
      if (!font) return;
      const text = dimLabel(s);
      const size = dimTextPt(s);
      const tw = font.widthOfTextAtSize(text, size);
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      const t = ang * Math.PI / 180;

      /* step back half the string along the baseline and lift it clear of the
         line, then turn — pdf-lib rotates text about its own origin */
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      /* ticks and dots: the whole reading clear above the line, as on screen
         (its middle half a size up, and a capital's middle is ~0.36 size
         above the baseline) */
      const lift = st === 'arrow' ? th + 2 : th + 2 + size * 0.14;
      const ox = mx - Math.cos(t) * tw / 2 - Math.sin(t) * lift;
      const oy = my - Math.sin(t) * tw / 2 + Math.cos(t) * lift;

      /* a pale plate behind it, so the reading survives a busy drawing */
      if (st === 'arrow') p.drawRectangle({
        x: ox - Math.cos(t) * 2 + Math.sin(t) * 1.5,
        y: oy - Math.sin(t) * 2 - Math.cos(t) * 1.5,
        width: tw + 4, height: size + 3,
        rotate: PDFLib.degrees(ang),
        color: PDFLib.rgb(1, 1, 1), opacity: 0.8, borderWidth: 0
      });
      p.drawText(text, {
        x: ox, y: oy, size: size, font: font, color: col,
        rotate: PDFLib.degrees(ang)
      });
    };

    /* ---------------- the tools ---------------- */

    let drag = null;

    function common(t) {
      return {
        colors: true, widths: true,
        down: function (it, at, e) {
          if (!it.vp) return;
          drag = { it: it, a: pdfAt(it, at, e) };
        },
        move: function (it, at, e) {
          if (!drag || drag.it !== it) return;
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const sn = X.snapPt(it, raw, e);
          drag.snap = sn;
          /* a snap point wins over Shift; Alt still flips an arc */
          X.drawShapes(it, ghost(t, drag.a, sn || raw, sn ? { altKey: e && e.altKey } : e));
        },
        cancel: function (it) {
          /* a second finger landed: throw the half-drawn mark away */
          if (!drag) return;
          drag = null;
          X.drawShapes(it);
        },
        up: function (it, at, e) {
          if (!drag || drag.it !== it) return;
          const a = drag.a, raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const sn = X.snapPt(it, raw, e);
          drag = null;
          snapHide();
          const g = ghost(t, a, sn || raw, sn ? { altKey: e && e.altKey } : e);
          if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 3) { X.drawShapes(it); return; }

          if (t === 'dim' && calibrating) { X.drawShapes(it); finishCalibration(g); return; }

          X.snapshot();
          it.shapes.push(g);
          X.drawShapes(it); X.drawThumb(it); X.updateMeta();
          if (t === 'dim') {
            X.toast('<b>' + measure(g) + '</b> \u00b7 double-click it to retype the reading');
          }
        }
      };
    }

    function ghost(t, a, b, e) {
      const s = { t: t, a: [a[0], a[1]], b: [b[0], b[1]], c: S.color, w: S.width };
      /* Shift, as anywhere else: a circle stays round, a cloud square, and a
         dimension or an arc's chord runs level, plumb or at 45°. Alt flips
         which way an arc bulges. */
      if (e && e.shiftKey) s.b = X.constrainPt(t, a, b);
      if (t === 'arc') s.bulge = (e && e.altKey) ? -bulge : bulge;
      if (t === 'cloud') s.arc = scallop;
      if (t === 'dim' && dimStyle !== 'arrow') s.ds = dimStyle;
      return s;
    }

    X.tools.ellipse = common('ellipse');
    X.tools.cloud = common('cloud');
    X.tools.arc = common('arc');
    X.tools.dim = common('dim');

    /* --- continuous dimensions ---
       Click, click, click: each click closes one dimension and opens the next
       from the same point. After the first, each point is brought onto that
       first dimension's line, so the chain reads as one run: 30 · 20 · 20. */
    let chain = null;                              /* {it, last:[x,y], dir:[ux,uy]|null, n} */

    function chainEnd(p, e) {
      const L = chain.last;
      if (chain.dir) {
        const d = (p[0] - L[0]) * chain.dir[0] + (p[1] - L[1]) * chain.dir[1];
        return [L[0] + chain.dir[0] * d, L[1] + chain.dir[1] * d];
      }
      return e && e.shiftKey ? X.snapLine(L, p) : [p[0], p[1]];
    }
    function endChain() {
      if (!chain) return;
      const it = chain.it, n = chain.n;
      chain = null;
      X.drawShapes(it);
      if (S.tool === 'dimc') $('modeHint').innerHTML = X.hints.dimc;
      if (n) X.toast(n + ' dimension' + (n > 1 ? 's' : '') + ' in the chain');
    }

    X.tools.dimc = {
      colors: true, widths: true,
      down: function () { /* a click tool: everything happens on release */ },
      move: function (it, at, e) {
        if (!chain || chain.it !== it || !it.vp) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const sn = X.snapPt(it, raw, e);
        /* a snapped point is still carried onto the chain's line, the way a
           CAD continued dimension measures to the feature it was snapped to */
        const b = chainEnd(sn || raw, sn ? null : e);
        X.drawShapes(it, ghost('dim', chain.last, b, null));
      },
      cancel: function () { endChain(); },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const sn = X.snapPt(it, raw, e);
        const p = sn || raw;
        if (sn) e = null;                          /* the snap wins over Shift */
        if (!chain || chain.it !== it) {           /* first point, or a jump to another page */
          endChain();
          chain = { it: it, last: p, dir: null, n: 0 };
          $('modeHint').innerHTML = 'Click the next point. <b>Enter</b> or <b>Esc</b> ends the chain.';
          return;
        }
        const L = chain.last, b = chainEnd(p, e);
        const len = Math.hypot(b[0] - L[0], b[1] - L[1]);
        if (len < 3) return;                       /* the second click of a double-click */
        X.snapshot();
        it.shapes.push(ghost('dim', L, b, null));
        if (!chain.dir) chain.dir = [(b[0] - L[0]) / len, (b[1] - L[1]) / len];
        chain.last = b; chain.n++;
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      }
    };

    /* Esc and Enter end the chain but keep the tool, so the next click starts
       a fresh run; a second Esc puts the tool down as usual. Capture phase,
       to get there before core's own Esc handling. */
    document.addEventListener('keydown', function (e) {
      if (!chain || S.tool !== 'dimc') return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation();
        endChain();
      }
    }, true);
    $('stage').addEventListener('dblclick', function () {
      if (chain && S.tool === 'dimc') endChain();
    });
    $('stage').addEventListener('contextmenu', function (e) {
      if (S.tool !== 'dimc' || !chain) return;
      e.preventDefault();
      endChain();
    });
    X.on('tool', function (t) { if (t !== 'dimc') endChain(); });

    /* ---------------- radius, diameter and angular dimensions ---------------- */

    /* A PDF has no circles or lines to pick, only ink, so these are defined by
       points you click on the drawing: three on a circle's edge give its exact
       centre and radius; a corner and a point on each arm give an angle. The
       last click places the reading, the way AutoCAD's does. */

    const RADIAL = { dimr: 1, dimd: 1, dima: 1 };
    const ALL_DIMS = { dim: 1, dimr: 1, dimd: 1, dima: 1 };

    const measureCtx = document.createElement('canvas').getContext('2d');
    function textPx(str, px) {
      measureCtx.font = '600 ' + px + 'px Helvetica, Arial, sans-serif';
      return measureCtx.measureText(str).width;
    }
    function unitOf(p, q) {
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    }

    /* One end of a dimension on screen: p is the end, u points outward along
       the line. Honours the dimension's style — arrow, tick or dot. */
    function endMark(g, p, u, s, idx, it) {
      const k = S.scale, sw = Math.max(0.6, s.w * k), st = s.ds || 'arrow';
      let el;
      if (st === 'tick') {
        const h = (3.5 + s.w * 1.2) * k;
        const tx = (u[0] + u[1]) / Math.SQRT2 * h, ty = (u[1] - u[0]) / Math.SQRT2 * h;
        el = document.createElementNS(SVGNS, 'line');
        el.setAttribute('x1', p[0] - tx); el.setAttribute('y1', p[1] - ty);
        el.setAttribute('x2', p[0] + tx); el.setAttribute('y2', p[1] + ty);
        el = stroked(el, s, idx, it);
        el.style.strokeWidth = sw * 1.8; el.style.strokeLinecap = 'butt';
      } else if (st === 'dot') {
        el = document.createElementNS(SVGNS, 'circle');
        el.setAttribute('cx', p[0]); el.setAttribute('cy', p[1]);
        el.setAttribute('r', (1.6 + s.w * 0.9) * k);
        el = stroked(el, s, idx, it);
        el.style.fill = s.c; el.style.fillOpacity = X.shOp(s);
      } else {
        const h = X.arrowHead(p[0] - u[0] * 10, p[1] - u[1] * 10, p[0], p[1], sw * 1.1);
        el = document.createElementNS(SVGNS, 'polyline');
        el.setAttribute('points', h[0][0] + ',' + h[0][1] + ' ' + p[0] + ',' + p[1] + ' ' + h[1][0] + ',' + h[1][1]);
        el = stroked(el, s, idx, it);
      }
      el.style.strokeDasharray = 'none';
      g.appendChild(el);
    }
    /* The same end, written into the PDF (y runs up there). */
    function endPaint(p, P, u, s) {
      const col = X.hexRgb(s.c), th = s.w, op = X.shOp(s), st = s.ds || 'arrow';
      if (st === 'tick') {
        const h = 3.5 + th * 1.2;
        const tx = (u[0] - u[1]) / Math.SQRT2 * h, ty = (u[1] + u[0]) / Math.SQRT2 * h;
        p.drawLine({ start: { x: P[0] - tx, y: P[1] - ty }, end: { x: P[0] + tx, y: P[1] + ty },
          thickness: th * 1.8, color: col, opacity: op });
      } else if (st === 'dot') {
        p.drawCircle({ x: P[0], y: P[1], size: 1.6 + th * 0.9, color: col, opacity: op, borderWidth: 0 });
      } else {
        X.arrowHead(P[0] - u[0] * 10, P[1] - u[1] * 10, P[0], P[1], th * 1.1).forEach(function (q) {
          p.drawLine({ start: { x: q[0], y: q[1] }, end: { x: P[0], y: P[1] },
            thickness: th, color: col, opacity: op });
        });
      }
    }
    function lineEl(p, q) {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]);
      l.setAttribute('x2', q[0]); l.setAttribute('y2', q[1]);
      return l;
    }
    function textEl(str, x, y, anchor, size, s, central) {
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('text-anchor', anchor);
      if (central) t.setAttribute('dominant-baseline', 'central');
      t.textContent = str;
      t.style.fill = s.c;
      t.style.fontFamily = 'Helvetica, Arial, sans-serif';
      t.style.fontWeight = '600';
      t.style.fontSize = size + 'px';
      t.style.pointerEvents = 'none';
      return t;
    }

    /* --- radius and diameter: a leader through the centre, the reading on a
       short landing beside it --- */
    function radialRender(it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const k = S.scale, G = radGeom(s);
      const P = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const aS = P(s.a), bS = P(s.b), nearS = P(G.near), farS = P(G.far);
      const from = s.t === 'dimd' ? farS : aS;
      g.appendChild(stroked(lineEl(from, G.outside ? bS : nearS), s, idx, it));
      endMark(g, nearS, unitOf(aS, nearS), s, idx, it);
      if (s.t === 'dimd') endMark(g, farS, unitOf(aS, farS), s, idx, it);

      const text = dimLabel(s);
      const size = Math.max(7, dimTextPt(s) * k);
      const tw = textPx(text, size);
      const lift = (s.w + 2) * k;
      if (G.outside) {
        const dir = bS[0] >= aS[0] ? 1 : -1;
        const land = [bS[0] + dir * (tw + 4 * k), bS[1]];
        g.appendChild(stroked(lineEl(bS, land), s, idx, it));
        g.appendChild(textEl(text, bS[0] + dir * 2 * k, bS[1] - lift, dir > 0 ? 'start' : 'end', size, s));
      } else {
        g.appendChild(textEl(text, bS[0], bS[1] - lift, 'middle', size, s));
      }
      return g;
    }
    X.shapeRenderers.dimr = radialRender;
    X.shapeRenderers.dimd = radialRender;

    function radialPaint(p, s, ctx) {
      const col = X.hexRgb(s.c), th = s.w, op = X.shOp(s), G = radGeom(s);
      const from = s.t === 'dimd' ? G.far : s.a, to = G.outside ? s.b : G.near;
      p.drawLine({ start: { x: from[0], y: from[1] }, end: { x: to[0], y: to[1] },
        thickness: th, color: col, opacity: op });
      endPaint(p, G.near, G.u, s);
      if (s.t === 'dimd') endPaint(p, G.far, [-G.u[0], -G.u[1]], s);

      const font = ctx.fonts.HelveticaBold;
      if (!font) return;
      const text = dimLabel(s), size = dimTextPt(s);
      const tw = font.widthOfTextAtSize(text, size);
      const y = s.b[1] + th + 2;
      if (G.outside) {
        const dir = s.b[0] >= s.a[0] ? 1 : -1;
        p.drawLine({ start: { x: s.b[0], y: s.b[1] }, end: { x: s.b[0] + dir * (tw + 4), y: s.b[1] },
          thickness: th, color: col, opacity: op });
        p.drawText(text, { x: dir > 0 ? s.b[0] + 2 : s.b[0] - 2 - tw, y: y, size: size, font: font, color: col });
      } else {
        p.drawText(text, { x: s.b[0] - tw / 2, y: y, size: size, font: font, color: col });
      }
    }
    X.shapePainters.dimr = radialPaint;
    X.shapePainters.dimd = radialPaint;

    /* --- angular: an arc between the arms, with extension lines out to it
       when it sits beyond where the arms were picked --- */
    function armExtensions(s, g) {
      const out = [];
      [[s.a1, s.l1], [s.a2, s.l2]].forEach(function (arm) {
        if (g.r > arm[1] + 3) out.push([angPt(s, arm[0], arm[1] + 2), angPt(s, arm[0], g.r + 3)]);
      });
      return out;
    }
    function angEnds(s, g) {
      const e = g.start + g.sweep;
      return [
        { p: angPt(s, g.start, g.r), u: [Math.sin(g.start), -Math.cos(g.start)] },
        { p: angPt(s, e, g.r), u: [-Math.sin(e), Math.cos(e)] }
      ];
    }
    function angLabelPt(s, g, size) {
      return angPt(s, g.start + g.sweep / 2, g.r + 3 + size * 0.75);
    }

    X.shapeRenderers.dima = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const G = angGeom(s), k = S.scale;
      const P = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      g.appendChild(stroked(polyline(arcPtsOf(s, G), vp, false), s, idx, it));
      armExtensions(s, G).forEach(function (seg) {
        const el = stroked(lineEl(P(seg[0]), P(seg[1])), s, idx, it);
        el.style.strokeDasharray = 'none';
        g.appendChild(el);
      });
      angEnds(s, G).forEach(function (e) {
        const pS = P(e.p), qS = P([e.p[0] + e.u[0], e.p[1] + e.u[1]]);
        endMark(g, pS, unitOf(pS, qS), s, idx, it);
      });
      const size = dimTextPt(s);
      const L = P(angLabelPt(s, G, size));
      g.appendChild(textEl(dimLabel(s), L[0], L[1], 'middle', Math.max(7, size * k), s, true));
      return g;
    };

    X.shapePainters.dima = function (p, s, ctx) {
      const col = X.hexRgb(s.c), th = s.w, op = X.shOp(s), G = angGeom(s);
      paintPts(p, arcPtsOf(s, G), s);
      armExtensions(s, G).forEach(function (seg) {
        p.drawLine({ start: { x: seg[0][0], y: seg[0][1] }, end: { x: seg[1][0], y: seg[1][1] },
          thickness: th, color: col, opacity: op });
      });
      angEnds(s, G).forEach(function (e) { endPaint(p, e.p, e.u, s); });
      const font = ctx.fonts.HelveticaBold;
      if (!font) return;
      const text = dimLabel(s), size = dimTextPt(s);
      const L = angLabelPt(s, G, size), tw = font.widthOfTextAtSize(text, size);
      p.drawText(text, { x: L[0] - tw / 2, y: L[1] - size * 0.36, size: size, font: font, color: col });
    };

    ['dimr', 'dimd', 'dima'].forEach(function (t) {
      X.handleKind[t] = 'ends';            /* grip the centre/corner and the reading */
      X.fontNeeds[t] = function () { return 'HelveticaBold'; };
    });

    /* Guides while picking: a cross at each point so far, and the circle or
       arms the next click would make. Never saved — only ever a ghost. */
    X.shapeRenderers.dimguide = function (it, s, vp) {
      const g = document.createElementNS(SVGNS, 'g');
      const P = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      function thin(el) {
        el.style.stroke = s.c; el.style.strokeWidth = 1; el.style.fill = 'none';
        el.style.strokeDasharray = '4 3'; el.style.pointerEvents = 'none';
        return el;
      }
      (s.lines || []).forEach(function (l) {
        const el = thin(lineEl(P(l[0]), P(l[1])));
        el.style.strokeWidth = 2.5; el.style.strokeOpacity = 0.7;
        g.appendChild(el);
      });
      (s.solid || []).forEach(function (l) {          /* lines already picked */
        const el = thin(lineEl(P(l[0]), P(l[1])));
        el.style.strokeDasharray = 'none'; el.style.strokeWidth = 3; el.style.strokeOpacity = 0.55;
        g.appendChild(el);
      });
      if (s.circle) g.appendChild(thin(polyline(ellipsePts({
        a: [s.circle.c[0] - s.circle.r, s.circle.c[1] - s.circle.r],
        b: [s.circle.c[0] + s.circle.r, s.circle.c[1] + s.circle.r]
      }, 72), vp, true)));
      (s.marks || []).forEach(function (m) {
        const v = P(m);
        [[[-5, -5], [5, 5]], [[-5, 5], [5, -5]]].forEach(function (d) {
          const el = thin(lineEl([v[0] + d[0][0], v[1] + d[0][1]], [v[0] + d[1][0], v[1] + d[1][1]]));
          el.style.strokeDasharray = 'none'; el.style.strokeWidth = 1.6;
          g.appendChild(el);
        });
      });
      return g;
    };

    /* --- the picking tools --- */
    let pick = null;                               /* {t, it, pts} */
    const STEP_HINT = {
      circle: ['Click <b>three points</b> on the edge of the circle or arc.',
               'Click a <b>second point</b> on the edge.',
               'Click a <b>third point</b> on the edge.',
               'Click where the reading goes.'],
      dima: ['Click the <b>first line</b> of the angle.',
             'Click the <b>second line</b>.',
             'Click the <b>second line</b>.',
             'Move to choose the side and size of the arc, then click to place it.'],
      /* a scan has no lines to pick, so the first click became the corner */
      corner: ['Click the <b>corner</b> of the angle.',
               'No drawn line there, so that is the <b>corner</b>. Click a point on the <b>first line</b>.',
               'Click a point on the <b>second line</b>.',
               'Move to choose the side and size of the arc, then click to place it.']
    };
    /* ---- the drawing's own lines, so Angular can pick them like CAD does ----
       Read once per page from pdf.js's operator list: every straight piece of
       every path, carried through the transforms into page space. Curves are
       left out — you measure the angle between lines. */
    async function pageSegments(it) {
      if (it._segs) return it._segs;
      if (it._segsJob) return it._segsJob;
      it._segsJob = (async function () {
        const segs = [];
        try {
          const page = await X.ensurePage(it);
          const ol = await page.getOperatorList();
          const OPS = X.pdfjsLib.OPS, U = X.pdfjsLib.Util;
          let ctm = [1, 0, 0, 1, 0, 0];
          const stack = [];
          const T = function (x, y) { return U.applyTransform([x, y], ctm); };
          function add(p, q, curve) {
            if (segs.length < 250000 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5) {
              segs.push(curve ? [p, q, 1] : [p, q]);
            }
          }
          /* curves come in as short chords, marked, so object snap can land
             on a circle's edge while Angular still only takes straight lines */
          function bez(p0, p1, p2, p3) {
            const n = Math.max(4, Math.min(24, Math.ceil(
              (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
               Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) / 6)));
            let prev = p0;
            for (let i = 1; i <= n; i++) {
              const t = i / n, u = 1 - t;
              const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
              const q = [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
              add(prev, q, true);
              prev = q;
            }
          }
          for (let i = 0; i < ol.fnArray.length; i++) {
            const fn = ol.fnArray[i], args = ol.argsArray[i];
            if (fn === OPS.save) stack.push(ctm);
            else if (fn === OPS.restore) ctm = stack.pop() || ctm;
            else if (fn === OPS.transform) ctm = U.transform(ctm, args);
            else if (fn === OPS.paintFormXObjectBegin) {
              stack.push(ctm);
              if (args && args[0]) ctm = U.transform(ctm, args[0]);
            } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
            else if (fn === OPS.constructPath) {
              const ops = args[0], co = args[1];
              let j = 0, cur = null, start = null;
              for (let k = 0; k < ops.length; k++) {
                const op = ops[k];
                if (op === OPS.moveTo) { cur = start = T(co[j], co[j + 1]); j += 2; }
                else if (op === OPS.lineTo) {
                  const n = T(co[j], co[j + 1]); j += 2;
                  if (cur) add(cur, n);
                  cur = n; if (!start) start = n;
                } else if (op === OPS.curveTo) {
                  const c1 = T(co[j], co[j + 1]), c2 = T(co[j + 2], co[j + 3]), e = T(co[j + 4], co[j + 5]);
                  if (cur) bez(cur, c1, c2, e);
                  cur = e; j += 6;
                } else if (op === OPS.curveTo2) {        /* first control point is the current point */
                  const c2 = T(co[j], co[j + 1]), e = T(co[j + 2], co[j + 3]);
                  if (cur) bez(cur, cur, c2, e);
                  cur = e; j += 4;
                } else if (op === OPS.curveTo3) {        /* second control point is the end point */
                  const c1 = T(co[j], co[j + 1]), e = T(co[j + 2], co[j + 3]);
                  if (cur) bez(cur, c1, e, e);
                  cur = e; j += 4;
                }
                else if (op === OPS.rectangle) {
                  const x = co[j], y = co[j + 1], w = co[j + 2], h = co[j + 3]; j += 4;
                  const c = [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)];
                  for (let m = 0; m < 4; m++) add(c[m], c[(m + 1) % 4]);
                  cur = start = c[0];
                } else if (op === OPS.closePath) { if (cur && start) add(cur, start); cur = start; }
              }
            }
          }
        } catch (e) { console.warn('[draw] could not read the page lines', e); }
        it._segs = segs;
        it._segsJob = null;
        return segs;
      })();
      return it._segsJob;
    }

    /** The drawn line nearest p, within a few screen pixels, or null. */
    function segAt(it, p) {
      const segs = it._segs;
      if (!segs || !segs.length) return null;
      const tol = 7 / Math.max(0.05, S.scale);
      let best = null, bd = tol;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i][2]) continue;                 /* a piece of a curve, not a line */
        const a = segs[i][0], b = segs[i][1];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        if (d < bd) { bd = d; best = segs[i]; }
      }
      return best;
    }

    /* ---------------- object snap ----------------
       While drawing or measuring, the pointer is caught by the drawing's own
       geometry — the ends and middles of its lines, where lines cross, any
       point on a line or curve — and by the points of marks already made.
       A marker and a label show what it caught. F3 turns it on and off; hold
       Ctrl to ignore it for a moment. */

    const SNAP_TOOLS = { rect: 1, line: 1, arrow: 1, ellipse: 1, cloud: 1, arc: 1,
                         dim: 1, dimc: 1, dimr: 1, dimd: 1, dima: 1 };
    const SNAP_KINDS = [['end', 'Endpoint'], ['mid', 'Midpoint'], ['int', 'Intersection'],
                        ['near', 'Nearest'], ['mark', 'Points of your marks']];
    const SNAP_RANK = { end: 0, mark: 0, cen: 0, int: 1, mid: 2, near: 3 };
    const snap = { on: true, kinds: { end: 1, mid: 1, int: 1, near: 1, mark: 1 } };
    try {
      const pref = JSON.parse(localStorage.getItem('adpdf.snap') || 'null');
      if (pref) { snap.on = pref.on !== false; if (pref.kinds) snap.kinds = pref.kinds; }
    } catch (e) { /* defaults */ }
    function saveSnap() {
      try { localStorage.setItem('adpdf.snap', JSON.stringify(snap)); } catch (e) { /* fine */ }
    }

    /* A grid over the page: each cell lists the segments passing through it,
       so a lookup only ever looks at the few lines under the pointer. */
    const CELL = 24;
    function gridOf(it) {
      const segs = it._segs;
      if (!segs) return null;
      if (it._grid && it._grid.segs === segs) return it._grid;
      const cells = new Map();
      function put(cx, cy, i) {
        const k = cx + ',' + cy;
        let l = cells.get(k);
        if (!l) { l = []; cells.set(k, l); }
        if (l[l.length - 1] !== i) l.push(i);
      }
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i][0], b = segs[i][1];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)));
        let last = '';
        for (let k = 0; k <= n; k++) {
          const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n;
          const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), key = cx + ',' + cy;
          if (key !== last) { put(cx, cy, i); last = key; }
        }
      }
      it._grid = { segs: segs, cells: cells, seen: new Uint32Array(segs.length), tick: 0 };
      return it._grid;
    }
    function nearSegs(grid, p, r) {
      const out = [];
      grid.tick++;
      const x0 = Math.floor((p[0] - r) / CELL) - 1, x1 = Math.floor((p[0] + r) / CELL) + 1;
      const y0 = Math.floor((p[1] - r) / CELL) - 1, y1 = Math.floor((p[1] + r) / CELL) + 1;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const l = grid.cells.get(cx + ',' + cy);
          if (!l) continue;
          for (let j = 0; j < l.length; j++) {
            const i = l[j];
            if (grid.seen[i] === grid.tick) continue;
            grid.seen[i] = grid.tick;
            out.push(i);
          }
        }
      }
      return out;
    }

    /* the points a mark offers: its ends, a box's corners, a circle's centre */
    function markPoints(s) {
      const out = [];
      if (!s || !s.a) return out;
      const t = s.t;
      if (t === 'ink' && s.pts && s.pts.length) {
        out.push([s.pts[0], 'Pen end'], [s.pts[s.pts.length - 1], 'Pen end']);
      } else if (t === 'dimr' || t === 'dimd') {
        out.push([s.a, 'Centre']);
      } else if (t === 'dima') {
        out.push([s.a, 'Corner']);
      } else if (t === 'ellipse' && s.b) {
        out.push([[(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 'Centre']);
      } else if ((t === 'rect' || t === 'cloud' || t === 'redact') && s.b) {
        if (!s.r) {
          out.push([s.a, 'Corner'], [s.b, 'Corner'], [[s.a[0], s.b[1]], 'Corner'], [[s.b[0], s.a[1]], 'Corner']);
        }
      } else if (s.b && (t === 'line' || t === 'arrow' || t === 'dim' || t === 'arc')) {
        out.push([s.a, 'Mark end'], [s.b, 'Mark end'],
                 [[(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 'Mark middle']);
      }
      return out;
    }

    function snapFind(it, p, opts) {
      const K = snap.kinds;
      const tol = (X.isMobile() ? 16 : 10) / Math.max(0.05, S.scale);
      let best = null;
      function consider(q, kind, label) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > tol) return;
        const r = SNAP_RANK[kind];
        if (!best || r < best.r || (r === best.r && d < best.d)) {
          best = { p: q, kind: kind, label: label, d: d, r: r };
        }
      }

      const grid = gridOf(it);
      if (grid) {
        const ids = nearSegs(grid, p, tol);
        const lines = [];
        for (let n = 0; n < ids.length; n++) {
          const s = grid.segs[ids[n]], a = s[0], b = s[1];
          if (!s[2]) {
            if (K.end) { consider(a, 'end', 'Endpoint'); consider(b, 'end', 'Endpoint'); }
            if (K.mid) consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'mid', 'Midpoint');
            lines.push(s);
          }
          if (K.near) {
            const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
            let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            consider([a[0] + t * dx, a[1] + t * dy], 'near', 'Nearest');
          }
        }
        if (K.int && lines.length > 1) {
          const L = lines.length > 60 ? lines.slice(0, 60) : lines;
          for (let i = 0; i < L.length; i++) {
            for (let j = i + 1; j < L.length; j++) {
              const p1 = L[i][0], q1 = L[i][1], p2 = L[j][0], q2 = L[j][1];
              const d1x = q1[0] - p1[0], d1y = q1[1] - p1[1], d2x = q2[0] - p2[0], d2y = q2[1] - p2[1];
              const den = d1x * d2y - d1y * d2x;
              if (Math.abs(den) < 1e-9) continue;
              const t = ((p2[0] - p1[0]) * d2y - (p2[1] - p1[1]) * d2x) / den;
              const u = ((p2[0] - p1[0]) * d1y - (p2[1] - p1[1]) * d1x) / den;
              if (t < -1e-3 || t > 1 + 1e-3 || u < -1e-3 || u > 1 + 1e-3) continue;
              consider([p1[0] + t * d1x, p1[1] + t * d1y], 'int', 'Intersection');
            }
          }
        }
      }

      if (K.mark) {
        it.shapes.forEach(function (s, idx) {
          if (opts && opts.skip === idx) return;
          markPoints(s).forEach(function (m) {
            consider(m[0], m[1] === 'Centre' ? 'cen' : 'mark', m[1]);
          });
        });
      }
      return best;
    }

    /* ---- the marker ---- */
    const marker = document.createElement('div');
    marker.className = 'snapmark'; marker.id = 'snapMark'; marker.hidden = true;
    marker.setAttribute('aria-hidden', 'true');
    document.body.appendChild(marker);
    const MARK_SVG = {
      end: '<rect x="3.5" y="3.5" width="11" height="11"/>',
      mark: '<rect x="3.5" y="3.5" width="11" height="11"/><circle cx="9" cy="9" r="1.2" class="dot"/>',
      cen: '<circle cx="9" cy="9" r="5.5"/><path d="M9 6.5v5M6.5 9h5"/>',
      mid: '<path d="M9 3.2L15 14.3H3z"/>',
      int: '<path d="M4 4l10 10M14 4L4 14"/>',
      near: '<path d="M4 4h10L4 14h10z"/>'
    };
    let markerKind = '';
    function snapHide() { if (!marker.hidden) marker.hidden = true; }
    function snapShow(it, hit) {
      const v = it.vp.convertToViewportPoint(hit.p[0], hit.p[1]);
      /* against the marks layer: it is laid out whatever the tool, where the
         drawing layer is hidden while the Select tool drags a grip */
      const r = it.anno.getBoundingClientRect();
      const x = r.left + v[0], y = r.top + v[1];
      if (markerKind !== hit.kind + hit.label) {
        markerKind = hit.kind + hit.label;
        marker.innerHTML = '<svg viewBox="0 0 18 18">' + MARK_SVG[hit.kind] + '</svg><span>' + hit.label + '</span>';
      }
      marker.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      marker.hidden = false;
    }

    function snapActive(e, opts) {
      if (!snap.on || (e && e.ctrlKey)) return false;
      if (opts && opts.skip != null) return true;            /* dragging a mark's end */
      if (!SNAP_TOOLS[S.tool]) return false;
      /* Angular picks whole lines until it has both; only its last click snaps */
      if (S.tool === 'dima' && (!pick || (pick.mode === 'lines' && !pick.arm))) return false;
      return true;
    }

    /** The snap point for p on this page, showing the marker — or null. */
    X.snapPt = function (it, p, e, opts) {
      if (!it || !it.vp || !snapActive(e, opts)) { snapHide(); return null; }
      if (!it._segs) pageSegments(it);                        /* the lines arrive shortly */
      const hit = snapFind(it, p, opts);
      if (!hit) { snapHide(); return null; }
      snapShow(it, hit);
      return [hit.p[0], hit.p[1]];
    };
    X.snapHide = snapHide;
    /** A module tool's point: snapped when there is something to catch. */
    function pdfAt(it, at, e) {
      const p = it.vp.convertToPdfPoint(at[0], at[1]);
      return X.snapPt(it, p, e) || p;
    }

    /* Hovering, before anything is pressed: show what the first click would catch. */
    document.addEventListener('pointermove', function (e) {
      if (e.buttons || !SNAP_TOOLS[S.tool]) return;
      const cap = e.target && e.target.closest ? e.target.closest('.capture') : null;
      if (!cap) { snapHide(); return; }
      const it = S.items.filter(function (x) { return x.capture === cap; })[0];
      if (!it || !it.vp) return;
      const r = cap.getBoundingClientRect();
      const at = [e.clientX - r.left + (it.off ? it.off.left : 0), e.clientY - r.top + (it.off ? it.off.top : 0)];
      X.snapPt(it, it.vp.convertToPdfPoint(at[0], at[1]), e);
    }, { passive: true });
    $('stage').addEventListener('scroll', snapHide, { passive: true });
    X.on('tool', function (t) {
      snapHide();
      snapCtl.hidden = !SNAP_TOOLS[t];
      if (SNAP_TOOLS[t]) { const it = S.items[S.current - 1]; if (it) pageSegments(it); }
    });

    /* ---- the switch, in the tool's properties ---- */
    const snapCtl = ctl('snapCtl',
      '<button class="snapbtn" id="snapOn" title="Object snap (F3) — catch ends, middles, crossings and edges. Hold Ctrl to ignore it for a moment.">' +
      '<svg viewBox="0 0 18 18"><rect x="3.5" y="3.5" width="11" height="11"/></svg>Snap</button>' +
      '<button class="snapbtn more" id="snapMore" title="Which points to snap to" aria-label="Snap settings">▾</button>');
    const snapPop = document.createElement('div');
    snapPop.className = 'snappop'; snapPop.id = 'snapPop'; snapPop.hidden = true;
    snapPop.innerHTML = '<div class="snappop-h">Snap to</div>' + SNAP_KINDS.map(function (k) {
      return '<label><input type="checkbox" data-k="' + k[0] + '"><span>' + k[1] + '</span></label>';
    }).join('') + '<p class="snappop-note"><b>F3</b> turns snapping on and off · hold <b>Ctrl</b> to ignore it</p>';
    document.body.appendChild(snapPop);

    function paintSnap() {
      $('snapOn').classList.toggle('on', snap.on);
      $('snapOn').setAttribute('aria-pressed', snap.on ? 'true' : 'false');
      Array.prototype.forEach.call(snapPop.querySelectorAll('input'), function (c) {
        c.checked = !!snap.kinds[c.dataset.k];
      });
    }
    paintSnap();
    function toggleSnap() {
      snap.on = !snap.on; saveSnap(); paintSnap();
      if (!snap.on) snapHide();
      X.toast('Snap <b>' + (snap.on ? 'on' : 'off') + '</b>');
    }
    $('snapOn').addEventListener('click', toggleSnap);
    $('snapMore').addEventListener('click', function () {
      if (!snapPop.hidden) { snapPop.hidden = true; return; }
      const r = $('snapMore').getBoundingClientRect();
      snapPop.hidden = false;
      snapPop.style.top = Math.round(r.bottom + 6) + 'px';
      snapPop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - snapPop.offsetWidth - 8, r.left - 20))) + 'px';
    });
    snapPop.addEventListener('change', function (e) {
      const k = e.target.dataset.k; if (!k) return;
      if (e.target.checked) snap.kinds[k] = 1; else delete snap.kinds[k];
      saveSnap();
    });
    document.addEventListener('mousedown', function (e) {
      if (snapPop.hidden) return;
      const t = e.target && e.target.closest ? e.target : null;
      if (!t || (!snapPop.contains(t) && !t.closest('#snapMore'))) snapPop.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'F3' || !S.items.length) return;
      e.preventDefault();
      toggleSnap();
    });
    document.addEventListener('keyup', function (e) { if (e.key === 'Control') snapHide(); });

    /** Two picked lines to an angle: the corner is where they meet, and each
        arm points from the corner toward the side of the line that was clicked. */
    function armsFromLines(L1, L2) {
      const p1 = L1.seg[0], d1 = [L1.seg[1][0] - p1[0], L1.seg[1][1] - p1[1]];
      const p2 = L2.seg[0], d2 = [L2.seg[1][0] - p2[0], L2.seg[1][1] - p2[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 0.01 * Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1])) return null;
      const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
      const V = [p1[0] + t * d1[0], p1[1] + t * d1[1]];
      function arm(L, d) {
        const len = Math.hypot(d[0], d[1]), u = [d[0] / len, d[1] / len];
        let s = (L.click[0] - V[0]) * u[0] + (L.click[1] - V[1]) * u[1];
        if (Math.abs(s) < 1) {                   /* clicked on the corner itself: take the longer side */
          const e0 = (L.seg[0][0] - V[0]) * u[0] + (L.seg[0][1] - V[1]) * u[1];
          const e1 = (L.seg[1][0] - V[0]) * u[0] + (L.seg[1][1] - V[1]) * u[1];
          s = Math.abs(e0) > Math.abs(e1) ? e0 : e1;
        }
        const dir = s < 0 ? [-u[0], -u[1]] : u;
        let reach = Math.abs(s);
        L.seg.forEach(function (e) {
          reach = Math.max(reach, (e[0] - V[0]) * dir[0] + (e[1] - V[1]) * dir[1]);
        });
        return { a: Math.atan2(dir[1], dir[0]), l: reach };
      }
      const A = arm(L1, d1), B = arm(L2, d2);
      return { v: V, a1: A.a, l1: A.l, a2: B.a, l2: B.l };
    }
    function armsFromPoints(P) {
      const v = P[0];
      return {
        v: v,
        a1: Math.atan2(P[1][1] - v[1], P[1][0] - v[0]), l1: Math.hypot(P[1][0] - v[0], P[1][1] - v[1]),
        a2: Math.atan2(P[2][1] - v[1], P[2][0] - v[0]), l2: Math.hypot(P[2][0] - v[0], P[2][1] - v[1])
      };
    }

    function stepHint() {
      if (!pick) return;
      let msg;
      if (pick.t !== 'dima') msg = STEP_HINT.circle[Math.min(3, pick.pts.length)];
      else if (pick.mode === 'corner') msg = STEP_HINT.corner[pick.arm ? 3 : pick.pts.length];
      else msg = STEP_HINT.dima[pick.arm ? 3 : pick.lines.length];
      $('modeHint').innerHTML = msg + ' <b>Esc</b> starts again.';
    }
    function pickReset() {
      if (!pick) return;
      const it = pick.it;
      pick = null;
      X.drawShapes(it);
      if (RADIAL[S.tool]) $('modeHint').innerHTML = X.hints[S.tool];
    }
    function pickedShape(cur) {
      const t = pick.t;
      const base = { t: t, c: S.color, w: S.width };
      if (dimStyle !== 'arrow') base.ds = dimStyle;
      if (t === 'dima') {
        const A = pick.arm;
        if (!A) return null;
        return Object.assign(base, {
          a: [A.v[0], A.v[1]], b: [cur[0], cur[1]], a1: A.a1, l1: A.l1, a2: A.a2, l2: A.l2
        });
      }
      const P = pick.pts;
      const c = circle3(P[0], P[1], P[2]);
      return c ? Object.assign(base, { a: c.c, rad: c.r, b: [cur[0], cur[1]] }) : null;
    }
    function pickGhost(cur) {
      if (pick.t === 'dima' && pick.arm) return pickedShape(cur);
      if (pick.t !== 'dima' && pick.pts.length >= 3) return pickedShape(cur);
      const P = pick.pts;
      const gh = { t: 'dimguide', c: S.color, marks: P.slice(), lines: [], solid: [] };
      if (pick.t === 'dima' && pick.mode === 'lines') {
        pick.lines.forEach(function (L) { gh.solid.push(L.seg); });
        const hover = segAt(pick.it, cur);                 /* the line a click would take */
        if (hover && pick.lines.every(function (L) { return L.seg !== hover; })) gh.lines.push(hover);
      } else if (pick.t === 'dima') {
        if (P.length >= 1) gh.lines.push([P[0], cur]);
        if (P.length === 2) gh.lines.push([P[0], P[1]]);
      } else if (P.length === 2) {
        gh.circle = circle3(P[0], P[1], cur);
      }
      return gh;
    }

    function commit(it, t, cur) {
      const g = pickedShape(cur);
      if (!g) return;
      X.snapshot();
      it.shapes.push(g);
      pick = null;
      $('modeHint').innerHTML = X.hints[t];
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.toast('<b>' + X.esc(dimLabel(g)) + '</b> · double-click it to retype the reading');
    }

    function pickTool(t) {
      return {
        colors: true, widths: true,
        down: function () { /* a click tool: everything happens on release */ },
        move: function (it, at) {
          if (!it.vp) return;
          const p = it.vp.convertToPdfPoint(at[0], at[1]);
          if (!pick) {
            /* before the first click, still show which line would be taken */
            if (t === 'dima' && it._segs) {
              const h = segAt(it, p);
              X.drawShapes(it, h ? { t: 'dimguide', c: S.color, lines: [h] } : undefined);
            }
            return;
          }
          if (pick.it !== it) return;
          const g = pickGhost(X.snapPt(it, p, e) || p);
          if (g) X.drawShapes(it, g);
        },
        cancel: function () { pickReset(); },
        up: async function (it, at, e) {
          if (!it.vp || (e && e.button > 0)) return;
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          if (!pick || pick.it !== it || pick.t !== t) {   /* a fresh start, or another page */
            pickReset();
            pick = { t: t, it: it, pts: [], lines: [], arm: null, mode: 'lines' };
          }
          /* picking Angular's lines uses the raw point; everything else snaps */
          const lineMode = t === 'dima' && pick.mode === 'lines' && !pick.arm;
          const p = lineMode ? raw : (X.snapPt(it, raw, e) || raw);
          if (!lineMode) snapHide();
          const P = pick.pts;

          if (t === 'dima') {
            if (pick.arm) { commit(it, t, p); return; }
            if (pick.mode === 'lines') {
              const job = pick;
              await pageSegments(it);
              if (pick !== job) return;
              const seg = segAt(it, p);
              if (!seg) {
                if (!pick.lines.length) {          /* nothing drawn there: take it as the corner */
                  pick.mode = 'corner';
                  P.push(p);
                } else {
                  X.toast('No drawn line there — click right on the second line');
                }
              } else if (pick.lines.length && pick.lines[0].seg === seg) {
                X.toast('That is the same line — click the second line');
              } else {
                pick.lines.push({ seg: seg, click: p });
                if (pick.lines.length === 2) {
                  pick.arm = armsFromLines(pick.lines[0], pick.lines[1]);
                  if (!pick.arm) {
                    pick.lines.pop();
                    X.toast('Those lines are parallel — they never meet in a corner');
                  }
                }
              }
            } else {                                /* corner mode: corner, arm, arm */
              const last = P[P.length - 1];
              if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
              if (Math.hypot(p[0] - P[0][0], p[1] - P[0][1]) < 2) return;
              P.push(p);
              if (P.length === 3) pick.arm = armsFromPoints(P);
            }
            stepHint();
            X.drawShapes(it, pickGhost(p));
            return;
          }

          if (P.length < 3) {
            const last = P[P.length - 1];
            if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;   /* a double-click */
            P.push(p);
            if (P.length === 3 && !circle3(P[0], P[1], P[2])) {
              P.pop();
              X.toast('Those points are in a line — pick three points spread around the circle');
            }
            stepHint();
            X.drawShapes(it, pickGhost(p));
            return;
          }
          commit(it, t, p);
        }
      };
    }
    X.tools.dimr = pickTool('dimr');
    X.tools.dimd = pickTool('dimd');
    X.tools.dima = pickTool('dima');
    /* read the lines of the page in view as soon as the tool is picked up, so
       the first click does not wait for them */
    X.on('tool', function (t) {
      if (t !== 'dima') return;
      const it = S.items[S.current - 1];
      if (it) pageSegments(it);
    });

    document.addEventListener('keydown', function (e) {
      if (!pick || !RADIAL[S.tool] || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      pickReset();                                  /* the first Esc starts again; the next puts the tool down */
    }, true);
    X.on('tool', function (t) { if (!RADIAL[t] || (pick && pick.t !== t)) pickReset(); });

    /* ---------------- editing the reading ---------------- */

    /* Which dimension, if any, is under this point on the page. Generous:
       a fingertip is not precise, and the line is thin. */
    function dimUnder(it, at) {
      if (!it.vp) return -1;
      const tol = Math.max(10, 14 / Math.max(0.4, S.scale));
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        const s = it.shapes[i];
        if (!ALL_DIMS[s.t]) continue;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        if (s.t === 'dima') {
          /* anywhere on the arc's circle, or on the reading */
          const G = angGeom(s);
          if (Math.abs(Math.hypot(p[0] - s.a[0], p[1] - s.a[1]) - G.r) <= tol) return i;
          const L = angLabelPt(s, G, dimTextPt(s));
          if (Math.hypot(p[0] - L[0], p[1] - L[1]) <= tol * 1.5) return i;
          continue;
        }
        let ax = s.a[0], ay = s.a[1];
        if (s.t === 'dimd') { const G = radGeom(s); ax = G.far[0]; ay = G.far[1]; }
        const bx = s.b[0], by = s.b[1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
        if (d <= tol) return i;
      }
      return -1;
    }

    function editDim(it, idx) {
      const s = it.shapes[idx];
      if (!s || !ALL_DIMS[s.t]) return;
      const v = window.prompt(
        'Reading to show on this dimension.\n' +
        'Leave it empty to go back to the measured value.',
        dimLabel(s));
      if (v === null) return;
      X.snapshot();
      s.label = v.trim() === '' ? null : v.trim();
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
    }

    /* Double-click straight onto a dimension — no need to select it first. */
    $('stage').addEventListener('dblclick', function (e) {
      if (S.tool !== 'select' && S.tool !== 'dim') return;
      const box = e.target.closest ? e.target.closest('.pagebox') : null;
      const it = S.items.filter(function (x) { return x.box === box; })[0];
      if (!it || !it.inner) return;
      const r = it.inner.getBoundingClientRect();
      const idx = dimUnder(it, [e.clientX - r.left, e.clientY - r.top]);
      if (idx < 0) return;
      e.preventDefault(); e.stopPropagation();
      editDim(it, idx);
    });

    X.editDimension = editDim;

    X.on('reset', function () {
      drag = null;
      chain = null;
      pick = null;
      calibrating = false;
      $('dimCal').classList.remove('on');
      scale = { unit: 'mm', denom: 1, custom: null };
      $('dimUnit').value = 'mm';
      noteScale();
    });

    X.draw = {
      measure: measure,
      setScale: function (per, unit) {
        scale.unit = UNITS[unit] ? unit : 'mm';
        scale.custom = per;
        scale.denom = Math.max(1, Math.round(per / UNITS[scale.unit].per));
        noteScale();
      },
      setDrawingScale: function (denom, unit) {
        scale.denom = denom; scale.custom = null;
        if (UNITS[unit]) scale.unit = unit;
        noteScale(); redrawDims();
      },
      scale: function () { return Object.assign({}, scale); },
      ellipsePts: ellipsePts, arcPts: arcPts, cloudPts: cloudPts
    };
  });
})();
