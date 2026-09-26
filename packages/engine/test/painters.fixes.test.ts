import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  arrowHead,
  buildPdf,
  createTextMeasurer,
  drawPainters,
  insertPainters,
  leaderPainters,
  prepareInsert,
  type AnyMark,
  type MeasureText,
  type PageItem,
  type SaveHooks,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest } from './fixtures/marks.fixture.js';

/* Four save bugs in v1, found while recording the module goldens. Each test
   here fails on v1's painters and passes on the fixed ones. */

type P = [number, number];
type M = [number, number, number, number, number, number];
interface Shape {
  op: string; // f (fill), S (stroke), B (both)
  pts: P[];
  dash: string;
}

/** A small content-stream reader: follows q/Q/cm and returns every painted
    path with its points in page space. Enough for what pdf-lib writes. */
function shapesIn(stream: string): Shape[] {
  const mul = (a: M, b: M): M => [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
  const at = (m: M, x: number, y: number): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let dash = '[] 0';
  let path: P[] = [];
  const out: Shape[] = [];
  const nums: number[] = [];
  const tokens =
    stream.match(/\[[^\]]*\]\s*[-\d.]+\s+d|<[0-9A-Fa-f]*>|\([^)]*\)|\/[^\s/[\]<>()]+|[-\d.]+|[A-Za-z*']+/g) ||
    [];
  for (const t of tokens) {
    if (/^\[.*d$/.test(t)) {
      dash = t.replace(/\s+d$/, '');
      continue;
    }
    if (/^[-\d.]+$/.test(t)) {
      nums.push(+t);
      continue;
    }
    const n = nums.splice(0);
    switch (t) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        break;
      case 'cm':
        ctm = mul(n as M, ctm);
        break;
      case 'm':
      case 'l':
        path.push(at(ctm, n[0]!, n[1]!));
        break;
      case 'c':
        path.push(at(ctm, n[4]!, n[5]!));
        break;
      case 'f':
      case 'S':
      case 'B':
        out.push({ op: t, pts: path, dash });
        path = [];
        break;
      case 'n':
        path = [];
        break;
    }
  }
  return out;
}

const close = (a: P, b: P) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

async function savePage(shapes: AnyMark[], hooks: Partial<SaveHooks> = {}): Promise<string> {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const items: PageItem[] = [{ src: { id: 1, bytes: await d.save() }, num: 1, rot: 0, shapes }];
  const pages = await digest(PDFLib, await buildPdf(items, null, {}, { measure, ...hooks }));
  return (pages[0].streams as string[]).join('');
}

const drawHooks = { shapePainters: { ...drawPainters(() => ({ unit: 'mm', denom: 1, custom: null })) } };

describe('leader arrowhead', () => {
  /* v1 drew it with drawSvgPath, which works in SVG space (y flipped about the
     origin), so the triangle landed below the page and never showed. */
  it('lands on the tip of the leader', async () => {
    const s = { t: 'leader', a: [480, 300], m: [520, 360], b: [570, 360], c: '#E2483D', w: 1.2 };
    const shapes = shapesIn(await savePage([s as unknown as AnyMark], { shapePainters: leaderPainters }));
    const wing = arrowHead(520, 360, 480, 300, 1.2);
    const tri = shapes.find((sh) => sh.op === 'f');
    expect(tri, 'a filled arrowhead').toBeTruthy();
    expect(tri!.pts.some((q) => close(q, [480, 300]))).toBe(true);
    expect(tri!.pts.some((q) => close(q, wing[0]))).toBe(true);
    expect(tri!.pts.some((q) => close(q, wing[1]))).toBe(true);
  });
});

describe('circles', () => {
  /* v1 looked for s.dash, which nothing sets (the style is s.d), so a dashed
     circle that was not rotated saved as a solid line. */
  it('keeps the dash of a dashed circle', async () => {
    const s = { t: 'ellipse', a: [220, 420], b: [320, 520], c: '#22A06B', w: 1, d: 1 };
    const shapes = shapesIn(await savePage([s as unknown as AnyMark], drawHooks));
    const stroked = shapes.filter((sh) => sh.op === 'S' || sh.op === 'B');
    expect(stroked.length).toBeGreaterThan(0);
    expect(stroked.every((sh) => sh.dash.startsWith('[4 3] '))).toBe(true);
  });

  /* A curve is saved as short straight segments. v1 restarted the dash at 0 on
     each one, and a segment shorter than the dash is inked solid, so a dashed
     arc or circle printed as a solid line. The pattern has to carry on. */
  it.each([
    ['circle', { t: 'ellipse', a: [220, 420], b: [320, 520], c: '#22A06B', w: 2, d: 1 }],
    ['arc', { t: 'arc', a: [280, 220], b: [460, 220], c: '#000000', w: 2, bulge: -0.4, d: 1 }],
  ])('carries the dash on round a dashed %s', async (_, s) => {
    const strokes = shapesIn(await savePage([s as unknown as AnyMark], drawHooks)).filter(
      (sh) => sh.op === 'S',
    );
    const period = 8 + 6; // [4 3] times a 2pt line
    let run = 0;
    for (const sh of strokes) {
      const phase = +sh.dash.split(' ').pop()!;
      expect(phase).toBeCloseTo(run % period, 2);
      run += Math.hypot(sh.pts.at(-1)![0] - sh.pts[0]![0], sh.pts.at(-1)![1] - sh.pts[0]![1]);
    }
    expect(strokes.length).toBeGreaterThan(20);
  });

  /* v1 drew a rotated (or dashed) circle point by point, outline only, so its
     fill was lost. */
  it.each([
    ['rotated', { r: 20 }],
    ['dashed', { d: 1 }],
  ])('keeps the fill of a %s circle', async (_, extra) => {
    const s = { t: 'ellipse', a: [340, 420], b: [480, 500], c: '#8B5CF6', w: 1, fill: '#EAF2FF', ...extra };
    const shapes = shapesIn(await savePage([s as unknown as AnyMark], drawHooks));
    expect(shapes.some((sh) => (sh.op === 'f' || sh.op === 'B') && sh.pts.length > 20)).toBe(true);
  });

  it('still uses the exact native ellipse for a plain circle', async () => {
    const s = { t: 'ellipse', a: [60, 420], b: [200, 520], c: '#22A06B', w: 1.5 };
    const stream = await savePage([s as unknown as AnyMark], drawHooks);
    expect(stream).toMatch(/ c\n/); // Bézier curves, not 96 straight segments
  });
});

describe('table cells', () => {
  const table = (cells: string[][]) =>
    ({
      t: 'table',
      rows: 1,
      cols: 2,
      a: [100, 100],
      b: [300, 130],
      c: '#8A8F98',
      w: 1,
      cells,
    }) as unknown as AnyMark;
  const hooks = { shapePainters: insertPainters, prepare: [prepareInsert] };
  const hexTexts = (stream: string) =>
    [...stream.matchAll(/<([0-9A-F]+)> Tj/g)].map((m) =>
      m[1]!
        .match(/../g)!
        .map((h) => String.fromCharCode(parseInt(h, 16)))
        .join(''),
    );

  /* v1 cut at 24 characters (X.fitText was never defined), so long text ran
     past the cell and short cells were fine only by luck. */
  it('fits long text to the cell, with an ellipsis', async () => {
    const long = 'Door D1 including a very long description here';
    const stream = await savePage([table([[long, 'x']])], hooks);
    const drawn = hexTexts(stream)[0]!;
    expect(drawn.endsWith('…') || drawn.endsWith('\x85')).toBe(true);
    const font = await (await PDFLib.PDFDocument.create()).embedFont(PDFLib.StandardFonts.Helvetica);
    const size = Math.max(6.5, Math.min(10.5, 30 * 0.34));
    const text = drawn.replace('\x85', '…');
    expect(font.widthOfTextAtSize(text, size)).toBeLessThanOrEqual(100 - 6);
  });

  /* v1 passed the text straight to the standard font, so one character it
     cannot encode (an emoji, an arrow) made the whole save fail. */
  it('saves text the standard font cannot encode', async () => {
    await expect(savePage([table([['Door → ✓ 🚪', 'ok']])], hooks)).resolves.toBeTruthy();
  });
});
