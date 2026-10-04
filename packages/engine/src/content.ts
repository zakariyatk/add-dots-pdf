/* A page's own content, read and edited: the shapes it draws.

   A page draws itself with a content stream, a list of operators such as
   "10 10 m 100 100 l S" (move, line, stroke). Edit Object lists the shapes
   that list paints — each path from its first point to the operator that
   strokes or fills it — with where it sits on the page, its colours and its
   line. A shape picked to edit is cut out of the stream, byte for byte, and
   comes back as a mark (see painters/vpath.ts) that can be moved, resized,
   recoloured or deleted; nothing else in the stream changes.

   Shapes inside a form XObject, a clipping path, or painted with a pattern
   are not offered: cutting them would change more than the one shape. */

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type { Pt } from './model';

/* ---------------- reading the operators ---------------- */

export type Operand = number | boolean | null | { name: string } | { str: true } | Operand[] | { dict: true };

export interface ContentOp {
  op: string;
  args: Operand[];
  /** byte range of the operator with its operands */
  start: number;
  end: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** The operators of a content stream, each with the bytes it spans. */
export function parseContent(b: Uint8Array): ContentOp[] {
  const ops: ContentOp[] = [];
  let i = 0;
  const n = b.length;
  let stack: Operand[] = [];
  let argStart = -1;
  /* nested arrays being read */
  const arrays: Operand[][] = [];

  const push = (v: Operand, at: number) => {
    if (arrays.length) arrays[arrays.length - 1]!.push(v);
    else {
      if (argStart < 0) argStart = at;
      stack.push(v);
    }
  };
  const skipWs = () => {
    while (i < n) {
      const c = b[i]!;
      if (WS.has(c)) i++;
      else if (c === 37) {
        while (i < n && b[i] !== 10 && b[i] !== 13) i++;
      } else break;
    }
  };

  while (i < n) {
    skipWs();
    if (i >= n) break;
    const at = i;
    const c = b[i]!;
    if (c === 40) {
      /* (a literal string), with nesting and escapes */
      let depth = 0;
      for (; i < n; i++) {
        const d = b[i]!;
        if (d === 92) i++;
        else if (d === 40) depth++;
        else if (d === 41 && --depth === 0) break;
      }
      i++;
      push({ str: true }, at);
    } else if (c === 60 && b[i + 1] === 60) {
      /* << a dictionary >>: skipped whole, nested ones too */
      let depth = 0;
      for (; i < n; i++) {
        if (b[i] === 60 && b[i + 1] === 60) {
          depth++;
          i++;
        } else if (b[i] === 62 && b[i + 1] === 62) {
          i++;
          if (--depth === 0) break;
        } else if (b[i] === 40) {
          let sd = 0;
          for (; i < n; i++) {
            if (b[i] === 92) i++;
            else if (b[i] === 40) sd++;
            else if (b[i] === 41 && --sd === 0) break;
          }
        }
      }
      i++;
      push({ dict: true }, at);
    } else if (c === 60) {
      while (i < n && b[i] !== 62) i++;
      i++;
      push({ str: true }, at);
    } else if (c === 91) {
      i++;
      if (!arrays.length && argStart < 0) argStart = at;
      arrays.push([]);
    } else if (c === 93) {
      i++;
      const arr = arrays.pop() || [];
      push(arr, at);
    } else if (c === 47) {
      i++;
      const s = i;
      while (i < n && !WS.has(b[i]!) && !DELIM.has(b[i]!)) i++;
      push({ name: String.fromCharCode(...b.subarray(s, i)) }, at);
    } else if (c === 41 || c === 62 || c === 123 || c === 125) {
      i++; /* stray delimiter: ignored */
    } else {
      const s = i;
      while (i < n && !WS.has(b[i]!) && !DELIM.has(b[i]!)) i++;
      const tok = String.fromCharCode(...b.subarray(s, i));
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) push(parseFloat(tok), at);
      else if (tok === 'true' || tok === 'false') push(tok === 'true', at);
      else if (tok === 'null') push(null, at);
      else if (arrays.length) arrays[arrays.length - 1]!.push(null); /* an operator inside [ ]: malformed */
      else {
        const start = argStart < 0 ? at : argStart;
        if (tok === 'ID') {
          /* inline image data runs to whitespace EI whitespace */
          i++;
          while (
            i < n &&
            !(WS.has(b[i - 1]!) && b[i] === 69 && b[i + 1] === 73 && (i + 2 >= n || WS.has(b[i + 2]!)))
          )
            i++;
          i += 2;
          ops.push({ op: 'BI', args: [], start, end: i });
        } else if (tok === 'BI') {
          /* its dictionary is read as operands of ID; BI itself starts the run */
          stack = [];
          argStart = at;
          continue;
        } else ops.push({ op: tok, args: stack, start, end: i });
        stack = [];
        argStart = -1;
      }
    }
  }
  return ops;
}

