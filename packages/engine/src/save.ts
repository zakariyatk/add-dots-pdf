/* Saving: rebuilds the editor's pages into a fresh PDF, carrying rotation,
   crop, marks and text.

   Moved from core.js buildPdf(). The logic is unchanged; what used to be read
   from core's globals (the EXT registries, S.locs, the pin painters) now comes
   in through SaveHooks, so the engine has no UI or window dependency.

   Saving rebuilds the document page by page, which is what lets pages be
   reordered, dropped and merged. A rebuilt page cannot carry the original
   interactive form widgets, so forms are flattened (see legacy/README.md). */

import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFName,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setTextMatrix,
  showText,
  rgb,
  setLineCap,
  setLineJoin,
  StandardFonts,
  type Color,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { embedTextFont, fontIdx, isFileFont, type FontFileSource } from './fonts';
import { arrowHead, boxOf, lineOrigin, rotPt, textRect, type MeasureText } from './geometry';
import { isText, type AnyMark, type Mark, type PageItem, type Source, type TextMark } from './model';
import { dashOf, hexToRgb01, shCap, shJoin, shOp } from './style';
import { drawLine, embedFallbacks, needsUnicode, textIn, textWidth, type UnicodeFontSource } from './text';
import { readXrefTail, reserveNumbers, snapshot, writeUpdate } from './append';
import { annotRect, commitAnnot, isAnnotMark, scratchPage } from './annots';
import { encodePageFont, markInPageFont } from './pagefont';

const PDF_CAP = [LineCapStyle.Butt, LineCapStyle.Round, LineCapStyle.Projecting];
const PDF_JOIN = [LineJoinStyle.Miter, LineJoinStyle.Round, LineJoinStyle.Bevel];

export function hexRgb(h: string): Color {
  const [r, g, b] = hexToRgb01(h);
  return rgb(r, g, b);
}

/** What a module's painter receives alongside the page and the mark. */
export interface PaintContext {
  out: PDFDocument;
  doc: PDFDocument;
  it: PageItem;
  index: number;
  fonts: Record<string, PDFFont>;
  extra: Extra;
}

/** What prepare, painters and finish hooks share during one save. buildPdf
    sets two entries: `unicode(text)`, which embeds the fallback fonts that
    text needs and resolves to all embedded so far (async hooks call it for
    their own text), and `fallback`, those fonts, embedded before painting for
    the marks' text (painters are synchronous, so they read this one). A
    prepare hook with text of its own updates it. */
export type Extra = Record<string, unknown> & {
  unicode?: (text?: string) => Promise<PDFFont[]>;
  fallback?: PDFFont[] | null;
};
/** photos: add the photo pages for the pins. annots: save markups as PDF
    comments (annotations), editable in a reader, instead of painting them
    into the page (see annots.ts). */
export type BuildOptions = { photos?: boolean; annots?: boolean } & Record<string, unknown>;

export interface PinOut {
  s: AnyMark;
  L: unknown;
  outPage: PDFPage;
  pageNo: number;
}

export interface SaveHooks {
  /** Text-width measurer (see createTextMeasurer). */
  measure: MeasureText;
  /** The fonts for characters the standard fonts cannot draw (see text.ts).
      Without them, such characters save as '?'. */
  unicode?: UnicodeFontSource | null;
  /** The Google Fonts' files, for text in one of them (see fonts.ts). */
  fonts?: FontFileSource | null;
  /** Module marks that need a standard font: type -> font name. */
  fontNeeds?: Record<string, (s: AnyMark) => string | null | undefined>;
  /** Module marks drawn into the PDF: type -> painter. */
  shapePainters?: Record<string, (page: PDFPage, s: AnyMark, ctx: PaintContext) => void>;
  /** Async work before painting (embedding images), results stashed in `extra`. */
  prepare?: ((out: PDFDocument, items: PageItem[], extra: Extra) => Promise<void> | void)[];
  /** Async work after painting (form values, metadata). */
  finish?: ((
    out: PDFDocument,
    items: PageItem[],
    slots: PDFPage[],
    extra: Extra,
    opts?: BuildOptions,
  ) => Promise<void> | void)[];
  /** Photo pins. Without this, pin marks are left out of the saved PDF. */
  pins?: {
    locs: Record<string, unknown>;
    draw: (
      page: PDFPage,
      s: AnyMark,
      L: unknown,
      rotation: number,
      fontB: PDFFont | null,
      fallback?: readonly PDFFont[] | null,
    ) => void;
    addPhotoPages: (
      out: PDFDocument,
      pinsOut: PinOut[],
      font: PDFFont | null,
      fontB: PDFFont | null,
      unicode?: (text?: string) => Promise<PDFFont[]>,
    ) => Promise<void>;
  };
}

