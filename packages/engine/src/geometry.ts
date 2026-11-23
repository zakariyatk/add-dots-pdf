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
  /* area text: its frame, whatever the text in it */
  if (s.aw && s.ah) return { x: s.a[0], y: s.a[1] + s.size - s.ah, w: s.aw, h: s.ah };
  const lines = String(s.text).split('\n');
  let wid = 0;
  lines.forEach((l, li) => {
    wid = Math.max(wid, lineWidth(s, li, measure) || l.length * s.size * 0.5);
  });
  const hgt = s.size * 1.2 + leading(s) * (lines.length - 1);
  return { x: s.a[0], y: s.a[1] - hgt + s.size, w: Math.max(wid, s.size), h: hgt };
}

/** Leading, baseline to baseline in points: the mark's own, or auto (120%). */
export function leading(s: Pick<TextMark, 'size' | 'lh'>): number {
  return s.lh != null && s.lh > 0 ? s.lh : s.size * 1.2;
}
/** Tracking in points: the space added after each character but a line's last. */
export function tracking(s: Pick<TextMark, 'size' | 'tr'>): number {
  return s.tr ? (s.tr / 1000) * s.size : 0;
}
/** How many characters line `li` has (a surrogate pair counting once). */
function charCount(s: TextMark, li: number): number {
  return Array.from(String(s.text).split('\n')[li] ?? '').length;
}
/** Where a line sits across the box: an alignment's left, centre or right,
    or 'all' for justify all. */
export function alignKind(a: TextMark['align']): 'left' | 'center' | 'right' | 'all' {
  if (a === 'center' || a === 'justify-center') return 'center';
  if (a === 'right' || a === 'justify-right') return 'right';
  if (a === 'justify-all') return 'all';
  return 'left';
}
/** The space after each character of line `li` but its last, in points:
    tracking, plus with justify all what spreads the line across the box. */
export function charSpacing(s: TextMark, li: number, measure: MeasureText): number {
  let cs = tracking(s);
  if (alignKind(s.align) === 'all') {
    const n = charCount(s, li);
    if (n > 1) {
      const W = textRect(s, measure).w,
        lw = lineWidth(s, li, measure) || 0;
      if (W > lw) cs += (W - lw) / (n - 1);
    }
  }
  return cs;
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
  /* tracking widens the line by its gaps, one after each character but the last */
  const tw = s.tr ? tracking(s) * Math.max(0, charCount(s, li) - 1) : 0;
  if (!s.runs || !s.runs.length) {
    const w0 = measure(s, String(s.text).split('\n')[li] ?? '');
    return w0 == null ? null : w0 + tw;
  }
  let w = 0;
  for (const p of lineSpans(s, li)) {
    const pw = measure(p.s, p.text);
    if (pw == null) return null;
    w += pw;
  }
  return w + tw;
}

/** Baseline origin of line `li` of a text mark, turned with the rest.
    `lineWidth` is that one line's own width, needed to offset centre- and
    right-aligned lines off the box's left edge, which is s.a[0] itself. */
export function lineOrigin(s: TextMark, li: number, lineWidth: number, measure: MeasureText): Pt {
  const d = li * leading(s);
  let dx = 0;
  const k = alignKind(s.align);
  if (k === 'center' || k === 'right') {
    const W = textRect(s, measure).w,
      lw = lineWidth || 0;
    dx = k === 'center' ? (W - lw) / 2 : W - lw;
  }
  const base: Pt = [s.a[0] + dx, s.a[1] - d];
  if (!s.r) return base;
  return rotPt(base, [s.a[0], s.a[1]], s.r);
}

/* ---------------- area text ---------------- */

/** The mark with run `r` (bold, italic…) laid over it, for measuring. */
function styled(s: TextMark, r: StyleRun | null): TextMark {
  return r ? { ...s, runs: null, b: r.b ?? s.b, i: r.i ?? s.i } : { ...s, runs: null };
}
/** The run covering each character of the text (null where the mark's own style). */
function charRuns(s: TextMark, n: number): (StyleRun | null)[] {
  const out: (StyleRun | null)[] = [];
  for (const r of s.runs || []) for (let j = 0; j < r.n && out.length < n; j++) out.push(r);
  while (out.length < n) out.push(null);
  return out;
}

