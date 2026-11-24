/* The Dimension Engine: AutoCAD's dimensions as editable vector marks.

   One mark type, 'dimx', for every kind of dimension (s.k): linear
   (horizontal, vertical or at any set direction), aligned, angular, radius,
   diameter, arc length and ordinate. Continuous and baseline dimensions are
   linear ones placed in a chain or stacked off one base point.

   Kept apart, as a CAD dimension keeps them:

   - geometry: the defining points (s.pts, what is measured), where the
     dimension line sits (its location point) and, once moved on its own,
     where the text sits. All of them are in s.pts, in PDF points, so core
     moves, scales, turns, duplicates and undoes a dimension as it does any
     mark made of points;
   - association (s.ref): which point of which mark each defining point
     sits on, so a dimension follows the geometry it measures when that is
     moved, resized or turned (resolveDims);
   - measurement: the value read off the geometry (dimMeasure) and how it
     is written (dimText: units, precision, prefix and suffix, an override);
   - style (s.sty): every size and choice of the look, each optional.

   dimLayout turns those into one display list (lines, arrowheads, text) in
   PDF points. The editor draws that list on screen and into SVG
   (dimSvgMarkup), and the PDF painter (painters/dimension.ts) writes the
   very same list, so the screen, an SVG export and the saved PDF agree. */

import { boxOf, rotPt } from './geometry';
import { UNITS, isUnit, type Scale, type UnitId } from './measure';
import type { AnyMark, FontFamily, Pt } from './model';
import { arcPts, type ArcMark } from './painters/draw';

/* ---------------- the model ---------------- */

export type DimKind = 'lin' | 'ali' | 'ang' | 'rad' | 'dia' | 'arc' | 'ord';
export type ArrowKind = 'closed' | 'open' | 'oblique' | 'dot' | 'none';

/** The look of a dimension. Every field is optional: unset is DIM_STYLE's. */
export interface DimStyle {
  /** text height, in points on paper */
  th?: number;
  /** font: 'helv' | 'times' | 'cour' | 'g:<id>' (unset: Inter) */
  tf?: FontFamily | '';
  /** bold (default) and italic */
  tb?: boolean;
  ti?: boolean;
  /** text colour (unset: the lines' colour) */
  tc?: string;
  /** arrowhead and its size, in points */
  ah?: ArrowKind;
  as?: number;
  /** extension lines: the gap off the measured point, how far past the
      dimension line they run, and a fixed length (0: from the point) */
  exo?: number;
  exe?: number;
  exf?: number;
  /** text above, centred on or below the dimension line; aligned with it or
      always level; its gap off the line */
  tp?: 'above' | 'center' | 'below';
  ta?: 'aligned' | 'horizontal';
  tg?: number;
  /** decimal places for lengths and angles (unset: the unit's own) */
  dp?: number | null;
  adp?: number | null;
  /** the unit (unset: the drawing's), and whether its name is written */
  u?: UnitId | '' | null;
  ul?: boolean;
  /** written before and after the value */
  pre?: string;
  suf?: string;
  /** a plate behind the text, and its colour */
  bg?: boolean;
  bgc?: string;
  /** the whole look's scale (AutoCAD's DIMSCALE) */
  sc?: number;
  /** a centre mark on radius and diameter dimensions */
  cm?: boolean;
}

/** Where one defining point sits on another mark (that mark's s.gid):
    in its box (u, v from its corner, before its turn), at its end a / b /
    middle m, at its point i, or an arc's centre or middle. */
export interface DimRef {
  g: string;
  u?: number;
  v?: number;
  e?: 'a' | 'b' | 'm';
  i?: number;
  c?: 'c' | 'm';
}

export interface DimXMark {
  t: 'dimx';
  /** opacity 0..1, and its layer's (set by the Layers panel) */
  o?: number;
  lo?: number;
  hide?: boolean;
  /** the source mark's own id, when something refers to it */
  gid?: string;
  [key: string]: unknown;
  k: DimKind;
  /** defining points, then the dimension line's location, then the text's
      place when it has been moved on its own (s.tm) */
  pts: Pt[];
  /** lin, ord: the direction measured along (a unit vector); ord measures
      along it (ax 'x') or across it (ax 'y') */
  dir?: Pt;
  ax?: 'x' | 'y';
  /** ang: 'll', two lines (four points), rather than vertex and two points */
  am?: 'll';
  /** the text has been moved off its own place */
  tm?: boolean;
  /** the text written instead of the measured one; '<>' stands for it */
  label?: string | null;
  sty?: DimStyle;
  ref?: (DimRef | null)[] | null;
  /** lines' colour and weight */
  c: string;
  w: number;
}

/** The look a dimension has with nothing set. Sizes in points on paper. */
export const DIM_STYLE: Readonly<Required<DimStyle>> = {
  th: 7,
  tf: '',
  tb: true,
  ti: false,
  tc: '',
  ah: 'closed',
  as: 6,
  exo: 1.5,
  exe: 2,
  exf: 0,
  tp: 'above',
  ta: 'aligned',
  tg: 1.5,
  dp: null,
  adp: null,
  u: '',
  ul: true,
  pre: '',
  suf: '',
  bg: false,
  bgc: '#FFFFFF',
  sc: 1,
  cm: true,
};

