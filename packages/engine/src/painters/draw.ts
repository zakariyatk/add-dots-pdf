/* Circle, revision cloud, arc and the dimensions: their geometry and how they
   are written into the PDF. Moved from draw.js.

   Every curve is a list of points, so the screen and the saved PDF draw the
   identical line. The dimension readings depend on the drawing scale, which
   belongs to the editor, so the painters take it through getScale(). */

import { degrees, rgb, type PDFPage } from 'pdf-lib';
import { arrowHead, boxOf, rotPt } from '../geometry';
import { formatLength, type Scale } from '../measure';
import type { Mark, Pt } from '../model';
import { hexRgb } from '../save';
import { shOp } from '../style';
import { fillPolygon, paintPts, type FontNeed, type Painter } from './common';

/* ---------------- geometry ---------------- */

/** An ellipse as a ring of points, in PDF space, turned by s.r. */
export function ellipsePts(s: Pick<Mark, 'a' | 'b' | 'r'>, steps: number): Pt[] {
  const b = boxOf(s);
  const cx = (b.x1 + b.x2) / 2,
    cy = (b.y1 + b.y2) / 2;
  const rx = (b.x2 - b.x1) / 2,
    ry = (b.y2 - b.y1) / 2;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p: Pt = [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
    out.push(s.r ? rotPt(p, [cx, cy], s.r) : p);
  }
  return out;
}

export interface ArcMark extends Mark {
  /** How far the arc bulges, as a fraction of the chord (default 0.25). */
  bulge?: number;
}

/** A circular arc through a and b, bulging by `bulge` of the chord length. */
export function arcPts(s: ArcMark, steps: number): Pt[] {
  const ax = s.a[0],
    ay = s.a[1],
    bx = s.b[0],
    by = s.b[1];
  const dx = bx - ax,
    dy = by - ay;
  const chord = Math.hypot(dx, dy);
  const k = s.bulge == null ? 0.25 : s.bulge;
  const h = chord * k; /* sagitta */
  if (chord < 0.01)
    return [
      [ax, ay],
      [bx, by],
    ];
  if (Math.abs(h) < 0.01)
    return [
      [ax, ay],
      [bx, by],
    ];

  /* unit normal to the chord: which side it bulges */
  const nx = -dy / chord,
    ny = dx / chord;
  const mx = (ax + bx) / 2,
    my = (ay + by) / 2;
  const peak = [mx + nx * h, my + ny * h];

  /* circle through a, peak, b: R from chord and sagitta */
  const R = Math.abs(h) / 2 + (chord * chord) / (8 * Math.abs(h));
  const sign = h >= 0 ? 1 : -1;
  const cxc = mx + nx * (h - sign * R);
  const cyc = my + ny * (h - sign * R);

  const a0 = Math.atan2(ay - cyc, ax - cxc);
  const a1 = Math.atan2(by - cyc, bx - cxc);
  const ap = Math.atan2(peak[1]! - cyc, peak[0]! - cxc);

  /* walk the way round that actually passes through the peak */
  const norm = (t: number) => {
    while (t < 0) t += Math.PI * 2;
    while (t >= Math.PI * 2) t -= Math.PI * 2;
    return t;
  };
  let sweep = norm(a1 - a0);
  const toPeak = norm(ap - a0);
  if (toPeak > sweep) sweep -= Math.PI * 2;

  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + sweep * (i / steps);
    out.push([cxc + R * Math.cos(t), cyc + R * Math.sin(t)]);
  }
  return out;
}

export interface CloudMark extends Mark {
  /** Scallop radius in points (default 9, at least 4). */
  arc?: number;
}

/** A revision cloud: the box perimeter walked with semicircular bumps pushed
    outward. Each edge is divided evenly, so no stub is left at the end. */
export function cloudPts(s: CloudMark, perBump: number): Pt[] {
  const b = boxOf(s);
  const r = Math.max(4, s.arc == null ? 9 : s.arc);
  const corners: Pt[] = [
    [b.x1, b.y1],
    [b.x2, b.y1],
    [b.x2, b.y2],
    [b.x1, b.y2],
  ];
  const cx = (b.x1 + b.x2) / 2,
    cy = (b.y1 + b.y2) / 2;
  const out: Pt[] = [];

  for (let e = 0; e < 4; e++) {
    const p0 = corners[e]!,
      p1 = corners[(e + 1) % 4]!;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const n = Math.max(1, Math.round(len / (r * 2)));
    const ux = (p1[0] - p0[0]) / len,
      uy = (p1[1] - p0[1]) / len;
    /* outward normal: the edges run clockwise, so this points away */
    const nx = uy,
      ny = -ux;
    const step = len / n;

    for (let i = 0; i < n; i++) {
      const s0 = [p0[0] + ux * step * i, p0[1] + uy * step * i];
      const mx = s0[0]! + (ux * step) / 2,
        my = s0[1]! + (uy * step) / 2;
      const rad = step / 2;
      const peak = [mx + nx * rad, my + ny * rad];
      /* a half turn from s0 to s1, bulging through peak */
      const base = Math.atan2(s0[1]! - my, s0[0]! - mx);
      const dir = (peak[0]! - mx) * -Math.sin(base) + (peak[1]! - my) * Math.cos(base) >= 0 ? 1 : -1;
      for (let k = 0; k <= perBump; k++) {
        const t = base + dir * Math.PI * (k / perBump);
        out.push([mx + rad * Math.cos(t), my + rad * Math.sin(t)]);
      }
    }
  }
  out.push(out[0]!);
  return s.r ? out.map((p) => rotPt(p, [cx, cy], s.r)) : out;
}

