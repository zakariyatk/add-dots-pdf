/* A Pen path: cubic Bézier segments through its anchors, in page points.
   s.pts runs anchor, out-handle, in-handle, anchor, … (3n + 1 points), so a
   whole path moves, scales and turns as one list of points, the way a
   Continuous Line's does. A straight segment has its two handles on its own
   anchors. The last anchor on the first closes the path, and a closed path
   can carry a fill. The screen draws the same path (apps/web/public/js/pen.js). */

import type { PDFPage } from 'pdf-lib';
import type { Mark, Pt } from '../model';
import { hexRgb } from '../save';
import { dashOf, shCap, shOp } from '../style';
import { PDF_CAP, type Painter } from './common';
import { fillGradient, svgPath } from './gradient';

export interface PenMark extends Mark {
  t: 'pen';
  pts: Pt[];
  /** Open although its ends meet: a path ended on its own first point, or a
      closed one cut there (js/pen.js). Without it, ends that meet close it. */
  open?: boolean;
}

/** A path of at least two segments whose last anchor is its first (and not
    marked open). */
export function penClosed(pts: readonly Pt[], open = false): boolean {
  if (open || pts.length < 7) return false;
  const a = pts[0]!,
    b = pts[pts.length - 1]!;
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
}

/** The path as SVG path data; `flip` -1 turns PDF's y-up into the y-down
    pdf-lib's drawSvgPath reads. */
export function penPathData(pts: readonly Pt[], flip = -1, open = false): string {
  const f = (q: Pt) => q[0] + ' ' + flip * q[1];
  let d = 'M ' + f(pts[0]!);
  for (let i = 1; i + 2 < pts.length; i += 3) {
    d += ' C ' + f(pts[i]!) + ' ' + f(pts[i + 1]!) + ' ' + f(pts[i + 2]!);
  }
  return penClosed(pts, open) ? d + ' Z' : d;
}

const pen: Painter = (p: PDFPage, s: PenMark) => {
  const pts = s.pts;
  if (!pts || pts.length < 4) return;
  const shut = penClosed(pts, !!s.open);
  const d = penPathData(pts, -1, !!s.open);
  const op = shOp(s);
  if (s.fill && s.grad && shut) fillGradient(p, s, svgPath(penPathData(pts, 1, !!s.open)), op);
  else if (s.fill && shut)
    p.drawSvgPath(d, { x: 0, y: 0, color: hexRgb(s.fill), opacity: op, borderWidth: 0 });
  /* a closed path can drop its outline; an open one is nothing but its line */
  if (s.nos && shut) return;
  const da = dashOf(s, s.w);
  p.drawSvgPath(d, {
    x: 0,
    y: 0,
    borderColor: hexRgb(s.c),
    borderWidth: s.w,
    borderOpacity: op,
    borderLineCap: PDF_CAP[shCap(s)],
    ...(da ? { borderDashArray: da } : {}),
  });
};

export const penPainters: Record<string, Painter> = { pen };
