/* A page's own text, read and edited: Edit Object's Text.

   Text in a content stream is drawn by show operators (Tj, TJ, ', ") inside
   BT … ET, each a string of character codes in a font the page names, at a
   place the text state works out: the text matrix, the font size, character
   and word spacing, horizontal scaling and rise. To offer a line of it to
   edit, each show operator is followed as a PDF reader would: its codes
   become text through the font's ToUnicode map (or its encoding), and its
   width comes from the font's widths, so where it starts and ends on the
   page is known. Runs on one baseline, one after the other, make a line.

   A line picked to edit is cut out of the stream: each of its show
   operators becomes an empty TJ that moves the text position by the same
   width (so text drawn after it on the same line stays put), and the line
   comes back as a text mark to type in, move or restyle.

   Not offered: Type 3 fonts, CID fonts other than Identity-H, invisible
   text (OCR layers), and text whose codes cannot be read as characters. */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { Pt } from './model';
import { pageContent, parseContent, type ContentOp, type Operand } from './content';

/* ---------------- fonts ---------------- */

interface FontInfo {
  base: string;
  twoByte: boolean;
  /** width of a code, in thousandths of the font size */
  width(code: number): number;
  /** the characters a code stands for, or null */
  text(code: number): string | null;
  ok: boolean;
}

const WIN = new TextDecoder('windows-1252');

/* glyph names a Differences array uses, beyond the letters themselves */
const GLYPHS: Record<string, string> = {
  space: ' ',
  exclam: '!',
  quotedbl: '"',
  numbersign: '#',
  dollar: '$',
  percent: '%',
  ampersand: '&',
  quotesingle: "'",
  quoteright: '’',
  quoteleft: '‘',
  parenleft: '(',
  parenright: ')',
  asterisk: '*',
  plus: '+',
  comma: ',',
  hyphen: '-',
  minus: '−',
  period: '.',
  slash: '/',
  colon: ':',
  semicolon: ';',
  less: '<',
  equal: '=',
  greater: '>',
  question: '?',
  at: '@',
  bracketleft: '[',
  backslash: '\\',
  bracketright: ']',
  asciicircum: '^',
  underscore: '_',
  grave: '`',
  braceleft: '{',
  bar: '|',
  braceright: '}',
  asciitilde: '~',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  bullet: '•',
  endash: '–',
  emdash: '—',
  quotedblleft: '“',
  quotedblright: '”',
  ellipsis: '…',
  fi: 'fi',
  fl: 'fl',
  ff: 'ff',
  ffi: 'ffi',
  ffl: 'ffl',
  copyright: '©',
  registered: '®',
  trademark: '™',
  degree: '°',
  Euro: '€',
  section: '§',
  paragraph: '¶',
  periodcentered: '·',
  nbspace: ' ',
};
function glyphText(name: string): string | null {
  if (name.length === 1) return name;
  if (GLYPHS[name]) return GLYPHS[name]!;
  const u = /^uni([0-9A-Fa-f]{4,})$/.exec(name) || /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1]!.slice(0, 6), 16));
  return null;
}

/** A ToUnicode CMap: code -> characters. */
export function parseToUnicode(src: string): Map<number, string> {
  const map = new Map<number, string>();
  const uni = (hex: string) => {
    let s = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    if (hex.length === 2) s = String.fromCharCode(parseInt(hex, 16));
    return s;
  };
  for (const blk of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g))
      map.set(parseInt(m[1]!, 16), uni(m[2]!));
  }
  for (const blk of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1]!, 16),
        hi = parseInt(m[2]!, 16);
      if (hi - lo > 65535) continue;
      if (m[3]!.startsWith('[')) {
        const list = [...m[3]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => x[1]!);
        list.forEach((h, k) => map.set(lo + k, uni(h)));
      } else {
        const d = m[3]!.slice(1, -1);
        const head = d.slice(0, -4),
          last = parseInt(d.slice(-4) || '0', 16);
        for (let c = lo; c <= hi; c++) map.set(c, uni(head) + String.fromCharCode(last + c - lo));
      }
    }
  }
  return map;
}

