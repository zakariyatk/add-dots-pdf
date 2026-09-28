import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  appendPdf,
  buildPdf,
  createTextMeasurer,
  isAnnotMark,
  saveHooks,
  type AnyMark,
  type MeasureText,
  type PageItem,
  type SaveHooks,
  type Scale,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { makeFixture } from './fixtures/marks.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME, SCALE, makeModulesFixture } from './fixtures/modules.fixture.js';
import { unicodeSource } from './support/unicode';

/* Markups kept editable are saved as PDF annotations, each drawn by the same
   code that flattens it: its appearance has to be exactly what flattening
   paints onto the page. */
let measure: MeasureText;
let hooks: () => SaveHooks;
beforeAll(async () => {
  measure = await createTextMeasurer();
  hooks = () =>
    saveHooks(
      { scale: SCALE as Scale, totalPages: 3, fileName: FILE_NAME, today: '' },
      { measure, unicode: unicodeSource },
    );
});

const { PDFArray, PDFDict, PDFName, decodePDFRawStream } = PDFLib;
const latin1 = (u8: Uint8Array) => Array.from(u8, (c) => String.fromCharCode(c)).join('');
/* resource names carry a random suffix (Helvetica-123456, GS-7): not a difference */
const norm = (s: string) => s.replace(/\/([A-Za-z][A-Za-z-]*?)-\d+(?=[\s/[\]<>()]|$)/g, '/$1-#').trim();

async function allItems(): Promise<PageItem[]> {
  return [
    ...((await makeFixture(PDFLib)) as PageItem[]),
    ...((await makeModulesFixture(PDFLib)) as PageItem[]),
  ];
}

function annotsOf(doc: PDFLib.PDFDocument, page = 0): PDFLib.PDFDict[] {
  const a = doc.getPage(page).node.Annots();
  return a ? a.asArray().map((r) => doc.context.lookup(r) as PDFLib.PDFDict) : [];
}
function streamText(doc: PDFLib.PDFDocument, obj: unknown): string {
  const s = obj instanceof PDFLib.PDFRef ? doc.context.lookup(obj) : obj;
  return latin1(decodePDFRawStream(s as PDFLib.PDFRawStream).decode());
}
const name = (d: PDFLib.PDFDict, k: string) => String(d.get(PDFName.of(k)) || '');

