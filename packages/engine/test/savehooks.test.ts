import * as PDFLib from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  annotateFontNeeds,
  annotatePainters,
  buildPdf,
  createTextMeasurer,
  docopsFontNeeds,
  docopsPainters,
  docopsPrepare,
  drawFontNeeds,
  drawPainters,
  fieldsFinish,
  formsPainters,
  insertPainters,
  leaderPainters,
  pinHooks,
  prepareInsert,
  prepareSignatures,
  saveHooks,
  type FieldValues,
  type MeasureText,
  type PageItem,
  type PinLocation,
  type SaveHooks,
  type Scale,
} from '../src';
// @ts-expect-error plain JS fixture shared with the browser
import { digest } from './fixtures/marks.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME, SCALE, makeModulesFixture } from './fixtures/modules.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { makeFormsFixture } from './fixtures/forms.fixture.js';
// @ts-expect-error plain JS fixture shared with the browser
import { FILE_NAME as PINS_NAME, makePinsFixture } from './fixtures/pins.fixture.js';
import { unicodeSource } from './support/unicode';

/* saveHooks builds, from plain data, the hooks the feature modules used to
   register one by one (annotate, draw, forms, insert, enhance, docops):
   the pages it saves must be the same. */
let measure: MeasureText;
beforeAll(async () => {
  measure = await createTextMeasurer();
});

/* as core.js assembled them from the modules' registrations */
function moduleHooks(items: PageItem[], extra: Partial<SaveHooks> = {}): SaveHooks {
  const doc = { totalPages: () => items.length, fileName: () => FILE_NAME, today: () => '' };
  return {
    measure,
    unicode: unicodeSource,
    fontNeeds: { ...annotateFontNeeds, ...drawFontNeeds, ...docopsFontNeeds },
    shapePainters: {
      ...annotatePainters,
      ...drawPainters(() => SCALE as Scale),
      ...formsPainters,
      ...insertPainters,
      ...leaderPainters,
      ...docopsPainters(doc),
    },
    prepare: [prepareSignatures, prepareInsert, docopsPrepare(doc)],
    ...extra,
  };
}

describe('saveHooks', () => {
  it('saves the module marks as the modules did', async () => {
    const items = (await makeModulesFixture(PDFLib)) as PageItem[];
    const was = await digest(PDFLib, await buildPdf(items, null, {}, moduleHooks(items)));
    const hooks = saveHooks(
      { scale: SCALE as Scale, totalPages: items.length, fileName: FILE_NAME, today: '' },
      { measure, unicode: unicodeSource },
    );
    const now = await digest(PDFLib, await buildPdf(items, null, {}, hooks));
    expect(now).toEqual(was);
  });

  it('writes the form values as forms.js did', async () => {
    const { items, values } = (await makeFormsFixture(PDFLib)) as { items: PageItem[]; values: FieldValues };
    const was = await digest(
      PDFLib,
      await buildPdf(items, null, {}, moduleHooks(items, { finish: [fieldsFinish(() => values)] })),
    );
    const now = await digest(
      PDFLib,
      await buildPdf(items, null, {}, saveHooks({ values }, { measure, unicode: unicodeSource })),
    );
    expect(now).toEqual(was);
  });

  it('draws the photo pins and their pages as core.js did', async () => {
    const { items, locs } = (await makePinsFixture(PDFLib)) as {
      items: PageItem[];
      locs: Record<string, PinLocation>;
    };
    const pins = pinHooks(locs, { docName: () => PINS_NAME });
    const was = await digest(PDFLib, await buildPdf(items, null, { photos: true }, { measure, pins }));
    const now = await digest(
      PDFLib,
      await buildPdf(items, null, { photos: true }, saveHooks({ locs, docName: PINS_NAME }, { measure })),
    );
    expect(now).toEqual(was);
  });

  it('writes the document details', async () => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([200, 200]);
    const src = { id: 1, bytes: await d.save() };
    const hooks = saveHooks(
      { meta: { title: 'Plan', author: 'Zak', subject: 'Doors', keywords: 'door, frame; site' } },
      { measure },
    );
    const out = await PDFLib.PDFDocument.load(
      await buildPdf([{ src, num: 1, rot: 0, shapes: [] }], null, {}, hooks),
    );
    expect(out.getTitle()).toBe('Plan');
    expect(out.getAuthor()).toBe('Zak');
    expect(out.getSubject()).toBe('Doors');
    expect(out.getKeywords()).toBe('door frame site');
  });

  it('takes only plain data, so it can be posted to a worker', () => {
    const state = {
      scale: SCALE as Scale,
      values: { a: 'b' },
      meta: { title: 't' },
      totalPages: 3,
      locs: {},
    };
    expect(structuredClone(state)).toEqual(state);
  });
});
