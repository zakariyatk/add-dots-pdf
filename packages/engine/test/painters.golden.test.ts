import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  annotateFontNeeds,
  annotatePainters,
  buildPdf,
  createTextMeasurer,
  docopsFontNeeds,
  docopsPainters,
  drawFontNeeds,
  drawPainters,
  formsPainters,
  insertPainters,
  leaderPainters,
  prepareInsert,
  prepareSignatures,
  type PageItem,
  type SaveHooks,
  type Scale,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest, roundNums } from './fixtures/marks.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME, SCALE, makeModulesFixture } from './fixtures/modules.fixture.js';

/* modules.v1.json was recorded from the v1 app in the browser, with its own
   module painters (annotate, draw, docops, enhance, insert, forms), before any
   of them were switched to the engine. */
type PageDigest = {
  mediaBox: number[];
  cropBox: number[];
  rotation: number;
  streams: string[];
  annots?: { subtype: string; rect: number[]; uri: string | null }[];
};
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/modules.v1.json', import.meta.url)), 'utf8'),
) as PageDigest[];

const LABELS = ['annotate, draw and leader', 'dimensions', 'docops, insert and signature'];
let pages: PageDigest[];

beforeAll(async () => {
  const items = (await makeModulesFixture(PDFLib)) as PageItem[];
  const hooks: SaveHooks = {
    measure: await createTextMeasurer(),
    shapePainters: {
      ...annotatePainters,
      ...drawPainters(() => SCALE as Scale),
      ...docopsPainters({ totalPages: () => items.length, fileName: () => FILE_NAME, today: () => '' }),
      ...leaderPainters,
      ...insertPainters,
      ...formsPainters,
    },
    fontNeeds: { ...annotateFontNeeds, ...drawFontNeeds, ...docopsFontNeeds },
    prepare: [prepareSignatures, prepareInsert],
  };
  pages = await digest(PDFLib, await buildPdf(items, null, {}, hooks));
});

describe('module painters match v1 (golden)', () => {
  it('produces the same pages', () => {
    expect(pages).toHaveLength(golden.length);
  });

  it.each(golden.map((g, i) => [LABELS[i], i, g] as const))('page %s: content streams', (_, i, g) => {
    expect(pages[i]!.streams.map(roundNums)).toEqual(g.streams.map(roundNums));
  });

  it.each(golden.map((g, i) => [LABELS[i], i, g] as const))('page %s: link annotations', (_, i, g) => {
    expect(pages[i]!.annots).toEqual(g.annots);
  });
});
