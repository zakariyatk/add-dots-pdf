/* Mark geometry. Every mark is stored in PDF points, so move, resize and rotate
   all happen in PDF space and the screen, the JPGs and the PDF agree.
   Moved from core.js unchanged. */

import type { AnyMark, Mark, Pt, StyleRun, TextMark } from './model';

/** Measures one line of a text mark in points, or null when fonts aren't ready. */
export type MeasureText = (s: TextMark, line: string) => number | null;

export function rotPt(p: readonly number[], c: readonly number[], deg: number | undefined): Pt {
  if (!deg) return [p[0]!, p[1]!];
  const t = (deg * Math.PI) / 180,
    cs = Math.cos(t),
    sn = Math.sin(t);
  const x = p[0]! - c[0]!,
    y = p[1]! - c[1]!;
  return [c[0]! + x * cs - y * sn, c[1]! + x * sn + y * cs];
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function boxOf(s: Pick<Mark, 'a' | 'b'>): Box {
  return {
    x1: Math.min(s.a[0], s.b[0]),
    y1: Math.min(s.a[1], s.b[1]),
    x2: Math.max(s.a[0], s.b[0]),
    y2: Math.max(s.a[1], s.b[1]),
  };
}

export function shapeMid(s: Pick<Mark, 'a' | 'b'>): Pt {
  return [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
}

/** The four corners of a box, turned by its own rotation. */
export function rectCorners(s: Mark): Pt[] {
  const b = boxOf(s),
    c: Pt = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
  const q: Pt[] = [
    [b.x1, b.y1],
    [b.x2, b.y1],
    [b.x2, b.y2],
    [b.x1, b.y2],
  ];
  return s.r ? q.map((p) => rotPt(p, c, s.r)) : q;
}

/** Text turns about its own anchor, which is also where pdf-lib turns it. */
export function rotCenter(s: AnyMark): Pt {
  return s.t === 'text' ? [s.a[0], s.a[1]] : shapeMid(s as Mark);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The un-turned footprint of a text mark, in PDF points. */
export function textRect(s: TextMark, measure: MeasureText): Rect {
  if (s.patch) return { x: s.patch.x, y: s.patch.y, w: s.patch.w, h: s.patch.h };
  const lines = String(s.text).split('\n');
  let wid = 0;
  lines.forEach((l, li) => {
    wid = Math.max(wid, lineWidth(s, li, measure) || l.length * s.size * 0.5);
  });
  const hgt = s.size * 1.2 * lines.length;
  return { x: s.a[0], y: s.a[1] - hgt + s.size, w: Math.max(wid, s.size), h: hgt };
}

/** Line `li` of a text mark in pieces of one style each: the mark with a
    run's colour, bold, italic, underline and strike laid over it. Drawn one
    after another along the baseline. */
export function lineSpans(s: TextMark, li: number): { text: string; s: TextMark }[] {
  const lines = String(s.text).split('\n');
  const line = lines[li] ?? '';
  if (!line) return [];
  if (!s.runs || !s.runs.length) return [{ text: line, s }];
  let start = 0;
  for (let j = 0; j < li; j++) start += lines[j]!.length + 1;
  const end = start + line.length;
  const out: { text: string; s: TextMark; r: StyleRun | null }[] = [];
  const push = (a: number, b: number, r: StyleRun | null) => {
    const last = out[out.length - 1];
    if (last && sameStyle(last.r, r)) {
      last.text += line.slice(a - start, b - start);
      return;
    }
    const m: TextMark = r
      ? { ...s, runs: null, c: r.c ?? s.c, b: r.b ?? s.b, i: r.i ?? s.i, u: r.u ?? s.u, k: r.k ?? s.k }
      : { ...s, runs: null };
    out.push({ text: line.slice(a - start, b - start), s: m, r });
  };
  let at = 0;
  for (const r of s.runs) {
    const a = Math.max(at, start),
      b = Math.min(at + r.n, end);
    if (b > a) push(a, b, r);
    at += r.n;
    if (at >= end) break;
  }
  if (at < end) push(Math.max(at, start), end, null);
  return out.map((x) => ({ text: x.text, s: x.s }));
}
const sameStyle = (p: StyleRun | null, q: StyleRun | null) =>
  !!p && !!q && p.c === q.c && !!p.b === !!q.b && !!p.i === !!q.i && !!p.u === !!q.u && !!p.k === !!q.k;

/** The width of line `li`, its pieces measured each in its own style; null
    while fonts are not ready. */
export function lineWidth(s: TextMark, li: number, measure: MeasureText): number | null {
  if (!s.runs || !s.runs.length) return measure(s, String(s.text).split('\n')[li] ?? '');
  let w = 0;
  for (const p of lineSpans(s, li)) {
    const pw = measure(p.s, p.text);
    if (pw == null) return null;
    w += pw;
  }
  return w;
}

/** Baseline origin of line `li` of a text mark, turned with the rest.
    `lineWidth` is that one line's own width, needed to offset centre- and
    right-aligned lines off the box's left edge, which is s.a[0] itself. */
export function lineOrigin(s: TextMark, li: number, lineWidth: number, measure: MeasureText): Pt {
  const d = li * s.size * 1.2;
  let dx = 0;
  if (s.align === 'center' || s.align === 'right') {
    const W = textRect(s, measure).w,
      lw = lineWidth || 0;
    dx = s.align === 'center' ? (W - lw) / 2 : W - lw;
  }
  const base: Pt = [s.a[0] + dx, s.a[1] - d];
  if (!s.r) return base;
  return rotPt(base, [s.a[0], s.a[1]], s.r);
}

/** The two barb ends of an arrow head at b, for a line from a to b. */
export function arrowHead(ax: number, ay: number, bx: number, by: number, w: number): [Pt, Pt] {
  const dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len,
    hl = Math.max(9, w * 4),
    a = 0.42;
  const ca = Math.cos(a),
    sa = Math.sin(a);
  return [
    [bx - (ux * ca - uy * sa) * hl, by - (uy * ca + ux * sa) * hl],
    [bx - (ux * ca + uy * sa) * hl, by - (uy * ca - ux * sa) * hl],
  ];
}