/* ---------------- the shapes they paint ---------------- */

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Mat, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A shape the page paints, in the page's own space (PDF points). */
export interface ContentShape {
  /** the index of its painting operator: names it in this page's content */
  id: number;
  /** first and last operator of it */
  first: number;
  last: number;
  /** path commands, one letter each: M L C (three points) Z, over pts */
  cmds: string;
  pts: Pt[];
  /** stroke colour, or null if not stroked */
  stroke: string | null;
  /** fill colour, or null if not filled */
  fill: string | null;
  evenOdd: boolean;
  /** line width, dash, cap and join, as drawn on the page */
  w: number;
  dash: number[] | null;
  cap: number;
  join: number;
  /** stroke and fill opacity (1 unless the graphics state says) */
  so: number;
  fo: number;
  /** its bounds */
  box: [number, number, number, number];
}

interface GState {
  ctm: Mat;
  stroke: string | null;
  fill: string | null;
  w: number;
  dash: number[] | null;
  cap: number;
  join: number;
  so: number;
  fo: number;
  /* colour spaces' component counts, for sc/scn */
  sn: number;
  fn: number;
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, '0');
function colour(args: Operand[]): string | null {
  const v = args.filter((a): a is number => typeof a === 'number');
  if (v.length !== args.length) return null; /* a pattern: not a plain colour */
  if (v.length === 1) return '#' + hex2(v[0]!) + hex2(v[0]!) + hex2(v[0]!);
  if (v.length === 3) return '#' + hex2(v[0]!) + hex2(v[1]!) + hex2(v[2]!);
  if (v.length === 4) {
    const [c, m, y, k] = v as [number, number, number, number];
    return '#' + hex2((1 - c) * (1 - k)) + hex2((1 - m) * (1 - k)) + hex2((1 - y) * (1 - k));
  }
  return null;
}
const spaceCount: Record<string, number> = {
  DeviceGray: 1,
  DeviceRGB: 3,
  DeviceCMYK: 4,
  CalGray: 1,
  CalRGB: 3,
  Lab: 3,
};

/** The shapes a content stream paints. `gstates` gives an ExtGState's stroke
    and fill opacity by its resource name. */
