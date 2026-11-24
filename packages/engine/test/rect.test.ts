import { describe, expect, it } from 'vitest';
import {
  ELLIPSE_KAPPA,
  paintRoundRect,
  rectAnchors,
  rectBezier,
  rectMaxRadius,
  rectRadii,
  rectRing,
  rectRounded,
  strokeRect,
  type Pt,
  type RectMark,
} from '../src';

/* The Rectangle tool's geometry: rounded corners as Illustrator's live
   rectangle has them (what the screen draws, the PDF is written with and
   Convert to Path makes), and the stroke aligned inside or outside. */

const box = (o: Partial<RectMark> = {}): RectMark =>
  ({ t: 'rect', a: [100, 200], b: [300, 300], c: '#000000', w: 2, ...o }) as RectMark;

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

describe('square corners', () => {
  it('are four straight sides, the same path the Pen makes of a box', () => {
    const P = rectBezier(box());
    expect(P.length).toBe(13);
    expect(rectAnchors(box())).toEqual([
      [100, 200],
      [300, 200],
      [300, 300],
      [100, 300],
    ]);
    expect(P[12]).toEqual(P[0]);
    /* each side's handles sit on its own anchors */
    expect(P[1]).toEqual(P[0]);
    expect(P[2]).toEqual(P[3]);
    expect(rectRounded(box())).toBe(false);
  });
  it('turn with the box about its centre', () => {
    const A = rectAnchors(box({ r: 90 }));
    expect(A[0]![0]).toBeCloseTo(250);
    expect(A[0]![1]).toBeCloseTo(150);
  });
});

describe('rounded corners', () => {
  it('are eight anchors, each corner a quarter circle', () => {
    const s = box({ rr: 20 });
    const P = rectBezier(s);
    expect(P.length).toBe(25);
    expect(rectAnchors(s)).toEqual([
      [120, 200],
      [280, 200],
      [300, 220],
      [300, 280],
      [280, 300],
      [120, 300],
      [100, 280],
      [100, 220],
    ]);
    /* the arc at corner 1 (300, 200) is a circle of radius 20 about (280, 220) */
    const k = 3; /* P[3] is the anchor before the arc */
    for (let i = 0; i <= 10; i++) {
      const q = cubic(P[k]!, P[k + 1]!, P[k + 2]!, P[k + 3]!, i / 10);
      expect(Math.hypot(q[0] - 280, q[1] - 220)).toBeCloseTo(20, 1);
    }
    expect(P[k + 1]).toEqual([280 + 20 * ELLIPSE_KAPPA, 200]);
  });
  it('are held to half the shorter side, as Illustrator does', () => {
    expect(rectMaxRadius(box())).toBe(50);
    expect(rectRadii(box({ rr: 500 }))).toEqual([50, 50, 50, 50]);
    /* a pill: no zero-length side left between the arcs */
    const A = rectAnchors(box({ rr: 500 }));
    expect(A.length).toBe(6);
  });
  it('can differ corner by corner, scaled back together when too big', () => {
    expect(rectRadii(box({ rc: [10, 0, 30, 0] }))).toEqual([10, 0, 30, 0]);
    /* corners 1 and 2 share the 100pt side: scaled back to fit it */
    const R = rectRadii(box({ rc: [0, 80, 80, 0] }));
    expect(R[1]! + R[2]!).toBeCloseTo(100);
    expect(R[1]).toBeCloseTo(50);
    /* corners 0 and 1 share the 200pt side, which has room for both */
    expect(rectRadii(box({ rc: [80, 80, 0, 0] }))).toEqual([80, 80, 0, 0]);
    expect(rectAnchors(box({ rc: [10, 0, 0, 0] })).length).toBe(5);
  });
  it('a ring of points stays on the outline', () => {
    const ring = rectRing(box({ rr: 30 }), 8);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    ring.forEach((q) => {
      expect(q[0]).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(q[0]).toBeLessThanOrEqual(300 + 1e-9);
    });
  });
  it('ignore nonsense radii', () => {
    expect(rectRounded(box({ rr: -5 }))).toBe(false);
    expect(rectRounded(box({ rr: NaN }))).toBe(false);
  });
});

describe('the stroke aligned', () => {
  it('centred, the outline is on the edge', () => {
    expect(strokeRect(box())).toEqual(box());
  });
  it('inside, half its width in, the radius with it', () => {
    const t = strokeRect(box({ w: 10, sa: 'in', rr: 20 }));
    expect(t.a).toEqual([105, 205]);
    expect(t.b).toEqual([295, 295]);
    expect(t.rc).toEqual([15, 15, 15, 15]);
  });
  it('outside, half its width out; a square corner stays square', () => {
    const t = strokeRect(box({ w: 10, sa: 'out' }));
    expect(t.a).toEqual([95, 195]);
    expect(rectRounded(t)).toBe(false);
  });
});

describe('written into the PDF', () => {
  function paint(s: RectMark) {
    const out: { d: string; fill: boolean; border: boolean }[] = [];
    const page = {
      drawSvgPath: (d: string, o: Record<string, unknown>) =>
        out.push({ d, fill: !!o.color, border: !!o.borderWidth }),
      pushOperators: () => {},
    };
    paintRoundRect(page as never, s);
    return out;
  }
  it('fills on the edge and strokes the same curves', () => {
    const r = paint(box({ rr: 20, fill: '#FFE08A' }));
    expect(r.map((x) => [x.fill, x.border])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(r[0]!.d).toContain(' C ');
    expect(r[0]!.d.endsWith('Z')).toBe(true);
    expect(r[0]!.d).toBe(r[1]!.d);
  });
  it('keeps just the fill with no stroke', () => {
    expect(paint(box({ rr: 20, fill: '#FFE08A', nos: true })).length).toBe(1);
  });
});
