/* Text in any script, in fonts that cannot draw it all.

   The standard PDF fonts (Helvetica, Times, Courier) encode WinAnsi only:
   Latin letters with their accents, € © ™ • and the like. Anything else is
   drawn in a fallback: first DejaVu Sans (✓ →, Greek, Cyrillic…), then Noto
   Emoji, a black-and-white emoji font. Each is embedded as a subset holding
   just the characters used, with a ToUnicode map, so the text reads back
   unchanged when the saved PDF is opened, searched or copied from.

   A line is split into runs, each in the first font that has all of a
   character's code points (an emoji can be several: 👨‍👩‍👧 is five, 🇸🇦 two),
   and the runs are drawn one after another along the baseline. A line the
   standard font can draw on its own is drawn exactly as before, in one piece. */

import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';

/** @pdf-lib/fontkit, which pdf-lib needs to embed a TrueType font, and the
    first fallback font (DejaVu Sans). */
export interface UnicodeFont {
  fontkit: unknown;
  bytes: Uint8Array;
}

/** Where the fallback fonts come from. The engine bundles none of them: the web
    app fetches each the first time a save needs it, and Node reads them from
    disk. */
export interface UnicodeFontSource {
  load: () => Promise<UnicodeFont> | UnicodeFont;
  /** The emoji font, loaded only for characters DejaVu Sans lacks. */
  loadEmoji?: () => Promise<Uint8Array> | Uint8Array;
}

/** A font, and the fallbacks for what it cannot draw, in order. */
export interface Face {
  font: PDFFont;
  fallback?: PDFFont | readonly PDFFont[] | null;
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

/** Every string inside `v` (a mark, a list of them, a location), one per line.
    Pictures (data: URLs) are skipped. */
export function textIn(v: unknown, depth = 0): string {
  if (typeof v === 'string') return v.startsWith('data:') ? '' : v;
  if (!v || typeof v !== 'object' || depth > 8) return '';
  return (Array.isArray(v) ? v : Object.values(v))
    .map((x) => textIn(x, depth + 1))
    .filter(Boolean)
    .join('\n');
}

const charSets = new WeakMap<PDFFont, Set<number>>();
function hasChar(font: PDFFont, cp: number): boolean {
  let set = charSets.get(font);
  if (!set) charSets.set(font, (set = new Set(font.getCharacterSet())));
  return set.has(cp);
}

const asFace = (f: PDFFont | Face): Face => ('font' in f ? f : { font: f });
const chainOf = (fb: Face['fallback']): readonly PDFFont[] =>
  !fb ? [] : Array.isArray(fb) ? fb : [fb as PDFFont];

type Segmenter = { segment(s: string): Iterable<{ segment: string }> };
const IntlS = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => Segmenter }).Segmenter;
const graphemes = IntlS ? new IntlS(undefined, { granularity: 'grapheme' }) : null;

/** The characters of a string as a reader sees them: an emoji with its skin
    tone, joiners and selectors, or a letter with its accents, is one. */
export function clusters(s: string): string[] {
  return graphemes ? Array.from(graphemes.segment(s), (g) => g.segment) : Array.from(s);
}

const cpsOf = (s: string) => Array.from(s, (c) => c.codePointAt(0)!);
const isSelector = (cp: number) => cp === 0xfe0e || cp === 0xfe0f;

interface FontkitGlyph {
  codePoints: number[];
}
/* pdf-lib keeps the fontkit font of an embedded TrueType font on its embedder */
type Embedder = {
  font?: { layout(t: string, f?: unknown): { glyphs: FontkitGlyph[] } };
  fontFeatures?: unknown;
};
const kept = new WeakMap<PDFFont, Map<string, boolean>>();

/** True when `text` drawn in this font reads back as `text`. The ToUnicode map
    gives each glyph the code points shaping gave it, and a few sequences lose
    one there: Noto Emoji draws 👍🏽 as a plain 👍 whose code points leave the
    skin tone out. Such a sequence is drawn a code point at a time instead. */
function readsBack(font: PDFFont, text: string): boolean {
  const e = (font as unknown as { embedder?: Embedder }).embedder;
  if (!e || !e.font) return true; /* a standard font: no shaping */
  let m = kept.get(font);
  if (!m) kept.set(font, (m = new Map()));
  let ok = m.get(text);
  if (ok === undefined) {
    const back = e.font.layout(text, e.fontFeatures).glyphs.flatMap((g) => g.codePoints);
    ok = String.fromCodePoint(...back) === text;
    m.set(text, ok);
  }
  return ok;
}

/** Splits text into runs by the font that draws them. A character the main font
    lacks goes to the first fallback that has all of it; with none to hand (no
    font could be loaded) it becomes '?', so the save still completes.
    Whitespace the font lacks (a tab) becomes a space. */
