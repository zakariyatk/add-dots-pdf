import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, saveHooks, type MeasureText, type PageItem } from '../src';
import { unicodeSource } from './support/unicode';

/* Text read by OCR is written into the saved page invisibly, over the words
   it came from: searchable and selectable, and the page looks the same. */
let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

const { decodePDFRawStream, PDFArray } = PDFLib;
const latin1 = (u8: Uint8Array) => Array.from(u8, (c) => String.fromCharCode(c)).join('');
const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex').toUpperCase();

async function blank(): Promise<Uint8Array> {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595, 842]);
  return d.save();
}

function contentOf(doc: PDFLib.PDFDocument): string {
  const c = doc.getPage(0).node.Contents();
  if (!c) return '';
  const refs = c instanceof PDFArray ? c.asArray() : [c];
  return refs
    .map((r) => latin1(decodePDFRawStream(doc.context.lookup(r) as PDFLib.PDFRawStream).decode()))
    .join('\n');
}

describe('OCR text in the saved page', () => {
  it('writes each word, invisible, where it was read', async () => {
    const it0: PageItem = {
      src: { id: 1, bytes: await blank() },
      num: 1,
      rot: 0,
      shapes: [
        {
          t: 'ocr',
          words: [
            [72, 700, 172, 700, 14, 'Invoice'],
            [180, 700, 230, 700, 14, '2026'],
          ],
        },
      ],
    } as unknown as PageItem;
    const bytes = await buildPdf([it0], null, {}, saveHooks({}, { measure, unicode: unicodeSource }));
    const out = await PDFLib.PDFDocument.load(bytes);
    const text = contentOf(out);
    expect(text).toContain(hex('Invoice'));
    expect(text).toContain(hex('2026'));
    /* drawn see-through: an ExtGState with no fill alpha */
    expect(text).toMatch(/\/GS-?\d*\s+gs/);
    const gs = out.getPage(0).node.Resources()!.lookup(PDFLib.PDFName.of('ExtGState'), PDFLib.PDFDict);
    const alphas = gs.keys().map((k) => String(gs.lookup(k, PDFLib.PDFDict).get(PDFLib.PDFName.of('ca'))));
    expect(alphas).toContain('0');
  });

  it('saves a page with no OCR exactly as before', async () => {
    const src = { id: 1, bytes: await blank() };
    const hooks = saveHooks({}, { measure, unicode: unicodeSource });
    const a = await buildPdf([{ src, num: 1, rot: 0, shapes: [] } as PageItem], null, {}, hooks);
    const b = await buildPdf(
      [{ src, num: 1, rot: 0, shapes: [{ t: 'ocr', words: [] }] } as unknown as PageItem],
      null,
      {},
      hooks,
    );
    expect(contentOf(await PDFLib.PDFDocument.load(b))).toBe(contentOf(await PDFLib.PDFDocument.load(a)));
  });
});
