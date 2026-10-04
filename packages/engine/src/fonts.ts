/* The fonts a text mark can use: the standard PDF fonts (moved from
   core.js), or a Google Font the page supplies as a file ('g:<id>'). */

import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { MeasureText } from './geometry';
import type { FontFamily, StandardFamily } from './model';

/** Per family: regular, bold, italic, bold italic (see fontIdx). */
export const FONTS: Readonly<Record<StandardFamily, readonly StandardFonts[]>> = {
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

export function fontIdx(b: unknown, i: unknown): number {
  return (b ? 1 : 0) + (i ? 2 : 0);
}

/** A font the page supplies as a file, rather than a standard PDF font. */
export function isFileFont(f: unknown): f is `g:${string}` {
  return typeof f === 'string' && f.startsWith('g:');
}

/** A font file and the fontkit that embeds it. */
export interface FontFile {
  fontkit: unknown;
  bytes: Uint8Array;
}
/** Where the font files come from: family ('g:<id>') and style (fontIdx) in,
    the file out, or null if it cannot be had (then Helvetica stands in). */
export interface FontFileSource {
  load(f: string, style: number): Promise<FontFile | null>;
}

/** The font a text mark is drawn in, embedded into `out`. */
export async function embedTextFont(
  out: PDFDocument,
  f: FontFamily,
  style: number,
  files?: FontFileSource | null,
): Promise<PDFFont> {
  if (isFileFont(f) && files) {
    try {
      const got = await files.load(f, style);
      if (got) {
        out.registerFontkit(got.fontkit as Parameters<PDFDocument['registerFontkit']>[0]);
        return await out.embedFont(got.bytes, { subset: true });
      }
    } catch {
      /* Helvetica, below: the save still completes */
    }
  }
  const std = isFileFont(f) ? FONTS.helv : FONTS[f] || FONTS.helv;
  return out.embedFont(std[style]!);
}

/** Embeds every standard font into a scratch document once, and returns a
    measurer for text-mark widths. Unknown fonts or glyphs measure as null,
    which layout treats as "estimate from the character count". */
export async function createTextMeasurer(): Promise<MeasureText> {
  const d = await PDFDocument.create();
  const m = {} as Record<StandardFamily, PDFFont[]>;
  for (const k of Object.keys(FONTS) as StandardFamily[]) {
    m[k] = [];
    for (let i = 0; i < 4; i++) m[k].push(await d.embedFont(FONTS[k][i]!));
  }
  return (item, line) => {
    try {
      return m[item.f as StandardFamily]![fontIdx(item.b, item.i)]!.widthOfTextAtSize(line, item.size);
    } catch {
      return null;
    }
  };
}