export function textRuns(text: unknown, face: PDFFont | Face): TextRun[] {
  const { font, fallback } = asFace(face);
  const chain = chainOf(fallback);
  const runs: TextRun[] = [];
  const push = (t: string, f: PDFFont) => {
    const last = runs[runs.length - 1];
    if (last && last.font === f) last.text += t;
    else runs.push({ text: t, font: f });
  };
  for (const cl of clusters(String(text == null ? '' : text))) {
    const cps = cpsOf(cl);
    if (cps.every((cp) => hasChar(font, cp))) {
      push(cl, font);
      continue;
    }
    if (!chain.length) {
      for (const ch of cl) push(hasChar(font, ch.codePointAt(0)!) ? ch : /\s/.test(ch) ? ' ' : '?', font);
      continue;
    }
    if (/^\s+$/.test(cl)) {
      push(' '.repeat(cps.length), font);
      continue;
    }
    const f = chain.find((c) => cps.every((cp) => hasChar(c, cp)));
    if (f) {
      push(cl, f);
      continue;
    }
    /* no one font has all of it: each code point in the first that has it (a
       selector nobody has is dropped rather than drawn as a box) */
    for (const cp of cps) {
      const g = hasChar(font, cp) ? font : chain.find((c) => hasChar(c, cp));
      if (g) push(String.fromCodePoint(cp), g);
      else if (!isSelector(cp)) push(String.fromCodePoint(cp), chain[chain.length - 1]!);
    }
  }
  /* a run that would not read back is drawn character by character, and a
     character that would not, code point by code point */
  return runs.flatMap((r) => {
    if (r.font === font || readsBack(r.font, r.text)) return [r];
    return clusters(r.text).flatMap((cl) =>
      readsBack(r.font, cl)
        ? [{ text: cl, font: r.font }]
        : Array.from(cl, (ch) => ({ text: ch, font: r.font })),
    );
  });
}

/** The width of a line drawn with its fallbacks. */
export function textWidth(text: unknown, size: number, face: PDFFont | Face): number {
  return textRuns(text, face).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
}

/** Whitespace (a line break, a tab, a no-break space) as plain spaces, for text
    drawn on one line. */
export function oneLine(s: unknown): string {
  return String(s == null ? '' : s).replace(/\s/g, ' ');
}

/** oneLine(str), shortened with an ellipsis until it fits maxW points. Cuts
    between whole characters, never inside one (nor inside an emoji). */
export function fitLine(face: PDFFont | Face, str: unknown, size: number, maxW: number): string {
  const s = oneLine(str);
  if (textWidth(s, size, face) <= maxW) return s;
  /* The longest run of whole characters that fits with the ellipsis, found by
     bisection: text never gets wider as characters come off its end, so this
     is the same answer as dropping one at a time, in a dozen measurements
     rather than one per character (3,000 characters took over 20 s). */
  const chars = clusters(s);
  const fits = (k: number) => textWidth(chars.slice(0, k).join('') + '…', size, face) <= maxW;
  let lo = 1,
    hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

/** Draws one line, run by run. `opts` are pdf-lib's drawText options (x, y,
    size, colour, opacity, rotate) and apply to every run; the font comes from
    the face. A line the main font draws alone is one drawText call, the same
    as drawing it directly. */
export function drawLine(p: PDFPage, text: unknown, face: PDFFont | Face, opts: DrawTextOptions): void {
  const runs = textRuns(text, face);
  /* v1 drew empty strings too (an empty text block); kept, so output matches */
  if (!runs.length) runs.push({ text: '', font: asFace(face).font });
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

interface Loaded {
  /** fontkit and DejaVu Sans, and which code points DejaVu Sans has */
  kit: Promise<{ font: UnicodeFont; covers: (cp: number) => boolean } | null>;
  text?: Promise<PDFFont | null>;
  emoji?: Promise<PDFFont | null>;
}
const loaded = new WeakMap<PDFDocument, Loaded>();

async function attempt<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn('[engine] ' + what + ' unavailable:', e);
    return null;
  }
}

type Fontkit = { create(b: Uint8Array): { hasGlyphForCodePoint(cp: number): boolean } };

/** The fallback fonts `text` needs, embedded into `out` as subsets, each at
    most once per document; resolves to every fallback embedded so far, in
    order. DejaVu Sans is embedded for characters it has that the standard
    fonts lack, Noto Emoji for those DejaVu Sans lacks too. A font that cannot
    be loaded is left out; what only it could draw is then drawn as a missing
    glyph (or '?', with no fallback at all) rather than failing the save. */
export async function embedFallbacks(
  out: PDFDocument,
  source: UnicodeFontSource | null | undefined,
  text = '',
): Promise<PDFFont[]> {
  if (!source) return [];
  let l = loaded.get(out);
  if (!l) {
    const kit = attempt('Unicode font', async () => {
      const font = await source.load();
      out.registerFontkit(font.fontkit as Parameters<PDFDocument['registerFontkit']>[0]);
      const dv = (font.fontkit as Fontkit).create(font.bytes);
      return { font, covers: (cp: number) => dv.hasGlyphForCodePoint(cp) };
    });
    loaded.set(out, (l = { kit }));
  }
  const kit = await l.kit;
  if (!kit) return [];
  const need = cpsOf(String(text)).filter((cp) => {
    const ch = String.fromCodePoint(cp);
    return !WIN_CH.test(ch) && !/\s/.test(ch);
  });
  if (!l.text && need.some(kit.covers))
    l.text = attempt('Unicode font', async () => out.embedFont(kit.font.bytes, { subset: true }));
  const loadEmoji = source.loadEmoji;
  if (!l.emoji && loadEmoji && need.some((cp) => !kit.covers(cp)))
    l.emoji = attempt('Emoji font', async () => out.embedFont(await loadEmoji(), { subset: true }));
  const fonts = [l.text ? await l.text : null, l.emoji ? await l.emoji : null];
  return fonts.filter((f): f is PDFFont => !!f);
}
