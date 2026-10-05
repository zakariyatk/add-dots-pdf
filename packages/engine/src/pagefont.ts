/* Text written again in the page's own font: Edit Object's Text keeps the
   font a line was drawn in (a PageFont table, contenttext.ts), and text
   retyped in it is saved in that font, as Acrobat does, when every
   character is one the table has. Otherwise the mark's own font is used. */

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  PDFHexString,
} from 'pdf-lib';
import { lineOrigin, rotPt, textRect, type MeasureText } from './geometry';
import type { PageFont, TextMark } from './model';
import { hexToRgb01 } from './style';

/** The mark's page font, while the mark keeps the family, bold and italic
    it was lifted with; null otherwise. */
export function markPageFont(s: TextMark): PageFont | null {
  const pf = s.pf;
  if (!pf || pf.f !== s.f || pf.b !== !!s.b || pf.i !== !!s.i) return null;
  return pf;
}

/** `text` in the page font: its codes as hex (two digits a code, four for a
    two-byte font) and its width in thousandths of the size; null when a
    character is not in the table. */
export function encodePageFont(pf: PageFont, text: string): { hex: string; w: number } | null {
  let hex = '',
    w = 0;
  for (const ch of text) {
    const c = pf.map[ch];
    if (c === undefined) return null;
    hex += c.toString(16).padStart(pf.twoByte ? 4 : 2, '0');
    w += pf.w[c] ?? 0;
  }
  return { hex, w };
}

/** Every line of the mark's text in its page font, or null if one cannot be. */
export function markInPageFont(
  s: TextMark,
): { pf: PageFont; lines: ({ hex: string; w: number } | null)[] } | null {
  const pf = markPageFont(s);
  if (!pf) return null;
  const lines = String(s.text)
    .split('\n')
    .map((l) => (l ? encodePageFont(pf, l) : null));
  if (
    String(s.text)
      .split('\n')
      .some((l, i) => l && !lines[i])
  )
    return null;
  return { pf, lines };
}

/** The width of a line of the mark in its page font (points), for
    measuring; null when the mark is not in its page font. */
export function pageFontMeasure(s: TextMark): MeasureText | null {
  const pf = markInPageFont(s) ? markPageFont(s) : null;
  return pf ? (m, line) => ((encodePageFont(pf, line)?.w ?? 0) / 1000) * m.size : null;
}

/** The mark's text alone, in its page font, as a one-page PDF whose page is
    the text's box on page `index` of `src` (in that page's own space): for
    the screen to show it as pdf.js draws it. Only the font is copied over.
    Null when the mark is not in its page font or the page lacks it. */
export async function pageFontSample(
  src: PDFDocument,
  index: number,
  s: TextMark,
): Promise<{ bytes: Uint8Array; box: [number, number, number, number] } | null> {
  const inPf = markInPageFont(s);
  const measure = pageFontMeasure(s);
  if (!inPf || !measure) return null;
  const fonts = src.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const ref = fonts && fonts.get(PDFName.of(inPf.pf.res));
  if (!(ref instanceof PDFRef)) return null;
  /* the text's box, turned with it, a little room round it for what the
     glyphs reach past their advance */
  const r = textRect(s, measure);
  const corners = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ].map((c) => (s.r ? rotPt(c, [s.a[0], s.a[1]], s.r) : c));
  const pad = s.size * 0.4;
  const box: [number, number, number, number] = [
    Math.min(...corners.map((c) => c[0]!)) - pad,
    Math.min(...corners.map((c) => c[1]!)) - pad,
    Math.max(...corners.map((c) => c[0]!)) + pad,
    Math.max(...corners.map((c) => c[1]!)) + pad,
  ];
  const out = await PDFDocument.create();
  const page = out.addPage([box[2] - box[0], box[3] - box[1]]);
  page.setMediaBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  page.node.setFontDictionary(
    PDFName.of(inPf.pf.res),
    PDFObjectCopier.for(src.context, out.context).copy(ref),
  );
  const t = ((s.r || 0) * Math.PI) / 180;
  const [cr, cg, cb] = hexToRgb01(s.c);
  String(s.text)
    .split('\n')
    .forEach((line, li) => {
      const enc = inPf.lines[li];
      if (!line || !enc) return;
      const lo = lineOrigin(s, li, measure(s, line) || 0, measure);
      page.pushOperators(
        pushGraphicsState(),
        setFillingColor(rgb(cr, cg, cb)),
        beginText(),
        setFontAndSize(inPf.pf.res, s.size),
        setTextMatrix(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), lo[0], lo[1]),
        showText(PDFHexString.of(enc.hex)),
        endText(),
        popGraphicsState(),
      );
    });
  return { bytes: await out.save(), box };
}