/** Source documents are kept in an optional cache so that splitting a file page
    by page does not re-parse the same original once for every page it produces. */
export type SourceCache = Map<Source['id'], PDFDocument>;

/** A source is encrypted. pdf-lib cannot decrypt, and pages copied from an
    encrypted file keep their encrypted contents without the key to read
    them: the saved pages would come out blank. So building stops instead. */
export class EncryptedSourceError extends Error {
  constructor(name?: string) {
    super((name ? name + ' is' : 'A source is') + ' encrypted: its pages cannot be rebuilt');
    this.name = 'EncryptedSourceError';
  }
}

export async function loadSrc(s: Source, cache?: SourceCache | null): Promise<PDFDocument> {
  if (cache && cache.has(s.id)) return cache.get(s.id)!;
  const d = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
  if (d.isEncrypted) throw new EncryptedSourceError(s.name);
  if (cache) cache.set(s.id, d);
  return d;
}

export async function buildPdf(
  items: PageItem[],
  cache: SourceCache | null | undefined,
  opts: BuildOptions | undefined,
  hooks: SaveHooks,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  await compose(out, items, opts, hooks, () => copyPages(out, items, cache), true);
  return out.save();
}

/* the pages of the saved file, copied from their sources in order */
async function copyPages(out: PDFDocument, items: PageItem[], cache: SourceCache | null | undefined) {
  const groups = new Map<Source['id'], { src: Source; idxs: number[]; slots: number[] }>();
  items.forEach((it, i) => {
    if (!groups.has(it.src.id)) groups.set(it.src.id, { src: it.src, idxs: [], slots: [] });
    const g = groups.get(it.src.id)!;
    g.idxs.push(it.num - 1);
    g.slots.push(i);
  });
  const slots: PDFPage[] = new Array(items.length);
  for (const g of groups.values()) {
    const srcDoc = await loadSrc(g.src, cache);
    /* pdf-lib reuses objects it has already copied within one copyPages call,
       so a page used twice (Duplicate) came back sharing its content list, and
       marks drawn on one copy printed on both. Each repeat gets its own call:
       first uses in round 0, second uses in round 1, and so on. */
    const rounds: { idxs: number[]; slots: number[] }[] = [];
    const uses = new Map<number, number>();
    g.idxs.forEach((idx, k) => {
      const r = uses.get(idx) || 0;
      uses.set(idx, r + 1);
      const round = rounds[r] || (rounds[r] = { idxs: [], slots: [] });
      round.idxs.push(idx);
      round.slots.push(g.slots[k]!);
    });
    for (const round of rounds) {
      const copied = await out.copyPages(srcDoc, round.idxs);
      copied.forEach((p, k) => {
        slots[round.slots[k]!] = p;
      });
    }
  }
  return slots;
}

/** An incremental update to append to the pages' source, or null when these
    pages cannot be saved that way (see appendPdf). */
export interface AppendResult {
  src: Source;
  update: Uint8Array;
}

/**
 * Saves the marks onto the original instead of rebuilding it: the update to
 * append to `src.bytes` (see append.ts). Only for the original's own pages,
 * all of them, in order, and a file without form fields (a rebuild paints
 * the answers onto the page; on the original its fields stay live, and the
 * two would disagree). Returns null otherwise, or when the original's
 * cross-reference cannot be read; the caller then rebuilds.
 */
