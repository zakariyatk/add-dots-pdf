/* The Rectangle tool's geometry: a box with rounded corners, as Illustrator's
   live rectangle has them, and its stroke aligned inside or outside the edge.

   A rectangle's corners go round as rectCorners has them: 0 at (x1, y1),
   1 at (x2, y1), 2 at (x2, y2), 3 at (x1, y2), before its turn. Its corner
   radius is `rr` (every corner) or `rc` (one each, in that order), in
   points. Either is held back, as Illustrator does, so two neighbouring
   corners never need more than the side between them.

   The outline is the Pen path's own form (anchor, out-handle, in-handle,
   anchor…), so the screen, the saved PDF, Pathfinder and Convert to Path all
   work from the very same curve. */

import { boxOf, rotPt } from './geometry';
import type { Mark, Pt } from './model';
import { ELLIPSE_KAPPA } from './painters/draw';

export interface RectMark extends Mark {
  t: 'rect';
  /** Corner radius, in points, for every corner. */
  rr?: number;
  /** A radius for each corner, in rectCorners' order; wins over rr. */
  rc?: [number, number, number, number] | null;
  /** Where the outline sits on the edge: centred (unset), inside or outside. */
  sa?: 'in' | 'out';
}

type RadiiSrc = Pick<RectMark, 'a' | 'b' | 'rr' | 'rc'>;

/** The corner radii as asked for, before they are held to the box. */
export function rectRadiiRaw(s: Pick<RectMark, 'rr' | 'rc'>): [number, number, number, number] {
  const pos = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  if (Array.isArray(s.rc) && s.rc.length === 4)
    return [pos(s.rc[0]), pos(s.rc[1]), pos(s.rc[2]), pos(s.rc[3])];
  const r = pos(s.rr);
  return [r, r, r, r];
}

/** The corner radii as drawn: scaled back together, as CSS and Illustrator
    do, until no side has to carry more than its own length. */
export function rectRadii(s: RadiiSrc): [number, number, number, number] {
  const r = rectRadiiRaw(s);
  const b = boxOf(s),
    w = b.x2 - b.x1,
    h = b.y2 - b.y1;
  let f = 1;
  const fit = (side: number, sum: number) => {
    if (sum > side) f = Math.min(f, side / sum);
  };
  fit(w, r[0] + r[1]);
  fit(h, r[1] + r[2]);
  fit(w, r[2] + r[3]);
  fit(h, r[3] + r[0]);
  return f < 1 ? [r[0] * f, r[1] * f, r[2] * f, r[3] * f] : r;
}

/** Whether any corner is rounded. */
export function rectRounded(s: RadiiSrc): boolean {
  const r = rectRadiiRaw(s);
  return r[0] > 0 || r[1] > 0 || r[2] > 0 || r[3] > 0;
}

/** The largest radius one corner can take in this box: half its shorter side. */
export function rectMaxRadius(s: Pick<Mark, 'a' | 'b'>): number {
  const b = boxOf(s);
  return Math.max(0, Math.min(b.x2 - b.x1, b.y2 - b.y1) / 2);
}

/**
 * The rectangle's outline in the Pen path's form, closed on its first anchor,
 * turned by s.r: four straight sides (13 points) when no corner is rounded,
 * and each rounded corner a quarter-circle Bézier arc between two anchors.
 * It runs from corner 0 along the side to corner 1, and on round.
 */
