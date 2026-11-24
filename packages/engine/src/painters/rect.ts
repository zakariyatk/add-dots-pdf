/* A rectangle with rounded corners, or with its stroke aligned inside or
   outside, written into the PDF: the same Bézier outline the screen draws
   (rect.ts), the fill or gradient on the edge and the outline over it. A
   plain square-cornered box is still pdf-lib's own rectangle (save.ts). */

import { popGraphicsState, pushGraphicsState, setLineJoin, type PDFPage } from 'pdf-lib';
import { rectBezier, strokeRect, type RectMark } from '../rect';
import { hexRgb } from '../save';
import { dashOf, shCap, shJoin, shOp } from '../style';
import { PDF_CAP, PDF_JOIN } from './common';
import { fillGradient, svgPath } from './gradient';
import { penPathData } from './pen';

export function paintRoundRect(p: PDFPage, s: RectMark): void {
  const op = shOp(s);
  if (s.fill) {
    const P = rectBezier(s);
    if (s.grad) fillGradient(p, s, svgPath(penPathData(P, 1)), op);
    else
      p.drawSvgPath(penPathData(P, -1), { x: 0, y: 0, color: hexRgb(s.fill), opacity: op, borderWidth: 0 });
  }
  if (s.nos || !(s.w > 0)) return;
  const da = dashOf(s, s.w);
  p.pushOperators(pushGraphicsState(), setLineJoin(PDF_JOIN[shJoin(s)]!));
  p.drawSvgPath(penPathData(rectBezier(strokeRect(s)), -1), {
    x: 0,
    y: 0,
    borderColor: hexRgb(s.c),
    borderWidth: s.w,
    borderOpacity: op,
    borderLineCap: PDF_CAP[shCap(s)],
    ...(da ? { borderDashArray: da } : {}),
  });
  p.pushOperators(popGraphicsState());
}
