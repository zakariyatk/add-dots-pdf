/* A shape lifted out of the page's own content by Edit Object (content.ts):
   its path as the page drew it, in page points, now a mark. Moving or
   resizing it moves its points; its colours, line and opacity are the
   mark's own. */

import type { PDFPage } from 'pdf-lib';
import type { Mark, Pt } from '../model';
import type { ContentShape } from '../content';
import { hexRgb } from '../save';
import { dashOf, shCap, shOp } from '../style';
import { PDF_CAP, type Painter } from './common';

export interface VPathMark extends Mark {
  t: 'vpath';
  /** path commands over pts: M L C (three points) Z */
  k: string;
  pts: Pt[];
  /** no outline (the shape was only filled) */
  nos?: boolean;
  fill?: string | null;
  /** fill opacity, where it differs from the outline's (o) */
  fo?: number;
  /** the page's own dash, in points, until a style is picked (d) */
  dash?: number[] | null;
}

/** The mark a picked shape becomes. */
export function vpathFromShape(sh: ContentShape): VPathMark {
  /* a mark of points, like ink: no a or b */
  const m = {
    t: 'vpath',
    k: sh.cmds,
    pts: sh.pts.map((p) => [p[0], p[1]] as Pt),
    c: sh.stroke || sh.fill || '#000000',
    w: sh.stroke ? Math.max(0.1, sh.w) : 1,
  } as unknown as VPathMark;
  if (!sh.stroke) m.nos = true;
  if (sh.fill) m.fill = sh.fill;
  if (sh.dash) m.dash = sh.dash;
  m.cap = sh.cap;
  m.j = sh.join;
  if (sh.so < 1) m.o = sh.so;
  if (sh.fill && sh.fo !== (sh.so < 1 ? sh.so : 1)) m.fo = sh.fo;
  return m;
}

/** The path as SVG path data, y as given (flip it for pdf-lib's drawSvgPath). */
export function vpathD(s: Pick<VPathMark, 'k' | 'pts'>, fy: (y: number) => number = (y) => y): string {
  const P = s.pts;
  let j = 0,
    d = '';
  for (const c of s.k) {
    if (c === 'M' || c === 'L') {
      const p = P[j++];
      if (p) d += c + p[0] + ' ' + fy(p[1]) + ' ';
    } else if (c === 'C') {
      const a = P[j++],
        b = P[j++],
        e = P[j++];
      if (a && b && e)
        d += 'C' + a[0] + ' ' + fy(a[1]) + ' ' + b[0] + ' ' + fy(b[1]) + ' ' + e[0] + ' ' + fy(e[1]) + ' ';
    } else if (c === 'Z') d += 'Z ';
  }
  return d.trim();
}

const vpath: Painter = (p: PDFPage, s: VPathMark) => {
  const d = vpathD(s, (y) => -y);
  if (!d) return;
  const op = shOp(s);
  const outline = !s.nos;
  const dash = s.d ? dashOf(s, s.w) : s.dash || null;
  p.drawSvgPath(d, {
    x: 0,
    y: 0,
    ...(s.fill ? { color: hexRgb(s.fill), opacity: s.fo == null ? op : s.fo } : {}),
    ...(outline
      ? {
          borderColor: hexRgb(s.c),
          borderWidth: s.w,
          borderOpacity: op,
          borderLineCap: PDF_CAP[shCap(s)],
          ...(dash ? { borderDashArray: dash } : {}),
        }
      : { borderWidth: 0 }),
  });
};

export const vpathPainters: Record<string, Painter> = { vpath };
