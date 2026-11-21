/* Add Dots PDF — the Pen tool
   --------------------------
   Bézier paths drawn and edited with anchor points and direction handles,
   as with Illustrator's Pen tool:

   • click: a corner point (a straight segment to it); click and drag: a
     smooth point, the drag pulling out its direction handles; Shift keeps
     a new segment level, plumb or at 45°
   • click the first point to close the path; Enter or Esc ends it open;
     Backspace takes back the last point
   • with the Pen tool, and with Direct Selection, a path's points and
     handles show: drag a point to move it, a handle to bend the curve (its
     partner turns with it, keeping the point smooth; Alt moves one alone,
     making a corner); Alt and drag a point pulls new handles out of it,
     Alt and click turns it into a corner
   • with the Pen tool: a click on a path adds a point there, a click on a
     point takes it out, and a click on an open end carries the path on

   A path is the 'pen' mark: s.pts runs anchor, out-handle, in-handle,
   anchor… (3n + 1 points), so it moves, scales and turns as one list of
   points. It is painted by the engine (packages/engine painters/pen.ts) and
   drawn on screen by js/draw.js, the same path both times. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[pen] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const E = window.ADDPDFEngine;
    const NS = 'http://www.w3.org/2000/svg';
    const PX = { anchor: 7, handle: 6, path: 6, close: 8 };

    const tol = function (px) { return px / Math.max(0.05, S.scale); };
    const pdfOf = function (it, at) { const p = it.vp.convertToPdfPoint(at[0], at[1]); return [p[0], p[1]]; };
    const dist = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    const same = function (a, b) { return dist(a, b) < 0.01; };
    const copy = function (pts) { return pts.map(function (q) { return [q[0], q[1]]; }); };
    const closed = function (pts) { return E.penClosed(pts); };
    const editable = function (s) { return s && s.t === 'pen' && s.pts && s.pts.length >= 4 && !s.hide && !s.locked; };

    /* ---------------- the path's geometry ---------------- */

    /* the anchors of a list as {p, hin, hout}, and back */
    function toAnchors(pts) {
      const out = [];
      for (let a = 0; a < pts.length; a += 3) {
        out.push({ p: pts[a].slice(), hin: (a > 0 ? pts[a - 1] : pts[a]).slice(), hout: (a + 1 < pts.length ? pts[a + 1] : pts[a]).slice() });
      }
      return out;
    }
    function toPts(A, close) {
      if (!A.length) return [];
      const pts = [A[0].p.slice()];
      for (let k = 1; k < A.length; k++) pts.push(A[k - 1].hout.slice(), A[k].hin.slice(), A[k].p.slice());
      if (close && A.length > 2) pts.push(A[A.length - 1].hout.slice(), A[0].hin.slice(), A[0].p.slice());
      return pts;
    }
    function bez(p0, c1, c2, p1, t) {
      const u = 1 - t;
      return [
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]
      ];
    }
    /** the place on the path nearest p: segment k (anchors k and k + 1), t on it */
    function nearestOnPath(pts, p, reach) {
      let best = null;
      for (let i = 0, k = 0; i + 3 < pts.length; i += 3, k++) {
        let prev = pts[i];
        for (let n = 1; n <= 32; n++) {
          const t = n / 32, q = bez(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], t);
          const dx = q[0] - prev[0], dy = q[1] - prev[1], l2 = dx * dx + dy * dy;
          const u = l2 ? Math.max(0, Math.min(1, ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / l2)) : 0;
          const r = [prev[0] + u * dx, prev[1] + u * dy], d = dist(r, p);
          if (d <= reach && (!best || d < best.d)) best = { k: k, t: (n - 1 + u) / 32, d: d, p: r };
          prev = q;
        }
      }
      return best;
    }
    /** segment k split at t (de Casteljau): the curve's shape kept, a point added */
    function splitAt(pts, k, t) {
      const i = 3 * k, p0 = pts[i], c1 = pts[i + 1], c2 = pts[i + 2], p1 = pts[i + 3];
      const L = function (a, b) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
      const a = L(p0, c1), b = L(c1, c2), c = L(c2, p1), d = L(a, b), e = L(b, c), m = L(d, e);
      const out = pts.slice(0, i + 1);
      out.push(a, d, m, e, c);
      return out.concat(pts.slice(i + 3));
    }

    /* ---------------- what is under the pointer ---------------- */

    /* the pen paths of a page, the one being worked on first */
    function order(it, first) {
      const out = [];
      if (first != null) out.push(first);
      for (let i = it.shapes.length - 1; i >= 0; i--) if (out.indexOf(i) < 0) out.push(i);
      return out.filter(function (i) { return editable(it.shapes[i]); });
    }
    /** a handle (shown only on the path in hand), an anchor or the path itself */
    function hitAt(it, p, focus) {
      const list = order(it, focus);
      if (focus != null && editable(it.shapes[focus])) {
        const pts = it.shapes[focus].pts;
        for (let i = 0; i < pts.length; i++) {
          if (i % 3 === 0) continue;
          const a = i % 3 === 1 ? i - 1 : i + 1;
          if (same(pts[i], pts[a])) continue;              /* a handle sitting on its point is not shown */
          if (dist(pts[i], p) <= tol(PX.handle)) return { idx: focus, kind: 'handle', i: i };
        }
      }
      for (let n = 0; n < list.length; n++) {
        const pts = it.shapes[list[n]].pts, c = closed(pts);
        for (let a = 0; a < pts.length; a += 3) {
          if (c && a === pts.length - 1) continue;
          if (dist(pts[a], p) <= tol(PX.anchor)) return { idx: list[n], kind: 'anchor', i: a };
        }
      }
      for (let n = 0; n < list.length; n++) {
        const h = nearestOnPath(it.shapes[list[n]].pts, p, tol(PX.path));
        if (h) return { idx: list[n], kind: 'path', k: h.k, t: h.t, p: h.p };
      }
      return null;
    }

    /* ---------------- drawing the overlay ---------------- */

    /* the path in hand: its outline, its anchors as squares (the picked one
       filled) and the direction handles, a line out to a dot each */
    function overlay(it, pts, o) {
      if (!it.anno || !it.vp || !pts || !pts.length) return;
      o = o || {};
      const vp = it.vp, v = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'penov');
      if (pts.length >= 4) {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'penline');
        path.setAttribute('d', X.penD(pts, vp));
        g.appendChild(path);
      }
      const c = closed(pts);
      for (let a = 0; a < pts.length; a += 3) {
        if (c && a === pts.length - 1) continue;
        [a - 1, a + 1].forEach(function (h) {
          if (h < 0 || h >= pts.length || same(pts[h], pts[a])) return;
          const A = v(pts[a]), H = v(pts[h]);
          const ln = document.createElementNS(NS, 'line');
          ln.setAttribute('class', 'penhl');
          ln.setAttribute('x1', A[0]); ln.setAttribute('y1', A[1]); ln.setAttribute('x2', H[0]); ln.setAttribute('y2', H[1]);
          g.appendChild(ln);
          const dot = document.createElementNS(NS, 'circle');
          dot.setAttribute('class', 'penh');
          dot.setAttribute('cx', H[0]); dot.setAttribute('cy', H[1]); dot.setAttribute('r', 3.5);
          g.appendChild(dot);
        });
        const A = v(pts[a]);
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', A[0] - 4); r.setAttribute('y', A[1] - 4); r.setAttribute('width', 8); r.setAttribute('height', 8);
        r.setAttribute('transform', 'rotate(45 ' + A[0] + ' ' + A[1] + ')');
        r.setAttribute('class', 'pena' + (o.on === a ? ' on' : '') + (o.first && a === 0 ? ' first' : ''));
        g.appendChild(r);
      }
      it.anno.appendChild(g);
    }

    /* ---------------- editing a path's points and handles ---------------- */

    let focus = null;                    /* {it, idx}: the path whose handles show */
    let edit = null;                     /* a drag on a point or handle */

    function shapePts(it, idx) { return it.shapes[idx] && it.shapes[idx].pts; }
    function paintFocus(it, extra) {
      X.drawShapes(it, extra && extra.ghost);
      if (focus && focus.it === it && editable(it.shapes[focus.idx])) {
        overlay(it, it.shapes[focus.idx].pts, { on: edit && edit.kind === 'anchor' ? edit.i : null });
      }
    }
    /* a smooth point keeps its handles in one line: the partner of handle i,
       turned to face away from it, at the length it had */
    function partnerOf(pts, i) {
      const c = closed(pts), n = pts.length;
      if (i % 3 === 1) {                                   /* an out-handle: the anchor before it */
        const a = i - 1;
        return { a: a, h: a > 0 ? a - 1 : (c ? n - 2 : -1) };
      }
      const a = i + 1;                                     /* an in-handle: the anchor after it */
      return { a: a, h: a + 1 < n ? a + 1 : (c ? 1 : -1) };
    }
    function setPoint(pts, i, q) {
      /* the first anchor of a closed path is its last too, and so are their handles */
      const n = pts.length, c = closed(pts);
      pts[i] = [q[0], q[1]];
      if (c && i === 0) pts[n - 1] = [q[0], q[1]];
      else if (c && i === n - 1) pts[0] = [q[0], q[1]];
    }

    /* the start of a drag on what is under p; true when it is the Pen's to handle */
    function editDown(it, at, e, opts) {
      opts = opts || {};
      const p = pdfOf(it, at);
      const hit = hitAt(it, p, focus && focus.it === it ? focus.idx : null);
      if (!hit) { if (focus) { const f = focus.it; focus = null; X.drawShapes(f); } return false; }
      focus = { it: it, idx: hit.idx };
      const pts = shapePts(it, hit.idx);
      if (hit.kind === 'path') {
        if (!opts.addOnPath) { paintFocus(it); return true; }
        X.snapshot();
        it.shapes[hit.idx].pts = splitAt(copy(pts), hit.k, hit.t);
        done(it);
        paintFocus(it);
        return true;
      }
      if (hit.kind === 'anchor' && opts.deleteAnchor && !e.altKey) {
        deleteAnchor(it, hit.idx, hit.i);
        return true;
      }
      if (hit.kind === 'anchor' && e.altKey && !opts.dragOnly) {
        /* Alt on a point: pull handles out of it (a drag) or make it a corner (a click) */
        edit = { it: it, idx: hit.idx, kind: 'pull', i: hit.i, x: e.clientX, y: e.clientY, moved: false };
      } else {
        edit = { it: it, idx: hit.idx, kind: hit.kind, i: hit.i, x: e.clientX, y: e.clientY, moved: false,
                 from: p, orig: copy(pts), alt: e.altKey };
      }
      try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* a mouse drags without it */ }
      paintFocus(it);
      return true;
    }
    function editMove(it, at, e) {
      if (!edit || edit.it !== it) return false;
      if (!edit.moved) {
        if (Math.hypot(e.clientX - edit.x, e.clientY - edit.y) < 3) return true;
        X.snapshot();
        edit.moved = true;
        edit.orig = edit.orig || copy(shapePts(it, edit.idx));
      }
      const p = pdfOf(it, at), s = it.shapes[edit.idx];
      const pts = copy(edit.orig);
      if (edit.kind === 'anchor') {
        const q = X.snapPt ? X.snapPt(it, p, e, { skip: edit.idx }) : null;
        const to = q || p, dx = to[0] - edit.orig[edit.i][0], dy = to[1] - edit.orig[edit.i][1];
        const n = pts.length, c = closed(pts);
        const move = function (j) { if (j >= 0 && j < n) pts[j] = [edit.orig[j][0] + dx, edit.orig[j][1] + dy]; };
        [edit.i - 1, edit.i, edit.i + 1].forEach(move);
        if (c && edit.i === 0) [n - 2, n - 1].forEach(move);
      } else if (edit.kind === 'handle') {
        setPoint(pts, edit.i, p);
        if (!e.altKey && !edit.alt) {
          const pr = partnerOf(pts, edit.i);
          if (pr.h >= 0 && !same(edit.orig[pr.h], edit.orig[pr.a])) {
            const A = pts[pr.a], len = dist(edit.orig[pr.h], edit.orig[pr.a]);
            const dx = A[0] - p[0], dy = A[1] - p[1], l = Math.hypot(dx, dy) || 1;
            setPoint(pts, pr.h, [A[0] + dx / l * len, A[1] + dy / l * len]);
          }
        }
      } else if (edit.kind === 'pull') {
        /* both handles out of the point, mirrored, as when it was placed */
        const A = pts[edit.i], n = pts.length, c = closed(pts);
        const out = edit.i + 1 < n ? edit.i + 1 : (c ? 1 : -1);
        const inn = edit.i > 0 ? edit.i - 1 : (c ? n - 2 : -1);
        if (out >= 0) setPoint(pts, out, p);
        if (inn >= 0) setPoint(pts, inn, [2 * A[0] - p[0], 2 * A[1] - p[1]]);
      }
      s.pts = pts;
      paintFocus(it);
      return true;
    }
    function editUp(it) {
      if (!edit || edit.it !== it) return false;
      const ed = edit;
      edit = null;
      if (X.snapHide) X.snapHide();
      if (ed.kind === 'pull' && !ed.moved) {
        /* Alt and a click on a point: a corner, its handles back on it */
        X.snapshot();
        const pts = copy(shapePts(it, ed.idx)), A = pts[ed.i];
        [ed.i - 1, ed.i + 1].forEach(function (h) { if (h >= 0 && h < pts.length) setPoint(pts, h, A); });
        if (closed(pts) && ed.i === 0) setPoint(pts, pts.length - 2, A);
        it.shapes[ed.idx].pts = pts;
      }
      if (ed.moved || ed.kind === 'pull') done(it);
      paintFocus(it);
      return true;
    }
    function deleteAnchor(it, idx, a) {
      const s = it.shapes[idx], pts = s.pts, c = closed(pts);
      const anchors = toAnchors(c ? pts.slice(0, -3) : pts);
      const k = a / 3 | 0;
      if (anchors.length <= (c ? 3 : 2)) {
        X.toast(c ? 'A closed path needs at least three points' : 'A path needs at least two points', true);
        return;
      }
      X.snapshot();
      anchors.splice(k, 1);
      s.pts = toPts(anchors, c);
      done(it);
      paintFocus(it);
    }
    function done(it) { X.drawThumb(it); X.updateMeta(); }

    /* for Direct Selection and the Add / Delete Anchor Point tools (js/vertex.js) */
    X.penEdit = {
      down: function (it, at, e) { return editDown(it, at, e, { dragOnly: false }); },
      move: editMove,
      up: editUp,
      busy: function () { return !!edit; },
      hover: function (it, at) {
        const hit = hitAt(it, pdfOf(it, at), focus && focus.it === it ? focus.idx : null);
        if (!hit) return false;
        if (!focus || focus.it !== it || focus.idx !== hit.idx) focus = { it: it, idx: hit.idx };
        paintFocus(it);
        return true;
      },
      addAt: function (it, at) {
        const p = pdfOf(it, at), list = order(it, null);
        for (let n = 0; n < list.length; n++) {
          const h = nearestOnPath(it.shapes[list[n]].pts, p, tol(PX.path));
          if (!h) continue;
          X.snapshot();
          it.shapes[list[n]].pts = splitAt(copy(it.shapes[list[n]].pts), h.k, h.t);
          focus = { it: it, idx: list[n] };
          done(it); paintFocus(it);
          return true;
        }
        return false;
      },
      deleteAt: function (it, at) {
        const hit = hitAt(it, pdfOf(it, at), null);
        if (!hit || hit.kind !== 'anchor') return false;
        focus = { it: it, idx: hit.idx };
        deleteAnchor(it, hit.idx, hit.i);
        return true;
      },
      clear: function () { const f = focus; focus = null; edit = null; if (f) X.drawShapes(f.it); }
    };

    /* ---------------- the Pen tool: drawing ---------------- */

    let draw = null;                    /* {it, A: anchors, drag, idx (continuing a path)} */

    function ghostPts(extra) {
      const pts = toPts(draw.A, false);
      if (extra && draw.A.length) {
        const last = draw.A[draw.A.length - 1];
        pts.push(last.hout.slice(), extra.slice(), extra.slice());
      }
      return pts;
    }
    function paintDraw(extra) {
      const it = draw.it;
      const pts = ghostPts(extra);
      const ghost = pts.length >= 4 ? { t: 'pen', pts: pts, c: S.color, w: S.width } : null;
      X.drawShapes(it, ghost || undefined);
      overlay(it, toPts(draw.A, false), { on: (draw.A.length - 1) * 3, first: draw.A.length > 1 });
    }
    /* level, plumb or 45° from the point before, with Shift */
    function constrain(p, e) {
      if (!e || !e.shiftKey || !draw || !draw.A.length) return p;
      return X.snapLine(draw.A[draw.A.length - 1].p, p);
    }
    function finish(close) {
      if (!draw) return;
      const d = draw;
      draw = null;
      const it = d.it;
      if (d.A.length >= 2) {
        X.snapshot();
        const pts = toPts(d.A, close);
        if (d.idx != null && it.shapes[d.idx]) {
          it.shapes[d.idx].pts = pts;
        } else {
          it.shapes.push({ t: 'pen', pts: pts, c: S.color, w: S.width });
          d.idx = it.shapes.length - 1;
        }
        focus = { it: it, idx: d.idx };
        done(it);
      }
      paintFocus(it);                     /* the path just drawn keeps its points and handles showing */
      $('modeHint').innerHTML = X.hints.pen;
    }

    X.tools.pen = {
      colors: true, widths: true,
      down: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const raw = pdfOf(it, at);
        if (!draw) {
          /* on a path already there: edit it, or carry an open end on */
          const hit = hitAt(it, raw, focus && focus.it === it ? focus.idx : null);
          if (hit && hit.kind === 'anchor' && !e.altKey) {
            const pts = it.shapes[hit.idx].pts;
            if (!closed(pts) && (hit.i === 0 || hit.i === pts.length - 1)) {
              const A = toAnchors(pts);
              if (hit.i === 0) A.reverse().forEach(function (a) { const t = a.hin; a.hin = a.hout; a.hout = t; });
              draw = { it: it, A: A, idx: hit.idx, drag: null };
              focus = null;
              $('modeHint').innerHTML = 'Carrying the path on: click for a corner, drag for a curve. <b>Enter</b> ends it.';
              paintDraw();
              return;
            }
          }
          if (hit && editDown(it, at, e, { addOnPath: true, deleteAnchor: true })) return;
          draw = { it: it, A: [], idx: null, drag: null };
          $('modeHint').innerHTML = 'Click for a corner, drag for a curve. Click the first point to close; <b>Enter</b> or <b>Esc</b> ends the path.';
        }
        if (draw.it !== it) { finish(false); return; }
        /* on the first point: the path closes there (its handle can still be pulled) */
        if (draw.A.length >= 2 && dist(raw, draw.A[0].p) <= tol(PX.close)) {
          draw.drag = { k: 0, x: e.clientX, y: e.clientY, close: true };
          try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
          return;
        }
        const snapped = X.snapPt ? X.snapPt(it, raw, e) : null;
        const p = snapped || constrain(raw, e);
        draw.A.push({ p: p, hin: p.slice(), hout: p.slice() });
        draw.drag = { k: draw.A.length - 1, x: e.clientX, y: e.clientY };
        try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        paintDraw();
      },
      move: function (it, at, e) {
        if (!it.vp) return;
        if (editMove(it, at, e)) return;
        const raw = pdfOf(it, at);
        if (draw && draw.it === it && draw.drag) {
          /* pulling the handles of the point just placed: out with the pointer, in mirrored */
          if (Math.hypot(e.clientX - draw.drag.x, e.clientY - draw.drag.y) < 3) return;
          const a = draw.A[draw.drag.k];
          let q = raw;
          if (e.shiftKey) q = X.snapLine(a.p, q);
          a.hout = q;
          a.hin = [2 * a.p[0] - q[0], 2 * a.p[1] - q[1]];
          if (draw.drag.close) { const t = a.hin; a.hin = a.hout; a.hout = t; }
          paintDraw();
          return;
        }
        if (draw && draw.it === it) {
          const near = draw.A.length >= 2 && dist(raw, draw.A[0].p) <= tol(PX.close);
          it.capture.style.cursor = near ? 'var(--cur-pen-close)' : '';
          const snapped = !near && X.snapPt ? X.snapPt(it, raw, e) : null;
          paintDraw(near ? draw.A[0].p : (snapped || constrain(raw, e)));
          return;
        }
        /* not drawing: show the points of the path under the pointer */
        const hit = hitAt(it, raw, focus && focus.it === it ? focus.idx : null);
        it.capture.style.cursor = !hit ? ''
          : hit.kind === 'path' ? 'var(--cur-pen-add)'
          : hit.kind === 'anchor' && !e.altKey ? 'var(--cur-pen-del)'
          : 'var(--cur-direct-point)';
        if (hit && (!focus || focus.it !== it || focus.idx !== hit.idx)) focus = { it: it, idx: hit.idx };
        paintFocus(it);
      },
      up: function (it, at, e) {
        if (editUp(it)) return;
        if (!draw || draw.it !== it || !draw.drag) return;
        const close = draw.drag.close;
        draw.drag = null;
        if (close) { finish(true); return; }
        paintDraw(pdfOf(it, at));
        void e;
      },
      cancel: function () {
        if (draw) finish(false);
        X.penEdit.clear();
      }
    };

    /* keys while a path is being drawn */
    window.addEventListener('keydown', function (e) {
      if (S.tool !== 'pen' || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (draw && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault(); e.stopImmediatePropagation();
        finish(false);
      } else if (draw && e.key === 'Backspace') {
        e.preventDefault(); e.stopImmediatePropagation();
        draw.A.pop();
        if (!draw.A.length) { const it = draw.it; draw = null; X.drawShapes(it); $('modeHint').innerHTML = X.hints.pen; return; }
        paintDraw();
      } else if (!draw && focus && e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation();
        X.penEdit.clear();
      }
    }, true);
    X.on('tool', function (t) {
      if (t !== 'pen' && draw) finish(false);
      if (t !== 'pen' && t !== 'vdirect' && t !== 'vadd' && t !== 'vdel') X.penEdit.clear();
      S.items.forEach(function (it) { if (it.capture && t !== 'pen' && t !== 'vdirect') it.capture.style.cursor = ''; });
    });

    /* ---------------- its button, on the Tools tab ---------------- */

    const T = {
      t: 'pen', id: 'tPen', label: 'Pen',
      hint: 'Click for a corner point, drag for a curve: the drag pulls the point\'s direction handles out. ' +
            'Click the first point to close the path; <b>Enter</b> or <b>Esc</b> ends it. On a path: drag a point ' +
            'or a handle to change it (<b>Alt</b> moves one handle alone), click the path to add a point, click a point to take it out.',
      path: '<path d="M12 21l-4.5-8.5L12 3l4.5 9.5z"/><circle cx="12" cy="13" r="1.6"/><path d="M12 14.6V21"/><path d="M8.5 21h7"/>'
    };
    const b = document.createElement('button');
    b.className = 'btn'; b.id = T.id; b.type = 'button';
    b.title = T.label;
    b.setAttribute('aria-label', T.label);
    b.dataset.label = T.label;
    b.innerHTML = '<svg viewBox="0 0 24 24">' + T.path + '</svg>';
    b.addEventListener('click', function () { X.toggleTool('pen'); });
    if ($('grpTools')) $('grpTools').appendChild(b);
    X.toolBtn.pen = T.id;
    X.hints.pen = T.hint;
  });
})();
