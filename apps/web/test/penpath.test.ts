import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/* js/penpath.js as the page loads it: a classic script that puts the Pen
   path's geometry on the window (here, on the context it runs in). Points
   are PDF points; a path is s.pts (anchor, out-handle, in-handle, anchor…). */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'penpath.js'),
  'utf8',
);
type Pt = [number, number];
type Anchor = { p: Pt; hin: Pt; hout: Pt };
type Api = {
  closed: (pts: Pt[]) => boolean;
  fromPts: (pts: Pt[]) => { A: Anchor[]; closed: boolean };
  toPts: (A: Anchor[], closed: boolean) => Pt[];
  kind: (a: Anchor) => 'smooth' | 'corner';
  bez: (p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number) => Pt;
  nearest: (pts: Pt[], p: Pt, reach: number) => { k: number; t: number; d: number; p: Pt } | null;
  splitSeg: (A: Anchor[], k: number, t: number) => number;
  removeAnchors: (A: Anchor[], closed: boolean, ks: number[]) => boolean;
  makeCorner: (A: Anchor[], k: number) => void;
  makeSmooth: (A: Anchor[], k: number, closed: boolean) => void;
  pullHandles: (A: Anchor[], k: number, q: Pt) => void;
  setHandle: (A: Anchor[], k: number, side: 'hin' | 'hout', q: Pt, linked: boolean) => void;
  moveAnchors: (A: Anchor[], ks: number[], dx: number, dy: number) => void;
  bendSeg: (A: Anchor[], k: number, t: number, d: Pt) => void;
  straightSeg: (A: Anchor[], k: number) => boolean;
  reverse: (A: Anchor[]) => void;
  cutAt: (A: Anchor[], closed: boolean, k: number) => Anchor[][] | null;
  join: (A: Anchor[], endA: number, B: Anchor[], endB: number) => Anchor[];
  close: (A: Anchor[]) => boolean;
  inBox: (A: Anchor[], x1: number, y1: number, x2: number, y2: number) => number[];
};
const ctx: { window: { ADDPDF_PENPATH?: Api } } = { window: {} };
runInNewContext(src, ctx);
const P = ctx.window.ADDPDF_PENPATH!;

/** a corner point (no handles) */
const c = (x: number, y: number): Anchor => ({ p: [x, y], hin: [x, y], hout: [x, y] });
const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/* a square, closed: four corners */
const SQUARE = P.toPts([c(0, 0), c(100, 0), c(100, 100), c(0, 100)], true);
/* an open curve: a corner, a smooth point, a corner */
const CURVE: Pt[] = [
  [0, 0],
  [0, 40],
  [60, 60],
  [100, 60],
  [140, 60],
  [200, 40],
  [200, 0],
];

describe('the path as its anchors', () => {
  it('reads a closed path as one point where it closes', () => {
    const { A, closed } = P.fromPts(SQUARE);
    expect(closed).toBe(true);
    expect(A.length).toBe(4);
    expect(P.toPts(A, true)).toEqual(SQUARE);
  });
  it('keeps the handles either side of where a closed path closes', () => {
    const A = [c(0, 0), c(100, 0), c(100, 100)];
    A[0]!.hin = [-10, 5];
    A[0]!.hout = [10, -5];
    const back = P.fromPts(P.toPts(A, true)).A;
    expect(back[0]!.hin).toEqual([-10, 5]);
    expect(back[0]!.hout).toEqual([10, -5]);
  });
  it('round-trips an open curve exactly', () => {
    const { A, closed } = P.fromPts(CURVE);
    expect(closed).toBe(false);
    expect(A.length).toBe(3);
    expect(P.toPts(A, false)).toEqual(CURVE);
  });
});

describe('kinds of anchor', () => {
  it('a point without handles is a corner', () => expect(P.kind(c(0, 0))).toBe('corner'));
  it('handles in one line are smooth', () => expect(P.kind(P.fromPts(CURVE).A[1]!)).toBe('smooth'));
  it('handles at an angle (broken) are a corner', () => {
    expect(P.kind({ p: [0, 0], hin: [-10, 0], hout: [0, 10] })).toBe('corner');
  });
  it('one handle is a corner', () =>
    expect(P.kind({ p: [0, 0], hin: [0, 0], hout: [10, 0] })).toBe('corner'));
});

