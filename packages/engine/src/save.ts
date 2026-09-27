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
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  StandardFonts,
  type Color,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { FONTS, fontIdx } from './fonts';
import { arrowHead, boxOf, lineOrigin, rotPt, textRect, type MeasureText } from './geometry';
import { isText, type AnyMark, type Mark, type PageItem, type Source, type TextMark } from './model';
import { dashOf, hexToRgb01, shCap, shJoin, shOp } from './style';
import {
  anyNeedsUnicode,
  drawLine,
  embedUnicodeFont,
  needsUnicode,
  textWidth,
  type UnicodeFontSource,
} from './text';

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
    sets two entries: `unicode`, which embeds the Unicode fallback font on
    first call (async hooks call it when their text needs it), and `fallback`,
    that font, already embedded when some mark's text needed it before
    painting (painters are synchronous, so they read this one). */
export type Extra = Record<string, unknown> & {
  unicode?: () => Promise<PDFFont | null>;
  fallback?: PDFFont | null;
};
export type BuildOptions = { photos?: boolean } & Record<string, unknown>;

export interface PinOut {
  s: AnyMark;
  L: unknown;
  outPage: PDFPage;
  pageNo: number;
}

export interface SaveHooks {
  /** Text-width measurer (see createTextMeasurer). */
  measure: MeasureText;
  /** The font for characters the standard fonts cannot draw (see text.ts).
      Without it, such characters save as '?'. */
  unicode?: UnicodeFontSource | null;
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
      fallback?: PDFFont | null,
    ) => void;
    addPhotoPages: (
      out: PDFDocument,
      pinsOut: PinOut[],
      font: PDFFont | null,
      fontB: PDFFont | null,
      unicode?: () => Promise<PDFFont | null>,
    ) => Promise<void>;
  };
}

/** Source documents are kept in an optional cache so that splitting a file page
    by page does not re-parse the same original once for every page it produces. */
export type SourceCache = Map<Source['id'], PDFDocument>;

export async function loadSrc(s: Source, cache?: SourceCache | null): Promise<PDFDocument> {
  if (cache && cache.has(s.id)) return cache.get(s.id)!;
  const d = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
  if (cache) cache.set(s.id, d);
  return d;
}

export async function buildPdf(
  items: PageItem[],
  cache: SourceCache | null | undefined,
  opts: BuildOptions | undefined,
  hooks: SaveHooks,
): Promise<Uint8Array> {
  const measure = hooks.measure;
  const fontNeeds = hooks.fontNeeds || {};
  const painters = hooks.shapePainters || {};
  const locs = hooks.pins ? hooks.pins.locs : {};

  const out = await PDFDocument.create();
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
      if (!embedded[key]) embedded[key] = await out.embedFont(FONTS[s.f][fontIdx(s.b, s.i)]!);
    }
  }
  const fontFor = (s: TextMark) => embedded[s.f + fontIdx(s.b, s.i)] || null;

  /* The Unicode fallback font, embedded only when some text needs it: now, if
     any mark's text does (painters cannot wait), or later on a hook's call. */
  const extra: Extra = {};
  extra.unicode = () => embedUnicodeFont(out, hooks.unicode);
  const pinLocs = hasPins
    ? items.flatMap((it) => it.shapes.map((s) => (s.t === 'pin' ? locs[s.id as string] : null)))
    : [];
  if (anyNeedsUnicode(items.map((it) => it.shapes)) || anyNeedsUnicode(pinLocs))
    extra.fallback = await extra.unicode();
  const fallback = extra.fallback || null;
  /* a line with characters the standard font lacks is measured as drawn */
  const measureT: MeasureText = (s, line) => {
    const f = needsUnicode(line) ? fontFor(s) : null;
    return f ? textWidth(line, s.size, { font: f, fallback }) : measure(s, line);
  };

  const groups = new Map<Source['id'], { src: Source; idxs: number[]; slots: number[] }>();
  items.forEach((it, i) => {
    if (!groups.has(it.src.id)) groups.set(it.src.id, { src: it.src, idxs: [], slots: [] });
    const g = groups.get(it.src.id)!;
    g.idxs.push(it.num - 1);
    g.slots.push(i);
  });

  /* modules that need to embed something (a signature image, a logo) do it
     here, while we can still await, and stash the result in `extra` */
  for (const fn of hooks.prepare || []) await fn(out, items, extra);

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

  slots.forEach((p, i) => {
    const it = items[i]!;

    /* text patches and text first, so marks sit on top */
    it.shapes.forEach((s) => {
      if (!isText(s)) return;
      if (s.bg) {
        const r = textRect(s, measureT);
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
      txt.split('\n').forEach((line, li) => {
        if (!line) return;
        const lineW = measureT(s, line) || 0;
        const lo = lineOrigin(s, li, lineW, measureT);
        drawLine(
          p,
          line,
          { font: f, fallback },
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
    });

    it.shapes.forEach((any) => {
      if (any.t === 'text' || any.t === 'pin') return;
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
    });

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
        pins.draw(p, s, L, (turned + 360) % 360, pinFontB, fallback);
        pinsOut.push({ s, L, outPage: p, pageNo: i + 1 });
      });
    }
    if (it.rot) {
      const cur = p.getRotation().angle || 0;
      p.setRotation(degrees((((cur + it.rot) % 360) + 360) % 360));
    }
    out.addPage(p);
  });

  if (opts && opts.photos && pinsOut.length && hooks.pins)
    await hooks.pins.addPhotoPages(out, pinsOut, pinFont, pinFontB, extra.unicode);

  for (const fn of hooks.finish || []) await fn(out, items, slots, extra, opts);

  return out.save();
}
