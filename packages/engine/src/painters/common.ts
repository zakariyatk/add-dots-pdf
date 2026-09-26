/* What every painter shares. */

import { LineCapStyle, LineJoinStyle, type PDFPage } from 'pdf-lib';
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

/** A polyline as straight segments. Curves are written this way rather than
    as a path: the screen draws the same points, so both agree exactly
    (pdf-lib's path drawing flips y and moves the origin). */
export function paintPts(p: PDFPage, pts: readonly Pt[], s: Mark, solid?: boolean): void {
  const col = hexRgb(s.c),
    th = s.w;
  const op = shOp(s);
  const da = solid ? null : dashOf(s, th);
  const cap = PDF_CAP[shCap(s)];
  for (let i = 1; i < pts.length; i++) {
    const line: Parameters<PDFPage['drawLine']>[0] = {
      start: { x: pts[i - 1]![0], y: pts[i - 1]![1] },
      end: { x: pts[i]![0], y: pts[i]![1] },
      thickness: th,
      color: col,
      opacity: op,
      lineCap: cap,
    };
    if (da) {
      line.dashArray = da;
      line.dashPhase = 0;
    }
    p.drawLine(line);
  }
}
