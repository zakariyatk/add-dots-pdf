import { describe, expect, it } from 'vitest';
import { drawPainters, ellipseBezier, strokeEllipse, type Pt } from '../src';

/* The Ellipse tool's geometry: the ellipse as four Bézier arcs (what the
   screen draws and Convert to Path makes), and the stroke aligned inside or
   outside the edge (what the screen draws and the PDF is written with). */

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u,
    b = 3 * u * u * t,
    c = 3 * u * t * t,
    d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
/** how far off the true ellipse each arc strays, as a fraction of the radius */
function worst(s: { a: Pt; b: Pt; r?: number }) {
  const P = ellipseBezier(s);
  const cx = (s.a[0] + s.b[0]) / 2,
    cy = (s.a[1] + s.b[1]) / 2;
  const rx = Math.abs(s.b[0] - s.a[0]) / 2,
    ry = Math.abs(s.b[1] - s.a[1]) / 2;
  const t0 = ((s.r || 0) * Math.PI) / 180;
  let err = 0;
  for (let k = 0; k + 3 < P.length; k += 3) {
    for (let i = 0; i <= 20; i++) {
      const q = cubic(P[k]!, P[k + 1]!, P[k + 2]!, P[k + 3]!, i / 20);
      /* back into the ellipse's own frame */
      const x = q[0] - cx,
        y = q[1] - cy;
      const lx = x * Math.cos(-t0) - y * Math.sin(-t0),
        ly = x * Math.sin(-t0) + y * Math.cos(-t0);
      err = Math.max(err, Math.abs(Math.hypot(lx / rx, ly / ry) - 1));
    }
  }
  return err;
}

describe('the ellipse as Bézier arcs', () => {
  it('is four arcs, closed on its first anchor, through the quadrant points', () => {
    const P = ellipseBezier({ a: [100, 200], b: [300, 300] });
    expect(P.length).toBe(13);
    expect(P[0]).toEqual([300, 250]);
    expect(P[3]).toEqual([200, 300]);
    expect(P[6]).toEqual([100, 250]);
    expect(P[9]).toEqual([200, 200]);
    expect(P[12]).toEqual(P[0]);
  });
  it('stays on the true circle to within 0.03% of the radius', () => {
    expect(worst({ a: [0, 0], b: [200, 200] })).toBeLessThan(3e-4);
  });
  it('stays on a long ellipse, turned, as closely', () => {
    expect(worst({ a: [10, 40], b: [610, 140], r: 33 })).toBeLessThan(3e-4);
  });
  it('is just as exact very small and very large', () => {
    expect(worst({ a: [0, 0], b: [0.5, 0.5] })).toBeLessThan(3e-4);
    expect(worst({ a: [-5000, -5000], b: [5000, 5000] })).toBeLessThan(3e-4);
  });
});

describe('stroke alignment', () => {
  const s = { t: 'ellipse' as const, a: [100, 100] as Pt, b: [300, 200] as Pt, c: '#000000', w: 10 };
  it('centred, the outline is on the edge', () => {
    expect(strokeEllipse(s)).toBe(s);
  });
  it('inside, the outline sits half its width in', () => {
    const t = strokeEllipse({ ...s, sa: 'in' });
    expect(t.a).toEqual([105, 105]);
    expect(t.b).toEqual([295, 195]);
  });
  it('outside, half its width out', () => {
    const t = strokeEllipse({ ...s, sa: 'out' });
    expect(t.a).toEqual([95, 95]);
    expect(t.b).toEqual([305, 205]);
  });
  it('never turns inside out, however thick', () => {
    const t = strokeEllipse({ ...s, w: 500, sa: 'in' });
    expect(t.b[0] - t.a[0]).toBeGreaterThan(0);
  });
  it('is written into the PDF: the fill on the edge, the outline moved', () => {
    const calls: { x: number; xScale: number; fill: boolean; border: boolean }[] = [];
    const page = {
      drawEllipse: (o: Record<string, number | undefined>) =>
        calls.push({ x: o.x!, xScale: o.xScale!, fill: !!o.color, border: !!o.borderWidth }),
    };
    const paint = drawPainters(() => ({ unit: 'mm', denom: 1, custom: null })).ellipse!;
    paint(page as never, { ...s, fill: '#FFE08A', sa: 'out' } as never, {} as never);
    expect(calls).toEqual([
      { x: 200, xScale: 100, fill: true, border: false },
      { x: 200, xScale: 105, fill: false, border: true },
    ]);
  });
});
