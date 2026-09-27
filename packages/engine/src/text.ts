/* Text in any script, in fonts that cannot draw it all.

   The standard PDF fonts (Helvetica, Times, Courier) encode WinAnsi only:
   Latin letters with their accents, € © ™ • and the like. Anything else (✓,
   →, Greek, Cyrillic…) is drawn in a fallback font instead: a Unicode
   TrueType font, embedded as a subset holding just the characters used. The
   subset carries a ToUnicode map, so the text reads back unchanged when the
   saved PDF is opened, searched or copied from.

   A line is split into runs, each in the first font that has its characters,
   and the runs are drawn one after another along the baseline. A line the
   standard font can draw on its own is drawn exactly as before, in one piece. */

import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';

/** The fallback font, and @pdf-lib/fontkit, which pdf-lib needs to embed a
    TrueType font. */
export interface UnicodeFont {
  fontkit: unknown;
  bytes: Uint8Array;
}

/** Where the fallback font comes from. The engine bundles neither the font nor
    fontkit (together about 1.5 MB): the web app fetches them the first time a
    save needs them, and Node reads them from disk. */
export interface UnicodeFontSource {
  load: () => Promise<UnicodeFont> | UnicodeFont;
}

/** A font and the fallback for what it cannot draw. */
export interface Face {
  font: PDFFont;
  fallback?: PDFFont | null;
}

export interface TextRun {
  text: string;
  font: PDFFont;
}

type DrawTextOptions = NonNullable<Parameters<PDFPage['drawText']>[1]>;

/** A character the standard fonts can encode (WinAnsi / Windows-1252). */
export const WIN_CH =
  /[ -~\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

/** True when some character in `s` needs a font beyond the standard ones. */
export function needsUnicode(s: unknown): boolean {
  for (const ch of String(s == null ? '' : s)) if (!WIN_CH.test(ch) && !/\s/.test(ch)) return true;
  return false;
}

/** True when any string inside `v` (a mark, a list of them, a location) needs a
    font beyond the standard ones. Pictures (data: URLs) are skipped. */
export function anyNeedsUnicode(v: unknown, depth = 0): boolean {
  if (typeof v === 'string') return !v.startsWith('data:') && needsUnicode(v);
  if (!v || typeof v !== 'object' || depth > 8) return false;
  for (const x of Array.isArray(v) ? v : Object.values(v)) if (anyNeedsUnicode(x, depth + 1)) return true;
  return false;
}

const charSets = new WeakMap<PDFFont, Set<number>>();
function hasChar(font: PDFFont, cp: number): boolean {
  let set = charSets.get(font);
  if (!set) charSets.set(font, (set = new Set(font.getCharacterSet())));
  return set.has(cp);
}

const asFace = (f: PDFFont | Face): Face => ('font' in f ? f : { font: f });

/** Splits text into runs by the font that draws them. A character the main font
    lacks goes to the fallback; with no fallback to hand (the font could not be
    loaded) it becomes '?', so the save still completes. Whitespace the font
    lacks (a tab) becomes a space. */
export function textRuns(text: unknown, face: PDFFont | Face): TextRun[] {
  const { font, fallback } = asFace(face);
  const runs: TextRun[] = [];
  for (let ch of String(text == null ? '' : text)) {
    const cp = ch.codePointAt(0)!;
    let f = font;
    if (!hasChar(font, cp)) {
      if (/\s/.test(ch)) ch = ' ';
      else if (fallback) f = fallback;
      else ch = '?';
    }
    const last = runs[runs.length - 1];
    if (last && last.font === f) last.text += ch;
    else runs.push({ text: ch, font: f });
  }
  return runs;
}

/** The width of a line drawn with its fallback. */
export function textWidth(text: unknown, size: number, face: PDFFont | Face): number {
  return textRuns(text, face).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
}

/** Whitespace (a line break, a tab, a no-break space) as plain spaces, for text
    drawn on one line. */
export function oneLine(s: unknown): string {
  return String(s == null ? '' : s).replace(/\s/g, ' ');
}

/** oneLine(str), shortened with an ellipsis until it fits maxW points. Cuts
    between whole characters, never inside one. */
export function fitLine(face: PDFFont | Face, str: unknown, size: number, maxW: number): string {
  const s = oneLine(str);
  if (textWidth(s, size, face) <= maxW) return s;
  const chars = Array.from(s);
  while (chars.length > 1 && textWidth(chars.join('') + '…', size, face) > maxW) chars.pop();
  return chars.join('') + '…';
}

/** Draws one line, run by run. `opts` are pdf-lib's drawText options (x, y,
    size, colour, opacity, rotate) and apply to every run; the font comes from
    the face. A line the main font draws alone is one drawText call, the same
    as drawing it directly. */
export function drawLine(p: PDFPage, text: unknown, face: PDFFont | Face, opts: DrawTextOptions): void {
  const runs = textRuns(text, face);
  /* v1 drew empty strings too (an empty text block); kept, so output matches */
  if (!runs.length) runs.push({ text: '', font: 'font' in face ? face.font : face });
  if (runs.length === 1) {
    p.drawText(runs[0]!.text, { ...opts, font: runs[0]!.font });
    return;
  }
  const size = opts.size ?? 24;
  const t = ((opts.rotate ? opts.rotate.angle : 0) * Math.PI) / 180;
  let x = opts.x ?? 0,
    y = opts.y ?? 0;
  for (const r of runs) {
    p.drawText(r.text, { ...opts, x, y, font: r.font });
    const w = r.font.widthOfTextAtSize(r.text, size);
    x += w * Math.cos(t);
    y += w * Math.sin(t);
  }
}

const embedded = new WeakMap<PDFDocument, Promise<PDFFont | null>>();

/** Embeds the fallback font into `out` once, as a subset. Resolves to null when
    there is no source or the font cannot be loaded; text then falls back to
    '?' for what the standard fonts cannot draw, rather than failing the save. */
export function embedUnicodeFont(
  out: PDFDocument,
  source: UnicodeFontSource | null | undefined,
): Promise<PDFFont | null> {
  if (!source) return Promise.resolve(null);
  let p = embedded.get(out);
  if (!p) {
    p = (async () => {
      try {
        const { fontkit, bytes } = await source.load();
        out.registerFontkit(fontkit as Parameters<PDFDocument['registerFontkit']>[0]);
        return await out.embedFont(bytes, { subset: true });
      } catch (e) {
        console.warn('[engine] Unicode fallback font unavailable:', e);
        return null;
      }
    })();
    embedded.set(out, p);
  }
  return p;
}
