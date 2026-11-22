/* A Continuous Line: straight segments through s.pts, in page points — the
   same points the screen draws between (apps/web/public/js/draw.js), so the
   editor and the saved PDF agree exactly. No a/b: it moves and scales as a
   whole, the way ink and vpath marks do. Snapped back onto its own first
   point, it is a closed shape and can carry a fill. */

import type { PDFPage } from 'pdf-lib';
import type { Mark, Pt } from '../model';
import { hexRgb } from '../save';
import { shOp } from '../style';
import { fillPolygon, paintPts, type Painter } from './common';

export interface PolyMark extends Mark {
  t: 'poly';
  pts: Pt[];
}

/** The same test the screen makes (js/draw.js's polyClosed) from the points
    actually being saved. */
function closed(pts: Pt[]): boolean {
  if (pts.length < 3) return false;
  const a = pts[0]!,
    b = pts[pts.length - 1]!;
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
}

const poly: Painter = (p: PDFPage, s: PolyMark) => {
  if (!s.pts || s.pts.length < 2) return;
  const shut = closed(s.pts);
  if (s.fill && shut) fillPolygon(p, s.pts, hexRgb(s.fill), shOp(s));
  /* a closed one can drop its outline and keep just the fill */
  if (!(s.nos && shut)) paintPts(p, s.pts, s);
};

export const polyPainters: Record<string, Painter> = { poly };
