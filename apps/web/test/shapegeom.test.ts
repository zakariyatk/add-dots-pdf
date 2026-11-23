import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/* js/shapegeom.js as the page loads it, with the polygon-clipping it is
   handed there (js/vendor/polygon-clipping.umd.min.js) */
const js = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');
type Pt = [number, number];
type Poly = Pt[][];
type Multi = Poly[];
type Region = { poly: Poly; cover: number[]; top: number; area: number };
type Result = { changed: Record<string, Multi>; added: { area: Multi; from: number }[] } | null;
type Item = { id: number; area: Multi };
type Geo = {
  regions: (pc: unknown, items: Item[]) => Region[];
  regionAt: (r: Region[], x: number, y: number) => number;
  merge: (pc: unknown, items: Item[], r: Region[], picked: number[], from?: number) => Result;
  subtract: (pc: unknown, items: Item[], r: Region[], picked: number[]) => Result;
  divide: (pc: unknown, items: Item[], r: Region[]) => Result;
  areaOfRings: (pc: unknown, rings: Pt[][]) => Multi;
  toPath: (mp: Multi) => { k: string; pts: Pt[] } | null;
  multiArea: (mp: Multi) => number;
};
const ctx: { window?: unknown; ADDSHAPEGEOM?: Geo; polygonClipping?: unknown } = {};
ctx.window = ctx;
runInNewContext(readFileSync(join(js, 'vendor', 'polygon-clipping.umd.min.js'), 'utf8'), ctx);
runInNewContext(readFileSync(join(js, 'shapegeom.js'), 'utf8'), ctx);
const G = ctx.ADDSHAPEGEOM!;
const PC = ctx.polygonClipping;

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const circle = (cx: number, cy: number, r: number, n = 192): Pt[] =>
  Array.from({ length: n }, (_, k) => [
    cx + r * Math.cos((k / n) * Math.PI * 2),
    cy + r * Math.sin((k / n) * Math.PI * 2),
  ]);
