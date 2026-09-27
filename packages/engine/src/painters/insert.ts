/* Pictures, video posters, links, tables and signatures. Moved from insert.js
   and forms.js. Images are embedded in a prepare pass (it is async), then
   painted from ctx.extra. */

import {
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib';
import { boxOf, rotPt, shapeMid } from '../geometry';
import type { Mark, PageItem, Pt } from '../model';
import { hexRgb, type Extra } from '../save';
import { drawLine, fitLine, textWidth, type Face } from '../text';
import type { Painter } from './common';

export interface ImageMark extends Mark {
  t: 'image' | 'video' | 'sig';
  /** data: URL of the picture (or the video's poster, or the signature). */
  url: string;
  /** video: where it plays; an http(s) address also becomes a link. */
  src?: string;
}
export interface LinkMark extends Mark {
  t: 'link';
  url: string;
  label?: string;
  style?: 'icon' | 'underline' | 'button';
}
export interface TableMark extends Mark {
  t: 'table';
  rows: number;
  cols: number;
  cells: string[][];
  /** Column widths / row heights as fractions of the box. */
  colW?: number[];
  rowH?: number[];
}

export const LINK_COLOR = '#2F6FED';
export const TABLE_LINE = '#8A8F98';

export function linkLabel(s: LinkMark): string {
  return s.label || s.url || 'Link';
}
export function colFracs(s: TableMark): number[] {
  return s.colW && s.colW.length === s.cols ? s.colW : Array(s.cols).fill(1 / s.cols);
}
export function rowFracs(s: TableMark): number[] {
  return s.rowH && s.rowH.length === s.rows ? s.rowH : Array(s.rows).fill(1 / s.rows);
}
export function cumFracs(fracs: number[]): number[] {
  let acc = 0;
  return [0].concat(
    fracs.map((f) => {
      acc += f;
      return acc;
    }),
  );
}

async function embedAny(out: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    return await out.embedPng(url);
  } catch {
    try {
      return await out.embedJpg(url);
    } catch {
      return null; /* unreadable image, skip */
    }
  }
}

/** Embeds pictures, video posters, and the fonts links and tables need. */
export async function prepareInsert(out: PDFDocument, items: PageItem[], extra: Extra): Promise<void> {
  const imgs = (extra.insImgs = (extra.insImgs as Record<string, PDFImage>) || {});
  for (const it of items) {
    for (const s of it.shapes) {
      if ((s.t !== 'image' && s.t !== 'video') || !s.url || imgs[s.url as string]) continue;
      const img = await embedAny(out, s.url as string);
      if (img) imgs[s.url as string] = img;
    }
  }
  const needLink = items.some((it) => it.shapes.some((s) => s.t === 'link' && s.style !== 'icon'));
  if (needLink && !extra.linkFont) extra.linkFont = await out.embedFont(StandardFonts.HelveticaBold);
  const needTable = items.some((it) => it.shapes.some((s) => s.t === 'table'));
  if (needTable && !extra.tableFont) extra.tableFont = await out.embedFont(StandardFonts.Helvetica);
}

/** Embeds signature images. */
export async function prepareSignatures(out: PDFDocument, items: PageItem[], extra: Extra): Promise<void> {
  const sigs: Record<string, PDFImage> = (extra.sigs = {});
  for (const it of items) {
    for (const s of it.shapes) {
      if (s.t !== 'sig' || sigs[s.url as string]) continue;
      const img = await embedAny(out, s.url as string);
      if (img) sigs[s.url as string] = img;
    }
  }
}

/** A box corner turned about the box's own centre, for export: pdf-lib turns a
    rectangle or image about that corner. */
function exportCorner(s: Mark): Pt {
  const bx = boxOf(s),
    mid = shapeMid(s);
  return s.r ? rotPt([bx.x1, bx.y1], mid, s.r) : [bx.x1, bx.y1];
}

function paintBorder(p: Parameters<Painter>[0], s: Mark): void {
  if (!s.w) return;
  const bx = boxOf(s),
    o0 = exportCorner(s);
  p.drawRectangle({
    x: o0[0],
    y: o0[1],
    width: bx.x2 - bx.x1,
    height: bx.y2 - bx.y1,
    rotate: degrees(s.r || 0),
    borderColor: hexRgb(s.c),
    borderWidth: s.w,
  });
}

const image: Painter = (p, s: ImageMark, ctx) => {
  const imgs = ctx.extra.insImgs as Record<string, PDFImage> | undefined;
  const img = imgs && imgs[s.url];
  if (img) {
    const bx = boxOf(s),
      o0 = exportCorner(s);
    p.drawImage(img, {
      x: o0[0],
      y: o0[1],
      width: bx.x2 - bx.x1,
      height: bx.y2 - bx.y1,
      rotate: degrees(s.r || 0),
    });
  }
  paintBorder(p, s);
};