/* ---- dimensions ---- */

export interface DimMark extends Mark {
  t: 'dim' | 'dimr' | 'dimd' | 'dima';
  /** End style: arrow (default), tick or dot. */
  ds?: 'arrow' | 'tick' | 'dot';
  /** A typed-in reading that replaces the measured one. */
  label?: string | null;
  /** dimr/dimd: radius, with a the centre and b where the reading sits. */
  rad?: number;
  /** dima: the arms' directions (radians) and how far along each they were picked. */
  a1?: number;
  a2?: number;
  l1?: number;
  l2?: number;
}

/** Radius and diameter: a is the centre, rad the radius, b where the reading sits. */
export function radGeom(s: DimMark) {
  const dx = s.b[0] - s.a[0],
    dy = s.b[1] - s.a[1];
  const d = Math.hypot(dx, dy);
  const u: Pt = d > 0.01 ? [dx / d, dy / d] : [1, 0];
  const rad = s.rad!;
  return {
    u,
    near: [s.a[0] + u[0] * rad, s.a[1] + u[1] * rad] as Pt,
    far: [s.a[0] - u[0] * rad, s.a[1] - u[1] * rad] as Pt,
    outside: d > rad + 0.5,
  };
}

export function normAng(v: number): number {
  const T = Math.PI * 2;
  return ((v % T) + T) % T;
}

export interface AngGeom {
  r: number;
  start: number;
  sweep: number;
}

/** Angular: a is the vertex, a1/a2 the arms, b a point on the arc. The arc takes
    whichever side of the arms b is on, so one corner can read 60° or 300°. */
export function angGeom(s: DimMark): AngGeom {
  const r = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  const pa = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
  const d = normAng(s.a2! - s.a1!);
  return normAng(pa - s.a1!) <= d
    ? { r, start: s.a1!, sweep: d }
    : { r, start: s.a2!, sweep: Math.PI * 2 - d };
}
export function angPt(s: Pick<Mark, 'a'>, ang: number, r: number): Pt {
  return [s.a[0] + Math.cos(ang) * r, s.a[1] + Math.sin(ang) * r];
}
export function arcPtsOf(s: Pick<Mark, 'a'>, g: AngGeom): Pt[] {
  const n = Math.max(12, Math.ceil(Math.abs(g.sweep) * 24));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(angPt(s, g.start + (g.sweep * i) / n, g.r));
  return out;
}
export function armExtensions(s: DimMark, g: AngGeom): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  (
    [
      [s.a1!, s.l1!],
      [s.a2!, s.l2!],
    ] as const
  ).forEach((arm) => {
    if (g.r > arm[1] + 3) out.push([angPt(s, arm[0], arm[1] + 2), angPt(s, arm[0], g.r + 3)]);
  });
  return out;
}
export function angEnds(s: DimMark, g: AngGeom): { p: Pt; u: Pt }[] {
  const e = g.start + g.sweep;
  return [
    { p: angPt(s, g.start, g.r), u: [Math.sin(g.start), -Math.cos(g.start)] },
    { p: angPt(s, e, g.r), u: [-Math.sin(e), Math.cos(e)] },
  ];
}
export function angLabelPt(s: DimMark, g: AngGeom, size: number): Pt {
  return angPt(s, g.start + g.sweep / 2, g.r + 3 + size * 0.75);
}

/** The reading's size on paper, in points; thin lines keep a readable 10pt. */
export function dimTextPt(s: Pick<Mark, 'w'>): number {
  return Math.max(10, Math.min(14, s.w * 4 + 6));
}

/** What a dimension reads, under this scale. */
export function dimLabel(s: DimMark, scale: Scale): string {
  if (s.label != null && s.label !== '') return s.label;
  if (s.t === 'dimr') return 'R' + formatLength(s.rad!, scale);
  if (s.t === 'dimd') return 'Ø' + formatLength(s.rad! * 2, scale);
  if (s.t === 'dima') {
    const deg = (Math.abs(angGeom(s).sweep) * 180) / Math.PI;
    return (Math.abs(deg - Math.round(deg)) < 0.05 ? String(Math.round(deg)) : deg.toFixed(1)) + '°';
  }
  return formatLength(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), scale);
}

