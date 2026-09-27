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

  it('the turned page draws the same', () => {
    expect(pages[1]!.streams.map(roundNums)).toEqual(golden[1]!.streams.map(roundNums));
  });

  /* The long one-line answer is the one deliberate difference (see
     fields.fixes.test): v1 wrapped it onto a second line below its box. Each
     field is drawn in its own q..Q block, so compare page 1 block by block. */
  it('page 1: every field but the long one-line answer draws the same', () => {
    const LONG = '<5468697320616E73776572'; // "This answer…"
    const now = blocks(roundNums(pages[0]!.streams.join('')));
    const was = blocks(roundNums(golden[0]!.streams.join('')));
    expect(now.filter((b) => !b.includes(LONG))).toEqual(was.filter((b) => !b.includes(LONG)));
    expect(was.filter((b) => b.includes(LONG))[0]!.match(/ Tj/g)).toHaveLength(2);
    expect(now.filter((b) => b.includes(LONG))[0]!.match(/ Tj/g)).toHaveLength(1);
  });
});

function blocks(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    cur = '';
  for (const line of s.split('\n')) {
    if (!line) continue;
    cur += line + '\n';
    if (line === 'q') depth++;
    else if (line === 'Q' && --depth === 0) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}
