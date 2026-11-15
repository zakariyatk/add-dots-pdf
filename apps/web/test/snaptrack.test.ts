import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/* js/snaptrack.js as the page loads it: a classic script that puts its
   geometry on the window (here, on the context it runs in). Everything is in
   screen pixels, so the numbers below are pixels and no zoom is involved. */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'snaptrack.js'),
  'utf8',
);
type Pt = [number, number];
type Ray = { v: number; at: number; from: Pt; label: string; start?: number };
type Hit = { p: Pt; kind: string; label: string; d: number; v: number; ray?: Ray; ray2?: Ray };
type Opt = Record<string, unknown>;
type Api = {
  RANK: { ton: number; tcross: number; tseg: number; txg: number };
  ALONG: number;
  CROSS_EXTRA: number;
  guides: (a: Pt | Pt[], o?: Opt) => Ray[];
  onGuide: (a: Pt | Pt[], p: Pt, tol: number, o?: Opt) => Hit[];
  crossGuides: (a: Pt | Pt[], p: Pt, tol: number, o?: Opt) => Hit[];
  guideCross: (a: Pt | Pt[], p: Pt, tol: number, rulers: { v: number; at: number }[], o?: Opt) => Hit[];
  segCross: (a: Pt | Pt[], p: Pt, tol: number, segs: [Pt, Pt][], o?: Opt) => Hit[];
  candidates: (a: Pt | Pt[], p: Pt, tol: number, o?: Opt) => Hit[];
  best: (a: Pt | Pt[], p: Pt, tol: number, o?: Opt) => Hit | null;
  live: (a: Pt | Pt[], hit: Hit | null, o?: Opt) => boolean[];
};
const ctx: { ADDPDF_SNAPTRACK?: Api } = {};
runInNewContext(src, ctx);
const T = ctx.ADDPDF_SNAPTRACK as Api;

const A: Pt = [100, 100];
const B: Pt = [300, 260];
const TOL = 10;

describe('the guides an acquired point sends out', () => {
  it('sends one upright and one across, through the point', () => {
    const g = T.guides(A);
    expect(g.map((r) => [r.v, r.at])).toEqual([
      [1, 100],
      [0, 100],
    ]);
    expect(g[0]?.from).toEqual(A);
  });

  it('sends a pair from each point held, and from the one a drawing started at', () => {
    expect(T.guides([A, B])).toHaveLength(4);
    expect(T.guides([A, B], { start: [[50, 50]] })).toHaveLength(6);
  });

  it('calls the start point its own thing, since that pair is ortho and not tracking', () => {
    const g = T.guides([], { start: [[50, 50]] });
    expect(g.every((r) => r.label === 'Ortho from start')).toBe(true);
  });
});

describe('lying along a guide', () => {
  it('catches the pointer onto the guide across, keeping its own x', () => {
    const got = T.onGuide(A, [160, 104], TOL);
    expect(got).toHaveLength(1);
    expect(got[0]?.p).toEqual([160, 100]);
    expect(got[0]?.label).toBe('Horizontal from point');
    expect(got[0]?.d).toBe(4);
  });

  it('catches the pointer onto the upright guide, keeping its own y', () => {
    const got = T.onGuide(A, [104, 160], TOL);
    expect(got).toHaveLength(1);
    expect(got[0]?.p).toEqual([100, 160]);
    expect(got[0]?.label).toBe('Vertical from point');
  });

  it('offers nothing further out than the tolerance', () => {
    expect(T.onGuide(A, [160, 118], TOL)).toEqual([]);
  });

  it('offers nothing right next to the acquired point, where the point itself is the better catch', () => {
    expect(T.onGuide(A, [104, 104], TOL)).toEqual([]);
  });

  it('catches either point once two are held', () => {
    expect(T.onGuide([A, B], [160, 104], TOL)[0]?.p).toEqual([160, 100]);
    expect(T.onGuide([A, B], [160, 264], TOL)[0]?.p).toEqual([160, 260]);
  });
});