function addUriLink(p: Parameters<Painter>[0], doc: PDFDocument, s: Mark, uri: string): void {
  const bx = boxOf(s);
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [bx.x1, bx.y1, bx.x2, bx.y2],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
  });
  p.node.addAnnot(doc.context.register(annot));
}

const video: Painter = (p, s: ImageMark, ctx) => {
  image(p, s, ctx);
  if (s.src && /^https?:\/\//i.test(s.src)) addUriLink(p, ctx.doc, s, s.src);
};

const link: Painter = (p, s: LinkMark, ctx) => {
  const bx = boxOf(s);
  const w = bx.x2 - bx.x1,
    h = bx.y2 - bx.y1;
  const cx = (bx.x1 + bx.x2) / 2,
    cy = (bx.y1 + bx.y2) / 2;
  const col = hexRgb(s.c || LINK_COLOR);
  const font = ctx.extra.linkFont as PDFFont | undefined;
  const face: Face | null = font ? { font, fallback: ctx.extra.fallback } : null;
  const fs = Math.max(8, Math.min(16, h * 0.55));
  if (s.style === 'underline' && face) {
    const label = linkLabel(s);
    drawLine(p, label, face, { x: bx.x1, y: cy - fs * 0.35, size: fs, color: col });
    const lw = textWidth(label, fs, face);
    p.drawLine({
      start: { x: bx.x1, y: cy - fs * 0.42 },
      end: { x: bx.x1 + lw, y: cy - fs * 0.42 },
      thickness: Math.max(0.5, fs * 0.06),
      color: col,
    });
  } else if (s.style === 'button' && face) {
    p.drawRectangle({ x: bx.x1, y: bx.y1, width: w, height: h, color: col, borderWidth: 0 });
    const label = linkLabel(s);
    const lw = textWidth(label, fs, face);
    drawLine(p, label, face, { x: cx - lw / 2, y: cy - fs * 0.35, size: fs, color: rgb(1, 1, 1) });
  } else {
    p.drawCircle({ x: cx, y: cy, size: Math.min(w, h) / 2, color: col });
  }
  addUriLink(p, ctx.doc, s, s.url);
};

const table: Painter = (p, s: TableMark, ctx) => {
  const bx = boxOf(s),
    rows = s.rows,
    cols = s.cols;
  const bw = bx.x2 - bx.x1,
    bh = bx.y2 - bx.y1;
  const colXs = cumFracs(colFracs(s)).map((f) => bx.x1 + f * bw);
  const rowYs = cumFracs(rowFracs(s)).map((f) => bx.y2 - f * bh); /* row 0 at the top */
  const mid = shapeMid(s),
    col = hexRgb(s.c || TABLE_LINE);
  const ptAt = (x: number, y: number): Pt => (s.r ? rotPt([x, y], mid, s.r) : [x, y]);
  const thickness = Math.max(0.4, s.w || 1) * 0.6;
  rowYs.forEach((y) => {
    const a = ptAt(bx.x1, y),
      b = ptAt(bx.x2, y);
    p.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness, color: col });
  });
  colXs.forEach((x) => {
    const a = ptAt(x, bx.y1),
      b = ptAt(x, bx.y2);
    p.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness, color: col });
  });
  const font = ctx.extra.tableFont as PDFFont | undefined;
  if (!font) return;
  const face: Face = { font, fallback: ctx.extra.fallback };
  const minRowH = bh / rows;
  const fs = Math.max(6.5, Math.min(10.5, minRowH * 0.34));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const txt = (s.cells[r] && s.cells[r]![c]) || '';
      if (!txt.trim()) continue;
      const cw = colXs[c + 1]! - colXs[c]!,
        rh = rowYs[r]! - rowYs[r + 1]!;
      const x = colXs[c]! + 3,
        y = rowYs[r + 1]! + rh * 0.32;
      const o = ptAt(x, y);
      /* fitted to the cell, with the fallback font for what Helvetica cannot
         draw. v1 called an X.fitText that was never defined, so it cut at 24
         characters and a character the font cannot encode failed the save. */
      drawLine(p, fitLine(face, txt, fs, cw - 6), face, {
        x: o[0],
        y: o[1],
        size: fs,
        color: hexRgb('#1C1F24'),
        rotate: degrees(s.r || 0),
      });
    }
  }
};

const sig: Painter = (p, s: ImageMark, ctx) => {
  const sigs = ctx.extra.sigs as Record<string, PDFImage> | undefined;
  const img = sigs && sigs[s.url];
  if (!img) return;
  p.drawImage(img, {
    x: Math.min(s.a[0], s.b[0]),
    y: Math.min(s.a[1], s.b[1]),
    width: Math.abs(s.b[0] - s.a[0]),
    height: Math.abs(s.b[1] - s.a[1]),
  });
};

export const insertPainters: Record<string, Painter> = { image, video, link, table };
export const formsPainters: Record<string, Painter> = { sig };
