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
        hint: 'Click the first point you want measured, then the second (or drag straight between ' +
              'them) — then move to set how far clear of them the dimension line itself sits, and ' +
              'click, or drag and let go, to place it. Set the drawing <b>Scale</b> to match the ' +
              'sheet, or <b>Calibrate</b> against something you already know. Hold <b>Shift</b> to ' +
              'measure level, plumb or at 45°. Double-click a dimension to retype it.',
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
              '<path d="M12 20A9 9 0 0 0 8.1 12.6"/>' },
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
      dimCtl.hidden = !/^dim[crda]?$/.test(t);
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

    X.shapeRenderers.ellipse = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      const el = polyline(ellipsePts(s, 72), vp, true);
      stroked(el, s, idx, it);
      fillIn(el, s);
      g.appendChild(el);
      return g;
    };

    /* a closed shape's fill, and its inside answering a click wherever it is
       filled or has no outline to click on (with neither, it would otherwise
       be impossible to pick out again) */
    function fillIn(el, s) {
      if (s.fill) {
        el.style.fill = s.fill;
        el.style.fillOpacity = X.shOp(s);
      }
      if (s.fill || s.nos) el.style.pointerEvents = 'all';
    }

    X.shapeRenderers.cloud = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      /* closed, so it can be filled like a box */
      const el = stroked(polyline(cloudPts(s, 6), vp, true), s, idx, it);
      fillIn(el, s);
      g.appendChild(el);
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
      if (polyClosed(s)) fillIn(el, s);
      else el.style.stroke = s.c;               /* an open line always shows its line */
      g.appendChild(el);
      return g;
    };

    /* a Pen path (js/pen.js): cubic Bézier segments, s.pts running anchor,
       out-handle, in-handle, anchor… — the same path the saved PDF draws
       (engine painters/pen.ts) */
    function penClosed(s) { return !!(s.pts && E.penClosed(s.pts)); }
    X.penClosed = penClosed;
    function penD(pts, vp) {
      const v = pts.map(function (p) { return vp.convertToViewportPoint(p[0], p[1]); });
      let d = 'M' + v[0][0] + ' ' + v[0][1];
      for (let i = 1; i + 2 < v.length; i += 3) {
        d += 'C' + v[i][0] + ' ' + v[i][1] + ' ' + v[i + 1][0] + ' ' + v[i + 1][1] + ' ' + v[i + 2][0] + ' ' + v[i + 2][1];
      }
      return E.penClosed(pts) ? d + 'Z' : d;
    }
    X.penD = penD;
    X.shapeRenderers.pen = function (it, s, vp, idx) {
      const g = document.createElementNS(SVGNS, 'g');
      if (!s.pts || s.pts.length < 4) return g;
      const el = document.createElementNS(SVGNS, 'path');
      el.setAttribute('d', penD(s.pts, vp));
      stroked(el, s, idx, it);
      if (penClosed(s)) fillIn(el, s);
      else el.style.stroke = s.c;               /* an open path always shows its line */
      g.appendChild(el);
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
    let dimPend = null;          /* {it, a} — a dimension's first point, placed by a click rather
                                     than a drag, waiting for the second click to finish it */

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

    X.tools.ellipse = common('ellipse');
    X.tools.cloud = common('cloud');
    X.tools.arc = common('arc');

    /* --- the Dimension tool, placed the way a CAD linear dimension is: pick
       the first point, the second (either a drag straight between them, or a
       click and then another), then move clear of that line and click — or
       drag and release — to say how far off it the dimension line itself
       sits; a short extension line then runs from each real point out to it
       (s.off, dimGeom in painters/draw.ts). Leaving the offset at zero keeps
       today's quick, on-the-line dimension, which is still there for a fast
       single drag that overshoots nothing. */
    let dimOff = null;          /* {it, a, b, base} — the two points are set; now
                                    choosing how far off them the line sits */

    /** The signed distance from line a-b to m, in the direction s.off moves. */
    function offAt(a, b, m) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      return ((m[0] - a[0]) * -dy + (m[1] - a[1]) * dx) / len;
    }

    function dimTool() {
      return {
        colors: true, widths: true,
        down: function (it, at, e) {
          if (!it.vp || (dimOff && dimOff.it === it)) return;
          const pinned = dimPend && dimPend.it === it;
          drag = { it: it, a: pinned ? dimPend.a : pdfAt(it, at, e) };
          dimPend = null;
        },
        move: function (it, at, e) {
          if (dimOff && dimOff.it === it) {
            const raw = it.vp.convertToPdfPoint(at[0], at[1]);
            X.drawShapes(it, Object.assign({}, dimOff.base, { off: offAt(dimOff.a, dimOff.b, raw) }));
            return;
          }
          if (dimPend && dimPend.it === it && (!drag || drag.it !== it)) {
            const raw = it.vp.convertToPdfPoint(at[0], at[1]);
            const sn = X.snapPt(it, raw, e);
            X.drawShapes(it, ghost('dim', dimPend.a, sn || raw, sn ? null : e));
            return;
          }
          if (!drag || drag.it !== it) return;
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const sn = X.snapPt(it, raw, e);
          drag.snap = sn;
          X.drawShapes(it, ghost('dim', drag.a, sn || raw, sn ? { altKey: e && e.altKey } : e));
        },
        cancel: function (it) {
          if (dimOff && dimOff.it === it) { dimOff = null; X.drawShapes(it); }
          if (drag) { drag = null; X.drawShapes(it); }
          trackClear();
        },
        up: function (it, at, e) {
          if (dimOff && dimOff.it === it) {
            const raw = it.vp.convertToPdfPoint(at[0], at[1]);
            const g = Object.assign({}, dimOff.base, { off: offAt(dimOff.a, dimOff.b, raw) });
            dimOff = null;
            snapHide();
            trackClear();         /* this dimension is done; a tracked point is not the next one's */
            $('modeHint').innerHTML = X.hints.dim;
            X.snapshot();
            it.shapes.push(g);
            X.drawShapes(it); X.drawThumb(it); X.updateMeta();
            X.toast('<b>' + measure(g) + '</b>');
            return;
          }
          if (!drag || drag.it !== it) return;
          const a = drag.a, raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const sn = X.snapPt(it, raw, e);
          drag = null;
          const g = ghost('dim', a, sn || raw, sn ? { altKey: e && e.altKey } : e);
          if (Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 3) {
            /* that was a click, not a drag: hold this point and wait for the next one */
            dimPend = { it: it, a: a };
            $('modeHint').innerHTML = 'Click the <b>second point</b> — then set how far the ' +
              'dimension line sits off it. <b>Esc</b> cancels.';
            X.drawShapes(it);
            return;
          }
          snapHide();
          if (calibrating) {
            trackClear();
            $('modeHint').innerHTML = X.hints.dim;
            X.drawShapes(it); finishCalibration(g); return;
          }
          /* both points are down — now how far clear of them does the
             dimension line itself sit? Move and click, or drag and let go. */
          dimOff = { it: it, a: g.a, b: g.b, base: g };
          $('modeHint').innerHTML = 'Move to set how far the dimension line sits off the ' +
            'line you measured, then click (or let go). <b>Esc</b> cancels.';
          X.drawShapes(it, g);
        }
      };
    }
    X.tools.dim = dimTool();
    document.addEventListener('keydown', function (e) {
      if (S.tool !== 'dim' || e.key !== 'Escape' || (!dimPend && !dimOff)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const it = (dimOff || dimPend).it;
      dimPend = null; dimOff = null;
      X.drawShapes(it);
      $('modeHint').innerHTML = X.hints.dim;
    }, true);
    X.on('tool', function (t) {
      if (t === 'dim') return;
      const pend = dimOff || dimPend;
      if (pend) { dimPend = null; dimOff = null; X.drawShapes(pend.it); }
    });

    /* --- continuous dimensions ---
       Click, click, click: each click closes one dimension and opens the next
       from the same point. After the first, each point is brought onto that
       first dimension's line, so the chain reads as one run: 30 · 20 · 20.
       The first segment asks, once, how far clear of the run its dimension
       line sits — same as the plain Dimension tool — and every segment after
       that reuses that same offset, the way a CAD continued dimension stays
       on the one line rather than asking again each time. */
    let chain = null;                              /* {it, last:[x,y], dir:[ux,uy]|null, n, off:number|null} */
    let chainPend = null;                          /* {it, a, b} — a segment is measured; now choosing its offset */

    function chainEnd(p, e) {
      const L = chain.last;
      if (chain.dir) {
        const d = (p[0] - L[0]) * chain.dir[0] + (p[1] - L[1]) * chain.dir[1];
        return [L[0] + chain.dir[0] * d, L[1] + chain.dir[1] * d];
      }
      return e && e.shiftKey ? X.snapLine(L, p) : [p[0], p[1]];
    }
    function endChain() {
      chainPend = null;
      if (!chain) return;
      const it = chain.it, n = chain.n;
      chain = null;
      trackClear();            /* the chain is done; a tracked point is not the next one's */
      X.drawShapes(it);
      if (S.tool === 'dimc') $('modeHint').innerHTML = X.hints.dimc;
      if (n) X.toast(n + ' dimension' + (n > 1 ? 's' : '') + ' in the chain');
    }
    function commitChainSegment(a, b, off) {
      const it = chain.it;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      X.snapshot();
      it.shapes.push(Object.assign(ghost('dim', a, b, null), { off: off }));
      if (!chain.dir) chain.dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      if (chain.off == null) chain.off = off;
      chain.last = b; chain.n++;
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      $('modeHint').innerHTML = 'Click the next point. <b>Enter</b> or <b>Esc</b> ends the chain.';
    }

    X.tools.dimc = {
      colors: true, widths: true,
      down: function () { /* a click tool: everything happens on release */ },
      move: function (it, at, e) {
        if (chainPend && chainPend.it === it) {
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          X.drawShapes(it, Object.assign({}, ghost('dim', chainPend.a, chainPend.b, null),
            { off: offAt(chainPend.a, chainPend.b, raw) }));
          return;
        }
        if (!chain || chain.it !== it || !it.vp) return;
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const sn = X.snapPt(it, raw, e);
        /* a snapped point is still carried onto the chain's line, the way a
           CAD continued dimension measures to the feature it was snapped to */
        const b = chainEnd(sn || raw, sn ? null : e);
        X.drawShapes(it, Object.assign({}, ghost('dim', chain.last, b, null), { off: chain.off || 0 }));
      },
      cancel: function () {
        if (chainPend) { chainPend = null; if (chain) X.drawShapes(chain.it); return; }
        endChain();
      },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        if (chainPend && chainPend.it === it) {
          const raw = it.vp.convertToPdfPoint(at[0], at[1]);
          const off = offAt(chainPend.a, chainPend.b, raw);
          const a = chainPend.a, b = chainPend.b;
          chainPend = null;
          commitChainSegment(a, b, off);
          return;
        }
        const raw = it.vp.convertToPdfPoint(at[0], at[1]);
        const sn = X.snapPt(it, raw, e);
        const p = sn || raw;
        if (sn) e = null;                          /* the snap wins over Shift */
        if (!chain || chain.it !== it) {           /* first point, or a jump to another page */
          endChain();
          chain = { it: it, last: p, dir: null, n: 0, off: null };
          $('modeHint').innerHTML = 'Click the next point. <b>Enter</b> or <b>Esc</b> ends the chain.';
          return;
        }
        const L = chain.last, b = chainEnd(p, e);
        const len = Math.hypot(b[0] - L[0], b[1] - L[1]);
        if (len < 3) return;                       /* the second click of a double-click */
        if (chain.off == null) {
          /* the first segment: how far clear of it does the chain's line sit? */
          chainPend = { it: it, a: L, b: b };
          $('modeHint').innerHTML = 'Move to set how far the dimension line sits off the line ' +
            'you measured, then click (or let go).';
          X.drawShapes(it, ghost('dim', L, b, null));
          return;
        }
        commitChainSegment(L, b, chain.off);
      }
    };

    /* Esc and Enter end the chain but keep the tool, so the next click starts
       a fresh run; a second Esc puts the tool down as usual. While a segment
       is still choosing its offset, the first Esc only drops that segment
       and keeps the chain going from its last committed point. Capture
       phase, to get there before core's own Esc handling. */
    document.addEventListener('keydown', function (e) {
      if (!chain || S.tool !== 'dimc') return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (chainPend) {
          chainPend = null;
          X.drawShapes(chain.it);
          $('modeHint').innerHTML = 'Click the next point. <b>Enter</b> or <b>Esc</b> ends the chain.';
          return;
        }
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

    const RADIAL = { dimr: 1, dimd: 1, dima: 1 };
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
    let pick = null;                               /* {t, it, pts} */
    let fpick = null;                              /* {it, first: {idx, s}} — fillet's own two-line pick */
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
                         dim: 1, dimc: 1, dimr: 1, dimd: 1, dima: 1, poly: 1 };
    const SNAP_KINDS = [['end', 'Endpoint'], ['mid', 'Midpoint'], ['int', 'Intersection'],
                        ['near', 'Nearest'], ['perp', 'Perpendicular'], ['par', 'Parallel'],
                        ['mark', 'Points of your marks'], ['guide', 'Guides']];
    /* Perpendicular and Parallel are about the direction of the line in hand,
       so they only work for tools that draw one from a start point */
    const DIR_TOOLS = { line: 1, arrow: 1, dim: 1, poly: 1 };
    /* A crossing of two real lines is as much a point as an end is, so it
       ranks with them and the nearer of the two wins; the crossings tracking
       and the rulers invent rank below that, and lying along something below
       that again. */
    const SNAP_RANK = { end: 0, mark: 0, cen: 0, int: 0, gint: 1, tcross: 1, tseg: 1, txg: 1,
                        perp: 1, mid: 2, guide: 2, ton: 2, par: 2, near: 3 };
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
      } else if (t === 'poly' && s.pts && s.pts.length) {
        /* every point of a Continuous Line, its ends and its corners */
        s.pts.forEach(function (q) { out.push([q, 'Mark end']); });
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
      if (s.b && (t === 'rect' || t === 'cloud' || t === 'redact') && !s.r) {
        const a = s.a, b = s.b, c = [s.a[0], s.b[1]], d = [s.b[0], s.a[1]];
        return [[a, d], [d, b], [b, c], [c, a]];
      }
      if (t === 'poly' && s.pts && s.pts.length > 1) {
        const out = [];
        for (let i = 1; i < s.pts.length && out.length < 24; i++) out.push([s.pts[i - 1], s.pts[i]]);
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
        if (!best || r < best.r || (r === best.r && d < best.d)) {
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
          if (opts && opts.skip === idx) return;
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
      /* Angular picks whole lines until it has both; only its last click snaps */
      if (S.tool === 'dima' && (!pick || (pick.mode === 'lines' && !pick.arm))) return false;
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

    /** The snap point for p on this page, showing the marker — or null. */
    X.snapPt = function (it, p, e, opts) {
      if (!it || !it.vp || !snapActive(e, opts)) { snapHide(); trackClear(); return null; }
      if (!it._segs) pageSegments(it);                        /* the lines arrive shortly */
      let hit = snapFind(it, p, opts);
      const tr = trackFind(it, p, opts);
      /* an ordinary catch of the same rank or better wins: a real endpoint
         beats riding a guide past it */
      if (tr && (!hit || SNAP_RANK[tr.kind] < hit.r)) hit = tr;
      const pr = parFind(it, p, opts);
      if (pr && (!hit || SNAP_RANK.par < hit.r)) hit = pr;
      if (!opts || opts.skip == null) { dwellWatch(it, hit); parWatch(it); }
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
      if (!cap) { snapHide(); return; }
      const it = S.items.filter(function (x) { return x.capture === cap; })[0];
      if (!it || !it.vp) return;
      const r = cap.getBoundingClientRect();
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
      trackClear();                  /* a point acquired for one tool is not the next one's */
      snapCtl.hidden = !SNAP_TOOLS[t];
      if (SNAP_TOOLS[t]) { const it = S.items[S.current - 1]; if (it) pageSegments(it); }
    });
    X.on('reset', trackClear);
    X.on('pages', trackClear);

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
      trackClear();             /* this reading is done; a tracked point is not the next one's */
      if (RADIAL[S.tool]) $('modeHint').innerHTML = X.hints[S.tool];
    }
    function pickedShape(cur) {
      const t = pick.t;
      const base = { t: t, c: S.color, w: S.width };
      applyLook(base);
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
      trackClear();              /* this reading is done; a tracked point is not the next one's */
      $('modeHint').innerHTML = X.hints[t];
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      X.toast('<b>' + X.esc(dimLabel(g)) + '</b>');
    }

    function pickTool(t) {
      return {
        colors: true, widths: true,
        down: function () { /* a click tool: everything happens on release */ },
        move: function (it, at, e) {
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
      chain = null;
      chainPend = null;
      pick = null;
      fpick = null;
      dimPend = null;
      dimOff = null;
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
