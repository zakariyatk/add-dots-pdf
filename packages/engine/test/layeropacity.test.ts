import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, type AnyMark, type MeasureText, type PageItem } from '../src';

/* A layer's opacity (s.lo, set on each member by the Layers panel): the
   whole mark is drawn under a constant soft mask at that opacity, which
   multiplies with the mark's own; a mark at 1, or with none, saves as before. */

let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

async function save(shapes: object[]) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const items: PageItem[] = [
    { src: { id: 1, bytes: await d.save() }, num: 1, rot: 0, shapes: shapes as AnyMark[] },
  ];
  const doc = await PDFLib.PDFDocument.load(await buildPdf(items, null, {}, { measure }));
  const res = doc.getPage(0).node.Resources()!;
  const gs = res.lookupMaybe(PDFLib.PDFName.of('ExtGState'), PDFLib.PDFDict);
  const states = gs ? gs.keys().map((k) => doc.context.lookup(gs.get(k)) as PDFLib.PDFDict) : [];
  /* the grey each soft mask paints: the opacity it fades to */
  return states
    .map((s) => s.lookupMaybe(PDFLib.PDFName.of('SMask'), PDFLib.PDFDict))
    .filter((m): m is PDFLib.PDFDict => !!m)
    .map((m) => {
      const form = doc.context.lookup(m.get(PDFLib.PDFName.of('G'))) as PDFLib.PDFRawStream;
      const raw = form.dict.has(PDFLib.PDFName.of('Filter'))
        ? PDFLib.decodePDFRawStream(form).decode()
        : form.getContents();
      return parseFloat(Buffer.from(raw).toString('latin1'));
    });
}

const box = { t: 'rect', a: [100, 100], b: [300, 200], c: '#E2483D', w: 2, fill: '#3B82F6' };
const text = { t: 'text', a: [100, 400], text: 'Layer', size: 18, f: 'helv', c: '#000000' };

describe('a layer’s opacity in the saved PDF', () => {
  it('fades a box under a soft mask at the layer’s opacity', async () => {
    expect(await save([{ ...box, lo: 0.4 }])).toEqual([0.4]);
  });
  it('fades text the same way', async () => {
    expect(await save([{ ...text, lo: 0.25 }])).toEqual([0.25]);
  });
  it('adds nothing at full opacity or with none', async () => {
    expect(await save([box, { ...box, lo: 1 }, text])).toEqual([]);
  });
});
