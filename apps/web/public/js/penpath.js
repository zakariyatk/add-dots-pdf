/* Add Dots PDF — Pen path geometry
   -------------------------------
   The arithmetic of a Pen path, apart from the page, so it can be tested on
   its own (apps/web/test/penpath.test.ts) and every tool that edits a path
   (js/pen.js: the Pen, Direct Selection, Add, Delete and Convert Anchor
   Point) does it the same way.

   A path is kept on its mark as s.pts: anchor, out-handle, in-handle,
   anchor… (3n + 1 points, in PDF points), cubic Bézier segments end to end.
   Closed, its last anchor is its first one again, and the handles either
   side of that point belong to it. A handle sitting on its own anchor is no
   handle: that side of the point is straight.

   Here a path is worked on as its anchors, each { p, hin, hout } (the point,
   the handle coming into it and the one going out of it), with `closed`
   apart, so a closed path's first point is one anchor, not two.

   An anchor is smooth when it has both handles and they lie in one line
   through it, pointing away from each other; a corner otherwise (no handles,
   one, or two at an angle: Illustrator's "broken" handles). A smooth point's
   handles move together, keeping it smooth; a corner's move on their own. */
(function () {
  'use strict';

  var EPS = 0.01;                 /* points: closer than this is the same place */
  var SMOOTH_DEG = 2;             /* handles this close to one line are smooth */

  function cp(q) { return [q[0], q[1]]; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function same(a, b) { return dist(a, b) < EPS; }

  /** A closed path: at least two segments, its last anchor on its first,
      and not marked open (s.open: ends that meet without closing it). */
  function closed(pts, open) {
    return !open && !!pts && pts.length >= 7 && same(pts[0], pts[pts.length - 1]);
  }

  /** The path's anchors, and whether it is closed. */
  function fromPts(pts, open) {
    var c = closed(pts, open), A = [], n = pts.length;
    var last = c ? n - 4 : n - 1;
    for (var a = 0; a <= last; a += 3) {
      A.push({
        p: cp(pts[a]),
        hin: cp(a > 0 ? pts[a - 1] : (c ? pts[n - 2] : pts[a])),
        hout: cp(a + 1 < n ? pts[a + 1] : pts[a])
      });
    }
    return { A: A, closed: c };
  }

  /** An open path whose ends meet: it has to say it is open (s.open), or it
      would read as closed. */
  function needsOpen(A, isClosed) {
    return !isClosed && A.length > 2 && same(A[0].p, A[A.length - 1].p);
  }

  /** The anchors back as s.pts. */
  function toPts(A, isClosed) {
    if (!A.length) return [];
    var pts = [cp(A[0].p)];
    for (var k = 1; k < A.length; k++) pts.push(cp(A[k - 1].hout), cp(A[k].hin), cp(A[k].p));
    if (isClosed && A.length > 2) pts.push(cp(A[A.length - 1].hout), cp(A[0].hin), cp(A[0].p));
    return pts;
  }

  function copyA(A) { return A.map(function (a) { return { p: cp(a.p), hin: cp(a.hin), hout: cp(a.hout) }; }); }

  /** How many segments a path of n anchors has. */
  function segCount(n, isClosed) { return isClosed ? n : n - 1; }
  /** Segment k runs from anchor k to anchor k + 1 (the first again, closing). */
  function segEnds(A, k) { return [k, (k + 1) % A.length]; }

  function hasIn(a) { return !same(a.hin, a.p); }
  function hasOut(a) { return !same(a.hout, a.p); }

  /** 'smooth' or 'corner', as Illustrator tells its anchors apart. */
  function kind(a) {
    if (!hasIn(a) || !hasOut(a)) return 'corner';
    var u = Math.atan2(a.hin[1] - a.p[1], a.hin[0] - a.p[0]);
    var v = Math.atan2(a.hout[1] - a.p[1], a.hout[0] - a.p[0]);
    var d = Math.abs(((u - v) * 180 / Math.PI) % 360);
    if (d > 180) d = 360 - d;
    return Math.abs(d - 180) <= SMOOTH_DEG ? 'smooth' : 'corner';
  }

  function bez(p0, c1, c2, p1, t) {
    var u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]
    ];
  }

  /** The place on the path nearest p within reach: segment k, t on it, the
      point there and how far it is. Each segment is walked as 48 chords:
      close enough to pick it out, and the split itself is exact. */
  function nearest(pts, p, reach) {
    var best = null;
    for (var i = 0, k = 0; i + 3 < pts.length; i += 3, k++) {
      var prev = pts[i];
      for (var n = 1; n <= 48; n++) {
        var t = n / 48, q = bez(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], t);
        var dx = q[0] - prev[0], dy = q[1] - prev[1], l2 = dx * dx + dy * dy;
        var u = l2 ? Math.max(0, Math.min(1, ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / l2)) : 0;
        var r = [prev[0] + u * dx, prev[1] + u * dy], d = dist(r, p);
        if (d <= reach && (!best || d < best.d)) best = { k: k, t: (n - 1 + u) / 48, d: d, p: r };
        prev = q;
      }
    }
    return best;
  }

  /** Segment k of the anchors split at t (de Casteljau): a point added, the
      curve exactly as it was. Answers the new anchor's index. */
  function splitSeg(A, k, t) {
    var e = segEnds(A, k), a = A[e[0]], b = A[e[1]];
    var L = function (x, y) { return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t]; };
    var p01 = L(a.p, a.hout), p12 = L(a.hout, b.hin), p23 = L(b.hin, b.p);
    var q0 = L(p01, p12), q1 = L(p12, p23), m = L(q0, q1);
    a.hout = p01; b.hin = p23;
    var mid = { p: m, hin: q0, hout: q1 };
    /* a straight segment stays straight: its new point has no handles */
    if (same(a.hout, a.p) && same(b.hin, b.p)) { mid.hin = cp(m); mid.hout = cp(m); }
    A.splice(e[0] + 1, 0, mid);
    return e[0] + 1;
  }

  /** Anchors `ks` taken out, the path closing up across each gap (as the
      Delete Anchor Point tool does). Answers false if too few would be left:
      two for an open path, three for a closed one. */
  function removeAnchors(A, isClosed, ks) {
    var want = {};
    ks.forEach(function (k) { want[k] = 1; });
    var left = A.filter(function (_, k) { return !want[k]; });
    if (left.length < (isClosed ? 3 : 2)) return false;
    A.length = 0;
    left.forEach(function (a) { A.push(a); });
    return true;
  }

  /** Anchor k made a corner: its handles back on it. */
  function makeCorner(A, k) {
    var a = A[k];
    a.hin = cp(a.p); a.hout = cp(a.p);
  }

  /** Anchor k made smooth. With handles, they are lined up on the bisecting
      direction, each keeping its length; with none, they are pulled out along
      the line through the points either side, a third of the way to each,
      the curve Illustrator's Convert Anchor Point tool gives. */
  function makeSmooth(A, k, isClosed) {
    var a = A[k], n = A.length;
    var prev = k > 0 ? A[k - 1] : (isClosed ? A[n - 1] : null);
    var next = k < n - 1 ? A[k + 1] : (isClosed ? A[0] : null);
    var li = hasIn(a) ? dist(a.hin, a.p) : (prev ? dist(prev.p, a.p) / 3 : 0);
    var lo = hasOut(a) ? dist(a.hout, a.p) : (next ? dist(next.p, a.p) / 3 : 0);
    var dx, dy;
    if (hasIn(a) || hasOut(a)) {
      /* the direction out, from both handles where there are two */
      var ox = hasOut(a) ? (a.hout[0] - a.p[0]) / lo : 0, oy = hasOut(a) ? (a.hout[1] - a.p[1]) / lo : 0;
      var ix = hasIn(a) ? (a.p[0] - a.hin[0]) / li : 0, iy = hasIn(a) ? (a.p[1] - a.hin[1]) / li : 0;
      dx = ox + ix; dy = oy + iy;
    } else {
      var from = prev ? prev.p : a.p, to = next ? next.p : a.p;
      dx = to[0] - from[0]; dy = to[1] - from[1];
    }
    var l = Math.hypot(dx, dy);
    if (l < 1e-9) { dx = 1; dy = 0; l = 1; }
    dx /= l; dy /= l;
    if (!li) li = lo; if (!lo) lo = li;
    if (!li) { li = lo = 10; }
    a.hin = [a.p[0] - dx * li, a.p[1] - dy * li];
    a.hout = [a.p[0] + dx * lo, a.p[1] + dy * lo];
  }

  /** Anchor k given symmetrical handles out to q (and mirrored), as a drag
      on a point with the Pen or Convert Anchor Point tool pulls them. */
  function pullHandles(A, k, q) {
    var a = A[k];
    a.hout = cp(q);
    a.hin = [2 * a.p[0] - q[0], 2 * a.p[1] - q[1]];
  }

  /** Handle `side` ('hin' or 'hout') of anchor k moved to q. Linked (a
      smooth point, and not told to break it): the other turns to stay in
      line, keeping its own length. */
  function setHandle(A, k, side, q, linked) {
    var a = A[k], other = side === 'hin' ? 'hout' : 'hin';
    var wasSmooth = kind(a) === 'smooth';
    a[side] = cp(q);
    if (linked && wasSmooth) {
      var len = dist(a[other], a.p), dx = a.p[0] - q[0], dy = a.p[1] - q[1], l = Math.hypot(dx, dy);
      if (l > 1e-9) a[other] = [a.p[0] + dx / l * len, a.p[1] + dy / l * len];
    }
  }

  /** Anchors `ks` moved by (dx, dy), their handles with them. */
  function moveAnchors(A, ks, dx, dy) {
    ks.forEach(function (k) {
      var a = A[k];
      if (!a) return;
      a.p = [a.p[0] + dx, a.p[1] + dy];
      a.hin = [a.hin[0] + dx, a.hin[1] + dy];
      a.hout = [a.hout[0] + dx, a.hout[1] + dy];
    });
  }

  /** Segment k bent so its point at t lands d further on, as dragging a
      curve with Direct Selection reshapes it: both handles move, the one
      nearer the grab more, by just enough to carry the curve there. */
  function bendSeg(A, k, t, d) {
    var e = segEnds(A, k), a = A[e[0]], b = A[e[1]];
    var u = 1 - t;
    var w1 = u, w2 = t;
    var den = 3 * u * u * t * w1 + 3 * u * t * t * w2;
    if (den < 1e-6) return;
    var s = 1 / den;
    a.hout = [a.hout[0] + d[0] * w1 * s, a.hout[1] + d[1] * w1 * s];
    b.hin = [b.hin[0] + d[0] * w2 * s, b.hin[1] + d[1] * w2 * s];
  }

  /** A straight segment (no handles on it), which a drag moves whole. */
  function straightSeg(A, k) {
    var e = segEnds(A, k);
    return !hasOut(A[e[0]]) && !hasIn(A[e[1]]);
  }

  /** The path drawn the other way round. */
  function reverse(A) {
    A.reverse();
    A.forEach(function (a) { var t = a.hin; a.hin = a.hout; a.hout = t; });
  }

  /** Cut at anchor k (Illustrator's Scissors, or "Cut path at selected
      anchor points"). A closed path opens there, k its first and its last
      point; an open one becomes two, k the end of one and the start of the
      other. Answers the anchor lists of the pieces (one or two), or null when
      there is nothing to cut (an open path's own end). */
  function cutAt(A, isClosed, k) {
    var n = A.length;
    if (isClosed) {
      var out = [];
      for (var i = 0; i <= n; i++) out.push(copyA([A[(k + i) % n]])[0]);
      /* the first point has no way in, the last none out */
      out[0].hin = cp(out[0].p);
      out[n].hout = cp(out[n].p);
      return [out];
    }
    if (k <= 0 || k >= n - 1) return null;
    var a = copyA(A.slice(0, k + 1)), b = copyA(A.slice(k));
    a[a.length - 1].hout = cp(a[a.length - 1].p);
    b[0].hin = cp(b[0].p);
    return [a, b];
  }

  /** Two open paths joined end to end: A's end `endA` (0 its start, 1 its
      end) to B's `endB`. Points on one place become one. Answers the new
      anchors, A's other end first. */
  function join(A, endA, B, endB) {
    var a = copyA(A), b = copyA(B);
    if (endA === 0) reverse(a);
    if (endB === 1) reverse(b);
    var last = a[a.length - 1], first = b[0];
    if (same(last.p, first.p)) {
      /* one point now: the way in from A, the way out to B */
      last.hout = first.hout;
      b.shift();
    }
    return a.concat(b);
  }

  /** An open path closed: its ends on one place become one point. Answers
      false when it has too few points to close. */
  function close(A) {
    if (A.length < 2) return false;
    var first = A[0], last = A[A.length - 1];
    if (same(first.p, last.p)) {
      if (A.length < 4) return false;
      first.hin = last.hin;
      A.pop();
    } else if (A.length < 3 && !hasOut(first) && !hasIn(last)) {
      /* two points and straight: closing would draw a line over itself */
      return false;
    }
    return true;
  }

  /** The anchors whose points lie in the box (any two corners). */
  function inBox(A, x1, y1, x2, y2) {
    var lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    var out = [];
    A.forEach(function (a, k) { if (a.p[0] >= lx && a.p[0] <= hx && a.p[1] >= ly && a.p[1] <= hy) out.push(k); });
    return out;
  }

  var api = {
    EPS: EPS, closed: closed, fromPts: fromPts, toPts: toPts, needsOpen: needsOpen, copyA: copyA, segCount: segCount,
    hasIn: hasIn, hasOut: hasOut, kind: kind, bez: bez, nearest: nearest, splitSeg: splitSeg,
    removeAnchors: removeAnchors, makeCorner: makeCorner, makeSmooth: makeSmooth, pullHandles: pullHandles,
    setHandle: setHandle, moveAnchors: moveAnchors, bendSeg: bendSeg, straightSeg: straightSeg,
    reverse: reverse, cutAt: cutAt, join: join, close: close, inBox: inBox
  };
  if (typeof window !== 'undefined') window.ADDPDF_PENPATH = api;
}());
