import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import * as PDFLib from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, isFileFont, type FontFileSource, type PageItem } from '../src';
import { pageTexts } from './support/unicode';

/* Text in a Google Font (f 'g:<id>') is saved in that font, embedded from
   the file the page supplies, and reads back as typed; without the file it
   still saves, in Helvetica. */

const google = (name: string) =>
  readFileSync(
    fileURLToPath(new URL('../../../apps/web/public/assets/fonts/google/' + name, import.meta.url)),
  );
const files: FontFileSource = {
  load: async (f, style) =>
    f === 'g:roboto' ? { fontkit, bytes: google('roboto-' + ['r', 'b', 'i', 'bi'][style] + '.ttf') } : null,
};

async function save(f: string, b: boolean, fonts: FontFileSource | null) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const src = { id: 'f', name: 'f.pdf', bytes: await d.save() };
  const items = [
    {
      src,
      num: 1,
      rot: 0,
      crop: null,
      shapes: [{ t: 'text', a: [60, 700], text: 'Hello Ünïcødé', size: 24, c: '#123C8C', f, b }],
    },
  ] as unknown as PageItem[];
  return buildPdf(items, null, {}, { measure: await createTextMeasurer(), fonts });
}

async function baseFonts(bytes: Uint8Array): Promise<string[]> {
  const d = await PDFLib.PDFDocument.load(bytes);
  const out: string[] = [];
  d.context.enumerateIndirectObjects().forEach(([, o]) => {
    if (o instanceof PDFLib.PDFDict && o.get(PDFLib.PDFName.of('Type')) === PDFLib.PDFName.of('Font')) {
      const base = o.get(PDFLib.PDFName.of('BaseFont'));
      if (base) out.push(String(base));
    }
  });
  return out;
}

describe('Google Fonts in text marks', () => {
  it('names them g:<id>', () => {
    expect(isFileFont('g:roboto')).toBe(true);
    expect(isFileFont('helv')).toBe(false);
  });

  it('embeds the font, bold from its own file, and the text reads back', async () => {
    const bytes = await save('g:roboto', true, files);
    expect((await baseFonts(bytes)).some((n) => /Roboto-Bold/.test(n))).toBe(true);
    expect((await pageTexts(bytes))[0]).toContain('Hello Ünïcødé');
  });

  it('without the file, saves in Helvetica', async () => {
    const bytes = await save('g:roboto', false, null);
    const fonts = await baseFonts(bytes);
    expect(fonts.some((n) => /Helvetica/.test(n))).toBe(true);
    expect(fonts.some((n) => /Roboto/.test(n))).toBe(false);
    expect((await pageTexts(bytes))[0]).toContain('Hello Ünïcødé');
  });
});
