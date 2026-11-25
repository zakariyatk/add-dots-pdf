import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildPdf,
  createTextMeasurer,
  hasProjectMarker,
  markPlace,
  readProject,
  saveHooks,
  type AnyMark,
  type MeasureText,
  type PageItem,
} from '../src';

/* The artboard and the pasteboard: a standard PDF takes only what is on the
   page; an editable one also carries the whole document, pasteboard and all. */

let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

const BOARD = { x1: 0, y1: 0, x2: 400, y2: 300 };
const rect = (a: number[], b: number[], extra = {}) =>
  ({ t: 'rect', a, b, c: '#E2483D', w: 2, ...extra }) as unknown as AnyMark;

describe('where a mark is against the artboard', () => {
  it('on it, across its edge, or off it on the pasteboard', () => {
    expect(markPlace(rect([50, 50], [150, 120]), BOARD)).toBe('in');
    expect(markPlace(rect([350, 50], [450, 120]), BOARD)).toBe('edge');
    expect(markPlace(rect([600, 50], [700, 120]), BOARD)).toBe('out');
    expect(markPlace(rect([-300, -300], [-200, -200]), BOARD)).toBe('out');
  });
  it('a turned box, a path, text', () => {
    /* 45° turn: its corners reach past the right edge */
    expect(markPlace(rect([300, 100], [398, 198], { r: 45 }), BOARD)).toBe('edge');
    const poly = {
      t: 'poly',
      pts: [
        [500, 10],
        [520, 40],
        [560, 20],
      ],
      c: '#000',
      w: 1,
    } as unknown as AnyMark;
    expect(markPlace(poly, BOARD)).toBe('out');
    const text = {
      t: 'text',
      a: [380, 150],
      text: 'a long line of words',
      size: 14,
      c: '#000',
      f: 'helv',
    } as unknown as AnyMark;
    expect(markPlace(text, BOARD, measure)).toBe('edge');
  });
});

async function page(shapes: AnyMark[]) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([400, 300]);
  return [{ src: { id: 1, bytes: await d.save(), name: 'a.pdf' }, num: 1, rot: 0, shapes }] as PageItem[];
}
async function ops(bytes: Uint8Array) {
  const d = await PDFLib.PDFDocument.load(bytes);
  const c = d.getPage(0).node.Contents()!;
  const parts = c instanceof PDFLib.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
  return parts
    .map((p) => new TextDecoder().decode(PDFLib.decodePDFRawStream(p as PDFLib.PDFRawStream).decode()))
    .join('\n');
}

describe('a standard PDF: only the artboard', () => {
  it('leaves out a mark wholly on the pasteboard and cuts one across the edge', async () => {
    const hooks = saveHooks({}, { measure });
    const inside = await ops(await buildPdf(await page([rect([50, 50], [150, 120])]), null, {}, hooks));
    expect(inside).not.toMatch(/ W\s+n/);
    const off = await ops(
      await buildPdf(await page([rect([50, 50], [150, 120]), rect([600, 50], [700, 120])]), null, {}, hooks),
    );
    /* the one off the page is not in it at all */
    expect(off).not.toContain('600 50');
    expect((off.match(/\bre\b/g) || []).length).toBe((inside.match(/\bre\b/g) || []).length);
    const edge = await ops(await buildPdf(await page([rect([350, 50], [450, 120])]), null, {}, hooks));
    expect(edge).toMatch(/0 0 400 300 re\s+W\s+n/);
  });
  it('a crop is the artboard', async () => {
    const items = await page([rect([150, 100], [250, 160])]);
    items[0]!.crop = { x: 0, y: 0, w: 200, h: 300 };
    const o = await ops(await buildPdf(items, null, {}, saveHooks({}, { measure })));
    expect(o).toMatch(/0 0 200 300 re\s+W\s+n/);
  });
  it('the marks themselves are not changed by saving', async () => {
    const items = await page([rect([600, 50], [700, 120])]);
    const before = JSON.stringify(items[0]!.shapes);
    await buildPdf(items, null, {}, saveHooks({}, { measure }));
    expect(JSON.stringify(items[0]!.shapes)).toBe(before);
  });
});

describe('an editable PDF', () => {
  it('carries the document and its sources, and is still a plain readable PDF', async () => {
    const items = await page([rect([50, 50], [150, 120]), rect([600, 50], [700, 120])]);
    const json = JSON.stringify({ app: 'add-dots-project', items: [{ shapes: items[0]!.shapes }] });
    const bytes = await buildPdf(items, null, { project: { json } }, saveHooks({}, { measure }));
    expect(hasProjectMarker(bytes)).toBe(true);
    /* a reader sees one page, with only the artboard's mark */
    const d = await PDFLib.PDFDocument.load(bytes);
    expect(d.getPageCount()).toBe(1);
    expect(await ops(bytes)).not.toContain('600 50');
    /* this app finds the whole document in it, the pasteboard's mark too */
    const got = (await readProject(bytes))!;
    expect(got).not.toBeNull();
    expect(JSON.stringify(got.data)).toBe(json);
    const src = got.sources.get('1')!;
    expect(src.name).toBe('a.pdf');
    expect(Array.from(src.bytes)).toEqual(Array.from(items[0]!.src.bytes));
  });
  it('a plain PDF has none', async () => {
    const bytes = await buildPdf(await page([]), null, {}, saveHooks({}, { measure }));
    expect(hasProjectMarker(bytes)).toBe(false);
    expect(await readProject(bytes)).toBeNull();
  });
});
