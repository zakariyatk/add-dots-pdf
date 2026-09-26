import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, type MeasureText, type PageItem } from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest, makeFixture } from './fixtures/marks.fixture.js';

/* marks.v1.json was recorded from the v1 app's own buildPdf, in the browser,
   before core.js was switched over (see apps/web/vite.config.ts, /__golden/).
   The engine has to produce the same pages: same operators, same numbers,
   same boxes and rotation. */
type PageDigest = { mediaBox: number[]; cropBox: number[]; rotation: number; streams: string[] };
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/marks.v1.json', import.meta.url)), 'utf8'),
) as PageDigest[];

let measure: MeasureText;
let pages: PageDigest[];

beforeAll(async () => {
  measure = await createTextMeasurer();
  const items = (await makeFixture(PDFLib)) as PageItem[];
  pages = await digest(PDFLib, await buildPdf(items, null, {}, { measure }));
});

describe('buildPdf matches v1 (golden)', () => {
  it('produces the same number of pages', () => {
    expect(pages).toHaveLength(golden.length);
  });

  it.each(golden.map((g, i) => [i + 1, g] as const))('page %i: boxes and rotation', (n, g) => {
    const p = pages[n - 1]!;
    expect({ mediaBox: p.mediaBox, cropBox: p.cropBox, rotation: p.rotation }).toEqual({
      mediaBox: g.mediaBox,
      cropBox: g.cropBox,
      rotation: g.rotation,
    });
  });

  it.each(golden.map((g, i) => [i + 1, g] as const))('page %i: content streams', (n, g) => {
    expect(pages[n - 1]!.streams).toEqual(g.streams);
  });
});
