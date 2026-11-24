/* A dimension (dimension.ts) written into the PDF: the display list
   dimLayout makes, which the editor also draws on screen and into SVG, so
   paper and screen agree line for line. Its text is set in the embedded
   font the editor shows it in. */

import { degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { dimLayout, dimStyle, dimText, dimTextOrigin, type DimXMark } from '../dimension';
import type { Scale } from '../measure';
import type { Pt } from '../model';
import { hexRgb } from '../save';
import { shOp } from '../style';
import { fillPolygon, type FontNeed, type Painter } from './common';
import { DIM_FONT, dimFontKey } from './draw';

/** The font key a dimension's text needs embedded (as dimFontKey has it). */
export function dimxFontKey(s: DimXMark, scale?: Scale): string {
  const st = dimStyle(s);
  /* what is typed in (the measured part is digits, units, Ø and °, which
     every font has) decides whether a standard font can write it */
  const typed = (st.pre || '') + (s.label || '') + (st.suf || '');
  return dimFontKey({
    df: st.tf || undefined,
    db: st.tb,
    di: st.ti,
    label: scale ? dimText(s, scale) : typed || null,
  });
}

function canDraw(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

export const dimxFontNeeds: Record<string, FontNeed> = {
  dimx: (s) => dimxFontKey(s as unknown as DimXMark),
};

export function dimxPainters(getScale: () => Scale): Record<string, Painter> {
  const dimx: Painter = (p: PDFPage, s: DimXMark, ctx) => {
    if (!s.pts || s.pts.length < 3) return;
    const scale = getScale();
    const text = dimText(s, scale);
    const fonts = (ctx && ctx.fonts) || {};
    const own = fonts[dimxFontKey(s, scale)];
    const font = [own, fonts[DIM_FONT], fonts.HelveticaBold].find((f) => f && canDraw(f, text)) || own;
    const measure = (str: string, size: number) =>
      font ? font.widthOfTextAtSize(str, size) : str.length * size * 0.55;
    const D = dimLayout(s, scale, measure);
    const st = dimStyle(s);
    const col = hexRgb(s.c),
      tcol = hexRgb(st.tc || s.c),
      op = shOp(s as never),
      w = Math.max(0.1, s.w || 0.5);
    const line = (l: [Pt, Pt], th: number, c = col) =>
      p.drawLine({
        start: { x: l[0][0], y: l[0][1] },
        end: { x: l[1][0], y: l[1][1] },
        thickness: th,
        color: c,
        opacity: op,
      });
    D.lines.forEach((l) => line(l, w));
    D.ext.forEach((l) => line(l, w));
    D.heavy.forEach((l) => line(l, w * 2));
    D.polys.forEach((q) => {
      const c = q.text ? tcol : col;
      if (q.fill) fillPolygon(p, q.pts, c, op);
      else for (let i = 1; i < q.pts.length; i++) line([q.pts[i - 1]!, q.pts[i]!], w, c);
    });
    D.dots.forEach((d) =>
      p.drawCircle({ x: d.c[0], y: d.c[1], size: d.r, color: col, opacity: op, borderWidth: 0 }),
    );
    if (D.plate) fillPolygon(p, D.plate, hexRgb(D.text.bg || '#FFFFFF'), 1);
    if (!font) return;
    const o = dimTextOrigin(D.text);
    p.drawText(D.text.str, {
      x: o[0],
      y: o[1],
      size: D.text.size,
      font,
      color: tcol,
      opacity: op,
      rotate: degrees((D.text.ang * 180) / Math.PI),
    });
  };
  return { dimx };
}