describe('where two guides cross', () => {
  it('catches the corner made by one point across and the other upright', () => {
    const got = T.crossGuides([A, B], [296, 103], TOL);
    expect(got).toHaveLength(1);
    expect(got[0]?.p).toEqual([300, 100]);
    expect(got[0]?.label).toBe('Guides cross');
    expect(got[0]?.kind).toBe('txg');
  });

  it('crosses an acquired point with the point the drawing started at', () => {
    const got = T.crossGuides(A, [48, 102], TOL, { start: [[50, 50]] });
    expect(got.map((h) => h.p)).toContainEqual([50, 100]);
  });

  it('never offers a point crossed with itself, which is just the point', () => {
    expect(T.crossGuides(A, [100, 100], TOL)).toEqual([]);
  });

  it('leaves the crossing alone while the pointer is nowhere near it', () => {
    expect(T.crossGuides([A, B], [500, 500], TOL)).toEqual([]);
  });
});

describe('where a guide crosses a ruler guide', () => {
  it('catches the crossing of an upright ruler guide with the guide across', () => {
    const got = T.guideCross(A, [158, 103], TOL, [{ v: 1, at: 160 }]);
    expect(got).toHaveLength(1);
    expect(got[0]?.p).toEqual([160, 100]);
    expect(got[0]?.kind).toBe('tcross');
  });

  it('catches the crossing of a flat ruler guide with the upright guide', () => {
    const got = T.guideCross(A, [103, 158], TOL, [{ v: 0, at: 160 }]);
    expect(got).toHaveLength(1);
    expect(got[0]?.p).toEqual([100, 160]);
  });

  it('leaves a crossing alone while the pointer is nowhere near it', () => {
    expect(T.guideCross(A, [300, 300], TOL, [{ v: 1, at: 160 }])).toEqual([]);
  });
});

describe('where a guide crosses one of the drawing lines', () => {
  const upright: [Pt, Pt] = [
    [160, 50],
    [160, 150],
  ];

  it('catches where the guide across meets the line', () => {
    const got = T.segCross(A, [157, 102], TOL, [upright]);
    expect(got).toHaveLength(1);
    expect(got[0]?.p).toEqual([160, 100]);
    expect(got[0]?.kind).toBe('tseg');
  });

  it('does not run the line past its own ends', () => {
    expect(
      T.segCross(A, [157, 102], TOL, [
        [
          [160, 120],
          [160, 150],
        ],
      ]),
    ).toEqual([]);
  });

  it('ignores a line the guide meets far from the pointer', () => {
    expect(T.segCross(A, [300, 300], TOL, [upright])).toEqual([]);
  });
});

describe('choosing between catches', () => {
  it('prefers a crossing to merely lying along the guide', () => {
    const hit = T.best(A, [160, 103], TOL, {
      segs: [
        [
          [160, 50],
          [160, 150],
        ],
      ],
    });
    expect(hit).not.toBeNull();
    expect(hit?.kind).toBe('tseg');
    expect(hit?.p).toEqual([160, 100]);
  });

  it('falls back to the guide itself when nothing crosses there', () => {
    const hit = T.best(A, [160, 103], TOL, {});
    expect(hit?.kind).toBe('ton');
  });

  it('offers nothing at all when the pointer is off every guide', () => {
    expect(T.best(A, [300, 300], TOL, {})).toBeNull();
  });

  it('ranks every crossing above lying along a guide', () => {
    expect(T.RANK.tcross).toBeLessThan(T.RANK.ton);
    expect(T.RANK.tseg).toBeLessThan(T.RANK.ton);
    expect(T.RANK.txg).toBeLessThan(T.RANK.ton);
  });
});

describe('which guides to show', () => {
  it('shows them all while nothing is caught', () => {
    expect(T.live(A, null)).toEqual([true, true]);
    expect(T.live([A, B], null)).toEqual([true, true, true, true]);
  });

  it('shows only the guide being ridden', () => {
    const hit = T.best(A, [160, 103], TOL, {}) as Hit;
    expect(T.live(A, hit)).toEqual([false, true]);
  });

  it('shows both guides that make a crossing', () => {
    const hit = T.crossGuides([A, B], [296, 103], TOL)[0] ?? null;
    expect(T.live([A, B], hit)).toEqual([false, true, true, false]);
  });
});
