/* Redaction boxes and the running marks: watermark, header and footer, Bates
   numbers. Moved from docops.js. */

import { degrees, rgb } from 'pdf-lib';
import type { Mark } from '../model';
import { hexRgb } from '../save';
import type { FontNeed, Painter } from './common';

export interface WatermarkMark extends Mark {
  t: 'wm';
  text: string;
  size: number;
  /** Repeat across the page instead of one in the middle. */
  tile?: boolean;
}
export interface HeaderFooterMark extends Mark {
  t: 'hf';
  size: number;
  margin: number;
  /** Header and footer, left/centre/right. {page} {pages} {date} {file} are filled in. */
  cfg: { hl?: string; hc?: string; hr?: string; fl?: string; fc?: string; fr?: string };
}
export interface BatesMark extends Mark {
  t: 'bates';
  label: string;
  size: number;
  /** tl, tc, tr, bl, bc, br */
  pos: string;
}

/** What the header and footer fill in, supplied by the editor. */
export interface DocEnv {
  /** For {pages}: pages in the open document. */
  totalPages: () => number;
  /** For {file}. */
  fileName: () => string;
  /** For {date}. */
  today: () => string;
}

/** Until they are applied, redactions still save as solid black boxes, so a file
    saved halfway through is covered, just not yet scrubbed. */
const redact: Painter = (p, s: Mark) => {
  p.drawRectangle({
    x: Math.min(s.a[0], s.b[0]),
    y: Math.min(s.a[1], s.b[1]),
    width: Math.abs(s.b[0] - s.a[0]),
    height: Math.abs(s.b[1] - s.a[1]),
    color: rgb(0, 0, 0),
    borderWidth: 0,
  });
};

const wm: Painter = (p, s: WatermarkMark, ctx) => {
  const font = ctx.fonts.HelveticaBold;
  if (!font) return;
  const { width: W, height: H } = p.getSize();
  const col = hexRgb(s.c);
  const draw = (cxp: number, cyp: number) => {
    const w = font.widthOfTextAtSize(s.text, s.size);
    const t = ((s.r || 0) * Math.PI) / 180;
    /* pdf-lib turns text about its origin, so step back along the baseline by
       half the string to leave the middle of the text on (cx, cy) */
    p.drawText(s.text, {
      x: cxp - (Math.cos(t) * w) / 2 + Math.sin(t) * s.size * 0.35,
      y: cyp - (Math.sin(t) * w) / 2 - Math.cos(t) * s.size * 0.35,
      size: s.size,
      font,
      color: col,
      opacity: s.o,
      rotate: degrees(s.r || 0),
    });
  };
  if (s.tile) {
    const stepX = Math.max(90, font.widthOfTextAtSize(s.text, s.size) * 1.35);
    const stepY = Math.max(70, s.size * 3.4);
    for (let y = stepY / 2; y < H + stepY; y += stepY) {
      for (let x = stepX / 2; x < W + stepX; x += stepX) draw(x, y);
    }
  } else {
    draw(W / 2, H / 2);
  }
};

const bates: Painter = (p, s: BatesMark, ctx) => {
  const font = ctx.fonts.Helvetica;
  if (!font) return;
  const { width: W, height: H } = p.getSize();
  const w = font.widthOfTextAtSize(s.label, s.size),
    m = 26;
  const x = /r$/.test(s.pos) ? W - m - w : /l$/.test(s.pos) ? m : (W - w) / 2;
  const y = s.pos.charAt(0) === 't' ? H - m : m - s.size;
  p.drawText(s.label, { x, y, size: s.size, font, color: hexRgb(s.c) });
};

export function docopsPainters(env: DocEnv): Record<string, Painter> {
  const hf: Painter = (p, s: HeaderFooterMark, ctx) => {
    const font = ctx.fonts.Helvetica;
    if (!font) return;
    const { width: W, height: H } = p.getSize();
    const col = hexRgb(s.c),
      m = s.margin,
      size = s.size;
    const total = env.totalPages();
    const fill = (t: string | undefined) =>
      String(t || '')
        .replace(/\{page\}/g, String(ctx.index + 1))
        .replace(/\{pages\}/g, String(total))
        .replace(/\{date\}/g, env.today())
        .replace(/\{file\}/g, env.fileName());
    const put = (raw: string | undefined, align: 'l' | 'c' | 'r', y: number) => {
      const t = fill(raw);
      if (!t.trim()) return;
      const w = font.widthOfTextAtSize(t, size);
      const x = align === 'l' ? m : align === 'r' ? W - m - w : (W - w) / 2;
      p.drawText(t, { x, y, size, font, color: col });
    };
    put(s.cfg.hl, 'l', H - m);
    put(s.cfg.hc, 'c', H - m);
    put(s.cfg.hr, 'r', H - m);
    put(s.cfg.fl, 'l', m - size);
    put(s.cfg.fc, 'c', m - size);
    put(s.cfg.fr, 'r', m - size);
  };
  return { redact, wm, hf, bates };
}

export const docopsFontNeeds: Record<string, FontNeed> = {
  wm: () => 'HelveticaBold',
  hf: () => 'Helvetica',
  bates: () => 'Helvetica',
};
