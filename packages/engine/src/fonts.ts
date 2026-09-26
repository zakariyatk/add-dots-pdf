/* The standard PDF fonts a text mark can use. Moved from core.js. */

import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { MeasureText } from './geometry';
import type { FontFamily } from './model';

/** Per family: regular, bold, italic, bold italic (see fontIdx). */
export const FONTS: Readonly<Record<FontFamily, readonly StandardFonts[]>> = {
  helv: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  cour: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

/** A character the standard fonts can encode (WinAnsi / Windows-1252). */
const WIN_CH =
  /[ -~\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

/** Text the standard fonts can draw: whitespace becomes a space and anything
    they cannot encode becomes '?', instead of failing the whole save. */
export function pdfSafe(s: unknown): string {
  let o = '';
  for (const ch of String(s == null ? '' : s)) o += /\s/.test(ch) ? ' ' : WIN_CH.test(ch) ? ch : '?';
  return o;
}

/** pdfSafe(str), shortened with an ellipsis until it fits maxW points. */
export function fitText(font: PDFFont, str: unknown, size: number, maxW: number): string {
  let s = pdfSafe(str);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
  return s + '…';
}

export function fontIdx(b: unknown, i: unknown): number {
  return (b ? 1 : 0) + (i ? 2 : 0);
}

/** Embeds every standard font into a scratch document once, and returns a
    measurer for text-mark widths. Unknown fonts or glyphs measure as null,
    which layout treats as "estimate from the character count". */
export async function createTextMeasurer(): Promise<MeasureText> {
  const d = await PDFDocument.create();
  const m = {} as Record<FontFamily, PDFFont[]>;
  for (const k of Object.keys(FONTS) as FontFamily[]) {
    m[k] = [];
    for (let i = 0; i < 4; i++) m[k].push(await d.embedFont(FONTS[k][i]!));
  }
  return (item, line) => {
    try {
      return m[item.f]![fontIdx(item.b, item.i)]!.widthOfTextAtSize(line, item.size);
    } catch {
      return null;
    }
  };
}