/** A dimension's look, every field filled in. */
export function dimStyle(s: Pick<DimXMark, 'sty'>): Required<DimStyle> {
  const out = { ...DIM_STYLE } as Required<DimStyle>;
  const st = s.sty || {};
  (Object.keys(st) as (keyof DimStyle)[]).forEach((k) => {
    const v = st[k];
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  });
  if (!(out.sc > 0)) out.sc = 1;
  return out;
}

/** How many of the points are defining points. */
export function dimDefCount(s: Pick<DimXMark, 'k' | 'am'>): number {
  switch (s.k) {
    case 'ang':
      return s.am === 'll' ? 4 : 3;
    case 'arc':
      return 4;
    default:
      return 2;
  }
}
/** Where the dimension line's location point is in s.pts. */
export function dimLocIndex(s: Pick<DimXMark, 'k' | 'am'>): number {
  return dimDefCount(s);
}
/** Where the text's own place is in s.pts, or -1 when it has none. */
export function dimTextIndex(s: Pick<DimXMark, 'k' | 'am' | 'tm' | 'pts'>): number {
  const i = dimDefCount(s) + 1;
  return s.tm && s.pts.length > i ? i : -1;
}

/* ---------------- vectors ---------------- */

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt, fb: Pt = [1, 0]): Pt => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : fb;
};
const perp = (a: Pt): Pt => [-a[1], a[0]];
const polar = (c: Pt, ang: number, r: number): Pt => [c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r];
const TAU = Math.PI * 2;
export function normAngle(v: number): number {
  return ((v % TAU) + TAU) % TAU;
}
/** An angle turned so text written along it reads left to right, upright. */
function readable(a: number): number {
  let t = normAngle(a);
  if (t > Math.PI / 2 + 1e-9 && t <= (3 * Math.PI) / 2 + 1e-9) t -= Math.PI;
  return t > Math.PI ? t - TAU : t;
}

/** Where two infinite lines p1-p2 and q1-q2 cross, or null if parallel. */
export function lineCross(p1: Pt, p2: Pt, q1: Pt, q2: Pt): Pt | null {
  const r = sub(p2, p1),
    s = sub(q2, q1);
  const d = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(d) < 1e-9 * (len(r) * len(s) || 1)) return null;
  const t = ((q1[0] - p1[0]) * s[1] - (q1[1] - p1[1]) * s[0]) / d;
  return add(p1, mul(r, t));
}

