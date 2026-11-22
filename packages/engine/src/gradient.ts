/* Gradient fills, as Illustrator's Gradient panel and Gradient tool make them.

   A closed shape (a box, circle, cloud, closed Continuous Line or Pen path, an
   Edit Object or Pathfinder shape) can carry `grad` beside its `fill`. The
   fill stays set to the gradient's first colour, so everything that only
   asks "is it filled?" (hit testing, the Layers swatch) keeps working; the
   screen and the saved PDF paint the gradient instead.

   The gradient runs along a vector from g1 to g2, each a fraction of the
   shape's own box before it was turned (x to the right, y up, as page points
   run), so the gradient moves, stretches and turns with the shape. A linear
   gradient is even across lines square to the vector; a radial one is centred
   on g1 and reaches its last colour at g2's distance.

   Stops carry a colour, a location along the vector (0..1) and an opacity.
   Between two stops sits a midpoint (`mid`, 0..1 of the gap, default 0.5),
   where the blend is half way. The screen and the PDF both draw the blend as
   the same list of plain steps (gradRamp), so they agree. */

import type { Pt } from './model';
import { rotPt } from './geometry';

export interface GradStop {
  /** colour, #RRGGBB */
  c: string;
  /** location along the vector, 0..1 */
  p: number;
  /** opacity 0..1 (default 1) */
  o?: number;
}

export interface Grad {
  k: 'linear' | 'radial';
  /** at least two, in order of location */
  stops: GradStop[];
  /** midpoint between stop i and i + 1, as a fraction of the gap (default 0.5) */
  mid?: number[];
  /** the vector's start and end, as fractions of the shape's unturned box */
  g1?: Pt;
  g2?: Pt;
}

/** What gradRamp gives: a location, a colour as 0..1 rgb, and an opacity. */
export interface RampStop {
  p: number;
  rgb: [number, number, number];
  o: number;
}

/** The box a gradient is laid out in: unturned, with the turn and its centre. */
export interface GradFrame {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  c: Pt;
  r: number;
}

/* a mark as far as a gradient needs it */
interface Shaped {
  a?: unknown;
  b?: unknown;
  pts?: unknown;
  r?: number;
  fr?: number;
  grad?: Grad | null;
}

const isPt = (p: unknown): p is Pt => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number';

function bounds(P: readonly Pt[]): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const p of P) {
    x1 = Math.min(x1, p[0]);
    y1 = Math.min(y1, p[1]);
    x2 = Math.max(x2, p[0]);
    y2 = Math.max(y2, p[1]);
  }
  return P.length ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 0, y2: 0 };
}

/** The shape's box before its turn. A box, circle or cloud turns by s.r about
    its centre; a mark of points keeps the angle it was turned to as s.fr, and
    its box is found with that turn taken off (as the editor's frame is). */
export function gradFrame(s: Shaped): GradFrame {
  if (isPt(s.a) && isPt(s.b)) {
    const b = bounds([s.a, s.b]);
    return { ...b, c: [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2], r: s.r || 0 };
  }
  const P = Array.isArray(s.pts) ? (s.pts as Pt[]).filter(isPt) : [];
  const b0 = bounds(P);
  const c: Pt = [(b0.x1 + b0.x2) / 2, (b0.y1 + b0.y2) / 2];
  const r = s.fr || 0;
  const b = r ? bounds(P.map((p) => rotPt(p, c, -r))) : b0;
  return { ...b, c, r };
}

/** A new gradient as Illustrator starts one: white to black, left to right. */
export function defaultGrad(k: Grad['k'] = 'linear', from = '#FFFFFF', to = '#000000'): Grad {
  return {
    k,
    stops: [
      { c: from, p: 0 },
      { c: to, p: 1 },
    ],
    ...(k === 'radial'
      ? { g1: [0.5, 0.5] as Pt, g2: [1, 0.5] as Pt }
      : { g1: [0, 0.5] as Pt, g2: [1, 0.5] as Pt }),
  };
}

/** The vector's two ends in page points, turned with the shape. */
export function gradEnds(s: Shaped, g: Grad | null | undefined = s.grad): [Pt, Pt] {
  const f = gradFrame(s);
  const radial = g && g.k === 'radial';
  const g1 = g && g.g1 ? g.g1 : radial ? [0.5, 0.5] : [0, 0.5];
  const g2 = g && g.g2 ? g.g2 : [1, 0.5];
  const at = (q: readonly number[]): Pt => {
    const p: Pt = [f.x1 + q[0]! * (f.x2 - f.x1), f.y1 + q[1]! * (f.y2 - f.y1)];
    return f.r ? rotPt(p, f.c, f.r) : p;
  };
  return [at(g1), at(g2)];
}

/** Page points back to the fractions g1 and g2 are kept in. */
export function gradFrac(s: Shaped, p: readonly number[]): Pt {
  const f = gradFrame(s);
  const q = f.r ? rotPt(p, f.c, -f.r) : [p[0]!, p[1]!];
  const w = f.x2 - f.x1 || 1,
    h = f.y2 - f.y1 || 1;
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  return [r6((q[0]! - f.x1) / w), r6((q[1]! - f.y1) / h)];
}

