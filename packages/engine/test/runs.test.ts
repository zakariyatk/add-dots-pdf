import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, lineSpans, lineWidth, type PageItem, type TextMark } from '../src';
import { pageTexts } from './support/unicode';

/* Style runs: part of a text mark bold, coloured or underlined, as a
   selection in Word is. Each line is drawn a piece at a time. */

const mark = (runs: TextMark['runs']): TextMark => ({
  t: 'text',
  a: [60, 700],
  text: 'Indian country\nof cities',
  size: 20,
  c: '#000000',
  f: 'helv',
  runs,
});

describe('lineSpans', () => {
  it('is the whole line when there are no runs', () => {
    const s = mark(null);
    expect(lineSpans(s, 0).map((p) => p.text)).toEqual(['Indian country']);
    expect(lineSpans(s, 1)[0]!.s).toBe(s);
  });

  it('cuts a line where the style changes, counting the newline', () => {
    /* "Indian " plain, "country\nof" bold red, the rest plain */
    const s = mark([{ n: 7 }, { n: 10, b: true, c: '#FF0000' }, { n: 7 }]);
    const l0 = lineSpans(s, 0);
    expect(l0.map((p) => p.text)).toEqual(['Indian ', 'country']);
    expect(l0[1]!.s.b).toBe(true);
    expect(l0[1]!.s.c).toBe('#FF0000');
    const l1 = lineSpans(s, 1);
    expect(l1.map((p) => p.text)).toEqual(['of', ' cities']);
    expect(l1[1]!.s.b).toBeFalsy();
  });

  it('keeps the mark style for text past the last run', () => {
    const s = mark([{ n: 3, u: true }]);
    expect(lineSpans(s, 0).map((p) => [p.text, !!p.s.u])).toEqual([
      ['Ind', true],
      ['ian country', false],
    ]);
  });

  it('measures bold pieces wider', async () => {
    const measure = await createTextMeasurer();
    const plain = lineWidth(mark(null), 0, measure)!;
    const bold = lineWidth(mark([{ n: 14, b: true }]), 0, measure)!;
    expect(bold).toBeGreaterThan(plain);
  });
});

describe('saving style runs', () => {
  it('embeds the bold font and the text reads back whole', async () => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([595.28, 841.89]);
    const src = { id: 'f', name: 'f.pdf', bytes: await d.save() };
    const items = [
      { src, num: 1, rot: 0, crop: null, shapes: [mark([{ n: 7 }, { n: 7, b: true, c: '#C00000' }])] },
    ] as unknown as PageItem[];
    const bytes = await buildPdf(items, null, {}, { measure: await createTextMeasurer() });
    const doc = await PDFLib.PDFDocument.load(bytes);
    const names: string[] = [];
    doc.context.enumerateIndirectObjects().forEach(([, o]) => {
      if (o instanceof PDFLib.PDFDict && o.get(PDFLib.PDFName.of('Type')) === PDFLib.PDFName.of('Font'))
        names.push(String(o.get(PDFLib.PDFName.of('BaseFont'))));
    });
    expect(names.some((n) => /Helvetica-Bold/.test(n))).toBe(true);
    const text = (await pageTexts(bytes))[0]!.replace(/\s+/g, ' ');
    expect(text).toContain('Indian country');
    expect(text).toContain('of cities');
  });
});
