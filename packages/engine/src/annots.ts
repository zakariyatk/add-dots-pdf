/* Markups saved as PDF comments (annotations), editable in Acrobat.

   A mark that is a comment in a PDF reader (highlight, underline and strike,
   ink, sticky note, box, ellipse, line, arrow, text box, stamp) is saved as
   one: its own annotation, with its kind, colour, points and comment text,
   so Acrobat lists it with the comments and can move, edit or delete it.

   How it looks is not left to the reader: each is painted by the same code
   that flattens it, onto a page of its own that is never added to the file,
   and that drawing becomes the annotation's appearance (/AP), in page
   coordinates, over a box (/Rect, /BBox) around the mark. So it prints and
   shows exactly as a flattened one would. The rest (measurements, pins,
   pictures, tables, watermarks, headers and footers, signatures, a text
   edit's patch over the original words) stays painted into the page. */

import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFHexString,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib';
import { arrowHead, boxOf, rotPt, textRect, type MeasureText } from './geometry';
import type { AnyMark, Mark, Pt, TextMark } from './model';
import { hexToRgb01 } from './style';
import { STAMP_BY_K, STAMPS } from './painters/annotate';

const KINDS = new Set(['markup', 'ink', 'note', 'rect', 'ellipse', 'line', 'arrow', 'text', 'stamp']);

/** Whether a mark is saved as an annotation (when marks are kept editable). */
export function isAnnotMark(s: AnyMark): boolean {
  if (!KINDS.has(s.t)) return false;
  /* a text edit covers the original words: that is part of the page */
  if (s.t === 'text') return !(s as TextMark).patch && !!String((s as TextMark).text).trim();
  return true;
}

type Quad = [number, number, number, number];
interface Anyish {
  [k: string]: unknown;
}

