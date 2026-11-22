import { describe, expect, it } from 'vitest';
import { drawPainters, penPainters, polyPainters, type Pt } from '../src';

/* Every closed shape takes a fill and can do without its border (nos): a
   cloud, a closed Continuous Line and a closed Pen path as a box and a
   circle already could. An open line is nothing but its line, so it keeps
   it whatever nos says. */

/* what a painter asks pdf-lib for: fills (drawSvgPath with no border) and
   border lines (drawLine segments, or drawSvgPath with a border) */
function paint(painter: (p: never, s: never, c: never) => void, mark: Record<string, unknown>) {
  const out = { fills: 0, lines: 0 };
  const page = {
    drawSvgPath: (_d: string, o: Record<string, unknown>) => {
      if (o.color) out.fills++;
      if (o.borderWidth) out.lines++;
    },
    drawLine: () => out.lines++,
    pushOperators: () => {},
  };
  painter(page as never, mark as never, {} as never);
  return out;
}

const draw = drawPainters(() => ({ unit: 'mm', denom: 1, custom: null }));
const cloud = { t: 'cloud', a: [100, 100], b: [220, 180], c: '#E2483D', w: 1 };
const BOX: Pt[] = [
  [100, 100],
  [200, 100],
  [200, 160],
  [100, 160],
  [100, 100],
];
const line = { t: 'poly', pts: BOX, c: '#000000', w: 1 };
const PEN: Pt[] = [
  [100, 100],
  [100, 100],
  [200, 100],
  [200, 100],
  [200, 100],
  [150, 180],
  [150, 180],
  [150, 180],
  [100, 100],
  [100, 100],
];
const pen = { t: 'pen', pts: PEN, c: '#000000', w: 1 };

describe('a cloud', () => {
  it('is its outline alone, as before, with neither set', () => {
    const r = paint(draw.cloud!, cloud);
    expect(r.fills).toBe(0);
    expect(r.lines).toBeGreaterThan(0);
  });
  it('is filled under its outline', () => {
    const r = paint(draw.cloud!, { ...cloud, fill: '#FFE08A' });
    expect(r.fills).toBe(1);
    expect(r.lines).toBeGreaterThan(0);
  });
  it('keeps just its fill with no border', () => {
    expect(paint(draw.cloud!, { ...cloud, fill: '#FFE08A', nos: true })).toEqual({ fills: 1, lines: 0 });
  });
});

describe('a closed Continuous Line', () => {
  it('keeps just its fill with no border', () => {
    expect(paint(polyPainters.poly!, { ...line, fill: '#CFE0FF', nos: true })).toEqual({
      fills: 1,
      lines: 0,
    });
  });
  it('an open one keeps its line whatever nos says', () => {
    const r = paint(polyPainters.poly!, { ...line, pts: BOX.slice(0, 4), nos: true });
    expect(r.lines).toBe(3);
  });
});

describe('a closed Pen path', () => {
  it('keeps just its fill with no border', () => {
    expect(paint(penPainters.pen!, { ...pen, fill: '#CFE0FF', nos: true })).toEqual({ fills: 1, lines: 0 });
  });
  it('an open one keeps its line whatever nos says', () => {
    expect(paint(penPainters.pen!, { ...pen, pts: PEN.slice(0, 7), nos: true }).lines).toBe(1);
  });
});
