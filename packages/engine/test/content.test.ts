import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildPdf,
  contentShapes,
  createTextMeasurer,
  cutShapes,
  pageContent,
  pageShapes,
  parseContent,
  saveHooks,
  vpathFromShape,
  type PageItem,
} from '../src';

/* Edit Object: the shapes a page draws, found in its content; one cut out
   leaves the rest as they were; and the shape, as a mark, saves back. */

const enc = (s: string) => new TextEncoder().encode(s);

async function drawing(): Promise<PDFLib.PDFDocument> {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([400, 400]);
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  p.drawRectangle({
    x: 50,
    y: 60,
    width: 100,
    height: 80,
    color: PDFLib.rgb(1, 0, 0),
    borderColor: PDFLib.rgb(0, 0, 1),
    borderWidth: 3,
  });
  p.drawLine({
    start: { x: 200, y: 200 },
    end: { x: 350, y: 300 },
    thickness: 2,
    color: PDFLib.rgb(0, 0.5, 0),
  });
  p.drawText('Keep me', { x: 60, y: 350, size: 18, font: f });
  p.drawEllipse({ x: 300, y: 80, xScale: 40, yScale: 30, color: PDFLib.rgb(0.2, 0.2, 0.2) });
  return d;
}

describe('reading a content stream', () => {
  it('splits operators with their operands and byte ranges', () => {
    const b = enc('q 1 0 0 1 10 20 cm\n0.5 g 0 0 10 10 re f Q BT /F1 12 Tf (a (b) c) Tj ET');
    const ops = parseContent(b);
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'g', 're', 'f', 'Q', 'BT', 'Tf', 'Tj', 'ET']);
    const re = ops[3]!;
    expect(new TextDecoder().decode(b.subarray(re.start, re.end))).toBe('0 0 10 10 re');
  });

  it('finds a filled box through the transform, in its colour', () => {
    const ops = parseContent(enc('q 2 0 0 2 10 20 cm 1 0 0 rg 0 0 10 10 re f Q'));
    const [s] = contentShapes(ops);
    expect(s!.fill).toBe('#ff0000');
    expect(s!.stroke).toBeNull();
    expect(s!.box).toEqual([10, 20, 30, 40]);
  });

  it('leaves out clipping paths and paths painted with nothing', () => {
    const ops = parseContent(enc('0 0 10 10 re W n 5 5 m 9 9 l S 0 0 1 1 re n'));
    const got = contentShapes(ops);
    expect(got.length).toBe(1);
    expect(got[0]!.cmds).toBe('ML');
  });

  it('skips over inline images', () => {
    const ops = parseContent(enc('BI /W 1 /H 1 /BPC 8 /CS /G ID \x00\xff EI 0 0 m 1 1 l S'));
    expect(ops.map((o) => o.op)).toEqual(['BI', 'm', 'l', 'S']);
  });
});

describe('a page drawn by pdf-lib', () => {
  it('lists its box, line and ellipse, and not its text', async () => {
    const d = await drawing();
    const shapes = pageShapes(d, 0);
    expect(shapes.length).toBe(3);
    const box = shapes.find((s) => s.fill === '#ff0000')!;
    expect(box.stroke).toBe('#0000ff');
    expect(box.w).toBeCloseTo(3);
    const line = shapes.find((s) => s.stroke === '#008000')!;
    expect(line.box[0]).toBeCloseTo(200);
    expect(line.box[3]).toBeCloseTo(300);
  });

  it('cuts one shape out, and the rest stay', async () => {
    const d = await drawing();
    const shapes = pageShapes(d, 0);
    const line = shapes.find((s) => s.stroke === '#008000')!;
    const bytes = await cutShapes(d, 0, [line.id]);
    const after = await PDFLib.PDFDocument.load(bytes);
    expect(after.getPageCount()).toBe(1);
    const left = pageShapes(after, 0);
    expect(left.length).toBe(2);
    expect(left.some((s) => s.stroke === '#008000')).toBe(false);
    expect(new TextDecoder('latin1').decode(pageContent(after.getPage(0)))).toContain('Tj');
  });

  it('saves the cut shape back as a mark, moved', async () => {
    const d = await drawing();
    const line = pageShapes(d, 0).find((s) => s.stroke === '#008000')!;
    const cut = await cutShapes(d, 0, [line.id]);
    const mark = vpathFromShape(line);
    mark.pts = mark.pts.map((p) => [p[0] - 100, p[1]]);
    const items = [
      { src: { id: 'c', name: 'c.pdf', bytes: cut }, num: 1, rot: 0, crop: null, shapes: [mark] },
    ] as unknown as PageItem[];
    const saved = await buildPdf(items, null, {}, saveHooks({}, { measure: await createTextMeasurer() }));
    const back = pageShapes(await PDFLib.PDFDocument.load(saved), 0);
    const moved = back.find((s) => s.stroke === '#008000')!;
    expect(moved).toBeTruthy();
    expect(moved.box[0]).toBeCloseTo(100);
    expect(moved.box[2]).toBeCloseTo(250);
  });
});