export async function appendPdf(
  items: PageItem[],
  opts: BuildOptions | undefined,
  hooks: SaveHooks,
): Promise<AppendResult | null> {
  const src = items[0] && items[0].src;
  if (!src || !items.every((it, i) => it.src.id === src.id && it.num === i + 1)) return null;
  if (items.some((it) => Array.isArray(it.fields) && it.fields.length)) return null;
  const tail = readXrefTail(src.bytes);
  if (!tail) return null;
  let doc: PDFDocument;
  try {
    /* strict: an original pdf-lib had to repair would take a broken update */
    doc = await PDFDocument.load(src.bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
  } catch {
    return null;
  }
  if (doc.isEncrypted) throw new EncryptedSourceError(src.name);
  if (doc.getPageCount() !== items.length || doc.getForm().getFields().length) return null;
  reserveNumbers(doc, tail);
  const snap = snapshot(doc);
  await compose(doc, items, opts, hooks, async () => doc.getPages(), false);
  /* pdf-lib writes embedded fonts and images out when it saves; this is
     that step, without the rest of saving */
  await doc.flush();
  return { src, update: writeUpdate(doc, snap, src.bytes, tail) };
}

/* Paints the marks, crops, turns and pins onto the pages `pagesFor` gives:
   copies added to `out` (add), or `out`'s own pages. */
async function compose(
  out: PDFDocument,
  items: PageItem[],
  opts: BuildOptions | undefined,
  hooks: SaveHooks,
  pagesFor: () => Promise<PDFPage[]>,
  add: boolean,
): Promise<void> {
  const measure = hooks.measure;
  const fontNeeds = hooks.fontNeeds || {};
  const painters = hooks.shapePainters || {};
  const locs = hooks.pins ? hooks.pins.locs : {};

  const embedded: Record<string, PDFFont> = {};
  const hasPins = items.some((it) => it.shapes.some((s) => s.t === 'pin' && locs[s.id as string]));
  let pinFont: PDFFont | null = null,
    pinFontB: PDFFont | null = null;
  if (hasPins) {
    pinFont = await out.embedFont(StandardFonts.Helvetica);
    pinFontB = await out.embedFont(StandardFonts.HelveticaBold);
  }
  const pinsOut: PinOut[] = [];
  for (const it of items) {
    for (const s of it.shapes) {
      if (!isText(s) || !String(s.text).trim()) {
        /* a module mark can ask for a standard font by name */
        const want = fontNeeds[s.t] && fontNeeds[s.t]!(s);
        if (want && !embedded[want])
          embedded[want] = await out.embedFont(StandardFonts[want as keyof typeof StandardFonts]);
        continue;
      }
      const key = s.f + fontIdx(s.b, s.i);
      if (!embedded[key]) embedded[key] = await embedTextFont(out, s.f, fontIdx(s.b, s.i), hooks.fonts);
    }
  }
  const fontFor = (s: TextMark) => embedded[s.f + fontIdx(s.b, s.i)] || null;

  /* The fallback fonts, embedded only when some text needs them: now, for
     the marks' text (painters cannot wait), or later on a hook's call. */
  const extra: Extra = {};
  extra.unicode = (text) => embedFallbacks(out, hooks.unicode, text);
  const pinLocs = hasPins
    ? items.flatMap((it) => it.shapes.map((s) => (s.t === 'pin' ? locs[s.id as string] : null)))
    : [];
  const markText = textIn(items.map((it) => it.shapes)) + '\n' + textIn(pinLocs);
  if (needsUnicode(markText)) extra.fallback = await extra.unicode(markText);
  /* a line with characters the standard font lacks, or in a font from a
     file, is measured as drawn */
  const measureT: MeasureText = (s, line) => {
    const f = needsUnicode(line) || isFileFont(s.f) ? fontFor(s) : null;
    return f ? textWidth(line, s.size, { font: f, fallback: extra.fallback }) : measure(s, line);
  };

  /* modules that need to embed something (a signature image, a logo) do it
     here, while we can still await, and stash the result in `extra` */
  for (const fn of hooks.prepare || []) await fn(out, items, extra);

  const slots = await pagesFor();

  /* markups kept editable: each one painted onto a page of its own, which
     becomes the look of its annotation (annots.ts); the rest onto the page */
  const editable = !!(opts && opts.annots);
  slots.forEach((page, i) => {
    const it = items[i]!;
    const onto = (s: AnyMark, draw: (p: PDFPage) => void) => {
      if (!editable || !isAnnotMark(s)) {
        draw(page);
        return;
      }
      const scratch = scratchPage(out);
      draw(scratch);
      commitAnnot(out, page, scratch, s, annotRect(s, measureT));
    };

    /* text patches and text first, so marks sit on top */
    it.shapes.forEach((s) => {
      if (!isText(s)) return;
      onto(s, (p) => paintText(p, s));
    });
    function paintText(p: PDFPage, s: TextMark) {
      /* text lifted by Edit Object and retyped within the characters the
         page's own font has: written in that font again (pagefont.ts), if
         the page still names it */
      const inPf = markInPageFont(s);
      const pf =
        inPf && p.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)?.has(PDFName.of(inPf.pf.res))
          ? inPf.pf
          : null;
      const measureS: MeasureText = pf
        ? (m, line) => ((encodePageFont(pf, line)?.w ?? 0) / 1000) * m.size
        : measureT;
      if (s.bg) {
        const r = textRect(s, measureS);
        const bo = s.r ? rotPt([r.x, r.y], [s.a[0], s.a[1]], s.r) : [r.x, r.y];
        p.drawRectangle({
          x: bo[0],
          y: bo[1],
          width: r.w,
          height: r.h,
          rotate: degrees(s.r || 0),
          color: hexRgb(s.bg),
          opacity: s.bgOp == null ? 1 : s.bgOp,
          borderWidth: 0,
        });
      }
      if (s.patch) {
        /* pdf-lib turns a rectangle about its own x,y, so move that corner round
           the anchor first and the block lands exactly where the screen shows it */
        const po = s.r ? rotPt([s.patch.x, s.patch.y], [s.a[0], s.a[1]], s.r) : [s.patch.x, s.patch.y];
        p.drawRectangle({
          x: po[0],
          y: po[1],
          width: s.patch.w,
          height: s.patch.h,
          rotate: degrees(s.r || 0),
          color: hexRgb(s.patch.c),
          borderWidth: 0,
        });
      }
      const txt = String(s.text);
      if (!txt.trim()) return;
      const f = fontFor(s);
      if (!f) return;
      let gsName: PDFName | null = null;
      txt.split('\n').forEach((line, li) => {
        if (!line) return;
        const lineW = measureS(s, line) || 0;
        const lo = lineOrigin(s, li, lineW, measureS);
        const enc = pf ? encodePageFont(pf, line) : null;
        if (pf && enc) {
          const op = shOp(s);
          if (op < 1 && !gsName)
            gsName = p.node.newExtGState('GS', p.doc.context.obj({ Type: 'ExtGState', ca: op, CA: op }));
          const t = ((s.r || 0) * Math.PI) / 180;
          p.pushOperators(
            pushGraphicsState(),
            ...(gsName ? [setGraphicsState(gsName)] : []),
            setFillingColor(hexRgb(s.c)),
            beginText(),
            setFontAndSize(pf.res, s.size),
            setTextMatrix(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), lo[0], lo[1]),
            showText(PDFHexString.of(enc.hex)),
            endText(),
            popGraphicsState(),
          );
        } else
          drawLine(
            p,
            line,
            { font: f, fallback: extra.fallback },
            {
              x: lo[0],
              y: lo[1],
              rotate: degrees(s.r || 0),
              size: s.size,
              color: hexRgb(s.c),
              opacity: shOp(s),
            },
          );
        /* standard PDF fonts carry no underline/strike glyphs, so draw the line
           ourselves, pivoted about the same baseline point as the text so it
           turns with it */
        if (s.u || s.k) {
          const w = lineW;
          const th = Math.max(0.5, s.size * 0.06);
          /* offset above the baseline: negative dips below it (underline),
             positive rises through the glyphs (strikethrough) */
          [s.u ? -s.size * 0.08 : null, s.k ? s.size * 0.3 : null].forEach((off) => {
            if (off == null) return;
            const corner = [lo[0], lo[1] + off];
            const o0 = s.r ? rotPt(corner, lo, s.r) : corner;
            p.drawRectangle({
              x: o0[0],
              y: o0[1],
              width: w,
              height: th,
              rotate: degrees(s.r || 0),
              color: hexRgb(s.c),
              opacity: shOp(s),
              borderWidth: 0,
            });
          });
        }
      });
    }

    it.shapes.forEach((any) => {
      if (any.t === 'text' || any.t === 'pin') return;
      onto(any, (p) => paintMark(p, any));
    });
    function paintMark(p: PDFPage, any: AnyMark) {
      const painter = painters[any.t];
      if (painter) {
        painter(p, any, { out, doc: out, it, index: i, fonts: embedded, extra });
        return;
      }
      const s = any as Mark;
      const col = hexRgb(s.c),
        th = s.w;
      const op = shOp(s),
        da = dashOf(s, th);
      const cap = PDF_CAP[shCap(s)];
      if (s.t === 'rect') {
        const bx = boxOf(s),
          mid = [(bx.x1 + bx.x2) / 2, (bx.y1 + bx.y2) / 2];
        /* pdf-lib turns a rectangle about its own x,y, so move that corner first */
        const o0 = s.r ? rotPt([bx.x1, bx.y1], mid, s.r) : [bx.x1, bx.y1];
        const ro: Parameters<PDFPage['drawRectangle']>[0] = {
          x: o0[0],
          y: o0[1],
          width: bx.x2 - bx.x1,
          height: bx.y2 - bx.y1,
          rotate: degrees(s.r || 0),
          borderColor: col,
          borderWidth: th,
          borderOpacity: op,
        };
        if (s.fill) {
          ro.color = hexRgb(s.fill);
          ro.opacity = op;
        }
        if (da) ro.borderDashArray = da;
        p.pushOperators(pushGraphicsState(), setLineJoin(PDF_JOIN[shJoin(s)]!), setLineCap(cap!));
        p.drawRectangle(ro);
        p.pushOperators(popGraphicsState());
      } else {
        const line: Parameters<PDFPage['drawLine']>[0] = {
          start: { x: s.a[0], y: s.a[1] },
          end: { x: s.b[0], y: s.b[1] },
          thickness: th,
          color: col,
          opacity: op,
          lineCap: cap,
        };
        if (da) {
          line.dashArray = da;
          line.dashPhase = 0;
        }
        p.drawLine(line);
        if (s.t === 'arrow') {
          const h = arrowHead(s.a[0], s.a[1], s.b[0], s.b[1], th);
          h.forEach((q) => {
            /* the head stays solid */
            p.drawLine({
              start: { x: q[0], y: q[1] },
              end: { x: s.b[0], y: s.b[1] },
              thickness: th,
              color: col,
              opacity: op,
              lineCap: cap,
            });
          });
        }
      }
    }

    const p = page;
    if (it.crop) {
      p.setCropBox(it.crop.x, it.crop.y, it.crop.w, it.crop.h);
      p.setMediaBox(it.crop.x, it.crop.y, it.crop.w, it.crop.h);
    }
    const turned = ((p.getRotation().angle || 0) + it.rot) % 360;
    if (hooks.pins) {
      const pins = hooks.pins;
      it.shapes.forEach((s) => {
        const L = s.t === 'pin' ? locs[s.id as string] : undefined;
        if (!L) return;
        pins.draw(p, s, L, (turned + 360) % 360, pinFontB, extra.fallback);
        pinsOut.push({ s, L, outPage: p, pageNo: i + 1 });
      });
    }
    if (it.rot) {
      const cur = p.getRotation().angle || 0;
      p.setRotation(degrees((((cur + it.rot) % 360) + 360) % 360));
    }
    if (add) out.addPage(p);
  });

  if (opts && opts.photos && pinsOut.length && hooks.pins)
    await hooks.pins.addPhotoPages(out, pinsOut, pinFont, pinFontB, extra.unicode);

  for (const fn of hooks.finish || []) await fn(out, items, slots, extra, opts);
}
