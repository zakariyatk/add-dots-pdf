/* Add Dots PDF — Point editing
   ---------------------------
   Lines, rectangles and Continuous Lines edited point by point, as with
   Illustrator's Direct Selection, Add Anchor Point and Delete Anchor Point:

   • double-click a line, rectangle or Continuous Line on its outline to add a
     point there; a line or rectangle becomes a Continuous Line to take it (a
     rectangle stays a closed, filled shape), keeping its colour, width, style
     and layer
   • click a point's grip to pick it out (it fills in), then drag it, nudge
     it with the arrow keys (Shift for ten at a time), or press Delete to
     take it out; Alt+click a point takes it out straight away
   • the same, from buttons on the mark's properties popover

   A Continuous Line is a list of points (s.pts); closed, its last point is
   its first one again. Everything here keeps that so: a closed shape has a
   grip on its first point twice over, and both stand for the one point. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[vertex] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const stage = $('stage');
    const PATHABLE = { line: 1, rect: 1, poly: 1 };

    /* ---------------- the model ---------------- */

    function closedPts(pts) {
      if (!pts || pts.length < 3) return false;
      const a = pts[0], b = pts[pts.length - 1];
      return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    }
    /** The mark's outline as points, in PDF points: a line's two ends, a
        rectangle's corners closed back on the first, or a Continuous Line's own. */
    function outline(s) {
      if (s.t === 'poly') return s.pts || [];
      if (s.t === 'line') return [s.a, s.b];
      if (s.t === 'rect') {
        const q = X.rectCorners(s);
        return [q[0], q[1], q[2], q[3], q[0]];
      }
      return [];
    }
    /** A line or rectangle as a Continuous Line with the same look, in place,
        so it keeps its place in the stack, its layer and its group. */
    function toPath(it, idx) {
      const s = it.shapes[idx];
      if (!s || s.t === 'poly') return s;
      const p = Object.assign({}, s);
      p.pts = outline(s).map(function (q) { return [q[0], q[1]]; });
      p.t = 'poly';
      delete p.a; delete p.b; delete p.r;
      it.shapes[idx] = p;
      return p;
    }

    /** The point on the outline nearest p, and the segment it lies on
        (between pts[k] and pts[k + 1]), or null when none is within tol. */
    function nearestOnOutline(pts, p, tol) {
      let best = null;
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= tol && (!best || d < best.d)) best = { k: k, t: t, p: q, d: d };
      }
      return best;
    }

    /* The undo snapshot (core.js) copies each mark but shares its pts list,
       so a list is never changed where it lies: each edit works on a copy. */
    function ownPts(s) { s.pts = s.pts.map(function (p) { return [p[0], p[1]]; }); return s.pts; }

    /** Put a new point on segment k at q; answers its index. */
    function insertPoint(s, k, q) {
      ownPts(s);
      s.pts.splice(k + 1, 0, [q[0], q[1]]);
      return k + 1;
    }

    /** Take point i out. A closed shape keeps at least three corners and an
        open line two ends; answers false when there is none to spare. */
    function removePoint(s, i) {
      const n = s.pts.length, closed = closedPts(s.pts);
      if (closed ? n - 1 <= 3 : n <= 2) return false;
      const pts = ownPts(s);
      if (closed && (i === 0 || i === n - 1)) {
        /* the shared first-and-last point: the next one becomes the start */
        pts.pop(); pts.shift();
        pts.push([pts[0][0], pts[0][1]]);
      } else {
        pts.splice(i, 1);
      }
      return true;
    }

    /* ---------------- the point picked out ---------------- */

    /* X.vsel = {it, idx, i}: core draws that grip filled in (handlesEl) */
    function vsel() {
      const v = X.vsel;
      if (!v || !S.sel || S.sel.it !== v.it || S.sel.i !== v.idx) return null;
      const s = v.it.shapes[v.idx];
      if (!s || s.t !== 'poly' || !s.pts || v.i >= s.pts.length) return null;
      if (X.selList().length > 1) return null;
      return { it: v.it, idx: v.idx, i: v.i, s: s };
    }
    function pick(it, idx, i) {
      X.vsel = i == null ? null : { it: it, idx: idx, i: i };
      X.drawShapes(it);
      paintPop();
    }
    function done(it) {
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
    }

    function deletePicked() {
      const v = vsel();
      if (!v) return false;
      X.snapshot();
      if (!removePoint(v.s, v.i)) {
        X.toast(closedPts(v.s.pts) ? 'A closed shape needs at least three points' : 'A line needs at least two points', true);
        return true;
      }
      X.vsel = null;
      done(v.it);
      return true;
    }
    function nudgePicked(dx, dy) {
      const v = vsel();
      if (!v) return false;
      X.snapshot();
      const pts = ownPts(v.s), n = pts.length, closed = closedPts(pts);
      const p = [pts[v.i][0] + dx, pts[v.i][1] + dy];
      pts[v.i] = p;
      if (closed && v.i === 0) pts[n - 1] = [p[0], p[1]];
      if (closed && v.i === n - 1) pts[0] = [p[0], p[1]];
      done(v.it);
      return true;
    }
    /** Add a point to the selected mark: in the middle of its longest side
        (the popover's button, where there is no pointer to say where). */
    function addToSelected() {
      if (!S.sel) return;
      const it = S.sel.it, idx = S.sel.i, s0 = it.shapes[idx];
      if (!s0 || !PATHABLE[s0.t]) return;
      const pts = outline(s0);
      let k = -1, len = -1;
      for (let j = 0; j + 1 < pts.length; j++) {
        const l = Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]);
        if (l > len) { len = l; k = j; }
      }
      if (k < 0) return;
      X.snapshot();
      const s = toPath(it, idx);
      const a = s.pts[k], b = s.pts[k + 1];
      const i = insertPoint(s, k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      X.vsel = { it: it, idx: idx, i: i };
      done(it);
    }

    /* ---------------- the pointer ---------------- */

    /* a press on a point's grip picks it out (the drag core starts goes on as
       before); with Alt held, it takes the point out instead */
    stage.addEventListener('pointerdown', function (e) {
      const kn = e.target.closest && e.target.closest('.kn[data-mode="pv"]');
      if (!kn || !S.sel) return;
      const it = S.sel.it, idx = S.sel.i, i = +kn.dataset.v;
      if (e.altKey) {
        e.preventDefault(); e.stopPropagation();
        X.vsel = { it: it, idx: idx, i: i };
        deletePicked();
        return;
      }
      X.vsel = { it: it, idx: idx, i: i };
      paintPop();
    }, true);

    /* anywhere else on the page lets the point go */
    stage.addEventListener('pointerdown', function (e) {
      if (!X.vsel) return;
      if (e.target.closest && e.target.closest('.kn')) return;
      X.vsel = null;
    });

    /** Where on the page the pointer is, in PDF points, and the page. */
    function pdfAt(e) {
      for (let n = 0; n < S.items.length; n++) {
        const it = S.items[n];
        if (!it.vp || !it.anno) continue;
        const r = it.anno.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
        const p = it.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
        return { it: it, p: [p[0], p[1]] };
      }
      return null;
    }

    /* A double-click on the outline of a line, rectangle or Continuous Line
       puts a point there — the selected mark first, else whichever is nearest.
       The browser fires no dblclick when the first click's redraw (it selects
       the mark) swaps the element under the pointer, so the second press is
       matched here by itself: close in time and place, as core.js does for
       text. Capture, so that press never also starts a drag. */
    let lastPress = null;
    stage.addEventListener('pointerdown', function (e) {
      if (S.tool !== 'select' || S.editing || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
        lastPress = null; return;
      }
      /* a corner or point grip is for dragging; a side's pill grip sits right
         where the outline is double-clicked, so that one still counts */
      if (e.target.closest && e.target.closest('.kn:not(.pill)')) { lastPress = null; return; }
      const now = Date.now();
      const again = lastPress && now - lastPress.t < 500 &&
        Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
      lastPress = again ? null : { t: now, x: e.clientX, y: e.clientY };
      if (again && addAt(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    function addAt(e) {
      const at = pdfAt(e);
      if (!at) return false;
      const it = at.it;
      const tol = 7 / Math.max(0.05, S.scale);
      let hit = null, idx = -1;
      const order = [];
      if (S.sel && S.sel.it === it) order.push(S.sel.i);
      for (let i = it.shapes.length - 1; i >= 0; i--) if (order.indexOf(i) < 0) order.push(i);
      for (let n = 0; n < order.length && !hit; n++) {
        const s = it.shapes[order[n]];
        if (!s || !PATHABLE[s.t] || s.hide || s.locked) continue;
        const h = nearestOnOutline(outline(s), at.p, tol);
        if (h) { hit = h; idx = order[n]; }
      }
      if (!hit) return false;
      /* not on top of a point already there */
      const pts0 = outline(it.shapes[idx]), a0 = pts0[hit.k], b0 = pts0[hit.k + 1];
      if (Math.hypot(a0[0] - hit.p[0], a0[1] - hit.p[1]) < tol ||
          Math.hypot(b0[0] - hit.p[0], b0[1] - hit.p[1]) < tol) return false;
      X.snapshot();
      const s = toPath(it, idx);
      const i = insertPoint(s, hit.k, hit.p);
      X.setGroup(it, [idx]);
      X.vsel = { it: it, idx: idx, i: i };
      done(it);
      return true;
    }

    /* ---------------- the keyboard ---------------- */

    /* ahead of core's own keys, which would delete or nudge the whole mark */
    window.addEventListener('keydown', function (e) {
      if (!X.vsel || S.editing || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!vsel()) { X.vsel = null; return; }
      let handled = false;
      if (e.key === 'Delete' || e.key === 'Backspace') handled = deletePicked();
      else if (e.key === 'Escape') { const it = X.vsel.it; pick(it, null, null); handled = true; }
      else if (/^Arrow/.test(e.key)) {
        /* a step of one point (ten with Shift) the way the arrow points on
           screen, whichever way the page is turned */
        const step = (e.shiftKey ? 10 : 1) * S.scale, vp = X.vsel.it.vp;
        const sx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const sy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const o = vp.convertToPdfPoint(0, 0), q = vp.convertToPdfPoint(sx, sy);
        handled = nudgePicked(q[0] - o[0], q[1] - o[1]);
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    /* ---------------- the properties popover ---------------- */

    const pop = document.createElement('div');
    pop.className = 'mpverts';
    pop.innerHTML =
      '<span class="mpverts-lbl">Points</span>' +
      '<button type="button" class="cbtn" id="vxAdd" title="Add a point (or double-click the outline where you want one)">Add point</button>' +
      '<button type="button" class="cbtn" id="vxDel" title="Delete the point picked out (Delete key, or Alt+click a point)">Delete point</button>' +
      '<p class="mpverts-tip" id="vxTip"></p>';
    pop.addEventListener('click', function (e) {
      if (e.target.id === 'vxAdd') addToSelected();
      else if (e.target.id === 'vxDel') deletePicked();
    });
    function paintPop() {
      const tip = $('vxTip');
      if (!tip) return;
      const v = vsel();
      $('vxDel').disabled = !v;
      tip.textContent = v
        ? 'Drag the point, nudge it with the arrow keys, or press Delete.'
        : 'Double-click the outline to add a point; click a point to pick it.';
    }
    ['line', 'rect', 'poly'].forEach(function (t) {
      /* a type another module already fills keeps its own */
      if (X.markPop[t]) return;
      X.markPop[t] = { el: pop, sync: paintPop };
    });

    X.on('reset', function () { X.vsel = null; });
    X.on('tool', function () { X.vsel = null; });
  });
})();
