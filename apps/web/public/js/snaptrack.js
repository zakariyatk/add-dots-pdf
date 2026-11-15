/* ---------------- object snap tracking ----------------
   Object snap catches points that are already there. Tracking makes new ones:
   rest on a snap point and it is *acquired*, which sends two dashed guides out
   from it — one across, one down. Two points can be held at once, and the one
   the drawing started from sends its own pair as well, so the pointer is
   caught along any of them, where two of them cross, and where one crosses a
   ruler guide or one of the drawing's own lines. That is how you put a mark
   level with one thing and in line with another without drawing a scrap of
   construction geometry first.

   Everything here is plain geometry in viewport pixels, with no DOM and no
   reference to the viewer's state, so it can be tested on its own and so the
   tolerance stays in screen pixels at any zoom. js/draw.js converts the page's
   PDF points into pixels, hands them over, and converts the answer back. */
(function () {
  'use strict';

  /* Which catch wins when several are within reach: the same scale draw.js
     ranks its own snaps on, where a smaller number beats a larger one. Every
     crossing is a real point, so all of them outrank lying along a guide. */
  var RANK = { txg: 1, tcross: 1, tseg: 1, ton: 2 };

  /* A crossing is worth a little more reach than a guide: it is a single point
     rather than a whole line, and harder to land on. */
  var CROSS_EXTRA = 3;
  /* How far along a guide a catch has to be before it is a different answer
     from the point the guide came from. Nearer than this the ordinary endpoint
     snap is the better catch, and two markers on one pixel is noise. */
  var ALONG = 16;

  /** One point, or a list of them, as a list. */
  function list(a) {
    if (!a) return [];
    return typeof a[0] === 'number' ? [a] : a;
  }

  /** The guides a set of acquired points sends out, in viewport pixels: an
      upright one and a flat one from each. `v` marks the upright one, `at` is
      the pixel it sits on, `from` the point it came from, and `label` what to
      call a catch that rides it. A point passed in `o.start` is the one the
      drawing started from, whose pair reads as ortho rather than tracking. */
  function guides(a, o) {
    var out = [];
    list(a).forEach(function (q) {
      out.push({ v: 1, at: q[0], from: q, label: 'Vertical from point' });
      out.push({ v: 0, at: q[1], from: q, label: 'Horizontal from point' });
    });
    list(o && o.start).forEach(function (q) {
      out.push({ v: 1, at: q[0], from: q, label: 'Ortho from start', start: 1 });
      out.push({ v: 0, at: q[1], from: q, label: 'Ortho from start', start: 1 });
    });
    return out;
  }

  /* Far enough along the guide from its own point to be a different answer. */
  function away(g, q) {
    return (g.v ? Math.abs(q[1] - g.from[1]) : Math.abs(q[0] - g.from[0])) > ALONG;
  }

  /** Lying along one of the guides: the pointer keeps its own position on the
      guide's free axis and takes the guide's on the other. */
  function onGuide(a, p, tol, o) {
    var out = [];
    guides(a, o).forEach(function (g) {
      var d = Math.abs((g.v ? p[0] : p[1]) - g.at);
      if (d > tol) return;
      var q = g.v ? [g.at, p[1]] : [p[0], g.at];
      if (!away(g, q)) return;
      out.push({ p: q, kind: 'ton', label: g.label, d: d, v: g.v, ray: g });
    });
    return out;
  }

  /** Where one guide crosses another: an upright guide and a flat one meet at
      exactly one pixel. Two guides from the same point cross at that point, so
      those are left out — the point itself is the better catch. */
  function crossGuides(a, p, tol, o) {
    var out = [];
    var gs = guides(a, o);
    for (var i = 0; i < gs.length; i++) {
      for (var j = 0; j < gs.length; j++) {
        var up = gs[i], flat = gs[j];
        if (!up.v || flat.v) continue;
        if (up.from === flat.from) continue;
        var q = [up.at, flat.at];
        var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > tol + CROSS_EXTRA || !away(up, q) || !away(flat, q)) continue;
        out.push({ p: q, kind: 'txg', label: 'Guides cross', d: d, v: 0, ray: up, ray2: flat });
      }
    }
    return out;
  }

  /** Where a guide crosses a ruler guide. The rulers are upright and flat too,
      so each crossing is simply one pixel from each. `rulers` is [{v, at}] in
      viewport pixels, as js/rulers.js keeps them. */
  function guideCross(a, p, tol, rulers, o) {
    var out = [];
    if (!rulers || !rulers.length) return out;
    guides(a, o).forEach(function (g) {
      for (var i = 0; i < rulers.length; i++) {
        var r = rulers[i];
        /* a ruler guide parallel to the tracking guide never crosses it; the
           one at right angles crosses it exactly once */
        if (!!r.v === !!g.v) continue;
        var q = g.v ? [g.at, r.at] : [r.at, g.at];
        var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > tol + CROSS_EXTRA || !away(g, q)) continue;
        out.push({ p: q, kind: 'tcross', label: 'Guide crossing', d: d, v: g.v, ray: g });
      }
    });
    return out;
  }

  /** Where a guide crosses one of the drawing's lines. Only the segments
      already under the pointer are passed in, so this stays a handful of sums
      however much geometry the page holds. Each segment is [[x1,y1],[x2,y2]]
      in viewport pixels. */
  function segCross(a, p, tol, segs, o) {
    var out = [];
    if (!segs || !segs.length) return out;
    guides(a, o).forEach(function (g) {
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i], s0 = s[0], s1 = s[1];
        var dx = s1[0] - s0[0], dy = s1[1] - s0[1];
        var span = g.v ? dx : dy;
        if (Math.abs(span) < 1e-9) continue;
        var t = ((g.v ? g.at - s0[0] : g.at - s0[1])) / span;
        if (t < -1e-6 || t > 1 + 1e-6) continue;
        var q = g.v ? [g.at, s0[1] + t * dy] : [s0[0] + t * dx, g.at];
        var d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > tol + CROSS_EXTRA || !away(g, q)) continue;
        out.push({ p: q, kind: 'tseg', label: 'Guide meets line', d: d, v: g.v, ray: g });
      }
    });
    return out;
  }

  /** Every catch the guides offer for this pointer position, ranked.
      `o` may carry `rulers`, `segs` and `start`; all are optional. */
  function candidates(a, p, tol, o) {
    o = o || {};
    return onGuide(a, p, tol, o)
      .concat(crossGuides(a, p, tol, o))
      .concat(guideCross(a, p, tol, o.rulers, o))
      .concat(segCross(a, p, tol, o.segs, o));
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

  /** Which guides to draw bright: the one or two the catch is riding, or all
      of them while the pointer is off them. Keeps the screen quiet once a
      guide has been caught. Answers for the list `guides()` returns. */
  function live(a, hit, o) {
    var gs = guides(a, o);
    if (!hit || !hit.ray) {
      return gs.map(function () { return true; });
    }
    /* by where the guide lies, not by which object it is: the caller builds
       its own list to draw from, so the two sets are never the same objects */
    var same = function (g, r) { return !!r && g.v === r.v && Math.abs(g.at - r.at) < 0.5; };
    return gs.map(function (g) { return same(g, hit.ray) || same(g, hit.ray2); });
  }

  (typeof window !== 'undefined' ? window : globalThis).ADDPDF_SNAPTRACK = {
    RANK: RANK,
    ALONG: ALONG,
    CROSS_EXTRA: CROSS_EXTRA,
    guides: guides,
    onGuide: onGuide,
    crossGuides: crossGuides,
    guideCross: guideCross,
    segCross: segCross,
    candidates: candidates,
    best: best,
    live: live
  };
}());