/* ---------------- writing into the PDF ---------------- */

/** One end of a dimension: P is the end, u points outward along the line. */
function endPaint(p: PDFPage, P: Pt, u: Pt, s: DimMark): void {
  const col = hexRgb(s.c),
    th = s.w,
    op = shOp(s),
    st = s.ds || 'arrow';
  if (st === 'tick') {
    const h = 3.5 + th * 1.2;
    const tx = ((u[0] - u[1]) / Math.SQRT2) * h,
      ty = ((u[1] + u[0]) / Math.SQRT2) * h;
    p.drawLine({
      start: { x: P[0] - tx, y: P[1] - ty },
      end: { x: P[0] + tx, y: P[1] + ty },
      thickness: th * 1.8,
      color: col,
      opacity: op,
    });
  } else if (st === 'dot') {
    p.drawCircle({ x: P[0], y: P[1], size: 1.6 + th * 0.9, color: col, opacity: op, borderWidth: 0 });
  } else {
    arrowHead(P[0] - u[0] * 10, P[1] - u[1] * 10, P[0], P[1], th * 1.1).forEach((q) => {
      p.drawLine({
        start: { x: q[0], y: q[1] },
        end: { x: P[0], y: P[1] },
        thickness: th,
        color: col,
        opacity: op,
      });
    });
  }
}

export interface EllipseMark extends Mark {
  t: 'ellipse';
}

/** The painters for circle, cloud, arc and the dimensions. getScale is read at
    save time, so the readings match what the editor shows. */
