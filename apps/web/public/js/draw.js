/* Add Dots PDF — Drawing tools
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
    /* geometry, readings and the PDF painters live in the engine */
    const E = window.ADDPDFEngine;

    /* ---------------- geometry ---------------- */

    function box(s) { return E.boxOf(s); }

    /** An ellipse as a ring of points, in PDF space, turned by s.r. */
    function ellipsePts(s, steps) { return E.ellipsePts(s, steps); }

    /**
     * A circular arc through a and b, bulging by `bulge` of the chord length.
     * Returned as points so the screen and the PDF draw the identical curve.
     */
    function arcPts(s, steps) { return E.arcPts(s, steps); }

    /**
     * A revision cloud: the box perimeter walked with semicircular bumps
     * pushed outward. The scallop size is kept honest across a long edge by
     * dividing the edge evenly rather than leaving a stub at the end.
     */
    function cloudPts(s, perBump) { return E.cloudPts(s, perBump); }

    /* ---------------- measuring ---------------- */

    /* A PDF point is 1/72 inch. A drawing issued at 1:50 is not, which is what
       calibration is for: measure something you know, say what it really is,
       and every dimension after that reads in those units. */
    /* How much of this unit one PDF point covers at 1:1. A point is 1/72in. */
    const UNITS = E.UNITS;

    /* Drawing scales. A plan issued at 1:50 draws a 50mm wall as 1mm of paper,
       so a paper measurement is multiplied by the denominator to read back as
       the real thing. */
    const SCALES = E.SCALES;

    /* `denom` is the drawing scale and `unit` what to print. `custom` holds a
       points-to-unit factor worked out by calibrating, which overrides both. */
    let scale = { unit: 'mm', denom: 1, custom: null };

    function perPoint() { return E.perPoint(scale); }

    function measure(s) {
      return measureLen(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]));
    }

    /** A length in PDF points, as the reading for the current scale and unit. */
    function measureLen(d) { return E.formatLength(d, scale); }

    function dimLabel(s) { return E.dimLabel(s, scale); }

    /* ---- radius, diameter and angle geometry, all in PDF points ---- */

    /** a: centre, rad: radius, b: where the reading sits. */
    function radGeom(s) { return E.radGeom(s); }

    /** Where a plain dim's own line sits once pulled clear of a-b by s.off. */
    function dimGeom(s) { return E.dimGeom(s); }

    function normAng(v) { return E.normAng(v); }

    /** a: vertex, a1/a2: the two arms' directions, l1/l2: how far along each
        the picks were, b: a point on the arc. The arc takes whichever side of
        the arms b is on — so the same corner can read 60° or 300°. */
    function angGeom(s) { return E.angGeom(s); }
    function angPt(s, ang, r) { return E.angPt(s, ang, r); }
    function arcPtsOf(s, g) { return E.arcPtsOf(s, g); }

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
      { t: 'ellipse', id: 'tEllipse', label: 'Ellipse', key: 'L', shift: false,
        hint: 'Drag to draw an ellipse. <b>Shift</b>: a perfect circle. <b>Alt</b>: from the centre. ' +
              'Hold <b>Space</b> to move it while drawing. <b>Esc</b> cancels. Click without dragging to type its size.',
        path: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>' },
      { t: 'cloud', id: 'tCloud', label: 'Cloud', key: 'L', shift: true,
        hint: 'Drag a box and it becomes a revision cloud around it. ' +
              'The <b>Scallop</b> control sets how big the bumps are. Hold <b>Shift</b> for a square.',
        path: '<path d="M6.5 18a3.5 3.5 0 0 1-.4-7 4.5 4.5 0 0 1 8.2-2.5A3.5 3.5 0 0 1 19 11a3.5 3.5 0 0 1-.5 7z"/>' },
      { t: 'arc', id: 'tArc', label: 'Arc', key: 'A', shift: true,
        hint: 'Drag from one end to the other. <b>Bulge</b> sets how far it ' +
              'curves, <b>Alt</b> flips which way, and <b>Shift</b> keeps it level, plumb or at 45°.',
        path: '<path d="M3 19a13 13 0 0 1 18-12"/><circle cx="3" cy="19" r="1.6"/><circle cx="21" cy="7" r="1.6"/>' },
      { t: 'dim', id: 'tDim', label: 'Linear', key: 'D', shift: true,
        hint: 'Click the <b>first point</b> to measure, then the <b>second</b> (or drag between them) — ' +
              'then move to place the dimension line: past the points’ sides it measures vertically, ' +
              'above or below them horizontally (<b>H</b>, <b>V</b>, <b>A</b> fix it horizontal, vertical ' +
              'or aligned). Points snap, and stay on the objects they snap to. Set the drawing ' +
              '<b>Scale</b>, or <b>Calibrate</b>. Double-click a dimension to retype it.',
        path: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="7" x2="3" y2="17"/>' +
              '<line x1="21" y1="7" x2="21" y2="17"/><polyline points="7 9 4 12 7 15"/>' +
              '<polyline points="17 9 20 12 17 15"/>' },
      { t: 'dimal', id: 'tDimAl', label: 'Aligned', key: null,
        hint: 'Click the <b>first point</b>, then the <b>second</b>: the true distance between them, the ' +
              'dimension line parallel to it. Move to place it and click. <b>Esc</b> cancels.',
        path: '<line x1="3" y1="15" x2="15" y2="3"/><line x1="9" y1="21" x2="21" y2="9"/>' +
              '<line x1="6" y1="12" x2="12" y2="18"/><line x1="12" y1="6" x2="18" y2="12"/>' },
      { t: 'dimc', id: 'tDimC', label: 'Continuous', key: 'Q', shift: true,
        hint: 'Click a linear dimension to carry on from (or place a first one: two points and its line), ' +
              'then each next point: every click adds a dimension from the last, on the same line. ' +
              '<b>Enter</b>, <b>Esc</b>, double-click or right-click ends the chain.',
        path: '<line x1="3" y1="6" x2="3" y2="18"/><line x1="12" y1="6" x2="12" y2="18"/>' +
              '<line x1="21" y1="6" x2="21" y2="18"/><line x1="3" y1="11" x2="21" y2="11"/>' +
              '<polyline points="5.6 9.2 3.4 11 5.6 12.8"/><polyline points="9.4 9.2 11.6 11 9.4 12.8"/>' +
              '<polyline points="14.6 9.2 12.4 11 14.6 12.8"/><polyline points="18.4 9.2 20.6 11 18.4 12.8"/>' },
      { t: 'dimb', id: 'tDimB', label: 'Baseline', key: null,
        hint: 'Click a linear dimension to work from (or place a first one), then each next point: every ' +
              'click adds a dimension from the <b>same first point</b>, stacked a step further out. ' +
              '<b>Enter</b>, <b>Esc</b>, double-click or right-click ends it.',
        path: '<line x1="3" y1="4" x2="3" y2="20"/><line x1="12" y1="12" x2="12" y2="20"/>' +
              '<line x1="21" y1="4" x2="21" y2="20"/><line x1="3" y1="15" x2="12" y2="15"/>' +
              '<line x1="3" y1="8" x2="21" y2="8"/>' },
      { t: 'dimr', id: 'tDimR', label: 'Radius', key: null,
        hint: 'Click a <b>circle or arc</b> you drew (or three points on the edge of one in the drawing), ' +
              'then where the dimension goes — inside or outside it. <b>Esc</b> starts again.',
        path: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="12" x2="18" y2="6"/>' +
              '<polyline points="14.9 6.1 18 6 17.9 9.1"/>' +
              '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>' },
      { t: 'dimd', id: 'tDimD', label: 'Diameter', key: null,
        hint: 'Click a <b>circle or arc</b> you drew (or three points on the edge of one in the drawing), ' +
              'then where the <b>Ø</b> dimension goes. <b>Esc</b> starts again.',
        path: '<circle cx="12" cy="12" r="8.5"/><line x1="5" y1="19" x2="19" y2="5"/>' },
      { t: 'dima', id: 'tDimA', label: 'Angular', key: null,
        hint: 'Click the <b>first line</b>, then the <b>second</b> — then move into the angle you want (any ' +
              'of the four) and click. Or click empty space for a <b>vertex</b>, then a point on each arm. ' +
              '<b>Esc</b> starts again.',
        path: '<line x1="3" y1="20" x2="21" y2="20"/><line x1="3" y1="20" x2="14" y2="4"/>' +
              '<path d="M12 20A9 9 0 0 0 8.1 12.6"/>' },
      { t: 'dimarc', id: 'tDimArc', label: 'Arc Length', key: null,
        hint: 'Click an <b>Arc</b> you drew (or its start, a point along it and its end, in the drawing), ' +
              'then where the dimension arc goes. <b>Esc</b> starts again.',
        path: '<path d="M4 18A10 10 0 0 1 20 18"/><path d="M2 12A12 12 0 0 1 22 12" stroke-dasharray="2 2"/>' +
              '<path d="M9 5.5a4 4 0 0 1 6 0"/>' },
      { t: 'dimo', id: 'tDimO', label: 'Ordinate', key: null,
        hint: 'Click the <b>datum</b> (the origin), then for each feature its point and where its leader ' +
              'ends — up or down for an X ordinate, sideways for a Y one (<b>X</b> / <b>Y</b> fix it). ' +
              '<b>O</b> picks a new datum.',
        path: '<line x1="4" y1="20" x2="4" y2="4"/><line x1="4" y1="20" x2="20" y2="20"/>' +
              '<line x1="10" y1="20" x2="10" y2="9"/><line x1="17" y1="20" x2="17" y2="6"/>' +
              '<circle cx="4" cy="20" r="1.6" fill="currentColor" stroke="none"/>' },
      { t: 'fillet', id: 'tFillet', label: 'Fillet', key: null,
        hint: 'Click one <b>Line</b> you have drawn, then <b>another</b> — the corner between them ' +
              'rounds to the <b>Radius</b> set here, trimming both to the curve. Lines made with ' +
              'other tools, or the page’s own drawing, cannot be picked. <b>Esc</b> starts again.',
        path: '<path d="M4 20V10a6 6 0 0 1 6-6h10"/>' },
      { t: 'poly', id: 'tPoly', label: 'Continuous Line', key: null,
        hint: 'Click the first point, then each next point — every click adds another segment ' +
              'on from the last, with a rubber-band preview of the next one. <b>Enter</b>, ' +
              '<b>Esc</b> or double-click ends the line. Hold <b>Shift</b> to keep a segment ' +
              'level, plumb or at 45°.',
        path: '<polyline points="3 18 8 7 13 15 21 5"/>' }
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

    const filletCtl = ctl('filletCtl',
      '<span class="anno-lbl">Radius</span>' +
      '<input type="number" id="filletRadius" min="1" max="2000" step="1" value="20" aria-label="Fillet radius, in points">' +
      '<span class="anno-lbl">pt</span>');

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

    let bulge = 0.25, scallop = 9, filletRadius = 20;
    $('dimStyle').addEventListener('change', function () { dimStyle = this.value; });
    $('arcBulge').addEventListener('change', function () { bulge = parseFloat(this.value); });
    $('cloudArc').addEventListener('change', function () { scallop = parseFloat(this.value); });
    $('filletRadius').addEventListener('change', function () {
      filletRadius = Math.max(1, parseFloat(this.value) || 20);
      this.value = filletRadius;
    });
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
    /* --- the look of a dimension: its size, typed as a percentage, which
       scales the whole of it together (arrows, ticks or dots, the reading,
       the extension lines and the lines' weight), and the reading's font,
       bold/italic and colour. Every field is optional on the mark (DimMark
       in painters/draw.ts): unset reads exactly as a dimension always has.
       The same controls sit on the ribbon, as what the next dimension takes,
       and on the properties popover, for the selected one. */
    const look = { dz: 1, df: '', db: true, di: false, tc: '' };
    function lookOf(sh) {
      return {
        dz: E.dimScale(sh),
        df: sh.df || '', db: sh.db !== false && sh.db !== 0, di: !!sh.di, tc: sh.tc || ''
      };
    }
    /* writes a look onto a mark, leaving out whatever is at its usual */
    function putLook(sh, L) {
      ['dz', 'df', 'db', 'di', 'tc'].forEach(function (k) { delete sh[k]; });
      if (L.dz !== 1) sh.dz = L.dz;
      if (L.df) sh.df = L.df;
      if (!L.db) sh.db = false;
      if (L.di) sh.di = true;
      if (L.tc) sh.tc = L.tc;
    }
    /* what a new dimension takes from the ribbon */
    function applyLook(sh) {
      if (dimStyle !== 'arrow') sh.ds = dimStyle;
      putLook(sh, look);
    }
    function fontOpts() {
      const GF = window.ADDDOTS_FONTS;
      return '<option value="">Default</option>' + (GF ? GF.options()
        : '<option value="helv">Helvetica</option><option value="times">Times</option>' +
          '<option value="cour">Courier</option>');
    }
    function lookHtml(p, chipCls) {
      return '<span class="anno-lbl">Size</span>' +
        '<input type="number" id="' + p + 'Z" min="10" max="1000" step="5" inputmode="decimal" ' +
        'aria-label="Dimension size, in percent">' +
        '<span class="anno-lbl">%</span>' +
        '<select id="' + p + 'Df" aria-label="Dimension text font">' + fontOpts() + '</select>' +
        '<button type="button" class="tg b" id="' + p + 'Db" title="Bold">B</button>' +
        '<button type="button" class="tg i" id="' + p + 'Di" title="Italic">I</button>' +
        '<button type="button" class="' + chipCls + '" id="' + p + 'Tc" title="Text colour">' +
        '<i></i><span>Text colour</span><b>▾</b></button>';
    }
    /* by id, on the page or on the popover's controls before it is shown */
    function lk(id) { return $(id) || (mpLook && mpLook.querySelector('#' + id)); }
    function showLook(p, L, lineColor) {
      if (document.activeElement !== lk(p + 'Z')) lk(p + 'Z').value = String(Math.round(L.dz * 1000) / 10);
      lk(p + 'Df').value = L.df;
      lk(p + 'Db').classList.toggle('on', L.db);
      lk(p + 'Di').classList.toggle('on', L.di);
      lk(p + 'Tc').querySelector('i').style.background = L.tc || lineColor;
    }
    /* reads one control's change into a look; false if it was not one of them */
    function readLook(p, el, L) {
      const id = el.id;
      if (id === p + 'Z') {
        const v = parseFloat(el.value);
        if (v > 0) L.dz = Math.max(10, Math.min(1000, v)) / 100;
      } else if (id === p + 'Df') L.df = el.value;
      else if (id === p + 'Db') L.db = !L.db;
      else if (id === p + 'Di') L.di = !L.di;
      else return false;
      return true;
    }

    /* the text colour: the shared palette (core's buildPalette), with
       "Same as lines" first, the way Fill offers "No fill" */
    const tcPop = document.createElement('div');
    tcPop.className = 'swpop palette'; tcPop.id = 'dimTcPop'; tcPop.hidden = true;
    document.body.appendChild(tcPop);
    let tcFor = null;
    function openTc(anchor, cur, pick) {
      if (tcFor === anchor && !tcPop.hidden) { closeTc(); return; }
      tcFor = anchor;
      tcPop.innerHTML = '';
      const same = document.createElement('button');
      same.type = 'button'; same.className = 'pnofill' + (cur ? '' : ' on');
      same.title = 'Same as the lines'; same.setAttribute('aria-label', 'Same as the lines');
      same.addEventListener('click', function (e) { e.stopPropagation(); pick(''); closeTc(); });
      tcPop.appendChild(same);
      X.buildPalette(tcPop, cur, function (c) { pick(c); closeTc(); });
      tcPop.hidden = false;
      const r = anchor.getBoundingClientRect(), w = tcPop.offsetWidth, h = tcPop.offsetHeight;
      tcPop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      tcPop.style.top = top + 'px';
    }
    function closeTc() { tcFor = null; tcPop.hidden = true; }
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#dimTcPop') && !e.target.closest('#dlTc, #mpDlTc')) closeTc();
    });

    /* on the ribbon: what the next dimension takes */
    const dimLookCtl = ctl('dimLookCtl', lookHtml('dl', 'swmore'));
    function syncRibbonLook() { showLook('dl', look, S.color); }
    dimLookCtl.addEventListener('change', function (e) {
      if (readLook('dl', e.target, look)) syncRibbonLook();
    });
    dimLookCtl.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'dlTc') {
        openTc(b, look.tc, function (c) { look.tc = c; syncRibbonLook(); });
        return;
      }
      if (readLook('dl', b, look)) syncRibbonLook();
    });

    /* on the popover: the selected dimension, and every one grouped with it */
    const mpLook = document.createElement('div');
    mpLook.className = 'txctl mplook';
    mpLook.innerHTML = lookHtml('mpDl', 'cbtn');
    function selDim() {
      const sh = S.sel && S.sel.it.shapes[S.sel.i];
      return sh && ALL_DIMS[sh.t] ? sh : null;
    }
    /* change applies fn to a copy of the selected dimension's look and puts
       that one field onto each selected dimension, keeping their others */
    function editLook(fn) {
      const sh = selDim(); if (!sh) return;
      const L = lookOf(sh); fn(L);
      const before = lookOf(sh);
      const changed = Object.keys(L).filter(function (k) { return L[k] !== before[k]; });
      if (!changed.length) { syncPopLook(sh); return; }
      X.snapshot();
      X.selList().forEach(function (i) {
        const m = S.sel.it.shapes[i];
        if (!m || !ALL_DIMS[m.t]) return;
        const ml = lookOf(m);
        changed.forEach(function (k) { ml[k] = L[k]; });
        putLook(m, ml);
      });
      /* and the next one follows it, as the end style does */
      changed.forEach(function (k) { look[k] = L[k]; });
      X.drawShapes(S.sel.it); X.drawThumb(S.sel.it); X.updateMeta();
      syncPopLook(sh);
    }
    function syncPopLook(sh) { showLook('mpDl', lookOf(sh), sh.c); }
    mpLook.addEventListener('change', function (e) {
      const el = e.target;
      editLook(function (L) { readLook('mpDl', el, L); });
    });
    mpLook.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'mpDlTc') {
        const sh = selDim(); if (!sh) return;
        openTc(b, sh.tc || '', function (c) { editLook(function (L) { L.tc = c; }); });
        return;
      }
      editLook(function (L) { readLook('mpDl', b, L); });
    });
    ['mpDlZ', 'dlZ'].forEach(function (id) {
      lk(id).addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') this.blur();
      });
    });

    const mpDim = document.createElement('div');
    mpDim.className = 'mpdim';
    mpDim.appendChild(mpScale);
    mpDim.appendChild(mpLook);

    /* core shows this whenever a dim is the selected mark */
    X.markPop.dim = {
      el: mpDim,
      sync: function (sh) {
        noteScale(); $('mpDimStyle').value = (sh && sh.ds) || 'arrow';
        if (sh) syncPopLook(sh);
      }
    };
    X.markPop.dimr = X.markPop.dim;
    X.markPop.dimd = X.markPop.dim;
    X.markPop.dima = X.markPop.dim;

    X.on('tool', function (t) {
      arcCtl.hidden = t !== 'arc';
      cloudCtl.hidden = t !== 'cloud';
      dimCtl.hidden = !(X.DX_TOOLS && X.DX_TOOLS[t]);
      dimLookCtl.hidden = dimCtl.hidden;
      if (!dimLookCtl.hidden) syncRibbonLook();
      closeTc();
      filletCtl.hidden = t !== 'fillet';
      if (t !== 'fillet') fpick = null;
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

      calibrateDialog(pts).then(function (r) {
        if (!r) return;
        scale.unit = r.unit;
        scale.custom = r.value / pts;
        /* report it back as a drawing scale, which is what it really is */
        scale.denom = Math.max(1, Math.round((r.value / pts) / UNITS[r.unit].per));
        noteScale(); redrawDims();
        X.toast('Calibrated — about <b>1:' + scale.denom + '</b>, reading in ' + r.unit, true);
      });
    }

    /** The real length of a line pts long, asked in the app's own dialog:
        the number and its unit apart, the scale it comes to shown as it is
        typed, and a wrong entry said in the dialog rather than after it. */
    function calibrateDialog(pts) {
      const paperMm = pts * UNITS.mm.per;
      const units = Object.keys(UNITS).filter(function (u) { return u !== 'pt'; });
      const start = units.indexOf(scale.unit) >= 0 ? scale.unit : 'mm';
      const read = function (box) {
        const v = parseFloat(String(box.querySelector('#calVal').value).replace(/,/g, '').trim());
        return { value: v, unit: box.querySelector('#calUnit').value };
      };
      return X.dialog({
        title: 'Calibrate scale',
        ok: 'Calibrate',
        width: 420,
        body:
          '<p class="wdnote">The line you drew measures <b>' + X.esc(paperMm.toFixed(1)) +
            ' mm</b> on the page. Enter its real length, and every dimension is measured to match.</p>' +
          '<label class="wdlabel" for="calVal">Real length</label>' +
          '<div class="wdrow">' +
            '<input class="wdin" id="calVal" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="e.g. 1200">' +
            '<select class="wdsel" id="calUnit" aria-label="Unit">' +
              units.map(function (u) {
                return '<option value="' + u + '"' + (u === start ? ' selected' : '') + '>' + UNITS[u].label + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="wdpreview"><span>Drawing scale</span><b id="calScale">—</b></div>',
        open: function (box) {
          function paint() {
            const r = read(box);
            box.querySelector('#calScale').textContent = isFinite(r.value) && r.value > 0
              ? '1 : ' + Math.max(1, Math.round((r.value / pts) / UNITS[r.unit].per)).toLocaleString()
              : '—';
          }
          box.addEventListener('input', paint);
          box.addEventListener('change', paint);
        },
        value: function (box) {
          const r = read(box);
          if (!isFinite(r.value) || r.value <= 0) {
            return { error: 'Enter the real length as a number, for example 1200.', field: '#calVal' };
          }
          return r;
        },
      });
    }

    /* ---------------- drawing on screen ---------------- */

    function stroked(el, s, idx, it) {
      const sw = Math.max(0.6, s.w * S.scale);
      el.setAttribute('class', 'sh');
      el.style.stroke = s.nos ? 'none' : s.c;
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

    /** The ellipse as an SVG path on the page as shown: its four Bézier arcs
        (E.ellipseBezier), each point taken onto the screen. The page's own
        turn and zoom are a plain affine map, which keeps a Bézier exact, so
        the curve is the true ellipse at any zoom, not a polygon. */
    function ellipsePath(s, vp) {
      const P = E.ellipseBezier(s).map(function (q) { return vp.convertToViewportPoint(q[0], q[1]); });
      let d = 'M' + P[0][0] + ' ' + P[0][1];
      for (let i = 1; i + 2 < P.length; i += 3) {
        d += 'C' + P[i][0] + ' ' + P[i][1] + ' ' + P[i + 1][0] + ' ' + P[i + 1][1] + ' ' + P[i + 2][0] + ' ' + P[i + 2][1];
      }
      const el = document.createElementNS(SVGNS, 'path');
      el.setAttribute('d', d + 'Z');
      return el;
    }
    X.shapeRenderers.ellipse = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      if ((s.sa === 'in' || s.sa === 'out') && !s.nos && s.w) {
        /* the stroke aligned inside or outside: the fill on the edge, the
           outline on the edge moved in or out by half its width, as the PDF has it */
        const fillEl = ellipsePath(s, vp);
        stroked(fillEl, Object.assign({}, s, { nos: true }), idx, it);
        g.appendChild(fillEl);
        fillIn(g, fillEl, s, vp);
        const line = ellipsePath(E.strokeEllipse(s), vp);
        stroked(line, s, idx, it);
        g.appendChild(line);
        return g;
      }
      const el = ellipsePath(s, vp);
      stroked(el, s, idx, it);
      g.appendChild(el);
      fillIn(g, el, s, vp);
      return g;
    };

    /* a closed shape's fill (a colour or a gradient, core's paintFill), and its inside answering a click wherever it is
       filled or has no outline to click on (with neither, it would otherwise
       be impossible to pick out again) */
    function fillIn(g, el, s, vp) {
      X.paintFill(g, el, s, vp);
      if (s.fill || s.nos) el.style.pointerEvents = 'all';
    }

    X.shapeRenderers.cloud = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      /* closed, so it can be filled like a box */
      const el = stroked(polyline(cloudPts(s, 6), vp, true), s, idx, it);
      g.appendChild(el);
      fillIn(g, el, s, vp);
      return g;
    };

    X.shapeRenderers.arc = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      g.appendChild(stroked(polyline(arcPts(s, 48), vp, false), s, idx, it));
      return g;
    };

    /* a Continuous Line: straight segments through s.pts (PDF points), the
       same points the saved PDF draws between (packages/engine/src/painters/
       poly.ts) — no a/b, so it moves and resizes as a whole (core.js's
       markPts/moveShape/scaleBy already know a pts-only mark, the way ink
       and vpath work). */
    /** Snapped back onto its own first point (polySelfSnap), a line is a
        closed shape and can take a fill — same test the PDF side (poly.ts)
        makes from the saved points. */
    function polyClosed(s) {
      if (!s.pts || s.pts.length < 3) return false;
      const a = s.pts[0], b = s.pts[s.pts.length - 1];
      return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    }
    X.polyClosed = polyClosed;
    X.shapeRenderers.poly = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const el = polyline(s.pts, vp, false);
      stroked(el, s, idx, it);
      g.appendChild(el);
      if (polyClosed(s)) fillIn(g, el, s, vp);
      else el.style.stroke = s.c;               /* an open line always shows its line */
      return g;
    };

    /* a Pen path (js/pen.js): cubic Bézier segments, s.pts running anchor,
       out-handle, in-handle, anchor… — the same path the saved PDF draws
       (engine painters/pen.ts) */
    function penClosed(s) { return !!(s.pts && E.penClosed(s.pts, !!s.open)); }
    X.penClosed = penClosed;
    /* open: ends that meet without closing it (s.open) */
    function penD(pts, vp, open) {
      const v = pts.map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); });
      let d = 'M' + v[0][0] + ' ' + v[0][1];
      for (let i = 1; i + 2 < v.length; i += 3) {
        d += 'C' + v[i][0] + ' ' + v[i][1] + ' ' + v[i + 1][0] + ' ' + v[i + 1][1] + ' ' + v[i + 2][0] + ' ' + v[i + 2][1];
      }
      return E.penClosed(pts, !!open) ? d + 'Z' : d;
    }
    X.penD = penD;
    X.shapeRenderers.pen = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      if (!s.pts || s.pts.length < 4) return g;
      const el = document.createElementNS(SVGNS, 'path');
      el.setAttribute('d', penD(s.pts, vp, s.open));
      stroked(el, s, idx, it);
      g.appendChild(el);
      if (penClosed(s)) fillIn(g, el, s, vp);
      else el.style.stroke = s.c;               /* an open path always shows its line */
      return g;
    };
    X.handleKind.pen = 'bbox';

    X.shapeRenderers.dim = function (it, s0, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      /* the dimension's size (s.dz) scales the whole of it, its lines' weight
         too: s is drawn with that weight, s0 is the mark as stored */
      const z = E.dimScale(s0);                   /* the dimension's size */
      const s = z === 1 ? s0 : Object.assign({}, s0, { w: s0.w * z });
      const G = dimGeom(s);
      const toVp = function (p) { return vp.convertToViewportPoint(p[0], p[1]); };
      /* a and b, from here on, are where the dimension line itself runs —
         s.a/s.b (what it actually measures) only once off pulls it clear */
      const a = toVp(G.A);
      const b = toVp(G.B);
      const sw = Math.max(0.6, s.w * S.scale);
      const st = s.ds || 'arrow';
      const k = S.scale;                          /* points to screen pixels */

      function solid(el) {
        const e2 = stroked(el, s, idx, it);
        e2.style.strokeDasharray = 'none';
        return e2;
      }

      /* a dimension is a hairline: give the mouse a wider, unseen strip
         along it to take hold of, and the reading too (css: .anno .grab) */
      function grab(el) {
        el.classList.add('grab');
        if (idx >= 0) el.addEventListener('pointerdown', function (e) { X.beginDrag(it, idx, e, 'move'); });
        return el;
      }
      const hit = document.createElementNS(SVGNS, 'line');
      hit.setAttribute('x1', a[0]); hit.setAttribute('y1', a[1]);
      hit.setAttribute('x2', b[0]); hit.setAttribute('y2', b[1]);
      hit.style.stroke = 'transparent';
      hit.style.strokeWidth = Math.max(sw, 12);
      hit.style.strokeLinecap = 'round';
      g.appendChild(grab(hit));

      /* pulled clear of a-b: a short extension line from each real point out
         to where the dimension line runs (painters/draw.ts has the same gap
         and overshoot, in PDF points so it comes out identical on paper) */
      if (Math.abs(G.off) > 0.5) {
        const sign = G.off > 0 ? 1 : -1, gap = 2 * sign * z, over = 3 * sign * z;
        [s.a, s.b].forEach(function (pt) {
          const p1 = toVp([pt[0] + G.nx * gap, pt[1] + G.ny * gap]);
          const p2 = toVp([pt[0] + G.nx * (G.off + over), pt[1] + G.ny * (G.off + over)]);
          const el = document.createElementNS(SVGNS, 'line');
          el.setAttribute('x1', p1[0]); el.setAttribute('y1', p1[1]);
          el.setAttribute('x2', p2[0]); el.setAttribute('y2', p2[1]);
          const e2 = solid(el);
          e2.style.strokeWidth = Math.max(0.6, Math.min(s0.w, 1) * z * k);
          g.appendChild(e2);
        });
      }

      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', a[0]); line.setAttribute('y1', a[1]);
      line.setAttribute('x2', b[0]); line.setAttribute('y2', b[1]);
      g.appendChild(stroked(line, s, idx, it));

      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;

      /* the extension bars that close each end, perpendicular to the run:
         in page points, as the PDF has them, so they keep to the drawing at
         every zoom (painters/draw.ts) */
      const ext = ((st === 'arrow' ? 4 : 6) * z + s.w) * k;
      const nx = -uy * ext, ny = ux * ext;
      [a, b].forEach(function (end) {
        const t = document.createElementNS(SVGNS, 'line');
        t.setAttribute('x1', end[0] - nx); t.setAttribute('y1', end[1] - ny);
        t.setAttribute('x2', end[0] + nx); t.setAttribute('y2', end[1] + ny);
        g.appendChild(st === 'arrow' ? stroked(t, s, idx, it) : solid(t));
      });

      if (st === 'tick') {
        /* architectural ticks: a heavier 45° slash through each end */
        const h = (3.5 + s0.w * 1.2) * k * z;
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
        const r = (1.6 + s0.w * 0.9) * k * z;
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
          /* its size in points, as the PDF draws it (9 pt at least), then
             zoomed: the helper's minimum is in the units it is given */
          const tip = pair[0];
          const h = X.arrowHead(pair[1][0], pair[1][1], tip[0], tip[1], s0.w * 1.1).map(function (q) {
            return [tip[0] + (q[0] - tip[0]) * k * z, tip[1] + (q[1] - tip[1]) * k * z];
          });
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
        /* as the PDF has it, part of the drawing at every zoom: its size on
           paper, the baseline (line width + 2) pt over the line, on a pale
           plate 2 pt wider and 1.5 pt taller each side (painters/draw.ts) */
        size = dimTextPt(s0) * k;
        const t0 = ang * Math.PI / 180;
        const up = [Math.sin(t0), -Math.cos(t0)];
        const base = (s.w + 2 * z) * k;
        const px = mx + up[0] * (base + size * 0.5), py = my + up[1] * (base + size * 0.5);
        const pw = textPx(text, size, s) + 4 * z * k, ph = size + 3 * z * k;
        const pad = document.createElementNS(SVGNS, 'rect');
        pad.setAttribute('x', px - pw / 2); pad.setAttribute('y', py - ph / 2);
        pad.setAttribute('width', pw); pad.setAttribute('height', ph);
        pad.setAttribute('transform', 'rotate(' + ang + ' ' + px + ' ' + py + ')');
        pad.style.fill = 'rgba(255,255,255,.8)';
        g.appendChild(grab(pad));
        /* the middle of a capital is about 0.36 of a size over the baseline */
        mx += up[0] * (base + size * 0.36); my += up[1] * (base + size * 0.36);
      } else {
        /* above the line and clear of it, at the size the PDF will print */
        size = dimTextPt(s0) * k;
        const t0 = ang * Math.PI / 180;
        const lift = (s.w + 2 * z) * k + size * 0.5;
        mx += Math.sin(t0) * lift; my -= Math.cos(t0) * lift;
      }

      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', mx); t.setAttribute('y', my);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('transform', 'rotate(' + ang + ' ' + mx + ' ' + my + ')');
      t.textContent = text;
      readingStyle(t, s, size);
      g.appendChild(grab(t));
      return g;
    };

    /* Dimension readings, drawn with the same embedded webfont the Text tool
       offers (js/fonts.js) rather than the system's own Helvetica/Arial,
       so the reading is crisp and consistent wherever the PDF is opened
       (packages/engine/src/painters/draw.ts embeds the matching file). */
    const DIM_FONT = '"ADG Inter", Helvetica, Arial, sans-serif';
    const STD_CSS = {
      helv: 'Helvetica, Arial, sans-serif',
      times: '"Times New Roman", Times, serif',
      cour: '"Courier New", Courier, monospace'
    };
    /* A reading's own font (s.df, s.db, s.di — the same families the Text
       tool has), as CSS: with none set, the semibold Inter it always had. */
    function readingFont(s) {
      const GF = window.ADDDOTS_FONTS;
      /* a standard font that cannot draw the typed reading gives way to
         Inter, as the saved PDF does (E.dimFontFallsBack) */
      const df = s.df && !E.dimFontFallsBack(s) ? s.df : '';
      const fam = !df ? DIM_FONT : STD_CSS[df] || (GF && GF.css(df)) || DIM_FONT;
      const bold = s.db !== false && s.db !== 0;
      return {
        family: fam,
        weight: bold ? (df ? '700' : '600') : '400',
        style: s.di ? 'italic' : 'normal'
      };
    }
    function readingStyle(t, s, size) {
      const f = readingFont(s);
      t.style.fill = E.dimTextColor(s);
      t.style.fontFamily = f.family;
      t.style.fontWeight = f.weight;
      t.style.fontStyle = f.style;
      t.style.fontSize = size + 'px';
    }

    /** The reading's size on paper, in points — shared by screen and PDF. */
    function dimTextPt(s) { return E.dimTextPt(s); }

    /* core draws the grips; tell it which style each mark wants */
    X.handleKind.ellipse = 'rect';
    X.handleKind.cloud = 'rect';
    X.handleKind.arc = 'line';
    X.handleKind.dim = 'line';
    X.handleKind.poly = 'verts';

    /* ---------------- writing into the PDF ---------------- */

    /* read at save time, so the readings match what the editor shows (the
       painters are E.drawPainters, in E.saveHooks) */
    X.saveState.scale = function () { return scale; };

    /* ---------------- the tools ---------------- */

    let drag = null;

    function common(t) {
      return {
        colors: true, widths: true,
        down: function (it, at, e) {
          if (!it.vp) return;
          drag = { it: it, a: pdfAt(it, at, e) };
          /* the point it started from sends out its own guides until it ends */
          trackStart(it, drag.a);
        },
        move: function (it, at, e) {
          if (!drag || drag.it !== it) return;
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const sn = X.snapPt(it, raw, e);
          drag.snap = sn;
          /* a snap point wins over Shift; Alt still flips an arc */
          const g = ghost(t, drag.a, sn || raw, sn ? { altKey: e && e.altKey } : e);
          X.drawShapes(it, g);
          readShow(it, g.a, g.b);
        },
        cancel: function (it) {
          /* a second finger landed: throw the half-drawn mark away */
          if (!drag) return;
          drag = null;
          trackStart(it, null);
          readHide();
          X.drawShapes(it);
        },
        up: function (it, at, e) {
          if (!drag || drag.it !== it) return;
          const a = drag.a, raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const sn = X.snapPt(it, raw, e);
          drag = null;
          snapHide();
          readHide();
          /* the drawing is finished: its guides and the points acquired for it
             go back, so none of them carries into the next one */
          trackStart(it, null);
          const g = ghost(t, a, sn || raw, sn ? { altKey: e && e.altKey } : e);
          if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 3) { X.drawShapes(it); return; }

          if (t === 'dim' && calibrating) { X.drawShapes(it); finishCalibration(g); return; }

          X.snapshot();
          it.shapes.push(g);
          X.drawShapes(it); X.drawThumb(it); X.updateMeta();
          if (t === 'dim') {
            X.toast('<b>' + measure(g) + '</b>');
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
      if (t === 'dim') applyLook(s);
      return s;
    }

    X.tools.ellipse = ellipseTool();

    /* ---------------- the Ellipse tool (L) ----------------
       As Illustrator's: drag from one corner of the ellipse's box to the
       other, with a live preview and its width and height by the pointer.
       Shift keeps it a perfect circle, Alt draws it out from the centre
       (both together: a circle from its centre), and holding Space moves the
       whole ellipse, size kept, until it is let go and sizing carries on.
       The modifiers are read as they change, not only when the pointer
       moves. Esc throws the drawing away and keeps the tool. A click with no
       drag asks for the width and height and draws it from that point.

       Every point snaps as the other drawing tools' do (snapPt): to anchor
       points, edges, centres, crossings, the grid and ruler guides, and in
       line with other marks along a smart guide. With Shift the circle's
       proportion wins over a snap.

       A new ellipse takes the look set in the tool's bar: the stroke colour
       and width every drawing tool shares, and its own fill (or none), no
       stroke, solid or dashed, opacity and stroke alignment, kept for next
       time. */
    const ELL_KEY = 'adpdf.ellipseLook';
    const ELL_DEFAULT = { fill: null, fillC: '#FFFFFF', nos: false, d: 0, o: 1, sa: '' };
    let ellLook = (function () {
      try { return Object.assign({}, ELL_DEFAULT, JSON.parse(localStorage.getItem(ELL_KEY) || '{}')); }
      catch (e) { return Object.assign({}, ELL_DEFAULT); }
    })();
    function keepEllLook() { try { localStorage.setItem(ELL_KEY, JSON.stringify(ellLook)); } catch (e) { /* this session only */ } }
    /** A new ellipse with the tool's look, over box a-b (any two corners). */
    function ellipseMark(a, b) {
      const m = { t: 'ellipse', a: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], b: [Math.max(a[0], b[0]), Math.max(a[1], b[1])], c: S.color, w: S.width };
      if (ellLook.fill) m.fill = ellLook.fill;
      if (ellLook.nos) m.nos = true;
      if (ellLook.d) m.d = ellLook.d;
      if (ellLook.o != null && ellLook.o < 1) m.o = ellLook.o;
      if (ellLook.sa) m.sa = ellLook.sa;
      return m;
    }
    /** The ellipse's box from where the drag began (a) to the pointer (p):
        Shift squares it, Alt makes a its centre. */
    function ellipseBox(a, p, shift, alt) {
      let dx = p[0] - a[0], dy = p[1] - a[1];
      if (shift) {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (dx < 0 ? -1 : 1) * m; dy = (dy < 0 ? -1 : 1) * m;
      }
      return alt ? { a: [a[0] - dx, a[1] - dy], b: [a[0] + dx, a[1] + dy] } : { a: [a[0], a[1]], b: [a[0] + dx, a[1] + dy] };
    }
    X.ellipseBox = ellipseBox;

    function ellipseTool() {
      return boxTool({
        t: 'ellipse', label: 'Ellipse',
        mark: function (g) { return ellipseMark(g.a, g.b); },
        read: function (it, m, p) { readBox(it, m, p); },
        ask: askEllipseSize
      });
    }

    /* The drag both the Ellipse and the Rectangle tools draw with, as
       Illustrator's: from one corner of the box to the other, with a live
       preview and its size by the pointer. Shift keeps it square (a circle),
       Alt draws it out from its centre (both: a square from its centre),
       and holding Space moves the whole shape, its size kept, until it is
       let go and sizing carries on. The modifiers are read as they change,
       not only when the pointer moves. Esc throws the drawing away and keeps
       the tool; a click with no drag asks for the size (cfg.ask). cfg.key
       takes any other key while drawing (the Rectangle's corner radius). */
    function boxTool(cfg) {
      let d = null;     /* { it, a, p, shift, alt, space: { from, a0 } | null, moved, at0 } */
      function geom() { return ellipseBox(d.a, d.p, d.shift, d.alt); }
      function render() {
        if (!d) return;
        const m = cfg.mark(geom(), d);
        X.drawShapes(d.it, m);
        cfg.read(d.it, m, d.p, d);
      }
      /* where the pointer is, snapped (Shift's proportion beats a snap) */
      function pointer(it, at, e) {
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        if (d && d.space) { snapHide(); return [raw[0], raw[1]]; }
        if (e && e.shiftKey) { snapHide(); if (X.hideSmartGuide) X.hideSmartGuide(); return [raw[0], raw[1]]; }
        const sn = X.snapPt(it, raw, e);
        return sn ? [sn[0], sn[1]] : [raw[0], raw[1]];
      }
      function end() {
        d = null;
        snapHide(); readHide();
        trackStart(null, null);
        if (X.hideSmartGuide) X.hideSmartGuide();
      }
      const tool = {
        colors: true, widths: true,
        down: function (it, at, e) {
          if (!it.vp || (e && e.button > 0)) return;
          const a = pdfAt(it, at, e);
          d = { it: it, a: [a[0], a[1]], p: [a[0], a[1]], shift: !!(e && e.shiftKey), alt: !!(e && e.altKey),
                space: null, moved: false, at0: [at[0], at[1]] };
          trackStart(it, d.a);
          /* the drag keeps coming here even off the page's edge */
          if (e && e.pointerId != null) { try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* a mouse draws without it */ } }
        },
        move: function (it, at, e) {
          if (!d || d.it !== it) return;
          if (Math.hypot(at[0] - d.at0[0], at[1] - d.at0[1]) > 2) d.moved = true;
          d.shift = !!(e && e.shiftKey); d.alt = !!(e && e.altKey);
          const p = pointer(it, at, e);
          if (d.space) {
            /* Space held: the whole shape follows the pointer, its size kept */
            const dx = p[0] - d.space.from[0], dy = p[1] - d.space.from[1];
            d.a = [d.space.a0[0] + dx, d.space.a0[1] + dy];
          }
          d.p = p;
          render();
        },
        cancel: function (it) { if (!d) return; end(); X.drawShapes(it); },
        up: function (it, at, e) {
          if (!d || d.it !== it) return;
          const was = d;
          if (!was.moved) {
            /* a click: its size typed in, drawn from the point clicked
               (its centre with Alt), as Illustrator asks */
            end();
            X.drawShapes(it);
            cfg.ask(it, was.a, !!(e && e.altKey));
            return;
          }
          tool.move(it, at, e);
          const m = cfg.mark(geom(), d);
          end();
          if (m.b[0] - m.a[0] < 0.5 && m.b[1] - m.a[1] < 0.5) { X.drawShapes(it); return; }
          X.snapshot();
          it.shapes.push(m);
          X.drawShapes(it); X.drawThumb(it); X.updateMeta();
          /* on a phone the tool is put down and the new shape left selected */
          if (X.isMobile && X.isMobile() && X.endToolOn) X.endToolOn(it);
        },
        /* the modifiers changed with the pointer still: the preview follows */
        key: function (e, down) {
          if (!d) return false;
          if (e.key === 'Shift') { d.shift = down; render(); return false; }
          if (e.key === 'Alt') { d.alt = down; render(); return true; }
          if (e.key === ' ' || e.code === 'Space') {
            if (down && !d.space) d.space = { from: [d.p[0], d.p[1]], a0: [d.a[0], d.a[1]] };
            else if (!down) d.space = null;
            return true;
          }
          if (e.key === 'Escape' && down) { const it = d.it; end(); X.drawShapes(it); X.toast(cfg.label + ' cancelled'); return true; }
          if (cfg.key && cfg.key(e, down, d)) { render(); return true; }
          return false;
        },
        drawing: function () { return !!d; }
      };
      /* ahead of Space-to-pan (js/navigate.js), the arrow keys' page turns
         and core's Escape, and only while this shape is being drawn */
      ['keydown', 'keyup'].forEach(function (type) {
        window.addEventListener(type, function (e) {
          if (S.tool !== cfg.t || !d) return;
          if (type === 'keydown' && e.repeat && (e.key === ' ' || e.code === 'Space')) { e.preventDefault(); e.stopImmediatePropagation(); return; }
          if (tool.key(e, type === 'keydown')) { e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);
      });
      window.addEventListener('blur', function () { if (d) { d.space = null; d.shift = false; d.alt = false; } });
      return tool;
    }

    /** The width and height beside the pointer while an ellipse is drawn. */
    function readBox(it, m, p, extra) {
      if (!it.anno) return;
      const r = it.anno.getBoundingClientRect();
      const w = m.b[0] - m.a[0], h = m.b[1] - m.a[1];
      if (w < 0.5 && h < 0.5) { readHide(); return; }
      const v = it.vp.convertToViewportPoint(p[0], p[1]);
      readout.textContent = 'W ' + measureLen(w) + '   H ' + measureLen(h) + (extra ? '   ' + extra : '');
      readout.style.transform = 'translate(' + Math.round(r.left + v[0] + 14) + 'px,' + Math.round(r.top + v[1] + 34) + 'px)';
      readout.hidden = false;
      if (!startDot.hidden) startDot.hidden = true;
    }

    /** Illustrator's Ellipse dialog: a click with no drag asks for the size. */
    function askEllipseSize(it, at, centre) {
      const last = ellLook.lastWH || [72, 72];
      X.dialog({
        title: 'Ellipse',
        ok: 'OK',
        width: 360,
        body:
          '<div class="wdrow ellwh">' +
            '<label class="wdlabel" for="ellW">Width</label><span class="unit"><input class="wdin" id="ellW" inputmode="decimal" value="' + last[0] + '"><em>pt</em></span>' +
            '<label class="wdlabel" for="ellH">Height</label><span class="unit"><input class="wdin" id="ellH" inputmode="decimal" value="' + last[1] + '"><em>pt</em></span>' +
          '</div>' +
          '<label class="prchk ellcircle"><input type="checkbox" id="ellRound"' + (last[0] === last[1] ? ' checked' : '') + '> Keep it a circle</label>',
        open: function (box) {
          const W = box.querySelector('#ellW'), H = box.querySelector('#ellH'), R = box.querySelector('#ellRound');
          W.addEventListener('input', function () { if (R.checked) H.value = W.value; });
          H.addEventListener('input', function () { if (R.checked) W.value = H.value; });
          R.addEventListener('change', function () { if (R.checked) H.value = W.value; });
        },
        value: function (box) {
          const w = parseFloat(box.querySelector('#ellW').value), h = parseFloat(box.querySelector('#ellH').value);
          if (!(w > 0 && w <= 20000)) return { error: 'Width: a size from 0 to 20000 pt', field: '#ellW' };
          if (!(h > 0 && h <= 20000)) return { error: 'Height: a size from 0 to 20000 pt', field: '#ellH' };
          return { w: w, h: h };
        }
      }).then(function (v) {
        if (!v) return;
        ellLook.lastWH = [v.w, v.h]; keepEllLook();
        const g = boxAtClick(it, at, centre, v.w, v.h), a = g.a, b = g.b;
        X.snapshot();
        it.shapes.push(ellipseMark(a, b));
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      });
    }

    /* ---- the tool's bar: the look the next ellipse takes ---- */
    const ellCtl = ctl('ellCtl',
      '<span class="anno-lbl">Fill</span>' +
      '<input type="color" id="ellFill" aria-label="Fill colour">' +
      '<label class="anno-lbl ellchk"><input type="checkbox" id="ellNoFill"> None</label>' +
      '<span class="anno-lbl">Stroke</span>' +
      '<label class="anno-lbl ellchk"><input type="checkbox" id="ellNoStroke"> None</label>' +
      '<select id="ellDash" aria-label="Stroke style"><option value="0">━━━ Solid</option><option value="1">━ ━ Dashed</option><option value="2">· · · Dotted</option></select>' +
      '<select id="ellAlign" aria-label="Stroke alignment"><option value="">Align centre</option><option value="in">Align inside</option><option value="out">Align outside</option></select>' +
      '<span class="anno-lbl">Opacity</span>' +
      '<input type="number" id="ellOp" min="0" max="100" step="1" aria-label="Opacity, in percent"><span class="anno-lbl">%</span>');
    function syncEllCtl() {
      $('ellFill').value = ellLook.fill || ellLook.fillC || '#FFFFFF';
      $('ellNoFill').checked = !ellLook.fill;
      $('ellFill').disabled = !ellLook.fill;
      $('ellNoStroke').checked = !!ellLook.nos;
      $('ellDash').value = String(ellLook.d || 0);
      $('ellAlign').value = ellLook.sa || '';
      $('ellOp').value = Math.round((ellLook.o == null ? 1 : ellLook.o) * 100);
    }
    ellCtl.addEventListener('change', function (e) {
      const id = e.target.id;
      if (id === 'ellFill') { ellLook.fill = e.target.value.toUpperCase(); ellLook.fillC = ellLook.fill; }
      else if (id === 'ellNoFill') ellLook.fill = e.target.checked ? null : (ellLook.fillC || '#FFFFFF');
      else if (id === 'ellNoStroke') ellLook.nos = e.target.checked;
      else if (id === 'ellDash') ellLook.d = +e.target.value || 0;
      else if (id === 'ellAlign') ellLook.sa = e.target.value;
      else if (id === 'ellOp') ellLook.o = Math.max(0, Math.min(100, +e.target.value || 0)) / 100;
      /* never neither: with no fill and no stroke an ellipse could not be seen or picked */
      if (!ellLook.fill && ellLook.nos) {
        if (id === 'ellNoStroke') { ellLook.fill = ellLook.fillC || '#FFFFFF'; X.toast('An ellipse needs a fill or a stroke: fill turned on'); }
        else { ellLook.nos = false; X.toast('An ellipse needs a fill or a stroke: stroke turned on'); }
      }
      keepEllLook();
      syncEllCtl();
    });
    X.on('tool', function (t) { ellCtl.hidden = t !== 'ellipse'; if (t === 'ellipse') syncEllCtl(); });
    syncEllCtl();

    /* ---- on the selected ellipse's properties: its exact place and size,
       stroke alignment, a circle at a click, and Convert to Path ---- */
    const ellPop = document.createElement('div');
    ellPop.className = 'mpell';
    ellPop.innerHTML =
      '<label class="mfield"><span>X</span><span class="unit"><input id="ellPX" inputmode="decimal" aria-label="Left edge, in points"><em>pt</em></span></label>' +
      '<label class="mfield"><span>Y</span><span class="unit"><input id="ellPY" inputmode="decimal" aria-label="Top edge from the top of the page, in points"><em>pt</em></span></label>' +
      '<label class="mfield"><span>W</span><span class="unit"><input id="ellPW" inputmode="decimal" aria-label="Width, in points"><em>pt</em></span></label>' +
      '<label class="mfield"><span>H</span><span class="unit"><input id="ellPH" inputmode="decimal" aria-label="Height, in points"><em>pt</em></span></label>' +
      '<button class="cbtn ellbtn" id="ellPLock" type="button" title="Keep width and height in proportion" aria-pressed="false">⛓</button>' +
      '<label class="mfield"><span>Align</span><select id="ellPAlign" aria-label="Stroke alignment"><option value="">Centre</option><option value="in">Inside</option><option value="out">Outside</option></select></label>' +
      '<button class="cbtn ellbtn" id="ellPCircle" type="button" title="Make it a circle (its width for both)">Circle</button>' +
      '<button class="cbtn ellbtn" id="ellPPath" type="button" title="Convert to a Pen path: anchor points and handles to edit with Direct Selection">Convert to Path</button>';
    /* by id inside the panel itself: it is only in the page while an ellipse is selected */
    const ellQ = function (id) { return ellPop.querySelector('#' + id); };
    let ellLock = false;
    function ellSel() {
      const sh = S.sel && S.sel.it && S.sel.it.shapes[S.sel.i];
      return sh && sh.t === 'ellipse' ? sh : null;
    }
    /* the page's top, for Y measured down from it as on screen */
    function pageTop(it) { return it.vp ? it.vp.convertToPdfPoint(0, 0)[1] : 0; }
    const r2 = function (v) { return Math.round(v * 100) / 100; };
    X.markPop.ellipse = {
      el: ellPop,
      sync: function (sh) {
        const it = S.sel.it, b = E.boxOf(sh);
        const set = function (id, v) { if (document.activeElement !== $(id)) $(id).value = r2(v); };
        set('ellPX', b.x1); set('ellPY', Math.abs(pageTop(it) - b.y2));
        set('ellPW', b.x2 - b.x1); set('ellPH', b.y2 - b.y1);
        ellQ('ellPAlign').value = sh.sa || '';
        ellQ('ellPLock').classList.toggle('on', ellLock);
        ellQ('ellPLock').setAttribute('aria-pressed', ellLock ? 'true' : 'false');
      }
    };
    function ellChange(fn) {
      const sh = ellSel();
      if (!sh) return;
      X.snapshot();
      /* every ellipse selected takes it */
      const it = S.sel.it;
      X.selList().forEach(function (i) { const m = it.shapes[i]; if (m && m.t === 'ellipse' && !m.locked) fn(m, it); });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
    }
    function ellNum(id) { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : null; }
    ellPop.addEventListener('change', function (e) {
      const id = e.target.id;
      if (id === 'ellPAlign') { ellChange(function (m) { if (e.target.value) m.sa = e.target.value; else delete m.sa; }); return; }
      const v = ellNum(id);
      if (v == null) { X.syncMarkPop(); return; }
      ellChange(function (m, it) {
        const b = E.boxOf(m), w = b.x2 - b.x1, h = b.y2 - b.y1;
        if (id === 'ellPX') { m.a = [v, b.y1]; m.b = [v + w, b.y2]; }
        else if (id === 'ellPY') { const top = pageTop(it); const y2 = top >= b.y2 ? top - v : top + v; m.a = [b.x1, y2 - h]; m.b = [b.x2, y2]; }
        else if (id === 'ellPW' || id === 'ellPH') {
          /* sized about its centre, as Illustrator's W and H do with the centre reference point */
          let nw = id === 'ellPW' ? Math.max(0.01, v) : w, nh = id === 'ellPH' ? Math.max(0.01, v) : h;
          if (ellLock && w > 0 && h > 0) { if (id === 'ellPW') nh = h * nw / w; else nw = w * nh / h; }
          const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
          m.a = [cx - nw / 2, cy - nh / 2]; m.b = [cx + nw / 2, cy + nh / 2];
        }
      });
    });
    ellPop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); }
    });
    ellQ('ellPLock').addEventListener('click', function () { ellLock = !ellLock; X.syncMarkPop(); });
    ellQ('ellPCircle').addEventListener('click', function () {
      ellChange(function (m) {
        const b = E.boxOf(m), side = b.x2 - b.x1, cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
        m.a = [cx - side / 2, cy - side / 2]; m.b = [cx + side / 2, cy + side / 2];
      });
    });
    /* Convert to Path: the same four Bézier arcs as a Pen path, its look kept,
       its anchors and handles then edited with Direct Selection (js/pen.js) */
    ellQ('ellPPath').addEventListener('click', function () {
      const sh = ellSel();
      if (!sh) return;
      const it = S.sel.it;
      X.snapshot();
      const made = [];
      X.selList().forEach(function (i) {
        const m = it.shapes[i];
        if (!m || m.t !== 'ellipse' || m.locked) return;
        const pen = { t: 'pen', pts: E.ellipseBezier(m).map(function (q) { return [q[0], q[1]]; }) };
        Object.keys(m).forEach(function (k) { if (k !== 't' && k !== 'a' && k !== 'b' && k !== 'r' && k !== 'sa') pen[k] = m[k]; });
        it.shapes[i] = pen;
        made.push(i);
      });
      X.setGroup(it, made);
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
      X.toast('Converted to a path: Direct Selection (Shift+V) edits its points');
    });
    /* ---------------- the Rectangle tool (X) ----------------
       The box tool upgraded to Illustrator's Rectangle tool, drawing core's
       own 'rect' mark (so selecting, the bounding box's grips, turning,
       moving, layers, undo, Save and the thumbnails all stay core's). It
       draws as the Ellipse does (boxTool): from corner to corner with a live
       preview and its width and height by the pointer; Shift a square, Alt
       from the centre, both a square from its centre, Space to move it
       while drawing, Esc to throw it away, a click with no drag to type its
       size. Its corner point snaps to the Snap Engine and the smart guides.

       Its corners round as Illustrator's live rectangle's do (s.rr, or
       s.rc one each, engine rect.ts): while drawing ↑ and ↓ round them a
       point at a time, ← squares them and → rounds them fully; on a
       selected rectangle the corner widgets inside its corners are dragged
       to round them all (Alt: that corner alone), and its properties take
       an exact radius for all four or each. A new rectangle takes the look
       set in the tool's bar — fill (or none), no stroke, solid or dashed,
       stroke alignment, opacity and corner radius — kept for next time. */
    const RECT_KEY = 'adpdf.rectLook';
    const RECT_DEFAULT = { fill: null, fillC: '#FFFFFF', nos: false, d: 0, o: 1, sa: '', rr: 0 };
    let rectLook = (function () {
      try { return Object.assign({}, RECT_DEFAULT, JSON.parse(localStorage.getItem(RECT_KEY) || '{}')); }
      catch (e) { return Object.assign({}, RECT_DEFAULT); }
    })();
    function keepRectLook() { try { localStorage.setItem(RECT_KEY, JSON.stringify(rectLook)); } catch (e) { /* this session only */ } }
    const rr2 = function (v) { return Math.round(v * 100) / 100; };
    /** A new rectangle with the tool's look, over box a-b (any two corners). */
    function rectMark(a, b, rr) {
      const m = { t: 'rect', a: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], b: [Math.max(a[0], b[0]), Math.max(a[1], b[1])], c: S.color, w: S.width };
      if (rectLook.fill) m.fill = rectLook.fill;
      if (rectLook.nos) m.nos = true;
      if (rectLook.d) m.d = rectLook.d;
      if (rectLook.o != null && rectLook.o < 1) m.o = rectLook.o;
      if (rectLook.sa) m.sa = rectLook.sa;
      const r = rr == null ? rectLook.rr : rr;
      if (r > 0) m.rr = rr2(r);
      return m;
    }
    X.rectMark = rectMark;

    X.tools.rect = boxTool({
      t: 'rect', label: 'Rectangle',
      mark: function (g, d) { return rectMark(g.a, g.b, d && d.rr != null ? d.rr : null); },
      read: function (it, m, p) {
        readBox(it, m, p, E.rectRounded(m) ? 'R ' + measureLen(E.rectRadii(m)[0]) : '');
      },
      ask: askRectSize,
      /* ↑ ↓ round the corners a point at a time (Shift: ten), ← squares
         them, → rounds them as far as the box allows */
      key: function (e, down, d) {
        if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return false;
        if (!down) return true;
        const g = ellipseBox(d.a, d.p, d.shift, d.alt);
        const max = E.rectMaxRadius(g);
        let r = d.rr != null ? d.rr : (rectLook.rr || 0);
        r = Math.min(r, max);
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') r = Math.min(max, r + step);
        else if (e.key === 'ArrowDown') r = Math.max(0, r - step);
        else if (e.key === 'ArrowLeft') r = 0;
        else r = max;
        d.rr = rr2(r);
        rectLook.rr = d.rr; keepRectLook();
        if (!rectCtl.hidden) syncRectCtl();
        return true;
      }
    });

    /** Box a-b for a size typed in at a click: the click its top-left corner
        as the page is seen (down and right on the screen, whatever the page's
        turn), or with Alt its centre. */
    function boxAtClick(it, at, centre, w, h) {
      if (centre) return { a: [at[0] - w / 2, at[1] - h / 2], b: [at[0] + w / 2, at[1] + h / 2] };
      const o = it.vp.convertToViewportPoint(at[0], at[1]);
      const q = it.vp.convertToPdfPoint(o[0] + 1, o[1] + 1);
      const sx = q[0] >= at[0] ? 1 : -1, sy = q[1] >= at[1] ? 1 : -1;
      return { a: [at[0], at[1]], b: [at[0] + sx * w, at[1] + sy * h] };
    }

    /** Illustrator's Rectangle dialog: a click with no drag asks for the size
        and the corner radius. */
    function askRectSize(it, at, centre) {
      const last = rectLook.lastWH || [72, 72];
      X.dialog({
        title: 'Rectangle',
        ok: 'OK',
        width: 380,
        body:
          '<div class="wdrow ellwh">' +
            '<label class="wdlabel" for="rectW">Width</label><span class="unit"><input class="wdin" id="rectW" inputmode="decimal" value="' + last[0] + '"><em>pt</em></span>' +
            '<label class="wdlabel" for="rectH">Height</label><span class="unit"><input class="wdin" id="rectH" inputmode="decimal" value="' + last[1] + '"><em>pt</em></span>' +
          '</div>' +
          '<label class="prchk ellcircle"><input type="checkbox" id="rectLink"> Constrain proportions</label>' +
          '<div class="wdrow ellwh ellcircle">' +
            '<label class="wdlabel" for="rectR">Corner radius</label><span class="unit"><input class="wdin" id="rectR" inputmode="decimal" value="' + (rectLook.rr || 0) + '"><em>pt</em></span>' +
          '</div>',
        open: function (box) {
          const W = box.querySelector('#rectW'), H = box.querySelector('#rectH'), L = box.querySelector('#rectLink');
          let ratio = 1;
          const num = function (el) { return parseFloat(String(el.value).replace(',', '.')); };
          L.addEventListener('change', function () { const w = num(W), h = num(H); ratio = w > 0 && h > 0 ? h / w : 1; });
          W.addEventListener('input', function () { const w = num(W); if (L.checked && w > 0) H.value = rr2(w * ratio); });
          H.addEventListener('input', function () { const h = num(H); if (L.checked && h > 0) W.value = rr2(h / ratio); });
        },
        value: function (box) {
          const num = function (id) { return parseFloat(String(box.querySelector(id).value).replace(',', '.')); };
          const w = num('#rectW'), h = num('#rectH'), r = num('#rectR');
          if (!(w > 0 && w <= 20000)) return { error: 'Width: a size from 0 to 20000 pt', field: '#rectW' };
          if (!(h > 0 && h <= 20000)) return { error: 'Height: a size from 0 to 20000 pt', field: '#rectH' };
          if (!(r >= 0 && r <= 10000)) return { error: 'Corner radius: 0 or more, in points', field: '#rectR' };
          return { w: w, h: h, r: r };
        }
      }).then(function (v) {
        if (!v) return;
        rectLook.lastWH = [v.w, v.h]; rectLook.rr = v.r; keepRectLook();
        if (!rectCtl.hidden) syncRectCtl();
        const g = boxAtClick(it, at, centre, v.w, v.h);
        X.snapshot();
        it.shapes.push(rectMark(g.a, g.b, v.r));
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      });
    }

    /* ---- the tool's bar: the look the next rectangle takes ---- */
    const rectCtl = ctl('rectCtl',
      '<span class="anno-lbl">Fill</span>' +
      '<input type="color" id="rectFill" aria-label="Fill colour">' +
      '<label class="anno-lbl ellchk"><input type="checkbox" id="rectNoFill"> None</label>' +
      '<span class="anno-lbl">Stroke</span>' +
      '<label class="anno-lbl ellchk"><input type="checkbox" id="rectNoStroke"> None</label>' +
      '<select id="rectDash" aria-label="Stroke style"><option value="0">━━━ Solid</option><option value="1">━ ━ Dashed</option><option value="2">· · · Dotted</option></select>' +
      '<select id="rectAlign" aria-label="Stroke alignment"><option value="">Align centre</option><option value="in">Align inside</option><option value="out">Align outside</option></select>' +
      '<span class="anno-lbl" title="Corner radius: ↑ and ↓ change it while drawing">Corners</span>' +
      '<input type="number" id="rectRad" min="0" step="1" aria-label="Corner radius, in points"><span class="anno-lbl">pt</span>' +
      '<span class="anno-lbl">Opacity</span>' +
      '<input type="number" id="rectOp" min="0" max="100" step="1" aria-label="Opacity, in percent"><span class="anno-lbl">%</span>');
    function syncRectCtl() {
      $('rectFill').value = rectLook.fill || rectLook.fillC || '#FFFFFF';
      $('rectNoFill').checked = !rectLook.fill;
      $('rectFill').disabled = !rectLook.fill;
      $('rectNoStroke').checked = !!rectLook.nos;
      $('rectDash').value = String(rectLook.d || 0);
      $('rectAlign').value = rectLook.sa || '';
      if (document.activeElement !== $('rectRad')) $('rectRad').value = rr2(rectLook.rr || 0);
      $('rectOp').value = Math.round((rectLook.o == null ? 1 : rectLook.o) * 100);
    }
    rectCtl.addEventListener('change', function (e) {
      const id = e.target.id;
      if (id === 'rectFill') { rectLook.fill = e.target.value.toUpperCase(); rectLook.fillC = rectLook.fill; }
      else if (id === 'rectNoFill') rectLook.fill = e.target.checked ? null : (rectLook.fillC || '#FFFFFF');
      else if (id === 'rectNoStroke') rectLook.nos = e.target.checked;
      else if (id === 'rectDash') rectLook.d = +e.target.value || 0;
      else if (id === 'rectAlign') rectLook.sa = e.target.value;
      else if (id === 'rectRad') rectLook.rr = Math.max(0, Math.min(10000, parseFloat(e.target.value) || 0));
      else if (id === 'rectOp') rectLook.o = Math.max(0, Math.min(100, +e.target.value || 0)) / 100;
      /* never neither: with no fill and no stroke a rectangle could not be seen or picked */
      if (!rectLook.fill && rectLook.nos) {
        if (id === 'rectNoStroke') { rectLook.fill = rectLook.fillC || '#FFFFFF'; X.toast('A rectangle needs a fill or a stroke: fill turned on'); }
        else { rectLook.nos = false; X.toast('A rectangle needs a fill or a stroke: stroke turned on'); }
      }
      keepRectLook();
      syncRectCtl();
    });
    X.on('tool', function (t) { rectCtl.hidden = t !== 'rect'; if (t === 'rect') syncRectCtl(); });
    syncRectCtl();

    /* ---- on the selected rectangle's properties: its exact place and size,
       its corner radius (all four, or each), stroke alignment, a square at a
       click, and Convert to Path ---- */
    const rectPop = document.createElement('div');
    rectPop.className = 'mpell mprect';
    rectPop.innerHTML =
      '<label class="mfield"><span>X</span><span class="unit"><input id="rectPX" inputmode="decimal" aria-label="Left edge, in points"><em>pt</em></span></label>' +
      '<label class="mfield"><span>Y</span><span class="unit"><input id="rectPY" inputmode="decimal" aria-label="Top edge from the top of the page, in points"><em>pt</em></span></label>' +
      '<label class="mfield"><span>W</span><span class="unit"><input id="rectPW" inputmode="decimal" aria-label="Width, in points"><em>pt</em></span></label>' +
      '<label class="mfield"><span>H</span><span class="unit"><input id="rectPH" inputmode="decimal" aria-label="Height, in points"><em>pt</em></span></label>' +
      '<button class="cbtn ellbtn" id="rectPLock" type="button" title="Keep width and height in proportion" aria-pressed="false">⛓</button>' +
      '<label class="mfield"><span>Corners</span><span class="unit"><input id="rectPR" inputmode="decimal" aria-label="Corner radius, in points"><em>pt</em></span></label>' +
      '<button class="cbtn ellbtn" id="rectPEach" type="button" title="A radius for each corner" aria-pressed="false">⌜⌝</button>' +
      '<div class="rectcorn" id="rectPCorners" hidden>' +
        [['TL', '↖', 'Top left'], ['TR', '↗', 'Top right'], ['BL', '↙', 'Bottom left'], ['BR', '↘', 'Bottom right']].map(function (c) {
          return '<label class="mfield"><span>' + c[1] + '</span><span class="unit"><input id="rectPR' + c[0] + '" data-corner="' + c[0] +
            '" inputmode="decimal" aria-label="' + c[2] + ' corner radius, in points" title="' + c[2] + '"><em>pt</em></span></label>';
        }).join('') +
      '</div>' +
      '<label class="mfield"><span>Align</span><select id="rectPAlign" aria-label="Stroke alignment"><option value="">Centre</option><option value="in">Inside</option><option value="out">Outside</option></select></label>' +
      '<button class="cbtn ellbtn" id="rectPSquare" type="button" title="Make it a square (its width for both)">Square</button>' +
      '<button class="cbtn ellbtn" id="rectPPath" type="button" title="Convert to a Pen path: anchor points and handles to edit with Direct Selection">Convert to Path</button>';
    const rectQ = function (id) { return rectPop.querySelector('#' + id); };
    let rectLock = false, rectEach = false;
    function rectSel() {
      const sh = S.sel && S.sel.it && S.sel.it.shapes[S.sel.i];
      return sh && sh.t === 'rect' ? sh : null;
    }
    /** Which of the rectangle's corners (rectCorners' order) is at the top
        left, top right, bottom left and bottom right as the page is seen. */
    function cornerOrder(it, s) {
      const b = E.boxOf(s), C = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
      const V = C.map(function (q) { return it.vp.convertToViewportPoint(q[0], q[1]); });
      const pick = function (f, max) {
        let best = 0;
        for (let i = 1; i < 4; i++) if (max ? f(V[i]) > f(V[best]) : f(V[i]) < f(V[best])) best = i;
        return best;
      };
      return {
        TL: pick(function (v) { return v[0] + v[1]; }, false), BR: pick(function (v) { return v[0] + v[1]; }, true),
        TR: pick(function (v) { return v[0] - v[1]; }, true), BL: pick(function (v) { return v[0] - v[1]; }, false)
      };
    }
    X.markPop.rect = {
      el: rectPop,
      sync: function (sh) {
        const it = S.sel.it, b = E.boxOf(sh);
        const set = function (id, v) { const el = rectQ(id); if (document.activeElement !== el) el.value = rr2(v); };
        set('rectPX', b.x1); set('rectPY', Math.abs(pageTop(it) - b.y2));
        set('rectPW', b.x2 - b.x1); set('rectPH', b.y2 - b.y1);
        const R = E.rectRadii(sh), raw = E.rectRadiiRaw(sh);
        const same = raw[0] === raw[1] && raw[1] === raw[2] && raw[2] === raw[3];
        if (!same) rectEach = true;
        const el = rectQ('rectPR');
        if (document.activeElement !== el) el.value = same ? rr2(R[0]) : '';
        el.placeholder = same ? '' : 'mixed';
        rectQ('rectPCorners').hidden = !rectEach;
        const ord = cornerOrder(it, sh);
        Object.keys(ord).forEach(function (k) { set('rectPR' + k, R[ord[k]]); });
        rectQ('rectPAlign').value = sh.sa || '';
        [['rectPLock', rectLock], ['rectPEach', rectEach]].forEach(function (q) {
          rectQ(q[0]).classList.toggle('on', q[1]);
          rectQ(q[0]).setAttribute('aria-pressed', q[1] ? 'true' : 'false');
        });
      }
    };
    function rectChange(fn) {
      if (!rectSel()) return;
      X.snapshot();
      /* every rectangle selected takes it */
      const it = S.sel.it;
      X.selList().forEach(function (i) { const m = it.shapes[i]; if (m && m.t === 'rect' && !m.locked) fn(m, it); });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
    }
    /** a rectangle's radius set: all four alike (rr), or one each (rc) */
    function setRadii(m, R) {
      const v = R.map(function (r) { return rr2(Math.max(0, r)); });
      delete m.rr; delete m.rc;
      if (v[0] === v[1] && v[1] === v[2] && v[2] === v[3]) { if (v[0] > 0) m.rr = v[0]; }
      else m.rc = v;
    }
    X.rectSetRadii = setRadii;
    function rectNum(id) { const v = parseFloat(String(rectQ(id).value).replace(',', '.')); return isFinite(v) ? v : null; }
    rectPop.addEventListener('change', function (e) {
      const id = e.target.id;
      if (id === 'rectPAlign') { rectChange(function (m) { if (e.target.value) m.sa = e.target.value; else delete m.sa; }); return; }
      const v = rectNum(id);
      if (v == null) { X.syncMarkPop(); return; }
      rectChange(function (m, it) {
        const b = E.boxOf(m), w = b.x2 - b.x1, h = b.y2 - b.y1;
        if (id === 'rectPX') { m.a = [v, b.y1]; m.b = [v + w, b.y2]; }
        else if (id === 'rectPY') { const top = pageTop(it); const y2 = top >= b.y2 ? top - v : top + v; m.a = [b.x1, y2 - h]; m.b = [b.x2, y2]; }
        else if (id === 'rectPW' || id === 'rectPH') {
          /* sized about its centre, as Illustrator's W and H do with the centre reference point */
          let nw = id === 'rectPW' ? Math.max(0.01, v) : w, nh = id === 'rectPH' ? Math.max(0.01, v) : h;
          if (rectLock && w > 0 && h > 0) { if (id === 'rectPW') nh = h * nw / w; else nw = w * nh / h; }
          const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
          m.a = [cx - nw / 2, cy - nh / 2]; m.b = [cx + nw / 2, cy + nh / 2];
        } else if (id === 'rectPR') setRadii(m, [v, v, v, v]);
        else if (e.target.dataset.corner) {
          const R = E.rectRadii(m).slice();
          R[cornerOrder(it, m)[e.target.dataset.corner]] = v;
          setRadii(m, R);
        }
      });
    });
    rectPop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); }
    });
    rectQ('rectPLock').addEventListener('click', function () { rectLock = !rectLock; X.syncMarkPop(); });
    rectQ('rectPEach').addEventListener('click', function () {
      rectEach = !rectEach;
      /* back to one for all: the first corner's radius for every one */
      const sh = rectSel();
      if (!rectEach && sh && sh.rc) { const r = E.rectRadii(sh)[0]; rectChange(function (m) { setRadii(m, [r, r, r, r]); }); return; }
      X.syncMarkPop();
    });
    rectQ('rectPSquare').addEventListener('click', function () {
      rectChange(function (m) {
        const b = E.boxOf(m), side = b.x2 - b.x1, cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
        m.a = [cx - side / 2, cy - side / 2]; m.b = [cx + side / 2, cy + side / 2];
      });
    });
    /** A rectangle as a Pen path, its look kept: the same outline, corners
        and arcs as anchors and handles (engine rectBezier). */
    function rectToPen(m) {
      const pen = { t: 'pen', pts: E.rectBezier(m).map(function (q) { return [q[0], q[1]]; }) };
      Object.keys(m).forEach(function (k) { if (['t', 'a', 'b', 'r', 'sa', 'rr', 'rc'].indexOf(k) < 0) pen[k] = m[k]; });
      return pen;
    }
    X.rectToPen = rectToPen;
    rectQ('rectPPath').addEventListener('click', function () {
      if (!rectSel()) return;
      const it = S.sel.it;
      X.snapshot();
      const made = [];
      X.selList().forEach(function (i) {
        const m = it.shapes[i];
        if (!m || m.t !== 'rect' || m.locked) return;
        it.shapes[i] = rectToPen(m);
        made.push(i);
      });
      X.setGroup(it, made);
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
      X.toast('Converted to a path: Direct Selection (A) edits its points');
    });

    /* ---- the live corner widgets: a small circle inside each corner of the
       selected rectangle, as Illustrator's, dragged in to round the corners
       (all four; with Alt that one alone) and back out to square them ---- */
    const CW_MIN = 12;            /* px in from the corner, however small the radius */
    function cornerFrames(s) {
      /* each corner, and the inward directions along its two sides, in PDF space before the turn */
      const b = E.boxOf(s);
      return [
        { c: [b.x1, b.y1], u: [1, 0], v: [0, 1] },
        { c: [b.x2, b.y1], u: [-1, 0], v: [0, 1] },
        { c: [b.x2, b.y2], u: [-1, 0], v: [0, -1] },
        { c: [b.x1, b.y2], u: [1, 0], v: [0, -1] }
      ];
    }
    let cwDrag = null;
    X.afterDraw.push(function (it) {
      if (S.tool !== 'select' || !S.sel || S.sel.it !== it || X.selList().length > 1) return;
      const s = it.shapes[S.sel.i];
      if (!s || s.t !== 'rect' || s.locked || s.hide || !it.vp) return;
      const vp = it.vp, b = E.boxOf(s);
      const k = S.scale || 1;
      /* too small on screen to hold the widgets clear of the grips: none, as Illustrator */
      if ((b.x2 - b.x1) * k < 4 * CW_MIN || (b.y2 - b.y1) * k < 4 * CW_MIN) return;
      const R = E.rectRadii(s), mid = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'rcwg');
      cornerFrames(s).forEach(function (f, i) {
        const off = Math.max(R[i], CW_MIN / k);
        let q = [f.c[0] + (f.u[0] + f.v[0]) * off, f.c[1] + (f.u[1] + f.v[1]) * off];
        if (s.r) q = E.rotPt(q, mid, s.r);
        const v = vp.convertToViewportPoint(q[0], q[1]);
        const el = document.createElementNS(SVGNS, 'circle');
        el.setAttribute('class', 'rcw' + (cwDrag && (cwDrag.i === i || !cwDrag.one) ? ' on' : ''));
        el.setAttribute('cx', v[0]); el.setAttribute('cy', v[1]); el.setAttribute('r', 4.5);
        el.dataset.corner = String(i);
        const t = document.createElementNS(SVGNS, 'title');
        t.textContent = 'Drag to round the corners (Alt: this corner only)';
        el.appendChild(t);
        el.addEventListener('pointerdown', function (e) { cornerDown(it, S.sel.i, i, e); });
        g.appendChild(el);
      });
      it.anno.appendChild(g);
    });
    function cornerDown(it, idx, i, e) {
      if (e.button > 0) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const s = it.shapes[idx];
      cwDrag = { it: it, idx: idx, i: i, one: e.altKey, moved: false, x: e.clientX, y: e.clientY, R0: E.rectRadii(s).slice() };
      const move = function (ev) {
        const d = cwDrag;
        if (!d) return;
        if (!d.moved) {
          if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 2) return;
          X.snapshot();
          d.moved = true;
        }
        const m = it.shapes[d.idx];
        if (!m) return;
        const r = it.anno.getBoundingClientRect();
        let p = it.vp.convertToPdfPoint(ev.clientX - r.left, ev.clientY - r.top);
        const bb = E.boxOf(m), mid = [(bb.x1 + bb.x2) / 2, (bb.y1 + bb.y2) / 2];
        if (m.r) p = E.rotPt(p, mid, -m.r);
        const f = cornerFrames(m)[d.i];
        /* how far in along the corner's diagonal: the radius it asks for */
        const dx = p[0] - f.c[0], dy = p[1] - f.c[1];
        let rad = ((dx * f.u[0] + dy * f.u[1]) + (dx * f.v[0] + dy * f.v[1])) / 2;
        rad = Math.max(0, Math.min(E.rectMaxRadius(m), rad));
        /* settle on the nearest whole point, as a drag on screen means */
        rad = Math.round(rad);
        if (d.one) { const R = d.R0.slice(); R[d.i] = rad; setRadii(m, R); }
        else setRadii(m, [rad, rad, rad, rad]);
        X.drawShapes(it);
        const v = it.vp.convertToViewportPoint(p[0], p[1]);
        readout.textContent = 'Radius ' + measureLen(rad);
        readout.style.transform = 'translate(' + Math.round(r.left + v[0] + 14) + 'px,' + Math.round(r.top + v[1] + 18) + 'px)';
        readout.hidden = false;
      };
      const up = function () {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        const d = cwDrag;
        cwDrag = null;
        readHide();
        if (d && d.moved) { X.drawThumb(it); X.updateMeta(); }
        X.drawShapes(it); X.syncMarkPop();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    }

    X.tools.cloud = common('cloud');
    X.tools.arc = common('arc');

    /* ================= dimensions, as AutoCAD's DIM commands =================
       Every tool here makes a 'dimx' mark (engine dimension.ts): linear
       (horizontal or vertical, decided by where the line is placed, as
       DIMLINEAR does), aligned, angular, radius, diameter, arc length,
       ordinate, and continuous and baseline chains of linear ones. The
       engine lays each one out as one display list; it is drawn here (on
       screen and into SVG) and by the PDF painter from that same list.

       A dimension's defining points are kept on the geometry they were
       picked on (s.ref, by that mark's s.gid): moving, resizing or turning
       it updates the dimension (E.resolveDims, before every draw, core.js).
       Picked on the page's own drawing (a PDF has no objects), they stay
       where they were picked. */
    const DX_TOOLS = { dim: 1, dimal: 1, dima: 1, dimr: 1, dimd: 1, dimarc: 1, dimc: 1, dimb: 1, dimo: 1 };
    X.DX_TOOLS = DX_TOOLS;
    const v2 = {
      sub: function (a, b) { return [a[0] - b[0], a[1] - b[1]]; },
      dot: function (a, b) { return a[0] * b[0] + a[1] * b[1]; },
      len: function (a) { return Math.hypot(a[0], a[1]); },
      unit: function (a) { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
      perp: function (a) { return [-a[1], a[0]]; }
    };
    const dist = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };

    /* ---- the current dimension style (AutoCAD's DIMSTYLE): the ribbon's
       quick controls (arrowhead, size, font, bold, italic, text colour) and
       the rest kept from the Dimension Style dialog ---- */
    const DXS_KEY = 'adpdf.dimStyle';
    let dxStyle = (function () {
      try { return JSON.parse(localStorage.getItem(DXS_KEY) || '{}') || {}; } catch (e) { return {}; }
    })();
    function keepDxStyle() { try { localStorage.setItem(DXS_KEY, JSON.stringify(dxStyle)); } catch (e) { /* this session only */ } }
    const ARROW_OF = { arrow: 'closed', open: 'open', tick: 'oblique', dot: 'dot', none: 'none' };
    const ARROW_BACK = { closed: 'arrow', open: 'open', oblique: 'tick', dot: 'dot', none: 'none' };
    /** a style with only what differs from the engine's own (DIM_STYLE) */
    function cleanSty(st) {
      const out = {};
      Object.keys(st || {}).forEach(function (k) {
        const v = st[k];
        if (v === undefined || v === null || !(k in E.DIM_STYLE)) return;
        if (E.DIM_STYLE[k] === v || (v === '' && (E.DIM_STYLE[k] === '' || E.DIM_STYLE[k] == null))) return;
        out[k] = v;
      });
      return out;
    }
    /** what the next dimension takes */
    function newSty() {
      const st = Object.assign({}, dxStyle);
      st.ah = ARROW_OF[dimStyle] || 'closed';
      st.sc = look.dz; st.tf = look.df; st.tb = look.db; st.ti = look.di; st.tc = look.tc;
      return cleanSty(st);
    }
    /** the current style set: the quick controls on the ribbon and the rest */
    function setCurrentStyle(st) {
      const full = Object.assign({}, E.DIM_STYLE, st);
      dimStyle = ARROW_BACK[full.ah] || 'arrow';
      $('dimStyle').value = dimStyle;
      look.dz = full.sc; look.df = full.tf || ''; look.db = !!full.tb; look.di = !!full.ti; look.tc = full.tc || '';
      const rest = cleanSty(st);
      ['ah', 'sc', 'tf', 'tb', 'ti', 'tc'].forEach(function (k) { delete rest[k]; });
      dxStyle = rest; keepDxStyle();
      syncRibbonLook();
    }

    /* ---- drawing it: the engine's display list, in the page's own frame ---- */
    function dxFont(s) {
      const st = E.dimStyle(s);
      return { df: st.tf || '', db: st.tb, di: st.ti, label: s.label || '' };
    }
    function dxMeasure(s) {
      const f = dxFont(s);
      return function (str, size) { return textPx(str, size, f); };
    }
    function dxLayout(s) { return E.dimLayout(s, scale, dxMeasure(s)); }
    X.dimLayout = dxLayout;
    X.dimText = function (s) { return E.dimText(s, scale); };

    X.shapeRenderers.dimx = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      if (s.guide) g.appendChild(X.shapeRenderers.dimguide(it, Object.assign({ c: s.c }, s.guide), vp));
      if (!s.pts || s.pts.length < 3) return g;
      const D = dxLayout(s);
      const f = readingFont(dxFont(s));
      const art = document.createElementNS(SVGNS, 'g');
      /* PDF points onto the page as shown: an affine map, so every line,
         arc and arrowhead keeps its size on paper at any zoom */
      art.setAttribute('transform', 'matrix(' + vp.transform.join(' ') + ')');
      art.innerHTML = E.dimSvgMarkup(D, s, { family: f.family, weight: f.weight, style: f.style },
        0.6 / Math.max(0.05, S.scale));
      art.style.pointerEvents = 'none';
      g.appendChild(art);
      if (idx < 0) return g;
      /* a dimension is hairlines: an unseen strip along its lines, and its
         text's box, to take hold of it by */
      const P = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const hit = document.createElementNS(SVGNS, 'path');
      hit.setAttribute('d', D.hit.map(function (l) { const a = P(l[0]), b = P(l[1]); return 'M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1]; }).join(''));
      hit.setAttribute('class', 'dxhit');
      const box = document.createElementNS(SVGNS, 'polygon');
      box.setAttribute('points', D.box.map(function (q) { return P(q).join(','); }).join(' '));
      box.setAttribute('class', 'dxhit box');
      [hit, box].forEach(function (el) {
        el.addEventListener('pointerdown', function (e) { X.beginDrag(it, idx, e, 'move'); });
        g.appendChild(el);
      });
      return g;
    };
    /* Select moves a dimension as a whole; its own grips (below) move its
       points, its line and its text */
    X.handleKind.dimx = 'point';

    /* ---- association: which mark a point sits on ---- */
    function newGid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function isDimMark(s) { return s && (s.t === 'dimx' || ALL_DIMS[s.t]); }
    /** a reference to the mark point q is one of (a corner, an end, an
        anchor, a centre), or null; `commit` gives that mark its gid */
    function refAt(it, q, skip, commit) {
      if (!q) return null;
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        const s = it.shapes[i];
        if (i === skip || !s || s.hide || isDimMark(s)) continue;
        if (!markPoints(s).some(function (m) { return dist(m[0], q) < 0.02; })) continue;
        const r = E.makeRef(s, q, s.gid || '?');
        if (!r) continue;
        if (commit) { if (!s.gid) s.gid = newGid(); r.g = s.gid; }
        return r;
      }
      return null;
    }
    function refOn(s, r) {
      if (!r) return null;
      if (!s.gid) s.gid = newGid();
      return Object.assign({}, r, { g: s.gid });
    }
    /** a circle (Ellipse) or Arc mark under p: its centre, and the point of
        its edge nearest p */
    function circleAt(it, p, arcsOnly) {
      const tol = 8 / Math.max(0.05, S.scale);
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        const s = it.shapes[i];
        if (!s || s.hide || !s.a || !Array.isArray(s.b)) continue;
        if (s.t === 'ellipse' && !arcsOnly) {
          const b = E.boxOf(s), c = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
          const rx = (b.x2 - b.x1) / 2, ry = (b.y2 - b.y1) / 2;
          if (rx < 1 || ry < 1) continue;
          const q = s.r ? E.rotPt(p, c, -s.r) : p;
          const t = Math.atan2((q[1] - c[1]) / ry, (q[0] - c[0]) / rx);
          const on = [c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)];
          if (dist(q, on) > tol) continue;
          return { idx: i, s: s, kind: 'ell', c: c, e: s.r ? E.rotPt(on, c, s.r) : on };
        }
        if (s.t === 'arc') {
          const k = E.arcMarkCircle(s);
          if (!k) continue;
          const A = arcPts(s, 48);
          let near = Infinity;
          for (let j = 1; j < A.length; j++) near = Math.min(near, segDist(p, A[j - 1], A[j]));
          if (near > tol) continue;
          return { idx: i, s: s, kind: 'arc', c: k.c, e: [s.a[0], s.a[1]], mid: k.mid };
        }
      }
      return null;
    }
    function segDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    }
    /** a straight line under p: one of the marks' own (a line, a box's
        side, a path's straight piece), else one of the page's own */
    function lineAt(it, p) {
      const tol = 7 / Math.max(0.05, S.scale);
      let best = null, bd = tol;
      it.shapes.forEach(function (s) {
        if (!s || isDimMark(s)) return;
        markSegs(s).forEach(function (g) {
          const d = segDist(p, g[0], g[1]);
          if (d < bd) { bd = d; best = [[g[0][0], g[0][1]], [g[1][0], g[1][1]]]; }
        });
      });
      if (best) return best;
      const seg = segAt(it, p);
      return seg ? [[seg[0][0], seg[0][1]], [seg[1][0], seg[1][1]]] : null;
    }

    /* the page's level and upright, in PDF points, as it is shown */
    function screenH(it) {
      const a = it.vp.convertToPdfPoint(0, 0), b = it.vp.convertToPdfPoint(100, 0);
      return v2.unit(v2.sub(b, a));
    }

    /* ---- the tools ---- */
    let dx = null;        /* the dimension being made: {t, it, step data…} */
    let dxc = null;       /* a continuous / baseline chain: {t, it, dir, first, last, loc, refs, n} */
    function hint(msg) { $('modeHint').innerHTML = msg || X.hints[S.tool] || ''; }
    function dxMark(k, pts, extra) {
      return Object.assign({ t: 'dimx', k: k, pts: pts, c: S.color, w: S.width, sty: newSty() }, extra || {});
    }
    function snapAt(it, at, e, force) {
      const raw = it.vp.convertToPdfPoint(at[0], at[1]);
      const sn = X.snapPt(it, raw, e, force ? { force: true } : undefined);
      return sn ? [sn[0], sn[1]] : [raw[0], raw[1]];
    }
    function dxCommit(it, m, refs) {
      X.snapshot();
      const nd = E.dimDefCount(m);
      const R = (refs || []).slice(0, nd);
      for (let i = 0; i < nd; i++) if (R[i] === undefined) R[i] = refAt(it, m.pts[i], -1, true);
      if (R.some(Boolean)) m.ref = R.map(function (r) { return r || null; });
      it.shapes.push(m);
      trackClear(); snapHide(); readHide();
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.toast('<b>' + X.esc(E.dimText(m, scale)) + '</b>');
      return m;
    }
    function dxCancel(quiet) {
      const it = dx && dx.it;
      dx = null;
      trackClear(); snapHide(); readHide();
      if (it) X.drawShapes(it);
      if (!quiet) hint();
    }
    function chainEnd() {
      const had = dxc;
      dxc = null;
      if (dx && (dx.t === 'dimc' || dx.t === 'dimb')) dxCancel(true);
      if (had) {
        X.drawShapes(had.it);
        if (had.n) X.toast(had.n + ' dimension' + (had.n > 1 ? 's' : '') + (had.t === 'dimb' ? ' from the baseline' : ' in the chain'));
      }
      hint();
    }
    function guide(o) { return Object.assign({ t: 'dimguide', c: S.color }, o); }

    /* linear and aligned: first point, second point, where the line goes */
    function linearMark(d, loc) {
      const p1 = d.pts[0], p2 = d.pts[1];
      if (d.t === 'dimal' || d.lock === 'a') return dxMark('ali', [p1, p2, loc]);
      const H = screenH(d.it), V = v2.perp(H);
      let dir;
      if (d.lock === 'h') dir = H;
      else if (d.lock === 'v') dir = V;
      else {
        /* as DIMLINEAR: past the points' left or right: vertical; above or below them: horizontal */
        const x1 = v2.dot(p1, H), x2 = v2.dot(p2, H), y1 = v2.dot(p1, V), y2 = v2.dot(p2, V);
        const lx = v2.dot(loc, H), ly = v2.dot(loc, V);
        const ox = Math.max(0, Math.min(x1, x2) - lx, lx - Math.max(x1, x2));
        const oy = Math.max(0, Math.min(y1, y2) - ly, ly - Math.max(y1, y2));
        dir = ox > oy ? V : oy > ox ? H : (Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? H : V);
      }
      return dxMark('lin', [p1, p2, loc], { dir: [dir[0], dir[1]] });
    }
    const PLACE_HINT = 'Move to place the dimension line, and click. <b>Esc</b> cancels.';
    const LIN_HINT = 'Move to place the dimension line: past the points’ sides it measures vertically, above or ' +
      'below them horizontally. <b>H</b> horizontal, <b>V</b> vertical, <b>A</b> aligned. Click to place. <b>Esc</b> cancels.';

    /** the linear steps shared by Linear, Aligned and the first of a chain;
        returns the mark when it is placed */
    function linearUp(it, at, e, t) {
      const p = snapAt(it, at, e);
      if (!dx || dx.it !== it || dx.t !== t) {
        dxCancel(true);
        dx = { t: t, it: it, pts: [p], lock: null };
        trackStart(it, p);
        hint('Click the <b>second point</b>. <b>Esc</b> cancels.');
        return null;
      }
      if (dx.pts.length === 1) {
        if (dist(p, dx.pts[0]) < 0.5) return null;
        dx.pts.push(p);
        if (calibrating && t === 'dim') {
          const a = dx.pts[0];
          dxCancel(true);
          finishCalibration({ a: a, b: p });
          return null;
        }
        hint(t === 'dimal' ? PLACE_HINT : LIN_HINT);
        X.drawShapes(it, linearMark(dx, p));
        return null;
      }
      const m = linearMark(dx, snapAt(it, at, e));
      const refs = dx.refs;
      dx = null;
      return dxCommit(it, m, refs);
    }
    function linearMove(it, at, e) {
      if (!dx || dx.it !== it) return;
      const p = snapAt(it, at, e);
      dx.last = { at: at, e: e };
      if (dx.t === '?') {
        /* pressed and dragging: a drag from the first point to the second */
        X.drawShapes(it, guide({ marks: [dx.down], lines: [[dx.down, p]] }));
        readShow(it, dx.down, p);
        return;
      }
      if (dx.pts.length === 1) {
        X.drawShapes(it, guide({ marks: [dx.pts[0]], lines: [[dx.pts[0], p]] }));
        readShow(it, dx.pts[0], p);
      } else {
        readHide();
        X.drawShapes(it, linearMark(dx, p));
      }
    }
    function linearTool(t) {
      return {
        colors: true, widths: true,
        down: function (it, at, e) {
          if (!it.vp || (e && e.button > 0)) return;
          if (!dx) dx = { t: '?', it: it, down: snapAt(it, at, e), pts: [] };
        },
        move: linearMove,
        cancel: function () { dxCancel(); },
        up: function (it, at, e) {
          if (!it.vp || (e && e.button > 0)) return;
          const down = dx && dx.t === '?' ? dx.down : null;
          if (dx && dx.t === '?') dx = null;
          if (down) {
            const p = snapAt(it, at, e);
            if (dist(down, p) > 3 / Math.max(0.05, S.scale) && !calibrating) {
              /* a drag from the first point to the second */
              dx = { t: t, it: it, pts: [down, p], lock: null };
              hint(t === 'dimal' ? PLACE_HINT : LIN_HINT);
              X.drawShapes(it, linearMark(dx, p));
              return;
            }
            if (calibrating && dist(down, p) > 3 / Math.max(0.05, S.scale)) {
              finishCalibration({ a: down, b: p });
              return;
            }
          }
          linearUp(it, at, e, t);
        }
      };
    }
    X.tools.dim = linearTool('dim');
    X.tools.dimal = linearTool('dimal');

    /* angular: two lines (the angle between them, any of the four), or a
       vertex and a point on each arm; then where the arc goes */
    X.tools.dima = {
      colors: true, widths: true,
      down: function () { /* a click tool */ },
      move: function (it, at, e) {
        if (!it.vp) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!dx || dx.it !== it) {
          const L = lineAt(it, raw);
          X.drawShapes(it, L ? guide({ lines: [L] }) : undefined);
          return;
        }
        dx.last = { at: at, e: e };
        if (dx.mode === 'll' && dx.lines.length === 1) {
          const L = lineAt(it, raw);
          X.drawShapes(it, guide({ solid: dx.lines, lines: L ? [L] : [] }));
          return;
        }
        if (dx.mode === 'v' && dx.pts.length < 3) {
          const p = snapAt(it, at, e, true);
          X.drawShapes(it, guide({ marks: dx.pts, lines: dx.pts.length === 1 ? [[dx.pts[0], p]] : [[dx.pts[0], dx.pts[1]], [dx.pts[0], p]] }));
          return;
        }
        X.drawShapes(it, angMark(dx, raw));
      },
      cancel: function () { dxCancel(); },
      up: async function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!dx || dx.it !== it) {
          dxCancel(true);
          const job = dx = { t: 'dima', it: it, mode: null, lines: [], pts: [] };
          await pageSegments(it);
          if (dx !== job) return;
          const L = lineAt(it, raw);
          if (L) {
            dx.mode = 'll'; dx.lines = [L];
            hint('Click the <b>second line</b>. <b>Esc</b> cancels.');
            X.drawShapes(it, guide({ solid: dx.lines }));
          } else {
            dx.mode = 'v'; dx.pts = [snapAt(it, at, e, true)];
            hint('No line there, so that is the <b>vertex</b>. Click a point on the <b>first arm</b>.');
            X.drawShapes(it, guide({ marks: dx.pts }));
          }
          return;
        }
        if (dx.mode === 'll' && dx.lines.length === 1) {
          const L = lineAt(it, raw);
          if (!L) { X.toast('No line there — click right on the second line'); return; }
          const A = dx.lines[0];
          if (dist(L[0], A[0]) + dist(L[1], A[1]) < 0.01) { X.toast('That is the same line — click a second one'); return; }
          if (!E.lineCross(A[0], A[1], L[0], L[1])) { X.toast('Those lines are parallel — they never meet'); return; }
          dx.lines.push(L);
          hint('Move into the angle you want (any of the four between the lines) and click to place the arc. <b>Esc</b> cancels.');
          X.drawShapes(it, angMark(dx, raw));
          return;
        }
        if (dx.mode === 'v' && dx.pts.length < 3) {
          const p = snapAt(it, at, e, true);
          if (dist(p, dx.pts[dx.pts.length - 1]) < 0.5 || dist(p, dx.pts[0]) < 0.5) return;
          dx.pts.push(p);
          hint(dx.pts.length < 3 ? 'Click a point on the <b>second arm</b>.' :
            'Move to choose the side and size of the arc, and click. <b>Esc</b> cancels.');
          X.drawShapes(it, dx.pts.length < 3 ? guide({ marks: dx.pts, lines: [[dx.pts[0], dx.pts[1]]] }) : angMark(dx, raw));
          return;
        }
        const m = angMark(dx, raw);
        dx = null;
        dxCommit(it, m);
        hint();
      }
    };
    function angMark(d, loc) {
      if (d.mode === 'll') {
        const A = d.lines[0], B = d.lines[1];
        return dxMark('ang', [A[0], A[1], B[0], B[1], loc], { am: 'll' });
      }
      return dxMark('ang', [d.pts[0], d.pts[1], d.pts[2], loc]);
    }

    /* radius and diameter: a circle or arc you drew, or three points on the
       edge of one in the page's own drawing; then where the text goes */
    function radialTool(t) {
      const k = t === 'dimr' ? 'rad' : 'dia';
      function mark(d, loc) {
        if (d.circ) return dxMark(k, [d.circ.c, d.circ.e, loc]);
        const c = circle3(d.pts[0], d.pts[1], d.pts[2]);
        return c ? dxMark(k, [c.c, d.pts[0], loc]) : null;
      }
      return {
        colors: true, widths: true,
        down: function () { /* a click tool */ },
        move: function (it, at, e) {
          if (!it.vp) return;
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          if (!dx || dx.it !== it) {
            const C = circleAt(it, raw);
            X.drawShapes(it, C ? guide({ circle: { c: C.c, r: dist(C.c, C.e) } }) : undefined);
            return;
          }
          if (!dx.circ && dx.pts.length < 3) {
            const p = snapAt(it, at, e);
            const c = dx.pts.length === 2 ? circle3(dx.pts[0], dx.pts[1], p) : null;
            X.drawShapes(it, guide({ marks: dx.pts.concat([p]), circle: c }));
            return;
          }
          const m = mark(dx, raw);
          if (m) X.drawShapes(it, m);
        },
        cancel: function () { dxCancel(); },
        up: function (it, at, e) {
          if (!it.vp || (e && e.button > 0)) return;
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          if (!dx || dx.it !== it) {
            dxCancel(true);
            const C = circleAt(it, raw);
            if (C) {
              dx = { t: t, it: it, circ: C, pts: [] };
              hint('Move to place the dimension — inside or outside the circle — and click. <b>Esc</b> cancels.');
              X.drawShapes(it, mark(dx, raw));
            } else {
              dx = { t: t, it: it, circ: null, pts: [snapAt(it, at, e)] };
              hint('No circle you drew there: click a <b>second</b> and a <b>third point</b> on the edge.');
              X.drawShapes(it, guide({ marks: dx.pts }));
            }
            return;
          }
          if (!dx.circ && dx.pts.length < 3) {
            const p = snapAt(it, at, e);
            if (dist(p, dx.pts[dx.pts.length - 1]) < 0.5) return;
            if (dx.pts.length === 2 && !circle3(dx.pts[0], dx.pts[1], p)) {
              X.toast('Those points are in a line — pick three spread round the circle');
              return;
            }
            dx.pts.push(p);
            if (dx.pts.length === 3) hint(PLACE_HINT);
            X.drawShapes(it, dx.pts.length === 3 ? mark(dx, raw) : guide({ marks: dx.pts }));
            return;
          }
          const m = mark(dx, raw);
          if (!m) return;
          const C = dx.circ;
          dx = null;
          let refs = null;
          if (C) {
            const s = C.s;
            refs = C.kind === 'arc'
              ? [refOn(s, { c: 'c' }), refOn(s, { e: 'a' })]
              : [refOn(s, E.makeRef(s, C.c, '?')), refOn(s, E.makeRef(s, C.e, '?'))];
          }
          dxCommit(it, m, refs || undefined);
          hint();
        }
      };
    }
    X.tools.dimr = radialTool('dimr');
    X.tools.dimd = radialTool('dimd');

    /* arc length: an Arc you drew, or the start, a point along and the end
       of one in the page's own drawing; then where the dimension arc goes */
    X.tools.dimarc = {
      colors: true, widths: true,
      down: function () { /* a click tool */ },
      move: function (it, at, e) {
        if (!it.vp) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!dx || dx.it !== it) {
          const C = circleAt(it, raw, true);
          X.drawShapes(it, C ? guide({ lines: [[C.s.a, C.mid], [C.mid, C.s.b]] }) : undefined);
          return;
        }
        if (!dx.arc && dx.pts.length < 3) {
          const p = snapAt(it, at, e);
          X.drawShapes(it, guide({ marks: dx.pts.concat([p]) }));
          return;
        }
        const m = arcMark(dx, raw);
        if (m) X.drawShapes(it, m);
      },
      cancel: function () { dxCancel(); },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!dx || dx.it !== it) {
          dxCancel(true);
          const C = circleAt(it, raw, true);
          if (C) {
            dx = { t: 'dimarc', it: it, arc: C, pts: [] };
            hint(PLACE_HINT);
            X.drawShapes(it, arcMark(dx, raw));
          } else {
            dx = { t: 'dimarc', it: it, arc: null, pts: [snapAt(it, at, e)] };
            hint('No Arc you drew there: that is the arc’s <b>start</b>. Click a <b>point along it</b>, then its <b>end</b>.');
            X.drawShapes(it, guide({ marks: dx.pts }));
          }
          return;
        }
        if (!dx.arc && dx.pts.length < 3) {
          const p = snapAt(it, at, e);
          if (dist(p, dx.pts[dx.pts.length - 1]) < 0.5) return;
          if (dx.pts.length === 2 && !circle3(dx.pts[0], dx.pts[1], p)) {
            X.toast('Those points are in a line — a point along the arc must be off the chord');
            return;
          }
          dx.pts.push(p);
          hint(dx.pts.length === 2 ? 'Click the arc’s <b>end</b>.' : PLACE_HINT);
          X.drawShapes(it, dx.pts.length === 3 ? arcMark(dx, raw) : guide({ marks: dx.pts }));
          return;
        }
        const m = arcMark(dx, raw);
        if (!m) return;
        const A = dx.arc;
        dx = null;
        dxCommit(it, m, A ? [refOn(A.s, { c: 'c' }), refOn(A.s, { e: 'a' }), refOn(A.s, { e: 'b' }), refOn(A.s, { c: 'm' })] : undefined);
        hint();
      }
    };
    function arcMark(d, loc) {
      if (d.arc) {
        const A = d.arc;
        return dxMark('arc', [A.c, [A.s.a[0], A.s.a[1]], [A.s.b[0], A.s.b[1]], A.mid, loc]);
      }
      const c = circle3(d.pts[0], d.pts[1], d.pts[2]);
      return c ? dxMark('arc', [c.c, d.pts[0], d.pts[2], d.pts[1], loc]) : null;
    }

    /* ordinate: a datum first (kept for the page), then for each feature its
       point and where its leader ends — up or down for an X ordinate, left
       or right for a Y one, as AutoCAD decides it */
    function ordAxis(it, f, loc, lock) {
      if (lock) return lock;
      const H = screenH(it), V = v2.perp(H), d = v2.sub(loc, f);
      return Math.abs(v2.dot(d, V)) >= Math.abs(v2.dot(d, H)) ? 'x' : 'y';
    }
    function ordMark(d, loc) {
      const H = screenH(d.it);
      return dxMark('ord', [d.it._dxOrigin.p, d.f, loc], { dir: [H[0], H[1]], ax: ordAxis(d.it, d.f, loc, d.lock) });
    }
    function ordOrigin(it) {
      if (it._dxOrigin) return it._dxOrigin;
      /* the datum of the last ordinate dimension on the page, if there is one */
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        const s = it.shapes[i];
        if (s && s.t === 'dimx' && s.k === 'ord') return (it._dxOrigin = { p: s.pts[0] });
      }
      return null;
    }
    const ORD_HINT = 'Click a <b>feature</b> to measure from the datum. <b>O</b> picks a new datum.';
    X.tools.dimo = {
      colors: true, widths: true,
      down: function () { /* a click tool */ },
      move: function (it, at, e) {
        if (!it.vp) return;
        const O = ordOrigin(it);
        if (!dx || dx.it !== it) {
          if (O) X.drawShapes(it, guide({ marks: [O.p] }));
          return;
        }
        dx.last = { at: at, e: e };
        X.drawShapes(it, ordMark(dx, it.vp.convertToPdfPoint(at[0], at[1])));
      },
      cancel: function () { dxCancel(); },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const p = snapAt(it, at, e);
        const O = ordOrigin(it);
        if (!O) {
          it._dxOrigin = { p: p };
          hint(ORD_HINT);
          X.drawShapes(it, guide({ marks: [p] }));
          X.toast('Datum set — every ordinate on this page measures from it');
          return;
        }
        if (!dx || dx.it !== it) {
          dxCancel(true);
          dx = { t: 'dimo', it: it, f: p, lock: null };
          hint('Move the leader up or down (an <b>X</b> ordinate) or sideways (a <b>Y</b> one) and click. <b>X</b> / <b>Y</b> fix it. <b>Esc</b> cancels.');
          return;
        }
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const m = ordMark(dx, raw);
        dx = null;
        dxCommit(it, m);
        hint(ORD_HINT);
      }
    };

    /* continuous and baseline: from a linear dimension (picked, or made
       first), each click adds one more — continuous from the last point, in
       line; baseline from the first, each a step further out */
    function dimxAt(it, p, kinds) {
      const tol = 6 / Math.max(0.05, S.scale);
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        const s = it.shapes[i];
        if (!s || s.t !== 'dimx' || s.hide || (kinds && !kinds[s.k])) continue;
        const D = dxLayout(s);
        if (D.hit.some(function (l) { return segDist(p, l[0], l[1]) <= tol; })) return i;
      }
      return -1;
    }
    function chainFrom(it, t, s) {
      const ref = s.ref || [];
      dxc = { t: t, it: it, dir: E.dimDir(s), first: s.pts[0], firstRef: ref[0] || null, last: s.pts[1], lastRef: ref[1] || null,
              loc: s.pts[2], n: 0, sty: s.sty, c: s.c, w: s.w };
      hint('Click the <b>next point</b>. <b>Enter</b>, <b>Esc</b>, double-click or right-click ends it.');
    }
    function chainMark(p) {
      const d = dxc, n = v2.perp(d.dir);
      let from = d.last, loc = d.loc;
      if (d.t === 'dimb') {
        from = d.first;
        const st = E.dimStyle({ sty: d.sty });
        const side = v2.dot(d.loc, n) - v2.dot(d.first, n) >= 0 ? 1 : -1;
        const step = st.th * st.sc * 1.9;
        loc = [d.loc[0] + n[0] * side * step, d.loc[1] + n[1] * side * step];
      }
      return { t: 'dimx', k: 'lin', pts: [from, p, loc], dir: [d.dir[0], d.dir[1]], c: d.c, w: d.w, sty: d.sty ? Object.assign({}, d.sty) : newSty() };
    }
    function chainTool(t) {
      const lin = linearTool(t);
      return {
        colors: true, widths: true,
        down: function (it, at, e) { if (!dxc) lin.down(it, at, e); },
        move: function (it, at, e) {
          if (!it.vp) return;
          if (!dxc || dxc.it !== it) { lin.move(it, at, e); return; }
          const p = snapAt(it, at, e);
          X.drawShapes(it, chainMark(p));
        },
        cancel: function () { chainEnd(); },
        up: function (it, at, e) {
          if (!it.vp || (e && e.button > 0)) return;
          if (!dxc || dxc.it !== it) {
            if (dxc) chainEnd();
            /* on a linear dimension already there: carry on from it */
            if (!dx || dx.t === '?') {
              const raw = it.vp.convertToPdfPoint(at[0], at[1]);
              const i = dimxAt(it, raw, { lin: 1, ali: 1 });
              if (i >= 0) { dx = null; chainFrom(it, t, it.shapes[i]); X.drawShapes(it); return; }
            }
            const before = dx;
            lin.up(it, at, e);
            /* the first one placed: the chain carries on from it */
            if (before && !dx && it.shapes.length && it.shapes[it.shapes.length - 1].t === 'dimx') {
              chainFrom(it, t, it.shapes[it.shapes.length - 1]);
            }
            return;
          }
          const p = snapAt(it, at, e);
          const m = chainMark(p);
          if (Math.abs(v2.dot(v2.sub(p, m.pts[0]), dxc.dir)) < 1) return;   /* the second click of a double-click */
          const refs = [t === 'dimb' ? dxc.firstRef : dxc.lastRef, undefined];
          dxCommit(it, m, refs);
          dxc.n++;
          if (t === 'dimc') { dxc.last = p; dxc.lastRef = m.ref ? m.ref[1] : null; }
          else dxc.loc = m.pts[2];
          hint('Click the <b>next point</b>. <b>Enter</b>, <b>Esc</b>, double-click or right-click ends it.');
        }
      };
    }
    X.tools.dimc = chainTool('dimc');
    X.tools.dimb = chainTool('dimb');
    $('stage').addEventListener('dblclick', function () { if (dxc && (S.tool === 'dimc' || S.tool === 'dimb')) chainEnd(); });
    $('stage').addEventListener('contextmenu', function (e) {
      if (!dxc || (S.tool !== 'dimc' && S.tool !== 'dimb')) return;
      e.preventDefault();
      chainEnd();
    });

    /* the keys, ahead of core's and the tool shortcuts: Esc steps back,
       Enter ends a chain, H / V / A fix a linear dimension, X / Y an
       ordinate, O a new datum */
    document.addEventListener('keydown', function (e) {
      if (!DX_TOOLS[S.tool]) return;
      if (e.target && e.target.matches && e.target.matches('input,textarea,select')) return;
      const stop = function () { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'Escape') {
        if (dx && dx.t !== '?') { stop(); dxCancel(); if (dxc) hint('Click the <b>next point</b>. <b>Enter</b> or <b>Esc</b> ends it.'); return; }
        if (dxc) { stop(); chainEnd(); }
        return;
      }
      if (e.key === 'Enter') { if (dxc) { stop(); chainEnd(); } return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const placing = dx && dx.pts && dx.pts.length === 2 && (dx.t === 'dim' || dx.t === 'dimc' || dx.t === 'dimb');
      if (placing && (k === 'h' || k === 'v' || k === 'a')) {
        stop();
        dx.lock = dx.lock === k ? null : k;
        if (dx.last) linearMove(dx.it, dx.last.at, dx.last.e);
        return;
      }
      if (S.tool === 'dimo') {
        if (dx && (k === 'x' || k === 'y')) {
          stop();
          dx.lock = dx.lock === k ? null : k;
          if (dx.last) X.tools.dimo.move(dx.it, dx.last.at, dx.last.e);
        } else if (k === 'o') {
          stop();
          const it = S.items[S.current - 1];
          dxCancel(true);
          S.items.forEach(function (x) { x._dxOrigin = null; });
          hint('Click the <b>datum</b> (the origin) every ordinate measures from.');
          if (it) X.drawShapes(it);
        }
      }
    }, true);
    X.on('tool', function (t) {
      if (dx && dx.t !== t) dxCancel(true);
      if (dxc && dxc.t !== t) chainEnd();
      if (t === 'dima') {
        const it = S.items[S.current - 1];
        if (it) pageSegments(it);
      }
      if (t === 'dimo') {
        const it = S.items[S.current - 1];
        if (it && !ordOrigin(it)) hint('Click the <b>datum</b> (the origin) every ordinate measures from.');
      }
    });

    /* ---- the selected dimension's own grips, as AutoCAD's: a square on
       each defining point (filled when it is held to an object), one on the
       dimension line and one on the text. A defining point snaps, and is
       held to what it lands on; the line and the text move on their own.
       Alt+click on the text's grip puts the text back in its place. ---- */
    X.afterDraw.push(function (it) {
      if (S.tool !== 'select' || !S.sel || S.sel.it !== it || X.selList().length > 1) return;
      const s = it.shapes[S.sel.i];
      if (!s || s.t !== 'dimx' || s.locked || s.hide || !it.vp || !s.pts) return;
      const D = dxLayout(s), vp = it.vp, idx = S.sel.i;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'dxgrips');
      function grip(q, kind, i, title, cls) {
        const v = vp.convertToViewportPoint(q[0], q[1]);
        const el = document.createElementNS(SVGNS, kind === 'def' ? 'rect' : 'circle');
        if (kind === 'def') {
          el.setAttribute('x', v[0] - 4); el.setAttribute('y', v[1] - 4);
          el.setAttribute('width', 8); el.setAttribute('height', 8);
        } else {
          el.setAttribute('cx', v[0]); el.setAttribute('cy', v[1]); el.setAttribute('r', 4.5);
        }
        el.setAttribute('class', 'dxg ' + kind + (cls ? ' ' + cls : ''));
        el.dataset.grip = kind + (i != null ? i : '');
        const t = document.createElementNS(SVGNS, 'title');
        t.textContent = title;
        el.appendChild(t);
        el.addEventListener('pointerdown', function (e) { gripDown(it, idx, kind, i, e); });
        g.appendChild(el);
      }
      D.grips.def.forEach(function (q, i) {
        const held = !!(s.ref && s.ref[i]);
        grip(q, 'def', i, held ? 'A defining point, held to the object under it: drag to move it' :
          'A defining point: drag to move it (it snaps, and holds to the object it lands on)', held ? 'assoc' : '');
      });
      grip(D.grips.line, 'line', null, 'Drag to move the dimension line');
      /* the text's grip kept clear of the line's when the text sits close
         by: drawn a little off along the text, the drag is the same */
      let tq = D.grips.text;
      const lv = vp.convertToViewportPoint(D.grips.line[0], D.grips.line[1]), tv = vp.convertToViewportPoint(tq[0], tq[1]);
      if (Math.hypot(lv[0] - tv[0], lv[1] - tv[1]) < 14) {
        const u = [Math.cos(D.text.ang), Math.sin(D.text.ang)], k = 14 / Math.max(0.05, S.scale);
        tq = [tq[0] + u[0] * k, tq[1] + u[1] * k];
      }
      grip(tq, 'text', null, 'Drag to move the text on its own (Alt+click puts it back)');
      it.anno.appendChild(g);
    });
    let gripDrag = null;
    function gripDown(it, idx, kind, i, e) {
      if (e.button > 0) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const s = it.shapes[idx];
      if (!s) return;
      if (kind === 'text' && e.altKey) {
        if (!s.tm) return;
        X.snapshot();
        s.tm = false;
        s.pts = s.pts.slice(0, E.dimDefCount(s) + 1);
        X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
        return;
      }
      const D = dxLayout(s);
      const r = it.anno.getBoundingClientRect();
      const at0 = it.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      const grab = kind === 'line' ? D.grips.line : kind === 'text' ? D.grips.text : s.pts[i];
      gripDrag = { it: it, idx: idx, kind: kind, i: i, moved: false, x: e.clientX, y: e.clientY,
                   off: [grab[0] - at0[0], grab[1] - at0[1]], loc0: s.pts[E.dimLocIndex(s)] };
      const move = function (ev) {
        const d = gripDrag;
        if (!d) return;
        if (!d.moved) {
          if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 2) return;
          X.snapshot();
          d.moved = true;
        }
        const m = it.shapes[d.idx];
        if (!m || m.t !== 'dimx') return;
        const rr = it.anno.getBoundingClientRect();
        const raw = it.vp.convertToPdfPoint(ev.clientX - rr.left, ev.clientY - rr.top);
        let p = [raw[0] + d.off[0], raw[1] + d.off[1]];
        const pts = m.pts.map(function (q) { return [q[0], q[1]]; });
        const li = E.dimLocIndex(m);
        if (d.kind === 'def') {
          const sn = X.snapPt(it, p, ev, { skip: d.idx });
          if (sn) p = [sn[0], sn[1]];
          pts[d.i] = p;
          const ref = (m.ref || []).slice();
          while (ref.length < E.dimDefCount(m)) ref.push(null);
          ref[d.i] = refAt(it, p, d.idx, true);
          m.ref = ref.some(Boolean) ? ref : null;
        } else if (d.kind === 'line') {
          /* the line's grip sits where the line is; the location point is
             what it passes through, carried by the same step */
          const D0 = dxLayout(m);
          const step = [p[0] - D0.grips.line[0], p[1] - D0.grips.line[1]];
          pts[li] = [pts[li][0] + step[0], pts[li][1] + step[1]];
        } else {
          while (pts.length < li + 2) pts.push([p[0], p[1]]);
          pts[li + 1] = p;
          m.tm = true;
        }
        m.pts = pts;
        X.drawShapes(it);
        readout.textContent = E.dimText(m, scale);
        const v = it.vp.convertToViewportPoint(p[0], p[1]);
        readout.style.transform = 'translate(' + Math.round(rr.left + v[0] + 14) + 'px,' + Math.round(rr.top + v[1] + 18) + 'px)';
        readout.hidden = false;
      };
      const up = function () {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        const d = gripDrag;
        gripDrag = null;
        readHide(); snapHide();
        if (d && d.moved) { X.drawThumb(it); X.updateMeta(); }
        X.drawShapes(it); X.syncMarkPop();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    }

    /* ---- the Dimension Style dialog: every part of the look, for the next
       dimensions (the ribbon's Style…) or the selected ones ---- */
    const UNIT_OPTS = '<option value="">Drawing (' + 'as the Scale’s Units' + ')</option>' +
      ['mm', 'cm', 'm', 'in', 'pt'].map(function (u) { return '<option value="' + u + '">' + UNITS[u].label + '</option>'; }).join('');
    const DP_OPTS = '<option value="">Auto</option>' + [0, 1, 2, 3, 4, 5, 6].map(function (n) {
      return '<option value="' + n + '">' + (n ? '0.' + '0'.repeat(n) : '0') + '</option>';
    }).join('');
    const AH_OPTS = [['closed', 'Closed filled'], ['open', 'Open'], ['oblique', 'Oblique (architectural tick)'], ['dot', 'Dot'], ['none', 'None']]
      .map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    const TP_OPTS = '<option value="above">Above the line</option><option value="center">Centred on the line</option><option value="below">Below the line</option>';
    const TA_OPTS = '<option value="aligned">Aligned with the line</option><option value="horizontal">Horizontal</option>';
    function num(id, label, unit, step) {
      return '<label class="dxf"><span>' + label + '</span><span class="unit"><input id="' + id + '" inputmode="decimal" type="number" step="' + (step || 0.5) + '" min="0">' +
        (unit ? '<em>' + unit + '</em>' : '') + '</span></label>';
    }
    function sel(id, label, opts) { return '<label class="dxf"><span>' + label + '</span><select id="' + id + '">' + opts + '</select></label>'; }
    function chk(id, label) { return '<label class="dxf chk"><input type="checkbox" id="' + id + '"><span>' + label + '</span></label>'; }
    function txt(id, label, ph) { return '<label class="dxf"><span>' + label + '</span><input id="' + id + '" placeholder="' + (ph || '') + '"></label>'; }
    function styleBody() {
      return '<div class="dxstyle">' +
        '<fieldset><legend>Text</legend>' + num('dxTh', 'Height', 'pt') + sel('dxTf', 'Font', fontOpts()) +
          chk('dxTb', 'Bold') + chk('dxTi', 'Italic') +
          '<label class="dxf"><span>Colour</span><input type="color" id="dxTc"></label>' + chk('dxTcSame', 'Same as the lines') + '</fieldset>' +
        '<fieldset><legend>Placement</legend>' + sel('dxTp', 'Position', TP_OPTS) + sel('dxTa', 'Alignment', TA_OPTS) + num('dxTg', 'Gap', 'pt') +
          chk('dxBg', 'Background') + '<label class="dxf"><span>Background colour</span><input type="color" id="dxBgc"></label></fieldset>' +
        '<fieldset><legend>Arrowheads and lines</legend>' + sel('dxAh', 'Arrowhead', AH_OPTS) + num('dxAs', 'Arrow size', 'pt') +
          num('dxExo', 'Extension offset', 'pt') + num('dxExe', 'Extend beyond', 'pt') + num('dxExf', 'Fixed length (0: off)', 'pt') +
          chk('dxCm', 'Centre mark on radius and diameter') + '</fieldset>' +
        '<fieldset><legend>Values</legend>' + sel('dxU', 'Unit', UNIT_OPTS) + sel('dxDp', 'Precision', DP_OPTS) + sel('dxAdp', 'Angle precision', DP_OPTS) +
          chk('dxUl', 'Write the unit') + txt('dxPre', 'Prefix', 'e.g. 2×') + txt('dxSuf', 'Suffix', 'e.g. TYP') + '</fieldset>' +
        '<fieldset><legend>Scale</legend>' + num('dxSc', 'Overall scale', '%', 5) + '</fieldset>' +
        '</div>';
    }
    function styleDialog(title, st0) {
      const st = Object.assign({}, E.DIM_STYLE, st0 || {});
      return X.dialog({
        title: title, ok: 'OK', width: 560,
        body: styleBody(),
        open: function (box) {
          const q = function (id) { return box.querySelector('#' + id); };
          q('dxTh').value = st.th; q('dxTf').value = st.tf || ''; q('dxTb').checked = !!st.tb; q('dxTi').checked = !!st.ti;
          q('dxTc').value = st.tc || '#000000'; q('dxTcSame').checked = !st.tc;
          q('dxTp').value = st.tp; q('dxTa').value = st.ta; q('dxTg').value = st.tg;
          q('dxBg').checked = !!st.bg; q('dxBgc').value = st.bgc || '#FFFFFF';
          q('dxAh').value = st.ah; q('dxAs').value = st.as; q('dxExo').value = st.exo; q('dxExe').value = st.exe; q('dxExf').value = st.exf;
          q('dxCm').checked = !!st.cm;
          q('dxU').value = st.u || ''; q('dxDp').value = st.dp == null ? '' : String(st.dp); q('dxAdp').value = st.adp == null ? '' : String(st.adp);
          q('dxUl').checked = !!st.ul; q('dxPre').value = st.pre || ''; q('dxSuf').value = st.suf || '';
          q('dxSc').value = Math.round(st.sc * 100);
          q('dxTc').addEventListener('input', function () { q('dxTcSame').checked = false; });
        },
        value: function (box) {
          const q = function (id) { return box.querySelector('#' + id); };
          const n = function (id, min, max) { const v = parseFloat(q(id).value); return isFinite(v) ? Math.max(min, Math.min(max, v)) : null; };
          const th = n('dxTh', 1, 500);
          if (th == null) return { error: 'Text height: a size in points', field: '#dxTh' };
          const sc = n('dxSc', 5, 5000);
          if (sc == null) return { error: 'Overall scale: a percentage', field: '#dxSc' };
          return {
            th: th, tf: q('dxTf').value, tb: q('dxTb').checked, ti: q('dxTi').checked,
            tc: q('dxTcSame').checked ? '' : q('dxTc').value.toUpperCase(),
            tp: q('dxTp').value, ta: q('dxTa').value, tg: n('dxTg', 0, 200) || 0,
            bg: q('dxBg').checked, bgc: q('dxBgc').value.toUpperCase(),
            ah: q('dxAh').value, as: n('dxAs', 0, 200) || 0, exo: n('dxExo', 0, 500) || 0, exe: n('dxExe', 0, 500) || 0,
            exf: n('dxExf', 0, 5000) || 0, cm: q('dxCm').checked,
            u: q('dxU').value, dp: q('dxDp').value === '' ? null : +q('dxDp').value, adp: q('dxAdp').value === '' ? null : +q('dxAdp').value,
            ul: q('dxUl').checked, pre: q('dxPre').value, suf: q('dxSuf').value, sc: sc / 100
          };
        }
      });
    }
    /* on the ribbon: the style the next dimensions take */
    $('dimCtl').insertAdjacentHTML('beforeend',
      '<button class="tg" id="dimStyleBtn" title="Dimension Style: text, arrowheads, extension lines, units, precision, prefix and suffix">Style…</button>');
    $('dimStyleBtn').addEventListener('click', function () {
      styleDialog('Dimension Style — for new dimensions', newSty()).then(function (st) { if (st) setCurrentStyle(st); });
    });

    /* ---- the selected dimension's properties ---- */
    const dxPop = document.createElement('div');
    dxPop.className = 'mpdx';
    dxPop.innerHTML =
      '<div class="dxrow"><span class="dxval" id="dxVal"></span><span class="dxassoc" id="dxAssoc"></span></div>' +
      '<div class="dxrow"><label class="mfield dxtext"><span>Text</span><input id="dxText" placeholder="&lt;&gt; is the measured value" ' +
        'title="What the dimension says; &lt;&gt; stands for the measured value. Empty: the measured value."></label></div>' +
      '<div class="dxrow">' +
        '<label class="mfield"><span>Height</span><span class="unit"><input id="dxPTh" type="number" min="1" step="0.5" inputmode="decimal"><em>pt</em></span></label>' +
        '<label class="mfield"><span>Arrow</span><select id="dxPAh">' + AH_OPTS + '</select></label>' +
        '<label class="mfield"><span>Size</span><span class="unit"><input id="dxPAs" type="number" min="0" step="0.5" inputmode="decimal"><em>pt</em></span></label>' +
      '</div><div class="dxrow">' +
        '<label class="mfield"><span>Unit</span><select id="dxPU">' + UNIT_OPTS + '</select></label>' +
        '<label class="mfield"><span>Precision</span><select id="dxPDp">' + DP_OPTS + '</select></label>' +
      '</div><div class="dxrow">' +
        '<label class="mfield"><span>Prefix</span><input id="dxPPre" class="short"></label>' +
        '<label class="mfield"><span>Suffix</span><input id="dxPSuf" class="short"></label>' +
      '</div><div class="dxrow">' +
        '<label class="mfield"><span>Text</span><select id="dxPTp">' + TP_OPTS + '</select></label>' +
        '<label class="mfield"><span>Align</span><select id="dxPTa">' + TA_OPTS + '</select></label>' +
        '<label class="mfield chk"><input type="checkbox" id="dxPBg"><span>Background</span></label>' +
      '</div><div class="dxrow dxbtns">' +
        '<button class="cbtn" id="dxPStyle" type="button" title="Every part of its look">Style…</button>' +
        '<button class="cbtn" id="dxPCur" type="button" title="New dimensions take this one’s look">Make current</button>' +
        '<button class="cbtn" id="dxPHome" type="button" title="The text back in its own place">Reset text</button>' +
        '<button class="cbtn" id="dxPFree" type="button" title="Stop following the objects it measures">Disassociate</button>' +
      '</div><div class="dxrow" id="dxScaleRow"></div>';
    const dq = function (id) { return dxPop.querySelector('#' + id); };
    function dxSel() {
      const sh = S.sel && S.sel.it && S.sel.it.shapes[S.sel.i];
      return sh && sh.t === 'dimx' ? sh : null;
    }
    /** a change to every selected dimension: its points, references and
        style are copied before they change, so undo keeps the old ones */
    function dxEdit(fn) {
      if (!dxSel()) return;
      X.snapshot();
      const it = S.sel.it;
      X.selList().forEach(function (i) {
        const m = it.shapes[i];
        if (!m || m.t !== 'dimx' || m.locked) return;
        m.sty = Object.assign({}, m.sty || {});
        fn(m, it);
        m.sty = cleanSty(m.sty);
        if (!Object.keys(m.sty).length) delete m.sty;
      });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
    }
    X.markPop.dimx = {
      el: dxPop,
      sync: function (sh) {
        if (!sh) return;
        const st = E.dimStyle(sh);
        const m = E.dimMeasure(sh);
        dq('dxVal').innerHTML = 'Measured <b>' + X.esc(E.dimValueText(Object.assign({}, sh, { sty: Object.assign({}, sh.sty, { pre: '', suf: '' }) }), scale)) + '</b>' +
          (m.angle ? '' : ' <i>(' + (Math.round(m.v * 100) / 100) + ' pt)</i>');
        const nd = E.dimDefCount(sh), held = (sh.ref || []).slice(0, nd).filter(Boolean).length;
        dq('dxAssoc').textContent = held ? (held === nd ? 'Associative' : 'Associative (' + held + ' of ' + nd + ' points)') : 'Not associative';
        dq('dxAssoc').classList.toggle('on', !!held);
        dq('dxPFree').disabled = !held;
        dq('dxPHome').disabled = !sh.tm;
        const set = function (id, v) { const el = dq(id); if (document.activeElement !== el) el.value = v; };
        set('dxText', sh.label || '');
        set('dxPTh', st.th); set('dxPAs', st.as);
        dq('dxPAh').value = st.ah; dq('dxPU').value = st.u || ''; dq('dxPDp').value = m.angle ? (st.adp == null ? '' : String(st.adp)) : (st.dp == null ? '' : String(st.dp));
        set('dxPPre', st.pre || ''); set('dxPSuf', st.suf || '');
        dq('dxPTp').value = st.tp; dq('dxPTa').value = st.ta; dq('dxPBg').checked = !!st.bg;
        dq('dxPU').disabled = m.angle;
        /* the drawing scale rides along, as for the older dimensions */
        if (mpScale.parentNode !== dq('dxScaleRow')) dq('dxScaleRow').appendChild(mpScale);
        $('mpDimStyle').hidden = true; $('mpDimCal').hidden = false;
        noteScale();
      }
    };
    /* the older dimensions' popover takes the scale row back */
    const legacySync = X.markPop.dim.sync;
    X.markPop.dim.sync = function (sh) {
      if (mpScale.parentNode !== mpDim) mpDim.insertBefore(mpScale, mpDim.firstChild);
      $('mpDimStyle').hidden = false;
      legacySync(sh);
    };
    dxPop.addEventListener('change', function (e) {
      const id = e.target.id, v = e.target.value;
      const fl = function () { const n = parseFloat(v); return isFinite(n) && n >= 0 ? n : null; };
      if (id === 'dxText') { dxEdit(function (m) { m.label = v.trim() === '' ? null : v; if (m.label == null) delete m.label; }); return; }
      if (id === 'dxPTh') { const n = fl(); if (n > 0) dxEdit(function (m) { m.sty.th = n; }); else X.syncMarkPop(); return; }
      if (id === 'dxPAs') { const n = fl(); if (n != null) dxEdit(function (m) { m.sty.as = n; }); else X.syncMarkPop(); return; }
      if (id === 'dxPAh') { dxEdit(function (m) { m.sty.ah = v; }); return; }
      if (id === 'dxPU') { dxEdit(function (m) { m.sty.u = v; }); return; }
      if (id === 'dxPDp') {
        dxEdit(function (m) {
          const n = v === '' ? null : +v;
          if (E.dimMeasure(m).angle) m.sty.adp = n; else m.sty.dp = n;
        });
        return;
      }
      if (id === 'dxPPre') { dxEdit(function (m) { m.sty.pre = v; }); return; }
      if (id === 'dxPSuf') { dxEdit(function (m) { m.sty.suf = v; }); return; }
      if (id === 'dxPTp') { dxEdit(function (m) { m.sty.tp = v; }); return; }
      if (id === 'dxPTa') { dxEdit(function (m) { m.sty.ta = v; }); return; }
      if (id === 'dxPBg') { const on = e.target.checked; dxEdit(function (m) { m.sty.bg = on; }); }
    });
    dxPop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); }
      e.stopPropagation();
    });
    dq('dxPStyle').addEventListener('click', function () {
      const sh = dxSel(); if (!sh) return;
      styleDialog('Dimension Style — for the selected', sh.sty || {}).then(function (st) {
        if (!st) return;
        dxEdit(function (m) { m.sty = Object.assign({}, st); });
      });
    });
    dq('dxPCur').addEventListener('click', function () {
      const sh = dxSel(); if (!sh) return;
      setCurrentStyle(sh.sty || {});
      X.toast('New dimensions take this look');
    });
    dq('dxPHome').addEventListener('click', function () {
      dxEdit(function (m) { if (m.tm) { m.tm = false; m.pts = m.pts.slice(0, E.dimDefCount(m) + 1); } });
    });
    dq('dxPFree').addEventListener('click', function () {
      dxEdit(function (m) { delete m.ref; });
      X.toast('It no longer follows what it measures');
    });

    /* Double-click a dimension: its text, typed (<> for the measured value) */
    function editDimText(it, s) {
      X.ask('What this dimension says. <> stands for the measured value (' + E.dimValueText(s, scale) + ');\n' +
        'leave it empty for the measured value alone.', s.label || '', { title: 'Dimension text' }).then(function (v) {
        if (v === null || it.shapes.indexOf(s) < 0) return;
        X.snapshot();
        if (v.trim() === '') delete s.label; else s.label = v;
        X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
      });
    }
    /* Double-click a dimension, under Select: its text. Taken from two
       presses rather than the dblclick event: the first press picks the
       mark and redraws it, and a browser only sends dblclick when both
       clicks land on the same element. */
    let dxPress = null;
    $('stage').addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || S.tool !== 'select') { dxPress = null; return; }
      const now = Date.now();
      const twice = dxPress && now - dxPress.t < 450 && Math.hypot(e.clientX - dxPress.x, e.clientY - dxPress.y) < 6;
      dxPress = twice ? null : { t: now, x: e.clientX, y: e.clientY };
      if (!twice) return;
      const it = S.items.filter(function (x) {
        if (!x.anno || !x.vp) return false;
        const b = x.anno.getBoundingClientRect();
        return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      })[0];
      if (!it) return;
      const b = it.anno.getBoundingClientRect();
      const i = dimxAt(it, it.vp.convertToPdfPoint(e.clientX - b.left, e.clientY - b.top), null);
      if (i < 0) return;
      const s = it.shapes[i];
      /* once this press has finished with the mark */
      setTimeout(function () { editDimText(it, s); }, 0);
    }, true);

    /* ---- a page's marks as an SVG file: every mark, dimensions included,
       drawn as on screen, in points on paper ---- */
    X.exportPageSvg = function (it) {
      if (!it || !it.anno || !it.vp) return Promise.resolve(false);
      const k = Math.max(0.05, S.scale);
      const W = it.vp.width, H = it.vp.height;
      const out = document.createElementNS(SVGNS, 'svg');
      out.setAttribute('xmlns', SVGNS);
      out.setAttribute('width', (W / k).toFixed(2) + 'pt');
      out.setAttribute('height', (H / k).toFixed(2) + 'pt');
      out.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const page = document.createElementNS(SVGNS, 'rect');
      page.setAttribute('width', W); page.setAttribute('height', H);
      page.setAttribute('fill', '#FFFFFF');
      out.appendChild(page);
      X.markKids(it.anno).forEach(function (el, i) {
        const s = it.shapes[i];
        if (!s || s.hide || el.style.display === 'none') return;
        const c = el.cloneNode(true);
        /* what is only there to be taken hold of, or to show a selection, stays behind */
        Array.prototype.forEach.call(c.querySelectorAll('.dxhit, .grab, .hnd, .dxgrips, .rcwg, title'), function (x) { x.remove(); });
        c.classList.remove('picked');
        out.appendChild(c);
      });
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out);
      const name = String((X.docName && X.docName()) || 'page').replace(/\.pdf$/i, '') + '-p' + (S.items.indexOf(it) + 1) + '.svg';
      return Promise.resolve(X.download(new TextEncoder().encode(xml), name, 'image/svg+xml')).then(function () { return xml; });
    };

    /* --- continuous line (polyline) ---
       Click, click, click, the same gesture as Continuous Dimension above:
       each click adds a segment on from the last point, with a rubber-band
       preview of the next one; double-click, right-click, Enter or Esc ends
       it. Unlike a dimension chain, each segment is free to run any way —
       Shift constrains it off the *previous* point only (snapLine), not the
       whole line's first direction. */
    let poly = null;                               /* {it, pts:[[x,y],...]} */

    function polyGhost(pts) { return { t: 'poly', pts: pts, c: S.color, w: S.width }; }

    function endPoly(commit) {
      const had = poly;
      poly = null;
      if (!had) return;         /* nothing was in progress: the point just acquired for the
                                    line about to start is not this call's to give up */
      trackStart(had.it, null); /* this line is done; its own guide and a tracked point
                                    acquired for it go back, so neither carries into the next one */
      readHide();
      const it = had.it;
      if (commit && had.pts.length > 1) {
        X.snapshot();
        it.shapes.push(polyGhost(had.pts.map(function (p) { return [p[0], p[1]]; })));
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
        X.toast(had.pts.length - 1 + ' segment' + (had.pts.length > 2 ? 's' : '') + ' in the line');
      } else {
        X.drawShapes(it);
      }
      if (S.tool === 'poly') $('modeHint').innerHTML = X.hints.poly;
    }

    /** A point of this same line, not yet a real mark so snapFind never sees
        it — close a loop by snapping back onto it anyway. The nearest one
        inside tolerance, shown and returned the way an ordinary Endpoint is. */
    function polySelfSnap(it, raw) {
      if (!poly || poly.it !== it) return null;
      const tol = (X.isMobile() ? 16 : 15) / Math.max(0.05, S.scale);
      let best = null, bd = tol;
      poly.pts.forEach(function (q) {
        const d = Math.hypot(q[0] - raw[0], q[1] - raw[1]);
        if (d < bd) { bd = d; best = q; }
      });
      if (!best) return null;
      const hit = { p: best, kind: 'end', label: 'Endpoint', d: bd, r: SNAP_RANK.end };
      snapShow(it, hit);
      return hit;
    }

    X.tools.poly = {
      colors: true, widths: true,
      down: function () { /* a click tool: everything happens on release */ },
      move: function (it, at, e) {
        if (!poly || poly.it !== it || !it.vp) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const self = polySelfSnap(it, raw);
        const sn = self ? self.p : X.snapPt(it, raw, e);
        const last = poly.pts[poly.pts.length - 1];
        let p = sn || raw;
        if (e && e.shiftKey && !sn) p = X.snapLine(last, p);
        X.drawShapes(it, polyGhost(poly.pts.concat([p])));
        readShow(it, last, p);
      },
      cancel: function () { endPoly(poly && poly.pts.length >= 2); },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const self = polySelfSnap(it, raw);
        const sn = self ? self.p : X.snapPt(it, raw, e);
        const p = sn || raw;
        if (!poly || poly.it !== it) {          /* the first point, or a jump to another page */
          endPoly(false);
          poly = { it: it, pts: [p] };
          trackStart(it, p);             /* the next segment's own guide, from here */
          $('modeHint').innerHTML = 'Click the next point. <b>Enter</b>, <b>Esc</b> or ' +
            'double-click ends the line.';
          return;
        }
        const last = poly.pts[poly.pts.length - 1];
        let q = p;
        if (e && e.shiftKey && !sn) q = X.snapLine(last, q);
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 3) return;   /* the second click of a double-click */
        poly.pts.push(q);
        trackStart(it, q);               /* each segment runs its guide from the point before it */
        X.drawShapes(it, polyGhost(poly.pts));
      }
    };
    /* Esc and Enter end the line but keep the tool, so the next click starts
       a fresh one; a second Esc puts the tool down as usual. Capture phase,
       to get there before core's own Esc handling. */
    document.addEventListener('keydown', function (e) {
      if (!poly || S.tool !== 'poly') return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation();
        endPoly(poly.pts.length >= 2);
      }
    }, true);
    $('stage').addEventListener('dblclick', function () {
      if (poly && S.tool === 'poly') endPoly(poly.pts.length >= 2);
    });
    $('stage').addEventListener('contextmenu', function (e) {
      if (S.tool !== 'poly' || !poly) return;
      e.preventDefault();
      endPoly(poly.pts.length >= 2);
    });
    X.on('tool', function (t) { if (t !== 'poly') endPoly(poly && poly.pts.length >= 2); });

    /* ---------------- radius, diameter and angular dimensions ---------------- */

    /* A PDF has no circles or lines to pick, only ink, so these are defined by
       points you click on the drawing: three on a circle's edge give its exact
       centre and radius; a corner and a point on each arm give an angle. The
       last click places the reading, the way AutoCAD's does. */

    const ALL_DIMS = { dim: 1, dimr: 1, dimd: 1, dima: 1 };

    const measureCtx = document.createElement('canvas').getContext('2d');
    function textPx(str, px, s) {
      const f = readingFont(s || {});
      measureCtx.font = (f.style === 'italic' ? 'italic ' : '') + f.weight + ' ' + px + 'px ' + f.family;
      return measureCtx.measureText(str).width;
    }
    function unitOf(p, q) {
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    }

    /* One end of a dimension on screen: p is the end, u points outward along
       the line. Honours the dimension's style — arrow, tick or dot. */
    function endMark(g, p, u, s, idx, it) {
      const k = S.scale, st = s.ds || 'arrow', z = E.dimScale(s);
      const ls = scaledDim(s), sw = Math.max(0.6, ls.w * k);
      let el;
      if (st === 'tick') {
        const h = (3.5 + s.w * 1.2) * k * z;
        const tx = (u[0] + u[1]) / Math.SQRT2 * h, ty = (u[1] - u[0]) / Math.SQRT2 * h;
        el = document.createElementNS(SVGNS, 'line');
        el.setAttribute('x1', p[0] - tx); el.setAttribute('y1', p[1] - ty);
        el.setAttribute('x2', p[0] + tx); el.setAttribute('y2', p[1] + ty);
        el = stroked(el, ls, idx, it);
        el.style.strokeWidth = sw * 1.8; el.style.strokeLinecap = 'butt';
      } else if (st === 'dot') {
        el = document.createElementNS(SVGNS, 'circle');
        el.setAttribute('cx', p[0]); el.setAttribute('cy', p[1]);
        el.setAttribute('r', (1.6 + s.w * 0.9) * k * z);
        el = stroked(el, ls, idx, it);
        el.style.fill = s.c; el.style.fillOpacity = X.shOp(s);
      } else {
        const h = X.arrowHead(p[0] - u[0] * 10, p[1] - u[1] * 10, p[0], p[1],
          Math.max(0.6, s.w * k) * 1.1).map(function (q) {
          return z === 1 ? q : [p[0] + (q[0] - p[0]) * z, p[1] + (q[1] - p[1]) * z];
        });
        el = document.createElementNS(SVGNS, 'polyline');
        el.setAttribute('points', h[0][0] + ',' + h[0][1] + ' ' + p[0] + ',' + p[1] + ' ' + h[1][0] + ',' + h[1][1]);
        el = stroked(el, ls, idx, it);
      }
      el.style.strokeDasharray = 'none';
      g.appendChild(el);
    }

    /* the mark with its lines' weight scaled by its size (s.dz), to stroke */
    function scaledDim(s) {
      const z = E.dimScale(s);
      return z === 1 ? s : Object.assign({}, s, { w: s.w * z });
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
      readingStyle(t, s, size);
      t.style.pointerEvents = 'none';
      return t;
    }

    /* --- radius and diameter: a leader through the centre, the reading on a
       short landing beside it --- */
    function radialRender(it, s0, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const z = E.dimScale(s0), s = scaledDim(s0);
      const k = S.scale, G = radGeom(s);
      const P = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const aS = P(s.a), bS = P(s.b), nearS = P(G.near), farS = P(G.far);
      const from = s.t === 'dimd' ? farS : aS;
      g.appendChild(stroked(lineEl(from, G.outside ? bS : nearS), s, idx, it));
      endMark(g, nearS, unitOf(aS, nearS), s0, idx, it);
      if (s.t === 'dimd') endMark(g, farS, unitOf(aS, farS), s0, idx, it);

      const text = dimLabel(s0);
      const size = dimTextPt(s0) * k;
      const tw = textPx(text, size, s0);
      const lift = (s.w + 2 * z) * k;
      if (G.outside) {
        const dir = bS[0] >= aS[0] ? 1 : -1;
        const land = [bS[0] + dir * (tw + 4 * z * k), bS[1]];
        g.appendChild(stroked(lineEl(bS, land), s, idx, it));
        g.appendChild(textEl(text, bS[0] + dir * 2 * z * k, bS[1] - lift, dir > 0 ? 'start' : 'end', size, s));
      } else {
        g.appendChild(textEl(text, bS[0], bS[1] - lift, 'middle', size, s));
      }
      return g;
    }
    X.shapeRenderers.dimr = radialRender;
    X.shapeRenderers.dimd = radialRender;

    /* --- angular: an arc between the arms, with extension lines out to it
       when it sits beyond where the arms were picked --- */
    function armExtensions(s, g) { return E.armExtensions(s, g); }
    function angEnds(s, g) { return E.angEnds(s, g); }
    function angLabelPt(s, g, size) { return E.angLabelPt(s, g, size); }

    X.shapeRenderers.dima = function (it, s0, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const s = scaledDim(s0);
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
        endMark(g, pS, unitOf(pS, qS), s0, idx, it);
      });
      const size = dimTextPt(s0);
      const L = P(angLabelPt(s, G, size));
      g.appendChild(textEl(dimLabel(s), L[0], L[1], 'middle', size * k, s, true));
      return g;
    };

    ['dimr', 'dimd', 'dima'].forEach(function (t) {
      X.handleKind[t] = 'ends';            /* grip the centre/corner and the reading */
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
    let fpick = null;                              /* {it, first: {idx, s}} — fillet's own two-line pick */
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
                         dim: 1, dimal: 1, dimc: 1, dimb: 1, dimr: 1, dimd: 1, dima: 1, dimarc: 1, dimo: 1,
                         poly: 1, pen: 1 };
    const SNAP_KINDS = [['end', 'Endpoint'], ['mid', 'Midpoint'], ['int', 'Intersection'],
                        ['near', 'Nearest'], ['perp', 'Perpendicular'], ['par', 'Parallel'],
                        ['mark', 'Points of your marks'], ['guide', 'Guides']];
    /* Perpendicular and Parallel are about the direction of the line in hand,
       so they only work for tools that draw one from a start point */
    const DIR_TOOLS = { line: 1, arrow: 1, dim: 1, dimal: 1, poly: 1, pen: 1 };
    /* A crossing of two real lines is as much a point as an end is, so it
       ranks with them and the nearer of the two wins; the crossings tracking
       and the rulers invent rank below that, and lying along something below
       that again. */
    const SNAP_RANK = { end: 0, mark: 0, cen: 0, int: 0, gint: 1, tcross: 1, tseg: 1, txg: 1,
                        perp: 1, mid: 2, guide: 2, ton: 2, par: 2, near: 3, grid: 1, gline: 2 };
    const snap = { on: true, kinds: { end: 1, mid: 1, int: 1, near: 1, perp: 1, par: 1, mark: 1, guide: 1 } };
    try {
      const pref = JSON.parse(localStorage.getItem('adpdf.snap') || 'null');
      if (pref) { snap.on = pref.on !== false; if (pref.kinds) snap.kinds = pref.kinds; }
      /* settings kept before guides could be caught: catch them */
      if (snap.kinds.guide === undefined) snap.kinds.guide = 1;
      /* and before perpendicular and parallel were there */
      if (snap.kinds.perp === undefined) snap.kinds.perp = 1;
      if (snap.kinds.par === undefined) snap.kinds.par = 1;
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

    /* a path's anchors (not its handles): a Pen path's every third point, an
       Edit Object or Pathfinder shape's ends of each command */
    function penAnchors(pts) {
      const out = [];
      for (let a = 0; a < pts.length; a += 3) out.push(pts[a]);
      return out;
    }
    function vpathAnchors(s) {
      const out = [];
      let j = 0;
      for (const c of String(s.k || '')) {
        if (c === 'M' || c === 'L') { if (s.pts[j]) out.push(s.pts[j]); j++; }
        else if (c === 'C') { if (s.pts[j + 2]) out.push(s.pts[j + 2]); j += 3; }
      }
      return out;
    }
    /* the points a mark offers, as Illustrator's anchor points: its ends, a
       box's corners (turned with it), a circle's four quadrant points and
       its centre, every anchor of a path */
    X.markPoints = function (s) { return markPoints(s); };
    function markPoints(s) {
      const out = [];
      if (!s || s.hide) return out;
      const t = s.t;
      if (t === 'pen' && s.pts && s.pts.length) {
        penAnchors(s.pts).forEach(function (q) { out.push([q, 'Anchor']); });
        return out;
      }
      if (t === 'vpath' && s.pts && s.pts.length) {
        vpathAnchors(s).forEach(function (q) { out.push([q, 'Anchor']); });
        return out;
      }
      if (!s.a) return out;
      if (t === 'ellipse' && s.b) {
        const b = E.boxOf(s), c = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
        out.push([c, 'Centre']);
        [[b.x1, c[1]], [b.x2, c[1]], [c[0], b.y1], [c[0], b.y2]].forEach(function (q) {
          out.push([s.r ? E.rotPt(q, c, s.r) : q, 'Anchor']);
        });
        return out;
      }
      /* a rectangle with rounded corners: its eight anchors, where each arc
         meets a side, as Illustrator's anchor points are, and its centre */
      if (t === 'rect' && s.b && E.rectRounded(s)) {
        E.rectAnchors(s).forEach(function (q) { out.push([q, 'Anchor']); });
        out.push([[(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 'Centre']);
        return out;
      }
      if ((t === 'rect' || t === 'cloud') && s.b && s.r) {
        E.rectCorners(s).forEach(function (q) { out.push([q, 'Anchor']); });
        return out;
      }
      if (t === 'ink' && s.pts && s.pts.length) {
        out.push([s.pts[0], 'Pen end'], [s.pts[s.pts.length - 1], 'Pen end']);
      } else if (t === 'dimr' || t === 'dimd') {
        out.push([s.a, 'Centre']);
      } else if (t === 'dima') {
        out.push([s.a, 'Corner']);
      } else if (t === 'ellipse' && s.b) {
        out.push([[(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 'Centre']);
      } else if ((t === 'rect' || t === 'cloud' || t === 'redact') && s.b) {
        out.push([s.a, 'Anchor'], [s.b, 'Anchor'], [[s.a[0], s.b[1]], 'Anchor'], [[s.b[0], s.a[1]], 'Anchor']);
      } else if (t === 'poly' && s.pts && s.pts.length) {
        /* every point of a Continuous Line, its ends and its corners */
        s.pts.forEach(function (q) { out.push([q, 'Anchor']); });
      } else if (s.b && (t === 'line' || t === 'arrow' || t === 'dim' || t === 'arc')) {
        out.push([s.a, 'Mark end'], [s.b, 'Mark end'],
                 [[(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 'Mark middle']);
      }
      return out;
    }

    /** A mark's own straight lines, in PDF points, for crossing against the
        page's and against each other. Curves and freehand are left out: their
        crossings are not places a reader points at. */
    function markSegs(s) {
      const t = s.t;
      if (s.hide) return [];
      if (s.b && (t === 'line' || t === 'arrow' || t === 'dim')) return [[s.a, s.b]];
      /* rounded: just its straight sides, between the arcs */
      if (s.b && t === 'rect' && E.rectRounded(s)) {
        const P = E.rectBezier(s), out = [];
        for (let i = 0; i + 3 < P.length; i += 3) {
          if (P[i][0] === P[i + 1][0] && P[i][1] === P[i + 1][1]) out.push([P[i], P[i + 3]]);
        }
        return out;
      }
      if (s.b && (t === 'rect' || t === 'cloud' || t === 'redact') && !s.r) {
        const a = s.a, b = s.b, c = [s.a[0], s.b[1]], d = [s.b[0], s.a[1]];
        return [[a, d], [d, b], [b, c], [c, a]];
      }
      if (t === 'poly' && s.pts && s.pts.length > 1) {
        const out = [];
        for (let i = 1; i < s.pts.length && out.length < 24; i++) out.push([s.pts[i - 1], s.pts[i]]);
        return out;
      }
      if (s.b && (t === 'rect' || t === 'cloud') && s.r) {
        const q = E.rectCorners(s);
        return [[q[0], q[1]], [q[1], q[2]], [q[2], q[3]], [q[3], q[0]]];
      }
      /* a Pen path's straight segments: those whose handles sit on their anchors */
      if (t === 'pen' && s.pts && s.pts.length >= 4) {
        const out = [], P = s.pts, on = function (a, b) { return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01; };
        for (let i = 0; i + 3 < P.length && out.length < 24; i += 3) {
          if (on(P[i], P[i + 1]) && on(P[i + 2], P[i + 3])) out.push([P[i], P[i + 3]]);
        }
        return out;
      }
      return [];
    }

    function snapFind(it, p, opts) {
      const K = snap.kinds;
      const tol = (X.isMobile() ? 16 : 15) / Math.max(0.05, S.scale);
      let best = null;
      function consider(q, kind, label) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > tol) return;
        const r = SNAP_RANK[kind];
        /* a mark's own anchor on the very spot of another catch (a box's
           corner, where its two edges also cross) is called an anchor */
        const sameSpot = best && kind === 'mark' && r === best.r && Math.abs(d - best.d) < 1e-6;
        if (!best || r < best.r || (r === best.r && d < best.d) || sameSpot) {
          best = { p: q, kind: kind, label: label, d: d, r: r };
        }
      }

      /* the start of the line in hand, for perpendicular and parallel */
      const dirFrom = DIR_TOOLS[S.tool] && !(opts && opts.skip != null) && opStart && opStart.it === it
        ? opStart.p : null;
      const wantDir = !!dirFrom && !!(K.perp || K.par);
      hoverSeg = null;
      let hoverD = tol;
      function under(a, b) {
        if (!wantDir) return;
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        if (!l2) return;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
        const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        if (d <= hoverD) { hoverD = d; hoverSeg = [a, b]; }
      }

      const grid = gridOf(it);
      const lines = [];
      if (grid) {
        const ids = nearSegs(grid, p, tol);
        for (let n = 0; n < ids.length; n++) {
          const s = grid.segs[ids[n]], a = s[0], b = s[1];
          if (!s[2]) {
            if (K.end) { consider(a, 'end', 'Endpoint'); consider(b, 'end', 'Endpoint'); }
            if (K.mid) consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'mid', 'Midpoint');
            lines.push(s);
            under(a, b);
          }
          if (K.near) {
            const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
            let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            consider([a[0] + t * dx, a[1] + t * dy], 'near', 'Nearest');
          }
        }
      }

      /* where two things you drew cross is a point as much as where two of the
         page's own lines do: the marks near the pointer join the list. Only
         the near ones, and capped, because crossing is quadratic. */
      if (K.int || wantDir) {
        it.shapes.forEach(function (s, idx) {
          if (skips(opts, idx)) return;
          if (lines.length > 80) return;
          markSegs(s).forEach(function (g) {
            if (lines.length > 80) return;
            const lo = Math.min(g[0][0], g[1][0]) - tol, hi = Math.max(g[0][0], g[1][0]) + tol;
            const bo = Math.min(g[0][1], g[1][1]) - tol, to = Math.max(g[0][1], g[1][1]) + tol;
            if (p[0] < lo || p[0] > hi || p[1] < bo || p[1] > to) return;
            lines.push(g);
            under(g[0], g[1]);
          });
        });
      }

      /* square onto a line near the pointer from where this line began: the
         foot of the perpendicular, when the pointer is close to it */
      if (K.perp && dirFrom && TRK) {
        for (let i = 0; i < lines.length; i++) {
          const f = TRK.perpFoot(dirFrom, lines[i][0], lines[i][1]);
          if (f) consider(f.p, 'perp', 'Perpendicular');
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

      /* the ruler guides on this page (js/rulers.js), while they show: the
         point lines up with a guide near it, or sits where two cross */
      if (K.guide && it.guides && it.guides.length && it.wrap && document.body.classList.contains('rulers-on')) {
        const v = it.vp.convertToViewportPoint(p[0], p[1]);
        const off = it.off || { left: 0, top: 0 };
        const W = it.wrap.clientWidth, H = it.wrap.clientHeight;
        const px = tol * S.scale;
        let gx = null, gy = null;
        it.guides.forEach(function (g) {
          if (g.v) {
            const x = g.at * W + off.left;
            if (Math.abs(x - v[0]) <= px && (gx === null || Math.abs(x - v[0]) < Math.abs(gx - v[0]))) gx = x;
          } else {
            const y = g.at * H + off.top;
            if (Math.abs(y - v[1]) <= px && (gy === null || Math.abs(y - v[1]) < Math.abs(gy - v[1]))) gy = y;
          }
        });
        if (gx !== null && gy !== null) consider(it.vp.convertToPdfPoint(gx, gy), 'gint', 'Guide crossing');
        if (gx !== null) consider(it.vp.convertToPdfPoint(gx, v[1]), 'guide', 'Guide');
        if (gy !== null) consider(it.vp.convertToPdfPoint(v[0], gy), 'guide', 'Guide');
      }

      if (K.mark) {
        it.shapes.forEach(function (s, idx) {
          if (skips(opts, idx)) return;
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

    /* ---- the reading that rides with the pointer while something is drawn:
       how long it is in the document's own units, and at what angle ---- */
    const readout = document.createElement('div');
    readout.className = 'drawread'; readout.id = 'drawRead'; readout.hidden = true;
    readout.setAttribute('aria-hidden', 'true');
    document.body.appendChild(readout);
    const startDot = document.createElement('div');
    startDot.className = 'drawstart'; startDot.id = 'drawStart'; startDot.hidden = true;
    startDot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(startDot);

    function readHide() {
      if (!readout.hidden) readout.hidden = true;
      if (!startDot.hidden) startDot.hidden = true;
    }
    /** a and b in PDF points on it: the reading beside b, the dot on a. */
    function readShow(it, a, b) {
      if (!it.anno) return;
      const r = it.anno.getBoundingClientRect();
      const va = it.vp.convertToViewportPoint(a[0], a[1]);
      const vb = it.vp.convertToViewportPoint(b[0], b[1]);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1) { readHide(); return; }
      const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      readout.textContent = measureLen(len) + '   ' + ang.toFixed(0) + '°';
      /* clear of the snap marker's own label, which hangs just below right */
      readout.style.transform =
        'translate(' + Math.round(r.left + vb[0] + 14) + 'px,' + Math.round(r.top + vb[1] + 34) + 'px)';
      readout.hidden = false;
      startDot.style.transform =
        'translate(' + Math.round(r.left + va[0]) + 'px,' + Math.round(r.top + va[1]) + 'px)';
      startDot.hidden = false;
    }
    const MARK_SVG = {
      grid: '<path d="M9 2v14M2 9h14"/><rect x="6" y="6" width="6" height="6"/>',
      gline: '<path d="M2 9h14M9 5v8"/>',
      end: '<rect x="3.5" y="3.5" width="11" height="11"/>',
      mark: '<rect x="3.5" y="3.5" width="11" height="11"/><circle cx="9" cy="9" r="1.2" class="dot"/>',
      cen: '<circle cx="9" cy="9" r="5.5"/><path d="M9 6.5v5M6.5 9h5"/>',
      mid: '<path d="M9 3.2L15 14.3H3z"/>',
      int: '<path d="M4 4l10 10M14 4L4 14"/>',
      near: '<path d="M4 4h10L4 14h10z"/>',
      perp: '<path d="M3 14.5h12M6 14.5V3.5"/><path d="M6 10.5h4v4"/>',
      par: '<path d="M3 11L10 4M8 14l7-7"/>',
      guide: '<path d="M2 9h14" stroke-dasharray="2.5 1.5"/><circle cx="9" cy="9" r="2.6"/>',
      gint: '<path d="M2 9h14M9 2v14" stroke-dasharray="2.5 1.5"/><circle cx="9" cy="9" r="2.6"/>',
      /* tracking: the dashes say the guide is one this point sent out */
      ton: '<path d="M2 9h14" stroke-dasharray="3 2"/><path d="M9 5.5v7"/>',
      tcross: '<path d="M2 9h14M9 2v14" stroke-dasharray="3 2"/><circle cx="9" cy="9" r="2.2"/>',
      tseg: '<path d="M2 9h14" stroke-dasharray="3 2"/><path d="M5 14L13 4"/>'
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
      /* Angular picks whole lines until it has both (a vertex and its arms snap) */
      if (S.tool === 'dima' && !(opts && opts.force) && (!dx || dx.it == null || dx.mode !== 'v')) return false;
      return true;
    }

    /* ---- tracking ----
       Rest on a snap point and it is acquired: two dashed guides go out from
       it, one across and one down. Two points are held at once — a third drops
       the oldest — and the point a drawing started from sends out its own pair
       as well. The pointer is caught along any of them, where two of them
       cross, and where one crosses a ruler guide or one of the drawing's
       lines. The geometry is js/snaptrack.js, in screen pixels; this part
       holds the acquired points, the dwell that acquires them, and the guides
       on screen. */
    const TRK = window.ADDPDF_SNAPTRACK;
    const DWELL = 380;                     /* ms resting on a point to acquire it */
    const MAX_ACQ = 2;                     /* held at once; a third drops the oldest */
    /* the catches worth tracking from: real points, not somewhere along a line */
    const ACQUIRE = { end: 1, mid: 1, int: 1, mark: 1, cen: 1, gint: 1 };
    let acqs = [];                         /* [{it, p}] — acquired points, in PDF points */
    let opStart = null;                    /* {it, p} — where the drawing in hand began */
    let dwellAt = null, dwellTimer = 0;
    /* Parallel: rest on a line while drawing and its direction is taken up;
       from then on the line in hand is caught running the same way. */
    let hoverSeg = null;                   /* [a, b] — the straight line under the pointer, from snapFind */
    let parRef = null;                     /* {it, a, b} — the line to run parallel to, in PDF points */
    let parAt = null, parTimer = 0;

    function tolPx() { return X.isMobile() ? 16 : 15; }
    function samePt(a, b) { return a && b && Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01; }

    /** The acquired points on this page, and the start point if it is here. */
    function trackOn(it) {
      return acqs.filter(function (a) { return a.it === it; });
    }

    function dwellStop() {
      if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = 0; }
      dwellAt = null;
    }
    function parStop() {
      if (parTimer) { clearTimeout(parTimer); parTimer = 0; }
      parAt = null;
    }
    function sameSeg(a, b) {
      return a && b && ((samePt(a[0], b[0]) && samePt(a[1], b[1])) || (samePt(a[0], b[1]) && samePt(a[1], b[0])));
    }
    /* Resting on the same straight line for DWELL, while a line is being
       drawn, takes up its direction for Parallel. */
    function parWatch(it) {
      const seg = hoverSeg;
      if (!TRK || !seg || !snap.kinds.par || !opStart || opStart.it !== it) { parStop(); return; }
      if (parRef && parRef.it === it && sameSeg([parRef.a, parRef.b], seg)) { parStop(); return; }
      if (parAt && sameSeg(parAt, seg)) return;
      parStop();
      parAt = seg;
      parTimer = setTimeout(function () {
        parTimer = 0;
        if (!parAt || !snap.on || !opStart || opStart.it !== it) return;
        parRef = { it: it, a: [parAt[0][0], parAt[0][1]], b: [parAt[1][0], parAt[1][1]] };
        parAt = null;
        trackPaint(it, null);
      }, DWELL);
    }
    /** Running parallel to the line taken up, from where this line began, as a
        snapFind-shaped hit in PDF points — or null. Worked in screen pixels so
        the reach is the same at any zoom. */
    function parFind(it, p, opts) {
      if (!TRK || !snap.kinds.par || !parRef || parRef.it !== it) return null;
      if (!opStart || opStart.it !== it || !DIR_TOOLS[S.tool] || (opts && opts.skip != null)) return null;
      const vp = function (q) { const w = it.vp.convertToViewportPoint(q[0], q[1]); return [w[0], w[1]]; };
      const hit = TRK.parallel(vp(opStart.p), vp(parRef.a), vp(parRef.b), vp(p), X.isMobile() ? 12 : 11);
      if (!hit) return null;
      const q = it.vp.convertToPdfPoint(hit.p[0], hit.p[1]);
      return { p: [q[0], q[1]], kind: 'par', label: 'Parallel', d: hit.d, r: SNAP_RANK.par };
    }

    /** Give up every acquired point and take the guides off the screen. */
    function trackClear() {
      dwellStop();
      parStop();
      parRef = null;
      acqs = [];
      trackPaint(null, null);        /* takes the guides off, start point or not */
    }
    /** The drawing in hand has begun at p, or finished (p null). Its own pair
        of guides goes up while it runs, and the points acquired for it are
        given back when it ends, so none of it carries into the next one. */
    function trackStart(it, p) {
      opStart = p ? { it: it, p: [p[0], p[1]] } : null;
      if (!p) trackClear();
      else trackPaint(it, null);
    }
    /* Resting on the same point for DWELL acquires it. Moving to another point,
       or off the geometry, starts the wait again. */
    function dwellWatch(it, hit) {
      if (!TRK || !hit || !ACQUIRE[hit.kind]) { dwellStop(); return; }
      if (acqs.some(function (a) { return a.it === it && samePt(a.p, hit.p); })) { dwellStop(); return; }
      if (dwellAt && samePt(dwellAt, hit.p)) return;         /* already waiting on it */
      dwellStop();
      dwellAt = [hit.p[0], hit.p[1]];
      dwellTimer = setTimeout(function () {
        dwellTimer = 0;
        if (!dwellAt || !snap.on) return;
        acqs.push({ it: it, p: dwellAt });
        while (acqs.length > MAX_ACQ) acqs.shift();
        dwellAt = null;
        trackPaint(it, null);
      }, DWELL);
    }

    /** The ruler guides on this page as screen pixels, the way snapFind reads
        them, or an empty list when the rulers are off. */
    function rulerPx(it) {
      if (!it.guides || !it.guides.length || !it.wrap) return [];
      if (!document.body.classList.contains('rulers-on')) return [];
      const off = it.off || { left: 0, top: 0 };
      const W = it.wrap.clientWidth, H = it.wrap.clientHeight;
      return it.guides.map(function (g) {
        return g.v ? { v: 1, at: g.at * W + off.left } : { v: 0, at: g.at * H + off.top };
      });
    }

    /** What the acquired point's guides catch at p, as a snapFind-shaped hit in
        PDF points — or null. The segments looked at are only the few already
        under the pointer, so this costs the same on a busy page as an empty one. */
    function trackFind(it, p, opts) {
      if (!TRK) return null;
      const here = trackOn(it);
      const start = opStart && opStart.it === it ? opStart.p : null;
      if (!here.length && !start) return null;
      /* tracking is for drawing and measuring; dragging a mark's own end keeps
         the plain snaps it always had */
      if (opts && opts.skip != null) return null;
      const toVp = function (q) {
        const w = it.vp.convertToViewportPoint(q[0], q[1]);
        return [w[0], w[1]];
      };
      const as = here.map(function (a) { return toVp(a.p); });
      const v = it.vp.convertToViewportPoint(p[0], p[1]);
      /* a guide is a line, so it is caught a little tighter than a point */
      const tol = X.isMobile() ? 12 : 11;
      const segs = [];
      const grid = gridOf(it);
      if (grid) {
        const ids = nearSegs(grid, p, tol / Math.max(0.05, S.scale));
        for (let i = 0; i < ids.length && segs.length < 40; i++) {
          const s = grid.segs[ids[i]];
          segs.push([it.vp.convertToViewportPoint(s[0][0], s[0][1]),
                     it.vp.convertToViewportPoint(s[1][0], s[1][1])]);
        }
      }
      const opt = { rulers: rulerPx(it), segs: segs, start: start ? [toVp(start)] : null };
      const hit = TRK.best(as, [v[0], v[1]], tol, opt);
      if (!hit) return null;
      const q = it.vp.convertToPdfPoint(hit.p[0], hit.p[1]);
      /* d is in pixels here; snapFind's ranking only compares within a kind, and
         the tracking kinds are compared against each other in these same units */
      /* ray and ray2 ride along so the paint knows which guides to light up */
      return { p: [q[0], q[1]], kind: hit.kind, label: hit.label, d: hit.d,
               r: SNAP_RANK[hit.kind], v: hit.v, ray: hit.ray, ray2: hit.ray2 };
    }

    /* ---- the guides on screen ---- */
    const NS = 'http://www.w3.org/2000/svg';
    const trkSvg = document.createElementNS(NS, 'svg');
    trkSvg.setAttribute('class', 'snaptrack');
    trkSvg.setAttribute('aria-hidden', 'true');
    /* trkSvg is an SVG element: the global `hidden` IDL attribute does not
       reflect onto it the way it does on an HTMLElement (confirmed in real
       Chrome — setting .hidden here never touches the actual attribute), so
       CSS's [hidden] selector never matches it and it stays display:block
       forever once first shown. style.display is what actually hides it. */
    trkSvg.style.display = 'none';
    document.body.appendChild(trkSvg);
    /* one line per guide and one badge per acquired point, kept and reused:
       this is redrawn on every pointer move */
    const trkPool = { line: [], path: [] };
    /* Parallel's own two: the line taken up, drawn over, and the guide through
       the start point running the same way. Made first, so the pool's own
       elements never land on them. */
    const parRefEl = document.createElementNS(NS, 'line');
    parRefEl.setAttribute('class', 'parref');
    const parGuideEl = document.createElementNS(NS, 'line');
    parGuideEl.setAttribute('class', 'parguide');
    parRefEl.style.display = 'none';
    parGuideEl.style.display = 'none';
    trkSvg.appendChild(parRefEl);
    trkSvg.appendChild(parGuideEl);
    function trkEl(kind, n) {
      const pool = trkPool[kind];
      while (pool.length <= n) {
        const el = document.createElementNS(NS, kind);
        pool.push(el);
        trkSvg.appendChild(el);
      }
      pool[n].removeAttribute('hidden');
      return pool[n];
    }
    function trkTrim(kind, n) {
      const pool = trkPool[kind];
      for (let i = n; i < pool.length; i++) pool[i].setAttribute('hidden', '');
    }

    /** Draw the acquired point and whichever of its guides are live. The guides
        are clipped to the stage, so they never run out over the chrome. */
    function trackPaint(ignored, hit) {
      /* always the acquired points' own page, whatever page the pointer is over */
      const it = (acqs[0] && acqs[0].it) || (opStart && opStart.it);
      if (!it || !it.vp || !it.anno || (!acqs.length && !opStart)) {
        if (trkSvg.style.display !== 'none') trkSvg.style.display = 'none';
        return;
      }
      const stage = $('stage').getBoundingClientRect();
      const r = it.anno.getBoundingClientRect();
      trkSvg.style.left = Math.round(stage.left) + 'px';
      trkSvg.style.top = Math.round(stage.top) + 'px';
      trkSvg.setAttribute('width', Math.round(stage.width));
      trkSvg.setAttribute('height', Math.round(stage.height));
      /* The guides are worked out in the page's own viewport pixels, which is
         what trackFind answered in, so that what came back can be matched
         against them; only the drawing is moved to the stage. */
      const toVp = function (q) {
        const v = it.vp.convertToViewportPoint(q[0], q[1]);
        return [v[0], v[1]];
      };
      const dx = r.left - stage.left, dy = r.top - stage.top;
      const here = trackOn(it).map(function (a) { return toVp(a.p); });
      const start = opStart && opStart.it === it ? [toVp(opStart.p)] : null;
      const gs = TRK.guides(here, { start: start });
      const on = TRK.live(here, hit, { start: start });
      const W = Math.round(stage.width), H = Math.round(stage.height);
      gs.forEach(function (g, i) {
        const ln = trkEl('line', i);
        if (g.v) {
          const x = g.at + dx;
          ln.setAttribute('x1', x); ln.setAttribute('x2', x);
          ln.setAttribute('y1', 0); ln.setAttribute('y2', H);
        } else {
          const y = g.at + dy;
          ln.setAttribute('x1', 0); ln.setAttribute('x2', W);
          ln.setAttribute('y1', y); ln.setAttribute('y2', y);
        }
        ln.style.opacity = on[i] ? 1 : 0.35;
      });
      trkTrim('line', gs.length);
      /* a small plus on each acquired point: these are the ones tracked from */
      here.forEach(function (q, i) {
        const x = q[0] + dx, y = q[1] + dy;
        trkEl('path', i).setAttribute(
          'd', 'M' + (x - 4) + ' ' + y + 'h8M' + x + ' ' + (y - 4) + 'v8');
      });
      trkTrim('path', here.length);
      /* the line taken up for Parallel, and the guide that runs with it */
      const par = parRef && parRef.it === it && opStart && opStart.it === it ? parRef : null;
      if (par) {
        const pa = toVp(par.a), pb = toVp(par.b), s0 = toVp(opStart.p);
        parRefEl.setAttribute('x1', pa[0] + dx); parRefEl.setAttribute('y1', pa[1] + dy);
        parRefEl.setAttribute('x2', pb[0] + dx); parRefEl.setAttribute('y2', pb[1] + dy);
        parRefEl.style.display = '';
        const c = TRK.clipLine([s0[0] + dx, s0[1] + dy], [pb[0] - pa[0], pb[1] - pa[1]], W, H);
        if (c) {
          parGuideEl.setAttribute('x1', c[0][0]); parGuideEl.setAttribute('y1', c[0][1]);
          parGuideEl.setAttribute('x2', c[1][0]); parGuideEl.setAttribute('y2', c[1][1]);
          parGuideEl.style.opacity = hit && hit.kind === 'par' ? 1 : 0.35;
          parGuideEl.style.display = '';
        } else parGuideEl.style.display = 'none';
      } else {
        parRefEl.style.display = 'none';
        parGuideEl.style.display = 'none';
      }
      trkSvg.style.display = '';
    }
    /* the guides are drawn against the window, so anything that moves the page
       under them has to put them back */
    X.snapTrackRepaint = function () {
      if (acqs.length || opStart) trackPaint(null, null);
    };

    /* ---- smart guides while drawing ----
       As Illustrator's: with no point to catch, a point being placed lines
       up with the anchor points and centres of the marks already on the
       page — level with one, plumb with another, or both — and a rose line
       runs through each match. The same lines core.js draws while a mark is
       moved. Reach is in screen pixels, so it is the same at any zoom. */
    const ALIGN_PX = 6;
    /** Is mark idx left out of the snaps: the one mark, or one of the
        group, whose own grip is being dragged (opts.skip, one index or a list). */
    function skips(opts, idx) {
      if (!opts || opts.skip == null) return false;
      return Array.isArray(opts.skip) ? opts.skip.indexOf(idx) >= 0 : opts.skip === idx;
    }
    let alignOn = false;
    function alignHide() { if (alignOn) { alignOn = false; if (X.hideSmartGuide) X.hideSmartGuide(); } }
    function alignFind(it, p, opts) {
      if (!snap.kinds.mark) return null;
      const tol = ALIGN_PX / Math.max(0.05, S.scale);
      let bx = null, bxd = tol, by = null, byd = tol;
      it.shapes.forEach(function (s, idx) {
        if (skips(opts, idx)) return;
        markPoints(s).forEach(function (m) {
          const q = m[0];
          const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
          if (dx < bxd) { bxd = dx; bx = q[0]; }
          if (dy < byd) { byd = dy; by = q[1]; }
        });
      });
      /* the point the drawing began from lines up too */
      if (opStart && opStart.it === it && !(opts && opts.skip != null)) {
        const q = opStart.p;
        if (Math.abs(q[0] - p[0]) < bxd) { bxd = Math.abs(q[0] - p[0]); bx = q[0]; }
        if (Math.abs(q[1] - p[1]) < byd) { byd = Math.abs(q[1] - p[1]); by = q[1]; }
      }
      /* a side being pulled moves on one axis only: the other's guide would mean nothing */
      if (opts && opts.axis === 'x') by = null;
      if (opts && opts.axis === 'y') bx = null;
      if (bx === null && by === null) return null;
      return { p: [bx === null ? p[0] : bx, by === null ? p[1] : by], vx: bx, hy: by };
    }
    function alignShow(it, a) {
      if (!X.showSmartGuide) return;
      X.showSmartGuide(it, a.vx, a.hy, { x1: a.p[0], x2: a.p[0], y1: a.p[1], y2: a.p[1] });
      alignOn = true;
    }
    document.addEventListener('pointerup', function () { setTimeout(alignHide, 0); });

    /** The snap point for p on this page, showing the marker — or null. */
    /* Snap to Grid (js/rulers.js) is its own switch, as in Illustrator: it
       works with object snap off too, for the same tools and drags, and
       Ctrl still lets go of it for a moment */
    function gridOK(e, opts) {
      if (!X.grid || !X.grid.snapping() || (e && e.ctrlKey)) return false;
      return (opts && opts.skip != null) || !!SNAP_TOOLS[S.tool];
    }
    function gridHit(it, p, hit) {
      const tol = 7 / Math.max(0.05, S.scale);
      const g = X.grid.snap(it, p, tol);
      if (!g) return hit;
      const r = g.both ? SNAP_RANK.grid : SNAP_RANK.gline;
      const d = Math.hypot(g.p[0] - p[0], g.p[1] - p[1]);
      if (hit && (hit.r < r || (hit.r === r && hit.d <= d))) return hit;
      return { p: g.p, kind: g.both ? 'grid' : 'gline', label: g.both ? 'Grid' : 'Gridline', d: d, r: r };
    }
    /** The snap point for p on this page, showing the marker — or null.
        opts.move: p is the point of an object being moved (core.js): it
        lands on points, guides and the grid, not anywhere along a line,
        and lining up with other marks is the moved box's own smart guide. */
    X.snapPt = function (it, p, e, opts) {
      const move = !!(opts && opts.move);
      const objects = !!(it && it.vp && snapActive(e, opts));
      const onGrid = !!(it && it.vp && gridOK(e, opts));
      if (!objects && !onGrid) { snapHide(); trackClear(); alignHide(); return null; }
      if (!objects) {
        const g = gridHit(it, p, null);
        alignHide(); trackPaint(it, null);
        if (!g) { snapHide(); return null; }
        snapShow(it, g);
        return [g.p[0], g.p[1]];
      }
      if (!it._segs) pageSegments(it);                        /* the lines arrive shortly */
      let hit = snapFind(it, p, opts);
      if (move && hit && (hit.kind === 'near' || hit.kind === 'perp' || hit.kind === 'par')) hit = null;
      const tr = move ? null : trackFind(it, p, opts);
      /* an ordinary catch of the same rank or better wins: a real endpoint
         beats riding a guide past it */
      if (tr && (!hit || SNAP_RANK[tr.kind] < hit.r)) hit = tr;
      const pr = move ? null : parFind(it, p, opts);
      if (pr && (!hit || SNAP_RANK.par < hit.r)) hit = pr;
      if (onGrid) hit = gridHit(it, p, hit);
      if (!opts || opts.skip == null) { dwellWatch(it, hit); parWatch(it); }
      /* nothing better than somewhere along a line: line up with the marks instead */
      if (!move && (!hit || hit.kind === 'near')) {
        const al = alignFind(it, p, opts);
        if (al) {
          trackPaint(it, null);
          snapHide();
          alignShow(it, al);
          return al.p;
        }
      }
      alignHide();
      trackPaint(it, hit);
      if (!hit) { snapHide(); return null; }
      snapShow(it, hit);
      return [hit.p[0], hit.p[1]];
    };
    X.snapHide = snapHide;
    X.snapTrackClear = trackClear;
    /* core.js drives the built-in tools (rect, line, arrow, dimension), so it
       tells us when one begins and ends, and what it has drawn so far */
    X.snapOpStart = function (it, p) { trackStart(it, p); if (!p) readHide(); };
    X.snapReading = function (it, a, b) { readShow(it, a, b); };
    X.snapReadingHide = readHide;
    /** A module tool's point: snapped when there is something to catch. */
    function pdfAt(it, at, e) {
      const p = it.vp.convertToPdfPoint(at[0], at[1]);
      return X.snapPt(it, p, e) || p;
    }

    /* Hovering, before anything is pressed: show what the first click would catch. */
    document.addEventListener('pointermove', function (e) {
      if (e.buttons || !SNAP_TOOLS[S.tool]) return;
      const cap = e.target && e.target.closest ? e.target.closest('.capture') : null;
      if (!cap) { snapHide(); alignHide(); return; }
      const it = S.items.filter(function (x) { return x.capture === cap; })[0];
      if (!it || !it.vp) return;
      /* from the page's corner: the drawing surface reaches over the pasteboard */
      const r = it.wrap.getBoundingClientRect();
      const at = [e.clientX - r.left + (it.off ? it.off.left : 0), e.clientY - r.top + (it.off ? it.off.top : 0)];
      X.snapPt(it, it.vp.convertToPdfPoint(at[0], at[1]), e);
    }, { passive: true });
    $('stage').addEventListener('scroll', function () {
      snapHide();
      X.snapTrackRepaint();          /* the guides are placed against the window */
    }, { passive: true });
    window.addEventListener('resize', function () { snapHide(); X.snapTrackRepaint(); });
    X.on('tool', function (t) {
      snapHide();
      alignHide();
      trackClear();                  /* a point acquired for one tool is not the next one's */
      snapCtl.hidden = !SNAP_TOOLS[t];
      if (SNAP_TOOLS[t]) { const it = S.items[S.current - 1]; if (it) pageSegments(it); }
    });
    X.on('reset', trackClear);
    X.on('pages', trackClear);
    /* a tool that does not snap puts down whatever guides were up */
    X.on('tool', function (t) { if (!SNAP_TOOLS[t]) { opStart = null; trackClear(); } });

    /* ---- the switch, in the tool's properties ---- */
    const snapCtl = ctl('snapCtl',
      '<button class="snapbtn" id="snapOn" title="Object snap (F3) — catch ends, middles, crossings, edges, perpendicular and parallel, and ruler guides. Hold Ctrl to ignore it for a moment.">' +
      '<svg viewBox="0 0 18 18"><rect x="3.5" y="3.5" width="11" height="11"/></svg>Snap</button>' +
      '<button class="snapbtn more" id="snapMore" title="Which points to snap to" aria-label="Snap settings">▾</button>');
    const snapPop = document.createElement('div');
    snapPop.className = 'snappop'; snapPop.id = 'snapPop'; snapPop.hidden = true;
    snapPop.innerHTML = '<div class="snappop-h">Snap to</div>' + SNAP_KINDS.map(function (k) {
      return '<label><input type="checkbox" data-k="' + k[0] + '"><span>' + k[1] + '</span></label>';
    }).join('') + '<p class="snappop-note"><b>F3</b> turns snapping on and off · hold <b>Ctrl</b> to ignore it' +
      '<br>Rest on a point to track from it · <b>Esc</b> lets it go' +
      '<br>While drawing a line, rest on another line to run <b>parallel</b> to it</p>';
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
      if (!snap.on) { snapHide(); trackClear(); }
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
    /* Escape gives up the tracked point. The tools have their own Escape
       handlers for what they are drawing; this only drops the guides. */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (acqs.length || parRef)) trackClear();
    });

    /* ---------------- fillet ----------------
       AutoCAD's Fillet: pick two straight Line marks and the corner where
       they meet (or would meet, extended) is rounded to the set Radius,
       each line trimmed back to where the arc touches it. Unlike Angular
       above, this one has to edit what it picks, so it only ever looks at
       the app's own Line marks (it.shapes, t:'line') — never the page's own
       drawing, which nothing here ever rewrites (see the file's own note). */

    /** The app's own drawn Line nearest p, within a few screen pixels. */
    function lineShapeAt(it, p) {
      const tol = 7 / Math.max(0.05, S.scale);
      let idx = -1, bd = tol;
      it.shapes.forEach(function (s, i) {
        if (s.t !== 'line') return;
        const a = s.a, b = s.b, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        if (!l2) return;
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        if (d < bd) { bd = d; idx = i; }
      });
      return idx < 0 ? null : { idx: idx, s: it.shapes[idx] };
    }

    /** Where two (infinite) lines cross, or null if they run parallel —
        the same determinant Angular's armsFromLines uses. */
    function lineCross(s1, s2) {
      const p1 = s1.a, d1 = [s1.b[0] - p1[0], s1.b[1] - p1[1]];
      const p2 = s2.a, d2 = [s2.b[0] - p2[0], s2.b[1] - p2[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 0.01 * Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1])) return null;
      const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
      return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
    }

    /** Which of s's two ends is nearer the corner v (the one that gets
        trimmed) and the unit direction out of v toward the other (kept)
        end, with how far off that reaches — the line is too short for a
        wider fillet than that. */
    function armOut(s, v) {
      const da = Math.hypot(s.a[0] - v[0], s.a[1] - v[1]);
      const db = Math.hypot(s.b[0] - v[0], s.b[1] - v[1]);
      const near = da <= db ? 'a' : 'b', far = near === 'a' ? s.b : s.a;
      const len = Math.hypot(far[0] - v[0], far[1] - v[1]);
      if (len < 0.01) return null;                 /* a zero-length line */
      return { near: near, dir: [(far[0] - v[0]) / len, (far[1] - v[1]) / len], reach: len };
    }

    /** Fillets s1 and s2 of `it` at the given radius (PDF points): trims
        each to where a tangent arc of that radius would touch it, and adds
        the arc between. Returns why not, or null for success. */
    function tryFillet(it, i1, i2, radius) {
      const s1 = it.shapes[i1], s2 = it.shapes[i2];
      const v = lineCross(s1, s2);
      if (!v) return 'Those lines run parallel — they never meet in a corner';
      const A1 = armOut(s1, v), A2 = armOut(s2, v);
      if (!A1 || !A2) return 'One of those lines has no length';
      const dot = Math.max(-1, Math.min(1, A1.dir[0] * A2.dir[0] + A1.dir[1] * A2.dir[1]));
      const theta = Math.acos(dot);
      if (theta < 0.03 || theta > Math.PI - 0.03) {
        return 'Those lines do not make a corner to round';
      }
      const tanDist = radius / Math.tan(theta / 2);
      if (tanDist > A1.reach - 0.5 || tanDist > A2.reach - 0.5) {
        return 'That radius is too large for these lines — try a smaller one';
      }
      const t1 = [v[0] + A1.dir[0] * tanDist, v[1] + A1.dir[1] * tanDist];
      const t2 = [v[0] + A2.dir[0] * tanDist, v[1] + A2.dir[1] * tanDist];
      /* the arc is stored as two points and a bulge (see the file's own
         note); work the bulge back from the known radius and chord, same
         sagitta maths arcPts itself uses, then sign it so the arc bulges
         toward the corner it is rounding off rather than away from it */
      const chord = Math.hypot(t2[0] - t1[0], t2[1] - t1[1]);
      const sagitta = radius - Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
      const nx = -(t2[1] - t1[1]) / chord, ny = (t2[0] - t1[0]) / chord;
      const mid = [(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2];
      const sign = (nx * (v[0] - mid[0]) + ny * (v[1] - mid[1])) >= 0 ? 1 : -1;

      X.snapshot();
      s1[A1.near] = t1;
      s2[A2.near] = t2;
      it.shapes.push({ t: 'arc', a: t1, b: t2, bulge: sign * (sagitta / chord), c: S.color, w: S.width });
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      return null;
    }

    function filletReset() {
      if (!fpick) return;
      const it = fpick.it;
      fpick = null;
      X.drawShapes(it);
      $('modeHint').innerHTML = X.hints.fillet;
    }

    X.tools.fillet = {
      colors: true, widths: true,
      down: function () { /* a click tool: everything happens on release */ },
      move: function (it, at) {
        if (!it.vp) return;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!fpick || fpick.it !== it) {
          const h = lineShapeAt(it, p);
          X.drawShapes(it, h ? { t: 'dimguide', c: S.color, lines: [[h.s.a, h.s.b]] } : undefined);
          return;
        }
        const gh = { t: 'dimguide', c: S.color, solid: [[fpick.first.s.a, fpick.first.s.b]], lines: [] };
        const h = lineShapeAt(it, p);
        if (h && h.idx !== fpick.first.idx) gh.lines.push([h.s.a, h.s.b]);
        X.drawShapes(it, gh);
      },
      cancel: function () { filletReset(); },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const p = it.vp.convertToPdfPoint(at[0], at[1]);
        if (!fpick || fpick.it !== it) {
          const h = lineShapeAt(it, p);
          if (!h) { X.toast('Click right on a Line you drew — not another kind of mark'); return; }
          fpick = { it: it, first: h };
          $('modeHint').innerHTML = 'Click the <b>second line</b> to fillet against the first.';
          X.drawShapes(it, { t: 'dimguide', c: S.color, solid: [[h.s.a, h.s.b]] });
          return;
        }
        const h = lineShapeAt(it, p);
        if (!h) { X.toast('No drawn line there — click right on the second line'); return; }
        if (h.idx === fpick.first.idx) { X.toast('That is the same line — click a second, different one'); return; }
        const why = tryFillet(it, fpick.first.idx, h.idx, filletRadius);
        if (why) { X.toast(why); return; }             /* the first line stays picked; try another second one */
        fpick = null;
        $('modeHint').innerHTML = X.hints.fillet;
        X.toast('Filleted at <b>' + filletRadius + 'pt</b> radius');
      }
    };
    document.addEventListener('keydown', function (e) {
      if (!fpick || S.tool !== 'fillet' || e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      filletReset();
    }, true);

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
      X.ask('Reading to show on this dimension.\n' +
        'Leave it empty to go back to the measured value.',
        dimLabel(s), { title: 'Dimension text' }).then(function (v) {
        if (v === null || it.shapes[idx] !== s) return;
        X.snapshot();
        s.label = v.trim() === '' ? null : v.trim();
        X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      });
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
      dx = null;
      dxc = null;
      fpick = null;
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
