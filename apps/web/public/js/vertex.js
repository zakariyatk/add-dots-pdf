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

    /* With Direct Selection, a double-click on the outline of a line,
       rectangle or Continuous Line puts a point there — the selected mark first, else whichever is nearest.
       The browser fires no dblclick when the first click's redraw (it selects
       the mark) swaps the element under the pointer, so the second press is
       matched here by itself: close in time and place, as core.js does for
       text. Capture, so that press never also starts a drag. */
    let lastPress = null;
    stage.addEventListener('pointerdown', function (e) {
      /* points are Direct Selection's: with Select a double-click works on
         the object as a whole (text opens for typing), not on its points */
      if (S.tool !== 'vdirect' || S.editing || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
        lastPress = null; return;
      }
      const now = Date.now();
      const again = lastPress && now - lastPress.t < 500 &&
        Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
      lastPress = again ? null : { t: now, x: e.clientX, y: e.clientY };
      if (!again) return;
      /* on a point (its grip, or the point of any line, rectangle,
         Continuous Line or Pen path): Bézier editing of it (js/pen.js);
         elsewhere on the outline: a point added there */
      const at = pdfAt(e);
      if ((at && curveUnder(at.it, at.p)) || (!(e.target.closest && e.target.closest('.kn:not(.pill)')) && addAt(e))) {
        e.preventDefault(); e.stopImmediatePropagation();
      }
    }, true);

    /** the point of a line, rectangle, Continuous Line or Pen path at p, made
        a smooth curve point (or a Pen path's smooth one a corner) */
    function curveUnder(it, p) {
      if (!X.penEdit || !X.penEdit.curveAt) return false;
      const reach = 8 / Math.max(0.05, S.scale);
      const order = [];
      if (S.sel && S.sel.it === it) order.push(S.sel.i);
      for (let i = it.shapes.length - 1; i >= 0; i--) if (order.indexOf(i) < 0) order.push(i);
      for (let n = 0; n < order.length; n++) {
        const s = it.shapes[order[n]];
        if (!s || s.hide || s.locked || !(PATHABLE[s.t] || s.t === 'pen')) continue;
        const pts = s.t === 'pen' ? s.pts.filter(function (_, i) { return i % 3 === 0; }) : outline(s);
        let best = -1, bd = reach;
        pts.forEach(function (q, k) {
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d <= bd) { bd = d; best = k; }
        });
        if (best >= 0) return X.penEdit.curveAt(it, order[n], best);
      }
      return false;
    }
    X.curveUnder = curveUnder;

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

    /* ================= the three tools =================
       As Illustrator has them, on the Draw tab beside Continuous Line:
       Direct Selection (the black arrow) picks out and drags single points;
       Add Anchor Point (pen +) clicks a point onto an outline; Delete Anchor
       Point (pen −) clicks one off. Each shows the points of the outline under
       the pointer, so there is always something to aim at. None of them
       selects the mark as a whole: they work on its points only. */

    const NS = 'http://www.w3.org/2000/svg';
    const TOL_PX = 8;                       /* reach, in screen pixels */
    const VX_TOOLS = { vdirect: 1, vadd: 1, vdel: 1 };

    /* the point being worked on: {it, idx, i} (i null: the outline only) */
    let cur = null, hover = null, drag = null;
    let dlast = null;                    /* the last press, for a double-click */

    function tolAt() { return TOL_PX / Math.max(0.05, S.scale); }
    function pdfOf(it, at) { const p = it.vp.convertToPdfPoint(at[0], at[1]); return [p[0], p[1]]; }
    function editable(s) { return s && PATHABLE[s.t] && !s.hide && !s.locked; }
    /** Marks to look through, the one in hand first, then top of the stack down. */
    function order(it) {
      const out = [];
      if (cur && cur.it === it) out.push(cur.idx);
      for (let i = it.shapes.length - 1; i >= 0; i--) if (out.indexOf(i) < 0) out.push(i);
      return out;
    }
    /** The point of any line, rectangle or Continuous Line within reach of p.
        A closed shape's last point is its first one, so it answers 0 for it. */
    function anchorAt(it, p) {
      const tol = tolAt(), list = order(it);
      for (let n = 0; n < list.length; n++) {
        const s = it.shapes[list[n]];
        if (!editable(s)) continue;
        const pts = outline(s), closed = s.t === 'rect' || closedPts(pts);
        let best = -1, bd = tol;
        pts.forEach(function (q, i) {
          if (closed && i === pts.length - 1) return;
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d <= bd) { bd = d; best = i; }
        });
        if (best >= 0) return { it: it, idx: list[n], i: best };
      }
      return null;
    }
    /** The outline within reach of p, with the place on it nearest p. */
    function outlineAt(it, p) {
      const tol = tolAt(), list = order(it);
      for (let n = 0; n < list.length; n++) {
        const s = it.shapes[list[n]];
        if (!editable(s)) continue;
        const h = nearestOnOutline(outline(s), p, tol);
        if (h) return { it: it, idx: list[n], k: h.k, p: h.p };
      }
      return null;
    }

    /* ---- what is drawn over the page: the outline in hand, its points as
       small squares (filled when picked out, as Illustrator draws a selected
       anchor), and where a point would go or come off ---- */
    function paint(it, extra) {
      X.drawShapes(it);
      if (X.penEdit && X.penEdit.redraw) X.penEdit.redraw(it);     /* a Pen path's handles, kept showing */
      if (!it.anno || !it.vp) return;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'vxov');
      const vp = it.vp;
      const v = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const shown = [];
      if (cur && cur.it === it) shown.push(cur.idx);
      if (hover && hover.it === it && shown.indexOf(hover.idx) < 0) shown.push(hover.idx);
      shown.forEach(function (idx) {
        const s = it.shapes[idx];
        if (!editable(s)) return;
        const pts = outline(s).map(v), closed = s.t === 'rect' || closedPts(outline(s));
        const line = document.createElementNS(NS, 'polyline');
        line.setAttribute('class', 'vxpath');
        line.setAttribute('points', pts.map(function (q) { return q[0] + ',' + q[1]; }).join(' '));
        g.appendChild(line);
        pts.forEach(function (q, i) {
          if (closed && i === pts.length - 1) return;
          const r = document.createElementNS(NS, 'rect');
          r.setAttribute('x', q[0] - 3.5); r.setAttribute('y', q[1] - 3.5);
          r.setAttribute('width', 7); r.setAttribute('height', 7);
          let cls = 'vxpt';
          if (cur && cur.it === it && cur.idx === idx && cur.i === i) cls += ' on';
          if (extra && extra.kill && extra.kill.idx === idx && extra.kill.i === i) cls += ' kill';
          r.setAttribute('class', cls);
          g.appendChild(r);
        });
      });
      if (extra && extra.join) {
        const q = v(extra.join);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', q[0]); c.setAttribute('cy', q[1]); c.setAttribute('r', 7);
        c.setAttribute('class', 'vxjoin');
        g.appendChild(c);
      }
      if (extra && extra.add) {
        const q = v(extra.add);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', q[0]); c.setAttribute('cy', q[1]); c.setAttribute('r', 4);
        c.setAttribute('class', 'vxadd');
        g.appendChild(c);
      }
      it.anno.appendChild(g);
    }
    function clear() {
      const it = (cur && cur.it) || (hover && hover.it);
      cur = null; hover = null; drag = null;
      if (it) X.drawShapes(it);
    }

    /** Point i of mark idx moved to p, as a Continuous Line, keeping a closed
        shape closed. */
    function movePoint(it, idx, i, p) {
      const s = toPath(it, idx);
      const pts = ownPts(s), n = pts.length, closed = closedPts(pts);
      pts[i] = [p[0], p[1]];
      if (closed && i === 0) pts[n - 1] = [p[0], p[1]];
      return s;
    }
    function takeOut(it, idx, i) {
      const s0 = it.shapes[idx];
      const n0 = outline(s0).length;
      const closed0 = s0.t === 'rect' || closedPts(outline(s0));
      if (closed0 ? n0 - 1 <= 3 : n0 <= 2) {
        X.toast(closed0 ? 'A closed shape needs at least three points' : 'A line needs at least two points', true);
        return false;
      }
      X.snapshot();
      removePoint(toPath(it, idx), i);
      done(it);
      return true;
    }

    /* ---- snapping a dragged point onto another, and joining there ----
       A point dragged near any other point of a line, rectangle or
       Continuous Line lands exactly on it. If both are open ends, letting go
       joins them, as Illustrator's Join does: its own other end closes the
       shape; another line's end makes the two one Continuous Line. */
    function isOpenEnd(pts, i) {
      return !closedPts(pts) && (i === 0 || i === pts.length - 1);
    }
    function joinTarget(it, d, p) {
      const tol = tolAt();
      let best = null, bd = tol;
      it.shapes.forEach(function (s, idx) {
        if (!editable(s)) return;
        const pts = outline(s), closed = s.t === 'rect' || closedPts(pts);
        pts.forEach(function (q, i) {
          if (closed && i === pts.length - 1) return;
          if (idx === d.idx) {
            /* of its own points, only the far end, to close the shape on */
            const own = outline(it.shapes[d.idx]);
            if (!d.openEnd || i === d.i || !(i === 0 || i === own.length - 1) || own.length < 4) return;   /* three corners once closed */
          }
          const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (dist <= bd) { bd = dist; best = { idx: idx, i: i, p: [q[0], q[1]] }; }
        });
      });
      return best;
    }
    /** Join where the drag let go, if it is an open end on an open end. */
    function joinAfterDrag(it, d) {
      const t = d.join;
      if (!t) return null;
      const a = it.shapes[d.idx];
      if (!a || a.t !== 'poly' || !d.openEnd) return null;
      if (t.idx === d.idx) {
        /* its own far end: the shape closes */
        const pts = ownPts(a), n = pts.length;
        const far = d.i === 0 ? n - 1 : 0;
        pts[d.i] = [pts[far][0], pts[far][1]];
        return 'Shape closed';
      }
      const b0 = it.shapes[t.idx];
      if (!editable(b0) || b0.t === 'rect' || !isOpenEnd(outline(b0), t.i)) return null;
      const b = toPath(it, t.idx);
      /* a's joined end last, b's joined end first, the shared point once */
      let ap = a.pts.map(function (q) { return [q[0], q[1]]; });
      let bp = b.pts.map(function (q) { return [q[0], q[1]]; });
      if (d.i === 0) ap.reverse();
      if (t.i !== 0) bp.reverse();
      a.pts = ap.concat(bp.slice(1));
      it.shapes.splice(t.idx, 1);
      if (cur && cur.it === it) cur = { it: it, idx: t.idx < d.idx ? d.idx - 1 : d.idx, i: null };
      return 'Joined into one line';
    }

    /* ---- the same with the Select tool: core.js asks, while it drags one
       point of a line or Continuous Line, whether a point is near enough to
       land on, and says where it was let go ---- */
    let ring = null;                       /* {it, p}: the point it would land on */
    X.vxJoinAt = function (it, idx, i, p, o) {
      const d = { idx: idx, i: i, openEnd: isOpenEnd(outline(o), i) };
      const t = joinTarget(it, d, p);
      ring = t ? { it: it, p: t.p } : null;
      return t;
    };
    X.vxJoinEnd = function (it, idx, i, t, o) {
      ring = null;
      const d = { idx: idx, i: i, join: t, openEnd: isOpenEnd(outline(o), i) };
      if (!d.openEnd) return;
      if (it.shapes[idx] && it.shapes[idx].t === 'line') toPath(it, idx);
      const said = joinAfterDrag(it, d);
      if (!said) return;
      const now = t.idx !== idx && t.idx < idx ? idx - 1 : idx;
      X.setGroup(it, [now]);
      X.drawThumb(it);
      X.toast(said, true);
    };
    /* the ring, drawn after core has redrawn the page for this move */
    document.addEventListener('pointermove', function () {
      if (!ring || !ring.it.anno || !ring.it.vp) return;
      const q = ring.it.vp.convertToViewportPoint(ring.p[0], ring.p[1]);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', q[0]); c.setAttribute('cy', q[1]); c.setAttribute('r', 7);
      c.setAttribute('class', 'vxjoin');
      ring.it.anno.appendChild(c);
    });
    document.addEventListener('pointerup', function () {
      if (!ring) return;
      const it = ring.it;
      ring = null;
      X.drawShapes(it);
    });

    /* ---- Direct Selection ---- */
    X.tools.vdirect = {
      bare: false,
      down: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        /* a double-click on a point: Bézier editing of it (js/pen.js) */
        const now = Date.now();
        const twice = dlast && now - dlast.t < 500 && Math.hypot(e.clientX - dlast.x, e.clientY - dlast.y) < 6;
        dlast = twice ? null : { t: now, x: e.clientX, y: e.clientY };
        if (twice && curveUnder(it, pdfOf(it, at))) { cur = null; drag = null; return; }
        /* a Pen path's points and handles are the Pen's to edit (js/pen.js) */
        if (X.penEdit && X.penEdit.down(it, at, e)) { cur = null; return; }
        const p = pdfOf(it, at);
        const a = anchorAt(it, p);
        if (a) {
          cur = a;
          drag = { it: it, idx: a.idx, i: a.i, moved: false, x: e.clientX, y: e.clientY,
                   /* read now: landing on its own far end closes it before release */
                   openEnd: isOpenEnd(outline(it.shapes[a.idx]), a.i) };
          try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* a mouse drags without it */ }
        } else {
          const o = outlineAt(it, p);
          cur = o ? { it: it, idx: o.idx, i: null } : null;
          /* empty page: a box drawn there selects the Pen paths' anchors in it (js/pen.js) */
          if (!o && X.penEdit && X.penEdit.marquee) X.penEdit.marquee(it, at, e);
        }
        paint(it);
      },
      move: function (it, at, e) {
        if (!it.vp) return;
        if (X.penEdit && X.penEdit.busy()) { X.penEdit.move(it, at, e); return; }
        const p = pdfOf(it, at);
        if (!drag && X.penEdit && X.penEdit.hover(it, at)) {
          it.capture.style.cursor = 'var(--cur-direct-point)';
          return;
        }
        if (drag && drag.it === it) {
          if (!drag.moved) {
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
            X.snapshot();
            drag.moved = true;
          }
          /* onto another point (and joined there on release), else onto a
             snap point, else level, plumb or 45° from the point before with Shift */
          drag.join = joinTarget(it, drag, p);
          let q = drag.join ? drag.join.p : null;
          if (q && X.snapHide) X.snapHide();
          if (!q && X.snapPt) q = X.snapPt(it, p, e, { skip: drag.idx });
          if (!q && e.shiftKey) {
            const pts = outline(it.shapes[drag.idx]);
            const ref = pts[drag.i > 0 ? drag.i - 1 : 1] || pts[0];
            q = X.snapLine(ref, p);
          }
          movePoint(it, drag.idx, drag.i, q || p);
          paint(it, drag.join ? { join: drag.join.p } : null);
          return;
        }
        const a = anchorAt(it, p);
        const o = a ? null : outlineAt(it, p);
        hover = a || o ? { it: it, idx: (a || o).idx } : null;
        /* over a point: the black arrow with its little square */
        it.capture.style.cursor = a ? 'var(--cur-direct-point)' : '';
        paint(it);
      },
      up: function (it) {
        if (X.penEdit && X.penEdit.up(it)) return;
        if (drag && drag.moved) {
          if (X.snapHide) X.snapHide();
          const said = joinAfterDrag(it, drag);
          done(it);
          if (said) X.toast(said, true);
        }
        drag = null;
        paint(it);
      },
      cancel: function () { drag = null; clear(); }
    };

    /* ---- Add Anchor Point ---- */
    X.tools.vadd = {
      down: function () { /* a click tool: it happens on release */ },
      move: function (it, at) {
        if (!it.vp) return;
        const o = outlineAt(it, pdfOf(it, at));
        hover = o ? { it: it, idx: o.idx } : null;
        paint(it, o ? { add: o.p } : null);
      },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        if (X.penEdit && X.penEdit.addAt(it, at)) return;          /* on a Pen path: its curve split there */
        const o = outlineAt(it, pdfOf(it, at));
        if (!o) { X.toast('Click right on the outline of a line, rectangle, Continuous Line or Pen path', true); return; }
        const pts = outline(it.shapes[o.idx]), tol = tolAt();
        const a0 = pts[o.k], b0 = pts[o.k + 1];
        if (Math.hypot(a0[0] - o.p[0], a0[1] - o.p[1]) < tol || Math.hypot(b0[0] - o.p[0], b0[1] - o.p[1]) < tol) {
          X.toast('There is a point there already', true);
          return;
        }
        X.snapshot();
        const i = insertPoint(toPath(it, o.idx), o.k, o.p);
        cur = { it: it, idx: o.idx, i: i };
        done(it);
        paint(it);
      },
      cancel: function () { clear(); }
    };

    /* ---- Delete Anchor Point ---- */
    X.tools.vdel = {
      down: function () { /* a click tool: it happens on release */ },
      move: function (it, at) {
        if (!it.vp) return;
        const p = pdfOf(it, at);
        const a = anchorAt(it, p);
        const o = a ? null : outlineAt(it, p);
        hover = a || o ? { it: it, idx: (a || o).idx } : null;
        paint(it, a ? { kill: a } : null);
      },
      up: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        if (X.penEdit && X.penEdit.deleteAt(it, at)) return;       /* a Pen path's point */
        const a = anchorAt(it, pdfOf(it, at));
        if (!a) { X.toast('Click right on a point of a line, rectangle or Continuous Line', true); return; }
        cur = null;
        takeOut(it, a.idx, a.i);
        paint(it);
      },
      cancel: function () { clear(); }
    };

    /* keys for the point in hand, ahead of core's own */
    window.addEventListener('keydown', function (e) {
      if (!VX_TOOLS[S.tool] || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape' && cur) { e.preventDefault(); e.stopImmediatePropagation(); clear(); return; }
      if (!cur || cur.i == null || !editable(cur.it.shapes[cur.idx])) return;
      const it = cur.it;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); e.stopImmediatePropagation();
        const idx = cur.idx, i = cur.i;
        cur = { it: it, idx: idx, i: null };
        takeOut(it, idx, i);
        paint(it);
      } else if (/^Arrow/.test(e.key)) {
        e.preventDefault(); e.stopImmediatePropagation();
        const step = (e.shiftKey ? 10 : 1) * S.scale, vp = it.vp;
        const sx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const sy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const o = vp.convertToPdfPoint(0, 0), q = vp.convertToPdfPoint(sx, sy);
        const p0 = outline(it.shapes[cur.idx])[cur.i];
        X.snapshot();
        movePoint(it, cur.idx, cur.i, [p0[0] + q[0] - o[0], p0[1] + q[1] - o[1]]);
        done(it);
        paint(it);
      }
    }, true);
    X.on('tool', function (t) {
      if (VX_TOOLS[t]) return;
      S.items.forEach(function (it) { if (it.capture) it.capture.style.cursor = ''; });
      if (cur || hover) clear();
    });

    /* ---- their buttons, beside Continuous Line on the Draw tab ---- */
    const PEN = '<path d="M3.5 20.5l2.3-7.6 6.4-6.4 5.3 5.3-6.4 6.4z"/><path d="M3.5 20.5l5-5"/>' +
      '<circle cx="9.6" cy="14.4" r="1.3"/><path d="M12.2 6.5l2.4-2.4 5.3 5.3-2.4 2.4"/>';
    const VTOOLS = [
      /* A, as Illustrator has it (js/pen.js); Shift+V still picks it up */
      { t: 'vdirect', id: 'tVxDirect', label: 'Direct Selection', key: 'V', shift: true, title: 'Direct Selection (A)',
        hint: 'Click a <b>point</b> to select it (<b>Shift</b> adds more), or drag a box round several; drag them, nudge them ' +
              'with the <b>arrow keys</b> or press <b>Delete</b>. Drag a <b>handle</b> to bend the curve (<b>Alt</b>: that one alone), ' +
              'a curved segment to reshape it. Double-click a point to switch it between smooth and corner.',
        /* solid, the way its pointer is: the Select tool's arrow is the open one */
        path: '<path d="M5.5 3.5l13 8-5.8 1.5-3.3 5.3z" fill="currentColor"/>' },
      { t: 'vadd', id: 'tVxAdd', label: 'Add Anchor Point', key: null,
        hint: 'Click the outline of a line, rectangle or Continuous Line to put a <b>point</b> there. ' +
              'A line or rectangle becomes a Continuous Line to take it, with the same look.',
        path: PEN + '<path d="M18.5 15.5v6M15.5 18.5h6"/>' },
      { t: 'vdel', id: 'tVxDel', label: 'Delete Anchor Point', key: null,
        hint: 'Click a <b>point</b> of a line, rectangle or Continuous Line to take it out — the ' +
              'outline closes up across the gap. A closed shape keeps three corners, a line two ends.',
        path: PEN + '<path d="M15.5 18.5h6"/>' }
    ];
    const grpTools = $('grpTools');
    VTOOLS.forEach(function (T) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = T.id; b.type = 'button';
      b.title = T.title || (T.label + (T.key ? ' (' + (T.shift ? 'Shift+' : '') + T.key + ')' : ''));
      b.setAttribute('aria-label', T.label);
      b.dataset.label = T.label;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + T.path + '</svg>';
      b.addEventListener('click', function () { X.toggleTool(T.t); });
      if (grpTools) grpTools.appendChild(b);
      X.toolBtn[T.t] = T.id;
      X.hints[T.t] = T.hint;
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !S.items.length) return;
      const hit = VTOOLS.filter(function (T) {
        return T.key && T.key.toLowerCase() === e.key.toLowerCase() && !!T.shift === !!e.shiftKey;
      })[0];
      if (hit) { e.preventDefault(); X.toggleTool(hit.t); }
    });
  });
})();
