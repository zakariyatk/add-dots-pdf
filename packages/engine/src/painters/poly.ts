/* A Continuous Line: straight segments through s.pts, in page points — the
   same points the screen draws between (apps/web/public/js/draw.js), so the
   editor and the saved PDF agree exactly. No a/b: it moves and scales as a
   whole, the way ink and vpath marks do. */

import type { PDFPage } from 'pdf-lib';
import type { Mark, Pt } from '../model';
import { paintPts, type Painter } from './common';

export interface PolyMark extends Mark {
  t: 'poly';
  pts: Pt[];
}

const poly: Painter = (p: PDFPage, s: PolyMark) => {
  if (s.pts && s.pts.length > 1) paintPts(p, s.pts, s);
};

export const polyPainters: Record<string, Painter> = { poly };