export function contentShapes(
  ops: ContentOp[],
  gstates: Record<string, { CA?: number; ca?: number }> = {},
): ContentShape[] {
  const out: ContentShape[] = [];
  let gs: GState = {
    ctm: [1, 0, 0, 1, 0, 0],
    stroke: '#000000',
    fill: '#000000',
    w: 1,
    dash: null,
    cap: 0,
    join: 0,
    so: 1,
    fo: 1,
    sn: 1,
    fn: 1,
  };
  const stack: GState[] = [];
  let cmds = '',
    pts: Pt[] = [],
    first = -1,
    clip = false,
    cur: Pt | null = null,
    inText = false;
  const reset = () => {
    cmds = '';
    pts = [];
    first = -1;
    clip = false;
    cur = null;
  };
  const num = (a: Operand | undefined) => (typeof a === 'number' ? a : 0);

  ops.forEach((o, k) => {
    const a = o.args;
    switch (o.op) {
      case 'q':
        stack.push({ ...gs, dash: gs.dash && gs.dash.slice() });
        return;
      case 'Q':
        gs = stack.pop() || gs;
        return;
      case 'cm':
        if (a.length === 6) gs.ctm = mul(a.map(num) as Mat, gs.ctm);
        return;
      case 'w':
        gs.w = num(a[0]);
        return;
      case 'J':
        gs.cap = num(a[0]);
        return;
      case 'j':
        gs.join = num(a[0]);
        return;
      case 'd':
        gs.dash = Array.isArray(a[0]) ? (a[0] as Operand[]).map(num) : null;
        if (gs.dash && !gs.dash.length) gs.dash = null;
        return;
      case 'gs': {
        const nm = a[0] && typeof a[0] === 'object' && 'name' in a[0] ? a[0].name : '';
        const g = gstates[nm];
        if (g && typeof g.CA === 'number') gs.so = g.CA;
        if (g && typeof g.ca === 'number') gs.fo = g.ca;
        return;
      }
      case 'G':
      case 'RG':
      case 'K':
        gs.stroke = colour(a);
        gs.sn = a.length;
        return;
      case 'g':
      case 'rg':
      case 'k':
        gs.fill = colour(a);
        gs.fn = a.length;
        return;
      case 'CS':
      case 'cs': {
        const nm = a[0] && typeof a[0] === 'object' && 'name' in a[0] ? a[0].name : '';
        const cnt = spaceCount[nm];
        if (o.op === 'CS') {
          gs.sn = cnt || 0;
          gs.stroke = cnt ? '#000000' : null;
        } else {
          gs.fn = cnt || 0;
          gs.fill = cnt ? '#000000' : null;
        }
        return;
      }
      case 'SC':
      case 'SCN':
        gs.stroke = gs.sn && a.length === gs.sn ? colour(a) : null;
        return;
      case 'sc':
      case 'scn':
        gs.fill = gs.fn && a.length === gs.fn ? colour(a) : null;
        return;
      case 'BT':
        inText = true;
        return;
      case 'ET':
        inText = false;
        return;
    }
    if (inText) return;
    const P = (x: number, y: number) => apply(gs.ctm, x, y);
    switch (o.op) {
      case 'm':
        if (first < 0) first = k;
        cur = P(num(a[0]), num(a[1]));
        cmds += 'M';
        pts.push(cur);
        return;
      case 'l':
        if (first < 0) first = k;
        cur = P(num(a[0]), num(a[1]));
        cmds += 'L';
        pts.push(cur);
        return;
      case 'c':
        if (first < 0) first = k;
        cmds += 'C';
        pts.push(P(num(a[0]), num(a[1])), P(num(a[2]), num(a[3])), (cur = P(num(a[4]), num(a[5]))));
        return;
      case 'v': {
        if (first < 0) first = k;
        const c0 = cur || P(num(a[0]), num(a[1]));
        cmds += 'C';
        pts.push(c0, P(num(a[0]), num(a[1])), (cur = P(num(a[2]), num(a[3]))));
        return;
      }
      case 'y': {
        if (first < 0) first = k;
        const e = P(num(a[2]), num(a[3]));
        cmds += 'C';
        pts.push(P(num(a[0]), num(a[1])), e, e);
        cur = e;
        return;
      }
      case 'h':
        if (first < 0) first = k;
        cmds += 'Z';
        return;
      case 're': {
        if (first < 0) first = k;
        const [x, y, w, h] = a.map(num) as [number, number, number, number];
        cmds += 'MLLLZ';
        pts.push(P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h));
        cur = P(x, y);
        return;
      }
      case 'W':
      case 'W*':
        clip = true;
        return;
      case 'n':
        reset();
        return;
      case 'S':
      case 's':
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*': {
        const close = o.op === 's' || o.op === 'b' || o.op === 'b*';
        const strokes = /^[SsBb]/.test(o.op);
        const fills = o.op !== 'S' && o.op !== 's';
        if (close) cmds += 'Z';
        const stroke = strokes ? gs.stroke : null;
        const fill = fills ? gs.fill : null;
        /* a pattern or an unknown colour, a clip, or nothing drawn: not offered */
        const usable =
          first >= 0 && !clip && pts.length > 0 && (!strokes || !!gs.stroke) && (!fills || !!gs.fill);
        if (usable) {
          let x1 = Infinity,
            y1 = Infinity,
            x2 = -Infinity,
            y2 = -Infinity;
          pts.forEach((p) => {
            x1 = Math.min(x1, p[0]);
            y1 = Math.min(y1, p[1]);
            x2 = Math.max(x2, p[0]);
            y2 = Math.max(y2, p[1]);
          });
          const sc = Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) || 1;
          out.push({
            id: k,
            first,
            last: k,
            cmds,
            pts,
            stroke,
            fill,
            evenOdd: o.op.endsWith('*'),
            w: (gs.w || 0) * sc,
            dash: gs.dash ? gs.dash.map((v) => v * sc) : null,
            cap: gs.cap,
            join: gs.join,
            so: gs.so,
            fo: gs.fo,
            box: [x1, y1, x2, y2],
          });
        }
        reset();
        return;
      }
    }
  });
  return out;
}

