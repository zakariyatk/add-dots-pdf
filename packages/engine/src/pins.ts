/* Photo pins in the saved PDF: the numbered disc on the drawing, and the
   appendix of photo pages (an index of locations, then each location's photos
   four to a page). Moved from core.js.

   Every pin links to its location's first photo page, every index row links
   there too, and every photo page links back to the drawing. */

import { PDFName, degrees, rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { AnyMark } from './model';
import { hexRgb, type PinOut, type SaveHooks } from './save';
import { drawLine, fitLine, needsUnicode, oneLine, textIn, textWidth, type Face } from './text';

/** Pin radius in PDF points, and its colour. */
export const PIN_R = 8;
export const PIN_COLOR = '#E03616';

export interface PinPhoto {
  /** data: URL, PNG or JPEG. */
  src: string;
  cap?: string;
}

/** A site photo location. Several pins may point at one location. */
export interface PinLocation {
  id: string;
  /** The number on the disc. */
  n: string | number;
  ref?: string;
  desc?: string;
  boq?: string;
  note?: string;
  photos: PinPhoto[];
}

/** The bytes of a base64 data: URL. */
export function dataUrlBytes(u: string): Uint8Array {
  const str = String(u),
    i = str.indexOf(',');
  const b = atob(str.slice(i + 1)),
    a = new Uint8Array(b.length);
  for (let k = 0; k < b.length; k++) a[k] = b.charCodeAt(k);
  return a;
}

function addLink(doc: PDFDocument, page: PDFPage, rect: number[], destPage: PDFPage): void {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    Dest: [destPage.ref, PDFName.of('Fit')],
  });
  page.node.addAnnot(doc.context.register(annot));
}

/** The numbered disc, kept upright however the page is turned. */
export function drawPin(
  p: PDFPage,
  s: AnyMark,
  L: PinLocation,
  rotation: number,
  fontB: PDFFont | null,
  fallback?: readonly PDFFont[] | null,
): void {
  const red = hexRgb(PIN_COLOR),
    white = rgb(1, 1, 1);
  const cx = s.a[0],
    cy = s.a[1];
  p.drawCircle({ x: cx, y: cy, size: PIN_R + 1.4, color: white });
  p.drawCircle({ x: cx, y: cy, size: PIN_R, color: red });
  const label = oneLine(L.n);
  if (!label || !fontB) return;
  const face: Face = { font: fontB, fallback };
  const len = Array.from(label).length;
  const size = len <= 2 ? PIN_R * 1.05 : (PIN_R * 2.1) / len;
  const tw = textWidth(label, size, face);
  const ox = -tw / 2,
    oy = -size * 0.36;
  const rad = (rotation * Math.PI) / 180,
    co = Math.cos(rad),
    si = Math.sin(rad);
  drawLine(p, label, face, {
    x: cx + ox * co - oy * si,
    y: cy + ox * si + oy * co,
    size,
    color: white,
    rotate: degrees(rotation),
  });
}

export interface PhotoPagesEnv {
  /** Shown on the index: the document's name. */
  docName: () => string;
  /** Let the page breathe between photo pages (a long save stays responsive). */
  breathe?: () => Promise<void>;
}

/** The appendix: an index of locations, then each location's photos four to a
    page. Returns how many pages were added. */