/** The vector's angle in degrees, anticlockwise from the page's x axis. */
export function gradAngle(s: Shaped, g: Grad | null | undefined = s.grad): number {
  const [a, b] = gradEnds(s, g);
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) return 0;
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** The same gradient with its vector turned to `deg`, its start and length kept. */
export function gradWithAngle(s: Shaped, g: Grad, deg: number): Grad {
  const [a, b] = gradEnds(s, g);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = (deg * Math.PI) / 180;
  const e: Pt = [a[0] + len * Math.cos(t), a[1] + len * Math.sin(t)];
  return { ...g, g1: gradFrac(s, a), g2: gradFrac(s, e) };
}

/** #RGB or #RRGGBB as 0..1 rgb; anything else is black. */
export function gradRgb(hex: string): [number, number, number] {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!/^[0-9a-f]{6}/i.test(h) || isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const clamp01 = (v: unknown, d: number) => {
  const n = typeof v === 'number' && isFinite(v) ? v : d;
  return Math.max(0, Math.min(1, n));
};

/** The stops in order, each location and opacity kept to 0..1. */
export function gradStops(g: Grad): GradStop[] {
  const st = (Array.isArray(g.stops) ? g.stops : [])
    .filter((x) => x && typeof x.c === 'string')
    .map((x) => ({ c: x.c, p: clamp01(x.p, 0), o: clamp01(x.o, 1) }));
  st.sort((a, b) => a.p - b.p);
  if (!st.length)
    return [
      { c: '#FFFFFF', p: 0, o: 1 },
      { c: '#000000', p: 1, o: 1 },
    ];
  if (st.length === 1) return [st[0]!, { ...st[0]!, p: 1 }];
  return st;
}

/** Steps per gap when its midpoint is off centre: enough that the curve the
    midpoint makes reads smooth, on screen and in the PDF alike. */
const MID_STEPS = 8;

/** The gradient as plain stops to blend straight between: the stops
    themselves, and, where a midpoint is off centre, steps along the curve
    it makes (half way at the midpoint, as Illustrator blends). */
export function gradRamp(g: Grad): RampStop[] {
  const st = gradStops(g);
  const mids = Array.isArray(g.mid) ? g.mid : [];
  const out: RampStop[] = [];
  const mix = (a: GradStop, b: GradStop, f: number, p: number): RampStop => {
    const A = gradRgb(a.c),
      B = gradRgb(b.c);
    return {
      p,
      rgb: [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f],
      o: a.o! + (b.o! - a.o!) * f,
    };
  };
  out.push(mix(st[0]!, st[0]!, 0, st[0]!.p));
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i]!,
      b = st[i + 1]!;
    const m = Math.max(0.05, Math.min(0.95, clamp01(mids[i], 0.5)));
    if (Math.abs(m - 0.5) > 1e-3 && b.p - a.p > 1e-6) {
      /* f = t^e, with e chosen so that f is 0.5 where t is m */
      const e = Math.log(0.5) / Math.log(m);
      for (let k = 1; k < MID_STEPS; k++) {
        const t = k / MID_STEPS;
        out.push(mix(a, b, Math.pow(t, e), a.p + (b.p - a.p) * t));
      }
    }
    out.push(mix(b, b, 0, b.p));
  }
  return out;
}

/** The ramp's colour at t (0..1), for a stop added part way along. */
export function gradColourAt(g: Grad, t: number): { c: string; o: number } {
  const R = gradRamp(g);
  let a = R[0]!,
    b = R[R.length - 1]!;
  if (t <= a.p) b = a;
  else if (t >= b.p) a = b;
  else
    for (let i = 0; i + 1 < R.length; i++)
      if (t >= R[i]!.p && t <= R[i + 1]!.p) {
        a = R[i]!;
        b = R[i + 1]!;
        break;
      }
  const f = b.p - a.p > 1e-9 ? (t - a.p) / (b.p - a.p) : 0;
  const ch = (k: number) =>
    Math.round((a.rgb[k]! + (b.rgb[k]! - a.rgb[k]!) * f) * 255)
      .toString(16)
      .padStart(2, '0');
  return { c: ('#' + ch(0) + ch(1) + ch(2)).toUpperCase(), o: a.o + (b.o - a.o) * f };
}

/** Whether any stop is less than fully opaque. */
export function gradHasAlpha(g: Grad): boolean {
  return gradStops(g).some((x) => (x.o ?? 1) < 1);
}

/** A gradient from anywhere (a project file, a share link) made safe to use:
    colours as #hex only, numbers in range, or null if it is not one. */
export function cleanGrad(g: unknown): Grad | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  const hex = (c: unknown) =>
    typeof c === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c.trim()) ? c.trim() : null;
  const stops = (Array.isArray(o.stops) ? o.stops : [])
    .map((x: unknown) => {
      const s = (x || {}) as Record<string, unknown>;
      const c = hex(s.c);
      return c ? { c, p: clamp01(s.p, 0), ...(s.o != null ? { o: clamp01(s.o, 1) } : {}) } : null;
    })
    .filter(Boolean) as GradStop[];
  if (stops.length < 2) return null;
  const pt = (p: unknown): Pt | undefined =>
    Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) ? [+p[0], +p[1]] : undefined;
  const out: Grad = { k: o.k === 'radial' ? 'radial' : 'linear', stops: stops.slice(0, 64) };
  if (Array.isArray(o.mid)) out.mid = o.mid.slice(0, 63).map((m: unknown) => clamp01(m, 0.5));
  const g1 = pt(o.g1),
    g2 = pt(o.g2);
  if (g1) out.g1 = g1;
  if (g2) out.g2 = g2;
  return out;
}
