import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, type AnyMark, type PageItem } from '../src';

/* The saved page stacks marks as the screen does: the last is on top. Text
   used to be painted first, whatever its place, so Bring to front and Send
   to back were lost on saving. */
const { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } = PDFLib;

const box: AnyMark = {
  t: 'rect',
  a: [50, 50],
  b: [200, 120],
  c: '#00FF00',
  fill: '#00FF00',
  w: 1,
} as AnyMark;
const text: AnyMark = { t: 'text', a: [60, 70], text: 'over', size: 14, c: '#FF0000', f: 'helv' } as AnyMark;

async function pageContent(shapes: AnyMark[], opts = {}) {
  const d = await PDFDocument.create();
  d.addPage([300, 300]);
  const src = { id: 1, name: 'a.pdf', bytes: await d.save() };
  const items = [{ src, num: 1, rot: 0, shapes } as unknown as PageItem];
  const out = await PDFDocument.load(
    await buildPdf(items, null, opts, { measure: await createTextMeasurer() }),
  );
  const c = out.getPage(0).node.Contents()!;
  const refs = c instanceof PDFArray ? c.asArray() : [c];
  return {
    annots: out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0,
    ops: refs
      .map((r) => out.context.lookup(r))
      .map((s) =>
        s instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')
          : Buffer.from((s as PDFLib.PDFContentStream).getUnencodedContents()).toString('latin1'),
      )
      .join('\n'),
  };
}

describe('marks stack in the saved page as they do on screen', () => {
  it('text under a box stays under it', async () => {
    const { ops } = await pageContent([text, box]);
    expect(ops.indexOf('BT')).toBeGreaterThan(-1);
    expect(ops.indexOf('BT')).toBeLessThan(ops.indexOf('0 1 0 rg'));
  });

  it('text over a box stays over it', async () => {
    const { ops } = await pageContent([box, text]);
    expect(ops.indexOf('0 1 0 rg')).toBeGreaterThan(-1);
    expect(ops.indexOf('0 1 0 rg')).toBeLessThan(ops.indexOf('BT'));
  });

  it('fixed marks are part of the page, with no comment for a reader to move', async () => {
    const { annots } = await pageContent([box, text], { annots: false });
    expect(annots).toBe(0);
  });
});
