import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildPdf,
  createTextMeasurer,
  cutText,
  pageFontSample,
  pageTextLines,
  saveHooks,
  type ContentTextLine,
  type PageItem,
  type TextMark,
} from '../src';

/* Edit Object's Text, saved in the page's own font as Acrobat does: a line
   lifted and retyped within the characters that font has is written in it
   again; text it cannot draw, or a mark restyled, in the mark's own font. */

const ROBOTO = readFileSync(
  fileURLToPath(new URL('../../../apps/web/public/assets/fonts/google/roboto-r.ttf', import.meta.url)),
);

async function drawn(subset: boolean): Promise<PDFLib.PDFDocument> {
  const d = await PDFLib.PDFDocument.create();
  d.registerFontkit(fontkit);
  const f = subset
    ? await d.embedFont(ROBOTO, { subset: true })
    : await d.embedFont(PDFLib.StandardFonts.Helvetica);
  const p = d.addPage([400, 400]);
  p.drawText('Total due: 1,200 USD', { x: 40, y: 300, size: 20, font: f, color: PDFLib.rgb(0.2, 0, 0.6) });
  p.drawText('Keep me', { x: 40, y: 100, size: 12, font: f });
  return PDFLib.PDFDocument.load(await d.save());
}

/* lift the first line, retype it, save; the saved page's lines */
async function retype(d: PDFLib.PDFDocument, text: string, restyle: Partial<TextMark> = {}) {
  const [l] = (await pageTextLines(d, 0)) as [ContentTextLine];
  const cut = await cutText(d, 0, l.id);
  const mark: TextMark = {
    t: 'text',
    a: [l.origin[0], l.origin[1]],
    text,
    size: l.size,
    c: l.color,
    f: 'helv',
    b: false,
    i: false,
    align: 'left',
    pf: l.pf ? { ...l.pf, f: 'helv', b: false, i: false } : null,
    ...restyle,
  } as TextMark;
  const items = [{ src: { id: 'p', name: 'p.pdf', bytes: cut }, num: 1, rot: 0, crop: null, shapes: [mark] }];
  const saved = await buildPdf(
    items as unknown as PageItem[],
    null,
    {},
    saveHooks({}, { measure: await createTextMeasurer() }),
  );
  const after = await pageTextLines(await PDFLib.PDFDocument.load(saved), 0);
  return { before: l, line: after.find((x) => x.text.startsWith('Total'))! };
}

describe("text retyped in the page's own font", () => {
  it('a line carries its font as a table: a subset only what the page draws', async () => {
    const [l] = await pageTextLines(await drawn(true), 0);
    expect(l!.pf!.res).toBeTruthy();
    expect(l!.pf!.twoByte).toBe(true);
    expect(Object.keys(l!.pf!.map)).toEqual(expect.arrayContaining(['T', '1', '2', '0', 'K', 'p']));
    expect(l!.pf!.map['9']).toBeUndefined();
    const [h] = await pageTextLines(await drawn(false), 0);
    /* a font the reader supplies whole: every character of its encoding */
    expect(h!.pf!.map['9']).toBeDefined();
    expect(h!.pf!.map['é']).toBeDefined();
  });

  it('an embedded subset: retyped within its characters, saved in it, in place and colour', async () => {
    const { before, line } = await retype(await drawn(true), 'Total due: 1,000 USD');
    expect(line.text).toBe('Total due: 1,000 USD');
    expect(line.font).toMatch(/Roboto/);
    expect(line.pf!.res).toBe(before.pf!.res);
    expect(line.origin[0]).toBeCloseTo(before.origin[0], 2);
    expect(line.origin[1]).toBeCloseTo(before.origin[1], 2);
    expect(line.color).toBe(before.color);
    expect(line.size).toBeCloseTo(before.size, 3);
  });

  it('a character the subset lacks: the whole line in the mark’s own font', async () => {
    const { line } = await retype(await drawn(true), 'Total due: 950 USD');
    expect(line.text).toBe('Total due: 950 USD');
    expect(line.font).not.toMatch(/Roboto/);
  });

  /* (£ rather than €: Node reads windows-1252's 0x80 as U+0080, browsers as €) */
  it('a font the reader supplies: any text of its encoding', async () => {
    const { before, line } = await retype(await drawn(false), 'Total dû: 950 £');
    expect(line.text).toBe('Total dû: 950 £');
    expect(line.pf!.res).toBe(before.pf!.res);
  });

  it('saved with marks kept editable: still page text, in its font, not a comment', async () => {
    const d = await drawn(true);
    const [l] = (await pageTextLines(d, 0)) as [ContentTextLine];
    const cut = await cutText(d, 0, l.id);
    const mark = {
      t: 'text',
      a: [l.origin[0], l.origin[1]],
      text: 'Total due: 1,000 USD',
      size: l.size,
      c: l.color,
      f: 'helv',
      pf: { ...l.pf!, f: 'helv', b: false, i: false },
    } as TextMark;
    const items = [
      { src: { id: 'p', name: 'p.pdf', bytes: cut }, num: 1, rot: 0, crop: null, shapes: [mark] },
    ];
    const saved = await PDFLib.PDFDocument.load(
      await buildPdf(
        items as unknown as PageItem[],
        null,
        { annots: true },
        saveHooks({}, { measure: await createTextMeasurer() }),
      ),
    );
    expect(saved.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    const line = (await pageTextLines(saved, 0)).find((x) => x.text.startsWith('Total'))!;
    expect(line.font).toMatch(/Roboto/);
  });

  it('made bold after lifting: the mark’s own font', async () => {
    const { before, line } = await retype(await drawn(true), 'Total due: 1,000 USD', { b: true });
    expect(line.pf!.res).not.toBe(before.pf!.res);
  });

  it('for the screen: the text alone in its page font, on a page the size of its box', async () => {
    const d = await drawn(true);
    const [l] = (await pageTextLines(d, 0)) as [ContentTextLine];
    const cut = await PDFLib.PDFDocument.load(await cutText(d, 0, l.id));
    const mark = {
      t: 'text',
      a: [l.origin[0], l.origin[1]],
      text: 'Total due: 1,000 USD',
      size: l.size,
      c: l.color,
      f: 'helv',
      pf: { ...l.pf!, f: 'helv', b: false, i: false },
    } as TextMark;
    const got = (await pageFontSample(cut, 0, mark))!;
    const sample = await PDFLib.PDFDocument.load(got.bytes);
    const [t] = await pageTextLines(sample, 0);
    expect(t!.text).toBe('Total due: 1,000 USD');
    expect(t!.font).toMatch(/Roboto/);
    expect(t!.origin[0]).toBeCloseTo(l.origin[0], 2);
    expect(t!.origin[1]).toBeCloseTo(l.origin[1], 2);
    expect(got.box[0]).toBeLessThan(l.origin[0]);
    expect(got.box[2]).toBeGreaterThan(l.origin[0] + t!.width);
    /* only the font came over: no images, no other content */
    const res = sample.getPage(0).node.Resources()!;
    const sizeOf = (k: string) => res.lookupMaybe(PDFLib.PDFName.of(k), PDFLib.PDFDict)?.keys().length ?? 0;
    expect([sizeOf('Font'), sizeOf('XObject'), sizeOf('ExtGState')]).toEqual([1, 0, 0]);
    /* a character the subset lacks: not drawn this way */
    expect(await pageFontSample(cut, 0, { ...mark, text: 'Total 9' })).toBeNull();
  });
});