/** The circle through three points, or null when they are in a line. */
export function circleThrough(p: Pt, q: Pt, r: Pt): { c: Pt; r: number } | null {
  const ax = p[0],
    ay = p[1],
    bx = q[0],
    by = q[1],
    cx = r[0],
    cy = r[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const A = ax * ax + ay * ay,
    B = bx * bx + by * by,
    C = cx * cx + cy * cy;
  const c: Pt = [
    (A * (by - cy) + B * (cy - ay) + C * (ay - by)) / d,
    (A * (cx - bx) + B * (ax - cx) + C * (bx - ax)) / d,
  ];
  return { c, r: Math.hypot(ax - c[0], ay - c[1]) };
}

/* ---------------- measuring ---------------- */

export interface AngFrame {
  /** the vertex, the arc's first ray and how far it sweeps (anticlockwise) */
  V: Pt;
  start: number;
  sweep: number;
  /** how far along the first and second ray the measured geometry runs */
  range: [[number, number], [number, number]];
}

/** Angular: the vertex and the two rays, the arc on the side the dimension
    line's location is on. Three points: the vertex and a point on each arm
    (the angle or its reflex); two lines: the four ways their rays pair up,
    the one the location sits inside. */
export function angFrame(s: Pick<DimXMark, 'pts' | 'am'>, loc: Pt): AngFrame | null {
  const P = s.pts;
  if (s.am === 'll') {
    const V = lineCross(P[0]!, P[1]!, P[2]!, P[3]!);
    if (!V) return null;
    const t1 = Math.atan2(P[1]![1] - P[0]![1], P[1]![0] - P[0]![0]);
    const t2 = Math.atan2(P[3]![1] - P[2]![1], P[3]![0] - P[2]![0]);
    const phi = Math.atan2(loc[1] - V[1], loc[0] - V[0]);
    const rng = (a: Pt, b: Pt, th: number): [number, number] => {
      const d: Pt = [Math.cos(th), Math.sin(th)];
      const ta = Math.max(0, dot(sub(a, V), d)),
        tb = Math.max(0, dot(sub(b, V), d));
      return [Math.min(ta, tb), Math.max(ta, tb)];
    };
    /* a ray of each line, paired four ways; each pair bounds the angle
       under 180° between them, from whichever ray it starts at */
    for (const al of [t1, t1 + Math.PI])
      for (const be of [t2, t2 + Math.PI]) {
        const d = normAngle(be - al);
        if (d < 1e-9 || Math.abs(d - Math.PI) < 1e-9) continue;
        const fromA = d < Math.PI;
        const st0 = fromA ? al : be,
          sw = fromA ? d : TAU - d;
        if (normAngle(phi - st0) <= sw + 1e-9) {
          const r1 = rng(P[0]!, P[1]!, al),
            r2 = rng(P[2]!, P[3]!, be);
          return { V, start: normAngle(st0), sweep: sw, range: fromA ? [r1, r2] : [r2, r1] };
        }
      }
    /* the location exactly on a ray: the angle on its anticlockwise side */
    const d = normAngle(t2 - t1);
    return {
      V,
      start: normAngle(t1),
      sweep: d > Math.PI ? d - Math.PI : d,
      range: [
        [0, 0],
        [0, 0],
      ],
    };
  }
  const V = P[0]!,
    A1 = P[1]!,
    A2 = P[2]!;
  const a1 = Math.atan2(A1[1] - V[1], A1[0] - V[0]),
    a2 = Math.atan2(A2[1] - V[1], A2[0] - V[0]);
  const l1 = len(sub(A1, V)),
    l2 = len(sub(A2, V));
  const phi = Math.atan2(loc[1] - V[1], loc[0] - V[0]);
  const d = normAngle(a2 - a1);
  return normAngle(phi - a1) <= d
    ? {
        V,
        start: normAngle(a1),
        sweep: d,
        range: [
          [0, l1],
          [0, l2],
        ],
      }
    : {
        V,
        start: normAngle(a2),
        sweep: TAU - d,
        range: [
          [0, l2],
          [0, l1],
        ],
      };
}

export interface ArcFrame {
  C: Pt;
  R: number;
  start: number;
  sweep: number;
}
/** Arc length: centre c, the arc from s to e that passes through m. */
export function arcFrame(s: Pick<DimXMark, 'pts'>): ArcFrame {
  const [C, S0, E0, M] = s.pts as [Pt, Pt, Pt, Pt];
  const R = len(sub(S0, C));
  const ts = Math.atan2(S0[1] - C[1], S0[0] - C[0]),
    te = Math.atan2(E0[1] - C[1], E0[0] - C[0]),
    tm = Math.atan2(M[1] - C[1], M[0] - C[0]);
  const d = normAngle(te - ts);
  return normAngle(tm - ts) <= d
    ? { C, R, start: normAngle(ts), sweep: d }
    : { C, R, start: normAngle(te), sweep: TAU - d };
}

/** The direction a linear dimension measures along. */
export function dimDir(s: Pick<DimXMark, 'k' | 'pts' | 'dir'>): Pt {
  if (s.k === 'ali') return unit(sub(s.pts[1]!, s.pts[0]!));
  return unit(s.dir || [1, 0]);
}

/** What a dimension measures: a length in points, or an angle in radians. */
export function dimMeasure(s: DimXMark): { v: number; angle: boolean } {
  const P = s.pts,
    loc = P[dimLocIndex(s)] || P[0]!;
  switch (s.k) {
    case 'lin':
    case 'ali':
      return { v: Math.abs(dot(sub(P[1]!, P[0]!), dimDir(s))), angle: false };
    case 'ang': {
      const f = angFrame(s, loc);
      return { v: f ? f.sweep : 0, angle: true };
    }
    case 'rad':
      return { v: len(sub(P[1]!, P[0]!)), angle: false };
    case 'dia':
      return { v: 2 * len(sub(P[1]!, P[0]!)), angle: false };
    case 'arc': {
      const f = arcFrame(s);
      return { v: f.R * f.sweep, angle: false };
    }
    case 'ord': {
      const X = dimDir(s),
        Y = perp(X);
      return { v: Math.abs(dot(sub(P[1]!, P[0]!), s.ax === 'y' ? Y : X)), angle: false };
    }
  }
  return { v: 0, angle: false };
}

/** The unit a dimension reads in, and how many of it one point makes. */
export function dimUnit(s: Pick<DimXMark, 'sty'>, scale: Scale): { id: UnitId; per: number } {
  const st = dimStyle(s);
  const base: UnitId = isUnit(scale.unit) ? scale.unit : 'mm';
  const id: UnitId = st.u && isUnit(st.u) ? st.u : base;
  /* a calibrated drawing has its own points-to-unit factor, in its unit */
  const per = scale.custom
    ? scale.custom * (UNITS[id].per / UNITS[base].per)
    : UNITS[id].per * (scale.denom || 1);
  return { id, per };
}

/** The measured value as written: rounded, with its unit. */
export function dimValueText(s: DimXMark, scale: Scale): string {
  const st = dimStyle(s);
  const m = dimMeasure(s);
  if (m.angle) {
    const deg = (m.v * 180) / Math.PI;
    if (st.adp != null) return deg.toFixed(Math.max(0, Math.min(8, st.adp))) + '°';
    return (Math.abs(deg - Math.round(deg)) < 0.05 ? String(Math.round(deg)) : deg.toFixed(1)) + '°';
  }
  const u = dimUnit(s, scale);
  const v = m.v * u.per;
  const dp =
    st.dp != null
      ? Math.max(0, Math.min(8, st.dp))
      : scale.custom && !(st.u && st.u !== scale.unit)
        ? v < 10
          ? 2
          : v < 100
            ? 1
            : 0
        : UNITS[u.id].dp;
  const sym = s.k === 'rad' ? 'R' : s.k === 'dia' ? 'Ø' : '';
  return sym + v.toFixed(dp) + (st.ul ? ' ' + UNITS[u.id].label : '');
}

/** What the dimension says: its override (with '<>' for the measured value)
    or the measured value, between its prefix and suffix. */
export function dimText(s: DimXMark, scale: Scale): string {
  const st = dimStyle(s);
  const val = dimValueText(s, scale);
  const core = s.label != null && s.label !== '' ? s.label.replace(/<>/g, val) : val;
  return (st.pre || '') + core + (st.suf || '');
}

/* ---------------- the display list ---------------- */

export interface DimTextPlace {
  str: string;
  /** the middle of the text's box, its turn (radians, anticlockwise), its
      size and width, all in points */
  at: Pt;
  ang: number;
  size: number;
  w: number;
  /** the plate's colour, or null for none */
  bg: string | null;
  /** an arc symbol over it (arc length) */
  arc: boolean;
}

export interface DimDraw {
  /** the dimension line (and leaders, landings), in the line's weight */
  lines: [Pt, Pt][];
  /** extension lines and centre marks */
  ext: [Pt, Pt][];
  /** oblique ticks, heavier */
  heavy: [Pt, Pt][];
  /** arrowheads and arcs: a filled polygon, or an open line */
  polys: { pts: Pt[]; fill: boolean; text?: boolean }[];
  dots: { c: Pt; r: number }[];
  text: DimTextPlace;
  /** the text's plate (four corners) when it has one, and its box always */
  plate: Pt[] | null;
  box: Pt[];
  /** for picking: what can be taken hold of */
  hit: [Pt, Pt][];
  /** for editing: the defining points, the location, the text */
  grips: { def: Pt[]; line: Pt; text: Pt };
  value: number;
}

export type DimMeasureText = (str: string, size: number) => number;

/** The dimension's display list, in PDF points. measure gives a string's
    width at a size in points, in the font the dimension's text is set in. */
export function dimLayout(s: DimXMark, scale: Scale, measure: DimMeasureText): DimDraw {
  const st = dimStyle(s);
  const z = st.sc;
  const as = st.as * z,
    th = st.th * z,
    tg = st.tg * z,
    exo = st.exo * z,
    exe = st.exe * z,
    exf = st.exf * z;
  const P = s.pts;
  const loc = P[dimLocIndex(s)] || P[P.length - 1]!;
  const ti = dimTextIndex(s);
  const moved = ti >= 0 ? P[ti]! : null;
  const str = dimText(s, scale);
  const tw = Math.max(th * 0.5, measure(str, th));

  const D: DimDraw = {
    lines: [],
    ext: [],
    heavy: [],
    polys: [],
    dots: [],
    text: {
      str,
      at: loc,
      ang: 0,
      size: th,
      w: tw,
      bg: st.bg ? st.bgc || '#FFFFFF' : null,
      arc: s.k === 'arc',
    },
    plate: null,
    box: [],
    hit: [],
    grips: { def: P.slice(0, dimDefCount(s)), line: loc, text: loc },
    value: dimMeasure(s).v,
  };

  /* an arrowhead whose tip is at T, pointing along u */
  const arrow = (T: Pt, u: Pt) => {
    const n = perp(u);
    switch (st.ah) {
      case 'closed':
        D.polys.push({
          pts: [T, add(sub(T, mul(u, as)), mul(n, as / 6)), sub(sub(T, mul(u, as)), mul(n, as / 6))],
          fill: true,
        });
        break;
      case 'open':
        D.polys.push({
          pts: [add(sub(T, mul(u, as)), mul(n, as / 4)), T, sub(sub(T, mul(u, as)), mul(n, as / 4))],
          fill: false,
        });
        break;
      case 'oblique': {
        const v = unit(add(u, n));
        D.heavy.push([sub(T, mul(v, as / 2)), add(T, mul(v, as / 2))]);
        break;
      }
      case 'dot':
        D.dots.push({ c: T, r: as / 4 });
        break;
    }
  };
  /* where the text goes, off a point M on the line: along the line's angle
     (aligned) or level; above (out along `out`), on or below it */
  const place = (M: Pt, lineAng: number, out: Pt, radial = false) => {
    const ang = st.ta === 'horizontal' ? 0 : readable(lineAng);
    let at = M;
    if (st.tp !== 'center') {
      const u: Pt = [Math.cos(ang), Math.sin(ang)],
        v = perp(u);
      /* the text box's half-extent across the line */
      const o = unit(out);
      const h = Math.abs(dot(o, u)) * (tw / 2) + Math.abs(dot(o, v)) * (th / 2);
      /* above: on the side the text's own "up" is (or outward, round an arc) */
      let dir = o;
      if (!radial && st.ta !== 'horizontal' && dot(o, v) < 0) dir = mul(o, -1);
      if (st.tp === 'below') dir = mul(dir, -1);
      at = add(M, mul(dir, tg + h));
    }
    D.text.at = at;
    D.text.ang = ang;
  };
  const extLine = (from: Pt, to: Pt, dir: Pt, gap: number, over: number) => {
    /* from the measured point (plus a gap) to past the dimension line */
    const L = dot(sub(to, from), dir);
    const sg = L >= 0 ? 1 : -1;
    const d = mul(dir, sg);
    if (Math.abs(L) <= gap + 0.01 && !exf) return;
    const end = add(to, mul(d, over));
    const start = exf > 0 && Math.abs(L) > exf ? sub(to, mul(d, exf)) : add(from, mul(d, gap));
    D.ext.push([start, end]);
  };
  /* a straight dimension line between A and B, arrows at its ends, inside if
     they fit and outside (pointing in, the line run on past them) if not */
  const dimLine = (A: Pt, B: Pt, textMid: boolean) => {
    const u = unit(sub(B, A));
    const L = len(sub(B, A));
    const inside = L >= 2.2 * as;
    if (inside) {
      arrow(A, mul(u, -1));
      arrow(B, u);
    } else {
      arrow(A, u);
      arrow(B, mul(u, -1));
      D.lines.push([sub(A, mul(u, as * 1.6)), A], [B, add(B, mul(u, as * 1.6))]);
    }
    /* text centred on the line: the line breaks round it */
    if (textMid && st.tp === 'center' && !moved && L > tw + 2 * tg) {
      const M = mul(add(A, B), 0.5),
        g = tw / 2 + tg;
      D.lines.push([A, sub(M, mul(u, g))], [add(M, mul(u, g)), B]);
    } else D.lines.push([A, B]);
    D.hit.push([A, B]);
  };

  switch (s.k) {
    case 'lin':
    case 'ali': {
      const d = dimDir(s),
        n = perp(d);
      const off = dot(loc, n);
      const A = add(P[0]!, mul(n, off - dot(P[0]!, n))),
        B = add(P[1]!, mul(n, off - dot(P[1]!, n)));
      extLine(P[0]!, A, n, exo, exe);
      extLine(P[1]!, B, n, exo, exe);
      dimLine(A, B, true);
      const M = mul(add(A, B), 0.5);
      /* "above": away from the measured points, where the line was pulled to */
      const side = off - (dot(P[0]!, n) + dot(P[1]!, n)) / 2;
      place(M, Math.atan2(d[1], d[0]), mul(n, side >= 0 ? 1 : -1));
      D.grips.line = M;
      break;
    }
    case 'ang': {
      const f = angFrame(s, loc);
      if (!f) break;
      const R = Math.max(1, len(sub(loc, f.V)));
      const arc: Pt[] = [];
      const steps = Math.max(12, Math.ceil(f.sweep * 32));
      for (let i = 0; i <= steps; i++) arc.push(polar(f.V, f.start + (f.sweep * i) / steps, R));
      D.polys.push({ pts: arc, fill: false });
      for (let i = 1; i < arc.length; i++) D.hit.push([arc[i - 1]!, arc[i]!]);
      [f.start, f.start + f.sweep].forEach((t, k) => {
        const [lo, hi] = f.range[k]!;
        if (R > hi + exo) D.ext.push([polar(f.V, t, hi + exo), polar(f.V, t, R + exe)]);
        else if (R < lo - exo) D.ext.push([polar(f.V, t, R - exe), polar(f.V, t, lo - exo)]);
      });
      const e = f.start + f.sweep;
      const inside = R * f.sweep >= 2.2 * as;
      const u0: Pt = [Math.sin(f.start), -Math.cos(f.start)],
        u1: Pt = [-Math.sin(e), Math.cos(e)];
      arrow(polar(f.V, f.start, R), inside ? u0 : mul(u0, -1));
      arrow(polar(f.V, e, R), inside ? u1 : mul(u1, -1));
      const tm = f.start + f.sweep / 2;
      const M = polar(f.V, tm, R);
      place(M, tm + Math.PI / 2, [Math.cos(tm), Math.sin(tm)], true);
      D.grips.line = M;
      break;
    }
    case 'arc': {
      const f = arcFrame(s);
      const R = Math.max(1, len(sub(loc, f.C)));
      const arc: Pt[] = [];
      const steps = Math.max(12, Math.ceil(f.sweep * 32));
      for (let i = 0; i <= steps; i++) arc.push(polar(f.C, f.start + (f.sweep * i) / steps, R));
      D.polys.push({ pts: arc, fill: false });
      for (let i = 1; i < arc.length; i++) D.hit.push([arc[i - 1]!, arc[i]!]);
      [f.start, f.start + f.sweep].forEach((t) => {
        if (R > f.R + exo) D.ext.push([polar(f.C, t, f.R + exo), polar(f.C, t, R + exe)]);
        else if (R < f.R - exo) D.ext.push([polar(f.C, t, R - exe), polar(f.C, t, f.R - exo)]);
      });
      const e = f.start + f.sweep;
      const inside = R * f.sweep >= 2.2 * as;
      const u0: Pt = [Math.sin(f.start), -Math.cos(f.start)],
        u1: Pt = [-Math.sin(e), Math.cos(e)];
      arrow(polar(f.C, f.start, R), inside ? u0 : mul(u0, -1));
      arrow(polar(f.C, e, R), inside ? u1 : mul(u1, -1));
      const tm = f.start + f.sweep / 2;
      const M = polar(f.C, tm, R);
      place(M, tm + Math.PI / 2, [Math.cos(tm), Math.sin(tm)], true);
      D.grips.line = M;
      break;
    }
    case 'rad':
    case 'dia': {
      const C = P[0]!,
        R = len(sub(P[1]!, C));
      const u = unit(sub(loc, C), unit(sub(P[1]!, C)));
      const P1 = add(C, mul(u, R)),
        P2 = sub(C, mul(u, R));
      if (st.cm) {
        const h = as / 2;
        D.ext.push([sub(C, [h, 0]), add(C, [h, 0])], [sub(C, [0, h]), add(C, [0, h])]);
      }
      const outside = len(sub(loc, C)) > R + 0.5;
      if (!outside) {
        const from = s.k === 'dia' ? P2 : C;
        D.lines.push([from, P1]);
        D.hit.push([from, P1]);
        arrow(P1, u);
        if (s.k === 'dia') arrow(P2, mul(u, -1));
        place(loc, Math.atan2(u[1], u[0]), perp(u));
      } else {
        /* out past the edge: a leader to the edge, a level landing, the text on it */
        const from = s.k === 'dia' ? P2 : P1;
        D.lines.push([from, loc]);
        D.hit.push([from, loc]);
        arrow(P1, s.k === 'dia' ? u : mul(u, -1));
        if (s.k === 'dia') arrow(P2, mul(u, -1));
        const sx = u[0] >= 0 ? 1 : -1;
        const land = st.tp === 'center' ? as : tw + 2 * tg;
        const end: Pt = [loc[0] + sx * land, loc[1]];
        D.lines.push([loc, end]);
        D.hit.push([loc, end]);
        if (st.tp === 'center') D.text.at = [end[0] + sx * (tg + tw / 2), end[1]];
        else {
          const mid: Pt = [loc[0] + (sx * land) / 2, loc[1]];
          D.text.at = [mid[0], mid[1] + (st.tp === 'below' ? -1 : 1) * (tg + th / 2)];
        }
        D.text.ang = 0;
      }
      D.grips.line = loc;
      break;
    }
    case 'ord': {
      const F = P[1]!;
      const X = dimDir(s),
        Y = perp(X);
      /* an X ordinate's leader runs across the X axis, along Y; a Y one along X */
      const along = s.ax === 'y' ? X : Y,
        across = s.ax === 'y' ? Y : X;
      const h = dot(sub(loc, F), along),
        dx = dot(sub(loc, F), across);
      const sg = h >= 0 ? 1 : -1;
      const lead = mul(along, sg);
      const start = add(F, mul(lead, exo));
      const end = add(F, add(mul(along, h), mul(across, dx)));
      if (Math.abs(dx) < 0.5) {
        D.lines.push([start, add(F, mul(along, h))]);
      } else {
        /* a jog halfway, as AutoCAD's */
        const j1 = add(F, mul(along, h * 0.45)),
          j2 = add(F, add(mul(along, h * 0.55), mul(across, dx)));
        D.lines.push([start, j1], [j1, j2], [j2, end]);
      }
      D.lines.forEach((l) => D.hit.push(l));
      const ang = st.ta === 'horizontal' ? 0 : readable(Math.atan2(lead[1], lead[0]));
      const tu: Pt = [Math.cos(ang), Math.sin(ang)],
        tv = perp(tu);
      const ext = Math.abs(dot(lead, tu)) * (tw / 2) + Math.abs(dot(lead, tv)) * (th / 2);
      D.text.at = add(end, mul(lead, tg + ext));
      D.text.ang = ang;
      D.grips.line = end;
      break;
    }
  }

  /* the text moved on its own: there it is, with a leader back to the line
     when it has gone well clear of it */
  if (moved) {
    const from = D.text.at;
    D.text.at = moved;
    const far = len(sub(moved, from)) > th * 1.5;
    if (far && s.k !== 'ord' && s.k !== 'rad' && s.k !== 'dia') {
      const u: Pt = [Math.cos(D.text.ang), Math.sin(D.text.ang)],
        v = perp(u);
      const toward = sub(D.grips.line, moved);
      const e = add(
        moved,
        Math.abs(dot(toward, v)) * (tw / 2) > Math.abs(dot(toward, u)) * (th / 2)
          ? mul(v, (dot(toward, v) >= 0 ? 1 : -1) * (th / 2 + tg / 2))
          : mul(u, (dot(toward, u) >= 0 ? 1 : -1) * (tw / 2 + tg / 2)),
      );
      D.lines.push([D.grips.line, e]);
    }
  }

  /* the text's box, and its plate */
  {
    const T = D.text,
      u: Pt = [Math.cos(T.ang), Math.sin(T.ang)],
      v = perp(u);
    const hw = T.w / 2 + tg * 0.6,
      hh = (th * 1.15) / 2;
    const corner = (a: number, b: number) => add(T.at, add(mul(u, a), mul(v, b)));
    D.box = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
    if (T.bg) D.plate = D.box;
    for (let i = 0; i < 4; i++) D.hit.push([D.box[i]!, D.box[(i + 1) % 4]!]);
    D.grips.text = T.at;
    if (T.arc) {
      /* the arc symbol over the text, as AutoCAD writes an arc length */
      const aw = Math.min(T.w * 0.42, th * 0.7),
        y0 = th * 0.48,
        ah = th * 0.22;
      const pts: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = -1 + i / 5;
        pts.push(corner(t * aw, y0 + Math.sqrt(Math.max(0, 1 - t * t)) * ah));
      }
      D.polys.push({ pts, fill: false, text: true });
    }
  }
  return D;
}

