/* Viewer smoke test: checks, in the built app and a real browser, the
   behaviour the performance work depends on and could break.

     npm run build && npm run smoke -w @adddots/web

   Pages load lazily (page 1 is drawn before the others are loaded, and each
   takes its real size when it arrives), so it checks sizes and order on a
   document of mixed page sizes, jumping, thumbnails, search, zooming far and
   near pages, opening a second file (the first is closed on the shared pdf.js
   worker), saving, cropping every page before they are all loaded, and that a
   form value the file already held is saved even when saving at once. Exits
   non-zero if any check fails. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDocument, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

const PORT = 4176;
const URL = 'http://localhost:' + PORT + '/';
let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
};

/* 60 pages in five sizes, some turned by the file itself */
async function mixedPdf() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const sizes = [
    [595, 842],
    [2384, 1684],
    [612, 792],
    [595, 842],
    [400, 1200],
  ];
  for (let i = 0; i < 60; i++) {
    const sz = sizes[i % sizes.length];
    const p = d.addPage(sz);
    if (i % 7 === 3) p.setRotation(degrees(90));
    p.drawText('Page ' + (i + 1) + ' engineer', { x: 40, y: sz[1] - 60, size: 24, font: f });
  }
  return d.save();
}

/* 400 pages, with a filled-in text field on the last one */
async function prefilledPdf() {
  const d = await PDFDocument.create();
  for (let i = 0; i < 400; i++) d.addPage([595, 842]);
  const t = d.getForm().createTextField('last');
  t.setText('Prefilled on page 400');
  t.addToPage(d.getPage(399), { x: 60, y: 700, width: 300, height: 20 });
  return d.save();
}

async function fresh(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
  return { ctx, page, errors };
}
const open = async (page, path) => {
  await page.setInputFiles('#fileIn', path);
  await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
    timeout: 60000,
  });
};
const allLoaded = (page) =>
  page.waitForFunction(() => window.ADDPDF.S.items.every((i) => i.page && !i.estimated), null, {
    timeout: 120000,
  });
/* every page's box matches its real size at the current zoom */
const misSized = (page) =>
  page.evaluate(() => {
    const S = window.ADDPDF.S;
    return S.items
      .map((it, i) => {
        const v = it.page.getViewport({ scale: S.scale, rotation: it.page.rotate + it.rot });
        const off =
          Math.abs(it.wrap.offsetWidth - Math.floor(v.width)) > 1 ||
          Math.abs(it.wrap.offsetHeight - Math.floor(v.height)) > 1;
        return off ? i + 1 : 0;
      })
      .filter(Boolean);
  });

await ensureCorpus();
const MIXED = join(CORPUS_DIR, 'smoke-mixed-60p.pdf');
const PREFILLED = join(CORPUS_DIR, 'smoke-prefilled-400p.pdf');
writeFileSync(MIXED, await mixedPdf());
writeFileSync(PREFILLED, await prefilledPdf());

