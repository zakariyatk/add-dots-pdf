/* ---------------- object snap tracking ----------------
   Object snap catches points that are already there. Tracking makes new ones:
   rest on a snap point and it is *acquired*, which sends two dashed guides out
   from it — one across, one down. While a guide is live the pointer is caught
   along it, and where it crosses a ruler guide or one of the drawing's own
   lines. That is how you put a mark level with one thing and in line with
   another without drawing a scrap of construction geometry first.

   Everything here is plain geometry in viewport pixels, with no DOM and no
   reference to the viewer's state, so it can be tested on its own and so the
   tolerance stays in screen pixels at any zoom. js/draw.js converts the page's
   PDF points into pixels, hands them over, and converts the answer back. */
(function () {
  'use strict';

  /* Which catch wins when several are within reach: the same scale draw.js
     ranks its own snaps on, where a smaller number beats a larger one. A
     crossing is a real point, so it outranks lying somewhere along a guide. */
  var RANK = { tcross: 1, tseg: 1, ton: 2 };

  /** The two guides an acquired point sends out, in viewport pixels.
      `v` marks the upright one, and `at` is the pixel it sits on. */
  function guides(a) {
    return [{ v: 1, at: a[0] }, { v: 0, at: a[1] }];
  }

  /* A candidate is only worth offering when it is far enough from the acquired
     point itself to be a different answer — right next to it the ordinary
     endpoint snap is the better catch, and two markers on one pixel is noise. */
  function away(a, q, tol) {
    return Math.abs(q[0] - a[0]) > tol || Math.abs(q[1] - a[1]) > tol;
  }

  /** Lying along one of the guides: the pointer keeps its own position on the
      guide's free axis and takes the acquired point's on the other. */
  function onGuide(a, p, tol) {
    var out = [];
    if (Math.abs(p[1] - a[1]) <= tol) {
      var h = [p[0], a[1]];
      if (away(a, h, tol)) out.push({ p: h, kind: 'ton', label: 'Across', d: Math.abs(p[1] - a[1]), v: 0 });
    }
    if (Math.abs(p[0] - a[0]) <= tol) {
      var u = [a[0], p[1]];
      if (away(a, u, tol)) out.push({ p: u, kind: 'ton', label: 'In line', d: Math.abs(p[0] - a[0]), v: 1 });
    }
    return out;
  }

  /** Where a guide from the acquired point crosses a ruler guide. The rulers
      are upright and flat too, so each crossing is simply one pixel from each.
      `rulers` is [{v, at}] in viewport pixels, as js/rulers.js keeps them. */
  function guideCross(a, p, tol, rulers) {
    var out = [];
    if (!rulers || !rulers.length) return out;
    for (var i = 0; i < rulers.length; i++) {
      var g = rulers[i];
      /* a ruler guide parallel to the tracking guide never crosses it; the one
         at right angles crosses it exactly once */
      var q = g.v ? [g.at, a[1]] : [a[0], g.at];
      var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > tol || !away(a, q, tol)) continue;
      out.push({ p: q, kind: 'tcross', label: 'Guide crossing', d: d, v: g.v ? 0 : 1 });
    }
    return out;
  }

  /** Where a guide from the acquired point crosses one of the drawing's lines.
      Only the segments already under the pointer are passed in, so this stays
      a handful of sums however much geometry the page holds. Each segment is
      [[x1,y1],[x2,y2]] in viewport pixels. */
  function segCross(a, p, tol, segs) {
    var out = [];
    if (!segs || !segs.length) return out;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], s0 = s[0], s1 = s[1];
      var dx = s1[0] - s0[0], dy = s1[1] - s0[1];
      /* the flat guide y = a[1], then the upright one x = a[0] */
      if (Math.abs(dy) > 1e-9) {
        var t = (a[1] - s0[1]) / dy;
        if (t >= -1e-6 && t <= 1 + 1e-6) {
          var q = [s0[0] + t * dx, a[1]];
          var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d <= tol && away(a, q, tol)) {
            out.push({ p: q, kind: 'tseg', label: 'Guide meets line', d: d, v: 0 });
          }
        }
      }
      if (Math.abs(dx) > 1e-9) {
        var u = (a[0] - s0[0]) / dx;
        if (u >= -1e-6 && u <= 1 + 1e-6) {
          var r = [a[0], s0[1] + u * dy];
          var e = Math.hypot(r[0] - p[0], r[1] - p[1]);
          if (e <= tol && away(a, r, tol)) {
            out.push({ p: r, kind: 'tseg', label: 'Guide meets line', d: e, v: 1 });
          }
        }
      }
    }
    return out;
  }

  /** Every catch the acquired point offers for this pointer position, ranked.
      `o` may carry `rulers` and `segs`; both are optional. */
  function candidates(a, p, tol, o) {
    o = o || {};
    return onGuide(a, p, tol)
      .concat(guideCross(a, p, tol, o.rulers))
      .concat(segCross(a, p, tol, o.segs));
  }

  /** The best catch, or null. Rank first, then whichever is nearest. */
  function best(a, p, tol, o) {
    var all = candidates(a, p, tol, o), win = null;
    for (var i = 0; i < all.length; i++) {
      var c = all[i], r = RANK[c.kind];
      if (!win || r < RANK[win.kind] || (r === RANK[win.kind] && c.d < win.d)) win = c;
    }
    return win;
  }

  /** Which guides to draw: the one the catch is riding, or both while the
      pointer is off them. Keeps the screen quiet once a guide has been caught. */
  function live(hit) {
    if (!hit || hit.v === undefined) return { across: true, upright: true };
    return { across: hit.v === 0, upright: hit.v === 1 };
  }

  (typeof window !== 'undefined' ? window : globalThis).ADDPDF_SNAPTRACK = {
    RANK: RANK,
    guides: guides,
    onGuide: onGuide,
    guideCross: guideCross,
    segCross: segCross,
    candidates: candidates,
    best: best,
    live: live
  };
}());
