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

  it('page dimensions: content streams identical to v1', () => {
    expect(pages[1]!.streams.map(roundNums)).toEqual(golden[1]!.streams.map(roundNums));
  });

  it.each(golden.map((g, i) => [LABELS[i], i, g] as const))('page %s: link annotations', (_, i, g) => {
    expect(pages[i]!.annots).toEqual(g.annots);
  });
});

/* Pages 1 and 3 hold marks whose v1 output was wrong (see painters.fixes.test).
   Each page is split into its top-level q..Q drawing blocks, one per drawing
   call, and the only blocks allowed to differ from v1 are those marks'. */
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
function changes(i: number): { removed: string[]; added: string[] } {
  const now = blocks(roundNums(pages[i]!.streams.join('')));
  const was = blocks(roundNums(golden[i]!.streams.join('')));
  const tally = (arr: string[]) => {
    const m = new Map<string, number>();
    arr.forEach((b) => m.set(b, (m.get(b) || 0) + 1));
    return m;
  };
  const cn = tally(now),
    cw = tally(was);
  const removed: string[] = [],
    added: string[] = [];
  cw.forEach((n, b) => {
    for (let k = n - (cn.get(b) || 0); k > 0; k--) removed.push(b);
  });
  cn.forEach((n, b) => {
    for (let k = n - (cw.get(b) || 0); k > 0; k--) added.push(b);
  });
  return { removed, added };
}

describe('module painters: the only differences from v1 are the fixed marks', () => {
  it('page annotate, draw and leader: the dashed filled circle, the dotted arc and the leader arrowhead', () => {
    const { removed, added } = changes(0);
    const arcDots = (b: string) => b.includes('[2 4.4] '); // the dotted 2pt arc
    /* removed: the dashed circle v1 saved as a solid native ellipse, the
       arrowhead v1 drew in SVG space (below the page), and 63 of the arc's 64
       segments, whose dots v1 restarted at 0 each time (the first still is) */
    expect(removed).toHaveLength(2 + 63);
    expect(removed.filter((b) => / c\n/.test(b) && b.includes('[] 0 d'))).toHaveLength(1);
    expect(removed.filter((b) => b.includes('480 300 l'))).toHaveLength(1);
    expect(removed.filter(arcDots).every((b) => b.includes('[2 4.4] 0 d'))).toBe(true);
    expect(removed.filter(arcDots)).toHaveLength(63);
    /* added: the circle's fill and its 96 dashed segments, the arrowhead at the
       tip, and the arc's segments with the dots carried on */
    expect(added).toHaveLength(98 + 63);
    expect(added.filter((b) => b.includes('[4 3] ') && /\nS\n/.test(b))).toHaveLength(96);
    expect(added.filter((b) => b.includes('480 -300 l'))).toHaveLength(1);
    expect(added.filter((b) => b.includes('\nf\n') && !b.includes('480 -300 l'))).toHaveLength(1);
    expect(added.filter(arcDots)).toHaveLength(63);
    expect(added.filter(arcDots).some((b) => b.includes('[2 4.4] 0 d'))).toBe(false);
  });

  it('page docops, insert and signature: only the long table cell', () => {
    const { removed, added } = changes(2);
    const hex = (b: string) => /<([0-9A-F]+)> Tj/.exec(b)![1]!;
    const text = (h: string) =>
      h
        .match(/../g)!
        .map((x) => String.fromCharCode(parseInt(x, 16)))
        .join('');
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(text(hex(removed[0]!))).toBe('Door D1 including a very'); // v1: cut at 24 characters
    expect(text(hex(added[0]!))).toMatch(/^Door D1 including a very .*\x85$/); // fitted, with an ellipsis
  });
});