/** Where the text's baseline starts: its box's middle, back half its width
    along it and down to the baseline (a capital's middle is ~0.36 of the
    size above it). Shared by the PDF and the SVG. */
export function dimTextOrigin(T: DimTextPlace): Pt {
  const u: Pt = [Math.cos(T.ang), Math.sin(T.ang)],
    v = perp(u);
  return sub(sub(T.at, mul(u, T.w / 2)), mul(v, T.size * 0.36));
}

/* ---------------- SVG ---------------- */

export interface SvgFont {
  family: string;
  weight: string;
  style: string;
}
const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n4 = (v: number) => +v.toFixed(3);
const pt = (p: Pt) => n4(p[0]) + ' ' + n4(p[1]);

/** The display list as SVG, in PDF points (y up): put it inside a group
    that maps PDF points onto the page (the page's own viewport transform on
    screen, or a flip for a file). minW is the thinnest a line may be drawn,
    in points (on screen, a hairline stays visible however far out). */
export function dimSvgMarkup(
  D: DimDraw,
  s: Pick<DimXMark, 'c' | 'w' | 'sty'> & { o?: number },
  font: SvgFont,
  minW = 0,
): string {
  const st = dimStyle(s as DimXMark);
  const col = esc(s.c),
    tcol = esc(st.tc || s.c);
  const w = Math.max(minW, s.w || 0.5);
  const op = s.o != null && s.o < 1 ? ' opacity="' + n4(Math.max(0, s.o)) + '"' : '';
  const seg = (L: [Pt, Pt][]) => L.map((l) => 'M' + pt(l[0]) + 'L' + pt(l[1])).join('');
  let out = '<g class="dimx-art"' + op + '>';
  const lines = seg(D.lines);
  if (lines)
    out +=
      '<path d="' +
      lines +
      '" fill="none" stroke="' +
      col +
      '" stroke-width="' +
      n4(w) +
      '" stroke-linecap="butt"/>';
  const ext = seg(D.ext);
  if (ext)
    out +=
      '<path d="' +
      ext +
      '" fill="none" stroke="' +
      col +
      '" stroke-width="' +
      n4(w) +
      '" stroke-linecap="butt"/>';
  const heavy = seg(D.heavy);
  if (heavy)
    out +=
      '<path d="' +
      heavy +
      '" fill="none" stroke="' +
      col +
      '" stroke-width="' +
      n4(w * 2) +
      '" stroke-linecap="butt"/>';
  D.polys.forEach((p) => {
    const d = 'M' + p.pts.map(pt).join('L') + (p.fill ? 'Z' : '');
    const c = p.text ? tcol : col;
    out += p.fill
      ? '<path d="' +
        d +
        '" fill="' +
        c +
        '" stroke="' +
        c +
        '" stroke-width="' +
        n4(w * 0.5) +
        '" stroke-linejoin="miter"/>'
      : '<path d="' +
        d +
        '" fill="none" stroke="' +
        c +
        '" stroke-width="' +
        n4(w) +
        '" stroke-linejoin="round"/>';
  });
  D.dots.forEach((d) => {
    out += '<circle cx="' + n4(d.c[0]) + '" cy="' + n4(d.c[1]) + '" r="' + n4(d.r) + '" fill="' + col + '"/>';
  });
  if (D.plate)
    out += '<path d="M' + D.plate.map(pt).join('L') + 'Z" fill="' + esc(D.text.bg || '#FFFFFF') + '"/>';
  const T = D.text,
    o = dimTextOrigin(T);
  const deg = (T.ang * 180) / Math.PI;
  /* glyphs upright in a y-up space: the text is turned and flipped back */
  out +=
    '<text transform="translate(' +
    pt(o) +
    ') rotate(' +
    n4(deg) +
    ') scale(1 -1)" x="0" y="0" ' +
    'font-family="' +
    esc(font.family) +
    '" font-weight="' +
    esc(font.weight) +
    '" font-style="' +
    esc(font.style) +
    '" font-size="' +
    n4(T.size) +
    '" fill="' +
    tcol +
    '">' +
    esc(T.str) +
    '</text>';
  return out + '</g>';
}

