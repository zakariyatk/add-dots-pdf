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
type Hit = { p: Pt; kind: string; label: string; d: number; v: number };
type Api = {
  RANK: Record<string, number>;
  guides: (a: Pt) => { v: number; at: number }[];
  onGuide: (a: Pt, p: Pt, tol: number) => Hit[];
  guideCross: (a: Pt, p: Pt, tol: number, rulers: { v: number; at: number }[]) => Hit[];
  segCross: (a: Pt, p: Pt, tol: number, segs: [Pt, Pt][]) => Hit[];
  candidates: (a: Pt, p: Pt, tol: number, o?: Record<string, unknown>) => Hit[];
  best: (a: Pt, p: Pt, tol: number, o?: Record<string, unknown>) => Hit | null;
  live: (hit: Hit | null) => { across: boolean; upright: boolean };
};
const ctx: { ADDPDF_SNAPTRACK?: Api } = {};
runInNewContext(src, ctx);
const T = ctx.ADDPDF_SNAPTRACK as Api;

const A: Pt = [100, 100];
const TOL = 10;

describe('the guides an acquired point sends out', () => {
  it('sends one upright and one across, through the point', () => {
    const g = T.guides(A);
    expect(g).toEqual([{ v: 1, at: 100 }, { v: 0, at: 100 }]);
  });
});

describe('lying along a guide', () => {
  it('catches the pointer onto the guide across, keeping its own x', () => {
    const got = T.onGuide(A, [160, 104], TOL);
    expect(got).toHaveLength(1);
    expect(got[0].p).toEqual([160, 100]);
    expect(got[0].label).toBe('Across');
    expect(got[0].d).toBe(4);
  });

  it('catches the pointer onto the upright guide, keeping its own y', () => {
    const got = T.onGuide(A, [104, 160], TOL);
    expect(got).toHaveLength(1);
    expect(got[0].p).toEqual([100, 160]);
    expect(got[0].label).toBe('In line');
  });

  it('offers nothing further out than the tolerance', () => {
    expect(T.onGuide(A, [160, 118], TOL)).toEqual([]);
  });

  it('offers nothing right next to the acquired point, where the point itself is the better catch', () => {
    expect(T.onGuide(A, [104, 104], TOL)).toEqual([]);
  });
});

describe('where a guide crosses a ruler guide', () => {
  it('catches the crossing of an upright ruler guide with the guide across', () => {
    const got = T.guideCross(A, [158, 103], TOL, [{ v: 1, at: 160 }]);
    expect(got).toHaveLength(1);
    expect(got[0].p).toEqual([160, 100]);
    expect(got[0].kind).toBe('tcross');
  });

  it('catches the crossing of a flat ruler guide with the upright guide', () => {
    const got = T.guideCross(A, [103, 158], TOL, [{ v: 0, at: 160 }]);
    expect(got).toHaveLength(1);
    expect(got[0].p).toEqual([100, 160]);
  });

  it('leaves a crossing alone while the pointer is nowhere near it', () => {
    expect(T.guideCross(A, [300, 300], TOL, [{ v: 1, at: 160 }])).toEqual([]);
  });
});

describe('where a guide crosses one of the drawing lines', () => {
  const upright: [Pt, Pt] = [[160, 50], [160, 150]];

  it('catches where the guide across meets the line', () => {
    const got = T.segCross(A, [157, 102], TOL, [upright]);
    expect(got).toHaveLength(1);
    expect(got[0].p).toEqual([160, 100]);
    expect(got[0].kind).toBe('tseg');
  });

  it('does not run the line past its own ends', () => {
    expect(T.segCross(A, [157, 102], TOL, [[[160, 120], [160, 150]]])).toEqual([]);
  });

  it('ignores a line the guide meets far from the pointer', () => {
    expect(T.segCross(A, [300, 300], TOL, [upright])).toEqual([]);
  });
});

describe('choosing between catches', () => {
  it('prefers a crossing to merely lying along the guide', () => {
    const hit = T.best(A, [160, 103], TOL, { segs: [[[160, 50], [160, 150]]] });
    expect(hit).not.toBeNull();
    expect(hit?.kind).toBe('tseg');
    expect(hit?.p).toEqual([160, 100]);
  });

  it('falls back to the guide itself when nothing crosses there', () => {
    const hit = T.best(A, [160, 103], TOL, {});
    expect(hit?.kind).toBe('ton');
  });

  it('offers nothing at all when the pointer is off both guides', () => {
    expect(T.best(A, [300, 300], TOL, {})).toBeNull();
  });

  it('ranks a crossing above lying along a guide', () => {
    expect(T.RANK.tcross).toBeLessThan(T.RANK.ton);
    expect(T.RANK.tseg).toBeLessThan(T.RANK.ton);
  });
});

describe('which guides to show', () => {
  it('shows both while nothing is caught', () => {
    expect(T.live(null)).toEqual({ across: true, upright: true });
  });

  it('shows only the guide being ridden', () => {
    expect(T.live({ v: 0 } as Hit)).toEqual({ across: true, upright: false });
    expect(T.live({ v: 1 } as Hit)).toEqual({ across: false, upright: true });
  });
});
