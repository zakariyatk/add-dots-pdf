/* Add Dots PDF — Align and Pathfinder
   -----------------------------------
   Two sections at the foot of the selected mark's properties (core's
   #markPop, docked in the Properties panel on the right), as Illustrator
   has them:

   Align   — left, centre, right, top, middle, bottom, and distribute the
             centres across or down. With several marks selected they line
             up on the selection's own box; with one, on the page. A group
             (Ctrl+G) moves as one piece. Directions are as the page is seen,
             whatever its turn.
   Pathfinder — Unite, Minus Front, Intersect, Exclude and Divide on two or more
             closed shapes (box, circle, a closed Continuous Line or Pen
             path, a shape from Edit Object). The result is one shape (a
             vpath, saved by the engine's painters/vpath.ts) in place of
             them. Unite, Intersect and Exclude take the front shape's look,
             Minus Front the back one's, as in Illustrator. Divide cuts
             them into every region they make, each a shape of its own
             (js/shapebuilder.js).

   The boolean maths is polygon-clipping (js/vendor/polygon-clipping.umd.min.js,
   MIT); curves are flattened into short straight steps first. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[arrange] core bridge missing'); return; }

  const ICONS = {
    al: '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
    ac: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
    ar: '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
    at: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
    am: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
    ab: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
    dh: '<rect x="3" y="7" width="4" height="10" rx="1"/><rect x="10" y="7" width="4" height="10" rx="1"/><rect x="17" y="7" width="4" height="10" rx="1"/><path d="M5 4v2M12 4v2M19 4v2"/>',
    dv: '<rect x="7" y="3" width="10" height="4" rx="1"/><rect x="7" y="10" width="10" height="4" rx="1"/><rect x="7" y="17" width="10" height="4" rx="1"/><path d="M4 5h2M4 12h2M4 19h2"/>',
    pu: '<path d="M3 3h11v6h7v12H10v-6H3z" fill="currentColor" fill-opacity=".85"/>',
    pm: '<path d="M3 3h11v6h-4v6H3z" fill="currentColor" fill-opacity=".85"/><rect x="10" y="9" width="11" height="12" fill="none"/>',
    pi: '<rect x="3" y="3" width="11" height="12" fill="none" stroke-dasharray="2 2"/><rect x="10" y="9" width="11" height="12" fill="none" stroke-dasharray="2 2"/><rect x="10" y="9" width="4" height="6" fill="currentColor" fill-opacity=".85"/>',
    pd: '<path d="M3 3h11v6H10v6H3z" fill="currentColor" fill-opacity=".85"/><path d="M14 9h7v12H10v-6h4z" fill="currentColor" fill-opacity=".45"/><rect x="10" y="9" width="4" height="6" fill="currentColor" fill-opacity=".65"/><path d="M10 9h4v6h-4z"/>',
    px: '<path d="M3 3h11v6h-4v6H3z" fill="currentColor" fill-opacity=".85"/><path d="M14 9h7v12H10v-6h4z" fill="currentColor" fill-opacity=".85"/><rect x="10" y="9" width="4" height="6" fill="none"/>'
  };
  function btn(id, title, icon) {
    return '<button class="btn arbtn" type="button" data-ar="' + id + '" title="' + title + '" aria-label="' + title + '">' +
      '<svg viewBox="0 0 24 24">' + ICONS[icon] + '</svg></button>';
  }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pop = $('markPop');
    if (!pop) return;

    const sec = document.createElement('div');
    sec.className = 'mparr'; sec.id = 'mpArrange';
    sec.innerHTML =
      '<div class="arsec" id="arAlign">' +
        '<div class="arhd">Align</div>' +
        '<div class="arrow" role="group" aria-label="Align">' +
          btn('left', 'Horizontal align left', 'al') +
          btn('hcenter', 'Horizontal align centre', 'ac') +
          btn('right', 'Horizontal align right', 'ar') +
          btn('top', 'Vertical align top', 'at') +
          btn('vcenter', 'Vertical align centre', 'am') +
          btn('bottom', 'Vertical align bottom', 'ab') +
        '</div>' +
        '<div class="arrow" role="group" aria-label="Distribute" id="arDist">' +
          btn('dh', 'Horizontal distribute centre', 'dh') +
          btn('dv', 'Vertical distribute centre', 'dv') +
        '</div>' +
        '<div class="arnote" id="arTo"></div>' +
      '</div>' +
      '<div class="arsec" id="arPath">' +
        '<div class="arhd">Pathfinder</div>' +
        '<div class="arrow" role="group" aria-label="Pathfinder">' +
          btn('unite', 'Unite', 'pu') +
          btn('minus', 'Minus Front', 'pm') +
          btn('intersect', 'Intersect', 'pi') +
          btn('exclude', 'Exclude', 'px') +
          btn('divide', 'Divide: every overlapping region a shape of its own', 'pd') +
        '</div>' +
      '</div>';
    pop.appendChild(sec);

    /* ---------------- what is selected ---------------- */

    function selection() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it) return null;
      const it = S.sel.it;
      const idx = X.selList().filter(function (i) {
        const s = it.shapes[i];
        return s && !X.NOT_SELECTABLE[s.t] && s.t !== 'pin' && !s.locked;
      });
      return idx.length && it.vp ? { it: it, idx: idx } : null;
    }

    /* ---------------- Align ---------------- */

    /* a mark's box as it is seen on screen (viewport pixels) */
    function viewBox(vp, s) {
      const b = X.visBox(s);
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].forEach(function (p) {
        const v = vp.convertToViewportPoint(p[0], p[1]);
        x1 = Math.min(x1, v[0]); y1 = Math.min(y1, v[1]);
        x2 = Math.max(x2, v[0]); y2 = Math.max(y2, v[1]);
      });
      return { x1: x1, y1: y1, x2: x2, y2: y2 };
    }
    function union(bs) {
      return bs.reduce(function (u, b) {
        return { x1: Math.min(u.x1, b.x1), y1: Math.min(u.y1, b.y1), x2: Math.max(u.x2, b.x2), y2: Math.max(u.y2, b.y2) };
      }, { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
    }
    /* the pieces that move: a group's members together, anything else alone */
    function units(it, idx) {
      const out = [], byGrp = {};
      idx.forEach(function (i) {
        const g = it.shapes[i].grp;
        if (g == null) { out.push([i]); return; }
        if (!byGrp[g]) { byGrp[g] = []; out.push(byGrp[g]); }
        byGrp[g].push(i);
      });
      return out;
    }

    function r6(n) { return Math.round(n * 1e6) / 1e6; }
    function align(how) {
      const sel = selection();
      if (!sel) return;
      const it = sel.it, vp = it.vp;
      const U = units(it, sel.idx).map(function (ix) {
        return { ix: ix, b: union(ix.map(function (i) { return viewBox(vp, it.shapes[i]); })) };
      });
      const dist = how === 'dh' || how === 'dv';
      if (dist && U.length < 3) { X.toast('Select three or more objects to distribute them'); return; }
      /* one piece lines up on the page; several on their own box */
      const T = U.length > 1 ? union(U.map(function (u) { return u.b; }))
        : { x1: 0, y1: 0, x2: vp.width, y2: vp.height };
      const moves = [];
      if (dist) {
        const h = how === 'dh';
        const c = function (b) { return h ? (b.x1 + b.x2) / 2 : (b.y1 + b.y2) / 2; };
        const order = U.slice().sort(function (a, b) { return c(a.b) - c(b.b); });
        const c0 = c(order[0].b), c1 = c(order[order.length - 1].b);
        const step = (c1 - c0) / (order.length - 1);
        order.forEach(function (u, k) {
          const want = c0 + step * k, d = want - c(u.b);
          moves.push({ u: u, dx: h ? d : 0, dy: h ? 0 : d });
        });
      } else {
        U.forEach(function (u) {
          const b = u.b;
          let dx = 0, dy = 0;
          if (how === 'left') dx = T.x1 - b.x1;
          else if (how === 'right') dx = T.x2 - b.x2;
          else if (how === 'hcenter') dx = (T.x1 + T.x2) / 2 - (b.x1 + b.x2) / 2;
          else if (how === 'top') dy = T.y1 - b.y1;
          else if (how === 'bottom') dy = T.y2 - b.y2;
          else if (how === 'vcenter') dy = (T.y1 + T.y2) / 2 - (b.y1 + b.y2) / 2;
          moves.push({ u: u, dx: dx, dy: dy });
        });
      }
      if (!moves.some(function (m) { return Math.abs(m.dx) > 1e-6 || Math.abs(m.dy) > 1e-6; })) return;
      X.snapshot();
      /* screen pixels into page points, whatever the page's turn */
      const o = vp.convertToPdfPoint(0, 0);
      moves.forEach(function (m) {
        const p = vp.convertToPdfPoint(m.dx, m.dy);
        /* exact steps: the conversion's last-digit noise would build up */
        const mx = r6(p[0] - o[0]), my = r6(p[1] - o[1]);
        m.u.ix.forEach(function (i) {
          const s = it.shapes[i];
          X.moveShape(s, X.copyShape(s), mx, my);
        });
      });
      done(it);
    }

    /* ---------------- Pathfinder ---------------- */

    const STEPS = 16;                       /* straight steps per curve */
    function cubic(p0, p1, p2, p3, out) {
      for (let k = 1; k <= STEPS; k++) {
        const t = k / STEPS, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
      }
    }
    /* a closed shape as its outline rings, in PDF points; null when it is
       not a closed shape Pathfinder can work on */
    function rings(s) {
      if (s.t === 'rect') return [X.rectCorners(s)];
      if (s.t === 'ellipse') {
        const cx = (s.a[0] + s.b[0]) / 2, cy = (s.a[1] + s.b[1]) / 2;
        const rx = Math.abs(s.b[0] - s.a[0]) / 2, ry = Math.abs(s.b[1] - s.a[1]) / 2;
        const r = (s.r || 0) * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
        const out = [];
        for (let k = 0; k < 96; k++) {
          const t = k / 96 * Math.PI * 2, x = rx * Math.cos(t), y = ry * Math.sin(t);
          out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
        }
        return [out];
      }
      if (s.t === 'poly' && X.polyClosed && X.polyClosed(s)) return [s.pts.map(function (p) { return [p[0], p[1]]; })];
      if (s.t === 'pen' && X.penClosed && X.penClosed(s)) {
        const P = s.pts, out = [[P[0][0], P[0][1]]];
        for (let i = 1; i + 2 < P.length; i += 3) cubic(P[i - 1], P[i], P[i + 1], P[i + 2], out);
        return [out];
      }
      if (s.t === 'vpath' && s.k && s.pts) {
        const P = s.pts, all = [];
        let cur = null, j = 0;
        for (const c of s.k) {
          if (c === 'M') { cur = [P[j++].slice()]; all.push(cur); }
          else if (c === 'L' && cur) cur.push(P[j++].slice());
          else if (c === 'C' && cur) { cubic(cur[cur.length - 1], P[j], P[j + 1], P[j + 2], cur); j += 3; }
          else if (c === 'L' || c === 'C') j += c === 'L' ? 1 : 3;
        }
        return all.filter(function (r) { return r.length >= 3; });
      }
      return null;
    }
    /* a shape's area as polygon-clipping reads it: its rings taken together
       even-odd, the way the page fills them, so a ring inside another is a hole */
    function geom(s) {
      const R = rings(s);
      if (!R || !R.length) return null;
      const PC = window.polygonClipping;
      const polys = R.map(function (r) { return [r]; });
      return polys.length === 1 ? polys : PC.xor.apply(null, polys);
    }

    function pathfinder(op) {
      const PC = window.polygonClipping;
      if (!PC) { X.toast('Pathfinder could not load: reload the page'); return; }
      const sel = selection();
      if (!sel || sel.idx.length < 2) { X.toast('Select two or more shapes for Pathfinder'); return; }
      const it = sel.it;
      const idx = sel.idx.slice().sort(function (a, b) { return a - b; });   /* back to front */
      const G = idx.map(function (i) { return geom(it.shapes[i]); });
      if (G.some(function (g) { return !g; })) {
        X.toast('Pathfinder works on closed shapes: boxes, circles and closed paths');
        return;
      }
      let res;
      try {
        if (op === 'unite') res = PC.union.apply(null, G);
        else if (op === 'intersect') res = PC.intersection.apply(null, G);
        else if (op === 'exclude') res = PC.xor.apply(null, G);
        else res = PC.difference.apply(null, G);          /* minus front: the back one less the rest */
      } catch (e) {
        console.error('[pathfinder]', e);
        X.toast('Pathfinder could not work out that shape');
        return;
      }
      if (!res || !res.length) {
        X.toast(op === 'intersect' ? 'The shapes do not overlap: nothing in common' : 'Nothing is left of the shapes');
        return;
      }
      /* the look: the front shape's, or for Minus Front the back one's */
      const srcI = op === 'minus' ? idx[0] : idx[idx.length - 1];
      const src = it.shapes[srcI];
      let k = '';
      const pts = [];
      res.forEach(function (poly) {
        poly.forEach(function (ring) {
          let r = ring;
          const a = r[0], z = r[r.length - 1];
          if (r.length > 1 && a[0] === z[0] && a[1] === z[1]) r = r.slice(0, -1);
          if (r.length < 3) return;
          k += 'M' + new Array(r.length).join('L') + 'Z';
          r.forEach(function (p) { pts.push([p[0], p[1]]); });
        });
      });
      if (!pts.length) { X.toast('Nothing is left of the shapes'); return; }
      const mark = { t: 'vpath', k: k, pts: pts, c: src.c || '#000000', w: src.w == null ? 1 : src.w };
      ['fill', 'o', 'fo', 'nos', 'd', 'dash', 'cap', 'j', 'layer', 'hide'].forEach(function (key) {
        if (src[key] != null) mark[key] = src[key];
      });
      /* a box or circle that was never filled still shows as an outline,
         as Illustrator's result keeps the stroke it had */
      X.snapshot();
      const removedBefore = idx.filter(function (i) { return i < srcI; }).length;
      idx.slice().reverse().forEach(function (i) { it.shapes.splice(i, 1); });
      const at = srcI - removedBefore;
      it.shapes.splice(at, 0, mark);
      X.setGroup(it, [at]);
      done(it);
    }

    function done(it) {
      X.drawShapes(it);
      X.drawThumb(it);
      X.updateMeta();
      X.syncMarkPop();
      sync();
    }

    sec.addEventListener('click', function (e) {
      const b = e.target.closest('[data-ar]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      const a = b.dataset.ar;
      if (a === 'unite' || a === 'minus' || a === 'intersect' || a === 'exclude') pathfinder(a);
      else if (a === 'divide') { if (X.shapeBuilder) X.shapeBuilder.divideSelected(); }
      else align(a);
    });

    /* ---------------- which buttons apply ---------------- */

    function sync() {
      const sel = selection();
      if (!sel) return;
      const n = units(sel.it, sel.idx).length;
      $('arTo').textContent = n > 1 ? 'Aligns to the selection' : 'Aligns to the page';
      $('arDist').querySelectorAll('button').forEach(function (b) { b.disabled = n < 3; });
      const closed = sel.idx.length >= 2 && sel.idx.every(function (i) { return !!rings(sel.it.shapes[i]); });
      $('arPath').hidden = sel.idx.length < 2;
      $('arPath').querySelectorAll('button').forEach(function (b) { b.disabled = !closed; });
      $('arPath').title = closed ? '' : 'Pathfinder works on closed shapes: boxes, circles and closed paths';
    }
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(pop, { attributes: true, attributeFilter: ['hidden'] });
      if ($('mpTitle')) new MutationObserver(sync).observe($('mpTitle'), { childList: true, characterData: true, subtree: true });
    }
    document.addEventListener('pointerup', function () { setTimeout(sync, 0); });
    document.addEventListener('keyup', function () { setTimeout(sync, 0); });
    sync();
  });
})();
