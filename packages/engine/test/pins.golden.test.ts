import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, pinHooks, type PageItem, type PinLocation } from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest, roundNums } from './fixtures/marks.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME, makePinsFixture } from './fixtures/pins.fixture.js';

/* pins.v1.json was recorded from v1's own drawPin and addPhotoPages, in the
   browser, saving with "include photo pages" on. */
type PageDigest = {
  mediaBox: number[];
  rotation: number;
  streams: string[];
  annots?: { rect: number[]; dest?: [number, string] }[];
};
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/pins.v1.json', import.meta.url)), 'utf8'),
) as PageDigest[];

let pages: PageDigest[];
beforeAll(async () => {
  const { items, locs } = (await makePinsFixture(PDFLib)) as {
    items: PageItem[];
    locs: Record<string, PinLocation>;
  };
  const hooks = { measure: await createTextMeasurer(), pins: pinHooks(locs, { docName: () => FILE_NAME }) };
  pages = await digest(PDFLib, await buildPdf(items, null, { photos: true }, hooks));
});

describe('photo pins match v1 (golden)', () => {
  it('the same pages: 2 drawing pages, 2 index pages, 34 location pages', () => {
    expect(pages).toHaveLength(golden.length);
    expect(pages.map((p) => [p.mediaBox, p.rotation])).toEqual(golden.map((p) => [p.mediaBox, p.rotation]));
  });

  it('every page draws the same', () => {
    pages.forEach((p, i) =>
      expect(p.streams.map(roundNums), 'page ' + (i + 1)).toEqual(golden[i]!.streams.map(roundNums)),
    );
  });

  it('every link lands on the same page', () => {
    pages.forEach((p, i) => expect(p.annots, 'page ' + (i + 1)).toEqual(golden[i]!.annots));
  });
});
