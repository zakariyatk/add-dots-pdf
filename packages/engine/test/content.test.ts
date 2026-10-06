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

/* A form XObject: content kept apart and drawn with Do, as CAD exports and
   stamps often are. `content` draws it; `formBody` is its own content. */
async function withForm(
  formBody: string,
  content: (name: string) => string,
  opts: { matrix?: number[]; bbox?: number[]; pages?: number } = {},
): Promise<PDFLib.PDFDocument> {
  const d = await PDFLib.PDFDocument.create();
  const ref = d.context.register(
    d.context.flateStream(enc(formBody), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: opts.bbox || [0, 0, 200, 200],
      ...(opts.matrix ? { Matrix: opts.matrix } : {}),
    }),
  );
  for (let i = 0; i < (opts.pages || 1); i++) {
    const p = d.addPage([400, 400]);
    const name = p.node.newXObject('Fm', ref).decodeText();
    p.node.set(PDFLib.PDFName.of('Contents'), d.context.register(d.context.flateStream(enc(content(name)))));
  }
  return d;
}
const BODY = '1 0 0 rg 10 10 50 40 re f 0 0 1 RG 3 w 100 100 m 180 150 l S';

describe('shapes inside a form XObject', () => {
  it('a form drawn once: its shapes, through its matrix and the page transform', async () => {
    const d = await withForm(BODY, (n) => 'q 1 0 0 1 100 50 cm /' + n + ' Do Q 0 g 300 300 20 20 re f', {
      matrix: [2, 0, 0, 2, 0, 0],
    });
    const shapes = pageShapes(d, 0);
    expect(shapes.length).toBe(3);
    const box = shapes.find((s) => s.fill === '#ff0000')!;
    expect(box.forms!.length).toBe(1);
    expect(box.box).toEqual([120, 70, 220, 150]);
    const line = shapes.find((s) => s.stroke === '#0000ff')!;
    expect(line.w).toBeCloseTo(6);
    expect(shapes.find((s) => s.fill === '#000000')!.path).toBeUndefined();
  });

  it('cuts a form shape out of the page copy, the rest of the form kept', async () => {
    const d = await withForm(BODY, (n) => '/' + n + ' Do 0 g 300 300 20 20 re f');
    const line = pageShapes(d, 0).find((s) => s.stroke === '#0000ff')!;
    const after = await PDFLib.PDFDocument.load(await cutShapes(d, 0, [line.id]));
    const left = pageShapes(after, 0);
    expect(left.map((s) => s.fill || s.stroke).sort()).toEqual(['#000000', '#ff0000']);
    expect(left.find((s) => s.fill === '#ff0000')!.path).toBeTruthy();
  });

  it('another page drawing the same form keeps the shape', async () => {
    const d = await withForm(BODY, (n) => '/' + n + ' Do', { pages: 2 });
    const line = pageShapes(d, 0).find((s) => s.stroke === '#0000ff')!;
    await cutShapes(d, 0, [line.id]);
    expect(pageShapes(d, 1).some((s) => s.stroke === '#0000ff')).toBe(true);
    expect(pageShapes(d, 0).some((s) => s.stroke === '#0000ff')).toBe(true);
  });

  it('a form drawn twice: the shape cut from the one drawing picked, the other kept', async () => {
    const d = await withForm(BODY, (n) => '/' + n + ' Do q 1 0 0 1 200 0 cm /' + n + ' Do Q');
    const shapes = pageShapes(d, 0);
    expect(shapes.length).toBe(4);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(4);
    const right = shapes.find((s) => s.stroke === '#0000ff' && s.box[0] > 250)!;
    expect(right.box).toEqual([300, 100, 380, 150]);
    const after = await PDFLib.PDFDocument.load(await cutShapes(d, 0, [right.id]));
    const left = pageShapes(after, 0);
    expect(left.length).toBe(3);
    expect(left.filter((s) => s.stroke === '#0000ff').map((s) => s.box[0])).toEqual([100]);
    expect(
      left
        .filter((s) => s.fill === '#ff0000')
        .map((s) => s.box[0])
        .sort(),
    ).toEqual([10, 210]);
  });

  it('a form inside a form, drawn twice there: found, and cut from the one picked', async () => {
    const d = await PDFLib.PDFDocument.create();
    const inner = d.context.register(
      d.context.flateStream(enc(BODY), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 200] }),
    );
    const outer = d.context.register(
      d.context.flateStream(enc('/In Do q 0.5 0 0 0.5 0 200 cm /In Do Q'), {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 400, 400],
        Resources: { XObject: { In: inner } },
      }),
    );
    const p = d.addPage([400, 400]);
    const name = p.node.newXObject('Fm', outer).decodeText();
    p.node.set(
      PDFLib.PDFName.of('Contents'),
      d.context.register(d.context.flateStream(enc('/' + name + ' Do'))),
    );
    const shapes = pageShapes(d, 0);
    expect(shapes.length).toBe(4);
    const small = shapes.find((s) => s.stroke === '#0000ff' && s.box[1] > 200)!;
    expect(small.forms).toEqual([name, 'In']);
    expect(small.box).toEqual([50, 250, 90, 275]);
    expect(small.w).toBeCloseTo(1.5);
    const after = await PDFLib.PDFDocument.load(await cutShapes(d, 0, [small.id]));
    const left = pageShapes(after, 0);
    expect(left.filter((s) => s.stroke === '#0000ff').map((s) => s.box[1])).toEqual([100]);
    expect(left.filter((s) => s.fill === '#ff0000').length).toBe(2);
    /* the page that was not cut still draws both */
    expect(pageShapes(d, 0).filter((s) => s.stroke === '#0000ff').length).toBe(2);
  });

  it('a form that draws itself is read once, not for ever', async () => {
    const d = await PDFLib.PDFDocument.create();
    const ref = d.context.nextRef();
    const p = d.addPage([400, 400]);
    d.context.assign(
      ref,
      d.context.flateStream(enc(BODY + ' /Me Do'), {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 200, 200],
        Resources: { XObject: { Me: ref } },
      }),
    );
    const name = p.node.newXObject('Fm', ref).decodeText();
    p.node.set(
      PDFLib.PDFName.of('Contents'),
      d.context.register(d.context.flateStream(enc('/' + name + ' Do'))),
    );
    expect(pageShapes(d, 0).length).toBe(2);
  });

  it('not offered: a shape the form box clips', async () => {
    const clipped = await withForm(BODY, (n) => '/' + n + ' Do', { bbox: [0, 0, 90, 90] });
    expect(pageShapes(clipped, 0).map((s) => s.fill)).toEqual(['#ff0000']);
  });

  it('the cut shape saves back as a mark, and the form part stays', async () => {
    const d = await withForm(BODY, (n) => '/' + n + ' Do');
    const line = pageShapes(d, 0).find((s) => s.stroke === '#0000ff')!;
    const cut = await cutShapes(d, 0, [line.id]);
    const items = [
      {
        src: { id: 'f', name: 'f.pdf', bytes: cut },
        num: 1,
        rot: 0,
        crop: null,
        shapes: [vpathFromShape(line)],
      },
    ] as unknown as PageItem[];
    const saved = await buildPdf(items, null, {}, saveHooks({}, { measure: await createTextMeasurer() }));
    const back = pageShapes(await PDFLib.PDFDocument.load(saved), 0);
    expect(back.filter((s) => s.stroke === '#0000ff').length).toBe(1);
    expect(back.some((s) => s.fill === '#ff0000')).toBe(true);
  });
});
