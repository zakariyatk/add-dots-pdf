import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildPdf,
  cleanGrad,
  createTextMeasurer,
  defaultGrad,
  drawFontNeeds,
  drawPainters,
  gradAngle,
  gradColourAt,
  gradEnds,
  gradFrac,
  gradRamp,
  gradWithAngle,
  penPainters,
  polyPainters,
  svgPath,
  vpathPainters,
  type AnyMark,
  type Grad,
  type MeasureText,
  type PageItem,
} from '../src';

/* Gradient fills (gradient.ts, painters/gradient.ts): the vector laid out on
   the shape's box and turned with it, the blend with its midpoints, and the
   shading each closed shape writes into the saved PDF. */

let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

const hooks = {
  shapePainters: {
    ...drawPainters(() => ({ unit: 'mm', denom: 1, custom: null })),
    ...polyPainters,
    ...penPainters,
    ...vpathPainters,
  },
  fontNeeds: drawFontNeeds,
};

/** The saved PDF, opened again: page 1's content and its shading objects. */
async function save(shapes: object[]) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const items: PageItem[] = [
    { src: { id: 1, bytes: await d.save() }, num: 1, rot: 0, shapes: shapes as AnyMark[] },
  ];
  const bytes = await buildPdf(items, null, {}, { measure, ...hooks });
  const doc = await PDFLib.PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams: PDFLib.PDFRawStream[] = [];
  if (contents instanceof PDFLib.PDFArray)
    contents.asArray().forEach((r) => streams.push(doc.context.lookup(r) as PDFLib.PDFRawStream));
  else if (contents) streams.push(contents as unknown as PDFLib.PDFRawStream);
  const text = streams
    .map((s) => {
      const raw = s.getContents();
      const filtered = s.dict.get(PDFLib.PDFName.of('Filter'));
      return Buffer.from(filtered ? PDFLib.decodePDFRawStream(s).decode() : raw).toString('latin1');
    })
    .join('\n');
  const res = page.node.Resources()!;
  const sh = res.lookupMaybe(PDFLib.PDFName.of('Shading'), PDFLib.PDFDict);
  const shadings = sh ? sh.keys().map((k) => doc.context.lookup(sh.get(k)) as PDFLib.PDFDict) : [];
  const gs = res.lookupMaybe(PDFLib.PDFName.of('ExtGState'), PDFLib.PDFDict);
  const states = gs ? gs.keys().map((k) => doc.context.lookup(gs.get(k)) as PDFLib.PDFDict) : [];
  return { text, shadings, states, doc };
}
const num = (d: PDFLib.PDFDict, k: string) => (d.get(PDFLib.PDFName.of(k)) as PDFLib.PDFNumber).asNumber();
const nums = (d: PDFLib.PDFDict, k: string) =>
  (d.get(PDFLib.PDFName.of(k)) as PDFLib.PDFArray).asArray().map((n) => (n as PDFLib.PDFNumber).asNumber());

const box = { t: 'rect', a: [100, 100], b: [300, 200], c: '#000000', w: 1, fill: '#FFFFFF' };

describe('the vector', () => {
  it('runs left to right across the box by default', () => {
    const s = { ...box, grad: defaultGrad() };
    expect(gradEnds(s)).toEqual([
      [100, 150],
      [300, 150],
    ]);
    expect(gradAngle(s)).toBe(0);
  });
  it('a radial one starts at the centre and reaches the right side', () => {
    expect(gradEnds({ ...box, grad: defaultGrad('radial') })).toEqual([
      [200, 150],
      [300, 150],
    ]);
  });
  it('turns with the box', () => {
    const [a, b] = gradEnds({ ...box, r: 90, grad: defaultGrad() });
    expect(a[0]).toBeCloseTo(200);
    expect(a[1]).toBeCloseTo(50);
    expect(b[0]).toBeCloseTo(200);
    expect(b[1]).toBeCloseTo(250);
  });
  it('moves and stretches with the box', () => {
    const [a, b] = gradEnds({ ...box, a: [0, 0], b: [100, 50], grad: defaultGrad() });
    expect([a, b]).toEqual([
      [0, 25],
      [100, 25],
    ]);
  });
  it('page points go back to the same fractions, turned or not', () => {
    for (const r of [0, 30, 200]) {
      const s = { ...box, r, grad: defaultGrad() };
      const g: Grad = { ...s.grad, g1: [0.2, 0.3], g2: [0.9, 0.7] };
      const [a, b] = gradEnds(s, g);
      expect(gradFrac(s, a)).toEqual([0.2, 0.3]);
      expect(gradFrac(s, b)).toEqual([0.9, 0.7]);
    }
  });
  it('an angle can be set, the start and length kept', () => {
    const s = { ...box, grad: defaultGrad() };
    const g = gradWithAngle(s, s.grad, 90);
    expect(gradAngle(s, g)).toBeCloseTo(90);
    const [a, b] = gradEnds(s, g);
    expect(a).toEqual([100, 150]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(200);
  });
  it('a path of points lays it out on its unturned frame', () => {
    const pts = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
      [0, 0],
    ];
    expect(gradEnds({ pts, grad: defaultGrad() })).toEqual([
      [0, 25],
      [100, 25],
    ]);
  });
});

