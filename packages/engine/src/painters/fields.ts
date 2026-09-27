/* Filled form fields, painted (flattened) into the saved page. Moved from
   forms.js.

   A rebuilt page cannot carry the original interactive widgets, so each
   answer is drawn where its widget was. buildPdf has already turned the page
   by it.rot when finish hooks run, and a widget rect is in the un-turned page
   space, so this lands correctly whatever the rotation. */

import { LineCapStyle, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PageItem } from '../model';
import { hexRgb, type SaveHooks } from '../save';
import { drawLine, fitLine, needsUnicode, oneLine, textWidth, type Face } from '../text';

/** One widget, as forms.js reads it from pdf.js. */
export interface FormField {
  name: string;
  /** Tx text, Btn checkbox or radio, Ch choice, Sig signature. */
  type: string;
  /** [x1, y1, x2, y2] in PDF points, corners in either order. */
  rect: [number, number, number, number];
  multiline?: boolean;
  /** The field's own text size; 0 means size it from the box. */
  fontSize?: number;
  /** A checkbox or radio button's "on" value. */
  exportValue?: string;
  [key: string]: unknown;
}

/** Field name -> the answer given. */
export type FieldValues = Record<string, unknown>;

type FinishHook = NonNullable<SaveHooks['finish']>[number];

const TICK = '#1B2A4A';
const INK = '#0B0B0B';
/** The smallest size a one-line answer is shrunk to before it is shortened. */
const MIN_SIZE = 6;

export function isOn(v: unknown, exportValue?: string): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v);
  return s !== 'Off' && s !== '' && (exportValue ? s === exportValue : true);
}

export function hasValue(f: FormField, values: FieldValues): boolean {
  const v = values[f.name];
  if (v == null || v === '') return false;
  if (f.type === 'Btn') return isOn(v, f.exportValue);
  return String(v).trim().length > 0;
}

/** Word-wraps text to a width; explicit line breaks are kept. A word wider
    than the width on its own is broken between characters, as a textarea
    shows it; v1 let it run out of the box. */
export function wrapText(text: string, face: PDFFont | Face, size: number, max: number): string[] {
  const width = (t: string) => textWidth(t, size, face);
  const out: string[] = [];
  String(text)
    .split('\n')
    .map(oneLine)
    .forEach((para) => {
      let line = '';
      para.split(/\s+/).forEach((word) => {
        const probe = line ? line + ' ' + word : word;
        if (width(probe) <= max) {
          line = probe;
          return;
        }
        if (line) out.push(line);
        line = '';
        for (const ch of word) {
          if (line && width(line + ch) > max) {
            out.push(line);
            line = ch;
          } else line += ch;
        }
      });
      out.push(line);
    });
  return out;
}

function paintField(p: PDFPage, f: FormField, v: unknown, face: Face): void {
  const x1 = Math.min(f.rect[0], f.rect[2]),
    x2 = Math.max(f.rect[0], f.rect[2]);
  const y1 = Math.min(f.rect[1], f.rect[3]),
    y2 = Math.max(f.rect[1], f.rect[3]);
  const w = x2 - x1,
    h = y2 - y1;

  if (f.type === 'Btn') {
    if (!isOn(v, f.exportValue)) return;
    /* Two strokes rather than a Dingbats glyph: the tick then renders in
       every viewer without depending on a font's encoding. */
    const m = Math.min(w, h),
      cx = x1 + w / 2,
      cy = y1 + h / 2;
    const thickness = Math.max(0.8, m * 0.14);
    const color = hexRgb(TICK);
    p.drawLine({
      start: { x: cx - m * 0.3, y: cy + m * 0.02 },
      end: { x: cx - m * 0.07, y: cy - m * 0.24 },
      thickness,
      color,
      lineCap: LineCapStyle.Round,
    });
    p.drawLine({
      start: { x: cx - m * 0.07, y: cy - m * 0.24 },
      end: { x: cx + m * 0.32, y: cy + m * 0.28 },
      thickness,
      color,
      lineCap: LineCapStyle.Round,
    });
    return;
  }

  const text = String(v);
  if (!text.trim()) return;
  const size = f.fontSize && f.fontSize > 0 ? f.fontSize : Math.min(11, Math.max(6, h * 0.62));
  if (f.multiline) {
    wrapText(text, face, size, w - 4).forEach((line, li) => {
      const ly = y2 - size - 2 - li * size * 1.22;
      if (ly < y1 - size) return;
      drawLine(p, line, face, { x: x1 + 2, y: ly, size, color: hexRgb(INK) });
    });
  } else {
    /* One line, kept inside the box: shrunk towards 6pt, then shortened with
       an ellipsis. v1 passed maxWidth, which made pdf-lib wrap a long answer
       onto a second line below the box. */
    const line = oneLine(text);
    const room = w - 4;
    const width = textWidth(line, size, face);
    const fit = width > room ? Math.max(Math.min(size, MIN_SIZE), (size * room) / width) : size;
    drawLine(p, fitLine(face, line, fit, room), face, {
      x: x1 + 2,
      y: y1 + (h - fit) / 2 + fit * 0.2,
      size: fit,
      color: hexRgb(INK),
    });
  }
}

/** The finish hook that paints every answered field. `values` is read at save
    time, so the editor can keep changing its answers. */
export function fieldsFinish(values: () => FieldValues): FinishHook {
  return async (out, items: PageItem[], slots, extra) => {
    const vals = values();
    const fieldsOf = (it: PageItem) => (it.fields as FormField[] | null | undefined) || [];
    const answered = items.flatMap((it) => fieldsOf(it).filter((f) => hasValue(f, vals)));
    if (!answered.length) return;
    const font = await out.embedFont(StandardFonts.Helvetica);
    /* the fallback font, for answers Helvetica cannot draw (✓, →, Greek…) */
    const needs = answered.some((f) => f.type !== 'Btn' && needsUnicode(vals[f.name]));
    const fallback = extra.fallback || (needs && extra.unicode ? await extra.unicode() : null);
    const face: Face = { font, fallback };
    items.forEach((it, i) => {
      const p = slots[i];
      if (!p) return;
      fieldsOf(it).forEach((f) => {
        if (hasValue(f, vals)) paintField(p, f, vals[f.name], face);
      });
    });
  };
}
