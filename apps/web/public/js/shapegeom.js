/* Add Dots PDF — the Shape Builder's geometry
   ------------------------------------------
   Plain functions, with no page around them (the tests run them as they
   are), for the Shape Builder tool (js/shapebuilder.js) and Pathfinder's
   Divide (js/arrange.js).

   Shapes come in as areas: polygon-clipping's MultiPolygon (a list of
   polygons, each an outer ring and its holes, a ring a list of [x, y]), in
   PDF points, curves already flattened into short straight steps. The
   boolean work itself (where edges cross, cutting them there, joining the
   pieces into a planar graph and tracing its faces back into rings) is
   polygon-clipping's sweep line (js/vendor/polygon-clipping.umd.min.js, MIT),
   handed in as PC, the same engine Pathfinder uses.

   regions(PC, items) cuts the shapes into the areas the eye sees where
   they overlap — Illustrator's "regions" — each with the shapes that cover
   it. The Shape Builder's three operations then work on a choice of those
   regions:
     merge     the regions joined into one new shape, no edges left between
               them; every shape they came out of keeps the rest of itself
     subtract  the regions taken out of every shape that covers them
     divide    every region a shape of its own
   Each answers with what to do to each shape (keep, replace, remove) and
   any new shapes, for the page to apply as one undo step. */