export async function addPhotoPages(
  out: PDFDocument,
  pinsOut: PinOut[],
  font: PDFFont,
  fontB: PDFFont,
  env: PhotoPagesEnv,
  unicode?: (text?: string) => Promise<PDFFont[]>,
): Promise<number> {
  const AW = 595,
    AH = 842,
    M = 36;
  const ink = rgb(0.1, 0.12, 0.14),
    dim = rgb(0.35, 0.42, 0.5);
  const faint = rgb(0.55, 0.6, 0.65),
    rule = rgb(0.8, 0.84, 0.88);
  const blue = rgb(0.04, 0.47, 0.82),
    amber = rgb(0.72, 0.45, 0.1);
  const red = hexRgb(PIN_COLOR),
    white = rgb(1, 1, 1);

  /* one entry per location, in the order the pins appear */
  type Entry = { L: PinLocation; pin: PinOut; pages: { page: PDFPage; from: number; to: number }[] };
  const seen: Record<string, 1> = {},
    locs: Entry[] = [];
  pinsOut.forEach((q) => {
    const L = q.L as PinLocation;
    if (seen[L.id]) return;
    seen[L.id] = 1;
    locs.push({ L, pin: q, pages: [] });
  });

  const perIdx = 30,
    idxPages: PDFPage[] = [];
  for (let i = 0; i < Math.ceil(locs.length / perIdx); i++) idxPages.push(out.addPage([AW, AH]));
  locs.forEach((e) => {
    const n = e.L.photos.length;
    if (!n) e.pages.push({ page: out.addPage([AW, AH]), from: 0, to: 0 });
    for (let i = 0; i < n; i += 4)
      e.pages.push({ page: out.addPage([AW, AH]), from: i, to: Math.min(n, i + 4) });
  });
  const total = locs.reduce((a, e) => a + e.pages.length, 0);

  /* the fallback fonts, if a location or the document's name needs them */
  const text = textIn(locs.map((e) => e.L)) + '\n' + env.docName();
  const fallback = needsUnicode(text) && unicode ? await unicode(text) : null;
  const F: Face = { font, fallback },
    FB: Face = { font: fontB, fallback };

  const disc = (page: PDFPage, x: number, y: number, r: number, label: unknown, size: number) => {
    page.drawCircle({ x, y, size: r, color: red });
    const t = oneLine(label);
    if (t)
      drawLine(page, t, FB, {
        x: x - textWidth(t, size, FB) / 2,
        y: y - size * 0.36,
        size,
        color: white,
      });
  };

  idxPages.forEach((pg, pi) => {
    pg.drawText('Site photo locations', { x: M, y: AH - 52, size: 15, font: fontB, color: ink });
    drawLine(pg, fitLine(F, env.docName() + '  ·  ' + locs.length + ' locations', 9, AW - 2 * M), F, {
      x: M,
      y: AH - 68,
      size: 9,
      color: dim,
    });
    pg.drawLine({ start: { x: M, y: AH - 80 }, end: { x: AW - M, y: AH - 80 }, thickness: 0.7, color: rule });
    let y = AH - 104;
    locs.slice(pi * perIdx, (pi + 1) * perIdx).forEach((e) => {
      const L = e.L;
      disc(pg, M + 8, y + 3, 8, L.n, 8);
      drawLine(pg, fitLine(FB, L.ref || '(no reference)', 10.5, 130), FB, {
        x: M + 26,
        y,
        size: 10.5,
        color: ink,
      });
      drawLine(
        pg,
        fitLine(F, [L.desc, L.boq ? 'BOQ ' + L.boq : ''].filter(Boolean).join('  ·  '), 9.5, 230),
        F,
        {
          x: M + 162,
          y,
          size: 9.5,
          color: dim,
        },
      );
      const c =
        'p.' + e.pin.pageNo + '  ·  ' + L.photos.length + (L.photos.length === 1 ? ' photo' : ' photos');
      pg.drawText(c, { x: AW - M - font.widthOfTextAtSize(c, 9), y, size: 9, font, color: faint });
      addLink(out, pg, [M, y - 5, AW - M, y + 13], e.pages[0]!.page);
      y -= 22;
    });
    pg.drawText('Index ' + (pi + 1) + ' of ' + idxPages.length, { x: M, y: 28, size: 8, font, color: faint });
  });

  let seq = 0;
  for (const e of locs) {
    const L = e.L;
    for (const g of e.pages) {
      seq++;
      const pg = g.page,
        n = g.to - g.from;
      const head = L.n + '. ' + (L.ref || 'Location') + (L.desc ? ' — ' + L.desc : '');
      drawLine(pg, fitLine(FB, head, 13.5, AW - 2 * M - 110), FB, {
        x: M,
        y: AH - 50,
        size: 13.5,
        color: ink,
      });
      const sub = [
        L.boq ? 'BOQ ' + L.boq : '',
        'drawing page ' + e.pin.pageNo,
        L.photos.length > 4
          ? (n === 1 ? 'photo ' + g.to : 'photos ' + (g.from + 1) + '–' + g.to) + ' of ' + L.photos.length
          : '',
      ]
        .filter(Boolean)
        .join('   ·   ');
      drawLine(pg, fitLine(F, sub, 9, AW - 2 * M), F, { x: M, y: AH - 64, size: 9, color: dim });
      if (L.note)
        drawLine(pg, fitLine(F, L.note, 8.5, AW - 2 * M), F, {
          x: M,
          y: AH - 76,
          size: 8.5,
          color: amber,
        });
      const back = 'Back to page ' + e.pin.pageNo;
      const bw = font.widthOfTextAtSize(back, 9);
      pg.drawText(back, { x: AW - M - bw, y: AH - 50, size: 9, font, color: blue });
      addLink(out, pg, [AW - M - bw - 4, AH - 54, AW - M, AH - 40], e.pin.outPage);
      const ly = AH - (L.note ? 88 : 82);
      pg.drawLine({ start: { x: M, y: ly }, end: { x: AW - M, y: ly }, thickness: 0.7, color: rule });

      const aX = M,
        aY = 58,
        aW = AW - 2 * M,
        aH = ly - 12 - aY;
      if (!n)
        pg.drawText('No photos recorded for this location.', {
          x: M,
          y: aY + aH - 20,
          size: 10,
          font,
          color: faint,
        });
      const cols = n <= 1 ? 1 : 2,
        rows = Math.ceil(n / cols),
        gx = 14,
        gy = 20;
      const cw = (aW - (cols - 1) * gx) / cols,
        ch = (aH - (rows - 1) * gy) / rows;
      for (let k = 0; k < n; k++) {
        const ph = L.photos[g.from + k]!;
        let img: PDFImage;
        try {
          const bytes = dataUrlBytes(ph.src);
          img = /^data:image\/png/i.test(ph.src) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        } catch {
          continue;
        }
        const r = Math.floor(k / cols),
          c = k % cols;
        const x0 = aX + c * (cw + gx),
          yTop = aY + aH - r * (ch + gy);
        const sc = Math.min(cw / img.width, (ch - 13) / img.height);
        const w = img.width * sc,
          h = img.height * sc,
          x = x0 + (cw - w) / 2;
        const y = n === 1 ? aY + 13 + (aH - 13 - h) / 2 : yTop - h;
        pg.drawImage(img, { x, y, width: w, height: h });
        pg.drawRectangle({ x, y, width: w, height: h, borderColor: rule, borderWidth: 0.6 });
        if (ph.cap) {
          const cap = fitLine(F, ph.cap, 8, cw);
          drawLine(pg, cap, F, {
            x: x0 + (cw - textWidth(cap, 8, F)) / 2,
            y: y - 9.5,
            size: 8,
            color: faint,
          });
        }
      }
      pg.drawText('Photo page ' + seq + ' of ' + total, { x: M, y: 28, size: 8, font, color: faint });
      if (env.breathe) await env.breathe();
    }
  }
  /* each pin on the drawing jumps to its first photo page */
  pinsOut.forEach((q) => {
    const e = locs.find((x) => x.L.id === (q.L as PinLocation).id)!;
    const r = PIN_R + 2;
    addLink(out, q.outPage, [q.s.a[0] - r, q.s.a[1] - r, q.s.a[0] + r, q.s.a[1] + r], e.pages[0]!.page);
  });
  return total + idxPages.length;
}

/** SaveHooks.pins for these locations. */
export function pinHooks(
  locs: Record<string, PinLocation>,
  env: PhotoPagesEnv,
): NonNullable<SaveHooks['pins']> {
  return {
    locs,
    draw: (p, s, L, rotation, fontB, fallback) => drawPin(p, s, L as PinLocation, rotation, fontB, fallback),
    addPhotoPages: async (out, pinsOut, font, fontB, unicode) => {
      await addPhotoPages(out, pinsOut, font!, fontB!, env, unicode);
    },
  };
}