export function rectBezier(s: Pick<RectMark, 'a' | 'b' | 'r' | 'rr' | 'rc'>): Pt[] {
  const b = boxOf(s);
  const C: Pt[] = [
    [b.x1, b.y1],
    [b.x2, b.y1],
    [b.x2, b.y2],
    [b.x1, b.y2],
  ];
  const R = rectRadii(s);
  /* the unit direction along each side, i to i+1 */
  const U: Pt[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const k = ELLIPSE_KAPPA;
  const at = (c: Pt, u: Pt, d: number): Pt => [c[0] + u[0] * d, c[1] + u[1] * d];
  const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  const out: Pt[] = [];
  /* where the outline leaves corner 0, along side 0 */
  const first = at(C[0]!, U[0]!, R[0]!);
  out.push(first);
  let cur = first;
  const lineTo = (p: Pt) => {
    if (same(cur, p)) return;
    out.push([cur[0], cur[1]], [p[0], p[1]], [p[0], p[1]]);
    cur = p;
  };
  for (let n = 1; n <= 4; n++) {
    const i = n % 4,
      c = C[i]!,
      uin = U[(i + 3) % 4]!,
      uout = U[i]!,
      r = R[i]!;
    /* the side up to the corner, then round it */
    if (r > 0) {
      const A = at(c, uin, -r),
        B = at(c, uout, r);
      lineTo(A);
      out.push(at(A, uin, r * k), at(B, uout, -r * k), B);
      cur = B;
    } else lineTo(c);
  }
  /* corner 0 rounded: its arc ends on the first anchor; square: back to it */
  lineTo(first);
  if (out.length < 4) {
    /* a box of no size: a single point, as a path of one empty side */
    out.push([first[0], first[1]], [first[0], first[1]], [first[0], first[1]]);
  }
  const c0: Pt = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
  return s.r ? out.map((p) => rotPt(p, c0, s.r)) : out;
}

/** The outline's anchor points (every third point, the closing one left out). */
export function rectAnchors(s: Pick<RectMark, 'a' | 'b' | 'r' | 'rr' | 'rc'>): Pt[] {
  const P = rectBezier(s),
    out: Pt[] = [];
  for (let i = 0; i + 3 < P.length; i += 3) out.push(P[i]!);
  return out;
}

/** The outline as a ring of points (each rounded corner in `steps` pieces),
    for Pathfinder, Shape Builder and hit tests. */
export function rectRing(s: Pick<RectMark, 'a' | 'b' | 'r' | 'rr' | 'rc'>, steps = 12): Pt[] {
  const P = rectBezier(s),
    out: Pt[] = [[P[0]![0], P[0]![1]]];
  for (let i = 0; i + 3 < P.length; i += 3) {
    const p0 = P[i]!,
      p1 = P[i + 1]!,
      p2 = P[i + 2]!,
      p3 = P[i + 3]!;
    const straight = p0[0] === p1[0] && p0[1] === p1[1] && p2[0] === p3[0] && p2[1] === p3[1];
    const n = straight ? 1 : steps;
    for (let j = 1; j <= n; j++) {
      const t = j / n,
        u = 1 - t;
      const a = u * u * u,
        bb = 3 * u * u * t,
        c = 3 * u * t * t,
        d = t * t * t;
      out.push([
        a * p0[0] + bb * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + bb * p1[1] + c * p2[1] + d * p3[1],
      ]);
    }
  }
  return out;
}

/** The rectangle its outline is drawn on: the edge itself, or with the stroke
    aligned inside or outside, the edge (and each radius) moved in or out by
    half the stroke's width, about the same centre and turn. The fill stays on
    the edge. Outside, a square corner stays square, as Illustrator's does
    with a miter join. */
export function strokeRect<T extends RectMark>(s: T): T {
  if (s.sa !== 'in' && s.sa !== 'out') return s;
  const b = boxOf(s);
  const k = ((s.sa === 'out' ? 1 : -1) * (s.w || 0)) / 2;
  const hw = Math.max(0.005, (b.x2 - b.x1) / 2 + k),
    hh = Math.max(0.005, (b.y2 - b.y1) / 2 + k);
  const cx = (b.x1 + b.x2) / 2,
    cy = (b.y1 + b.y2) / 2;
  const out: T = { ...s, a: [cx - hw, cy - hh], b: [cx + hw, cy + hh] };
  if (rectRounded(s)) {
    const R = rectRadii(s).map((r) => (r > 0 ? Math.max(0, r + k) : 0)) as [number, number, number, number];
    out.rc = R;
    delete out.rr;
  }
  return out;
}