export function drawPainters(getScale: () => Scale): Record<string, Painter> {
  const ellipse: Painter = (p, s: EllipseMark) => {
    /* a filled ellipse is one operator and hairline-accurate, so use the
       native call whenever there is no dash pattern to honour and no turn.
       (v1 tested s.dash, which nothing sets; the dash style is s.d.) */
    const b = boxOf(s);
    if (!s.d && !s.r) {
      const opts: Parameters<PDFPage['drawEllipse']>[0] = {
        x: (b.x1 + b.x2) / 2,
        y: (b.y1 + b.y2) / 2,
        xScale: (b.x2 - b.x1) / 2,
        yScale: (b.y2 - b.y1) / 2,
        borderColor: hexRgb(s.c),
        borderWidth: s.w,
        borderOpacity: shOp(s),
      };
      if (s.fill) {
        opts.color = hexRgb(s.fill);
        opts.opacity = shOp(s);
      }
      p.drawEllipse(opts);
      return;
    }
    /* dashed or turned: the same ring of points as the screen, filled first so
       the outline sits on top */
    const ring = ellipsePts(s, 96);
    if (s.fill) fillPolygon(p, ring, hexRgb(s.fill), shOp(s));
    paintPts(p, ring, s);
  };

  const cloud: Painter = (p, s: CloudMark) => paintPts(p, cloudPts(s, 8), s, true);
  const arc: Painter = (p, s: ArcMark) => paintPts(p, arcPts(s, 64), s);

  const dim: Painter = (p, s: DimMark, ctx) => {
    const col = hexRgb(s.c),
      th = s.w,
      op = shOp(s);
    const st = s.ds || 'arrow';
    const A = { x: s.a[0], y: s.a[1] },
      B = { x: s.b[0], y: s.b[1] };
    p.drawLine({ start: A, end: B, thickness: th, color: col, opacity: op });

    const dx = B.x - A.x,
      dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len,
      uy = dy / len;
    const tick = st === 'arrow' ? 4 + th : 6 + th;
    const nx = -uy * tick,
      ny = ux * tick;
    [A, B].forEach((e) => {
      p.drawLine({
        start: { x: e.x - nx, y: e.y - ny },
        end: { x: e.x + nx, y: e.y + ny },
        thickness: th,
        color: col,
        opacity: op,
      });
    });
    if (st === 'tick') {
      /* the 45° slash; page space runs y up, so this is the screen's slash
         seen the right way round */
      const h = 3.5 + th * 1.2;
      const tx = ((ux - uy) / Math.SQRT2) * h,
        ty = ((uy + ux) / Math.SQRT2) * h;
      [A, B].forEach((e) => {
        p.drawLine({
          start: { x: e.x - tx, y: e.y - ty },
          end: { x: e.x + tx, y: e.y + ty },
          thickness: th * 1.8,
          color: col,
          opacity: op,
        });
      });
    } else if (st === 'dot') {
      const r = 1.6 + th * 0.9;
      [A, B].forEach((e) => {
        p.drawCircle({ x: e.x, y: e.y, size: r, color: col, opacity: op, borderWidth: 0 });
      });
    } else {
      [
        [B, A],
        [A, B],
      ].forEach((pair) => {
        const h = arrowHead(pair[1]!.x, pair[1]!.y, pair[0]!.x, pair[0]!.y, th * 1.1);
        h.forEach((q) => {
          p.drawLine({
            start: { x: q[0], y: q[1] },
            end: { x: pair[0]!.x, y: pair[0]!.y },
            thickness: th,
            color: col,
            opacity: op,
          });
        });
      });
    }

    const font = ctx.fonts.HelveticaBold;
    if (!font) return;
    const text = dimLabel(s, getScale());
    const size = dimTextPt(s);
    const tw = font.widthOfTextAtSize(text, size);
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    const t = (ang * Math.PI) / 180;

    /* step back half the string along the baseline and lift it clear of the
       line, then turn: pdf-lib rotates text about its own origin */
    const mx = (A.x + B.x) / 2,
      my = (A.y + B.y) / 2;
    /* ticks and dots: the whole reading clear above the line, as on screen
       (its middle half a size up, and a capital's middle is ~0.36 size above
       the baseline) */
    const lift = st === 'arrow' ? th + 2 : th + 2 + size * 0.14;
    const ox = mx - (Math.cos(t) * tw) / 2 - Math.sin(t) * lift;
    const oy = my - (Math.sin(t) * tw) / 2 + Math.cos(t) * lift;

    /* a pale plate behind it, so the reading survives a busy drawing */
    if (st === 'arrow')
      p.drawRectangle({
        x: ox - Math.cos(t) * 2 + Math.sin(t) * 1.5,
        y: oy - Math.sin(t) * 2 - Math.cos(t) * 1.5,
        width: tw + 4,
        height: size + 3,
        rotate: degrees(ang),
        color: rgb(1, 1, 1),
        opacity: 0.8,
        borderWidth: 0,
      });
    p.drawText(text, { x: ox, y: oy, size, font, color: col, rotate: degrees(ang) });
  };

  /* radius and diameter: a leader through the centre, the reading on a short
     landing beside it */
  const radial: Painter = (p, s: DimMark, ctx) => {
    const col = hexRgb(s.c),
      th = s.w,
      op = shOp(s),
      G = radGeom(s);
    const from = s.t === 'dimd' ? G.far : s.a,
      to = G.outside ? s.b : G.near;
    p.drawLine({
      start: { x: from[0], y: from[1] },
      end: { x: to[0], y: to[1] },
      thickness: th,
      color: col,
      opacity: op,
    });
    endPaint(p, G.near, G.u, s);
    if (s.t === 'dimd') endPaint(p, G.far, [-G.u[0], -G.u[1]], s);

    const font = ctx.fonts.HelveticaBold;
    if (!font) return;
    const text = dimLabel(s, getScale()),
      size = dimTextPt(s);
    const tw = font.widthOfTextAtSize(text, size);
    const y = s.b[1] + th + 2;
    if (G.outside) {
      const dir = s.b[0] >= s.a[0] ? 1 : -1;
      p.drawLine({
        start: { x: s.b[0], y: s.b[1] },
        end: { x: s.b[0] + dir * (tw + 4), y: s.b[1] },
        thickness: th,
        color: col,
        opacity: op,
      });
      p.drawText(text, { x: dir > 0 ? s.b[0] + 2 : s.b[0] - 2 - tw, y, size, font, color: col });
    } else {
      p.drawText(text, { x: s.b[0] - tw / 2, y, size, font, color: col });
    }
  };

  /* angular: an arc between the arms, with extension lines out to it when it
     sits beyond where the arms were picked */
  const dima: Painter = (p, s: DimMark, ctx) => {
    const col = hexRgb(s.c),
      th = s.w,
      op = shOp(s),
      G = angGeom(s);
    paintPts(p, arcPtsOf(s, G), s);
    armExtensions(s, G).forEach((seg) => {
      p.drawLine({
        start: { x: seg[0][0], y: seg[0][1] },
        end: { x: seg[1][0], y: seg[1][1] },
        thickness: th,
        color: col,
        opacity: op,
      });
    });
    angEnds(s, G).forEach((e) => endPaint(p, e.p, e.u, s));
    const font = ctx.fonts.HelveticaBold;
    if (!font) return;
    const text = dimLabel(s, getScale()),
      size = dimTextPt(s);
    const L = angLabelPt(s, G, size),
      tw = font.widthOfTextAtSize(text, size);
    p.drawText(text, { x: L[0] - tw / 2, y: L[1] - size * 0.36, size, font, color: col });
  };

  return { ellipse, cloud, arc, dim, dimr: radial, dimd: radial, dima };
}

const bold: FontNeed = () => 'HelveticaBold';
export const drawFontNeeds: Record<string, FontNeed> = { dim: bold, dimr: bold, dimd: bold, dima: bold };
