import { describe, expect, it } from 'vitest';
import { penClosed, penPainters, penPathData, type Pt } from '../src';

/* A Pen path (painters/pen.ts): s.pts runs anchor, out-handle, in-handle,
   anchor…, and is written to the page as true Bézier curves. */

const S: Pt[] = [
  [100, 100],
  [140, 160],
  [200, 160],
  [240, 100], // one curved segment
  [240, 100],
  [300, 40],
  [300, 40], // a straight one: its handles on its anchors
];
const CLOSED: Pt[] = [...S, [300, 40], [100, 100], [100, 100]];

describe('the path', () => {
  it('is curves through its anchors, y flipped for drawSvgPath', () => {
    expect(penPathData(S)).toBe('M 100 -100 C 140 -160 200 -160 240 -100 C 240 -100 300 -40 300 -40');
  });
  it('closes when its last anchor is its first', () => {
    expect(penClosed(S)).toBe(false);
    expect(penClosed(CLOSED)).toBe(true);
    expect(penPathData(CLOSED).endsWith(' Z')).toBe(true);
  });
  it('stays open when marked open, its ends meeting (a closed path cut there)', () => {
    expect(penClosed(CLOSED, true)).toBe(false);
    expect(penPathData(CLOSED, -1, true).endsWith(' Z')).toBe(false);
  });
});

/* what the painter asks pdf-lib to draw: each drawSvgPath call, its path and options */
function paint(mark: Record<string, unknown>): { d: string; o: Record<string, unknown> }[] {
  const calls: { d: string; o: Record<string, unknown> }[] = [];
  const page = { drawSvgPath: (d: string, o: Record<string, unknown>) => calls.push({ d, o }) };
  penPainters.pen!(page as never, mark, {} as never);
  return calls;
}

describe('painted on a page', () => {
  it('strokes the curves in its colour and width, unfilled', () => {
    const calls = paint({ t: 'pen', pts: S, c: '#E2483D', w: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.d).toBe(penPathData(S));
    expect(calls[0]!.o.borderWidth).toBe(2);
    expect(calls[0]!.o.color).toBeUndefined();
  });
  it('fills a closed path with a fill first, then strokes it', () => {
    const calls = paint({ t: 'pen', pts: CLOSED, c: '#000000', w: 1, fill: '#CFE0FF' });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.o.color).toBeDefined();
    expect(calls[0]!.o.borderWidth).toBe(0);
    expect(calls[1]!.o.borderColor).toBeDefined();
  });
  it('leaves an open path unfilled, and a path of one point unpainted', () => {
    expect(paint({ t: 'pen', pts: S, c: '#000000', w: 1, fill: '#CFE0FF' })).toHaveLength(1);
    expect(paint({ t: 'pen', pts: [[1, 1]], c: '#000000', w: 1 })).toHaveLength(0);
  });
  it('a path marked open is not filled, whatever its ends do', () => {
    const calls = paint({ t: 'pen', pts: CLOSED, c: '#000000', w: 1, fill: '#FFCC00', open: true });
    expect(calls.length).toBe(1);
    expect(calls[0]!.o.color).toBeUndefined();
  });
  it('a dashed path keeps its dashes', () => {
    const calls = paint({ t: 'pen', pts: S, c: '#000000', w: 2, d: 1 });
    expect(Array.isArray(calls[0]!.o.borderDashArray)).toBe(true);
  });
});
