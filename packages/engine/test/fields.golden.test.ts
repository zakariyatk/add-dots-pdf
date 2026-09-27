import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, fieldsFinish, type FieldValues, type PageItem } from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest, roundNums } from './fixtures/marks.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { makeFormsFixture } from './fixtures/forms.fixture.js';

/* forms.v1.json was recorded from v1's own forms.js in the browser: its save
   hook, with the Form panel's answers set to the fixture's values. */
type PageDigest = { mediaBox: number[]; rotation: number; streams: string[] };
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/forms.v1.json', import.meta.url)), 'utf8'),
) as PageDigest[];

let pages: PageDigest[];
beforeAll(async () => {
  const { items, values } = (await makeFormsFixture(PDFLib)) as { items: PageItem[]; values: FieldValues };
  const hooks = { measure: await createTextMeasurer(), finish: [fieldsFinish(() => values)] };
  pages = await digest(PDFLib, await buildPdf(items, null, {}, hooks));
});

describe('filled form fields match v1 (golden)', () => {
  it('the same pages, one of them turned', () => {
    expect(pages.map((p) => [p.mediaBox, p.rotation])).toEqual(golden.map((p) => [p.mediaBox, p.rotation]));
  });

  it('every page draws the same', () => {
    pages.forEach((p, i) =>
      expect(p.streams.map(roundNums), 'page ' + (i + 1)).toEqual(golden[i]!.streams.map(roundNums)),
    );
  });
});
