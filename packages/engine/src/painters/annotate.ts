/* Text markup, ink, sticky notes and stamps. Moved from annotate.js. */

import { LineCapStyle } from 'pdf-lib';
import type { Mark, Pt } from '../model';
import { hexRgb } from '../save';
import type { FontNeed, Painter } from './common';

export interface StampDef {
  k: string;
  text: string;
  c: string;
}

export const STAMPS: readonly StampDef[] = [
  { k: 'approved', text: 'APPROVED', c: '#1F9D55' },
  { k: 'rejected', text: 'REJECTED', c: '#D23C2E' },
  { k: 'draft', text: 'DRAFT', c: '#8A8A8A' },
  { k: 'final', text: 'FINAL', c: '#1F6FEB' },
  { k: 'review', text: 'FOR REVIEW', c: '#C07A12' },
  { k: 'asbuilt', text: 'AS BUILT', c: '#1F9D55' },
  { k: 'confid', text: 'CONFIDENTIAL', c: '#D23C2E' },
  { k: 'void', text: 'VOID', c: '#D23C2E' },
];
export const STAMP_BY_K: Readonly<Record<string, StampDef>> = Object.fromEntries(STAMPS.map((s) => [s.k, s]));

/** Highlight, underline or strike over text. quads are [x1, y1, x2, y2]. */
export interface MarkupMark extends Mark {
  t: 'markup';
  k: 'highlight' | 'underline' | 'strike';
  quads?: [number, number, number, number][];
}
export interface InkMark extends Mark {
  t: 'ink';
  pts?: Pt[];
}
export interface NoteMark extends Mark {
  t: 'note';
  note?: { resolved?: boolean };
}
export interface StampMark extends Mark {
  t: 'stamp';
  k: string;
}

const markup: Painter = (p, s: MarkupMark) => {
  const col = hexRgb(s.c);
  (s.quads || []).forEach((q) => {
    const x1 = q[0],
      y1 = q[1],
      x2 = q[2],
      y2 = q[3];
    if (s.k === 'highlight') {
      p.drawRectangle({
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        color: col,
        opacity: s.o == null ? 0.38 : s.o,
        borderWidth: 0,
      });
    } else {
      const h = y2 - y1;
      const y = s.k === 'underline' ? y1 + h * 0.08 : y1 + h * 0.5;
      p.drawLine({
        start: { x: x1, y },
        end: { x: x2, y },
        thickness: Math.max(0.6, h * 0.07 * 1.6),
        color: col,
        opacity: s.o == null ? 1 : s.o,
      });
    }
  });
};

const ink: Painter = (p, s: InkMark) => {
  const col = hexRgb(s.c),
    pts = s.pts || [];
  for (let i = 1; i < pts.length; i++) {
    p.drawLine({
      start: { x: pts[i - 1]![0], y: pts[i - 1]![1] },
      end: { x: pts[i]![0], y: pts[i]![1] },
      thickness: s.w,
      color: col,
      opacity: s.o == null ? 1 : s.o,
      lineCap: LineCapStyle.Round,
    });
  }
  if (pts.length === 1) {
    p.drawCircle({ x: pts[0]![0], y: pts[0]![1], size: s.w / 2, color: col, borderWidth: 0 });
  }
};

/** A sticky note prints as its folded-corner tag; the comment text itself goes
    on the summary pages so a printed set stays readable. */
const note: Painter = (p, s: NoteMark) => {
  const w = 16,
    h = 10;
  const col = hexRgb(s.note && s.note.resolved ? '#C7E9D5' : s.c || '#F2C14E');
  p.drawRectangle({
    x: s.a[0],
    y: s.a[1] - h,
    width: w,
    height: h,
    color: col,
    borderColor: hexRgb('#333333'),
    borderWidth: 0.6,
  });
  for (let i = 0; i < 2; i++) {
    p.drawLine({
      start: { x: s.a[0] + 3, y: s.a[1] - 3.5 - i * 3 },
      end: { x: s.a[0] + w - 3, y: s.a[1] - 3.5 - i * 3 },
      thickness: 0.7,
      color: hexRgb('#444444'),
    });
  }
};

const stamp: Painter = (p, s: StampMark, ctx) => {
  const def = STAMP_BY_K[s.k] || STAMPS[0]!;
  const col = hexRgb(def.c);
  const x = Math.min(s.a[0], s.b[0]),
    y = Math.min(s.a[1], s.b[1]);
  const w = Math.abs(s.b[0] - s.a[0]),
    h = Math.abs(s.b[1] - s.a[1]);
  p.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: col,
    borderWidth: Math.max(1, h * 0.06),
    borderOpacity: 0.9,
    opacity: 0,
  });
  const font = ctx.fonts.HelveticaBold;
  if (!font) return;
  const size = Math.max(4, h * 0.42);
  const tw = font.widthOfTextAtSize(def.text, size);
  p.drawText(def.text, {
    x: x + (w - tw) / 2,
    y: y + h / 2 - size * 0.36,
    size,
    font,
    color: col,
    opacity: 0.9,
  });
};

export const annotatePainters: Record<string, Painter> = { markup, ink, note, stamp };
export const annotateFontNeeds: Record<string, FontNeed> = { stamp: () => 'HelveticaBold' };
