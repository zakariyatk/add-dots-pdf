import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  appendPdf,
  buildPdf,
  createTextMeasurer,
  readXrefTail,
  saveHooks,
  type MeasureText,
  type PageItem,
  type PinLocation,
  type SaveState,
  type Scale,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest, makeFixture } from './fixtures/marks.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME, SCALE, makeModulesFixture } from './fixtures/modules.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME as PINS_NAME, makePinsFixture } from './fixtures/pins.fixture.js';
import { unicodeSource } from './support/unicode';

/* Saving onto the original (an incremental update) has to give the pages a
   rebuild gives, and leave the original's own bytes as they were. */
let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

const joined = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

/* the same items, over a source saved with a cross-reference table or stream */
async function resave(items: PageItem[], objectStreams: boolean): Promise<PageItem[]> {
  const d = await PDFLib.PDFDocument.load(items[0]!.src.bytes);
  const src = { ...items[0]!.src, bytes: await d.save({ useObjectStreams: objectStreams }) };
  return items.map((it) => ({ ...it, src }));
}

async function both(items: PageItem[], state: SaveState, opts = {}) {
  const hooks = () => saveHooks(state, { measure, unicode: unicodeSource });
  const rebuilt = await buildPdf(items, null, opts, hooks());
  const got = await appendPdf(items, opts, hooks());
  return { rebuilt, got };
}

describe('appendPdf', () => {
  for (const objectStreams of [false, true]) {
    const form = objectStreams ? 'a cross-reference stream' : 'a cross-reference table';
    it('saves every module mark as a rebuild does, onto a file with ' + form, async () => {
      const items = await resave((await makeModulesFixture(PDFLib)) as PageItem[], objectStreams);
      expect(readXrefTail(items[0]!.src.bytes)!.stream).toBe(objectStreams);
      const { rebuilt, got } = await both(items, {
        scale: SCALE as Scale,
        totalPages: items.length,
        fileName: FILE_NAME,
        today: '',
      });
      expect(got).not.toBeNull();
      const file = joined(got!.src.bytes, got!.update);
      expect(await digest(PDFLib, file)).toEqual(await digest(PDFLib, rebuilt));
      /* the update ends with its own cross-reference section, pointing back */
      const tail = readXrefTail(file)!;
      expect(tail.offset).toBeGreaterThan(items[0]!.src.bytes.length);
      expect(tail.stream).toBe(objectStreams);
      const was = readXrefTail(items[0]!.src.bytes)!;
      const text = new TextDecoder('latin1').decode(got!.update);
      expect(text).toContain('/Prev ' + was.offset);
      /* new objects are numbered past every object of the original, the
         object streams pdf-lib unpacks and does not keep included: reusing
         their numbers hid most of the pages from pdf.js and qpdf */
      const had = new Set(
        (await PDFLib.PDFDocument.load(items[0]!.src.bytes)).context
          .enumerateIndirectObjects()
          .map(([r]) => r.objectNumber),
      );
      const nums = [...text.matchAll(/(?:^|\n)(\d+) 0 obj/g)].map((m) => +m[1]!);
      expect(nums.length).toBeGreaterThan(0);
      for (const n of nums) expect(had.has(n) || n >= was.size, 'object ' + n).toBe(true);
      /* and everything it refers to is there: fonts and images are written
         by pdf-lib's flush, which a whole-file save does for it */
      const written = new Set(nums);
      for (const m of text.matchAll(/(\d+) 0 R\b/g)) {
        const n = +m[1]!;
        expect(had.has(n) || written.has(n), 'reference to object ' + n).toBe(true);
      }
    });
  }

  it('adds the photo pages and draws the pins, turned pages too', async () => {
    const { items, locs } = (await makePinsFixture(PDFLib)) as {
      items: PageItem[];
      locs: Record<string, PinLocation>;
    };
    const { rebuilt, got } = await both(items, { locs, docName: PINS_NAME }, { photos: true });
    expect(got).not.toBeNull();
    const now = await digest(PDFLib, joined(got!.src.bytes, got!.update));
    const was = await digest(PDFLib, rebuilt);
    expect(now.length).toBe(was.length);
    expect(now.length).toBeGreaterThan(items.length);
    /* the drawing pages as a rebuild draws them; the appendix pages link
       back to them by page, so their link targets differ only in form */
    expect(now.slice(0, items.length)).toEqual(was.slice(0, items.length));
    expect(now.map((p: { streams: string[] }) => p.streams)).toEqual(
      was.map((p: { streams: string[] }) => p.streams),
    );
  });

  it('keeps the original bytes and what a rebuild drops (bookmarks)', async () => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([300, 300]);
    d.addPage([300, 300]);
    /* a one-entry outline, pointing at page 2 */
    const ctx = d.context;
    const outlines = ctx.nextRef();
    const entry = ctx.register(
      ctx.obj({
        Title: PDFLib.PDFHexString.fromText('Doors'),
        Parent: outlines,
        Dest: [d.getPage(1).ref, 'Fit'],
      }),
    );
    ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: entry, Last: entry, Count: 1 }));
    d.catalog.set(PDFLib.PDFName.of('Outlines'), outlines);
    const src = { id: 1, name: 'b.pdf', bytes: await d.save({ useObjectStreams: false }) };
    const items: PageItem[] = [1, 2].map((num) => ({
      src,
      num,
      rot: 0,
      shapes: [{ t: 'rect', a: [20, 20], b: [120, 80], c: '#E2483D', w: 2 }],
    })) as PageItem[];
    const got = await appendPdf(items, {}, saveHooks({ meta: { title: 'Plan' } }, { measure }));
    expect(got).not.toBeNull();
    const file = joined(src.bytes, got!.update);
    const out = await PDFLib.PDFDocument.load(file);
    expect(out.catalog.get(PDFLib.PDFName.of('Outlines'))).toBeTruthy();
    expect(out.getTitle()).toBe('Plan');
    /* a few kilobytes, not a second copy */
    expect(got!.update.length).toBeLessThan(src.bytes.length + 8000);
    const rebuilt = await PDFLib.PDFDocument.load(
      await buildPdf(items, null, {}, saveHooks({ meta: { title: 'Plan' } }, { measure })),
    );
    expect(rebuilt.catalog.get(PDFLib.PDFName.of('Outlines'))).toBeFalsy();
  });

  it('leaves to a rebuild pages reordered, repeated or from more than one file', async () => {
    const items = (await makeFixture(PDFLib)) as PageItem[];
    expect(await appendPdf(items, {}, saveHooks({}, { measure }))).toBeNull();
    const mods = (await makeModulesFixture(PDFLib)) as PageItem[];
    expect(await appendPdf([mods[1]!, mods[0]!, mods[2]!], {}, saveHooks({}, { measure }))).toBeNull();
    expect(await appendPdf(mods.slice(0, 2), {}, saveHooks({}, { measure }))).toBeNull();
  });

  it('leaves to a rebuild a file with form fields', async () => {
    const d = await PDFLib.PDFDocument.create();
    const p = d.addPage([300, 300]);
    d.getForm().createTextField('name').addToPage(p, { x: 20, y: 20, width: 100, height: 20 });
    const src = { id: 1, bytes: await d.save() };
    expect(await appendPdf([{ src, num: 1, rot: 0, shapes: [] }], {}, saveHooks({}, { measure }))).toBeNull();
  });

  it('finds no cross-reference in bytes that end without one', () => {
    expect(readXrefTail(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'))).toBeNull();
  });
});
