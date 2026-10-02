/* Text read from a scanned page (OCR, js/ocr.js), written into the saved page
   invisibly over the words it was read from, so the PDF can be searched,
   selected and copied in any reader while it looks exactly as before. */

import { degrees } from 'pdf-lib';
import type { Mark } from '../model';
import { drawLine, textWidth, type Face } from '../text';
import type { FontNeed, Painter } from './common';

/** One word: its baseline from [x0, y0] to [x1, y1] in page points, its
    height, and the text. */
export type OcrWord = [number, number, number, number, number, string];

export interface OcrMark extends Mark {
  t: 'ocr';
  words: OcrWord[];
  lang?: string;
}

const ocr: Painter = (p, s: OcrMark, ctx) => {
  const font = ctx.fonts.Helvetica;
  if (!font || !Array.isArray(s.words)) return;
  const face: Face = { font, fallback: ctx.extra.fallback as Face['fallback'] };
  for (const w of s.words) {
    const [x0, y0, x1, y1, h, text] = w;
    if (!text || !(h > 0)) continue;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!(len > 0)) continue;
    /* sized so the word spans what it was read from: a search or a
       selection then lights up the word on the page, not beside it */
    const at1 = textWidth(text, 1, face);
    const size = at1 > 0 ? Math.min(h * 1.6, len / at1) : h;
    drawLine(p, text, face, {
      x: x0,
      y: y0,
      size,
      opacity: 0,
      rotate: degrees((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI),
    });
  }
};

export const ocrPainters: Record<string, Painter> = { ocr };
export const ocrFontNeeds: Record<string, FontNeed> = { ocr: () => 'Helvetica' };