const STD: Record<string, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  'helvetica-oblique': StandardFonts.HelveticaOblique,
  'helvetica-boldoblique': StandardFonts.HelveticaBoldOblique,
  arial: StandardFonts.Helvetica,
  'arial,bold': StandardFonts.HelveticaBold,
  'times-roman': StandardFonts.TimesRoman,
  'times-bold': StandardFonts.TimesRomanBold,
  'times-italic': StandardFonts.TimesRomanItalic,
  'times-bolditalic': StandardFonts.TimesRomanBoldItalic,
  timesnewroman: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
  'courier-bold': StandardFonts.CourierBold,
  'courier-oblique': StandardFonts.CourierOblique,
  'courier-boldoblique': StandardFonts.CourierBoldOblique,
  couriernew: StandardFonts.Courier,
};

async function fontInfo(
  page: PDFPage,
  ref: unknown,
  std: (f: StandardFonts) => Promise<PDFFont>,
): Promise<FontInfo> {
  const ctx = page.doc.context;
  const bad: FontInfo = { base: '', twoByte: false, width: () => 0, text: () => null, ok: false };
  const f = ctx.lookup(ref as never);
  if (!(f instanceof PDFDict)) return bad;
  const nm = (d: PDFDict, k: string) => {
    const v = d.lookupMaybe(PDFName.of(k), PDFName);
    return v ? v.decodeText() : '';
  };
  const num = (v: unknown) => {
    const x = ctx.lookup(v as never);
    return x instanceof PDFNumber ? x.asNumber() : 0;
  };
  const sub = nm(f, 'Subtype');
  const base = nm(f, 'BaseFont').replace(/^[A-Z]{6}\+/, '');
  let toUni: Map<number, string> | null = null;
  const tu = f.lookup(PDFName.of('ToUnicode'));
  if (tu instanceof PDFRawStream) {
    try {
      toUni = parseToUnicode(new TextDecoder('latin1').decode(decodePDFRawStream(tu).decode()));
    } catch {
      toUni = null;
    }
  }
  if (sub === 'Type3') return { ...bad, base };

  if (sub === 'Type0') {
    if (nm(f, 'Encoding') !== 'Identity-H' || !toUni) return { ...bad, base };
    const kids = f.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
    const cid = kids && ctx.lookup(kids.get(0));
    if (!(cid instanceof PDFDict)) return { ...bad, base };
    const dwv = cid.lookup(PDFName.of('DW'));
    const dw = dwv ? num(dwv) : 1000;
    const widths = new Map<number, number>();
    const W = cid.lookupMaybe(PDFName.of('W'), PDFArray);
    if (W) {
      const a = W.asArray().map((x) => ctx.lookup(x));
      for (let i = 0; i < a.length;) {
        const c = a[i] instanceof PDFNumber ? (a[i] as PDFNumber).asNumber() : 0;
        const nx = a[i + 1];
        if (nx instanceof PDFArray) {
          nx.asArray().forEach((w, k) => widths.set(c + k, num(w)));
          i += 2;
        } else {
          const c2 = nx instanceof PDFNumber ? nx.asNumber() : c;
          const w = num(a[i + 2]);
          for (let k = c; k <= c2 && k - c < 65536; k++) widths.set(k, w);
          i += 3;
        }
      }
    }
    const map = toUni;
    return {
      base,
      twoByte: true,
      width: (c) => widths.get(c) ?? dw,
      text: (c) => map.get(c) ?? null,
      ok: true,
    };
  }

  /* a simple font: one byte a code */
  const widths = new Map<number, number>();
  const first = f.lookup(PDFName.of('FirstChar'));
  const W = f.lookupMaybe(PDFName.of('Widths'), PDFArray);
  if (W && first) {
    const fc = num(first);
    W.asArray().forEach((w, k) => widths.set(fc + k, num(w)));
  }
  let missing = 0;
  const fd = f.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  if (fd && fd.lookup(PDFName.of('MissingWidth'))) missing = num(fd.lookup(PDFName.of('MissingWidth')));
  const diffs = new Map<number, string>();
  const enc = f.lookup(PDFName.of('Encoding'));
  if (enc instanceof PDFDict) {
    const d = enc.lookupMaybe(PDFName.of('Differences'), PDFArray);
    let c = 0;
    for (const x of d ? d.asArray().map((v) => ctx.lookup(v)) : []) {
      if (x instanceof PDFNumber) c = x.asNumber();
      else if (x instanceof PDFName) diffs.set(c++, x.decodeText());
    }
  }
  const text = (c: number): string | null => {
    if (toUni && toUni.has(c)) return toUni.get(c)!;
    if (diffs.has(c)) return glyphText(diffs.get(c)!);
    if (c < 32) return null;
    return WIN.decode(Uint8Array.of(c));
  };
  /* a standard font named without its widths: the standard metrics */
  let stdFont: PDFFont | null = null;
  if (!W) {
    const k = STD[base.toLowerCase().replace(/\s|mt$|ps$/g, '')];
    if (k) stdFont = await std(k);
  }
  const width = (c: number) => {
    if (widths.has(c)) return widths.get(c)!;
    if (stdFont) {
      const t = text(c);
      try {
        return t ? stdFont.widthOfTextAtSize(t, 1000) : missing;
      } catch {
        return missing;
      }
    }
    return missing || 500;
  };
  return { base, twoByte: false, width, text, ok: true };
}

