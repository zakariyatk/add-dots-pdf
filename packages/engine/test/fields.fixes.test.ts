import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, fieldsFinish, type FieldValues, type FormField } from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest } from './fixtures/marks.fixture.js';

/* Save bugs in v1's filled form fields. Each test here fails on v1's
   painter and passes on the fixed one. */

const BOX: FormField['rect'] = [60, 700, 200, 716]; // 140 x 16: text 9.92pt, 136pt of room

async function save(fields: FormField[], values: FieldValues): Promise<string> {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const src = { id: 'f', bytes: await d.save() };
  const items = [{ src, num: 1, rot: 0, crop: null, shapes: [], fields }];
  const hooks = { measure: await createTextMeasurer(), finish: [fieldsFinish(() => values)] };
  const [page] = await digest(PDFLib, await buildPdf(items, null, {}, hooks));
  return (page as { streams: string[] }).streams.join('');
}

/** Each drawn line of text: its size, baseline and the string. */
function lines(stream: string): { size: number; y: number; text: string }[] {
  const out: { size: number; y: number; text: string }[] = [];
  const re = /\/Helvetica-# ([\d.]+) Tf\n[\s\S]*?1 0 0 1 [\d.]+ ([\d.]+) Tm\n((?:<[0-9A-F]*> Tj\nT\*\n)+)/g;
  for (let m; (m = re.exec(stream));) {
    for (const [, hex] of m[3]!.matchAll(/<([0-9A-F]*)> Tj/g)) {
      const text = (hex!.match(/../g) || []).map((x) => String.fromCharCode(parseInt(x, 16))).join('');
      out.push({ size: +m[1]!, y: +m[2]!, text });
    }
  }
  return out;
}

const tx = (name: string, more: Partial<FormField> = {}): FormField => ({
  name,
  type: 'Tx',
  rect: BOX,
  ...more,
});

describe('filled form fields: fixes to v1', () => {
  /* With the fallback font (see unicode.test) such characters are kept. This
     is the last resort when that font cannot be had: the save still completes. */
  it('a character the standard font cannot encode no longer fails the save', async () => {
    const s = await save([tx('one'), tx('many', { rect: [60, 500, 300, 600], multiline: true })], {
      one: 'Done ✓ → next',
      many: 'Line → one\nSmile 🙂 two',
    });
    expect(lines(s).map((l) => l.text)).toEqual(['Done ? ? next', 'Line ? one', 'Smile ? two']);
  });

  it('a long one-line answer stays on one line inside its box, shrunk to fit', async () => {
    const long = 'This answer is too long for one line';
    const [l, ...rest] = lines(await save([tx('a')], { a: long }));
    expect(rest).toHaveLength(0);
    expect(l!.text).toBe(long);
    expect(l!.size).toBeLessThan(9.92);
    expect(l!.size).toBeGreaterThanOrEqual(6);
    const helv = await (await PDFLib.PDFDocument.create()).embedFont(PDFLib.StandardFonts.Helvetica);
    expect(helv.widthOfTextAtSize(l!.text, l!.size)).toBeLessThanOrEqual(136 + 1e-9);
    expect(l!.y).toBeGreaterThan(700);
    expect(l!.y + l!.size).toBeLessThan(716);
  });

  it('one too long even at 6pt is shortened with an ellipsis', async () => {
    const long = 'A very long answer that could never fit in this box even at the smallest size allowed';
    const [l, ...rest] = lines(await save([tx('a')], { a: long }));
    expect(rest).toHaveLength(0);
    expect(l!.size).toBe(6);
    expect(l!.text).toMatch(/^A very long answer .*\x85$/);
  });

  it('an answer that fits keeps its size', async () => {
    expect(lines(await save([tx('a')], { a: 'Short' }))).toEqual([{ size: 9.92, y: 705.024, text: 'Short' }]);
  });
});
