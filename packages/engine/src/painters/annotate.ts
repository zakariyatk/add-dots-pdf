/* Text markup, ink, sticky notes and stamps. Moved from annotate.js. */

import { LineCapStyle } from 'pdf-lib';
import type { Mark, Pt } from '../model';
import { hexRgb } from '../save';
import type { FontNeed, Painter } from './common';

export interface StampDef {
  k: string;
  text: string;
  c: string;
  /** The group it sits under in the picker. */
  g?: string;
  /** Carries a second line with the day it was placed (the mark's `d`). */
  dated?: boolean;
}

/* The colours the stamps are drawn in: a verdict reads by its colour before
   its words do, so the same five do all of them. */
const GO = '#1F9D55';
const NO = '#D23C2E';
const FLAT = '#8A8A8A';
const COLD = '#1F6FEB';
const WARM = '#C07A12';

/* The first one is the fallback for a `k` we no longer know, so 'approved'
   stays first. Every other `k` here is written into saved files, so a key
   may be added but never renamed. */
export const STAMPS: readonly StampDef[] = [
  /* a verdict on a drawing or a document that came back for checking */
  { k: 'approved', text: 'APPROVED', c: GO, g: 'Review' },
  { k: 'apprnote', text: 'APPROVED AS NOTED', c: GO, g: 'Review' },
  { k: 'reviewed', text: 'REVIEWED', c: COLD, g: 'Review' },
  { k: 'checked', text: 'CHECKED', c: COLD, g: 'Review' },
  { k: 'review', text: 'FOR REVIEW', c: WARM, g: 'Review' },
  { k: 'revise', text: 'REVISE AND RESUBMIT', c: WARM, g: 'Review' },
  { k: 'notappr', text: 'NOT APPROVED', c: NO, g: 'Review' },
  { k: 'rejected', text: 'REJECTED', c: NO, g: 'Review' },

  /* where the document itself stands */
  { k: 'draft', text: 'DRAFT', c: FLAT, g: 'Status' },
  { k: 'prelim', text: 'PRELIMINARY', c: FLAT, g: 'Status' },
  { k: 'final', text: 'FINAL', c: COLD, g: 'Status' },
  { k: 'completed', text: 'COMPLETED', c: GO, g: 'Status' },
  { k: 'onhold', text: 'ON HOLD', c: WARM, g: 'Status' },
  { k: 'superseded', text: 'SUPERSEDED', c: FLAT, g: 'Status' },
  { k: 'expired', text: 'EXPIRED', c: NO, g: 'Status' },
  { k: 'void', text: 'VOID', c: NO, g: 'Status' },

  /* who may see the copy in their hands, and which copy it is */
  { k: 'confid', text: 'CONFIDENTIAL', c: NO, g: 'Handling' },
  { k: 'internal', text: 'INTERNAL USE ONLY', c: WARM, g: 'Handling' },
  { k: 'nocopy', text: 'DO NOT COPY', c: NO, g: 'Handling' },
  { k: 'original', text: 'ORIGINAL', c: COLD, g: 'Handling' },
  { k: 'copy', text: 'COPY', c: FLAT, g: 'Handling' },
  { k: 'sample', text: 'SAMPLE', c: FLAT, g: 'Handling' },
  { k: 'info', text: 'FOR INFORMATION', c: COLD, g: 'Handling' },

  /* site drawings */
  { k: 'asbuilt', text: 'AS BUILT', c: GO, g: 'Construction' },
  { k: 'ifc', text: 'ISSUED FOR CONSTRUCTION', c: GO, g: 'Construction' },
  { k: 'nfc', text: 'NOT FOR CONSTRUCTION', c: NO, g: 'Construction' },

  /* the back office */
  { k: 'paid', text: 'PAID', c: GO, g: 'Office' },
  { k: 'received', text: 'RECEIVED', c: COLD, g: 'Office' },
  { k: 'urgent', text: 'URGENT', c: NO, g: 'Office' },

  /* the day it was stamped, printed underneath */
  { k: 'datercv', text: 'RECEIVED', c: COLD, g: 'With the date', dated: true },
  { k: 'dateappr', text: 'APPROVED', c: GO, g: 'With the date', dated: true },
  { k: 'datervw', text: 'REVIEWED', c: COLD, g: 'With the date', dated: true },
  { k: 'date', text: 'DATE', c: FLAT, g: 'With the date', dated: true },
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
  /** For a dated stamp: the day it was placed, as it was written then. */
  dt?: string;
}

/** One line of words inside a stamp's box. */
export interface StampLine {
  text: string;
  size: number;
  /** The baseline, measured up from the bottom of the box. */
  y: number;
  /** How wide the text is at that size. */
  w: number;
}

/** Measures a string in Helvetica-Bold at `size`. */
export type StampMeasure = (text: string, size: number) => number;

/**
 * Where the words go inside a stamp's box. The on-screen renderer
 * (annotate.js, measuring with a canvas) and the painter below both lay a
 * stamp out through this, so what you place is what the saved file shows.
 * A line too long for the box is shrunk until it fits rather than spilling
 * out of it — 'ISSUED FOR CONSTRUCTION' in a narrow box, say.
 */
export function stampLayout(s: StampMark, w: number, h: number, measure: StampMeasure): StampLine[] {
  const def = STAMP_BY_K[s.k] || STAMPS[0]!;
  const date = s.dt ? String(s.dt) : '';
  const fit = (text: string, want: number, y: number): StampLine => {
    let size = Math.max(3, want);
    /* a little air down each side, in proportion to the words */
    const room = Math.max(1, w - size * 0.9);
    let tw = measure(text, size);
    if (tw > room && tw > 0) {
      size = Math.max(2, (size * room) / tw);
      tw = measure(text, size);
    }
    return { text, size, y: y * h, w: tw };
  };
  if (!date) {
    const l = fit(def.text, h * 0.42, 0);
    /* centred: the baseline sits a little below the middle */
    return [{ ...l, y: h * 0.5 - l.size * 0.36 }];
  }
  return [fit(def.text, h * 0.34, 0.5), fit(date, h * 0.24, 0.18)];
}

/**
 * The box a stamp gets from a plain click (no drag): tall enough for its
 * lines and wide enough for its longest one, so a click never crops the
 * words. In PDF points.
 */
export function stampBox(s: StampMark, measure: StampMeasure): { w: number; h: number } {
  const h = s.dt ? 46 : 30;
  const lines = stampLayout(s, 1e6, h, measure);
  const wide = lines.reduce((m, l) => Math.max(m, l.w), 0);
  return { w: Math.max(110, Math.round(wide + h * 0.5)), h };
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
  for (const l of stampLayout(s, w, h, (t, size) => font.widthOfTextAtSize(t, size))) {
    p.drawText(l.text, {
      x: x + (w - l.w) / 2,
      y: y + l.y,
      size: l.size,
      font,
      color: col,
      opacity: 0.9,
    });
  }
};

export const annotatePainters: Record<string, Painter> = { markup, ink, note, stamp };
export const annotateFontNeeds: Record<string, FontNeed> = { stamp: () => 'HelveticaBold' };