describe('markups saved as PDF comments', () => {
  it('draws each one as flattening does, as its own annotation', async () => {
    let checked = 0;
    for (const it0 of await allItems()) {
      for (const s of it0.shapes) {
        if (!isAnnotMark(s)) continue;
        const it = { ...it0, rot: 0, crop: null, shapes: [s] } as PageItem;
        const flat = await PDFLib.PDFDocument.load(await buildPdf([it], null, {}, hooks()));
        const kept = await PDFLib.PDFDocument.load(await buildPdf([it], null, { annots: true }, hooks()));
        /* flattened: the mark's drawing is the page's last content stream */
        const c = flat.getPage(0).node.Contents() as PDFLib.PDFArray;
        const painted = streamText(flat, c.get(c.size() - 1));
        const annots = annotsOf(kept);
        expect(annots.length, s.t).toBe(1);
        const ap = (annots[0]!.get(PDFName.of('AP')) as PDFLib.PDFDict).get(PDFName.of('N'));
        expect(norm(streamText(kept, ap)), s.t).toBe(norm(painted));
        /* and the page itself is left as it was: not even wrapped in q..Q */
        const bare = await PDFLib.PDFDocument.load(
          await buildPdf([{ ...it, shapes: [] }], null, {}, hooks()),
        );
        const count = (d: PDFLib.PDFDocument) => {
          const x = d.getPage(0).node.Contents();
          return x instanceof PDFArray ? x.size() : x ? 1 : 0;
        };
        expect(count(kept), s.t).toBe(count(bare));
        /* and nothing of it is painted into the page */
        const kc = kept.getPage(0).node.Contents();
        const pageText =
          kc instanceof PDFArray
            ? kc
                .asArray()
                .map((r) => streamText(kept, r))
                .join('\n')
            : kc
              ? streamText(kept, kc)
              : '';
        expect(pageText.includes(painted.trim().slice(0, 40)), s.t).toBe(false);
        checked++;
      }
    }
    expect(checked).toBe(21);
  });

  it('records each kind as a reader expects it', async () => {
    const items = (await makeModulesFixture(PDFLib)) as PageItem[];
    const kept = await PDFLib.PDFDocument.load(await buildPdf(items, null, { annots: true }, hooks()));
    const subtypes = kept.getPages().flatMap((_, i) => annotsOf(kept, i).map((a) => name(a, 'Subtype')));
    for (const want of ['/Highlight', '/Ink', '/Text', '/Stamp', '/Circle']) expect(subtypes).toContain(want);
    const all = kept.getPages().flatMap((_, i) => annotsOf(kept, i));
    for (const a of all) {
      if (name(a, 'Subtype') === '/Link') continue;
      const rect = (a.get(PDFName.of('Rect')) as PDFLib.PDFArray)
        .asArray()
        .map((n) => (n as PDFLib.PDFNumber).asNumber());
      expect(rect[2]!).toBeGreaterThan(rect[0]!);
      expect(rect[3]!).toBeGreaterThan(rect[1]!);
      const ap = (a.get(PDFName.of('AP')) as PDFLib.PDFDict).lookup(PDFName.of('N')) as PDFLib.PDFRawStream;
      /* drawn in page coordinates over the same box */
      expect(
        ap.dict
          .lookup(PDFName.of('BBox'), PDFArray)
          .asArray()
          .map((n: PDFLib.PDFObject) => (n as PDFLib.PDFNumber).asNumber()),
      ).toEqual(rect);
      expect(name(a, 'F')).toBe('4');
    }
    const quads = all.filter((a) => /Highlight|Underline|StrikeOut/.test(name(a, 'Subtype')));
    expect(quads.length).toBeGreaterThan(0);
    for (const q of quads) expect((q.get(PDFName.of('QuadPoints')) as PDFLib.PDFArray).size() % 8).toBe(0);
    /* a note's text is the comment's */
    const notes = (items.flatMap((it) => it.shapes) as (AnyMark & { note?: { text?: string } })[]).filter(
      (s) => s.t === 'note' && s.note && s.note.text,
    );
    const texts = all
      .filter((a) => name(a, 'Subtype') === '/Text')
      .map((a) => (a.get(PDFName.of('Contents')) as PDFLib.PDFHexString | undefined)?.decodeText());
    for (const n of notes) expect(texts.some((t) => t && t.startsWith(n.note!.text!))).toBe(true);
  });

  it('keeps an arrow an arrow and a text box its words', async () => {
    const items = (await makeFixture(PDFLib)) as PageItem[];
    const kept = await PDFLib.PDFDocument.load(await buildPdf(items, null, { annots: true }, hooks()));
    const all = kept.getPages().flatMap((_, i) => annotsOf(kept, i));
    const arrows = all.filter((a) => name(a, 'Subtype') === '/Line' && a.get(PDFName.of('LE')));
    expect(arrows.length).toBeGreaterThan(0);
    const texts = all.filter((a) => name(a, 'Subtype') === '/FreeText');
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.get(PDFName.of('DA'))).toBeInstanceOf(PDFLib.PDFString);
      expect((t.get(PDFName.of('Contents')) as PDFLib.PDFHexString).decodeText().length).toBeGreaterThan(0);
    }
  });

  it('leaves everything else painted into the page', async () => {
    const items = (await makeModulesFixture(PDFLib)) as PageItem[];
    const kept = await PDFLib.PDFDocument.load(await buildPdf(items, null, { annots: true }, hooks()));
    const subtypes = new Set(
      kept.getPages().flatMap((_, i) => annotsOf(kept, i).map((a) => name(a, 'Subtype'))),
    );
    /* the fixture's links are links; measurements, pictures, watermarks are not annotations */
    expect(
      [...subtypes].every((t) =>
        ['/Highlight', '/Underline', '/StrikeOut', '/Ink', '/Text', '/Stamp', '/Circle', '/Link'].includes(t),
      ),
    ).toBe(true);
  });

  it('works when saving onto the original too', async () => {
    const items = (await makeModulesFixture(PDFLib)) as PageItem[];
    const got = await appendPdf(items, { annots: true }, hooks());
    expect(got).not.toBeNull();
    const file = new Uint8Array(got!.src.bytes.length + got!.update.length);
    file.set(got!.src.bytes);
    file.set(got!.update, got!.src.bytes.length);
    const doc = await PDFLib.PDFDocument.load(file);
    const n = doc
      .getPages()
      .reduce((k, _, i) => k + annotsOf(doc, i).filter((a) => name(a, 'Subtype') !== '/Link').length, 0);
    expect(n).toBe(items.flatMap((it) => it.shapes).filter(isAnnotMark).length);
    expect(PDFDict).toBeTruthy();
  });
});
