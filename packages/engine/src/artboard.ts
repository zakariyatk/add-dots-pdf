/* The artboard and the pasteboard, as Illustrator has them.

   A page is the artboard: what is saved and printed. Marks may sit anywhere
   around it, on the pasteboard, and stay there while the document is worked
   on (and in an editable PDF, project.ts). A standard PDF takes only what
   lies on the artboard: a mark wholly off it is left out, and one across
   its edge is cut at the edge (a clip round everything painted onto the
   page, save.ts). */

import { rotPt, textRect, type MeasureText } from './geometry';
import type { AnyMark, Pt, TextMark } from './model';

export interface Box4 {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/* how far past its points a mark may draw: stroke, arrowheads, a
   dimension's text and arrows, a callout's text, a cloud's bumps */
const REACH: Record<string, number> = {
  dimx: 80,
  dim: 40,
  dimr: 60,
  dimd: 60,
  dima: 40,
  leader: 80,
  cloud: 16,
  pin: 24,
};

/** A box (page points) that holds all a mark draws, or null when its kind
    gives no way to tell. `tight`: the box of its own points alone, without
    the room its stroke, heads and text may take. */
export function markBounds(s: AnyMark, measure?: MeasureText, tight = false): Box4 | null {
  const m = s as Record<string, unknown> & AnyMark;
  const P: Pt[] = [];
  if (s.t === 'text') {
    if (!measure) return null;
    const t = s as TextMark;
    const r = textRect(t, measure);
    const q: Pt[] = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ];
    q.forEach((p) => P.push(t.r ? rotPt(p, [t.a[0], t.a[1]], t.r) : p));
  } else if (Array.isArray(m.quads)) {
    for (const q of m.quads as number[][]) P.push([q[0]!, q[1]!], [q[2]!, q[3]!]);
  } else if (Array.isArray(m.pts) && (m.pts as Pt[]).length && !m.a) {
    for (const p of m.pts as Pt[]) P.push(p);
  } else if (Array.isArray(m.a) && Array.isArray(m.b)) {
    const a = m.a as Pt,
      b = m.b as Pt;
    const c: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const r = typeof m.r === 'number' ? m.r : 0;
    [a, b, [a[0], b[1]] as Pt, [b[0], a[1]] as Pt].forEach((p) => P.push(r ? rotPt(p, c, r) : p));
    if (Array.isArray(m.m)) P.push(m.m as Pt);
    /* an arc bulges off its chord: its peak */
    if (s.t === 'arc') {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const k = (typeof m.bulge === 'number' ? m.bulge : 0.25) * l;
      P.push([c[0] - ((b[1] - a[1]) / l) * k, c[1] + ((b[0] - a[0]) / l) * k]);
    }
  } else return null;
  if (!P.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const p of P) {
    if (!isFinite(p[0]) || !isFinite(p[1])) continue;
    x1 = Math.min(x1, p[0]);
    y1 = Math.min(y1, p[1]);
    x2 = Math.max(x2, p[0]);
    y2 = Math.max(y2, p[1]);
  }
  if (!(x2 >= x1 && y2 >= y1)) return null;
  if (tight) return { x1, y1, x2, y2 };
  const w = typeof m.w === 'number' ? m.w : 1;
  const pad = Math.max(2, w * 2) + (REACH[s.t] || 4);
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad };
}

/** Where a mark is against the artboard: wholly on it, across its edge, or
    wholly off it. 'in' also when its kind gives no box: it is kept whole, as
    every PDF reader still shows only what is inside the page's box. */
export function markPlace(s: AnyMark, board: Box4, measure?: MeasureText): 'in' | 'edge' | 'out' {
  /* off: even with all the room it may take, nothing of it reaches the
     artboard; across: its own points do (its heads or text running past the
     page's edge are cropped there by every reader, as before) */
  const b = markBounds(s, measure);
  if (!b) return 'in';
  if (b.x2 < board.x1 || b.x1 > board.x2 || b.y2 < board.y1 || b.y1 > board.y2) return 'out';
  const t = markBounds(s, measure, true)!;
  if (t.x1 >= board.x1 && t.x2 <= board.x2 && t.y1 >= board.y1 && t.y2 <= board.y2) return 'in';
  return 'edge';
}