describe('editing', () => {
  it('adds a point on a curve without changing its shape', () => {
    const { A } = P.fromPts(CURVE);
    const before = P.bez(A[0]!.p, A[0]!.hout, A[1]!.hin, A[1]!.p, 0.25);
    const k = P.splitSeg(A, 0, 0.5);
    expect(k).toBe(1);
    expect(A.length).toBe(4);
    /* the old segment's quarter point is the new first segment's half point */
    expect(near(P.bez(A[0]!.p, A[0]!.hout, A[1]!.hin, A[1]!.p, 0.5), before)).toBe(true);
  });
  it('adds a point to a straight segment with no handles', () => {
    const { A } = P.fromPts(SQUARE);
    P.splitSeg(A, 0, 0.5);
    expect(A[1]).toEqual(c(50, 0));
  });
  it('adds a point to the segment that closes a closed path', () => {
    const { A } = P.fromPts(SQUARE);
    const k = P.splitSeg(A, 3, 0.5);
    expect(k).toBe(4);
    expect(A[4]!.p).toEqual([0, 50]);
  });
  it('takes points out, closing up across the gap', () => {
    const { A } = P.fromPts(SQUARE);
    expect(P.removeAnchors(A, true, [1])).toBe(true);
    expect(A.map((a) => a.p)).toEqual([
      [0, 0],
      [100, 100],
      [0, 100],
    ]);
  });
  it('keeps three points on a closed path and two on an open one', () => {
    const sq = P.fromPts(SQUARE).A;
    expect(P.removeAnchors(sq, true, [0, 1])).toBe(false);
    expect(sq.length).toBe(4);
    const cv = P.fromPts(CURVE).A;
    expect(P.removeAnchors(cv, false, [0, 1])).toBe(false);
    expect(P.removeAnchors(cv, false, [1])).toBe(true);
    expect(cv.length).toBe(2);
  });
  it('moves several anchors together, handles with them', () => {
    const { A } = P.fromPts(CURVE);
    P.moveAnchors(A, [1, 2], 5, -5);
    expect(A[1]).toEqual({ p: [105, 55], hin: [65, 55], hout: [145, 55] });
    expect(A[2]!.p).toEqual([205, -5]);
    expect(A[0]!.p).toEqual([0, 0]);
  });
});

describe('converting anchors', () => {
  it('a smooth point becomes a corner', () => {
    const { A } = P.fromPts(CURVE);
    P.makeCorner(A, 1);
    expect(A[1]).toEqual(c(100, 60));
  });
  it('a corner becomes smooth, its handles along the line through its neighbours', () => {
    const { A } = P.fromPts(SQUARE);
    P.makeSmooth(A, 1, true);
    expect(P.kind(A[1]!)).toBe('smooth');
    /* neighbours (0,0) and (100,100): the line runs at 45° */
    const h = A[1]!.hout;
    expect(h[0] - 100).toBeCloseTo(h[1] - 0);
  });
  it('broken handles are lined up again, each keeping its length', () => {
    const A = [c(0, 0), { p: [50, 0] as Pt, hin: [40, 0] as Pt, hout: [50, 20] as Pt }, c(100, 0)];
    P.makeSmooth(A, 1, false);
    expect(P.kind(A[1]!)).toBe('smooth');
    expect(Math.hypot(A[1]!.hin[0] - 50, A[1]!.hin[1])).toBeCloseTo(10);
    expect(Math.hypot(A[1]!.hout[0] - 50, A[1]!.hout[1])).toBeCloseTo(20);
  });
  it('pulls symmetrical handles out of a point', () => {
    const { A } = P.fromPts(SQUARE);
    P.pullHandles(A, 0, [10, 20]);
    expect(A[0]!.hout).toEqual([10, 20]);
    expect(A[0]!.hin).toEqual([-10, -20]);
  });
});