const shape = (id: number, ...rings: Pt[][]): Item => ({ id, area: G.areaOfRings(PC, rings) });
const near = (a: number, b: number, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThan(tol);
const at = (regs: Region[], x: number, y: number) => G.regionAt(regs, x, y);

describe('Shape Builder geometry', () => {
  it('two overlapping circles make three regions, the lens covered by both', () => {
    const items = [shape(0, circle(0, 0, 50)), shape(1, circle(60, 0, 50))];
    const regs = G.regions(PC, items);
    expect(regs.length).toBe(3);
    const lens = regs[at(regs, 30, 0)]!;
    expect(lens.cover).toEqual([0, 1]);
    expect(lens.top).toBe(1);
    expect(regs[at(regs, -30, 0)]!.cover).toEqual([0]);
    expect(regs[at(regs, 90, 0)]!.cover).toEqual([1]);
    expect(at(regs, 200, 200)).toBe(-1);
    /* the regions add up to the union, and do not overlap */
    const total = regs.reduce((n, r) => n + r.area, 0);
    near(
      total,
      G.multiArea((PC as { union: (...a: Multi[]) => Multi }).union(items[0]!.area, items[1]!.area)),
      1,
    );
  });

  it('merging all three regions of two circles leaves one shape and no inner edge', () => {
    const items = [shape(0, circle(0, 0, 50)), shape(1, circle(60, 0, 50))];
    const regs = G.regions(PC, items);
    const r = G.merge(PC, items, regs, [at(regs, -30, 0), at(regs, 30, 0), at(regs, 90, 0)], 0)!;
    expect(r.changed[0]!).toEqual([]);
    expect(r.changed[1]!).toEqual([]);
    expect(r.added.length).toBe(1);
    expect(r.added[0]!.area.length).toBe(1); /* one piece */
    expect(r.added[0]!.area[0]!.length).toBe(1); /* one ring: no edge left inside */
    expect(r.added[0]!.from).toBe(0);
  });

  it('one region clicked comes out as a shape of its own; the circles keep the rest', () => {
    const items = [shape(0, circle(0, 0, 50)), shape(1, circle(60, 0, 50))];
    const regs = G.regions(PC, items);
    const lens = at(regs, 30, 0);
    const r = G.merge(PC, items, regs, [lens])!;
    expect(r.added[0]!.from).toBe(1); /* the look of the circle on top there */
    near(G.multiArea(r.added[0]!.area), regs[lens]!.area);
    near(G.multiArea(r.changed[0]!), regs[at(regs, -30, 0)]!.area);
    near(G.multiArea(r.changed[1]!), regs[at(regs, 90, 0)]!.area);
  });

  it('a whole shape on its own, clicked, changes nothing', () => {
    const items = [shape(0, rect(0, 0, 10, 10)), shape(1, rect(100, 100, 10, 10))];
    const regs = G.regions(PC, items);
    expect(G.merge(PC, items, regs, [at(regs, 5, 5)])).toBeNull();
    expect(G.divide(PC, items, regs)).toBeNull();
  });

  it('three overlapping rectangles: seven regions, each with its covers', () => {
    const items = [
      shape(0, rect(0, 0, 100, 100)),
      shape(1, rect(50, 0, 100, 100)),
      shape(2, rect(25, 50, 100, 100)),
    ];
    const regs = G.regions(PC, items);
    expect(regs.length).toBe(7);
    expect(regs[at(regs, 70, 70)]!.cover).toEqual([0, 1, 2]);
    expect(regs[at(regs, 70, 25)]!.cover).toEqual([0, 1]);
    expect(regs[at(regs, 35, 75)]!.cover).toEqual([0, 2]);
    expect(regs[at(regs, 10, 10)]!.cover).toEqual([0]);
    expect(regs[at(regs, 100, 140)]!.cover).toEqual([2]);
    near(
      regs.reduce((n, r) => n + r.area, 0),
      G.multiArea((PC as { union: (...a: Multi[]) => Multi }).union(...items.map((i) => i.area))),
      0.01,
    );
  });

  it('a drag across connected regions merges them; the shapes keep the rest', () => {
    const items = [shape(0, rect(0, 0, 100, 100)), shape(1, rect(50, 0, 100, 100))];
    const regs = G.regions(PC, items);
    const picked = [at(regs, 25, 50), at(regs, 75, 50)];
    const r = G.merge(PC, items, regs, picked, 0)!;
    near(G.multiArea(r.added[0]!.area), 100 * 100, 0.01);
    expect(r.added[0]!.area[0]!.length).toBe(1);
    expect(r.changed[0]!).toEqual([]);
    near(G.multiArea(r.changed[1]!), 50 * 100, 0.01);
  });

  it('circle over rectangle: Alt takes the overlap out of both', () => {
    const items = [shape(0, rect(0, 0, 100, 100)), shape(1, circle(100, 100, 40))];
    const regs = G.regions(PC, items);
    const overlap = at(regs, 90, 90);
    expect(regs[overlap]!.cover).toEqual([0, 1]);
    const r = G.subtract(PC, items, regs, [overlap])!;
    expect(r.added).toEqual([]);
    near(G.multiArea(r.changed[0]!), 100 * 100 - (Math.PI * 40 * 40) / 4, 2);
    near(G.multiArea(r.changed[1]!), (Math.PI * 40 * 40 * 3) / 4, 2);
  });

  it('a small shape on a large one: subtracting it leaves a hole', () => {
    const items = [shape(0, rect(0, 0, 200, 200)), shape(1, rect(90, 90, 20, 20))];
    const regs = G.regions(PC, items);
    expect(regs.length).toBe(2);
    const small = at(regs, 100, 100);
    expect(regs[small]!.cover).toEqual([0, 1]);
    const frame = at(regs, 10, 10);
    expect(regs[frame]!.poly.length).toBe(2); /* outer ring and a hole */
    const r = G.subtract(PC, items, regs, [small])!;
    expect(r.changed[1]!).toEqual([]);
    near(G.multiArea(r.changed[0]!), 200 * 200 - 400, 0.01);
    expect(r.changed[0]![0]!.length).toBe(2);
    const path = G.toPath(r.changed[0]!)!;
    expect(path.k).toBe('MLLLZMLLLZ');
  });

  it('Alt on a region only one shape covers trims that shape alone', () => {
    const items = [shape(0, circle(0, 0, 50)), shape(1, circle(60, 0, 50))];
    const regs = G.regions(PC, items);
    const r = G.subtract(PC, items, regs, [at(regs, -30, 0)])!;
    expect(Object.keys(r.changed)).toEqual(['0']);
    near(G.multiArea(r.changed[0]!), regs[at(regs, 30, 0)]!.area);
  });

  it('divide: every region a shape of its own, with the look of the one on top', () => {
    const items = [shape(0, circle(0, 0, 50)), shape(1, circle(60, 0, 50)), shape(2, rect(300, 300, 10, 10))];
    const regs = G.regions(PC, items);
    const r = G.divide(PC, items, regs)!;
    expect(Object.keys(r.changed).sort()).toEqual(['0', '1']); /* the lone square stays as it is */
    expect(r.added.length).toBe(3);
    expect(r.added.map((a) => a.from)).toEqual([0, 1, 1]);
  });

  it('complex polygons: two stars cross in many places, and every region is found', () => {
    const star = (cx: number, cy: number, R: number, r: number, turn: number): Pt[] =>
      Array.from({ length: 10 }, (_, k) => {
        const a = turn + (k * Math.PI) / 5,
          d = k % 2 ? r : R;
        return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
      });
    const items = [shape(0, star(0, 0, 100, 40, 0)), shape(1, star(30, 10, 100, 40, 0.3))];
    const regs = G.regions(PC, items);
    expect(regs.length).toBeGreaterThan(5);
    /* at points all over, the region found is covered by just the stars the point is in */
    const inStar = (ring: Pt[], x: number, y: number) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!,
          [xj, yj] = ring[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const stars = [star(0, 0, 100, 40, 0), star(30, 10, 100, 40, 0.3)];
    let checked = 0;
    for (let x = -110; x <= 140; x += 7.3) {
      for (let y = -110; y <= 120; y += 7.1) {
        const want = [0, 1].filter((k) => inStar(stars[k]!, x, y));
        const i = at(regs, x, y);
        if (!want.length) {
          expect(i).toBe(-1);
          continue;
        }
        expect(i).toBeGreaterThanOrEqual(0);
        expect(regs[i]!.cover).toEqual(want);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    const union = G.multiArea(
      (PC as { union: (...a: Multi[]) => Multi }).union(items[0]!.area, items[1]!.area),
    );
    near(
      regs.reduce((n, r) => n + r.area, 0),
      union,
      0.05,
    );
    /* merging every region gives back the union, in one piece */
    const all = regs.map((_, i) => i);
    const m = G.merge(PC, items, regs, all, 0)!;
    near(G.multiArea(m.added[0]!.area), union, 0.05);
  });

  it('a freeform path that crosses itself many times is cut into its faces', () => {
    /* a ring that weaves across a box five times: even-odd, as the page fills it */
    const zig: Pt[] = [];
    for (let k = 0; k <= 10; k++) zig.push([k * 20, k % 2 ? 100 : 0]);
    zig.push([200, -20], [0, -20]);
    const items = [shape(0, rect(-10, 20, 220, 60)), shape(1, zig)];
    const regs = G.regions(PC, items);
    expect(regs.length).toBeGreaterThan(15);
    for (const r of regs) expect(r.area).toBeGreaterThan(0);
    const before = regs.length;
    const r = G.subtract(PC, items, regs, [at(regs, 100, 50)])!;
    expect(Object.keys(r.changed).length).toBeGreaterThan(0);
    expect(before).toBe(regs.length);
  });

  it('a compound shape (a ring with a hole) is read even-odd', () => {
    const items = [shape(0, rect(0, 0, 100, 100), rect(25, 25, 50, 50)), shape(1, rect(40, -10, 20, 120))];
    const regs = G.regions(PC, items);
    expect(at(regs, 50, 50)).toBeGreaterThanOrEqual(0);
    expect(regs[at(regs, 50, 50)]!.cover).toEqual([1]); /* the hole is not the frame's */
    expect(regs[at(regs, 50, 10)]!.cover).toEqual([0, 1]);
    expect(regs[at(regs, 10, 50)]!.cover).toEqual([0]);
  });

  it('a region is found at every point inside it', () => {
    const items = [shape(0, circle(0, 0, 50)), shape(1, circle(60, 0, 50))];
    const regs = G.regions(PC, items);
    for (let x = -45; x <= 105; x += 5) {
      const i = at(regs, x, 0);
      expect(i).toBeGreaterThanOrEqual(0);
    }
  });
});
