/* Add Dots PDF — Rotate tool
   ------------------------
   Illustrator's Rotate tool (R), for what is selected:

   • picked up, a pivot point (a small cyan crosshair) shows at the centre of
     the selection
   • drag anywhere and the selection turns about the pivot; Shift keeps the
     turn to steps of 45°
   • drag the pivot itself to move it, or click once anywhere to put it there
   • Esc, V or another tool puts the Rotate tool down

   It works on the Select tool's own selection, so a selection made before
   picking it up stays selected, and with nothing selected a click still
   selects as Select does. R with marks selected picks it up; with nothing
   selected, R still turns the page as it always has.

   Each mark turns the way it is built: a line's ends, a path's points and a
   Continuous Line's points are turned about the pivot; a box, circle,
   picture or text is carried round the pivot and its own angle (s.r) grows
   by the same amount, so the saved PDF (which reads s.r) draws it turned.
   A mark that never turns (a note, a stamp, a highlight) is carried round
   upright. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[rotate] core bridge missing'); return; }
  const E = window.ADDPDFEngine;

  /* marks with no turn of their own: carried round the pivot, upright */
  const UPRIGHT = { note: 1, stamp: 1, markup: 1, pin: 1 };
  const SNAP = 45;
  const HIT = 9;                              /* px round the pivot that grab it */

  X.on('ready', function () {
    const S = X.S, $ = X.$, SVGNS = X.SVGNS;
    const stage = $('stage');

    let on = false;
    let pivot = null;                         /* PDF point, or null for the centre */
    let pivotKey = '';                        /* which selection the pivot belongs to */
    let drag = null;

    /* ---------------- the selection ---------------- */

    function selection() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it || !S.sel.it.vp) return null;
      const it = S.sel.it;
      const idx = X.selList().filter(function (i) {
        const s = it.shapes[i];
        return s && !X.NOT_SELECTABLE[s.t] && s.t !== 'pin' && !s.locked;
      });
      return idx.length ? { it: it, idx: idx } : null;
    }
    function keyOf(sel) { return sel ? sel.idx.slice().sort(function (a, b) { return a - b; }).join(',') + '@' + S.items.indexOf(sel.it) : ''; }
    function centreOf(sel) {
      const u = X.unionBox(sel.idx.map(function (i) { return X.visBox(sel.it.shapes[i]); }));
      return [(u.x1 + u.x2) / 2, (u.y1 + u.y2) / 2];
    }
    /* the pivot for this selection: where it was put, else the centre */
    function pivotFor(sel) {
      const k = keyOf(sel);
      if (k !== pivotKey) { pivotKey = k; pivot = null; }
      return pivot || centreOf(sel);
    }

    /* ---------------- turning a mark ---------------- */

    function rot(p, c, deg) { return E.rotPt(p, c, deg); }
    /** Mark s, from its state o before the drag, turned by deg about c. */
    /* a mark of points keeps the angle it was turned to (s.fr), so its box
       and grips stay turned with it afterwards (core.js frameCorners) */
    function frame(s, o, deg) {
      const fr = ((((o.fr || 0) + deg) % 360) + 360) % 360;
      if (fr < 1e-6 || fr > 360 - 1e-6) delete s.fr; else s.fr = Math.round(fr * 1e6) / 1e6;
    }
    function turnMark(s, o, c, deg) {
      if (o.pts && !o.a) {                                   /* a path, ink, Continuous Line */
        s.pts = o.pts.map(function (p) { return rot(p, c, deg); });
        if (!o.quads) frame(s, o, deg);
        return;
      }
      if (o.quads || UPRIGHT[o.t]) {                         /* carried round, upright */
        const b = X.markBox(o), m = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2], m2 = rot(m, c, deg);
        X.moveShape(s, o, m2[0] - m[0], m2[1] - m[1]);
        return;
      }
      const kind = X.handleKind[o.t] || o.t;
      if (X.turnsByEnds(o.t) || kind === 'ends' || kind === 'line' || kind === 'arrow' || o.m) {
        /* defined by its points (a line, an arrow, a dimension): turn them */
        if (o.a) s.a = rot(o.a, c, deg);
        if (Array.isArray(o.b)) s.b = rot(o.b, c, deg);
        if (o.m) s.m = rot(o.m, c, deg);
        frame(s, o, deg);
        return;
      }
      /* a box, a circle, a picture, text: round the pivot, and its own angle on */
      const own = o.t === 'text' ? [o.a[0], o.a[1]]
        : Array.isArray(o.b) ? [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2] : [o.a[0], o.a[1]];
      const to = rot(own, c, deg);
      X.moveShape(s, o, to[0] - own[0], to[1] - own[1]);
      if (o.m) s.m = rot(o.m, c, deg);
      const r = (((o.r || 0) + deg) % 360 + 360) % 360;
      if (Math.abs(r) < 1e-9 || Math.abs(r - 360) < 1e-9) delete s.r; else s.r = Math.round(r * 1e6) / 1e6;
    }

    /* ---------------- on the page ---------------- */

    function pdfAt(it, e) {
      const r = it.anno.getBoundingClientRect();
      return it.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    }
    function paint(it) {
      if (!on || !it.anno) return;
      const sel = selection();
      if (!sel || sel.it !== it) return;
      const c = pivotFor(sel), v = it.vp.convertToViewportPoint(c[0], c[1]);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'rpivot');
      const x = v[0], y = v[1];
      g.innerHTML =
        '<circle cx="' + x + '" cy="' + y + '" r="4"/>' +
        '<circle class="dot" cx="' + x + '" cy="' + y + '" r="1.2"/>' +
        '<path d="M' + (x - 9) + ' ' + y + 'H' + (x - 4) + 'M' + (x + 4) + ' ' + y + 'H' + (x + 9) +
        'M' + x + ' ' + (y - 9) + 'V' + (y - 4) + 'M' + x + ' ' + (y + 4) + 'V' + (y + 9) + '"/>';
      it.anno.appendChild(g);
    }
    X.afterDraw.push(paint);

    let hud = null;
    function showHud(e, deg) {
      if (!hud) { hud = document.createElement('div'); hud.className = 'movehud'; document.body.appendChild(hud); }
      let d = Math.round(deg * 10) / 10;
      if (d > 180) d -= 360;
      if (d <= -180) d += 360;
      hud.textContent = 'Angle: ' + d + '°';
      hud.style.left = (e.clientX + 16) + 'px';
      hud.style.top = (e.clientY + 16) + 'px';
      hud.hidden = false;
    }
    function hideHud() { if (hud) hud.hidden = true; }

    stage.addEventListener('pointerdown', function (e) {
      if (!on || e.button !== 0 || e.ctrlKey || e.metaKey || S.editing) return;
      const sel = selection();
      if (!sel) return;                       /* nothing to turn: a click selects, as Select does */
      const t = e.target;
      if (t.closest && t.closest('input, textarea, select, button, a, .markpop')) return;
      const it = sel.it, c = pivotFor(sel), p = pdfAt(it, e);
      const vc = it.vp.convertToViewportPoint(c[0], c[1]), r = it.anno.getBoundingClientRect();
      const onPivot = Math.hypot(e.clientX - r.left - vc[0], e.clientY - r.top - vc[1]) <= HIT;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      drag = {
        it: it, idx: sel.idx, c: c, from: p, x: e.clientX, y: e.clientY, id: e.pointerId,
        pivot: onPivot, moved: false,
        a0: Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI,
        s0: sel.idx.map(function (i) { return X.copyShape(it.shapes[i]); })
      };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a mouse works without it */ }
    }, true);

    /* The turn pointer curls the way a turn about the pivot goes from where
       the pointer is, as Illustrator's does: one of four, by which quarter
       round the pivot (on screen) it is in. Over the pivot itself it is the
       pointer that moves it. */
    function aim(e) {
      if (!on) return;
      const sel = selection();
      let q = '';
      if (sel && sel.it.anno) {
        const c = pivotFor(sel), v = sel.it.vp.convertToViewportPoint(c[0], c[1]);
        const r = sel.it.anno.getBoundingClientRect();
        const dx = e.clientX - r.left - v[0], dy = e.clientY - r.top - v[1];
        q = Math.hypot(dx, dy) <= HIT ? 'pivot' : (dy < 0 ? 't' : 'b') + (dx < 0 ? 'l' : 'r');
      }
      if (document.body.dataset.rotq !== q) document.body.dataset.rotq = q;
    }
    document.addEventListener('pointermove', aim);

    document.addEventListener('pointermove', function (e) {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;   /* a click, so far */
      const p = pdfAt(d.it, e);
      if (d.pivot) {
        d.moved = true;
        pivot = p; pivotKey = keyOf({ it: d.it, idx: d.idx });
        X.drawShapes(d.it);
        return;
      }
      /* too near the pivot for an angle to mean anything */
      if (Math.hypot(p[0] - d.c[0], p[1] - d.c[1]) * S.scale < 4) return;
      if (!d.moved) { d.moved = true; X.snapshot(); }
      let deg = Math.atan2(p[1] - d.c[1], p[0] - d.c[0]) * 180 / Math.PI - d.a0;
      if (e.shiftKey) deg = Math.round(deg / SNAP) * SNAP;
      d.idx.forEach(function (i, k) {
        const s = d.it.shapes[i];
        if (s) turnMark(s, d.s0[k], d.c, deg);
      });
      /* the page's own points run y up, so a positive turn reads
         anticlockwise on screen, as Illustrator counts it */
      showHud(e, deg);
      X.drawShapes(d.it);
    });
    function end(e, cancel) {
      const d = drag;
      if (!d || (e && e.pointerId !== d.id)) return;
      drag = null;
      hideHud();
      if (cancel && d.moved && !d.pivot) {
        d.idx.forEach(function (i, k) { d.it.shapes[i] = d.s0[k]; });
      } else if (!d.moved && !d.pivot) {
        /* a click, not a drag: the pivot goes where it was clicked */
        pivot = d.from; pivotKey = keyOf({ it: d.it, idx: d.idx });
      }
      X.drawShapes(d.it);
      if (d.moved && !d.pivot) { X.drawThumb(d.it); X.updateMeta(); }
      X.syncMarkPop();
    }
    document.addEventListener('pointerup', function (e) { end(e, false); });
    document.addEventListener('pointercancel', function (e) { end(e, true); });

    /* ---------------- picking it up and putting it down ---------------- */

    const ICON = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/>' +
      '<circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';
    const btn = document.createElement('button');
    btn.className = 'btn'; btn.id = 'tRotate'; btn.type = 'button';
    btn.title = 'Rotate (R)'; btn.setAttribute('aria-label', 'Rotate');
    btn.dataset.label = 'Rotate';
    btn.innerHTML = ICON;
    if ($('grpTools')) $('grpTools').appendChild(btn);

    function paintBtns() {
      document.querySelectorAll('#tRotate, #qtRotate').forEach(function (b) {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      /* Select's own buttons stay dark while Rotate is the one in hand */
      document.body.classList.toggle('rotate-mode', on);
    }
    function setOn(v) {
      if (v === on) return;
      if (v) {
        /* keep what is selected across the change to Select (setTool drops it) */
        const keep = S.sel ? { sel: S.sel, multi: S.multi } : null;
        if (S.tool !== 'select') X.setTool('select');
        if (keep && !S.sel) { S.sel = keep.sel; S.multi = keep.multi; }
        on = true;
        pivot = null; pivotKey = '';
        if (!selection()) X.toast('Select one or more objects to rotate, then drag to turn them');
      } else {
        on = false;
        drag = null; hideHud();
        delete document.body.dataset.rotq;
      }
      paintBtns();
      X.redrawAll();
      X.syncMarkPop();
    }
    X.rotateTool = { on: function () { return on; }, set: setOn };
    /* core turns a whole selection by its corners with this too */
    X.turnMark = turnMark;
    btn.addEventListener('click', function () { setOn(!on); });

    /* any other tool puts it down */
    X.on('tool', function () { if (on) setOn(false); });

    /* R picks it up with marks selected (with none, core's R still turns the
       page); Esc or V puts it down. Ahead of core's own keys. */
    window.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select,[contenteditable],[contenteditable] *')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !S.items.length || S.editing) return;
      if ((e.key === 'r' || e.key === 'R') && !e.shiftKey && selection()) {
        e.preventDefault(); e.stopImmediatePropagation();
        setOn(!on);
      } else if (on && (e.key === 'Escape' || e.key === 'v')) {
        e.preventDefault(); e.stopImmediatePropagation();
        setOn(false);
      }
    }, true);

    paintBtns();
  });
})();
