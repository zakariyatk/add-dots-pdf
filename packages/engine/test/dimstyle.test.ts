import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildPdf,
  createTextMeasurer,
  dimFontKey,
  dimTextPt,
  drawFontNeeds,
  drawPainters,
  type AnyMark,
  type MeasureText,
  type PageItem,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest } from './fixtures/marks.fixture.js';

/* A dimension's look (DimMark's dz, ew, tz, df, db, di, tc): each field
   reaches the saved PDF, and a dimension without them saves as it always
   has (the goldens in painters.golden.test.ts hold that exactly). */

let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

const hooks = {
  shapePainters: drawPainters(() => ({ unit: 'mm', denom: 1, custom: null })),
  fontNeeds: drawFontNeeds,
};

async function save(shapes: object[]): Promise<{ stream: string; bytes: Uint8Array }> {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const items: PageItem[] = [
    { src: { id: 1, bytes: await d.save() }, num: 1, rot: 0, shapes: shapes as AnyMark[] },
  ];
  const bytes = await buildPdf(items, null, {}, { measure, ...hooks });
  const pages = await digest(PDFLib, bytes);
  return { stream: (pages[0].streams as string[]).join(''), bytes };
}

/** Every straight stroke the stream draws, as its two ends. */
function segments(stream: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const re = /([-\d.]+) ([-\d.]+) m\s+([-\d.]+) ([-\d.]+) l\s+S/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) out.push([+m[1]!, +m[2]!, +m[3]!, +m[4]!]);
  return out;
}
/** The longest stroke that ends on (x, y): an arrowhead's barb there. */
function barbAt(stream: string, x: number, y: number): number {
  return Math.max(
    0,
    ...segments(stream)
      .filter((s) => Math.abs(s[2] - x) < 0.01 && Math.abs(s[3] - y) < 0.01)
      .map((s) => Math.hypot(s[2] - s[0], s[3] - s[1])),
  );
}

const base = { t: 'dim', a: [100, 400], b: [300, 400], c: '#E2483D', w: 0.5 };

describe('dimension style', () => {
  it('unset reads exactly as before', () => {
    expect(dimTextPt({ w: 0.5 })).toBe(10);
    expect(dimFontKey({})).toBe('g:inter|1');
  });

  it('grows the arrowheads by dz', async () => {
    const plain = await save([base]);
    const big = await save([{ ...base, dz: 2 }]);
    const a = barbAt(plain.stream, 100, 400),
      b = barbAt(big.stream, 100, 400);
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeCloseTo(2, 5);
  });

  it('thickens the extension lines by ew, and leaves the dimension line alone', async () => {
    const { stream } = await save([{ ...base, off: 20, ew: 2.5 }]);
    expect(stream).toMatch(/\b2\.5 w\b/);
    expect(stream).toMatch(/\b0\.5 w\b/);
  });

  it('sets the reading size, colour and font', async () => {
    const { stream, bytes } = await save([
      { ...base, tz: 18, tc: '#0070C0', df: 'times', di: true, db: false },
    ]);
    expect(stream).toMatch(/\b18 Tf\b/);
    expect(stream).toMatch(/0 0\.4392\d* 0\.7529\d* rg/);
    const doc = await PDFLib.PDFDocument.load(bytes);
    const names: string[] = [];
    doc.context.enumerateIndirectObjects().forEach(([, o]) => {
      if (o instanceof PDFLib.PDFDict) {
        const bf = o.get(PDFLib.PDFName.of('BaseFont'));
        if (bf) names.push(String(bf));
      }
    });
    expect(names).toContain('/Times-Italic');
  });

  it.each([
    ['radius', { t: 'dimr', a: [300, 300], rad: 40, b: [380, 340] }],
    ['diameter', { t: 'dimd', a: [300, 300], rad: 40, b: [310, 305] }],
    ['angular', { t: 'dima', a: [150, 150], a1: 0, a2: Math.PI / 3, l1: 20, l2: 20, b: [200, 170] }],
  ])('a %s dimension takes the reading style too', async (_n, s) => {
    const { stream } = await save([{ ...s, c: '#E2483D', w: 0.5, tz: 15, tc: '#00A000', df: 'cour' }]);
    expect(stream).toMatch(/\b15 Tf\b/);
    expect(stream).toMatch(/0 0\.6274\d* 0 rg/);
  });

  it('a typed reading a standard font cannot draw falls back to Inter', () => {
    expect(dimFontKey({ df: 'times', di: true, label: 'Door → 2 m' })).toBe('g:inter|3');
    expect(dimFontKey({ df: 'times', di: true, label: 'Door Ø 2 m' })).toBe('TimesRomanBoldItalic');
    expect(dimFontKey({ df: 'g:roboto', db: false })).toBe('g:roboto|0');
  });
});