/* ---------------- following the text ---------------- */

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const at = (m: Mat, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** One show operator: where its text starts and how far it goes. */
interface Run {
  op: number;
  text: string;
  ok: boolean;
  /** text space to user space at the run's start (Tfs, Th, rise, Tm, CTM) */
  m: Mat;
  /** its width in text space, before the font size */
  adv: number;
  /** what the empty TJ that keeps its place says */
  tfsTh: number;
  font: string;
  size: number;
  color: string;
}

/** A line of the page's text, to edit. */
export interface ContentTextLine {
  /** the first show operator of it: names it in this page's content */
  id: number;
  ops: number[];
  text: string;
  /** baseline start, in page space, and the angle it runs at (degrees, anticlockwise) */
  origin: Pt;
  angle: number;
  /** font size on the page, and the length of the line along its baseline */
  size: number;
  width: number;
  /** its box: four corners, in page space */
  quad: [Pt, Pt, Pt, Pt];
  color: string;
  /** the font's own name, without a subset tag */
  font: string;
  bold: boolean;
  italic: boolean;
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, '0');
function colour(args: Operand[]): string {
  const v = args.filter((a): a is number => typeof a === 'number');
  if (v.length === 1) return '#' + hex2(v[0]!) + hex2(v[0]!) + hex2(v[0]!);
  if (v.length === 3) return '#' + hex2(v[0]!) + hex2(v[1]!) + hex2(v[2]!);
  if (v.length === 4) {
    const [c, m, y, k] = v as [number, number, number, number];
    return '#' + hex2((1 - c) * (1 - k)) + hex2((1 - m) * (1 - k)) + hex2((1 - y) * (1 - k));
  }
  return '#000000';
}

async function textRuns(page: PDFPage, ops: ContentOp[]): Promise<Run[]> {
  const fontsDict = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const fonts = new Map<string, FontInfo>();
  const stdDoc = await PDFDocument.create();
  const stdCache = new Map<StandardFonts, Promise<PDFFont>>();
  const std = (k: StandardFonts) => {
    if (!stdCache.has(k)) stdCache.set(k, stdDoc.embedFont(k));
    return stdCache.get(k)!;
  };
  async function font(name: string): Promise<FontInfo | null> {
    if (!fonts.has(name)) {
      const ref = fontsDict && fontsDict.get(PDFName.of(name));
      fonts.set(
        name,
        ref
          ? await fontInfo(page, ref, std)
          : { base: '', twoByte: false, width: () => 0, text: () => null, ok: false },
      );
    }
    return fonts.get(name)!;
  }

  type St = {
    ctm: Mat;
    fill: string;
    Tc: number;
    Tw: number;
    Th: number;
    TL: number;
    Tf: string;
    Tfs: number;
    Ts: number;
    Tr: number;
  };
  let st: St = {
    ctm: [1, 0, 0, 1, 0, 0],
    fill: '#000000',
    Tc: 0,
    Tw: 0,
    Th: 1,
    TL: 0,
    Tf: '',
    Tfs: 0,
    Ts: 0,
    Tr: 0,
  };
  const stack: St[] = [];
  let Tm: Mat = [1, 0, 0, 1, 0, 0],
    Tlm: Mat = [1, 0, 0, 1, 0, 0];
  const runs: Run[] = [];
  const num = (a: Operand | undefined) => (typeof a === 'number' ? a : 0);
  const nextLine = (tx: number, ty: number) => {
    Tlm = mul([1, 0, 0, 1, tx, ty], Tlm);
    Tm = Tlm;
  };

  async function show(k: number, parts: Operand[]) {
    const f = await font(st.Tf);
    const m = mul([st.Tfs * st.Th, 0, 0, st.Tfs, 0, st.Ts], mul(Tm, st.ctm));
    let adv = 0,
      text = '',
      ok = !!f && f.ok && st.Tr !== 3 && st.Tr !== 7;
    for (const p of parts) {
      if (typeof p === 'number') {
        const d = (-p / 1000) * st.Tfs * st.Th;
        adv += d;
        /* a wide gap inside one operator (table columns, spaced words) reads as a space */
        if (d > Math.abs(st.Tfs) * 0.2 && text && !/\s$/.test(text)) text += ' ';
        continue;
      }
      if (!p || typeof p !== 'object' || !('str' in p) || !f) continue;
      const b = p.str;
      for (let i = 0; i < b.length;) {
        const code = f.twoByte ? (b[i]! << 8) | (b[i + 1] ?? 0) : b[i]!;
        const space = !f.twoByte && code === 32;
        i += f.twoByte ? 2 : 1;
        adv += ((f.width(code) / 1000) * st.Tfs + st.Tc + (space ? st.Tw : 0)) * st.Th;
        const t = f.text(code);
        if (t === null) ok = false;
        else text += t;
      }
    }
    Tm = mul([1, 0, 0, 1, adv, 0], Tm);
    const scale = Math.hypot(m[2], m[3]);
    runs.push({
      op: k,
      text,
      ok,
      m,
      adv: st.Tfs * st.Th ? adv / (st.Tfs * st.Th) : 0,
      tfsTh: st.Tfs * st.Th,
      font: f ? f.base : '',
      size: scale,
      color: st.fill,
    });
  }

  for (let k = 0; k < ops.length; k++) {
    const o = ops[k]!,
      a = o.args;
    switch (o.op) {
      case 'q':
        stack.push({ ...st });
        break;
      case 'Q':
        st = stack.pop() || st;
        break;
      case 'cm':
        if (a.length === 6) st.ctm = mul(a.map(num) as Mat, st.ctm);
        break;
      case 'g':
      case 'rg':
      case 'k':
      case 'sc':
      case 'scn':
        st.fill = colour(a);
        break;
      case 'BT':
        Tm = [1, 0, 0, 1, 0, 0];
        Tlm = [1, 0, 0, 1, 0, 0];
        break;
      case 'Tc':
        st.Tc = num(a[0]);
        break;
      case 'Tw':
        st.Tw = num(a[0]);
        break;
      case 'Tz':
        st.Th = num(a[0]) / 100;
        break;
      case 'TL':
        st.TL = num(a[0]);
        break;
      case 'Ts':
        st.Ts = num(a[0]);
        break;
      case 'Tr':
        st.Tr = num(a[0]);
        break;
      case 'Tf':
        st.Tf = a[0] && typeof a[0] === 'object' && 'name' in a[0] ? a[0].name : '';
        st.Tfs = num(a[1]);
        break;
      case 'Td':
        nextLine(num(a[0]), num(a[1]));
        break;
      case 'TD':
        st.TL = -num(a[1]);
        nextLine(num(a[0]), num(a[1]));
        break;
      case 'Tm':
        Tlm = a.map(num) as Mat;
        Tm = Tlm;
        break;
      case 'T*':
        nextLine(0, -st.TL);
        break;
      case 'Tj':
        await show(k, [a[0]!]);
        break;
      case 'TJ':
        await show(k, Array.isArray(a[0]) ? a[0] : []);
        break;
      case "'":
        nextLine(0, -st.TL);
        await show(k, [a[0]!]);
        break;
      case '"':
        st.Tw = num(a[0]);
        st.Tc = num(a[1]);
        nextLine(0, -st.TL);
        await show(k, [a[2]!]);
        break;
    }
  }
  return runs;
}

/** Runs one after another on one baseline, as lines. */
function lines(runs: Run[]): ContentTextLine[] {
  const out: ContentTextLine[] = [];
  let cur: { runs: Run[]; text: string; end: Pt } | null = null;
  const flush = () => {
    if (!cur) return;
    const r0 = cur.runs[0]!;
    const o = at(r0.m, 0, 0);
    const angle = (Math.atan2(r0.m[1], r0.m[0]) * 180) / Math.PI;
    const ux = Math.cos((angle * Math.PI) / 180),
      uy = Math.sin((angle * Math.PI) / 180);
    const width = (cur.end[0] - o[0]) * ux + (cur.end[1] - o[1]) * uy;
    const size = r0.size;
    const P = (x: number, y: number): Pt => [o[0] + x * ux - y * uy, o[1] + x * uy + y * ux];
    const lo = -0.25 * size,
      hi = 0.85 * size;
    const ok = cur.runs.every((r) => r.ok) && cur.text.trim() !== '';
    const f = r0.font;
    if (ok) {
      out.push({
        id: r0.op,
        ops: cur.runs.map((r) => r.op),
        text: cur.text.replace(/\s+$/, ''),
        origin: o,
        angle: Math.abs(angle) < 0.01 ? 0 : angle,
        size,
        width,
        quad: [P(0, lo), P(width, lo), P(width, hi), P(0, hi)],
        color: r0.color,
        font: f,
        bold: /bold|black|heavy|semibold|demi/i.test(f),
        italic: /italic|oblique/i.test(f),
      });
    }
    cur = null;
  };
  for (const r of runs) {
    if (!r.text && !r.adv) continue;
    const start = at(r.m, 0, 0);
    const end = at(r.m, r.adv, 0);
    if (cur) {
      const p = cur.runs[0]!;
      const ang = Math.atan2(p.m[1], p.m[0]),
        ang2 = Math.atan2(r.m[1], r.m[0]);
      const ux = Math.cos(ang),
        uy = Math.sin(ang);
      const dx = start[0] - cur.end[0],
        dy = start[1] - cur.end[1];
      const along = dx * ux + dy * uy,
        across = -dx * uy + dy * ux;
      const same =
        Math.abs(ang - ang2) < 0.02 &&
        Math.abs(r.size - p.size) < p.size * 0.3 &&
        Math.abs(across) < p.size * 0.3 &&
        along > -p.size * 0.5 &&
        along < p.size * 1.5;
      if (same) {
        const gap = along > p.size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(r.text);
        cur.text += (gap ? ' ' : '') + r.text;
        cur.runs.push(r);
        cur.end = end;
        continue;
      }
      flush();
    }
    cur = { runs: [r], text: r.text, end };
  }
  flush();
  return out;
}

/** The lines of text page `index` of `doc` draws, for Edit Object. */
export async function pageTextLines(doc: PDFDocument, index: number): Promise<ContentTextLine[]> {
  const page = doc.getPage(index);
  return lines(await textRuns(page, parseContent(pageContent(page))));
}

const fmt = (v: number) => (Math.abs(v) < 1e-6 ? '0' : String(+v.toFixed(4)));

/** Page `index` of `doc` on its own, as a new PDF, with the line `id` names
    (from pageTextLines) cut out: each of its show operators an empty TJ of
    the same width, so what follows on the line stays where it was. */
export async function cutText(doc: PDFDocument, index: number, id: number): Promise<Uint8Array> {
  const page = doc.getPage(index);
  const bytes = pageContent(page);
  const ops = parseContent(bytes);
  const runs = await textRuns(page, ops);
  const line = lines(runs).find((l) => l.id === id);
  if (!line) throw new Error('no such line of text on the page');
  const byOp = new Map(runs.map((r) => [r.op, r]));
  const edits = line.ops
    .map((k) => {
      const o = ops[k]!,
        r = byOp.get(k)!;
      const move = r.tfsTh ? '[' + fmt(-r.adv * 1000) + '] TJ' : '';
      let put = move;
      if (o.op === "'") put = 'T* ' + move;
      if (o.op === '"') put = fmt(o.args[0] as number) + ' Tw ' + fmt(o.args[1] as number) + ' Tc T* ' + move;
      return { from: o.start, to: o.end, put: new TextEncoder().encode(put) };
    })
    .sort((a, b) => a.from - b.from);
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const e of edits) {
    parts.push(bytes.subarray(pos, e.from), e.put);
    pos = e.to;
  }
  parts.push(bytes.subarray(pos));
  const len = parts.reduce((t, p) => t + p.length, 0);
  const content = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    content.set(p, o);
    o += p.length;
  }
  const out = await PDFDocument.create();
  const [p] = await out.copyPages(doc, [index]);
  out.addPage(p!);
  p!.node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(content)));
  return out.save();
}