/* ---------------- association ---------------- */

/* marks whose a and b are the corners of a box they fill (turned by s.r) */
const BOX_MARKS: Record<string, 1> = { rect: 1, ellipse: 1, cloud: 1, redact: 1 };
/* marks that are a chord from a to b */
const END_MARKS: Record<string, 1> = { line: 1, arrow: 1, arc: 1, dim: 1 };

type Anyish = AnyMark & { a?: Pt; b?: Pt | boolean; r?: number; pts?: Pt[] };

/** The centre and middle of an Arc mark (its chord is a to b). */
export function arcMarkCircle(s: ArcMark): { c: Pt; r: number; mid: Pt } | null {
  const P = arcPts(s, 2);
  if (P.length < 3) return null;
  const c = circleThrough(P[0]!, P[1]!, P[2]!);
  return c ? { c: c.c, r: c.r, mid: P[1]! } : null;
}

/** Where a reference points to on its mark now, or null if it cannot say. */
export function refPoint(src: AnyMark, r: DimRef): Pt | null {
  const s = src as Anyish;
  if (r.i != null) {
    const P = s.pts;
    return P && P[r.i] ? [P[r.i]![0], P[r.i]![1]] : null;
  }
  if (r.c && s.t === 'arc' && s.a && Array.isArray(s.b)) {
    const k = arcMarkCircle(s as unknown as ArcMark);
    if (!k) return null;
    return r.c === 'c' ? k.c : k.mid;
  }
  if (r.e && s.a && Array.isArray(s.b)) {
    if (r.e === 'a') return [s.a[0], s.a[1]];
    if (r.e === 'b') return [s.b[0], s.b[1]];
    return [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  }
  if (r.u != null && r.v != null && s.a && Array.isArray(s.b)) {
    const b = boxOf({ a: s.a, b: s.b });
    const q: Pt = [b.x1 + r.u * (b.x2 - b.x1), b.y1 + r.v * (b.y2 - b.y1)];
    return s.r ? rotPt(q, [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2], s.r) : q;
  }
  return null;
}

/** A reference to point p on mark src (whose s.gid is g), or null when p
    is not one of its points. A box mark takes any point (it is held where
    it is in the box, so it follows a resize), a chord its ends and middle
    (and an arc its centre and middle), a path its points. */
export function makeRef(src: AnyMark, p: Pt, g: string, tol = 0.05): DimRef | null {
  const s = src as Anyish;
  const near = (q: Pt | null | undefined) => !!q && Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol;
  if (s.pts && !s.a) {
    for (let i = 0; i < s.pts.length; i++) if (near(s.pts[i])) return { g, i };
    return null;
  }
  if (!s.a || !Array.isArray(s.b)) return null;
  if (BOX_MARKS[s.t]) {
    const b = boxOf({ a: s.a, b: s.b });
    const c: Pt = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
    const q = s.r ? rotPt(p, c, -s.r) : p;
    const w = b.x2 - b.x1,
      h = b.y2 - b.y1;
    return { g, u: w > 1e-9 ? (q[0] - b.x1) / w : 0.5, v: h > 1e-9 ? (q[1] - b.y1) / h : 0.5 };
  }
  if (END_MARKS[s.t]) {
    for (const e of ['a', 'b', 'm'] as const) if (near(refPoint(s, { g, e }))) return { g, e };
    if (s.t === 'arc') for (const c of ['c', 'm'] as const) if (near(refPoint(s, { g, c }))) return { g, c };
  }
  return null;
}

/** Brings every associated dimension back onto the geometry it measures.
    Points are replaced, never changed in place (undo keeps the old ones).
    A dimension whose defining points all moved by one same step (its
    geometry was moved) takes its line and text along; when they moved
    differently (resized, reshaped) its line stays where it was put. A
    reference to a mark no longer there is kept, and ignored. True if any
    dimension changed. */
export function resolveDims(shapes: readonly AnyMark[]): boolean {
  let byGid: Map<string, AnyMark> | null = null;
  let changed = false;
  for (const m of shapes) {
    if (m.t !== 'dimx') continue;
    const s = m as unknown as DimXMark;
    if (!s.ref || !s.ref.length || !s.pts) continue;
    if (!byGid) {
      byGid = new Map();
      for (const q of shapes) {
        const g = (q as { gid?: string }).gid;
        if (g) byGid.set(g, q);
      }
    }
    const nd = dimDefCount(s);
    let pts: Pt[] | null = null;
    const steps: Pt[] = [];
    for (let i = 0; i < nd; i++) {
      const r = s.ref[i];
      const src = r ? byGid.get(r.g) : undefined;
      if (!r || !src || src === m) continue;
      const q = refPoint(src, r);
      if (!q) continue;
      const cur = s.pts[i]!;
      const d: Pt = [q[0] - cur[0], q[1] - cur[1]];
      steps.push(d);
      if (Math.abs(d[0]) < 1e-7 && Math.abs(d[1]) < 1e-7) continue;
      if (!pts) pts = s.pts.map((p) => [p[0], p[1]] as Pt);
      pts[i] = q;
    }
    if (!pts) continue;
    /* every defining point held, and all stepped alike: the geometry moved */
    const s0 = steps[0]!;
    const rigid =
      steps.length === nd &&
      steps.every((d) => Math.abs(d[0] - s0[0]) < 1e-6 && Math.abs(d[1] - s0[1]) < 1e-6);
    if (rigid) for (let i = nd; i < pts.length; i++) pts[i] = [pts[i]![0] + s0[0], pts[i]![1] + s0[1]];
    s.pts = pts;
    changed = true;
  }
  return changed;
}