const server = await serve(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), PORT);
const browser = await chromium.launch({ channel: process.env.BENCH_CHANNEL || undefined });
try {
  /* ---- a document of mixed sizes ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await open(page, MIXED);
    const loaded = await page.evaluate(() => window.ADDPDF.S.items.filter((i) => i.page).length);
    check('page 1 is drawn before every page is loaded', loaded < 60, { loadedAtFirstPaint: loaded });
    await allLoaded(page);
    await page.waitForTimeout(300);
    check(
      'every page takes its real size once loaded',
      (await misSized(page)).length === 0,
      await misSized(page),
    );
    const order = await page.evaluate(() =>
      window.ADDPDF.S.items.every(
        (it, i, a) => i === 0 || it.box.offsetTop >= a[i - 1].box.offsetTop + a[i - 1].box.offsetHeight - 1,
      ),
    );
    check('pages stand in order without overlapping', order);

    await page.evaluate(() => window.ADDPDF.goTo(47));
    await page
      .waitForFunction(() => window.ADDPDF.S.items[46].rendered, null, { timeout: 10000 })
      .catch(() => {});
    check('a jump draws the page jumped to', await page.evaluate(() => window.ADDPDF.S.items[46].rendered));
    await page.waitForTimeout(1500);
    const thumbs = await page.evaluate(
      () => window.ADDPDF.S.items.filter((i) => i.thumbDone && i.thumbCanvas.width > 1).length,
    );
    check('thumbnails are drawn near the visible part of the rail', thumbs > 0, { thumbs });

    await page.click('#btnFind');
    await page.fill('#findIn', 'engineer');
    await page.waitForFunction(() => /match/.test(document.getElementById('hitCount').textContent), null, {
      timeout: 30000,
    });
    check(
      'search reads every page',
      /^60 matches/.test(await page.textContent('#hitCount')),
      await page.textContent('#hitCount'),
    );

    /* zoom in and out on page 30: every page, near or far, at the new zoom, page 30 still on screen */
    await page.evaluate(() => window.ADDPDF.goTo(30));
    await page.waitForFunction(() => window.ADDPDF.S.current === 30, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    for (let i = 0; i < 3; i++) await page.click('#btnIn');
    await page.waitForTimeout(1200);
    for (let i = 0; i < 2; i++) await page.click('#btnOut');
    await page.waitForTimeout(1500);
    check(
      'after zooming, every page is at the new size',
      (await misSized(page)).length === 0,
      await misSized(page),
    );
    const cur = await page.evaluate(() => window.ADDPDF.S.current);
    check('after zooming, the page being read is still on screen', Math.abs(cur - 30) <= 1, { current: cur });

    /* ---- a second file: the first is closed on the shared worker ---- */
    await open(page, join(CORPUS_DIR, 'medium-report-300p.pdf'));
    check(
      'a second file opens at page 1',
      await page.evaluate(() => document.getElementById('stage').scrollTop < 50),
    );
    await page.evaluate(() => window.ADDPDF.goTo(150));
    await page
      .waitForFunction(() => window.ADDPDF.S.items[149].rendered, null, { timeout: 10000 })
      .catch(() => {});
    check(
      'the second file draws after the first was closed',
      await page.evaluate(() => window.ADDPDF.S.items[149].rendered),
    );
    check('one pdf.js worker for both files', page.workers().length === 1, {
      workers: page.workers().length,
    });
    await page.click('#btnSave');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('#saveGo'),
    ]);
    const saved = await PDFDocument.load(readFileSync(await dl.path()));
    check('saving the second file keeps all 300 pages', saved.getPageCount() === 300, saved.getPageCount());
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- operations on every page, before they are all loaded ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await open(page, join(CORPUS_DIR, 'large-text-2000p.pdf'));
    const loaded = await page.evaluate(() => window.ADDPDF.S.items.filter((i) => i.page).length);
    await page.evaluate(() => window.ADDPDF.setTool('crop'));
    const box = await page.evaluate(() => {
      const r = window.ADDPDF.S.items[0].wrap.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 40, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w - 40, box.y + box.h / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page
      .waitForFunction(() => window.ADDPDF.S.items[1999].crop, null, { timeout: 60000 })
      .catch(() => {});
    const cropped = await page.evaluate(() => window.ADDPDF.S.items.filter((i) => i.crop).length);
    check('cropping every page reaches pages not loaded yet', cropped === 2000, {
      loadedWhenCropped: loaded,
      cropped,
    });

    await open(page, PREFILLED);
    await page.click('#btnSave');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('#saveGo'),
    ]);
    const out = await PDFDocument.load(readFileSync(await dl.path()));
    const last = out.getPage(399);
    const c = last.node.Contents();
    const refs = c instanceof PDFArray ? c.asArray() : [c];
    const text = refs
      .map((r) => Buffer.from(decodePDFRawStream(out.context.lookup(r)).decode()).toString('latin1'))
      .join('');
    const want = Buffer.from('Prefilled on page 400').toString('hex').toUpperCase();
    check('a value the file already held is saved, even saving at once', text.includes(want));
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
