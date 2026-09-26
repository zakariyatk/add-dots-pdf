import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  crc32,
  formatRanges,
  parseRangeGroups,
  parseRanges,
  rangeTag,
  splitEach,
  splitEvery,
  zipStore,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { everyCases, zipCase } from './fixtures/pages.fixture.js';

/* pages.v1.json holds what v1's own functions returned, recorded in the
   browser: core.js's parseRanges/formatRanges/rangeTag/crc32/zipStore (taken
   from its source, with the clock fixed) and organize.js's split parser. */
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/pages.v1.json', import.meta.url)), 'utf8'),
) as {
  ranges: { text: string; n: number; pages: number[]; groups: number[][] }[];
  lists: { nums: number[]; formatted: string; tag: string }[];
  zip: { length: number; base64: string; crcs: number[] };
};

describe('page ranges match v1 (golden)', () => {
  it(`parseRanges: ${golden.ranges.length} typed and random inputs`, () => {
    for (const c of golden.ranges)
      expect(parseRanges(c.text, c.n), JSON.stringify(c.text) + ' of ' + c.n).toEqual(c.pages);
  });

  it(`split ranges: ${golden.ranges.length} typed and random inputs`, () => {
    for (const c of golden.ranges)
      expect(parseRangeGroups(c.text, c.n), JSON.stringify(c.text) + ' of ' + c.n).toEqual(c.groups);
  });

  it(`formatRanges and rangeTag: ${golden.lists.length} lists`, () => {
    for (const c of golden.lists) {
      expect(formatRanges(c.nums)).toBe(c.formatted);
      expect(rangeTag(c.nums)).toBe(c.tag);
    }
  });
});

describe('zip matches v1 (golden)', () => {
  const zc = zipCase();
  const when = new Date(zc.when[0], zc.when[1], zc.when[2], zc.when[3], zc.when[4], zc.when[5]);

  it('crc32', () => {
    expect(zc.files.map((f: { data: Uint8Array }) => crc32(f.data))).toEqual(golden.zip.crcs);
  });

  it('byte-for-byte', () => {
    const bytes = zipStore(zc.files, when);
    expect(bytes.length).toBe(golden.zip.length);
    expect(Buffer.from(bytes).toString('base64')).toBe(golden.zip.base64);
  });
});

describe('split groups', () => {
  /* v1: Math.max(1, parseInt(k) || 1) pages per file, the last one shorter */
  const cases = (everyCases() as { n: number; k: number }[]).map((c) => [c.n, c.k] as [number, number]);
  it.each(cases)('%i pages, every %i', (n: number, k: number) => {
    const groups = splitEvery(n, String(k));
    const step = Math.max(1, k || 1);
    expect(groups.flat()).toEqual(Array.from({ length: n }, (_, i) => i));
    groups.slice(0, -1).forEach((g) => expect(g).toHaveLength(step));
    expect(groups.at(-1)!.length).toBeLessThanOrEqual(step);
  });

  it('unreadable "every" means one page per file', () => {
    expect(splitEvery(3, 'x')).toEqual([[0], [1], [2]]);
    expect(splitEvery(3, '-2')).toEqual([[0], [1], [2]]);
  });

  it('each page on its own', () => {
    expect(splitEach(3)).toEqual([[0], [1], [2]]);
  });
});
