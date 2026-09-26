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

  /* Page 4 repeats page 1 of source A. v1 printed page 1's marks on it too (see
     "a page used twice" below), so it is the one deliberate difference: it now
     carries only its own source content. */
  const REPEATED_PAGE = 4;

  it.each(golden.map((g, i) => [i + 1, g] as const).filter(([n]) => n !== REPEATED_PAGE))(
    'page %i: content streams',
    (n, g) => {
      expect(pages[n - 1]!.streams).toEqual(g.streams);
    },
  );

  it('page 4 (a repeat of page 1): only its own content, none of page 1’s marks', () => {
    const sourceContent = golden[0]!.streams[1]!; // page 1's original content, before marks
    expect(pages[REPEATED_PAGE - 1]!.streams).toEqual([sourceContent]);
  });
});

describe('a page used twice (Duplicate)', () => {
  /* v1 bug: when a source page already had content, pdf-lib handed both copies
     the same content list, so a mark on one copy printed on both. */
  it('keeps each copy’s marks on that copy only', async () => {
    const src = await PDFLib.PDFDocument.create();
    const f = await src.embedFont(PDFLib.StandardFonts.Helvetica);
    src.addPage([595.28, 841.89]).drawText('Existing content', { x: 60, y: 780, size: 18, font: f });
    const source = { id: 'dup', bytes: await src.save() };
    const box = { t: 'rect', a: [300, 500], b: [400, 560], c: '#E2483D', w: 1 } as const;

    const items: PageItem[] = [
      { src: source, num: 1, rot: 0, shapes: [] },
      { src: source, num: 1, rot: 0, shapes: [{ ...box, a: [300, 500], b: [400, 560] }] },
    ];
    const [original, copy] = (await digest(
      PDFLib,
      await buildPdf(items, null, {}, { measure }),
    )) as PageDigest[];
    const boxAt = '1 0 0 1 300 500 cm';
    expect(copy!.streams.join('')).toContain(boxAt);
    expect(original!.streams.join('')).not.toContain(boxAt);
  });
});