/**
 * Area text laid out in its frame, as Illustrator wraps it: each line takes
 * as many words as fit the frame's width; a space where a line breaks
 * becomes the line break (so the characters, and the style runs counted
 * over them, keep their places), and a word wider than the frame is broken
 * between characters. Lines past the frame's height are left out, and
 * `ovf` says some were. Point text comes back as it is. The page, the
 * editor's outline and the saved PDF all draw the result, so they wrap
 * alike.
 */
export function layoutText(s: TextMark, measure: MeasureText): TextMark & { ovf?: boolean } {
  if (!s.aw || !s.ah || s.patch) return s;
  const text = String(s.text);
  const W = Math.max(s.size * 0.5, s.aw);
  const track = tracking(s);
  const runOf = charRuns(s, text.length);
  /* the width of text[i, j), each piece in its own style, with its tracking */
  const width = (i: number, j: number): number => {
    let w = 0,
      a = i;
    while (a < j) {
      let b = a + 1;
      while (b < j && runOf[b] === runOf[a]) b++;
      const piece = text.slice(a, b);
      const m = measure(styled(s, runOf[a] ?? null), piece);
      w += (m == null ? piece.length * s.size * 0.5 : m) + track * Array.from(piece).length;
      a = b;
    }
    return w;
  };
  const out: string[] = [];
  /* where a line break was added between two characters: before original index k */
  const added: number[] = [];
  const breakBefore = (k: number) => {
    /* a space just written ends the line in its place; else a break goes in */
    if (out.length && out[out.length - 1] === ' ') out[out.length - 1] = '\n';
    else {
      out.push('\n');
      added.push(k);
    }
  };
  let i = 0;
  while (i <= text.length) {
    const end = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    let lineW = 0; /* the line so far, its trailing spaces left out */
    const re = /(\S+)(\s*)/g;
    const line = text.slice(i, end);
    let m: RegExpExecArray | null;
    /* spaces the line starts with */
    const lead = /^\s*/.exec(line)![0].length;
    for (let k = 0; k < lead; k++) out.push(line[k]!);
    /* the trailing spaces' width */
    let spaces = lead ? width(i, i + lead) : 0;
    re.lastIndex = lead;
    while ((m = re.exec(line))) {
      const ws = i + m.index,
        we = ws + m[1]!.length,
        te = we + m[2]!.length;
      const wW = width(ws, we);
      if (lineW > 0 && lineW + spaces + wW > W) {
        breakBefore(ws);
        lineW = 0;
        spaces = 0;
      }
      if (wW > W) {
        /* wider than the frame: broken between its characters */
        for (let c = ws; c < we; c++) {
          const cw = width(c, c + 1);
          if (lineW > 0 && lineW + cw > W) {
            breakBefore(c);
            lineW = 0;
          }
          out.push(text[c]!);
          lineW += cw;
        }
      } else {
        for (let c = ws; c < we; c++) out.push(text[c]!);
        lineW += spaces + wW;
      }
      for (let c = we; c < te; c++) out.push(text[c]!);
      spaces = te > we ? width(we, te) : 0;
    }
    if (end < text.length) out.push('\n');
    i = end + 1;
  }
  let laid = out.join('');
  /* the runs: a break put in between two characters joins the run of the
     one before it */
  let runs = s.runs || null;
  if (runs && added.length) {
    runs = runs.map((r) => ({ ...r }));
    for (const k of added) {
      let start = 0;
      for (const r of runs) {
        if (k - 1 >= start && k - 1 < start + r.n) {
          r.n++;
          break;
        }
        start += r.n;
      }
    }
  }
  /* as many lines as the frame's height holds, the first always */
  const lines = laid.split('\n');
  const fit = Math.max(1, 1 + Math.floor((s.ah - s.size * 1.2) / leading(s) + 1e-6));
  let ovf = false;
  if (lines.length > fit) {
    ovf = lines.slice(fit).some((l) => l.trim().length > 0);
    laid = lines.slice(0, fit).join('\n');
  }
  return { ...s, text: laid, runs, ovf };
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