/* the box around a mark, in page points, wide enough for its stroke */
export function annotRect(s: AnyMark, measure: MeasureText): [number, number, number, number] {
  const pts: Pt[] = [];
  const m = s as Mark & Anyish;
  const w = typeof m.w === 'number' ? m.w : 1;
  let pad = Math.max(2, w);
  if (s.t === 'markup') for (const q of (m.quads as Quad[]) || []) pts.push([q[0], q[1]], [q[2], q[3]]);
  else if (s.t === 'ink') for (const p of (m.pts as Pt[]) || []) pts.push(p);
  else if (s.t === 'note') pts.push([s.a[0], s.a[1] - 10], [s.a[0] + 16, s.a[1]]);
  else if (s.t === 'text') {
    const t = s as TextMark;
    const r = textRect(t, measure);
    const c: Pt[] = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ];
    for (const p of c) pts.push(t.r ? rotPt(p, [t.a[0], t.a[1]], t.r) : p);
    pad = Math.max(2, t.size * 0.3);
  } else if (s.t === 'line' || s.t === 'arrow') {
    pts.push(m.a, m.b);
    if (s.t === 'arrow') for (const h of arrowHead(m.a[0], m.a[1], m.b[0], m.b[1], w)) pts.push(h);
  } else {
    /* rect, ellipse, stamp: the box, turned */
    const b = boxOf(m),
      mid: Pt = [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
    const c: Pt[] = [
      [b.x1, b.y1],
      [b.x2, b.y1],
      [b.x2, b.y2],
      [b.x1, b.y2],
    ];
    for (const p of c) pts.push(m.r ? rotPt(p, mid, m.r) : p);
  }
  if (!pts.length) pts.push([s.a[0], s.a[1]]);
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function pdfDate(ms: number): string {
  const d = new Date(ms);
  const z = (n: number) => String(n).padStart(2, '0');
  return (
    'D:' +
    d.getUTCFullYear() +
    z(d.getUTCMonth() + 1) +
    z(d.getUTCDate()) +
    z(d.getUTCHours()) +
    z(d.getUTCMinutes()) +
    z(d.getUTCSeconds()) +
    'Z'
  );
}

/* the comment's text: a note's, with its replies after it */
function commentText(s: AnyMark): string {
  const n = (s as Anyish).note as { text?: string; replies?: { text?: string }[] } | undefined;
  if (!n) return '';
  const parts = [n.text || ''].concat((n.replies || []).map((r) => r.text || '').filter(Boolean));
  return parts.filter(Boolean).join('\n\n');
}

const rgb = (hex: unknown) => (typeof hex === 'string' && hex ? hexToRgb01(hex) : null);

/* what each kind of annotation records of its mark, besides its look */
function fieldsOf(s: AnyMark): Record<string, unknown> {
  const m = s as Mark & Anyish;
  const w = typeof m.w === 'number' ? m.w : 1;
  const border = { W: w, S: m.d ? 'D' : 'S', ...(m.d ? { D: m.d === 2 ? [w, w * 2] : [w * 3, w * 2] } : {}) };
  switch (s.t) {
    case 'markup': {
      const quads = ((m.quads as Quad[]) || []).flatMap((q) => [
        q[0],
        q[3],
        q[2],
        q[3],
        q[0],
        q[1],
        q[2],
        q[1],
      ]);
      const sub = m.k === 'underline' ? 'Underline' : m.k === 'strike' ? 'StrikeOut' : 'Highlight';
      return { Subtype: sub, QuadPoints: quads };
    }
    case 'ink':
      return { Subtype: 'Ink', InkList: [((m.pts as Pt[]) || []).flat()], BS: { W: w } };
    case 'note':
      return { Subtype: 'Text', Name: 'Comment', Open: false };
    case 'line':
    case 'arrow':
      return {
        Subtype: 'Line',
        L: [m.a[0], m.a[1], m.b[0], m.b[1]],
        BS: border,
        ...(s.t === 'arrow' ? { LE: ['None', 'OpenArrow'] } : {}),
      };
    case 'rect':
    case 'ellipse': {
      const fill = rgb(m.fill);
      return { Subtype: s.t === 'rect' ? 'Square' : 'Circle', BS: border, ...(fill ? { IC: fill } : {}) };
    }
    case 'stamp': {
      const def = STAMP_BY_K[m.k as string] || STAMPS[0]!;
      return { Subtype: 'Stamp', Name: def.text.replace(/[^A-Za-z]/g, '') };
    }
    case 'text': {
      const t = s as TextMark;
      const c = rgb(t.c) || [0, 0, 0];
      /* the text's look for a reader that redraws it (a string, not a name) */
      const da = '/Helv ' + t.size + ' Tf ' + c.map((n) => +n.toFixed(4)).join(' ') + ' rg';
      return { Subtype: 'FreeText', DA: PDFString.of(da) };
    }
  }
  return {};
}

/** A page of its own, for painting one mark's appearance on. */
export function scratchPage(out: PDFDocument): PDFPage {
  return PDFPage.create(out);
}

/**
 * Turns what was painted on `scratch` into the appearance of an annotation
 * for mark `s`, adds that to `page`, and drops the scratch page.
 */
export function commitAnnot(
  out: PDFDocument,
  page: PDFPage,
  scratch: PDFPage,
  s: AnyMark,
  rect: [number, number, number, number],
): void {
  const ctx = out.context;
  const contents = scratch.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const chunks: Uint8Array[] = [];
  for (const r of refs) {
    const obj = r instanceof PDFRef ? ctx.lookup(r) : r;
    if (obj instanceof PDFContentStream) chunks.push(obj.getUnencodedContents());
    else if (obj instanceof PDFRawStream) chunks.push(decodePDFRawStream(obj).decode());
    if (r instanceof PDFRef) ctx.delete(r);
  }
  ctx.delete(scratch.ref);
  const size = chunks.reduce((n, c) => n + c.length + 1, 0);
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    body[at + c.length] = 0x0a;
    at += c.length + 1;
  }
  const res = scratch.node.Resources() || PDFDict.withContext(ctx);
  const ap = ctx.register(
    ctx.flateStream(body, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: res }),
  );

  const m = s as Mark & Anyish;
  const color = rgb(m.c) || (s.t === 'note' ? rgb('#F2C14E') : null);
  const op = typeof m.o === 'number' ? m.o : null;
  const now = Date.now();
  const created = (m.note as { created?: number } | undefined)?.created || (m.created as number) || now;
  const dict = ctx.obj({
    Type: 'Annot',
    ...fieldsOf(s),
    Rect: rect,
    F: 4 /* print */,
    AP: { N: ap },
    M: PDFString.of(pdfDate(now)),
    CreationDate: PDFString.of(pdfDate(created)),
    ...(m.id != null ? { NM: PDFString.of(String(m.id)) } : {}),
    ...(color ? { C: color } : {}),
    ...(op != null && op < 1 ? { CA: op } : {}),
  }) as PDFDict;
  const text = s.t === 'text' ? String((s as TextMark).text) : commentText(s);
  if (text) dict.set(PDFName.of('Contents'), PDFHexString.fromText(text));
  /* onto the page's list directly: pdf-lib's addAnnot first "normalizes"
     the page, wrapping its content in q..Q, which changes it for nothing */
  const ref = ctx.register(dict);
  const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (list) list.push(ref);
  else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
}
