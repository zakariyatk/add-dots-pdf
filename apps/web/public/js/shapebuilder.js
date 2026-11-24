/* Add Dots PDF — the Shape Builder tool (Shift+M)
   ----------------------------------------------
   Illustrator's Shape Builder, on the closed shapes selected (boxes,
   circles, clouds, closed Continuous Line and Pen paths, shapes from Edit
   Object and Pathfinder, compound ones with holes):

   • the selected shapes are cut into the regions the eye sees where they
     overlap (js/shapegeom.js); the region under the pointer is shaded
   • click a region: it comes out as a shape of its own
   • drag across regions: they are merged into one shape, with no edges left
     between them; the shapes they came out of keep the rest of themselves
   • Alt (the pointer shows a minus): click or drag to take regions away
   • the drag is drawn as a line, the regions it has gathered shaded; letting
     go makes the change, one undo step; Esc while dragging drops it
   • Esc (or V, or another tool) puts the tool down

   The merged shape takes the look (fill, outline, opacity, gradient) of the
   shape on top where the drag began, as Illustrator's "pick colour from
   artwork" does; what is left of each shape keeps its own. A shape no
   region touched stays exactly as it was. The new shapes are the app's
   compound path (vpath), edited, saved and undone like any other.

   Pathfinder's Divide (js/arrange.js) uses divideSelected() here: every
   region of the selected shapes a shape of its own. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[shapebuilder] core bridge missing'); return; }

  const ICON = '<path d="M3.5 3.5h9v9h-9z"/><circle cx="14" cy="14" r="6.5"/><path d="M8.5 9.5l3 2.4M6.3 13.6l3-2.1" stroke-width="1.4"/>';
  /* the geometry is fine enough that a curve reads as a curve at any zoom
     the app has, the way the saved PDF already writes them */
  const ELLIPSE_STEPS = 192;

  X.on('ready', function () {
    const S = X.S, $ = X.$, SVGNS = X.SVGNS;
    const E = window.ADDPDFEngine;
    const G = window.ADDSHAPEGEOM;
    const stage = $('stage');
    if (!G || !stage) return;
    const PC = function () { return window.polygonClipping; };

    /* ---------------- the shapes, as areas ---------------- */

    function cubicTo(out, p0, p1, p2, p3) {
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
        Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
      const n = Math.max(8, Math.min(96, Math.ceil(len / 2)));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
      }
    }
    /** A closed shape's outline rings, in PDF points; null for anything else. */
    function rings(s) {
      if (!s || !X.closedShape(s)) return null;
      if (s.t === 'rect' && E.rectRounded(s)) return [E.rectRing(s, 12).slice(0, -1)];
      if (s.t === 'rect') return [X.rectCorners(s).map(function (p) { return [p[0], p[1]]; })];
      if (s.t === 'ellipse') return [E.ellipsePts(s, ELLIPSE_STEPS)];
      if (s.t === 'cloud') return [E.cloudPts(s, 8)];
      if (s.t === 'poly') return [s.pts.map(function (p) { return [p[0], p[1]]; })];
      if (s.t === 'pen') {
        const P = s.pts, out = [[P[0][0], P[0][1]]];
        for (let i = 1; i + 2 < P.length; i += 3) cubicTo(out, P[i - 1], P[i], P[i + 1], P[i + 2]);
        return [out];
      }
      if (s.t === 'vpath' && s.k && s.pts) {
        const P = s.pts, all = [];
        let cur = null, j = 0;
        for (const c of s.k) {
          if (c === 'M') { cur = [P[j++].slice()]; all.push(cur); }
          else if (c === 'L') { if (cur) cur.push(P[j].slice()); j++; }
          else if (c === 'C') { if (cur) cubicTo(cur, cur[cur.length - 1], P[j], P[j + 1], P[j + 2]); j += 3; }
        }
        return all.filter(function (r) { return r.length >= 3; });
      }
      return null;
    }

    /** What the tool works on: the closed shapes selected, on one page. */
    function targets() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it || !S.sel.it.shapes) return null;
      const it = S.sel.it;
      const idx = X.selList().filter(function (i) {
        const s = it.shapes[i];
        return s && !s.locked && !s.hide && X.closedShape(s);
      }).sort(function (a, b) { return a - b; });
      return idx.length ? { it: it, idx: idx } : null;
    }

    /* The regions, worked out once for the shapes as they are and kept until
       one of them changes (moved, edited, undone) or the selection does. */
    let cache = null;          /* { it, key, items, regs, paths: { scale, rot, d: [] } } */
    /* a fingerprint of where the shapes are, cheap enough for every move of
       the pointer: a move, resize, turn or point edit changes one of these */
    function geomKey(it, idx) {
      return idx.map(function (i) {
        const s = it.shapes[i], P = s.pts;
        return i + ':' + s.t + ':' + (s.a || '') + ':' + (s.b || '') + ':' + (s.r || 0) + ':' +
          (P ? P.length + ':' + P[0] + ':' + P[P.length >> 1] + ':' + P[P.length - 1] : '') + ':' + (s.k || '');
      }).join('|') + '#' + it.shapes.length;
    }
    function current() {
      const t = targets();
      if (!t) { cache = null; return null; }
      const key = geomKey(t.it, t.idx);
      if (cache && cache.it === t.it && cache.key === key) return cache;
      const items = [];
      t.idx.forEach(function (i) {
        const R = rings(t.it.shapes[i]);
        if (!R || !R.length) return;
        const area = G.areaOfRings(PC(), R);
        if (area.length) items.push({ id: i, area: area });
      });
      let regs = [];
      try { regs = G.regions(PC(), items); } catch (e) { console.error('[shapebuilder]', e); regs = []; }
      cache = { it: t.it, key: key, items: items, regs: regs, paths: null };
      return cache;
    }

    /* ---------------- on screen ---------------- */

    let on = false;
    let alt = false;
    let hover = -1;
    let drag = null;           /* { c, id, picked: [], from, trail: [[x, y] view], last: [x, y] client, alt } */

    function pdfAt(it, x, y) {
      const r = it.anno.getBoundingClientRect();
      return it.vp.convertToPdfPoint(x - r.left, y - r.top);
    }
    function viewAt(it, x, y) {
      const r = it.anno.getBoundingClientRect();
      return [x - r.left, y - r.top];
    }
    /** A region as an SVG path on the page as it is shown now (kept per zoom). */
    function regionD(c, i) {
      const vp = c.it.vp;
      if (!c.paths || c.paths.vp !== vp) c.paths = { vp: vp, d: [] };
      if (c.paths.d[i] != null) return c.paths.d[i];
      let d = '';
      c.regs[i].poly.forEach(function (ring) {
        ring.forEach(function (p, k) {
          const v = vp.convertToViewportPoint(p[0], p[1]);
          d += (k ? 'L' : 'M') + v[0].toFixed(2) + ' ' + v[1].toFixed(2);
        });
        d += 'Z';
      });
      c.paths.d[i] = d;
      return d;
    }

    /* the overlay: a group of its own on the page's annotation layer, put
       back after every redraw of the marks, changed in place as the pointer
       moves (no redraw of the marks for a hover) */
    let layer = null;
    function ensureLayer(it) {
      if (!it || !it.anno) return null;
      if (!layer) {
        layer = document.createElementNS(SVGNS, 'g');
        layer.setAttribute('class', 'sbann');
        layer.innerHTML = '<defs><pattern id="sbHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
          '<rect width="6" height="6" class="sbhatchbg"/><line x1="0" y1="0" x2="0" y2="6" class="sbhatch"/></pattern>' +
          '<pattern id="sbHatchMinus" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
          '<rect width="6" height="6" class="sbhatchbg minus"/><line x1="0" y1="0" x2="0" y2="6" class="sbhatch minus"/></pattern></defs>' +
          '<g class="sbregs"></g><path class="sbtrail"/>';
      }
      if (layer.parentNode !== it.anno) it.anno.appendChild(layer);
      return layer;
    }
    function clearLayer() {
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    }
    function paintOverlay() {
      const c = cache;
      if (!on || !c || !c.it.anno || !c.it.vp) { clearLayer(); return; }
      const L = ensureLayer(c.it);
      const minus = drag ? drag.alt : alt;
      const show = drag ? drag.picked : (hover >= 0 ? [hover] : []);
      let h = '';
      show.forEach(function (i) {
        if (!c.regs[i]) return;
        h += '<path class="sbreg' + (minus ? ' minus' : '') + '" fill-rule="evenodd" d="' + regionD(c, i) + '"/>';
      });
      L.querySelector('.sbregs').innerHTML = h;
      const tr = L.querySelector('.sbtrail');
      if (drag && drag.trail.length > 1) {
        tr.setAttribute('d', 'M' + drag.trail.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L'));
        tr.setAttribute('class', 'sbtrail' + (minus ? ' minus' : ''));
      } else tr.removeAttribute('d');
    }
    /* core redraws a page's marks by emptying its layer: put the overlay back */
    X.afterDraw.push(function (it) {
      if (on && cache && cache.it === it) { layer = null; paintOverlay(); }
    });

    function setHover(i) {
      if (i === hover) return;
      hover = i;
      paintOverlay();
    }
    function setAlt(v) {
      v = !!v;
      if (v === alt) return;
      alt = v;
      document.body.classList.toggle('sb-minus', on && alt);
      paintOverlay();
    }

    /* ---------------- the pointer ---------------- */

    function regionUnder(c, x, y) {
      const p = pdfAt(c.it, x, y);
      return G.regionAt(c.regs, p[0], p[1]);
    }
    function inPage(it, e) {
      const r = it.anno.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    document.addEventListener('pointermove', function (e) {
      if (!on) return;
      if (e.altKey !== alt && !drag) setAlt(e.altKey);
      if (drag) { dragTo(e); return; }
      const c = current();
      if (!c || !c.it.anno || !c.it.vp || !inPage(c.it, e)) { setHover(-1); return; }
      setHover(regionUnder(c, e.clientX, e.clientY));
    }, { passive: true });

    stage.addEventListener('pointerdown', function (e) {
      if (!on || e.button !== 0 || e.ctrlKey || e.metaKey || S.editing) return;
      const tg = e.target;
      if (tg.closest && tg.closest('input, textarea, select, button, a, .markpop')) return;
      const c = current();
      if (!c || !c.it.anno || !c.it.vp || !inPage(c.it, e)) return;
      /* the page with the shapes on it is the tool's: nothing there moves or
         changes selection while the Shape Builder is up */
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const i = regionUnder(c, e.clientX, e.clientY);
      drag = {
        c: c, id: e.pointerId, alt: e.altKey, picked: i >= 0 ? [i] : [],
        from: i >= 0 ? c.regs[i].top : null,
        trail: [viewAt(c.it, e.clientX, e.clientY)], last: [e.clientX, e.clientY]
      };
      setAlt(e.altKey);
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a mouse works without it */ }
      paintOverlay();
    }, true);

    /* the click that follows a press is the tool's too: core would read it
       as a click on empty page and drop the selection */
    ['click', 'dblclick', 'mousedown', 'mouseup'].forEach(function (type) {
      stage.addEventListener(type, function (e) {
        if (!on || e.button !== 0) return;
        const c = cache;
        if (!c || !c.it.anno || !inPage(c.it, e)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      }, true);
    });

    /* every region the drag passes over, in steps of a few pixels between
       one pointer event and the next, so a quick drag misses none */
    function dragTo(e) {
      const d = drag;
      if (e.pointerId !== d.id) return;
      const c = d.c;
      const x0 = d.last[0], y0 = d.last[1], x1 = e.clientX, y1 = e.clientY;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
      for (let k = 1; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
        const i = regionUnder(c, x, y);
        if (i >= 0 && d.picked.indexOf(i) < 0) {
          d.picked.push(i);
          if (d.from == null) d.from = c.regs[i].top;
        }
      }
      d.last = [x1, y1];
      d.trail.push(viewAt(c.it, x1, y1));
      paintOverlay();
    }

    function endDrag(e, cancel) {
      const d = drag;
      if (!d || (e && e.pointerId !== d.id)) return;
      drag = null;
      try { stage.releasePointerCapture(d.id); } catch (err) { /* already let go */ }
      if (cancel || !d.picked.length) { paintOverlay(); return; }
      let res = null;
      try {
        res = d.alt ? G.subtract(PC(), d.c.items, d.c.regs, d.picked)
          : G.merge(PC(), d.c.items, d.c.regs, d.picked, d.from);
      } catch (err) {
        console.error('[shapebuilder]', err);
        X.toast('The Shape Builder could not work out that shape');
      }
      if (res) apply(d.c.it, res);
      hover = -1;
      paintOverlay();
    }
    document.addEventListener('pointerup', function (e) { if (drag) endDrag(e, false); });
    document.addEventListener('pointercancel', function (e) { if (drag) endDrag(e, true); });

    /* ---------------- making the change ---------------- */

    /* everything about a mark that is not where it is: its look, layer, group */
    const GEOM = { t: 1, a: 1, b: 1, r: 1, pts: 1, k: 1, patch: 1 };
    function pathMark(area, src) {
      const path = G.toPath(area);
      if (!path) return null;
      const m = { t: 'vpath', k: path.k, pts: path.pts };
      Object.keys(src).forEach(function (key) {
        if (!GEOM[key] && src[key] !== undefined) m[key] = src[key];
      });
      if (m.grad) m.grad = JSON.parse(JSON.stringify(m.grad));
      if (m.c == null) m.c = '#000000';
      if (m.w == null) m.w = 1;
      return m;
    }

    /**
     * The change from js/shapegeom.js on page it, as one undo step: each
     * shape changed is put back as what is left of it (or taken away), each
     * new shape goes in just above the shape whose look it took. What comes
     * out is left selected, as Illustrator leaves it.
     */
    function apply(it, res) {
      const before = it.shapes;
      const after = [], picked = [];
      const addedAt = {};
      res.added.forEach(function (a) { (addedAt[a.from] = addedAt[a.from] || []).push(a); });
      const made = [];
      for (let i = 0; i < before.length; i++) {
        const s = before[i];
        if (Object.prototype.hasOwnProperty.call(res.changed, i)) {
          const m = res.changed[i].length ? pathMark(res.changed[i], s) : null;
          if (m) { picked.push(after.length); after.push(m); made.push(m); }
        } else {
          if (cache && cache.items.some(function (x) { return x.id === i; })) picked.push(after.length);
          after.push(s);
        }
        (addedAt[i] || []).forEach(function (a) {
          const m = pathMark(a.area, s);
          if (m) { picked.push(after.length); after.push(m); made.push(m); }
        });
      }
      X.snapshot();
      it.shapes = after;
      cache = null;
      if (picked.length) X.setGroup(it, picked);
      else { S.sel = null; S.multi = null; }
      X.drawShapes(it);
      X.drawThumb(it);
      X.updateMeta();
      X.syncMarkPop();
      return made.length;
    }

    /** Pathfinder's Divide: every region of the selected shapes its own shape. */
    function divideSelected() {
      if (!window.polygonClipping) { X.toast('Pathfinder could not load: reload the page'); return false; }
      const c = current();
      if (!c || c.items.length < 2) { X.toast('Select two or more closed shapes to divide'); return false; }
      let res = null;
      try { res = G.divide(PC(), c.items, c.regs); } catch (e) { console.error('[divide]', e); }
      if (!res) { X.toast('The shapes do not overlap: nothing to divide'); return false; }
      const n = res.added.length;
      apply(c.it, res);
      X.toast('Divided into ' + n + ' shapes');
      return true;
    }

    /* ---------------- picking it up and putting it down ---------------- */

    const btn = document.createElement('button');
    btn.className = 'btn'; btn.id = 'tShapeBuilder'; btn.type = 'button';
    btn.title = 'Shape Builder (Shift+M)'; btn.setAttribute('aria-label', 'Shape Builder');
    btn.dataset.label = 'Shape Builder';
    btn.innerHTML = '<svg viewBox="0 0 24 24">' + ICON + '</svg>';
    if ($('grpTools')) $('grpTools').appendChild(btn);

    function paintBtns() {
      document.querySelectorAll('#tShapeBuilder, #qtShapeBuilder').forEach(function (b) {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      document.body.classList.toggle('shapebuilder-mode', on);
      document.body.classList.toggle('sb-minus', on && alt);
      if (X.paintMove) X.paintMove();
    }
    function setOn(v) {
      if (v === on) return;
      if (v) {
        if (X.rotateTool && X.rotateTool.on()) X.rotateTool.set(false);
        if (X.gradientTool && X.gradientTool.on()) X.gradientTool.set(false);
        /* keep what is selected across the change to Select (setTool drops it) */
        const keep = S.sel ? { sel: S.sel, multi: S.multi } : null;
        if (S.tool !== 'select') X.setTool('select');
        if (keep && !S.sel) { S.sel = keep.sel; S.multi = keep.multi; }
        on = true;
        X.emit('modetool', 'shapebuilder');
        if (!targets()) X.toast('Select the closed shapes to build with (boxes, circles, closed paths), then drag across their regions');
      } else {
        on = false;
        drag = null; hover = -1; alt = false;
        clearLayer();
      }
      paintBtns();
      X.redrawAll();
      paintOverlay();
    }
    X.shapeBuilder = {
      on: function () { return on; }, set: setOn,
      divideSelected: divideSelected,
      /* for the tests: the regions of what is selected now */
      regions: function () { const c = current(); return c ? c.regs : []; }
    };
    btn.addEventListener('click', function () { setOn(!on); });
    X.on('tool', function () { if (on) setOn(false); });
    X.on('modetool', function (which) { if (which !== 'shapebuilder' && on) setOn(false); });

    /* Shift+M picks it up with closed shapes selected (with none, core's
       Shift+M still does what it did); Esc drops a drag, or puts the tool
       down, as V does. Alt shows the minus. Ahead of core's own keys. */
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Alt' && on) { e.preventDefault(); setAlt(true); return; }
      if (e.target.matches && e.target.matches('input,textarea,select,[contenteditable],[contenteditable] *')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !S.items.length || S.editing) return;
      if ((e.key === 'M' || e.key === 'm') && e.shiftKey && (on || targets())) {
        e.preventDefault(); e.stopImmediatePropagation();
        setOn(!on);
      } else if (on && e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (drag) { drag = null; paintOverlay(); } else setOn(false);
      } else if (on && e.key === 'v' && !e.shiftKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        setOn(false);
      }
    }, true);
    window.addEventListener('keyup', function (e) {
      if (e.key === 'Alt' && on) { e.preventDefault(); if (!drag) setAlt(false); }
    }, true);
    window.addEventListener('blur', function () { if (on && !drag) setAlt(false); });

    paintBtns();
  });
})();