describe('handles', () => {
  it('a smooth point’s other handle turns with it, keeping its length', () => {
    const { A } = P.fromPts(CURVE);
    P.setHandle(A, 1, 'hout', [100, 100], true);
    expect(A[1]!.hout).toEqual([100, 100]);
    expect(A[1]!.hin[0]).toBeCloseTo(100);
    expect(A[1]!.hin[1]).toBeCloseTo(60 - 40);
    expect(P.kind(A[1]!)).toBe('smooth');
  });
  it('with the link broken (Alt), the other stays where it is', () => {
    const { A } = P.fromPts(CURVE);
    P.setHandle(A, 1, 'hout', [100, 100], false);
    expect(A[1]!.hin).toEqual([60, 60]);
    expect(P.kind(A[1]!)).toBe('corner');
  });
  it('a corner’s handles stay independent: moving one leaves the other', () => {
    const A = [c(0, 0), { p: [50, 0] as Pt, hin: [40, 0] as Pt, hout: [50, 20] as Pt }, c(100, 0)];
    P.setHandle(A, 1, 'hout', [60, 20], true);
    expect(A[1]!.hin).toEqual([40, 0]);
  });
});

describe('reshaping a segment', () => {
  it('a drag on a curve carries the point grabbed exactly as far', () => {
    const { A } = P.fromPts(CURVE);
    const t = 0.4;
    const before = P.bez(A[0]!.p, A[0]!.hout, A[1]!.hin, A[1]!.p, t);
    P.bendSeg(A, 0, t, [0, 10]);
    const after = P.bez(A[0]!.p, A[0]!.hout, A[1]!.hin, A[1]!.p, t);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1] + 10);
    /* its ends stay put */
    expect(A[0]!.p).toEqual([0, 0]);
    expect(A[1]!.p).toEqual([100, 60]);
  });
  it('tells a straight segment from a curved one', () => {
    expect(P.straightSeg(P.fromPts(SQUARE).A, 0)).toBe(true);
    expect(P.straightSeg(P.fromPts(CURVE).A, 0)).toBe(false);
  });
});

describe('whole-path operations', () => {
  it('reverses the path, its handles swapping sides', () => {
    const { A } = P.fromPts(CURVE);
    P.reverse(A);
    expect(P.toPts(A, false)).toEqual(CURVE.slice().reverse());
  });
  it('cuts a closed path open at a point', () => {
    const { A } = P.fromPts(SQUARE);
    const parts = P.cutAt(A, true, 2)!;
    expect(parts.length).toBe(1);
    expect(parts[0]!.map((a) => a.p)).toEqual([
      [100, 100],
      [0, 100],
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });
  it('cuts an open path in two at a point, and not at its ends', () => {
    const { A } = P.fromPts(CURVE);
    const parts = P.cutAt(A, false, 1)!;
    expect(parts.length).toBe(2);
    expect(parts[0]![1]!.p).toEqual([100, 60]);
    expect(parts[1]![0]!.p).toEqual([100, 60]);
    /* the curve's other handles kept */
    expect(parts[0]![1]!.hin).toEqual([60, 60]);
    expect(parts[1]![0]!.hout).toEqual([140, 60]);
    expect(P.cutAt(A, false, 0)).toBeNull();
  });
  it('joins two open paths end to end', () => {
    const a = [c(0, 0), c(10, 0)];
    const b = [c(20, 0), c(30, 0)];
    expect(P.join(a, 1, b, 0).map((x) => x.p)).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ]);
    /* b's end to a's start: a is read backwards, b forwards from its end */
    expect(P.join(a, 0, b, 1).map((x) => x.p)).toEqual([
      [10, 0],
      [0, 0],
      [30, 0],
      [20, 0],
    ]);
  });
  it('joins ends on one place into one point', () => {
    const a = [c(0, 0), c(10, 0)];
    const b = [c(10, 0), c(10, 10)];
    expect(P.join(a, 1, b, 0).length).toBe(3);
  });
  it('closes an open path, ends on one place becoming one point', () => {
    const A = [c(0, 0), c(10, 0), c(10, 10), c(0, 0)];
    expect(P.close(A)).toBe(true);
    expect(A.length).toBe(3);
    const two = [c(0, 0), c(10, 0)];
    expect(P.close(two)).toBe(false);
  });
  it('picks the anchors inside a box', () => {
    expect(P.inBox(P.fromPts(SQUARE).A, -5, -5, 105, 50)).toEqual([0, 1]);
  });
  it('finds the nearest place on the path', () => {
    const h = P.nearest(SQUARE, [50, 3], 5)!;
    expect(h.k).toBe(0);
    expect(h.t).toBeCloseTo(0.5, 1);
    expect(P.nearest(SQUARE, [50, 50], 5)).toBeNull();
  });
});