describe('the blend', () => {
  it('is the stops themselves with midpoints in the middle', () => {
    const R = gradRamp(defaultGrad());
    expect(R.map((r) => r.p)).toEqual([0, 1]);
    expect(R[0]!.rgb).toEqual([1, 1, 1]);
    expect(R[1]!.rgb).toEqual([0, 0, 0]);
  });
  it('is half way at an off-centre midpoint', () => {
    const g: Grad = { ...defaultGrad(), mid: [0.25] };
    const R = gradRamp(g);
    expect(R.length).toBeGreaterThan(2);
    expect(gradColourAt(g, 0.25).c).toBe('#808080');
    expect(gradColourAt(defaultGrad(), 0.5).c).toBe('#808080');
  });
  it('carries each stop’s opacity', () => {
    const g: Grad = {
      k: 'linear',
      stops: [
        { c: '#FF0000', p: 0, o: 0 },
        { c: '#FF0000', p: 1 },
      ],
    };
    expect(gradColourAt(g, 0.5).o).toBeCloseTo(0.5);
  });
});

describe('a gradient from a file', () => {
  it('keeps colours as #hex only', () => {
    expect(
      cleanGrad({
        k: 'linear',
        stops: [
          { c: 'red', p: 0 },
          { c: '#000', p: 1 },
        ],
      }),
    ).toBeNull();
    expect(
      cleanGrad({
        k: 'linear',
        stops: [
          { c: '#fff" onload="x', p: 0 },
          { c: '#000', p: 1 },
        ],
      }),
    ).toBeNull();
  });
  it('keeps numbers in range', () => {
    const g = cleanGrad({
      k: 'radial',
      stops: [
        { c: '#FFF', p: -3, o: 7 },
        { c: '#000', p: 9 },
      ],
      mid: [4],
    });
    expect(g).toEqual({
      k: 'radial',
      stops: [
        { c: '#FFF', p: 0, o: 1 },
        { c: '#000', p: 1 },
      ],
      mid: [1],
    });
  });
});

describe('the saved PDF', () => {
  it('a box writes an axial shading clipped to it, carried past both ends', async () => {
    const r = await save([{ ...box, grad: defaultGrad() }]);
    expect(r.shadings.length).toBe(1);
    const sh = r.shadings[0]!;
    expect(num(sh, 'ShadingType')).toBe(2);
    expect(nums(sh, 'Coords')).toEqual([100, 150, 300, 150]);
    expect(r.text).toMatch(/W\s+n\s+\/Gr[-\w]* sh/);
  });
  it('a radial gradient writes a radial shading about the centre', async () => {
    const r = await save([{ ...box, t: 'ellipse', grad: defaultGrad('radial') }]);
    const sh = r.shadings[0]!;
    expect(num(sh, 'ShadingType')).toBe(3);
    expect(nums(sh, 'Coords')).toEqual([200, 150, 0, 200, 150, 100]);
  });
  it('three stops stitch two blends together', async () => {
    const g: Grad = {
      k: 'linear',
      stops: [
        { c: '#FF0000', p: 0 },
        { c: '#00FF00', p: 0.4 },
        { c: '#0000FF', p: 1 },
      ],
    };
    const r = await save([{ ...box, grad: g }]);
    const fn = r.doc.context.lookup(r.shadings[0]!.get(PDFLib.PDFName.of('Function'))) as PDFLib.PDFDict;
    expect(num(fn, 'FunctionType')).toBe(3);
    expect(nums(fn, 'Bounds')).toEqual([0.4]);
  });
  it('stops less than opaque add a soft mask', async () => {
    const g: Grad = {
      k: 'linear',
      stops: [
        { c: '#FF0000', p: 0, o: 0 },
        { c: '#FF0000', p: 1 },
      ],
    };
    const r = await save([{ ...box, grad: g }]);
    expect(r.states.some((s) => s.has(PDFLib.PDFName.of('SMask')))).toBe(true);
  });
  it('no gradient writes no shading, as before', async () => {
    const r = await save([box]);
    expect(r.shadings.length).toBe(0);
  });
  it('every closed shape takes one', async () => {
    const ring = [
      [100, 100],
      [200, 100],
      [150, 180],
      [100, 100],
    ];
    const pen = [
      [100, 100],
      [100, 100],
      [200, 100],
      [200, 100],
      [200, 100],
      [150, 180],
      [150, 180],
      [150, 180],
      [100, 100],
      [100, 100],
    ];
    const grad = defaultGrad();
    const r = await save([
      { ...box, t: 'cloud', grad },
      { t: 'poly', pts: ring, c: '#000000', w: 1, fill: '#FFFFFF', grad },
      { t: 'pen', pts: pen, c: '#000000', w: 1, fill: '#FFFFFF', grad },
      { t: 'vpath', k: 'MLLZ', pts: ring.slice(0, 3), c: '#000000', w: 1, fill: '#FFFFFF', grad },
    ]);
    expect(r.shadings.length).toBe(4);
    expect(r.text).toMatch(/W\*\s+n/); /* the Edit Object shape, inside as even-odd */
  });
});

describe('svgPath', () => {
  it('reads the absolute M, L, C and Z the painters write', () => {
    expect(svgPath('M1 2 L3 4C5 6 7 8 9 10 Z')).toEqual([
      { k: 'M', p: [1, 2] },
      { k: 'L', p: [3, 4] },
      {
        k: 'C',
        p: [
          [5, 6],
          [7, 8],
          [9, 10],
        ],
      },
      { k: 'Z' },
    ]);
  });
});
