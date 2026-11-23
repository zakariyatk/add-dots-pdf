/* Add Dots PDF — the Pen tool, and editing a path point by point
   -------------------------------------------------------------
   Bézier paths drawn and edited with anchor points and direction handles,
   as with Illustrator's Pen, Direct Selection and Convert Anchor Point tools.

   Drawing (the Pen, P):
   • click: a corner point (a straight segment to it); click and drag: a
     smooth point, the drag pulling out its direction handles. While
     dragging, Alt breaks them (only the one going out follows, a cusp),
     Space moves the point itself, Shift keeps the handle at 45° steps
   • Shift and a click keeps a new segment level, plumb or at 45°
   • click the last point again to take its handle back in (the next segment
     starts straight from a curve); drag from it to pull a new handle out on
     its own, the one coming in kept
   • the next segment is previewed from the last point to the pointer, in the
     path's own stroke and fill
   • click the first point to close the path (it rings when the pointer is
     on it), Enter or Esc to end it open; Backspace or Ctrl+Z takes back the
     last point, Ctrl+Shift+Z puts it back
   • a click on an open end carries that path on (a Pen path's, a Line's or a
     Continuous Line's); while drawing, a click on another open end joins the
     two into one path; a click on any other shape's anchor starts a new path
     exactly there. Every point placed snaps (js/draw.js)
   • not drawing: a click on a path adds a point there; Alt and a click on a
     point converts it (smooth to corner, or a drag pulls new handles); a
     drag on a visible handle bends the curve

   Editing (Direct Selection, A or Shift+V):
   • click an anchor to select it, Shift and click to add or take one away,
     drag on empty page to select every anchor in the box; the selected ones
     fill in, and their direction handles show
   • drag a selected anchor and all the selected ones move together, their
     handles with them; the arrow keys nudge them (Shift: ten at a time);
     Delete takes them out, the path closing up across the gap
   • drag a handle to bend the curve: a smooth point's other handle turns
     with it, staying in line; Alt moves one alone, breaking them. A corner's
     handles are independent already
   • drag a curved segment to reshape it; a straight one moves whole
   • double-click a point: smooth becomes corner, corner becomes smooth

   Convert Anchor Point (Shift+C): click a point to make it a corner, drag
   from it to pull smooth handles out, drag a handle to move it on its own.
   It also takes a line, rectangle or Continuous Line's corner, making the
   mark a Pen path.

   The Path bar under the ribbon (with any of these tools) and the Path
   section of a selected Pen path's properties hold the rest: Corner and
   Smooth for the selected points, Join (Ctrl+J), Close, Cut at the selected
   point, Reverse, and Delete points.

   A path is the 'pen' mark: s.pts runs anchor, out-handle, in-handle,
   anchor… (3n + 1 points, PDF points), so it moves, scales and turns as one
   list. Its geometry is js/penpath.js; it is painted by the engine
   (packages/engine painters/pen.ts) and on screen by js/draw.js, the same
   cubic curves both times. Every change is one undo step. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[pen] core bridge missing'); return; }
  const G = window.ADDPDF_PENPATH;
  if (!G) { console.error('[pen] js/penpath.js missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const NS = 'http://www.w3.org/2000/svg';
    /* reach, in screen pixels, at any zoom */
    const PX = { anchor: 7, handle: 6, path: 6, close: 9 };
    const PEN_TOOLS = { pen: 1, vdirect: 1, vconv: 1, vadd: 1, vdel: 1 };

    const tol = function (px) { return px / Math.max(0.05, S.scale); };
    const pdfOf = function (it, at) { const p = it.vp.convertToPdfPoint(at[0], at[1]); return [p[0], p[1]]; };
    const dist = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    const copy = function (pts) { return pts.map(function (q) { return [q[0], q[1]]; }); };
    const closed = function (pts, open) { return G.closed(pts, open); };
    const editable = function (s) { return s && s.t === 'pen' && s.pts && s.pts.length >= 4 && !s.hide && !s.locked; };
    const typing = function (t) {
      return !!(t && (t.isContentEditable || (t.matches && t.matches('input,textarea,select,[contenteditable],[contenteditable] *'))));
    };

    /* a path's anchors, read fresh: the undo snapshot shares each mark's pts
       list, so a list is never changed where it lies — each edit makes its
       own (G.toPts) and puts that on the mark */
    function anchorsOf(s) { return G.fromPts(s.pts, s.open); }
    /* an open path whose ends meet says so (s.open), or it would read as closed */
    function store(s, A, isClosed) {
      s.pts = G.toPts(A, isClosed);
      if (G.needsOpen(A, isClosed)) s.open = true; else delete s.open;
    }

    /* ---------------- state ---------------- */

    let focus = null;          /* {it, idx}: the path in hand, its points showing */
    let sel = null;            /* {it, m: {idx: [k…]}}: the anchors selected */
    let hov = null;            /* {it, idx, kind, k, side}: under the pointer, highlighted */
    let edit = null;           /* a drag on a point, handle, segment, or a marquee */

    function selOn(it, idx) { return sel && sel.it === it && sel.m[idx] ? sel.m[idx] : []; }
    function isSel(it, idx, k) { return selOn(it, idx).indexOf(k) >= 0; }
    function selCount() {
      if (!sel) return 0;
      return Object.keys(sel.m).reduce(function (n, i) { return n + sel.m[i].length; }, 0);
    }
    function setSel(it, m) {
      const keys = Object.keys(m || {}).filter(function (i) { return m[i] && m[i].length; });
      sel = keys.length ? { it: it, m: keys.reduce(function (o, i) { o[i] = m[i].slice().sort(function (a, b) { return a - b; }); return o; }, {}) } : null;
      paintBar();
    }
    function clearSel() { sel = null; paintBar(); }
    /* the selection kept valid as marks come and go */
    function selValid() {
      if (!sel) return;
      const it = sel.it, m = {};
      Object.keys(sel.m).forEach(function (i) {
        const s = it.shapes[+i];
        if (!editable(s)) return;
        const n = anchorsOf(s).A.length;
        const ks = sel.m[i].filter(function (k) { return k < n; });
        if (ks.length) m[i] = ks;
      });
      setSel(it, m);
    }

    /* ---------------- what is under the pointer ---------------- */

    /* the pen paths of a page, the one in hand first, then top of the stack down */
    function order(it, first) {
      const out = [];
      if (first != null) out.push(first);
      for (let i = it.shapes.length - 1; i >= 0; i--) if (out.indexOf(i) < 0) out.push(i);
      return out.filter(function (i) { return editable(it.shapes[i]); });
    }
    /** The handles showing: those of the selected anchors, and the ones
        facing them across the segments either side, as Illustrator shows
        them; with a path just drawn, its last point's. */
    function shownHandles(it) {
      const out = [];
      if (!sel || sel.it !== it) return out;
      Object.keys(sel.m).forEach(function (i) {
        const idx = +i, s = it.shapes[idx];
        if (!editable(s)) return;
        const P = anchorsOf(s), A = P.A, n = A.length;
        const want = {};
        sel.m[i].forEach(function (k) {
          if (k >= n) return;
          want[k + ':hin'] = 1; want[k + ':hout'] = 1;
          const prev = k > 0 ? k - 1 : (P.closed ? n - 1 : -1);
          const next = k < n - 1 ? k + 1 : (P.closed ? 0 : -1);
          if (prev >= 0) want[prev + ':hout'] = 1;
          if (next >= 0) want[next + ':hin'] = 1;
        });
        Object.keys(want).forEach(function (w) {
          const parts = w.split(':'), k = +parts[0], side = parts[1], a = A[k];
          /* an open path's ends have no handle out of the path */
          if (!P.closed && ((k === 0 && side === 'hin') || (k === n - 1 && side === 'hout'))) return;
          if (side === 'hin' ? !G.hasIn(a) : !G.hasOut(a)) return;
          out.push({ idx: idx, k: k, side: side, q: a[side], p: a.p });
        });
      });
      return out;
    }
    /** A handle showing, an anchor, or the path itself, under p. */
    function hitAt(it, p) {
      const hs = shownHandles(it);
      for (let n = hs.length - 1; n >= 0; n--) {
        if (dist(hs[n].q, p) <= tol(PX.handle)) return { kind: 'handle', idx: hs[n].idx, k: hs[n].k, side: hs[n].side };
      }
      const list = order(it, focus && focus.it === it ? focus.idx : null);
      for (let n = 0; n < list.length; n++) {
        const A = anchorsOf(it.shapes[list[n]]).A;
        let best = -1, bd = tol(PX.anchor);
        A.forEach(function (a, k) { const d = dist(a.p, p); if (d <= bd) { bd = d; best = k; } });
        if (best >= 0) return { kind: 'anchor', idx: list[n], k: best };
      }
      for (let n = 0; n < list.length; n++) {
        const h = G.nearest(it.shapes[list[n]].pts, p, tol(PX.path));
        if (h) return { kind: 'path', idx: list[n], k: h.k, t: h.t, p: h.p };
      }
      return null;
    }

    /* ---------------- drawn over the page ----------------
       The paths in hand: their outline, each anchor (a square for a corner, a
       circle for a smooth point, filled when selected, larger under the
       pointer), and the direction handles showing, a line out to a dot.
       Repainted on its own when only the pointer moved, so hovering never
       redraws the marks. */
    function el(name, attrs, cls) {
      const e = document.createElementNS(NS, name);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (cls) e.setAttribute('class', cls);
      return e;
    }
    function shownPaths(it) {
      const out = [];
      if (focus && focus.it === it) out.push(focus.idx);
      if (sel && sel.it === it) Object.keys(sel.m).forEach(function (i) { if (out.indexOf(+i) < 0) out.push(+i); });
      if (hov && hov.it === it && out.indexOf(hov.idx) < 0) out.push(hov.idx);
      return out.filter(function (i) { return editable(it.shapes[i]); });
    }
    function drawOverlay(it) {
      if (!it.anno || !it.vp) return;
      Array.prototype.slice.call(it.anno.querySelectorAll(':scope > .penov')).forEach(function (n) { n.remove(); });
      const paths = shownPaths(it);
      const box = edit && edit.kind === 'marquee' && edit.it === it ? edit : null;
      if (!paths.length && !box) return;
      const vp = it.vp, v = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const g = el('g', {}, 'penov');
      paths.forEach(function (idx) {
        const s = it.shapes[idx];
        g.appendChild(el('path', { d: X.penD(s.pts, vp, s.open) }, 'penline'));
      });
      shownHandles(it).forEach(function (h) {
        const A = v(h.p), H = v(h.q);
        g.appendChild(el('line', { x1: A[0], y1: A[1], x2: H[0], y2: H[1] }, 'penhl'));
        const on = hov && hov.it === it && hov.kind === 'handle' && hov.idx === h.idx && hov.k === h.k && hov.side === h.side;
        g.appendChild(el('circle', { cx: H[0], cy: H[1], r: on ? 4.5 : 3.5 }, 'penh' + (on ? ' hov' : '')));
      });
      paths.forEach(function (idx) {
        const A = anchorsOf(it.shapes[idx]).A;
        A.forEach(function (a, k) {
          const q = v(a.p), on = isSel(it, idx, k);
          const over = hov && hov.it === it && hov.kind === 'anchor' && hov.idx === idx && hov.k === k;
          g.appendChild(anchorEl(q, G.kind(a), on, over, false));
        });
      });
      if (box) {
        const a = v(box.from), b = v(box.to);
        g.appendChild(el('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
          width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }, 'penbox'));
      }
      it.anno.appendChild(g);
    }
    function anchorEl(q, kind, on, over, first) {
      const r = over || first ? 5 : 4;
      const cls = 'pena ' + kind + (on ? ' on' : '') + (over ? ' hov' : '') + (first ? ' first' : '');
      if (kind === 'smooth') return el('circle', { cx: q[0], cy: q[1], r: r }, cls);
      return el('rect', { x: q[0] - r, y: q[1] - r, width: 2 * r, height: 2 * r }, cls);
    }
    /* after any redraw of the marks, the overlay goes back on top */
    X.afterDraw.push(function (it) {
      if (PEN_TOOLS[S.tool] && !draw) drawOverlay(it);
    });

    /* the marks redrawn once per frame however fast the pointer moves */
    let frame = 0, frameFn = null;
    function soon(fn) {
      frameFn = fn;
      if (frame) return;
      frame = requestAnimationFrame(function () { frame = 0; const f = frameFn; frameFn = null; if (f) f(); });
    }
    function flushSoon() {
      if (!frame) return;
      cancelAnimationFrame(frame); frame = 0;
      const f = frameFn; frameFn = null; if (f) f();
    }
    function done(it) { X.drawThumb(it); X.updateMeta(); }

    /* ---------------- editing: down, move, up ---------------- */

    /** A press on what is under the pointer. mode: 'direct' (Direct
        Selection), 'convert' (Convert Anchor Point), 'pen' (the Pen, not
        drawing). True when it is a Pen path's to handle. */
    function editDown(it, at, e, mode) {
      flushSoon();
      const p = pdfOf(it, at);
      let hit = hitAt(it, p);
      if (!hit && mode === 'convert') hit = convertShapeAt(it, p);
      if (!hit) return false;
      const base = { it: it, idx: hit.idx, x: e.clientX, y: e.clientY, moved: false, from: p,
                     orig: copy(it.shapes[hit.idx].pts), open: !!it.shapes[hit.idx].open, shift: e.shiftKey, alt: e.altKey };
      focus = { it: it, idx: hit.idx };
      if (hit.kind === 'handle') {
        /* Convert, or Alt: the handle alone; otherwise a smooth point's pair move together */
        edit = Object.assign(base, { kind: 'handle', k: hit.k, side: hit.side, linked: mode !== 'convert' && !e.altKey });
      } else if (hit.kind === 'anchor') {
        if (mode === 'convert' || (e.altKey && mode !== 'direct-move')) {
          edit = Object.assign(base, { kind: 'convert', k: hit.k, mode: mode });
        } else {
          /* Direct Selection: Shift adds the point to the selection or takes it away */
          const cur = selOn(it, hit.idx).slice();
          const has = cur.indexOf(hit.k) >= 0;
          if (e.shiftKey) {
            const m = sel && sel.it === it ? Object.assign({}, sel.m) : {};
            m[hit.idx] = has ? cur.filter(function (k) { return k !== hit.k; }) : cur.concat([hit.k]);
            setSel(it, m);
          } else if (!has) {
            const m = {}; m[hit.idx] = [hit.k];
            setSel(it, m);
          }
          if (e.shiftKey && has) { edit = null; drawOverlay(it); return true; }
          edit = Object.assign(base, { kind: 'anchors', k: hit.k,
            origAll: sel ? Object.keys(sel.m).reduce(function (o, i) { o[i] = { pts: copy(it.shapes[+i].pts), open: !!it.shapes[+i].open }; return o; }, {}) : {} });
        }
      } else {
        /* on the path, off its points: a straight segment moves, a curved one bends */
        if (!e.shiftKey) clearSel();
        const A = anchorsOf(it.shapes[hit.idx]).A;
        edit = Object.assign(base, { kind: 'seg', k: hit.k, t: hit.t, straight: G.straightSeg(A, hit.k) });
      }
      try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* a mouse drags without it */ }
      drawOverlay(it);
      return true;
    }

    /** Convert Anchor Point on a line, rectangle or Continuous Line: the
        mark becomes a Pen path in place (its look, layer and place kept) and
        the corner under the pointer is the point to work on. */
    function convertShapeAt(it, p) {
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        const s = it.shapes[i];
        if (!s || s.hide || s.locked || !(s.t === 'line' || s.t === 'rect' || s.t === 'poly')) continue;
        const pts = asPen(s);
        if (!pts || pts.length < 4) continue;
        const A = G.fromPts(pts).A;
        const k = A.findIndex(function (a) { return dist(a.p, p) <= tol(PX.anchor); });
        if (k < 0) continue;
        X.snapshot();
        const P = G.fromPts(pts);
        becomePen(it, i, P.A, P.closed);
        return { kind: 'anchor', idx: i, k: k, converted: true };
      }
      return null;
    }
    /** mark idx made a Pen path of anchors A, in place: its look, layer and
        place in the stack kept */
    function becomePen(it, idx, A, isClosed) {
      const s = Object.assign({}, it.shapes[idx], { t: 'pen' });
      delete s.a; delete s.b; delete s.r;
      store(s, A, isClosed);
      it.shapes[idx] = s;
      return s;
    }

    function editMove(it, at, e) {
      if (!edit || edit.it !== it) return false;
      if (!edit.moved) {
        if (Math.hypot(e.clientX - edit.x, e.clientY - edit.y) < 3) return true;
        if (edit.kind !== 'marquee') X.snapshot();
        edit.moved = true;
      }
      const ev = { shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, clientX: e.clientX, clientY: e.clientY };
      const p = pdfOf(it, at);
      soon(function () { applyMove(it, p, ev); });
      return true;
    }
    function applyMove(it, p, e) {
      const ed = edit;
      if (!ed || ed.it !== it) return;
      if (ed.kind === 'marquee') {
        ed.to = p;
        const m = ed.shift && ed.base ? JSON.parse(JSON.stringify(ed.base)) : {};
        it.shapes.forEach(function (s, idx) {
          if (!editable(s)) return;
          const ks = G.inBox(anchorsOf(s).A, ed.from[0], ed.from[1], p[0], p[1]);
          if (!ks.length) return;
          const was = m[idx] || [];
          ks.forEach(function (k) { if (was.indexOf(k) < 0) was.push(k); });
          m[idx] = was;
        });
        setSel(it, m);
        drawOverlay(it);
        return;
      }
      const s = it.shapes[ed.idx];
      if (!s) return;
      const P = G.fromPts(ed.orig, ed.open), A = P.A;
      if (ed.kind === 'anchors') {
        /* the grabbed point snaps (to anchors, ends, lining up), Shift keeps
           the move level, plumb or at 45°; every selected point goes as far */
        const a0 = A[ed.k].p;
        let to = [a0[0] + p[0] - ed.from[0], a0[1] + p[1] - ed.from[1]];
        if (e.shiftKey) to = X.snapLine(a0, to);
        else if (X.snapPt) {
          const sn = X.snapPt(it, to, e, { skip: ed.idx });
          if (sn) to = sn;
        }
        const dx = to[0] - a0[0], dy = to[1] - a0[1];
        Object.keys(ed.origAll).forEach(function (i) {
          const sh = it.shapes[+i];
          if (!sh) return;
          const Q = G.fromPts(ed.origAll[i].pts, ed.origAll[i].open);
          G.moveAnchors(Q.A, selOn(it, +i), dx, dy);
          store(sh, Q.A, Q.closed);
        });
      } else if (ed.kind === 'handle') {
        let q = p;
        if (e.shiftKey) q = X.snapLine(A[ed.k].p, q);
        G.setHandle(A, ed.k, ed.side, q, ed.linked && !e.altKey);
        store(s, A, P.closed);
      } else if (ed.kind === 'convert') {
        /* a drag from a point: smooth handles pulled out of it, mirrored */
        let q = p;
        if (e.shiftKey) q = X.snapLine(A[ed.k].p, q);
        G.pullHandles(A, ed.k, q);
        store(s, A, P.closed);
      } else if (ed.kind === 'seg') {
        const d = [p[0] - ed.from[0], p[1] - ed.from[1]];
        if (ed.straight) {
          const n = A.length, j = (ed.k + 1) % n;
          G.moveAnchors(A, ed.k === j ? [ed.k] : [ed.k, j], d[0], d[1]);
        } else G.bendSeg(A, ed.k, ed.t, d);
        store(s, A, P.closed);
      }
      X.drawShapes(it);
    }
    function editUp(it) {
      if (!edit || edit.it !== it) return false;
      flushSoon();
      const ed = edit;
      edit = null;
      if (X.snapHide) X.snapHide();
      if (ed.kind === 'marquee') {
        /* a click on empty page lets everything go */
        if (!ed.moved && !ed.shift) { clearSel(); focus = null; }
        X.drawShapes(it);
        return true;
      }
      if (ed.kind === 'convert' && !ed.moved) {
        /* a click: a point with handles loses them (a corner); with Convert,
           a corner with none gets them (smooth) */
        X.snapshot();
        const s = it.shapes[ed.idx], P = anchorsOf(s), a = P.A[ed.k];
        if (G.hasIn(a) || G.hasOut(a)) G.makeCorner(P.A, ed.k);
        else if (ed.mode === 'convert') G.makeSmooth(P.A, ed.k, P.closed);
        store(s, P.A, P.closed);
        const m = {}; m[ed.idx] = [ed.k]; setSel(it, m);
        done(it);
      } else if (ed.moved) {
        done(it);
      } else if (ed.kind === 'seg') {
        focus = { it: it, idx: ed.idx };
      }
      X.drawShapes(it);
      return true;
    }

    /* ---------------- whole-path work ---------------- */

    /** The selected anchors taken out of their paths, each path closing up
        across the gap. A path left with one point goes; a closed one left with
        two opens. */
    function deleteSelected() {
      if (!sel) return false;
      const it = sel.it;
      X.snapshot();
      const gone = [];
      Object.keys(sel.m).forEach(function (i) {
        const idx = +i, s = it.shapes[idx];
        if (!editable(s)) return;
        const P = anchorsOf(s), ks = sel.m[i];
        const left = P.A.filter(function (_, k) { return ks.indexOf(k) < 0; });
        if (left.length < 2) { gone.push(idx); return; }
        store(s, left, P.closed && left.length >= 3);
      });
      gone.sort(function (a, b) { return b - a; }).forEach(function (idx) { it.shapes.splice(idx, 1); });
      clearSel();
      focus = null;
      if (S.sel && S.sel.it === it) { S.sel = null; S.multi = null; }
      X.drawShapes(it); done(it); X.syncMarkPop();
      return true;
    }
    function nudgeSelected(dx, dy) {
      if (!sel) return false;
      const it = sel.it;
      X.snapshot();
      Object.keys(sel.m).forEach(function (i) {
        const s = it.shapes[+i];
        if (!editable(s)) return;
        const P = anchorsOf(s);
        G.moveAnchors(P.A, sel.m[i], dx, dy);
        store(s, P.A, P.closed);
      });
      X.drawShapes(it); done(it);
      return true;
    }
    /** Corner or Smooth for the selected anchors. */
    function convertSelected(to) {
      if (!sel) { X.toast('Select one or more points with Direct Selection (A) first', true); return; }
      const it = sel.it;
      X.snapshot();
      Object.keys(sel.m).forEach(function (i) {
        const s = it.shapes[+i];
        if (!editable(s)) return;
        const P = anchorsOf(s);
        sel.m[i].forEach(function (k) { if (to === 'corner') G.makeCorner(P.A, k); else G.makeSmooth(P.A, k, P.closed); });
        store(s, P.A, P.closed);
      });
      X.drawShapes(it); done(it);
    }

    /* the Pen paths (and lines that can become one) a whole-path operation
       works on: the selected anchors' paths, else the marks selected with
       Select, else the path in hand */
    const JOINABLE = { pen: 1, line: 1, poly: 1 };
    function pathsInHand() {
      if (sel) return { it: sel.it, idx: Object.keys(sel.m).map(Number) };
      if (S.sel && S.sel.it) {
        const it = S.sel.it, idx = X.selList().filter(function (i) { const s = it.shapes[i]; return s && JOINABLE[s.t] && !s.locked && !s.hide; });
        if (idx.length) return { it: it, idx: idx };
      }
      if (focus && editable(focus.it.shapes[focus.idx])) return { it: focus.it, idx: [focus.idx] };
      return null;
    }
    /** A mark's anchors, a Line or Continuous Line read as a Pen path. */
    function asAnchors(s) {
      if (s.t === 'pen') return s.pts ? G.fromPts(s.pts, s.open) : null;
      const pts = asPen(s);
      return pts ? G.fromPts(pts) : null;
    }
    function selectAll(it, idx) {
      const P = anchorsOf(it.shapes[idx]), m = {};
      m[idx] = P.A.map(function (_, k) { return k; });
      setSel(it, m);
    }

    /** Join, as Illustrator's (Ctrl+J): two open paths joined at their
        nearest ends (or at the two ends selected), into the first one's look
        and place; one open path closed. */
    function joinPaths() {
      const h = pathsInHand();
      if (!h) { X.toast('Select two open paths, or the two end points to join, then Join (Ctrl+J)', true); return; }
      const it = h.it;
      const open = h.idx.filter(function (i) { const P = asAnchors(it.shapes[i]); return P && !P.closed && P.A.length >= 2; });
      if (open.length === 1) { closePaths(); return; }
      if (open.length !== 2) { X.toast(open.length ? 'Join takes two open paths at a time' : 'These paths are closed already', true); return; }
      const ia = open[0], ib = open[1];
      const Pa = asAnchors(it.shapes[ia]), Pb = asAnchors(it.shapes[ib]);
      /* the ends: the ones selected, else the nearest pair */
      let endA = null, endB = null;
      if (sel && sel.it === it) {
        const sa = selOn(it, ia), sb = selOn(it, ib);
        if (sa.length === 1 && (sa[0] === 0 || sa[0] === Pa.A.length - 1)) endA = sa[0] === 0 ? 0 : 1;
        if (sb.length === 1 && (sb[0] === 0 || sb[0] === Pb.A.length - 1)) endB = sb[0] === 0 ? 0 : 1;
      }
      if (endA === null || endB === null) {
        let bd = Infinity;
        [0, 1].forEach(function (ea) {
          [0, 1].forEach(function (eb) {
            const pa = ea ? Pa.A[Pa.A.length - 1].p : Pa.A[0].p, pb = eb ? Pb.A[Pb.A.length - 1].p : Pb.A[0].p;
            const d = dist(pa, pb);
            if (d < bd && (endA === null || endA === ea) && (endB === null || endB === eb)) { bd = d; endA = ea; endB = eb; }
          });
        });
      }
      X.snapshot();
      const keep = Math.min(ia, ib), drop = Math.max(ia, ib);
      const first = keep === ia ? { P: Pa, end: endA } : { P: Pb, end: endB };
      const second = keep === ia ? { P: Pb, end: endB } : { P: Pa, end: endA };
      const A = G.join(first.P.A, first.end, second.P.A, second.end);
      becomePen(it, keep, A, false);
      it.shapes.splice(drop, 1);
      afterPathOp(it, keep, 'Joined into one path');
    }
    /** Close each open path in hand. */
    function closePaths() {
      const h = pathsInHand();
      if (!h) { X.toast('Select an open path to close', true); return; }
      const it = h.it;
      let n = 0, last = -1;
      const todo = h.idx.filter(function (i) { const P = asAnchors(it.shapes[i]); return P && !P.closed; });
      if (!todo.length) { X.toast('Already closed', true); return; }
      X.snapshot();
      todo.forEach(function (i) {
        const P = asAnchors(it.shapes[i]), A = G.copyA(P.A);
        if (!G.close(A)) return;
        becomePen(it, i, A, true);
        n++; last = i;
      });
      if (!n) { X.toast('A path needs three points, or a curve, to close', true); return; }
      afterPathOp(it, last, n > 1 ? n + ' paths closed' : 'Path closed');
    }
    /** Reverse each path in hand: its start becomes its end. */
    function reversePaths() {
      const h = pathsInHand();
      if (!h) { X.toast('Select a path to reverse', true); return; }
      const it = h.it;
      X.snapshot();
      h.idx.forEach(function (i) {
        const P = asAnchors(it.shapes[i]);
        if (!P) return;
        const A = G.copyA(P.A);
        G.reverse(A);
        becomePen(it, i, A, P.closed);
      });
      clearSel();
      afterPathOp(it, h.idx[0], 'Path direction reversed');
    }
    /** Cut at the selected point (one): a closed path opens there, an open
        one becomes two. */
    function cutSelected() {
      if (!sel || selCount() !== 1) { X.toast('Select one point on a path to cut it there', true); return; }
      const it = sel.it, idx = +Object.keys(sel.m)[0], k = sel.m[idx][0];
      const s = it.shapes[idx], P = anchorsOf(s);
      const parts = G.cutAt(P.A, P.closed, k);
      if (!parts) { X.toast('That is already an end of the path', true); return; }
      X.snapshot();
      store(s, parts[0], false);
      if (parts[1]) {
        const s2 = Object.assign({}, s);
        store(s2, parts[1], false);
        delete s2.grp;
        it.shapes.splice(idx + 1, 0, s2);
      }
      clearSel();
      afterPathOp(it, idx, parts[1] ? 'Path cut in two' : 'Path opened');
    }
    function afterPathOp(it, idx, msg) {
      focus = editable(it.shapes[idx]) ? { it: it, idx: idx } : null;
      if (S.tool === 'select' && it.shapes[idx]) X.setGroup(it, [idx]);
      X.drawShapes(it); done(it); X.syncMarkPop();
      paintBar();
      if (msg) X.toast(msg, true);
    }

    /* ---------------- Direct Selection's own hooks (js/vertex.js) ---------------- */

    X.penEdit = {
      down: function (it, at, e) { return editDown(it, at, e, 'direct'); },
      move: editMove,
      up: editUp,
      busy: function () { return !!edit; },
      /** the press found nothing to edit: a box drawn to select anchors */
      marquee: function (it, at, e) {
        const p = pdfOf(it, at);
        edit = { kind: 'marquee', it: it, from: p, to: p, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey,
                 base: e.shiftKey && sel && sel.it === it ? JSON.parse(JSON.stringify(sel.m)) : null };
        try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        return true;
      },
      hover: function (it, at) {
        const hit = hitAt(it, pdfOf(it, at));
        setHover(it, hit);
        return !!hit;
      },
      addAt: function (it, at) {
        const p = pdfOf(it, at), list = order(it, focus && focus.it === it ? focus.idx : null);
        for (let n = 0; n < list.length; n++) {
          const s = it.shapes[list[n]];
          const h = G.nearest(s.pts, p, tol(PX.path));
          if (!h) continue;
          X.snapshot();
          const P = anchorsOf(s), k = G.splitSeg(P.A, h.k, h.t);
          store(s, P.A, P.closed);
          focus = { it: it, idx: list[n] };
          const m = {}; m[list[n]] = [k]; setSel(it, m);
          X.drawShapes(it); done(it);
          return true;
        }
        return false;
      },
      deleteAt: function (it, at) {
        const hit = hitAt(it, pdfOf(it, at));
        if (!hit || hit.kind !== 'anchor') return false;
        const s = it.shapes[hit.idx], P = anchorsOf(s);
        if (P.A.length <= (P.closed ? 3 : 2)) {
          X.toast(P.closed ? 'A closed path needs at least three points' : 'A path needs at least two points', true);
          return true;
        }
        X.snapshot();
        G.removeAnchors(P.A, P.closed, [hit.k]);
        store(s, P.A, P.closed);
        focus = { it: it, idx: hit.idx };
        clearSel();
        X.drawShapes(it); done(it);
        return true;
      },
      clear: function () {
        const its = [focus && focus.it, sel && sel.it, hov && hov.it].filter(Boolean);
        focus = null; sel = null; hov = null; edit = null;
        paintBar();
        its.forEach(function (it, i) { if (its.indexOf(it) === i) X.drawShapes(it); });
      },
      redraw: drawOverlay,
      curveAt: curveAt,
      selected: function () { return selCount(); },
      deleteSelected: deleteSelected
    };
    function setHover(it, hit) {
      const next = hit ? { it: it, idx: hit.idx, kind: hit.kind, k: hit.k, side: hit.side } : null;
      const key = function (h) { return h ? [h.idx, h.kind, h.k, h.side].join(':') : ''; };
      if (key(next) === key(hov) && (!next || hov.it === it)) return;
      const was = hov && hov.it;
      hov = next;
      if (was && was !== it) drawOverlay(was);
      drawOverlay(it);
    }

    /* ---------------- double-click on a point (Direct Selection) ----------------
       Any line, rectangle or Continuous Line becomes a Pen path (its straight
       sides kept straight), and the point double-clicked turns smooth; a
       smooth point of a Pen path turns back into a corner. */
    function asPen(s) {
      let Q;
      if (s.t === 'pen') return s.pts;
      if (s.t === 'line') Q = [s.a, s.b];
      else if (s.t === 'rect') { const q = X.rectCorners(s); Q = [q[0], q[1], q[2], q[3], q[0]]; }
      else if (s.t === 'poly') Q = s.pts;
      else return null;
      if (!Q || Q.length < 2) return null;
      const pts = [Q[0].slice()];
      for (let k = 1; k < Q.length; k++) pts.push(Q[k - 1].slice(), Q[k].slice(), Q[k].slice());
      return pts;
    }
    function curveAt(it, idx, k) {
      const s0 = it.shapes[idx];
      if (!s0 || s0.hide || s0.locked) return false;
      const pts0 = asPen(s0);
      if (!pts0 || pts0.length < 4) return false;
      X.snapshot();
      const P = G.fromPts(copy(pts0), s0.t === 'pen' && s0.open);
      const kk = Math.min(k, P.A.length - 1);
      const a = P.A[kk];
      if (s0.t === 'pen' && G.kind(a) === 'smooth') G.makeCorner(P.A, kk);
      else G.makeSmooth(P.A, kk, P.closed);
      becomePen(it, idx, P.A, P.closed);
      if (S.tool !== 'vdirect') X.setTool('vdirect');
      focus = { it: it, idx: idx };
      const m = {}; m[idx] = [kk]; setSel(it, m);
      X.drawShapes(it); done(it);
      return true;
    }

    /* ---------------- the Pen tool: drawing ---------------- */

    let draw = null;     /* {it, A, idx (a path carried on), join, drag, at, redo} */

    /* open ends: a Pen path's, a Line's or a Continuous Line's (not an arrow's,
       whose end is its head) */
    function openEnds(s) {
      if (!s || !JOINABLE[s.t] || s.hide || s.locked) return null;
      if (s.t === 'line') return s.a && s.b ? [s.a, s.b] : null;
      const Q = s.pts;
      if (!Q || Q.length < (s.t === 'pen' ? 4 : 2)) return null;
      if (s.t === 'pen' ? closed(Q, s.open) : (Q.length > 2 && dist(Q[0], Q[Q.length - 1]) < G.EPS)) return null;
      return [Q[0], Q[Q.length - 1]];
    }
    /** the open end within reach of p (not mark `skip`'s): {idx, end: 0 | 1, p} */
    function endAt(it, p, skip) {
      for (let i = it.shapes.length - 1; i >= 0; i--) {
        if (i === skip) continue;
        const E2 = openEnds(it.shapes[i]);
        if (!E2) continue;
        for (let k = 0; k < 2; k++) if (dist(E2[k], p) <= tol(PX.anchor)) return { idx: i, end: k, p: E2[k] };
      }
      return null;
    }
    /** a drawing's anchors, the given end first */
    function anchorsFrom(s, end) {
      const A = G.fromPts(copy(asPen(s)), s.t === 'pen' && s.open).A;
      if (end === 1) G.reverse(A);
      return A;
    }

    /* how a new path looks: the tool's colour and width, and the Pen's own
       fill and line style (the Pen bar) */
    const PREF = 'adpdf.pen';
    const look = (function () {
      try { const v = JSON.parse(localStorage.getItem(PREF) || 'null'); if (v) return { fill: v.fill || null, d: v.d | 0 }; } catch (e) { /* the default */ }
      return { fill: null, d: 0 };
    })();
    function saveLook() { try { localStorage.setItem(PREF, JSON.stringify(look)); } catch (e) { /* this session only */ } }
    function newMark(pts) {
      const m = { t: 'pen', pts: pts, c: S.color, w: S.width };
      if (look.fill) m.fill = look.fill;
      if (look.d) m.d = look.d;
      return m;
    }

    function ghostPts(extra) {
      const pts = G.toPts(draw.A, false);
      if (extra && draw.A.length) {
        const last = draw.A[draw.A.length - 1];
        pts.push(last.hout.slice(), extra.slice(), extra.slice());
      }
      return pts;
    }
    /* the path so far and the next segment to the pointer, in the path's own
       look, with its points and the handles of the last one */
    function paintDraw(extra, closing) {
      const it = draw.it;
      const pts = ghostPts(extra);
      const ghost = pts.length >= 4 ? Object.assign(newMark(pts), draw.idx != null && it.shapes[draw.idx] ? lookOf(it.shapes[draw.idx]) : {}) : null;
      X.drawShapes(it, ghost || undefined);
      if (!it.anno || !it.vp) return;
      const vp = it.vp, v = function (q) { return vp.convertToViewportPoint(q[0], q[1]); };
      const g = el('g', {}, 'penov');
      const A = draw.A;
      if (pts.length >= 4) g.appendChild(el('path', { d: X.penD(pts, vp) }, 'penline'));
      if (A.length) {
        const last = A[A.length - 1];
        ['hin', 'hout'].forEach(function (side) {
          if (A.length === 1 && side === 'hin' && !draw.drag) return;
          if (side === 'hin' ? !G.hasIn(last) : !G.hasOut(last)) return;
          const P0 = v(last.p), H = v(last[side]);
          g.appendChild(el('line', { x1: P0[0], y1: P0[1], x2: H[0], y2: H[1] }, 'penhl'));
          g.appendChild(el('circle', { cx: H[0], cy: H[1], r: 3.5 }, 'penh'));
        });
      }
      A.forEach(function (a, k) {
        g.appendChild(anchorEl(v(a.p), G.kind(a), k === A.length - 1, false, k === 0 && !!closing));
      });
      it.anno.appendChild(g);
    }
    /* a path carried on keeps its own look while it is drawn */
    function lookOf(s) {
      const o = { c: s.c, w: s.w };
      ['fill', 'd', 'o', 'nos', 'grad', 'cap', 'j'].forEach(function (k) { if (s[k] !== undefined) o[k] = s[k]; });
      return o;
    }
    /* level, plumb or 45° from the point before, with Shift */
    function constrain(p, e) {
      if (!e || !e.shiftKey || !draw || !draw.A.length) return p;
      return X.snapLine(draw.A[draw.A.length - 1].p, p);
    }
    function hintDrawing() {
      $('modeHint').innerHTML = 'Click for a corner, drag for a curve (<b>Alt</b> breaks the handles, <b>Space</b> moves the point). ' +
        'Click the last point to take its handle in; click the first to close. <b>Enter</b> or <b>Esc</b> ends the path, <b>Ctrl+Z</b> takes back a point.';
    }
    function finish(close) {
      if (!draw) return;
      const d = draw;
      draw = null;
      const it = d.it;
      let made = null;
      if (d.A.length >= 2) {
        X.snapshot();
        if (d.idx != null && it.shapes[d.idx]) {
          /* a Line or Continuous Line carried on is a Pen path now, its look kept */
          becomePen(it, d.idx, d.A, close);
        } else {
          const m = newMark([]);
          store(m, d.A, close);
          it.shapes.push(m);
          d.idx = it.shapes.length - 1;
        }
        /* the drawing joined onto is part of this path now */
        if (d.join != null && d.join !== d.idx && it.shapes[d.join]) {
          it.shapes.splice(d.join, 1);
          if (d.idx > d.join) d.idx--;
        }
        made = d.idx;
        done(it);
      }
      /* the path just drawn stays in hand, its points showing */
      focus = made != null ? { it: it, idx: made } : null;
      clearSel();
      X.drawShapes(it);
      $('modeHint').innerHTML = X.hints.pen;
    }
    function takeBack() {
      if (!draw) return false;
      draw.redo = draw.redo || [];
      draw.redo.push(draw.A.pop());
      if (!draw.A.length) {
        const it = draw.it; draw = null; X.drawShapes(it); $('modeHint').innerHTML = X.hints.pen;
        return true;
      }
      paintDraw();
      return true;
    }
    function putBack() {
      if (!draw || !draw.redo || !draw.redo.length) return false;
      draw.A.push(draw.redo.pop());
      paintDraw();
      return true;
    }

    X.tools.pen = {
      colors: true, widths: true,
      down: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        const raw = pdfOf(it, at);
        if (!draw) {
          const hit = hitAt(it, raw);
          /* a handle showing: bend the curve (Alt: that handle alone) */
          if (hit && hit.kind === 'handle' && editDown(it, at, e, 'pen')) return;
          /* Alt on a point: convert it (a click: corner; a drag: smooth handles) */
          if (hit && hit.kind === 'anchor' && e.altKey && editDown(it, at, e, 'pen')) return;
          /* an open end: the drawing carries on from it, it becomes the last point */
          const end = !e.altKey ? endAt(it, raw, null) : null;
          if (end) {
            draw = { it: it, A: anchorsFrom(it.shapes[end.idx], 1 - end.end), idx: end.idx, drag: null, join: null };
            focus = null; clearSel();
            $('modeHint').innerHTML = 'Carrying the path on: click for a corner, drag for a curve. Click another open end to join them; <b>Enter</b> ends it.';
            paintDraw();
            return;
          }
          /* on a path, off its points: a point added there (Illustrator's Pen does) */
          if (hit && hit.kind === 'path' && !e.altKey) {
            X.penEdit.addAt(it, at);
            return;
          }
          /* on another path's anchor: a new path starts exactly there */
          const fromAnchor = hit && hit.kind === 'anchor' ? anchorsOf(it.shapes[hit.idx]).A[hit.k].p : null;
          focus = null; clearSel(); hov = null;
          draw = { it: it, A: [], idx: null, drag: null, join: null, at: fromAnchor ? fromAnchor.slice() : null };
          hintDrawing();
        }
        if (draw.it !== it) { finish(false); return; }
        draw.redo = null;
        const A = draw.A;
        /* the first point: the path closes there (its handle can still be pulled) */
        if (A.length >= 2 && dist(raw, A[0].p) <= tol(PX.close)) {
          draw.drag = { k: 0, x: e.clientX, y: e.clientY, close: true, moved: false };
          try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
          return;
        }
        /* the last point again: a click takes its handle in, a drag pulls a
           new one out on its own (the one coming in kept) */
        if (A.length >= 1 && dist(raw, A[A.length - 1].p) <= tol(PX.anchor)) {
          draw.drag = { k: A.length - 1, x: e.clientX, y: e.clientY, last: true, moved: false };
          try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
          return;
        }
        /* another drawing's open end: the two join into one path */
        if (A.length >= 1 && !e.altKey) {
          const j = endAt(it, raw, draw.idx);
          if (j) {
            draw.A = A.concat(anchorsFrom(it.shapes[j.idx], j.end));
            draw.join = j.idx;
            it.capture.style.cursor = '';
            finish(false);
            return;
          }
        }
        /* a new point: on the anchor it was started on, else where the snaps
           catch it, else (Shift) level, plumb or 45° from the last */
        const startAt = draw.at && !A.length ? draw.at : null;
        draw.at = null;
        const snapped = startAt || (X.snapPt && !e.shiftKey ? X.snapPt(it, raw, e) : null);
        const p = snapped || constrain(raw, e);
        A.push({ p: p, hin: p.slice(), hout: p.slice() });
        draw.drag = { k: A.length - 1, x: e.clientX, y: e.clientY, moved: false };
        try { it.capture.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        paintDraw();
      },
      move: function (it, at, e) {
        if (!it.vp) return;
        if (editMove(it, at, e)) return;
        const raw = pdfOf(it, at);
        if (draw && draw.it === it && draw.drag) {
          const dg = draw.drag;
          if (!dg.moved && Math.hypot(e.clientX - dg.x, e.clientY - dg.y) < 3) return;
          const a = draw.A[dg.k];
          if (space && !dg.close) {
            /* Space: the point itself moves, its handles with it */
            if (dg.spaceFrom) {
              const dx = raw[0] - dg.spaceFrom[0], dy = raw[1] - dg.spaceFrom[1];
              a.p = [a.p[0] + dx, a.p[1] + dy];
              a.hin = [a.hin[0] + dx, a.hin[1] + dy];
              a.hout = [a.hout[0] + dx, a.hout[1] + dy];
            }
            dg.spaceFrom = raw;
            dg.moved = true;
            paintDraw();
            return;
          }
          dg.spaceFrom = null;
          dg.moved = true;
          let q = raw;
          if (e.shiftKey) q = X.snapLine(a.p, q);
          if (dg.close) {
            /* closing: the first point's handles, the one coming in under the pointer */
            if (e.altKey) a.hin = [2 * a.p[0] - q[0], 2 * a.p[1] - q[1]];
            else { a.hin = [2 * a.p[0] - q[0], 2 * a.p[1] - q[1]]; a.hout = q; }
          } else if (dg.last || e.altKey || dg.broken) {
            /* a handle out on its own: the one coming in stays */
            if (e.altKey) dg.broken = true;
            a.hout = q;
          } else {
            G.pullHandles(draw.A, dg.k, q);
          }
          paintDraw();
          return;
        }
        if (draw && draw.it === it) {
          const A = draw.A;
          const near = A.length >= 2 && dist(raw, A[0].p) <= tol(PX.close);
          const onLast = !near && A.length >= 1 && dist(raw, A[A.length - 1].p) <= tol(PX.anchor);
          const join = !near && !onLast && !e.altKey ? endAt(it, raw, draw.idx) : null;
          it.capture.style.cursor = near ? 'var(--cur-pen-close)' : join ? 'var(--cur-pen-join)' : onLast ? 'var(--cur-pen-conv)' : '';
          const snapped = !near && !join && !onLast && !e.shiftKey && X.snapPt ? X.snapPt(it, raw, e) : null;
          const to = near ? A[0].p : join ? join.p : onLast ? null : (snapped || constrain(raw, e));
          soon(function () { if (draw && draw.it === it && !draw.drag) paintDraw(to, near); });
          return;
        }
        /* not drawing: what a click would do, and the points under the pointer */
        const hit = hitAt(it, raw);
        const end = !e.altKey && !(hit && hit.kind === 'handle') ? endAt(it, raw, null) : null;
        it.capture.style.cursor = end ? 'var(--cur-pen-cont)'
          : !hit ? ''
          : hit.kind === 'path' ? 'var(--cur-pen-add)'
          : hit.kind === 'anchor' ? (e.altKey ? 'var(--cur-pen-conv)' : '')
          : 'var(--cur-direct-point)';
        setHover(it, hit);
      },
      up: function (it, at) {
        if (editUp(it)) return;
        if (!draw || draw.it !== it || !draw.drag) return;
        const dg = draw.drag;
        draw.drag = null;
        if (dg.close) { finish(true); return; }
        if (dg.last && !dg.moved) {
          /* a click on the last point: its handle out taken back in */
          const a = draw.A[dg.k];
          a.hout = a.p.slice();
        }
        paintDraw(dg.last ? null : pdfOf(it, at));
      },
      cancel: function () {
        if (draw) finish(false);
        X.penEdit.clear();
      }
    };

    /* ---------------- Convert Anchor Point ---------------- */

    X.tools.vconv = {
      down: function (it, at, e) {
        if (!it.vp || (e && e.button > 0)) return;
        editDown(it, at, e, 'convert');
      },
      move: function (it, at, e) {
        if (!it.vp) return;
        if (editMove(it, at, e)) return;
        const hit = hitAt(it, pdfOf(it, at));
        setHover(it, hit);
      },
      up: function (it) { editUp(it); },
      cancel: function () { X.penEdit.clear(); }
    };

    /* ---------------- keys ---------------- */

    /* Space while a point is being dragged out moves the point (as in
       Illustrator), not the page: ahead of Space-to-pan (js/navigate.js) */
    let space = false;
    ['keydown', 'keyup'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (e.key !== ' ' && e.code !== 'Space') return;
        if (S.tool !== 'pen' || !draw || !draw.drag) { if (type === 'keyup') space = false; return; }
        space = type === 'keydown';
        e.preventDefault(); e.stopImmediatePropagation();
      }, true);
    });
    window.addEventListener('blur', function () { space = false; });

    window.addEventListener('keydown', function (e) {
      if (typing(e.target) || S.editing || !S.items.length) return;
      const mod = e.ctrlKey || e.metaKey;
      const stop = function () { e.preventDefault(); e.stopImmediatePropagation(); };
      /* while a path is being drawn */
      if (S.tool === 'pen' && draw) {
        if (!mod && (e.key === 'Enter' || e.key === 'Escape')) { stop(); finish(false); return; }
        if (!mod && e.key === 'Backspace') { stop(); takeBack(); return; }
        if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { stop(); takeBack(); return; }
        if (mod && !e.altKey && (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y')) { stop(); putBack(); return; }
        return;
      }
      /* Join (Ctrl+J), as Illustrator's */
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        if (pathsInHand()) { stop(); joinPaths(); }
        return;
      }
      /* the tools: P Pen, A Direct Selection, Shift+C Convert Anchor Point; Ctrl+0 fits the page (P did) */
      if (mod && !e.altKey && !e.shiftKey && e.key === '0') { stop(); if (X.fitPage) X.fitPage(); return; }
      if (mod || e.altKey) return;
      if (e.key === 'p' && !e.shiftKey) { stop(); X.setTool('pen'); return; }
      if (e.key === 'a' && !e.shiftKey) { stop(); X.setTool('vdirect'); return; }
      if ((e.key === 'C' || e.key === 'c') && e.shiftKey) { stop(); X.setTool('vconv'); return; }
      /* the selected anchors: Delete, the arrow keys, Esc */
      if (!PEN_TOOLS[S.tool] || !sel) {
        if (PEN_TOOLS[S.tool] && e.key === 'Escape' && (focus || hov)) { stop(); X.penEdit.clear(); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { stop(); deleteSelected(); return; }
      if (e.key === 'Escape') { stop(); X.penEdit.clear(); return; }
      if (/^Arrow/.test(e.key)) {
        stop();
        const it = sel.it, vp = it.vp;
        if (!vp) return;
        /* a step of one point (ten with Shift) the way the arrow points on screen */
        const step = (e.shiftKey ? 10 : 1) * S.scale;
        const sx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const sy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const o = vp.convertToPdfPoint(0, 0), q = vp.convertToPdfPoint(sx, sy);
        nudgeSelected(q[0] - o[0], q[1] - o[1]);
      }
    }, true);

    X.on('tool', function (t) {
      if (t !== 'pen' && draw) finish(false);
      if (!PEN_TOOLS[t]) X.penEdit.clear();
      else S.items.forEach(function (it) { if (it.anno && (focus || sel)) drawOverlay(it); });
      S.items.forEach(function (it) { if (it.capture && t !== 'pen' && t !== 'vdirect') it.capture.style.cursor = ''; });
      paintBar();
    });
    X.on('reset', function () { focus = null; sel = null; hov = null; edit = null; draw = null; });
    /* undo and redo put back an older list of marks: the selection follows */
    X.on('meta', function () { if (!edit) selValid(); });

    /* ---------------- the Path bar, and a Pen path's properties ---------------- */

    const ICON = {
      corner: '<path d="M5 19L12 5l7 14"/><rect x="10" y="3" width="4" height="4" fill="currentColor"/>',
      smooth: '<path d="M4 18c3-12 13-12 16 0"/><circle cx="12" cy="9" r="2" fill="currentColor"/><path d="M6 9h12"/>',
      join: '<path d="M4 17c2-6 4-8 7-8M20 17c-2-6-4-8-7-8"/><circle cx="12" cy="9" r="1.8" fill="currentColor"/>',
      close: '<path d="M7 18L4 9l8-5 8 5-3 9"/><path d="M7 18h10" stroke-dasharray="2 2"/>',
      cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 16.5L17 5M16 16.5L7 5"/>',
      reverse: '<path d="M4 9h14l-3-3M20 15H6l3 3"/>',
      del: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'
    };
    const ACTIONS = [
      ['corner', 'Convert the selected points to corners', 'Corner', function () { convertSelected('corner'); }],
      ['smooth', 'Convert the selected points to smooth', 'Smooth', function () { convertSelected('smooth'); }],
      ['join', 'Join two open paths, or close one (Ctrl+J)', 'Join', joinPaths],
      ['close', 'Close the path', 'Close', closePaths],
      ['cut', 'Cut the path at the selected point', 'Cut', cutSelected],
      ['reverse', 'Reverse the path’s direction', 'Reverse', reversePaths],
      ['del', 'Delete the selected points (Delete)', 'Delete points', deleteSelected]
    ];
    function buttons(prefix) {
      return ACTIONS.map(function (a) {
        return '<button type="button" class="penbtn" data-pa="' + a[0] + '" id="' + prefix + a[0] + '" title="' + a[1] +
          '" aria-label="' + a[1] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[a[0]] + '</svg><span>' + a[2] + '</span></button>';
      }).join('');
    }
    function run(name) { const a = ACTIONS.filter(function (x) { return x[0] === name; })[0]; if (a) a[3](); }

    /* under the ribbon, with the Pen and the point tools: the new path's
       fill and line style, then the work on points and paths */
    const bar = document.createElement('div');
    bar.className = 'txctl anno-ctl penbar'; bar.id = 'penBar'; bar.hidden = true;
    bar.innerHTML =
      '<span class="penlook" id="penLook">' +
        '<span class="anno-lbl">Fill</span>' +
        '<button type="button" class="cbtn" id="penFillBtn" title="Fill of new paths" aria-haspopup="true"><i id="penFillChip"></i><b>▾</b></button>' +
        '<span class="anno-lbl">Line</span>' +
        '<select id="penDash" aria-label="Line style of new paths"><option value="0">━━━</option><option value="1">━ ━ ━</option><option value="2">· · · ·</option></select>' +
        '<span class="sep"></span>' +
      '</span>' +
      '<span class="anno-lbl" id="penSelLbl">Points</span>' + buttons('penB_');
    const modeBar = $('modeBar');
    if (modeBar) modeBar.insertBefore(bar, $('pinShowList') || null);
    bar.addEventListener('click', function (e) {
      const b = e.target.closest('[data-pa]');
      if (b && !b.disabled) run(b.dataset.pa);
    });
    $('penDash').addEventListener('change', function () { look.d = +this.value; saveLook(); });
    const pal = document.createElement('div');
    pal.className = 'swpop palette'; pal.id = 'penFillPal'; pal.hidden = true;
    document.body.appendChild(pal);
    $('penFillBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!pal.hidden) { pal.hidden = true; return; }
      pal.innerHTML = '';
      const none = document.createElement('button');
      none.type = 'button'; none.className = 'pnofill' + (look.fill ? '' : ' on');
      none.title = 'No fill'; none.setAttribute('aria-label', 'No fill');
      none.addEventListener('click', function (ev) { ev.stopPropagation(); look.fill = null; saveLook(); paintBar(); pal.hidden = true; });
      pal.appendChild(none);
      if (X.buildPalette) X.buildPalette(pal, look.fill, function (c) { look.fill = c; saveLook(); paintBar(); pal.hidden = true; });
      pal.hidden = false;
      const r = this.getBoundingClientRect();
      pal.style.left = Math.max(8, Math.min(window.innerWidth - pal.offsetWidth - 8, r.left)) + 'px';
      pal.style.top = Math.min(window.innerHeight - pal.offsetHeight - 8, r.bottom + 6) + 'px';
    });
    document.addEventListener('click', function (e) { if (!pal.hidden && !pal.contains(e.target)) pal.hidden = true; });

    function paintBar() {
      bar.hidden = !PEN_TOOLS[S.tool];
      if (bar.hidden) return;
      $('penLook').hidden = S.tool !== 'pen';
      $('penFillChip').className = look.fill ? '' : 'none';
      $('penFillChip').style.background = look.fill || '';
      $('penDash').value = String(look.d);
      const n = selCount(), h = pathsInHand();
      $('penSelLbl').textContent = n ? (n === 1 ? '1 point' : n + ' points') : 'Points';
      const set = function (name, on) { const b = $('penB_' + name); if (b) b.disabled = !on; };
      set('corner', n > 0); set('smooth', n > 0); set('del', n > 0); set('cut', n === 1);
      set('join', !!h); set('close', !!h); set('reverse', !!h);
    }

    /* a Pen path selected with Select: its path work in its properties */
    const sec = document.createElement('div');
    sec.className = 'mppath';
    sec.innerHTML = '<span class="mpverts-lbl">Path</span>' +
      ['join', 'close', 'reverse'].map(function (k) {
        const a = ACTIONS.filter(function (x) { return x[0] === k; })[0];
        return '<button type="button" class="penbtn" data-pa="' + k + '" title="' + a[1] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' +
          ICON[k] + '</svg><span>' + a[2] + '</span></button>';
      }).join('') +
      '<button type="button" class="penbtn" data-pa="edit" title="Edit its points: Direct Selection (A)"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M5.5 3.5l13 8-5.8 1.5-3.3 5.3z" fill="currentColor"/></svg><span>Edit points</span></button>';
    sec.addEventListener('click', function (e) {
      const b = e.target.closest('[data-pa]');
      if (!b) return;
      if (b.dataset.pa === 'edit') {
        const it = S.sel && S.sel.it, idx = S.sel && S.sel.i;
        X.setTool('vdirect');
        if (it && editable(it.shapes[idx])) { focus = { it: it, idx: idx }; selectAll(it, idx); X.drawShapes(it); }
        return;
      }
      run(b.dataset.pa);
    });
    if (!X.markPop.pen) X.markPop.pen = { el: sec, sync: function () {} };

    /* ---------------- the buttons, on the Tools tab ---------------- */

    const T = {
      t: 'pen', id: 'tPen', label: 'Pen', key: 'P',
      hint: 'Click for a corner point, drag for a curve: the drag pulls the point\'s direction handles out. ' +
            'Click the first point to close the path; <b>Enter</b> or <b>Esc</b> ends it. On a path: click to add a point; ' +
            '<b>Alt</b> and a click on a point converts it. A click on any shape\'s anchor starts a new path from it.',
      /* the same nib as Add and Delete Anchor Point (js/vertex.js), without their + and − */
      path: '<path d="M3.5 20.5l2.3-7.6 6.4-6.4 5.3 5.3-6.4 6.4z"/><path d="M3.5 20.5l5-5"/>' +
        '<circle cx="9.6" cy="14.4" r="1.3"/><path d="M12.2 6.5l2.4-2.4 5.3 5.3-2.4 2.4"/>'
    };
    const C = {
      t: 'vconv', id: 'tVxConv', label: 'Convert Anchor Point', key: 'Shift+C',
      hint: 'Click a <b>point</b> to make it a corner; drag from it to pull smooth handles out; drag a handle to move it on its own. ' +
            'Works on Pen paths, and on a line, rectangle or Continuous Line\'s corners.',
      path: '<path d="M4 20L12 5l8 15"/><path d="M12 5l-3 0" /><rect x="10.3" y="3.3" width="3.4" height="3.4" fill="currentColor"/>'
    };
    [T, C].forEach(function (D) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = D.id; b.type = 'button';
      b.title = D.label + ' (' + D.key + ')';
      b.setAttribute('aria-label', D.label);
      b.dataset.label = D.label;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + D.path + '</svg>';
      b.addEventListener('click', function () { X.toggleTool(D.t); });
      if ($('grpTools')) $('grpTools').appendChild(b);
      X.toolBtn[D.t] = D.id;
      X.hints[D.t] = D.hint;
    });
    paintBar();
  });
})();