(function (root) {
  'use strict';

  const EPS_AREA = 1e-3;                  /* pt²: anything smaller is rounding, not a region */

  /* ---------------- rings and areas ---------------- */

  /** A ring's signed area (shoelace); the closing point may or may not repeat. */
  function ringArea(r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  /** A polygon's area: its outer ring less its holes. */
  function polyArea(poly) {
    let a = 0;
    poly.forEach(function (r, k) { a += k === 0 ? Math.abs(ringArea(r)) : -Math.abs(ringArea(r)); });
    return Math.max(0, a);
  }
  function multiArea(mp) {
    let a = 0;
    (mp || []).forEach(function (p) { a += polyArea(p); });
    return a;
  }
  function boxOf(mp) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    (mp || []).forEach(function (poly) {
      (poly[0] || []).forEach(function (p) {
        if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
        if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
      });
    });
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }
  function boxesMeet(a, b) { return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2; }

  /** Rings taken together even-odd (the way the page fills a shape with
      several rings: one inside another is a hole), as one area. */
  function areaOfRings(PC, rings) {
    const R = (rings || []).filter(function (r) { return r && r.length >= 3; })
      .map(function (r) { return [r.map(function (p) { return [+p[0], +p[1]]; })]; });
    if (!R.length) return [];
    return R.length === 1 ? clean(PC.union(R[0])) : clean(PC.xor.apply(null, R));
  }
  /** Without the specks and slivers rounding leaves behind. */
  function clean(mp) {
    return (mp || []).filter(function (p) { return p && p[0] && p[0].length >= 3 && polyArea(p) > EPS_AREA; });
  }

  /** Is the point inside the polygon (its outer ring, not in a hole)? */
  function inRing(r, x, y) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPoly(poly, x, y) {
    if (!poly.length || !inRing(poly[0], x, y)) return false;
    for (let k = 1; k < poly.length; k++) if (inRing(poly[k], x, y)) return false;
    return true;
  }

  /* ---------------- regions ---------------- */

  /**
   * The regions of overlapping shapes. items: [{ id, area }] back to front
   * (area a MultiPolygon). Each region is one connected piece of the plane
   * that the same shapes cover: { poly, cover: [ids, back to front], top,
   * box, area }. Built one shape at a time: each region so far is cut into
   * what the new shape covers and what it does not, and the new shape adds
   * what no region had. A region that cannot meet the new shape (their
   * boxes are apart) is passed over untouched.
   */
  function regions(PC, items) {
    let parts = [];                                       /* { mp, cover, box } */
    items.forEach(function (item) {
      const A = clean(item.area);
      if (!A.length) return;
      const box = boxOf(A);
      const next = [], met = [];
      parts.forEach(function (r) {
        if (!boxesMeet(r.box, box)) { next.push(r); return; }
        const inn = clean(PC.intersection(r.mp, A));
        if (!inn.length) { next.push(r); return; }
        met.push(r.mp);
        next.push({ mp: inn, cover: r.cover.concat([item.id]), box: boxOf(inn) });
        const out = clean(PC.difference(r.mp, A));
        if (out.length) next.push({ mp: out, cover: r.cover, box: boxOf(out) });
      });
      const fresh = met.length ? clean(PC.difference.apply(null, [A].concat(met))) : A;
      if (fresh.length) next.push({ mp: fresh, cover: [item.id], box: boxOf(fresh) });
      parts = next;
    });
    /* each connected piece a region of its own */
    const out = [];
    parts.forEach(function (r) {
      r.mp.forEach(function (poly) {
        out.push({ poly: poly, cover: r.cover, top: r.cover[r.cover.length - 1], box: boxOf([poly]), area: polyArea(poly) });
      });
    });
    return out;
  }

  /** The region under a point, or -1. Regions do not overlap; at a shared
      edge the smaller one is taken. */
  function regionAt(regs, x, y) {
    let best = -1, bestA = Infinity;
    for (let i = 0; i < regs.length; i++) {
      const g = regs[i], b = g.box;
      if (x < b.x1 || x > b.x2 || y < b.y1 || y > b.y2) continue;
      if (g.area < bestA && inPoly(g.poly, x, y)) { best = i; bestA = g.area; }
    }
    return best;
  }

  /* ---------------- operations ---------------- */

  function unionOf(PC, polys) {
    if (!polys.length) return [];
    if (polys.length === 1) return clean([polys[0]]);
    return clean(PC.union.apply(null, polys.map(function (p) { return [p]; })));
  }
  function idsIn(regs, picked) {
    const ids = [];
    picked.forEach(function (i) { regs[i].cover.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    return ids;
  }
  /** Every shape the picked regions came out of, less the area U. */
  function rests(PC, items, ids, U) {
    const out = {};
    items.forEach(function (item) {
      if (ids.indexOf(item.id) < 0) return;
      out[item.id] = clean(PC.difference(item.area, U));
    });
    return out;
  }

  /**
   * Merge: the picked regions (indices into regs) as one new shape, with
   * the look of `from` (the shape on top where the drag began). Answers
   * { changed: { id: area | [] (removed) }, added: [{ area, from }] }, or
   * null when nothing would change: a whole shape on its own, picked as it
   * is.
   */
  function merge(PC, items, regs, picked, from) {
    picked = uniq(picked);
    if (!picked.length) return null;
    const U = unionOf(PC, picked.map(function (i) { return regs[i].poly; }));
    if (!U.length) return null;
    const ids = idsIn(regs, picked);
    const changed = rests(PC, items, ids, U);
    if (ids.length === 1 && !changed[ids[0]].length) return null;
    return { changed: changed, added: [{ area: U, from: from == null ? regs[picked[0]].top : from }] };
  }

  /** Subtract: the picked regions taken out of every shape covering them. */
  function subtract(PC, items, regs, picked) {
    picked = uniq(picked);
    if (!picked.length) return null;
    const U = unionOf(PC, picked.map(function (i) { return regs[i].poly; }));
    if (!U.length) return null;
    return { changed: rests(PC, items, idsIn(regs, picked), U), added: [] };
  }

  /**
   * Divide: every region a shape of its own, with the look of the shape on
   * top of it. A shape no other one overlaps stays as it is.
   */
  function divide(PC, items, regs) {
    const touched = {};
    const count = {};
    regs.forEach(function (g) {
      g.cover.forEach(function (id) { count[id] = (count[id] || 0) + 1; });
      if (g.cover.length > 1) g.cover.forEach(function (id) { touched[id] = 1; });
    });
    Object.keys(count).forEach(function (id) { if (count[id] > 1) touched[id] = 1; });
    const changed = {}, added = [];
    items.forEach(function (item) { if (touched[item.id]) changed[item.id] = []; });
    if (!Object.keys(changed).length) return null;
    /* back to front by the shape whose look each piece takes */
    const order = items.map(function (item) { return item.id; });
    regs.map(function (g, i) { return i; })
      .filter(function (i) { return touched[regs[i].top]; })
      .sort(function (a, b) { return order.indexOf(regs[a].top) - order.indexOf(regs[b].top) || a - b; })
      .forEach(function (i) { added.push({ area: [regs[i].poly], from: regs[i].top }); });
    return { changed: changed, added: added };
  }

  function uniq(a) { return a.filter(function (v, k) { return a.indexOf(v) === k; }); }

  /* ---------------- back to a path ---------------- */

  /** An area as a compound path (the app's vpath): k the commands, one M,
      L…, Z a ring, pts their points, in PDF points. */
  function toPath(mp) {
    let k = '';
    const pts = [];
    (mp || []).forEach(function (poly) {
      poly.forEach(function (ring) {
        let r = ring;
        const a = r[0], z = r[r.length - 1];
        if (r.length > 1 && a[0] === z[0] && a[1] === z[1]) r = r.slice(0, -1);
        r = dropCollinear(r);
        if (r.length < 3) return;
        k += 'M' + new Array(r.length).join('L') + 'Z';
        r.forEach(function (p) { pts.push([round(p[0]), round(p[1])]); });
      });
    });
    return pts.length ? { k: k, pts: pts } : null;
  }
  function round(v) { return Math.round(v * 1e4) / 1e4; }
  /** Points that lie on the straight line between their neighbours add nothing. */
  function dropCollinear(r) {
    if (r.length < 4) return r;
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[(i + r.length - 1) % r.length], q = r[i], s = r[(i + 1) % r.length];
      const cross = (q[0] - p[0]) * (s[1] - q[1]) - (q[1] - p[1]) * (s[0] - q[0]);
      const len = Math.hypot(s[0] - p[0], s[1] - p[1]) || 1;
      if (Math.abs(cross) / len > 1e-6) out.push(q);
    }
    return out.length >= 3 ? out : r;
  }

  root.ADDSHAPEGEOM = {
    regions: regions, regionAt: regionAt,
    merge: merge, subtract: subtract, divide: divide,
    areaOfRings: areaOfRings, toPath: toPath,
    multiArea: multiArea, polyArea: polyArea, boxOf: boxOf, inPoly: inPoly
  };
})(typeof window !== 'undefined' ? window : this);