/** The content with the given shapes cut out: each one's operators, from its
    first point to its painting operator, become blank space. */
export function cutContent(b: Uint8Array, ops: ContentOp[], shapes: ContentShape[]): Uint8Array {
  const out = b.slice();
  for (const s of shapes) {
    const from = ops[s.first]!.start,
      to = ops[s.last]!.end;
    out.fill(32, from, to);
  }
  return out;
}

/* ---------------- on a pdf-lib page ---------------- */

/** A page's content as one stream of bytes (its streams joined). */
export function pageContent(page: PDFPage): Uint8Array {
  const ctx = page.doc.context;
  const c = page.node.get(PDFName.of('Contents'));
  const list = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
  const parts: Uint8Array[] = [];
  for (const r of list) {
    const s = ctx.lookup(r);
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    /* a stream made in memory and not yet saved: its bytes before compression */
    else if (s && 'getUnencodedContents' in (s as object))
      parts.push((s as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents());
  }
  const len = parts.reduce((t, p) => t + p.length + 1, 0);
  const all = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
    all[at++] = 10;
  }
  return all;
}

function pageGStates(page: PDFPage): Record<string, { CA?: number; ca?: number }> {
  const out: Record<string, { CA?: number; ca?: number }> = {};
  try {
    const res = page.node.Resources();
    const ext = res && res.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
    if (!ext) return out;
    for (const [k, v] of ext.entries()) {
      const d = page.doc.context.lookup(v);
      if (!(d instanceof PDFDict)) continue;
      const CA = d.lookupMaybe(PDFName.of('CA'), PDFNumber);
      const ca = d.lookupMaybe(PDFName.of('ca'), PDFNumber);
      out[k.decodeText()] = {
        ...(CA ? { CA: CA.asNumber() } : {}),
        ...(ca ? { ca: ca.asNumber() } : {}),
      };
    }
  } catch {
    /* no opacities: every shape reads as opaque */
  }
  return out;
}

/** The shapes page `index` of `doc` paints, for Edit Object. */
export function pageShapes(doc: PDFDocument, index: number): ContentShape[] {
  const page = doc.getPage(index);
  return contentShapes(parseContent(pageContent(page)), pageGStates(page));
}

/** Page `index` of `doc` on its own, as a new PDF, with the shapes `ids`
    names (from pageShapes) cut out of it. */
export async function cutShapes(doc: PDFDocument, index: number, ids: number[]): Promise<Uint8Array> {
  const bytes = pageContent(doc.getPage(index));
  const ops = parseContent(bytes);
  const want = new Set(ids);
  const shapes = contentShapes(ops, pageGStates(doc.getPage(index))).filter((s) => want.has(s.id));
  const out = await PDFDocument.create();
  const [p] = await out.copyPages(doc, [index]);
  out.addPage(p!);
  const stream = out.context.flateStream(cutContent(bytes, ops, shapes));
  p!.node.set(PDFName.of('Contents'), out.context.register(stream));
  return out.save();
}
