/* The document model the editor works on.

   A mark is a plain object in `item.shapes`, stored in PDF points. That is what
   lets undo, save, the JPG export and the thumbnails handle every mark type
   without extra wiring. Feature modules add their own mark types (`t`) with
   their own fields, so the index signature stays open. */

export type Pt = [number, number];

/** A PDF the pages were taken from. `id` groups pages that share one source. */
export interface Source {
  id: number | string;
  bytes: Uint8Array;
  name?: string;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MarkBase {
  /** Mark type: rect, line, arrow, text, pin, or a module's own (ink, cloud, sig…). */
  t: string;
  a: Pt;
  /** Colour, #RRGGBB. */
  c: string;
  /** Opacity 0..1 (default 1). */
  o?: number;
  /** Rotation in degrees, about the mark's centre (text: about its anchor `a`). */
  r?: number;
  [key: string]: unknown;
}

/** A two-point mark: box, line, arrow, and most module marks. */
export interface Mark extends MarkBase {
  b: Pt;
  /** Stroke width in points. */
  w: number;
  /** Dash style: 0 solid, 1 dashed, 2 dotted. */
  d?: number;
  /** Line cap: 0 butt, 1 round (default), 2 square. */
  cap?: number;
  /** Line join: 0 miter, 1 round (default), 2 bevel. */
  j?: number;
  /** Fill colour for boxes. */
  fill?: string | null;
}

/** A standard PDF font, or 'g:<id>': a Google Font the page supplies (see SaveHooks.fonts). */
export type StandardFamily = 'helv' | 'times' | 'cour';
export type FontFamily = StandardFamily | `g:${string}`;
export type Align = 'left' | 'center' | 'right';

/** A font of the page, as a table to write text in it again: the characters
    it can draw there, each with its code, and the codes' widths (Edit
    Object's Text, contenttext.ts). */
export interface PageFont {
  /** its name in the page's resources */
  res: string;
  twoByte: boolean;
  /** character -> code */
  map: Record<string, number>;
  /** code -> width, in thousandths of the font size */
  w: Record<number, number>;
}

/** A text mark has one point, its baseline anchor `a`. Careful: here `b` means
    bold, not a second point. */
export interface TextMark extends MarkBase {
  t: 'text';
  text: string;
  size: number;
  f: FontFamily;
  /** bold, italic, underline, strikethrough */
  b?: boolean;
  i?: boolean;
  u?: boolean;
  k?: boolean;
  align?: Align;
  bg?: string | null;
  bgOp?: number;
  /** A block painted under replaced text, in PDF points. */
  patch?: (Crop & { c: string }) | null;
  /** Lifted from the page by Edit Object: the page's own font, and the
      family, bold and italic the mark had then. While it keeps those, text
      the font can draw is saved in it (pagefont.ts). */
  pf?: (PageFont & { f: FontFamily; b: boolean; i: boolean }) | null;
}

/** One page in the editor: page `num` (1-based) of `src`, plus what was done to it. */
export interface PageItem {
  src: Source;
  num: number;
  /** Extra rotation on top of the page's own, in degrees. */
  rot: number;
  crop?: Crop | null;
  shapes: AnyMark[];
  [key: string]: unknown;
}

export type AnyMark = Mark | TextMark;

export function isText(s: AnyMark): s is TextMark {
  return s.t === 'text';
}
