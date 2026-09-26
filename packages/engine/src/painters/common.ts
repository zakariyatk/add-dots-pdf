/* What every painter shares. */

import { LineCapStyle, LineJoinStyle, type Color, type PDFPage } from 'pdf-lib';
import type { AnyMark, Mark, Pt } from '../model';
import type { PaintContext } from '../save';
import { hexRgb } from '../save';
import { dashOf, shCap, shOp } from '../style';

export const PDF_CAP = [LineCapStyle.Butt, LineCapStyle.Round, LineCapStyle.Projecting];
export const PDF_JOIN = [LineJoinStyle.Miter, LineJoinStyle.Round, LineJoinStyle.Bevel];

/** Writes one mark type into a saved page. Module marks carry their own
    fields, which each painter reads for itself. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Painter = (p: PDFPage, s: any, ctx: PaintContext) => void;
export type FontNeed = (s: AnyMark) => string | null | undefined;

/** A filled polygon, in page points.

    pdf-lib's drawSvgPath works in SVG space: it flips y about its origin
    (a 1 0 0 -1 cm), so each y is negated here to land where it is meant to.
    v1 passed page points straight in, which put the leader's arrowhead below
    the page. */
export function fillPolygon(p: PDFPage, pts: readonly Pt[], color: Color, opacity = 1): void {
  if (pts.length < 3) return;
  const d = pts.map((q, i) => (i ? 'L ' : 'M ') + q[0] + ' ' + -q[1]).join(' ') + ' Z';
  p.drawSvgPath(d, { x: 0, y: 0, color, opacity, borderWidth: 0 });
}

/** A polyline as straight segments. Curves are written this way rather than
    as a path: the screen draws the same points, so both agree exactly
    (pdf-lib's path drawing flips y and moves the origin). */
export function paintPts(p: PDFPage, pts: readonly Pt[], s: Mark, solid?: boolean): void {
  const col = hexRgb(s.c),
    th = s.w;
  const op = shOp(s);
  const da = solid ? null : dashOf(s, th);
  const cap = PDF_CAP[shCap(s)];
  /* each segment is its own line, so the dash pattern carries on from where
     the last one stopped. v1 restarted it at 0 on every segment, and on a
     curve made of short segments that inked every one of them solid. */
  const period = da ? da.reduce((t, n) => t + n, 0) : 0;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!;
    const line: Parameters<PDFPage['drawLine']>[0] = {
      start: { x: a[0], y: a[1] },
      end: { x: b[0], y: b[1] },
      thickness: th,
      color: col,
      opacity: op,
      lineCap: cap,
    };
    if (da) {
      line.dashArray = da;
      line.dashPhase = +(run % period).toFixed(3);
      run += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    p.drawLine(line);
  }
}
