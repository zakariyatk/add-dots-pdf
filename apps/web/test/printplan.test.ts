import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/* js/printplan.js as the page loads it: a classic script that puts its
   functions on the window (here, on the context it runs in). */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'printplan.js'),
  'utf8',
);
type Box = { x: number; y: number; w: number; h: number };
type Cell = Box & { page: number; rot: number; clip: Box; border: boolean };
type Plan = {
  w: number;
  h: number;
  landscape: boolean;
  sheets: { cells: Cell[] }[];
  scale: number;
  pages: number[];
  error?: string;
};
type Api = {
  PAPERS: { id: string; w: number; h: number }[];
  parseRange: (t: string, n: number) => number[] | null;
  plan: (sizes: { w: number; h: number }[], o: Record<string, unknown>) => Plan;
};
const ctx: { ADDPRINT?: Api } = {};
runInNewContext(src, ctx);
const P = ctx.ADDPRINT!;
const A4 = P.PAPERS.find((p) => p.id === 'a4')!;
const portrait = (n: number) => Array.from({ length: n }, () => ({ w: 595.28, h: 841.89 }));
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

describe('print plan', () => {
  it('reads page ranges as Acrobat does', () => {
    expect(P.parseRange('1-3, 8', 10)).toEqual([0, 1, 2, 7]);
    expect(P.parseRange('5-', 7)).toEqual([4, 5, 6]);
    expect(P.parseRange('3-1', 5)).toEqual([2, 1, 0]);
    expect(P.parseRange('0', 5)).toBeNull();
    expect(P.parseRange('2-9', 5)).toBeNull();
    expect(P.parseRange('two', 5)).toBeNull();
  });

  it('chooses the pages: a range, then odd pages only, last first', () => {
    const p = P.plan(portrait(9), { pick: 'range', range: '2-7', subset: 'odd', reverse: true, paper: A4 });
    expect(p.pages).toEqual([6, 4, 2]);
    expect(p.sheets.map((s) => s.cells[0]!.page)).toEqual([6, 4, 2]);
    expect(P.plan(portrait(3), { pick: 'range', range: 'x', paper: A4 }).error).toBeTruthy();
    expect(P.plan(portrait(3), { pick: 'current', current: 2, paper: A4 }).pages).toEqual([2]);
  });

  it('fits a landscape drawing to A4: auto turns the paper, portrait turns the page', () => {
    const a1 = [{ w: 2384, h: 1684 }];
    const auto = P.plan(a1, { mode: 'size', fit: 'fit', orient: 'auto', paper: A4 });
    expect(auto.landscape).toBe(true);
    expect(auto.sheets[0]!.cells[0]!.rot).toBe(0);
    near(auto.scale, Math.min(841.89 / 2384, 595.28 / 1684));
    /* portrait paper, kept so: the drawing is not turned, only made smaller */
    const port = P.plan(a1, { mode: 'size', fit: 'fit', orient: 'portrait', paper: A4 });
    expect(port.landscape).toBe(false);
    expect(port.sheets[0]!.cells[0]!.rot).toBe(0);
    near(port.scale, 595.28 / 2384);
  });

  it('auto turns a page that is the other way round from the rest', () => {
    const p = P.plan([...portrait(2), { w: 841.89, h: 595.28 }], { orient: 'auto', paper: A4 });
    expect(p.landscape).toBe(false);
    expect(p.sheets.map((s) => s.cells[0]!.rot)).toEqual([0, 0, 1]);
    const c = p.sheets[2]!.cells[0]!;
    near(c.w, 595.28);
    near(c.h, 841.89);
  });

  it('turns a page that was turned itself back the right way up', () => {
    const p = P.plan([{ w: 841.89, h: 595.28, r: 90 }, { w: 841.89, h: 595.28 }, ...portrait(2)], {
      orient: 'auto',
      paper: A4,
    });
    expect(p.sheets.map((s) => s.cells[0]!.rot)).toEqual([3, 1, 0, 0]);
  });

  it('actual size and custom scale are centred and cut to the printable part', () => {
    const margins = { l: 12, t: 12, r: 12, b: 12 };
    const p = P.plan([{ w: 1000, h: 1000 }], { fit: 'actual', orient: 'portrait', paper: A4, margins });
    const c = p.sheets[0]!.cells[0]!;
    expect(p.scale).toBe(1);
    near(c.x + c.w / 2, A4.w / 2);
    expect(c.clip).toEqual({ x: 12, y: 12, w: A4.w - 24, h: A4.h - 24 });
    const shrink = P.plan([{ w: 100, h: 100 }], { fit: 'shrink', paper: A4 });
    expect(shrink.scale).toBe(1);
    expect(P.plan([{ w: 100, h: 100 }], { fit: 'custom', scale: 250, paper: A4 }).scale).toBe(2.5);
  });

  it('puts 2 portrait pages side by side on landscape paper, 4 on portrait', () => {
    const two = P.plan(portrait(5), { mode: 'multiple', per: 2, orient: 'auto', paper: A4 });
    expect(two.landscape).toBe(true);
    expect(two.sheets.length).toBe(3);
    const [a, b] = two.sheets[0]!.cells;
    expect(a!.x).toBeLessThan(b!.x);
    near(a!.y, b!.y);
    const four = P.plan(portrait(4), { mode: 'multiple', per: 4, orient: 'auto', paper: A4, order: 'v' });
    expect(four.landscape).toBe(false);
    const c = four.sheets[0]!.cells;
    /* down first: the second page under the first */
    near(c[0]!.x, c[1]!.x);
    expect(c[1]!.y).toBeGreaterThan(c[0]!.y);
    expect(c[2]!.x).toBeGreaterThan(c[0]!.x);
  });

  it('orders a booklet so the folded sheets read 1 to 8', () => {
    const p = P.plan(portrait(7), { mode: 'booklet', paper: A4 });
    expect(p.landscape).toBe(true);
    const sides = p.sheets.map((s) => s.cells.map((c) => c.page));
    /* page 8 does not exist: that half is left blank */
    expect(sides).toEqual([[0], [1, 6], [5, 2], [3, 4]]);
    const right = P.plan(portrait(4), { mode: 'booklet', binding: 'right', paper: A4 });
    expect(right.sheets.map((s) => s.cells.map((c) => c.page))).toEqual([
      [0, 3],
      [2, 1],
    ]);
    const front = P.plan(portrait(8), { mode: 'booklet', side: 'front', paper: A4 });
    expect(front.sheets.map((s) => s.cells.map((c) => c.page))).toEqual([
      [7, 0],
      [5, 2],
    ]);
  });
});
