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
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';
import { PDFArray, PDFDocument, PDFName, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { digest } from '../../../packages/engine/test/fixtures/marks.fixture.js';
import { makeModulesFixture } from '../../../packages/engine/test/fixtures/modules.fixture.js';
import { makePinsFixture } from '../../../packages/engine/test/fixtures/pins.fixture.js';
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

/* two columns of text, the first page drawn column by column, the second
   row by row (left line, then right line), each line in two runs */
async function columnsPdf() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const rowMajor of [false, true]) {
    const p = d.addPage([595, 842]);
    const lines = [];
    for (let c = 0; c < 2; c++) for (let i = 0; i < 20; i++) lines.push({ c, i });
    if (rowMajor) lines.sort((a, b) => a.i - b.i || a.c - b.c);
    for (const { c, i } of lines) {
      const x = 50 + c * 270,
        y = 780 - i * 18;
      const head = (c ? 'Right' : 'Left') + ' line ' + (i + 1) + ' of the column text';
      p.drawText(head, { x, y, size: 11, font: f });
      p.drawText('tail' + (i + 1), { x: x + f.widthOfTextAtSize(head + ' ', 11), y, size: 11, font: f });
    }
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

/* in the page: page 1's detail against pdf.js drawing the same part there,
   as the share of pixels that differ clearly */
async function detailDiff() {
  const it = window.ADDPDF.S.items[0],
    d = it.detail;
  const dpr = d.width / parseFloat(d.style.width);
  const x = parseFloat(d.style.left),
    y = parseFloat(d.style.top);
  const ref = document.createElement('canvas');
  ref.width = d.width;
  ref.height = d.height;
  await it.page.render({
    canvasContext: ref.getContext('2d', { alpha: false }),
    viewport: it.vp,
    transform: [dpr, 0, 0, dpr, -x * dpr, -y * dpr],
  }).promise;
  const pa = d.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  const pb = ref.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  let off = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 48)
      off++;
  }
  return { engine: it.detailEngine, percentOff: +((100 * off) / (pa.length / 4)).toFixed(3) };
}

/* in the page: page 1 is drawn at this zoom and its detail covers the screen */
function detailSharp() {
  const it = window.ADDPDF.S.items[0];
  return (
    !document.body.classList.contains('zooming') &&
    !!it.detail &&
    it.detail.isConnected &&
    it.detailKey === it.vp.scale + '/' + it.vp.rotation
  );
}

async function fresh(browser, query = '') {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL + query);
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
  return { ctx, page, errors };
}
/* waits for the new file's page 1: with a file already open, its page 1 is
   drawn from the start, and the new one takes a moment to replace it */
const open = async (page, path) => {
  await page.evaluate(() => (window.__before = window.ADDPDF.S.items[0] || null));
  await page.setInputFiles('#fileIn', path);
  await page.waitForFunction(
    () => {
      const it = window.ADDPDF.S.items[0];
      return it && it !== window.__before && it.rendered;
    },
    null,
    { timeout: 60000 },
  );
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
          Math.abs(it.box.offsetWidth - Math.floor(v.width)) > 1 ||
          Math.abs(it.box.offsetHeight - Math.floor(v.height)) > 1;
        return off ? i + 1 : 0;
      })
      .filter(Boolean);
  });

/* draws a box on page 1 and picks it up: the bar under it (Edit, Copy,
   Delete) shows, Copy places a copy, Delete takes it away and the bar goes */
async function selBarCheck(page, label) {
  await page.evaluate(() => window.ADDPDF.goTo(1));
  await page.waitForTimeout(300);
  const at = await page.evaluate(() => {
    const r = window.ADDPDF.S.items[0].anno.getBoundingClientRect();
    return { x: r.left + r.width * 0.3, y: Math.max(r.top, 0) + 140 };
  });
  await page.evaluate(() => window.ADDPDF.setTool('rect'));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 100, at.y + 70, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() => window.ADDPDF.setTool('select'));
  const n0 = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
  /* on the box's top edge: the line is the mark (its inside is the page) */
  const edge = await page.evaluate((n) => {
    const r = window.ADDPDF.S.items[0].anno.children[n - 1].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top, bottom: r.bottom };
  }, n0);
  await page.mouse.click(edge.x, edge.y);
  await page.waitForTimeout(300);
  const bar = await page.evaluate(() => {
    const el = document.getElementById('selBar');
    const r = el.getBoundingClientRect();
    return {
      shown: !el.hidden && r.height > 30,
      top: r.top,
      edit: !document.getElementById('sbEdit').hidden,
    };
  });
  await page.click('#sbCopy');
  const copied = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
  await page.click('#sbDel');
  const after = await page.evaluate(() => ({
    n: window.ADDPDF.S.items[0].shapes.length,
    hidden: document.getElementById('selBar').hidden,
  }));
  /* and the box itself, the same way, so the page is as it was */
  await page.mouse.click(edge.x, edge.y);
  await page.waitForTimeout(200);
  await page.click('#sbDel');
  const left = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
  check(
    label + 'a picked-up mark has Edit, Copy and Delete under it: Copy places a copy, Delete removes it',
    bar.shown &&
      bar.top >= edge.bottom &&
      !bar.edit &&
      copied === n0 + 1 &&
      after.n === n0 &&
      after.hidden &&
      left === n0 - 1,
    { n0, edge, bar, copied, after, left },
  );
}

await ensureCorpus();
const MIXED = join(CORPUS_DIR, 'smoke-mixed-60p.pdf');
const PREFILLED = join(CORPUS_DIR, 'smoke-prefilled-400p.pdf');
writeFileSync(MIXED, await mixedPdf());
writeFileSync(PREFILLED, await prefilledPdf());
const COLUMNS = join(CORPUS_DIR, 'smoke-columns.pdf');
writeFileSync(COLUMNS, await columnsPdf());
/* the CAD sheets, the first turned a quarter by the file itself (/Rotate) */
const TURNED = join(CORPUS_DIR, 'smoke-cad-turned.pdf');
{
  const d = await PDFDocument.load(readFileSync(join(CORPUS_DIR, 'cad-a1-8sheets.pdf')));
  d.getPage(0).setRotation(degrees(90));
  writeFileSync(TURNED, await d.save());
}

const server = await serve(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), PORT);
const browser = await chromium.launch({ channel: process.env.BENCH_CHANNEL || undefined });
/* the checks below use the app without an account: sign-in is not required
   in them (js/config.js requireSignIn) unless a test sets it again. The
   sign-in page itself has its own check, with the accounts. */
{
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const c = await newContext(opts);
    await c.addInitScript(() => {
      window.ADDDOTS_CONFIG = Object.assign({ requireSignIn: false }, window.ADDDOTS_CONFIG || {});
    });
    return c;
  };
}
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

    /* the zoom pill over the pages zooms like the ribbon's buttons */
    const z0 = await page.evaluate(() => window.ADDPDF.S.scale);
    await page.click('#zpIn');
    await page.waitForFunction((z) => window.ADDPDF.S.scale > z * 1.1, z0, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const zoomed = await page.evaluate(() => ({
      scale: window.ADDPDF.S.scale,
      pill: document.getElementById('zpVal').textContent,
      ribbon: document.getElementById('zoomVal').textContent,
    }));
    check(
      'the zoom pill zooms in, and shows the level the ribbon shows',
      zoomed.scale > z0 * 1.1 && zoomed.pill === zoomed.ribbon,
      { z0, ...zoomed },
    );
    await page.click('#zpFit');
    await page.waitForTimeout(400);
    await selBarCheck(page, '');

    /* the top bar stays one row, down to a tablet: the tabs scroll instead */
    const rows = {};
    for (const width of [1440, 1100, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      /* on one row when Save and Home share some of their height */
      rows[width] = await page.evaluate(() => {
        const a = document.getElementById('btnHome').getBoundingClientRect();
        const b = document.getElementById('btnSave').getBoundingClientRect();
        return b.top < a.bottom && a.top < b.bottom;
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    check('the top bar stays on one row at 1440, 1100 and 800 px', Object.values(rows).every(Boolean), rows);

    /* the panel on the right: the page being read, and Download & share */
    const insp = await page.evaluate(() => ({
      shown: !document.getElementById('insp').hidden,
      title: document.getElementById('inspPgTitle').textContent,
      tickedOff: (() => {
        document.querySelector('#insp .iseg [data-k="sel"]').click();
        const off = document.getElementById('inspGo').disabled;
        document.querySelector('#insp .iseg [data-k="pdf"]').click();
        return off;
      })(),
    }));
    await page.click('#inspRotR');
    const turned = await page.evaluate(() => window.ADDPDF.S.items[window.ADDPDF.S.current - 1].rot);
    await page.click('#inspRotL');
    await page.click('#inspGo');
    const savePop = await page.evaluate(() => !document.getElementById('savePop').hidden);
    await page.evaluate(() => window.ADDPDF.closePops());
    const w0 = await page.evaluate(() => document.getElementById('stage').clientWidth);
    await page.click('#inspClose');
    await page.waitForTimeout(300);
    const closedP = await page.evaluate(() => ({
      hidden: document.getElementById('insp').hidden,
      wider: document.getElementById('stage').clientWidth,
    }));
    await page.click('#ribView');
    await page.click('#btnInsp');
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => !document.getElementById('insp').hidden);
    check(
      'the right panel: names the page, turns it, opens Save, closes and comes back',
      insp.shown &&
        /^Page \d+ of 60$/.test(insp.title) &&
        insp.tickedOff &&
        turned === 90 &&
        savePop &&
        closedP.hidden &&
        closedP.wider > w0 + 200 &&
        back,
      { insp, turned, savePop, w0, closedP, back },
    );

    /* drawing: the quick colour dots and line weights set the tool's colour and width */
    const was = await page.evaluate(() => ({ c: window.ADDPDF.S.color, w: window.ADDPDF.S.width }));
    await page.click('#ribDraw');
    await page.click('#tRect');
    await page.click('#swatches .sw.quick[data-c="#3B82F6"]');
    await page.click('.wdquick button[data-w="3"]');
    const quickPick = await page.evaluate(() => ({
      color: window.ADDPDF.S.color,
      width: window.ADDPDF.S.width,
      dotOn: document.querySelector('#swatches .sw.quick[data-c="#3B82F6"]').classList.contains('on'),
      drop: document.getElementById('wdDrop').textContent,
      chipOn: document.querySelector('.wdquick button[data-w="3"]').getAttribute('aria-pressed'),
    }));
    await page.evaluate((w) => {
      const X = window.ADDPDF;
      X.S.color = w.c;
      X.S.width = w.w;
      X.setTool('select');
      X.setRibbon('ribView');
    }, was);
    check(
      'drawing: a quick colour dot and a quick line weight set the tool',
      quickPick.color === '#3B82F6' &&
        quickPick.width === 3 &&
        quickPick.dotOn &&
        /3 pt/.test(quickPick.drop) &&
        quickPick.chipOn === 'true',
      quickPick,
    );

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
    /* a zoom the moment after a jump, while the stage still glides there:
       it used to stop the glide partway (page 8 for a jump to page 30) */
    await page.evaluate(() => window.ADDPDF.goTo(45));
    await page.click('#btnIn');
    await page.waitForTimeout(1500);
    const landed = await page.evaluate(() => window.ADDPDF.S.current);
    check('a zoom straight after a jump lands on the page jumped to', landed === 45, { current: landed });

    /* ---- a second file: the first is closed on the shared worker ---- */
    const workersBefore = page.workers().length;
    await open(page, join(CORPUS_DIR, 'medium-report-300p.pdf'));
    /* the rail builds only the thumbnails near view, a second file too: its
       thumbnails, not yet sized, all stood at one spot and every one was
       built, tools and all (46,000 elements for 2,000 pages) */
    const built = () => page.evaluate(() => window.ADDPDF.S.items.filter((i) => i.thumbTools).length);
    const hidden = await built();
    /* the search tab covers the rail; back to its pages */
    await page.click('#tabPages');
    await page.waitForTimeout(1000);
    const shown = await built();
    check('a second file builds only the thumbnails near view', hidden <= 60 && shown > 0 && shown <= 60, {
      builtWhileSearchCovers: hidden,
      builtOnceShown: shown,
    });
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
    /* pdf.js's parser, the render worker and the render worker's own parser,
       and the save worker */
    check(
      'no new workers for the second file',
      page.workers().length === workersBefore && workersBefore <= 4,
      {
        before: workersBefore,
        after: page.workers().map((w) => w.url().replace(/^.*\//, '')),
      },
    );
    await page.click('#btnSave');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('#saveGo'),
    ]);
    const saved = await PDFDocument.load(readFileSync(await dl.path()));
    check('saving the second file keeps all 300 pages', saved.getPageCount() === 300, saved.getPageCount());

    /* a word found hundreds of times: the list is written a chunk at a time */
    await page.keyboard.press('Escape');
    await page.click('#btnFind');
    await page.fill('#findIn', 'engineer');
    await page.waitForFunction(() => /matches/.test(document.getElementById('hitCount').textContent), null, {
      timeout: 60000,
    });
    const found = await page.evaluate(() => ({
      matches: window.ADDPDF.S.hits.length,
      rows: document.querySelectorAll('#hitList .hit-item').length,
    }));
    check(
      'hundreds of matches: the list starts with the first 150 rows',
      found.matches > 300 && found.rows === 150,
      found,
    );
    await page.evaluate(() => {
      const r = document.getElementById('railFind');
      r.scrollTop = r.scrollHeight;
    });
    await page.waitForTimeout(300);
    const more = await page.evaluate(() => document.querySelectorAll('#hitList .hit-item').length);
    check('scrolled to its end, the list writes more rows', more > 150, { rows: more });
    await page.focus('#findIn');
    for (let i = 0; i < 320; i++) await page.keyboard.press('Enter');
    const stepped = await page.evaluate(() => {
      const i = window.ADDPDF.S.hitIndex,
        el = document.querySelectorAll('#hitList .hit-item')[i];
      return {
        hitIndex: i,
        active: !!el && el.classList.contains('active'),
        actives: document.querySelectorAll('#hitList .active').length,
      };
    });
    check(
      'stepping past the rows written shows the match stepped to, and only it, as active',
      stepped.hitIndex === 320 && stepped.active && stepped.actives === 1,
      stepped,
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- text and search (Stage E) ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await open(page, join(CORPUS_DIR, 'medium-report-300p.pdf'));
    await page.waitForFunction(() => window.ADDPDF.S.items[0].tl.children.length > 10, null, {
      timeout: 30000,
    });
    /* a text page stays pdf.js's, in the worker: the same picture as pdf.js here */
    const same = await page.evaluate(async () => {
      const it = window.ADDPDF.S.items[0];
      const a = it.canvas;
      const b = document.createElement('canvas');
      b.width = a.width;
      b.height = a.height;
      const rs = a.width / Math.floor(it.vp.width);
      await it.page.render({
        canvasContext: b.getContext('2d', { alpha: false }),
        viewport: it.vp,
        transform: Math.abs(rs - 1) > 0.01 ? [rs, 0, 0, rs, 0, 0] : null,
      }).promise;
      const pa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      const pb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let off = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 48)
          off++;
      }
      return { engine: it.engine, percentOff: +((100 * off) / (pa.length / 4)).toFixed(3) };
    });
    check(
      'a text page is drawn by pdf.js in the worker, the same as pdf.js draws it here',
      same.engine === 'pdfjs' && same.percentOff < 0.5,
      same,
    );
    /* the text of every page is read in the background once the pages are in */
    const indexed = await page
      .waitForFunction(() => window.ADDPDF.S.textCache.size === window.ADDPDF.S.items.length, null, {
        timeout: 60000,
        polling: 100,
      })
      .then(() => true)
      .catch(() => false);
    check('the text of every page is read in the background', indexed, {
      read: await page.evaluate(() => window.ADDPDF.S.textCache.size),
    });
    /* the words are laid out once and follow a zoom: the same elements, in
       the same places on the page, and pdf.js is not asked for the text again */
    const place = () =>
      page.evaluate(() => {
        const it = window.ADDPDF.S.items[0],
          ir = it.inner.getBoundingClientRect();
        return Array.from(it.tl.children)
          .slice(0, 40)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return [(r.left - ir.left) / ir.width, (r.top - ir.top) / ir.height, r.width / ir.width];
          });
      });
    const before = await place();
    await page.evaluate(() => {
      const it = window.ADDPDF.S.items[0];
      window.__first = it.tl.firstChild;
      window.__reads = 0;
      const read = it.page.getTextContent.bind(it.page);
      it.page.getTextContent = (...a) => (window.__reads++, read(...a));
    });
    for (let i = 0; i < 3; i++) await page.click('#btnIn');
    await page.waitForTimeout(2500);
    const after = await place();
    let drift = 0;
    before.forEach((b, i) => b.forEach((v, k) => (drift = Math.max(drift, Math.abs(v - after[i][k])))));
    const kept = await page.evaluate(() => ({
      same: window.ADDPDF.S.items[0].tl.firstChild === window.__first,
      reads: window.__reads,
    }));
    check(
      'after a zoom the words are the same elements, not read or built again',
      kept.same && kept.reads === 0,
      kept,
    );
    check('and they sit where they did on the page (within 0.2% of its size)', drift < 0.002, {
      drift: +drift.toFixed(5),
    });

    await page.click('#btnFind');
    const t0 = Date.now();
    await page.fill('#findIn', 'engineer');
    await page.waitForFunction(() => /match/.test(document.getElementById('hitCount').textContent), null, {
      timeout: 30000,
    });
    const took = Date.now() - t0;
    check('with the text read, a search of 300 pages answers within a second', took < 1000, { ms: took });

    /* every match is listed: a limit of 400 used to leave each later page
       with only its first */
    await page.evaluate(() => window.ADDPDF.goTo(300));
    await page
      .waitForFunction(() => window.ADDPDF.S.items[299].tl.querySelectorAll('mark.hitw').length > 0, null, {
        timeout: 15000,
      })
      .catch(() => {});
    const last = await page.evaluate(() => {
      const S = window.ADDPDF.S,
        it = S.items[299];
      const marks = Array.from(it.tl.querySelectorAll('mark.hitw'));
      return {
        listed: S.hits.filter((h) => h.page === 300).length,
        marked: marks.length,
        wordOnly: marks.every(
          (m) =>
            m.textContent.toLowerCase() === 'engineer' &&
            m.getBoundingClientRect().width < m.parentNode.getBoundingClientRect().width + 0.5,
        ),
      };
    });
    check(
      'page 300 lists every match it has, and each is marked on the word alone',
      last.listed > 1 && last.listed === last.marked && last.wordOnly,
      last,
    );

    /* stepping through: each match stepped to is on screen, across pages too */
    await page.evaluate(() => window.ADDPDF.goTo(1));
    await page.waitForTimeout(800);
    await page.focus('#findIn');
    /* each step waits for its match to show: the first may need its page
       drawn again, having been far from the screen */
    const seen = [];
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Enter');
      const shown = await page
        .waitForFunction(
          () => {
            const m = document.querySelector('mark.hitw.now');
            if (!m) return false;
            const a = m.getBoundingClientRect(),
              s = document.getElementById('stage').getBoundingClientRect();
            return a.top >= s.top && a.bottom <= s.bottom;
          },
          null,
          { timeout: 5000, polling: 50 },
        )
        .then(() => true)
        .catch(() => false);
      seen.push(
        (shown ? '' : 'not shown:') +
          (await page.evaluate(() => window.ADDPDF.S.hits[window.ADDPDF.S.hitIndex].page)),
      );
    }
    check(
      'stepping through matches shows each on screen, on to the next page',
      seen.every((x) => /^\d+$/.test(x)) && new Set(seen).size > 1,
      seen,
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- errors are kept in this browser, for a report (js/health.js) ---- */
  {
    const { ctx, page } = await fresh(browser);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('smoke boom in C:/jobs/secret-plan.pdf');
      }, 0);
      Promise.reject(new Error('smoke promise left rejected'));
    });
    await page.waitForTimeout(300);
    const kept = await page.evaluate(() => window.ADDPDF_HEALTH.errors().map((e) => e.where + ': ' + e.msg));
    check(
      'an uncaught error and a rejected promise are kept, file names hidden',
      kept.some((m) => /page: .*smoke boom in C:\/jobs\/<file>\.pdf/.test(m)) &&
        kept.some((m) => /page \(promise\): smoke promise left rejected/.test(m)) &&
        !kept.join().includes('secret-plan'),
      kept,
    );
    /* still there after a reload, and copied for a report from the home screen */
    await page.reload();
    await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    await page.click('#diagCopy');
    await page.waitForTimeout(200);
    const report = await page.evaluate(() => window.ADDPDF.lastDiagnostics || '');
    const note = await page.textContent('#diagNote');
    check(
      '"Copy diagnostics" gives the browser, the memory and the errors kept, after a reload too',
      /Browser: /.test(report) &&
        /Errors \(\d+/.test(report) &&
        report.includes('smoke boom') &&
        !report.includes('secret-plan') &&
        /2 errors recorded/.test(note),
      { note, lines: report.split('\n').length },
    );
    await ctx.close();
  }

  /* ---- unsaved work comes back after the tab closes (crash recovery) ---- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
      acceptDownloads: true,
    });
    const errors = [];
    const first = await ctx.newPage();
    first.on('pageerror', (e) => errors.push(e.message));
    await first.goto(URL);
    await first.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    await open(first, join(CORPUS_DIR, 'medium-report-300p.pdf'));
    await first.evaluate(async () => {
      const S = window.ADDPDF.S;
      S.items[1].shapes.push({ t: 'rect', a: [60, 60], b: [200, 140], c: '#E2483D', w: 2, id: 'rec1' });
      S.items[2].rot = 90;
      await window.ADDPDF.recoverNow();
    });
    /* the tab goes, unsaved */
    await first.close({ runBeforeUnload: false });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    await page
      .waitForFunction(() => !document.getElementById('hRecover').hidden, null, { timeout: 5000 })
      .catch(() => {});
    const offered = await page.evaluate(() => ({
      shown: !document.getElementById('hRecover').hidden,
      rows: document.querySelectorAll('#recoverList .rrow').length,
      text: document.getElementById('recoverList').textContent,
    }));
    check(
      'after the tab closes with unsaved work, the next start offers it back',
      offered.shown && offered.rows === 1 && /300 pages · 1 mark/.test(offered.text),
      offered,
    );
    await page.click('#recoverList .rrow .btn.primary');
    await page.waitForFunction(
      () => window.ADDPDF.S.items.length === 300 && window.ADDPDF.S.items[0].rendered,
      null,
      {
        timeout: 60000,
      },
    );
    const back = await page.evaluate(() => {
      const S = window.ADDPDF.S;
      return {
        pages: S.items.length,
        marks: S.items[1].shapes.length,
        mark: S.items[1].shapes[0]?.id,
        rot: S.items[2].rot,
      };
    });
    check(
      'Restore brings back every page, the mark and the turn',
      back.pages === 300 && back.marks === 1 && back.mark === 'rec1' && back.rot === 90,
      back,
    );
    /* saved: nothing is kept any more */
    await page.evaluate(() => window.ADDPDF.recoverNow());
    await page.click('#btnSave');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('#saveGo'),
    ]);
    await dl.delete();
    await page.waitForTimeout(500);
    const left = await page.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open('adddots-pdf');
          r.onsuccess = () => {
            const tx = r.result.transaction(['recovery', 'recoverySrc'], 'readonly');
            const a = tx.objectStore('recovery').count(),
              b = tx.objectStore('recoverySrc').count();
            tx.oncomplete = () => res({ records: a.result, files: b.result });
          };
        }),
    );
    check('once saved, no unsaved work is kept', left.records === 0 && left.files === 0, left);
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- a device short of memory keeps fewer pages drawn (low-memory mode) ---- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    /* a 2 GB phone, as the browser reports it */
    await ctx.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2 }),
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    /* read down through thirty pages, a step at a time */
    const readDown = async (page) => {
      await open(page, join(CORPUS_DIR, 'medium-report-300p.pdf'));
      /* every page at its size first: until then the reader is held on page 1 */
      await page.waitForFunction(() => window.ADDPDF.S.items.every((i) => i.page && !i.estimated), null, {
        timeout: 60000,
      });
      for (let i = 0; i < 30; i++) {
        await page.mouse.move(700, 450);
        await page.mouse.wheel(0, 700);
        /* each screen read: its pages drawn */
        await page.waitForFunction(
          () => {
            const stage = document.getElementById('stage');
            const top = stage.scrollTop,
              bot = top + stage.clientHeight;
            return window.ADDPDF.S.items.every(
              (it) =>
                it.rendered ||
                !it.box ||
                !it.box.isConnected ||
                it.box.offsetTop > bot ||
                it.box.offsetTop + it.box.offsetHeight < top,
            );
          },
          null,
          { timeout: 20000, polling: 50 },
        );
      }
      await page.waitForTimeout(500);
    };
    const held = (page) =>
      page.evaluate(() => {
        const stage = document.getElementById('stage');
        const top = stage.scrollTop,
          bot = top + stage.clientHeight;
        const gaps = window.ADDPDF.S.items
          .filter((it) => it.rendered && it.box && it.box.isConnected)
          .map((it) => {
            const y = it.box.offsetTop,
              h = it.box.offsetHeight;
            return y + h < top ? top - (y + h) : y > bot ? y - bot : 0;
          });
        return { low: window.ADDPDF.lowMemory, drawn: gaps.length, far: Math.max(0, ...gaps), top };
      });
    await readDown(page);
    const low = await held(page);
    /* the same reading on this machine as it is */
    const usual = await fresh(browser);
    await readDown(usual.page);
    const normal = await held(usual.page);
    await usual.ctx.close();
    check(
      'a 2 GB device is in low-memory mode and keeps pages drawn only two screens out',
      low.low === true && low.drawn > 0 && low.far <= 1800 && (normal.low || normal.far > 1800),
      { low, normal },
    );
    const freed = await page.evaluate(() => window.ADDPDF.memoryPressure(true));
    const after = await held(page);
    check(
      'memory running short: every page off screen gives its picture back',
      freed && freed.pages > 0 && after.far === 0 && after.drawn > 0,
      { freed, after },
    );
    await page.evaluate(() => window.ADDPDF.memoryPressure(false));
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- accessibility: axe finds nothing, and the keyboard gets around ---- */
  {
    const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
    const { ctx, page, errors } = await fresh(browser);
    /* WCAG 2.1 A and AA, and axe's best practices. The words of the PDF
       itself (the text layer) are the document's, not the app's. */
    const audit = async () => {
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
      return page.evaluate(async () => {
        const r = await window.axe.run(
          { exclude: [['#stage .textLayer']] },
          { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
        );
        return r.violations.map(
          (v) =>
            v.id +
            ': ' +
            v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(', '),
        );
      });
    };
    const found = {};
    found.home = await audit();
    const homeInert = await page.evaluate(() => document.getElementById('stage').inert);
    await open(page, MIXED);
    found.document = await audit();
    const title = await page.textContent('#docTitle');
    /* Save from the keyboard: focus goes into the popover, Escape brings it back */
    await page.focus('#btnSave');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('savePop').hidden);
    found.save = await audit();
    const inSave = await page.evaluate(() => document.activeElement.id);
    await page.keyboard.press('Escape');
    const backSave = await page.evaluate(() => document.activeElement.id);
    await page.click('#ribPage');
    await page.focus('#btnAdd');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('addPop').hidden);
    const inAdd = await page.evaluate(() => document.activeElement.id);
    await page.keyboard.press('Escape');
    const backAdd = await page.evaluate(() => document.activeElement.id);
    await page.click('#btnUi');
    found.darkInterface = await audit();
    const all = Object.values(found).flat();
    check(
      'axe finds no accessibility problem: home, document, Save, dark interface',
      all.length === 0,
      found,
    );
    check(
      'the app under the home screen is out of reach until it closes, and the document has a heading',
      homeInert === true && /smoke-mixed-60p\.pdf, 60 pages/.test(title),
      { homeInert, title },
    );
    check(
      'a popover opened from the keyboard takes the focus, and Escape gives it back',
      inSave === 'saveName' && backSave === 'btnSave' && inAdd === 'addPdf' && backAdd === 'btnAdd',
      { inSave, backSave, inAdd, backAdd },
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- the phone app's page half (js/mobile.js), with the native side faked ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 4; i++) pdf.addPage([595, 842]);
    const b64 = Buffer.from(await pdf.save()).toString('base64');
    /* what Capacitor's bridge would give the page: the app's plugin, which
       hands over the PDF the app was opened with and takes what Save writes */
    await ctx.addInitScript((data) => {
      window.__saved = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          AddDots: {
            launchFile: () => Promise.resolve({ name: 'from-files.pdf', data }),
            addListener: (ev, fn) => (window.__openFile = fn),
            saveFile: (o) => (
              window.__saved.push({ name: o.name, type: o.type, bytes: atob(o.data).length }),
              Promise.resolve(window.__cancel ? { cancelled: true } : { name: o.name })
            ),
          },
        },
      };
    }, b64);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    const opened = await page
      .waitForFunction(
        () => {
          const a = window.ADDPDF;
          const it = a && a.S && a.S.items[0];
          return (
            it && it.rendered && a.S.sources[0] && { pages: a.S.items.length, name: a.S.sources[0].name }
          );
        },
        null,
        { timeout: 30000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    check(
      'phone app: the PDF it was opened with opens',
      !!opened && opened.pages === 4 && opened.name === 'from-files.pdf',
      opened,
    );
    const sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    check('phone app: no service worker', sw === 0, sw);
    /* Save, cancelled in the picker: still unsaved, popover still open */
    await page.evaluate(() => {
      window.__cancel = true;
      window.ADDPDF.S.items[0].shapes.push({
        t: 'rect',
        a: [60, 60],
        b: [200, 140],
        c: '#E2483D',
        w: 2,
        id: 'm1',
      });
    });
    await page.click('#btnSave');
    await page.click('#saveGo');
    await page.waitForFunction(() => window.__saved.length === 1);
    await page.waitForTimeout(300);
    const cancelled = await page.evaluate(() => ({
      open: !document.getElementById('savePop').hidden,
      saved: window.__saved[0],
    }));
    check(
      'phone app: Save sends the PDF to the picker; cancelled, the Save popover stays open',
      cancelled.open && cancelled.saved.type === 'application/pdf' && cancelled.saved.bytes > 1000,
      cancelled,
    );
    await page.evaluate(() => (window.__cancel = false));
    await page.click('#saveGo');
    await page.waitForFunction(() => window.__saved.length === 2);
    await page.waitForTimeout(300);
    const done = await page.evaluate(() => ({
      closed: document.getElementById('savePop').hidden,
      toast: document.getElementById('toast').textContent,
    }));
    check(
      'phone app: saved, the popover closes and says where',
      done.closed && /Saved/.test(done.toast),
      done,
    );

    /* phones: Download & share is a page of its own, from the top of the More sheet */
    await page.click('#btnMore');
    await page.waitForTimeout(300);
    await page.click('#moreDl');
    await page.waitForTimeout(300);
    const dl = await page.evaluate(() => {
      const el = document.getElementById('insp');
      const r = el.getBoundingClientRect();
      return {
        open: !el.hidden && el.classList.contains('phone'),
        full: r.width >= 380 && r.height >= 800,
        name: document.getElementById('inspFileName').textContent,
      };
    });
    await page.click('#inspGo');
    const dlSave = await page.evaluate(() => !document.getElementById('savePop').hidden);
    await page.evaluate(() => window.ADDPDF.closePops());
    await page.click('#inspBack');
    const dlBack = await page.evaluate(() => document.getElementById('insp').hidden);
    check(
      'phone: Download & share opens full screen from More, names the file, opens Save, and Back closes it',
      dl.open && dl.full && dl.name === 'from-files.pdf' && dlSave && dlBack,
      { ...dl, dlSave, dlBack },
    );

    /* phones: the Edit tools tiles above the dock press the same tools */
    const tilesShown = await page.evaluate(() => {
      const r = document.getElementById('etools').getBoundingClientRect();
      const dock = document.getElementById('dock').getBoundingClientRect();
      return r.height > 40 && r.bottom <= dock.top + 1 && dock.height >= 60;
    });
    await page.click('#etools [data-tool="ink"]');
    const penOn = await page.evaluate(() => ({
      tool: window.ADDPDF.S.tool,
      tile: document.querySelector('#etools [data-tool="ink"]').getAttribute('aria-pressed'),
    }));
    await page.click('#etools [data-tool="select"]');
    const tiles = await page.evaluate(() => ({
      tool: window.ADDPDF.S.tool,
      undo:
        document.querySelector('#etools [data-for="btnUndo"]').disabled ===
        document.getElementById('btnUndo').disabled,
    }));
    check(
      'phone: the Edit tools tiles sit above the dock, pick the tool (shown as on), and follow Undo',
      tilesShown && penOn.tool === 'ink' && penOn.tile === 'true' && tiles.tool === 'select' && tiles.undo,
      { tilesShown, penOn, tiles },
    );
    await selBarCheck(page, 'phone: ');

    /* the home screen's search box filters the recent files by name */
    const found = await page.evaluate(async () => {
      const box = document.getElementById('hSearch');
      const rows = () => document.querySelectorAll('#recentList .rrow').length;
      const settle = () => new Promise((r) => setTimeout(r, 300));
      /* the list is drawn when the home screen shows: draw it now */
      box.dispatchEvent(new Event('input'));
      for (let i = 0; i < 50 && !rows(); i++) await settle();
      const all = rows();
      box.value = 'FROM-files';
      box.dispatchEvent(new Event('input'));
      await settle();
      const hit = rows();
      box.value = 'no such file';
      box.dispatchEvent(new Event('input'));
      await settle();
      const miss = rows();
      const note = document.getElementById('recentList').textContent;
      box.value = '';
      box.dispatchEvent(new Event('input'));
      return { all, hit, miss, note };
    });
    check(
      'home: Search your PDFs filters the recent files by name',
      found.all >= 1 && found.hit === 1 && found.miss === 0 && /No recent PDF matches/.test(found.note),
      found,
    );

    /* the home screen on a phone ("02 Home"): the tools a row to swipe,
       then a slim Open a PDF bar, a tap anywhere on which opens the picker */
    {
      const hctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: 'block',
      });
      await hctx.addInitScript(() => {
        try {
          localStorage.setItem('adpdf-welcomed', '1');
        } catch (e) {
          /* private window */
        }
      });
      const hp = await hctx.newPage();
      await hp.goto(URL);
      await hp.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
      const home = await hp.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const grid = document.getElementById('toolGrid');
        const drop = r('drop');
        return {
          toolsFirst: r('hTools').bottom <= drop.top,
          slim: drop.height < 100,
          row: grid.scrollWidth > grid.clientWidth && r('toolGrid').height < 100,
          words: document.querySelector('#drop h2').innerText.trim(),
        };
      });
      const chooser = hp.waitForEvent('filechooser', { timeout: 5000 }).then(
        () => true,
        () => false,
      );
      /* a tap on the bar's words, not on the button's own spot */
      await hp.click('#drop', { position: { x: 120, y: 30 } });
      home.picker = await chooser;
      check(
        'phone home: the tools are a row to swipe above a slim Open a PDF bar, and a tap on the bar opens the picker',
        home.toolsFirst && home.slim && home.row && home.words === 'Open a PDF' && home.picker,
        home,
      );
      await hctx.close();
    }

    /* Share: the app is not served from the web, so it shares through the
       website in js/config.js (shareServer), and its links point there */
    const shareCalls = [];
    await ctx.route('https://pdf.adddots.com/api/**', async (route) => {
      const req = route.request();
      const path = new globalThis.URL(req.url()).pathname.replace('/api', '');
      shareCalls.push(req.method() + ' ' + path);
      let body = {};
      if (path === '/health') body = { ok: true, max_upload: 50 * 1048576 };
      else if (path === '/documents' && req.method() === 'POST')
        body = { id: 'd1', owner_token: 'own3r', version: 1, title: 'Shared' };
      else if (/\/shares$/.test(path) && req.method() === 'POST') body = { token: 'r3view' };
      else if (/\/shares$/.test(path)) body = { shares: [] };
      else if (/\/comments/.test(path)) body = { comments: [], server_time: '2026-09-28T00:00:00Z' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    await page.evaluate(() => document.getElementById('btnShare').click());
    await page.waitForFunction(() => /50 MB/.test(document.getElementById('shSize').textContent), null, {
      timeout: 10000,
    });
    await page.evaluate(() => document.getElementById('shGo').click());
    await page.waitForFunction(() => document.getElementById('shOwner'), null, { timeout: 30000 });
    const owner = await page.evaluate(() => document.getElementById('shOwner').value);
    await page.evaluate(() => document.getElementById('shMake').click());
    await page.waitForFunction(() => document.getElementById('shNew'), null, { timeout: 10000 });
    const review = await page.evaluate(() => document.getElementById('shNew').value);
    check(
      'phone app: Share uploads to the website in config.js, and its links point there',
      shareCalls.includes('GET /health') &&
        shareCalls.includes('POST /documents') &&
        owner === 'https://pdf.adddots.com/?d=d1#k=own3r' &&
        review === 'https://pdf.adddots.com/?s=r3view',
      { owner, review, calls: shareCalls.slice(0, 5) },
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- phones, the first time: the welcome pages (js/welcome.js) ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    const first = await page.evaluate(() => {
      const w = document.getElementById('welcome');
      return {
        shown: !!w,
        title: w && document.getElementById('wTitle').textContent,
        focus: document.activeElement.id,
      };
    });
    await page.addScriptTag({
      content: readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'),
    });
    const axeW = await page.evaluate(async () =>
      (
        await window.axe.run('#welcome', {
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
        })
      ).violations.map((v) => v.id),
    );
    const titles = [];
    for (let i = 0; i < 3; i++) {
      titles.push(await page.textContent('#wTitle'));
      await page.click('#wGo');
    }
    const gone = await page.evaluate(() => ({
      gone: !document.getElementById('welcome'),
      kept: localStorage.getItem('adpdf-welcomed'),
    }));
    await page.reload();
    await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    await page.waitForTimeout(300);
    const again = await page.evaluate(() => !!document.getElementById('welcome'));
    check(
      'phone, first run: the welcome pages show, pass axe, page through to Get Started, and stay away after',
      first.shown &&
        /Mark Up Any PDF/.test(first.title) &&
        first.focus === 'wGo' &&
        axeW.length === 0 &&
        new Set(titles).size === 3 &&
        gone.gone &&
        gone.kept === '1' &&
        !again,
      { first, axeW, titles, gone, again },
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- accounts: sign up with a code, stay signed in, sign out, sign in,
     reset the password (js/account.js against a fake Supabase Auth) ---- */
  {
    const SB = 'https://adddots-test.supabase.co';
    /* Supabase Auth (GoTrue), as much of it as the app uses: accounts in
       memory, the emailed codes fixed so the test can type them */
    const users = new Map();
    const SIGNUP_CODE = '123456',
      RESET_CODE = '654321';
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const userJson = (u) => ({
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      email_confirmed_at: u.confirmed ? '2026-09-28T00:00:00Z' : null,
      identities: [{ id: u.id, provider: 'email' }],
      app_metadata: { provider: u.provider || 'email' },
      user_metadata: {},
      created_at: '2026-09-28T00:00:00Z',
    });
    const session = (u) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return {
        access_token:
          b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u.id, email: u.email, exp }) + '.sig',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        refresh_token: 'refresh-' + u.id,
        user: userJson(u),
      };
    };
    const calls = [];
    const fail = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });
    const bearer = (auth) => {
      try {
        const sub = JSON.parse(
          Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url').toString(),
        ).sub;
        return [...users.values()].find((x) => x.id === sub) || null;
      } catch {
        return null;
      }
    };
    function gotrue(method, path, body, auth) {
      calls.push(method + ' ' + path);
      /* who a token belongs to: a link from an email arrives as a token */
      if (path === '/user' && method === 'GET') {
        const me = bearer(auth || '');
        return me ? { status: 200, body: userJson(me) } : fail(401, 'bad_jwt', 'invalid JWT');
      }
      const u = body && body.email ? users.get(body.email) : null;
      if (path === '/signup') {
        if (u && u.confirmed) return { status: 200, body: { ...userJson(u), identities: [] } };
        const nu = {
          id: 'u' + (users.size + 1),
          email: body.email,
          password: body.password,
          confirmed: false,
        };
        users.set(body.email, nu);
        return { status: 200, body: userJson(nu) };
      }
      if (path === '/verify') {
        const want = body.type === 'recovery' ? RESET_CODE : SIGNUP_CODE;
        if (!u || body.token !== want) return fail(403, 'otp_expired', 'Token has expired or is invalid');
        u.confirmed = true;
        return { status: 200, body: session(u) };
      }
      if (path.startsWith('/token')) {
        if (!u || u.password !== body.password)
          return fail(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.confirmed) return fail(400, 'email_not_confirmed', 'Email not confirmed');
        return { status: 200, body: session(u) };
      }
      if (path === '/resend' || path.startsWith('/recover')) return { status: 200, body: {} };
      if (path === '/user' && method === 'PUT') {
        /* the account that just proved its reset code, or the token's */
        const target = [...users.values()].find((x) => x.lastReset) || bearer(auth || '');
        if (!target) return fail(401, 'no_authorization', 'not signed in');
        target.password = body.password;
        target.lastReset = false;
        return { status: 200, body: userJson(target) };
      }
      if (path.startsWith('/logout')) return { status: 204, body: null };
      /* which sign-in providers the project has on: Google, not Apple */
      if (path === '/settings')
        return { status: 200, body: { external: { email: true, google: true, apple: false } } };
      return { status: 404, body: { msg: 'not in the fake: ' + method + ' ' + path } };
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript((url) => {
      window.ADDDOTS_CONFIG = { supabaseUrl: url, supabaseKey: 'sb_publishable_test', requireSignIn: false };
    }, SB);
    const authRoute = async (route) => {
      const req = route.request();
      const url = new globalThis.URL(req.url());
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      /* a password change is for whoever just proved the reset code */
      if (url.pathname.endsWith('/verify') && body && body.type === 'recovery') {
        const u = users.get(body.email);
        if (u) u.lastReset = true;
      }
      const r = gotrue(
        req.method(),
        url.pathname.replace('/auth/v1', '') + url.search,
        body,
        req.headers()['authorization'],
      );
      await route.fulfill({
        status: r.status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: r.body === null ? '' : JSON.stringify(r.body),
      });
    };
    await ctx.route(SB + '/auth/v1/**', authRoute);
    /* the account deleting itself (delete_my_account): whoever the token names */
    await ctx.route(SB + '/rest/v1/rpc/delete_my_account', async (route) => {
      const req = route.request();
      calls.push(req.method() + ' /rpc/delete_my_account');
      const token = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
      let sub = null;
      try {
        sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
      } catch {
        /* the publishable key, not a user's token */
      }
      const u = [...users.values()].find((x) => x.id === sub);
      if (u) users.delete(u.email);
      await route.fulfill({
        status: u ? 204 : 401,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json',
        body: u ? '' : JSON.stringify({ code: '42501', message: 'not signed in' }),
      });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const boot = async () => {
      await page.goto(URL);
      await page.waitForFunction(
        () => window.ADDPDF && window.ADDPDF.account && window.ADDPDF.account.ready(),
        null,
        {
          timeout: 20000,
        },
      );
    };
    const state = () =>
      page.evaluate(() => ({
        user: window.ADDPDF.account.user(),
        open: !document.getElementById('authDlg').hidden,
        title: document.getElementById('authTitle').textContent,
        msg: document.getElementById('authMsg').hidden ? '' : document.getElementById('authMsg').textContent,
        button: document.getElementById('btnAccount').getAttribute('aria-label'),
        home: document.getElementById('hAcctName').textContent,
      }));
    const submit = async (view) => {
      await page.click('#authDlg form[data-view="' + view + '"] button[type=submit]');
      await page.waitForFunction(
        (v) => !document.querySelector('#authDlg form[data-view="' + v + '"] button[type=submit]').disabled,
        view,
      );
      await page.waitForTimeout(150);
    };
    await boot();
    const shown = await page.evaluate(() => ({
      home: !document.getElementById('hAccount').hidden,
      bar: !document.getElementById('grpAccount').hidden,
    }));
    check(
      'accounts: with a project configured, Sign in shows on the home screen and the toolbar',
      shown.home && shown.bar,
      shown,
    );

    /* sign up: the code, not a link */
    await page.click('#hAcctBtn');
    /* the dialog passes the same accessibility audit as the rest of the app */
    await page.addScriptTag({
      content: readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'),
    });
    const axeDlg = await page.evaluate(async () =>
      (
        await window.axe.run('#authDlg', {
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
        })
      ).violations.map((v) => v.id),
    );
    check('accounts: axe finds no accessibility problem in the sign-in dialog', axeDlg.length === 0, axeDlg);
    await page.click('#authDlg [data-go="signup"]');
    await page.fill('#aSuEmail', 'zak@example.com');
    await page.fill('#aSuPw', 'short');
    await submit('signup');
    const weak = await state();
    await page.fill('#aSuPw', 'correct horse 1');
    await submit('signup');
    const verify = await state();
    await page.fill('#aVeCode', '000000');
    await submit('verify');
    const wrong = await state();
    await page.fill('#aVeCode', SIGNUP_CODE);
    await submit('verify');
    const confirmed = await state();
    check(
      'accounts: sign up asks for the emailed 6-digit code; a wrong code is refused, the right one signs in',
      /8 characters/.test(weak.msg) &&
        verify.title === 'Check your email' &&
        /wrong or has expired/.test(wrong.msg) &&
        !confirmed.open &&
        confirmed.user &&
        confirmed.user.email === 'zak@example.com',
      { weak: weak.msg, verify: verify.title, wrong: wrong.msg, confirmed },
    );

    /* staying signed in */
    await boot();
    await page
      .waitForFunction(() => !!window.ADDPDF.account.user(), null, { timeout: 10000 })
      .catch(() => {});
    const again = await state();
    check(
      'accounts: after a restart the app is still signed in',
      again.user && again.user.email === 'zak@example.com' && again.home === 'zak@example.com',
      again,
    );
    const hello = await page.evaluate(() => document.getElementById('hHello').textContent);
    check(
      'home: the greeting names the signed-in account',
      /^Good (morning|afternoon|evening), Zak$/.test(hello),
      hello,
    );

    /* sign out, from the toolbar's account button (behind the home screen: the home entry) */
    await page.click('#hAcctBtn');
    const account = await state();
    await submit('account');
    const out = await state();
    await boot();
    const outAfter = await state();
    check(
      'accounts: Sign out signs out, and stays signed out after a restart',
      account.title === 'Your account' &&
        !out.user &&
        !out.open &&
        !outAfter.user &&
        outAfter.home === 'Sign in',
      { account: account.title, out, outAfter },
    );

    /* sign in: a wrong password, then the right one */
    await page.click('#hAcctBtn');
    await page.fill('#aSiEmail', 'zak@example.com');
    await page.fill('#aSiPw', 'not it');
    await submit('signin');
    const bad = await state();
    await page.fill('#aSiPw', 'correct horse 1');
    await submit('signin');
    const inAgain = await state();
    check(
      'accounts: a wrong password is refused in plain words; the right one signs in',
      /do not match/.test(bad.msg) && inAgain.user && !inAgain.open,
      { bad: bad.msg, inAgain },
    );

    /* forgot password: a code, then a new password */
    await page.click('#hAcctBtn');
    await submit('account');
    await page.click('#hAcctBtn');
    await page.click('#authDlg [data-go="forgot"]');
    await page.fill('#aFoEmail', 'zak@example.com');
    await submit('forgot');
    const reset = await state();
    await page.fill('#aReCode', RESET_CODE);
    await page.fill('#aRePw', 'new battery staple');
    await submit('reset');
    const afterReset = await state();
    check(
      'accounts: Forgot password sends a code; with it and a new password the account is signed in',
      reset.title === 'Set a new password' &&
        afterReset.user &&
        !afterReset.open &&
        users.get('zak@example.com').password === 'new battery staple',
      { reset: reset.title, afterReset },
    );

    /* an account never confirmed: signing in sends a fresh code */
    await page.click('#hAcctBtn');
    await submit('account');
    users.set('late@example.com', {
      id: 'u9',
      email: 'late@example.com',
      password: 'late password 1',
      confirmed: false,
    });
    await page.click('#hAcctBtn');
    await page.fill('#aSiEmail', 'late@example.com');
    await page.fill('#aSiPw', 'late password 1');
    await submit('signin');
    const late = await state();
    check(
      'accounts: signing in to an unconfirmed account sends a new code and asks for it',
      late.title === 'Check your email' && /new code/.test(late.msg) && calls.includes('POST /resend'),
      late,
    );
    await page.keyboard.press('Escape');
    const closed = await state();
    check('accounts: Escape closes the dialog', !closed.open, closed);

    /* the privacy policy, from Create account, inside the dialog */
    await page.click('#hAcctBtn');
    await page.click('#authDlg [data-go="signup"]');
    await page.fill('#aSuEmail', 'kept@example.com');
    await page.click('#authDlg form[data-view="signup"] [data-go="privacy"]');
    await page
      .waitForFunction(
        () => /Deleting your account/.test(document.getElementById('authPolicy').textContent),
        null,
        {
          timeout: 10000,
        },
      )
      .catch(() => {});
    const pol = await page.evaluate(() => ({
      title: document.getElementById('authTitle').textContent,
      text: document.getElementById('authPolicy').textContent,
      url: location.href,
    }));
    await page.click('#authDlg [data-view="privacy"] [data-back]');
    const polBack = await page.evaluate(() => ({
      title: document.getElementById('authTitle').textContent,
      email: document.getElementById('aSuEmail').value,
    }));
    check(
      'accounts: the privacy policy opens in the dialog, and Back returns to the form as it was',
      pol.title === 'Privacy policy' &&
        /stay on your device/.test(pol.text) &&
        /Deleting your account/.test(pol.text) &&
        pol.url === URL &&
        polBack.title === 'Create your account' &&
        polBack.email === 'kept@example.com',
      { title: pol.title, policy: pol.text.slice(0, 60), back: polBack },
    );
    await page.keyboard.press('Escape');

    /* delete the account: the password first, then it is gone for good */
    await page.click('#hAcctBtn');
    await page.fill('#aSiEmail', 'zak@example.com');
    await page.fill('#aSiPw', 'new battery staple');
    await submit('signin');
    await page.click('#hAcctBtn');
    await page.click('#authDlg [data-go="delete"]');
    const del = await state();
    await page.fill('#aDePw', 'not it');
    await submit('delete');
    const delBad = await state();
    const kept = users.has('zak@example.com');
    await page.fill('#aDePw', 'new battery staple');
    await submit('delete');
    const deleted = await state();
    await boot();
    const delAfter = await state();
    await page.click('#hAcctBtn');
    await page.fill('#aSiEmail', 'zak@example.com');
    await page.fill('#aSiPw', 'new battery staple');
    await submit('signin');
    const gone = await state();
    await page.keyboard.press('Escape');
    check(
      'accounts: Delete account asks for the password; a wrong one keeps the account, the right one deletes it and signs out',
      del.title === 'Delete your account' &&
        /do not match/.test(delBad.msg) &&
        kept &&
        !users.has('zak@example.com') &&
        calls.includes('POST /rpc/delete_my_account') &&
        !deleted.user &&
        !deleted.open &&
        !delAfter.user &&
        delAfter.home === 'Sign in' &&
        /do not match/.test(gone.msg),
      { del: del.title, delBad: delBad.msg, kept, deleted, delAfter: delAfter.home, gone: gone.msg },
    );

    /* Supabase's own emails (no custom sender yet) carry a link, not a code:
       it opens the website with the session in the address */
    const linkTo = async (u, type) => {
      const s = session(u);
      /* a fresh load, as from the email (a change of #... alone would not reload) */
      await page.goto('about:blank');
      await page.goto(
        URL +
          '#access_token=' +
          s.access_token +
          '&refresh_token=' +
          s.refresh_token +
          '&expires_in=3600&expires_at=' +
          s.expires_at +
          '&token_type=bearer&type=' +
          type,
      );
      await page.waitForFunction(
        () => window.ADDPDF && window.ADDPDF.account && window.ADDPDF.account.ready(),
        null,
        {
          timeout: 20000,
        },
      );
      await page
        .waitForFunction(() => !!window.ADDPDF.account.user(), null, { timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(300);
    };
    const linked = { id: 'u20', email: 'link@example.com', password: 'link password 1', confirmed: true };
    users.set(linked.email, linked);
    await linkTo(linked, 'signup');
    const viaLink = await page.evaluate(() => ({
      user: window.ADDPDF.account.user(),
      hash: location.hash,
      toast: document.getElementById('toast').textContent,
    }));
    check(
      'accounts: the confirm link from an email opens the website signed in, and leaves no token in the address',
      viaLink.user &&
        viaLink.user.email === 'link@example.com' &&
        viaLink.hash === '' &&
        /Email confirmed/.test(viaLink.toast),
      viaLink,
    );
    await page.evaluate(() => localStorage.removeItem('adpdf.auth'));
    await linkTo(linked, 'recovery');
    const rec = await state();
    await page.fill('#aNpPw', 'fresh password 9');
    await submit('newpw');
    const recDone = await state();
    check(
      'accounts: the reset link opens Set a new password; saved, the account signs in with it',
      rec.open &&
        rec.title === 'Set a new password' &&
        !recDone.open &&
        recDone.user &&
        linked.password === 'fresh password 9',
      { rec: rec.title, recDone, password: linked.password },
    );

    /* an account made with Google has no password: deleting it asks for its email */
    const goog = { id: 'u40', email: 'g@example.com', confirmed: true, provider: 'google' };
    users.set(goog.email, goog);
    await page.evaluate(() => localStorage.removeItem('adpdf.auth'));
    await linkTo(goog, '');
    await page.click('#hAcctBtn');
    await page.click('#authDlg [data-go="delete"]');
    const gLabel = await page.textContent('label[for="aDePw"]');
    await page.fill('#aDePw', 'someone@example.com');
    await submit('delete');
    const gBad = await state();
    await page.fill('#aDePw', 'g@example.com');
    await submit('delete');
    const gDel = await state();
    check(
      'accounts: an account from Google is deleted by typing its email (it has no password); a wrong email keeps it',
      gLabel === 'Type your email to confirm' &&
        /not this account/.test(gBad.msg) &&
        !users.has('g@example.com') &&
        !gDel.user,
      { gLabel, gBad: gBad.msg, gone: !users.has('g@example.com'), gDel: gDel.user },
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();

    /* sign-in required (the app as shipped): the app waits behind the
       sign-in page, which cannot be closed, until an account signs in */
    const gctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    await gctx.addInitScript((url) => {
      window.ADDDOTS_CONFIG = { supabaseUrl: url, supabaseKey: 'sb_publishable_test', requireSignIn: true };
    }, SB);
    await gctx.route(SB + '/auth/v1/**', authRoute);
    const gp = await gctx.newPage();
    const gerr = [];
    gp.on('pageerror', (e) => gerr.push(e.message));
    await gp.goto(URL);
    await gp.waitForFunction(
      () => window.ADDPDF && window.ADDPDF.account && window.ADDPDF.account.ready(),
      null,
      {
        timeout: 20000,
      },
    );
    await gp
      .waitForFunction(() => !document.querySelector('#authDlg [data-provider="google"]').hidden, null, {
        timeout: 5000,
      })
      .catch(() => {});
    const gateState = () =>
      gp.evaluate(() => ({
        open: !document.getElementById('authDlg').hidden,
        gate: document.getElementById('authDlg').classList.contains('gate'),
        inert: document.querySelector('.app').inert,
        title: document.getElementById('authTitle').textContent,
        google: !document.querySelector('#authDlg [data-view="signin"] [data-provider="google"]').hidden,
        apple: !document.querySelector('#authDlg [data-view="signin"] [data-provider="apple"]').hidden,
        user: window.ADDPDF.account.user(),
      }));
    const atStart = await gateState();
    await gp.keyboard.press('Escape');
    await gp.mouse.click(5, 5);
    const stays = await gateState();
    /* a script (the phone apps' own test runs) still reaches the app behind it */
    const ui0 = await gp.evaluate(() => document.body.dataset.ui);
    await gp.evaluate(() => document.getElementById('btnUi').click());
    const scripted = (await gp.evaluate(() => document.body.dataset.ui)) !== ui0;
    await gp.evaluate(() => document.getElementById('btnUi').click());
    /* a free account: sign in, and the app is there */
    users.set('gate@example.com', {
      id: 'u30',
      email: 'gate@example.com',
      password: 'gate password 1',
      confirmed: true,
    });
    await gp.fill('#aSiEmail', 'gate@example.com');
    await gp.fill('#aSiPw', 'gate password 1');
    await gp.click('#authDlg form[data-view="signin"] button[type=submit]');
    await gp
      .waitForFunction(() => document.getElementById('authDlg').hidden, null, { timeout: 10000 })
      .catch(() => {});
    const inApp = await gateState();
    /* signed out: the sign-in page again */
    await gp.click('#hAcctBtn');
    await gp.click('#authDlg form[data-view="account"] button[type=submit]');
    await gp
      .waitForFunction(() => document.getElementById('authDlg').classList.contains('gate'), null, {
        timeout: 10000,
      })
      .catch(() => {});
    const gOut = await gateState();
    /* Continue with Google goes to the project's Google sign-in, and back here */
    const [authorize] = await Promise.all([
      gp.waitForRequest((r) => /\/auth\/v1\/authorize/.test(r.url()), { timeout: 10000 }).catch(() => null),
      gp.click('#authDlg [data-view="signin"] [data-provider="google"]'),
    ]);
    const to = authorize ? new globalThis.URL(authorize.url()) : null;
    check(
      'sign-in required: the app waits behind a sign-in page that cannot be closed; Google shows when the project has it; signing in opens the app, signing out closes it again',
      atStart.open &&
        atStart.gate &&
        atStart.inert &&
        atStart.title === 'Sign in to ADD DOTS PDF' &&
        atStart.google &&
        !atStart.apple &&
        stays.open &&
        stays.gate &&
        scripted &&
        !inApp.open &&
        !inApp.inert &&
        inApp.user &&
        inApp.user.email === 'gate@example.com' &&
        gOut.open &&
        gOut.gate &&
        gOut.inert &&
        !gOut.user &&
        !!to &&
        to.searchParams.get('provider') === 'google' &&
        (to.searchParams.get('redirect_to') || '').startsWith(URL),
      { atStart, stays, scripted, inApp, gOut, authorize: to && to.search },
    );
    check('no errors on the page', gerr.length === 0, gerr);
    await gctx.close();

    /* sign-in when saving (the app as shipped, requireSignIn: 'save'): every
       tool is open, and Save asks for a free account first; closed, nothing
       is saved; signed in, the save goes ahead by itself */
    const sctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
      acceptDownloads: true,
    });
    await sctx.addInitScript((url) => {
      window.ADDDOTS_CONFIG = { supabaseUrl: url, supabaseKey: 'sb_publishable_test', requireSignIn: 'save' };
    }, SB);
    await sctx.route(SB + '/auth/v1/**', authRoute);
    const sp = await sctx.newPage();
    const serr = [];
    sp.on('pageerror', (e) => serr.push(e.message));
    await sp.goto(URL);
    await sp.waitForFunction(
      () => window.ADDPDF && window.ADDPDF.account && window.ADDPDF.account.ready(),
      null,
      {
        timeout: 20000,
      },
    );
    await sp.waitForTimeout(300);
    const sState = () =>
      sp.evaluate(() => ({
        open: !document.getElementById('authDlg').hidden,
        save: document.getElementById('authDlg').classList.contains('save'),
        gate: document.getElementById('authDlg').classList.contains('gate'),
        promo: getComputedStyle(document.querySelector('.authpromo')).display !== 'none',
        inert: document.querySelector('.app').inert,
        title: document.getElementById('authTitle').textContent,
        view: (Array.from(document.querySelectorAll('#authDlg [data-view]')).find((f) => !f.hidden) || {})
          .dataset?.view,
        user: window.ADDPDF.account.user(),
        /* the Sign in buttons: home screen, its top bar, the toolbar */
        buttons: ['hAccount', 'hAcctTop', 'grpAccount'].filter((id) => !document.getElementById(id).hidden),
      }));
    const sStart = await sState();
    await open(sp, MIXED);
    const downloads = [];
    sp.on('download', (d) => downloads.push(d));
    await sp.click('#btnSave');
    await sp.click('#saveGo');
    await sp
      .waitForFunction(() => !document.getElementById('authDlg').hidden, null, { timeout: 30000 })
      .catch(() => {});
    const asked = await sState();
    await sp.keyboard.press('Escape');
    await sp.waitForTimeout(500);
    const closedNoSave = { ...(await sState()), downloads: downloads.length };
    users.set('save@example.com', {
      id: 'u31',
      email: 'save@example.com',
      password: 'save password 1',
      confirmed: true,
    });
    /* the Save popover stays open after the popup was closed */
    if (!(await sp.isVisible('#saveGo'))) await sp.click('#btnSave');
    const [sdl] = await Promise.all([
      sp.waitForEvent('download', { timeout: 60000 }).catch(() => null),
      (async () => {
        await sp.click('#saveGo');
        await sp.waitForFunction(() => !document.getElementById('authDlg').hidden, null, { timeout: 30000 });
        await sp.click('#authDlg form[data-view="signup"] [data-go="signin"]');
        await sp.fill('#aSiEmail', 'save@example.com');
        await sp.fill('#aSiPw', 'save password 1');
        await sp.click('#authDlg form[data-view="signin"] button[type=submit]');
      })(),
    ]);
    const signedSave = await sState();
    const sPages = sdl ? (await PDFDocument.load(readFileSync(await sdl.path()))).getPageCount() : null;
    check(
      'sign-in when saving: the app opens with no sign-in and no Sign in button; Save opens the free-account popup; closed, nothing saves; signed in, the PDF saves',
      !sStart.open &&
        !sStart.inert &&
        sStart.buttons.length === 0 &&
        asked.open &&
        asked.save &&
        !asked.gate &&
        asked.promo &&
        asked.view === 'signup' &&
        asked.title === 'Create your free account' &&
        !closedNoSave.open &&
        !closedNoSave.inert &&
        closedNoSave.downloads === 0 &&
        !signedSave.open &&
        !signedSave.save &&
        signedSave.user &&
        signedSave.user.email === 'save@example.com' &&
        signedSave.buttons.length === 3 &&
        sPages === 60,
      { sStart, asked, closedNoSave, signedSave, sPages },
    );
    check('no errors on the page', serr.length === 0, serr);
    await sctx.close();
  }

  /* ---- without a project configured, no account UI at all ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => (window.ADDDOTS_CONFIG = { supabaseUrl: '', supabaseKey: '' }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
    await page.waitForTimeout(500);
    const none = await page.evaluate(() => ({
      home: !document.getElementById('hAccount').hidden || !document.getElementById('hAcctTop').hidden,
      bar: !document.getElementById('grpAccount').hidden,
      lib: !!window.supabase,
    }));
    check(
      'accounts: without a project configured nothing shows and the library is not loaded',
      !none.home && !none.bar && !none.lib,
      none,
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- where pdf.js's own worker cannot start inside the render worker
     (WebView2 in the Windows app), its code runs in the render worker's
     thread and pages are still drawn there ---- */
  {
    const { ctx, page, errors } = await fresh(browser, '?rwfake=1');
    await open(page, MIXED);
    const got = await page
      .waitForFunction(
        () => {
          const a = window.ADDPDF;
          return a.renderWorker() !== 'wait' && a.S.items[0].rendered
            ? {
                state: a.renderWorker(),
                mode: a.renderWorkerMode(),
                drawn: a.S.items.filter((i) => i.rendered).length,
              }
            : null;
        },
        null,
        { timeout: 30000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    check(
      'render worker in same-thread mode: it starts and draws the pages',
      !!got && got.state === 'on' && got.mode === 'same-thread' && got.drawn > 0,
      got,
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- saving in the worker writes the same file the page would ---- */
  {
    /* every module's marks (annotate, draw, leader, docops, insert,
       signature) and photo pins with their pages, as the engine's golden
       tests save them */
    const plain = (items) =>
      items.map((it) => ({
        ...it,
        src: {
          id: 'fx' + it.src.id,
          name: 'fixture.pdf',
          bytes: Buffer.from(it.src.bytes).toString('base64'),
        },
      }));
    const modules = plain(await makeModulesFixture(PDFLib));
    const pins = await makePinsFixture(PDFLib);
    const job = { modules, pins: plain(pins.items), locs: pins.locs };
    const saved = {};
    for (const mode of ['page', 'worker']) {
      const { ctx, page, errors } = await fresh(browser, mode === 'page' ? '?saveworker=0' : '');
      saved[mode] = await page.evaluate(async (job) => {
        const X = window.ADDPDF,
          S = X.S;
        const bin = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        const srcs = {};
        const items = (list) =>
          list.map((it) => ({
            ...it,
            src:
              srcs[it.src.id] ||
              (srcs[it.src.id] = { id: it.src.id, name: it.src.name, bytes: bin(it.src.bytes) }),
          }));
        const b64 = (u8) => {
          let s = '';
          for (let i = 0; i < u8.length; i += 0x8000)
            s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          return btoa(s);
        };
        S.baseName = 'fixture';
        S.locs = job.locs;
        const a = await X.buildPdf(items(job.modules), null, {});
        const by = X.savedBy;
        const b = await X.buildPdf(items(job.pins), null, { photos: true }, 'blob');
        return { by, modules: b64(a), pins: b64(new Uint8Array(await b.arrayBuffer())) };
      }, job);
      saved[mode].errors = errors;
      await ctx.close();
    }
    check('with the worker off, the page saves', saved.page.by === 'page', saved.page.by);
    check('the save worker builds the file', saved.worker.by === 'worker', saved.worker.by);
    const pages = async (b64) => digest(PDFLib, Buffer.from(b64, 'base64'));
    const [mp, mw, pp, pw] = await Promise.all([
      pages(saved.page.modules),
      pages(saved.worker.modules),
      pages(saved.page.pins),
      pages(saved.worker.pins),
    ]);
    check(
      "the worker's file draws every module's marks as the page's does",
      mp.length > 0 && JSON.stringify(mp) === JSON.stringify(mw),
      { pages: [mp.length, mw.length] },
    );
    check(
      "the worker's file has the same photo pins and photo pages",
      pp.length > 2 && JSON.stringify(pp) === JSON.stringify(pw),
      { pages: [pp.length, pw.length] },
    );
    check('no errors on the page', !saved.page.errors.length && !saved.worker.errors.length, [
      ...saved.page.errors,
      ...saved.worker.errors,
    ]);
  }

  /* ---- Save writes the marks onto the original (an incremental update) ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    const ORIG = join(CORPUS_DIR, 'medium-report-300p.pdf');
    const orig = readFileSync(ORIG);
    await open(page, ORIG);
    await allLoaded(page);
    await page.evaluate(() =>
      window.ADDPDF.S.items[1].shapes.push({ t: 'rect', a: [60, 60], b: [260, 160], c: '#E2483D', w: 3 }),
    );
    const save = async () => {
      await page.click('#btnSave');
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.click('#saveGo'),
      ]);
      return readFileSync(await dl.path());
    };
    const a = await save();
    const appended = await page.evaluate(() => window.ADDPDF.appended);
    check(
      'Save writes the marks onto the original: its bytes as they were, then an update',
      appended === true && a.length > orig.length && Buffer.compare(a.subarray(0, orig.length), orig) === 0,
      { appended, updateBytes: a.length - orig.length },
    );
    const was = await PDFDocument.load(orig);
    const now = await PDFDocument.load(a);
    const contents = (d) => {
      const c = d.getPage(1).node.Contents();
      return c instanceof PDFArray ? c.size() : 1;
    };
    const annots = (d) =>
      (d.getPage(1).node.Annots()?.asArray() || []).map((r) =>
        String(d.context.lookup(r).get(PDFName.of('Subtype'))),
      );
    check(
      'the updated file has every page, and the box on page 2 as an editable comment',
      now.getPageCount() === 300 && contents(now) === contents(was) && annots(now).join() === '/Square',
      { pages: now.getPageCount(), annots: annots(now), contents: [contents(was), contents(now)] },
    );
    /* with "Flatten markups" on, the box is painted into the page */
    await page.click('#btnSave');
    await page.check('#saveFlat');
    const [dlFlat] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('#saveGo'),
    ]);
    const flat = await PDFDocument.load(readFileSync(await dlFlat.path()));
    check(
      'with "Flatten markups" on, the box is painted into the page, not a comment',
      contents(flat) > contents(was) && !annots(flat).length,
      {
        annots: annots(flat),
        contents: contents(flat),
      },
    );
    await page.click('#btnSave');
    await page.uncheck('#saveFlat');
    await page.click('#saveCancel');
    /* and the app opens it again */
    const AGAIN = join(CORPUS_DIR, 'smoke-appended.pdf');
    writeFileSync(AGAIN, a);
    await open(page, AGAIN);
    check(
      'the updated file opens and draws in the app',
      await page.evaluate(() => window.ADDPDF.S.items.length === 300 && window.ADDPDF.S.items[0].rendered),
    );
    /* pages moved: the file is rebuilt, as before */
    await page.evaluate(() => window.ADDPDF.moveItem(0, 1));
    const b = await save();
    const rebuilt = await page.evaluate(() => window.ADDPDF.appended);
    check(
      'with pages moved, Save rebuilds the file',
      rebuilt === false && (await PDFDocument.load(b)).getPageCount() === 300,
      {
        appended: rebuilt,
      },
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- selecting text: across lines, over gaps, down one column ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await open(page, COLUMNS);
    await page.waitForFunction(
      () =>
        window.ADDPDF.S.items.length === 2 &&
        window.ADDPDF.S.items.every((it) => it.tl && it.tl.children.length > 40),
      null,
      { timeout: 30000 },
    );
    for (let i = 0; i < 3; i++) await page.click('#btnOut');
    await page.waitForTimeout(1500);
    const lines = (a, b) =>
      Array.from(
        { length: b - a + 1 },
        (_, k) => 'Left line ' + (a + k) + ' of the column text tail' + (a + k),
      ).join('\n');
    for (const n of [0, 1]) {
      const kind = n ? 'drawn row by row' : 'drawn column by column';
      /* scrolled until the page's first line stays put near the top */
      for (let k = 0; k < 3; k++) {
        await page.evaluate((n) => {
          const it = window.ADDPDF.S.items[n],
            st = document.getElementById('stage');
          const sp = Array.from(it.tl.children).find((s) => s.textContent.startsWith('Left line 1 '));
          st.scrollTop += sp.getBoundingClientRect().top - st.getBoundingClientRect().top - 60;
        }, n);
        await page.waitForTimeout(300);
      }
      const at = await page.evaluate((n) => {
        const out = {};
        for (const s of window.ADDPDF.S.items[n].tl.querySelectorAll('span')) {
          const r = s.getBoundingClientRect();
          /* both columns have a "tail6": the left one comes first */
          if (!(s.textContent in out)) out[s.textContent] = { x: r.left, y: r.top, w: r.width, h: r.height };
        }
        return out;
      }, n);
      const from = at['Left line 2 of the column text'],
        to = at['tail6'],
        l6 = at['Left line 6 of the column text'],
        l7 = at['Left line 7 of the column text'];
      const drag = async (x2, y2) => {
        await page.evaluate(() => getSelection().removeAllRanges());
        await page.mouse.move(from.x + 1, from.y + from.h / 2);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++)
          await page.mouse.move(
            from.x + 1 + ((x2 - from.x - 1) * k) / 10,
            from.y + from.h / 2 + ((y2 - from.y - from.h / 2) * k) / 10,
          );
        await page.mouse.up();
        return page.evaluate(() => {
          let copied = null;
          const grab = (e) => (copied = e.clipboardData.getData('text/plain'));
          document.addEventListener('copy', grab);
          document.execCommand('copy');
          document.removeEventListener('copy', grab);
          return copied;
        });
      };
      const whole = await drag(to.x + to.w - 1, to.y + to.h / 2);
      check(
        'copied text keeps its spaces and line breaks, one column (' + kind + ')',
        whole === lines(2, 6),
        whole,
      );
      /* off the words, the selection ends where the drag last crossed one
         (which, on a diagonal drag, depends on the browser): it must not
         jump back to the page's first word, nor on into the other column */
      const held = (t) =>
        typeof t === 'string' &&
        t.startsWith(lines(2, 4) + '\n') &&
        !t.includes('Right') &&
        !t.includes('line 1 ') &&
        !t.includes('line 7 ');
      const gap = await drag(l6.x + l6.w / 2, (l6.y + l6.h + l7.y) / 2);
      check('a drag ending between two lines keeps its selection (' + kind + ')', held(gap), gap);
      const gutter = await drag(to.x + to.w + 40, to.y + to.h / 2);
      check('a drag ending in the gutter keeps its selection (' + kind + ')', held(gutter), gutter);
    }
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- a jump made before the pages have loaded lands on its page ---- */
  for (const how of ['goTo', 'the page number box']) {
    const { ctx, page, errors } = await fresh(browser);
    await open(page, MIXED);
    const loaded = await page.evaluate(() => window.ADDPDF.S.items.filter((i) => i.page).length);
    if (how === 'goTo') await page.evaluate(() => window.ADDPDF.goTo(55));
    else {
      await page.fill('#pageIn', '55');
      await page.press('#pageIn', 'Enter');
    }
    await allLoaded(page);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const st = document.getElementById('stage'),
        it = window.ADDPDF.S.items[54];
      const top = it.box.offsetTop - st.scrollTop;
      return {
        current: window.ADDPDF.S.current,
        onScreen: top < st.clientHeight && top + it.box.offsetHeight > 0,
        top,
      };
    });
    check(
      'a jump by ' + how + ' made while pages load lands on page 55 (mixed sizes)',
      r.current === 55 && r.onScreen,
      {
        ...r,
        loadedWhenJumped: loaded,
      },
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- pages far from the screen leave the document, and come back whole ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await open(page, join(CORPUS_DIR, 'medium-report-300p.pdf'));
    await allLoaded(page);
    await page.waitForTimeout(800);
    /* draw a box on page 1 with the mouse */
    await page.evaluate(() => window.ADDPDF.setTool('rect'));
    const r = await page.evaluate(() => {
      const b = window.ADDPDF.S.items[0].box.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width };
    });
    await page.mouse.move(r.x + 80, r.y + 120);
    await page.mouse.down();
    await page.mouse.move(r.x + 260, r.y + 260, { steps: 6 });
    await page.mouse.up();
    await page.evaluate(() => window.ADDPDF.setTool('select'));
    const marks = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
    check('a box drawn with the mouse lands on page 1', marks === 1, { marks });
    const nodes = await page.evaluate(
      () => document.getElementById('stage').getElementsByTagName('*').length,
    );
    check('only the pages near the screen are in the document', nodes < 1500, { stageNodes: nodes });
    /* far away and back */
    await page.evaluate(() => window.ADDPDF.goTo(200));
    await page.waitForTimeout(1500);
    const away = await page.evaluate(() => window.ADDPDF.S.items[0].mounted);
    check('page 1 leaves the document when far away', away === false);
    await page.evaluate(() => window.ADDPDF.goTo(1));
    await page
      .waitForFunction(() => window.ADDPDF.S.items[0].rendered, null, { timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => {
      const it = window.ADDPDF.S.items[0];
      const spans = Array.from(it.tl.children);
      return {
        mounted: it.mounted,
        drawn: it.rendered,
        marksShown: it.anno.querySelectorAll('rect, path, polygon, line').length,
        spans: spans.length,
        fitted: spans.filter((sp) => /scaleX/.test(sp.style.transform)).length,
      };
    });
    check(
      'back on screen, page 1 is whole: drawn, its box shown',
      back.mounted && back.drawn && back.marksShown > 0,
      back,
    );
    check('its words are fitted for selecting', back.spans > 0 && back.fitted > back.spans * 0.8, back);

    /* turn, remove, undo: sizes and order hold */
    await page.evaluate(() => window.ADDPDF.rotateItem(2, 90));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.ADDPDF.removeItem(4));
    await page.waitForTimeout(600);
    check(
      'after turning and removing, every page is at its size',
      (await misSized(page)).length === 0,
      await misSized(page),
    );
    await page.click('#btnUndo');
    await page.waitForTimeout(800);
    await page.click('#btnUndo');
    await page.waitForTimeout(800);
    const n = await page.evaluate(() => window.ADDPDF.S.items.length);
    check('undo brings the page back', n === 300, { pages: n });
    check('after undo, every page is at its size', (await misSized(page)).length === 0, await misSized(page));
    const order = await page.evaluate(() =>
      window.ADDPDF.S.items.every(
        (it, i, a) => i === 0 || it.box.offsetTop >= a[i - 1].box.offsetTop + a[i - 1].box.offsetHeight - 1,
      ),
    );
    check('and in order', order);

    /* the organizer shows the pages */
    await page.evaluate(() => window.ADDPDF.organize.open());
    await page.waitForTimeout(500);
    const cells = await page.evaluate(() => document.getElementById('orgGrid').children.length);
    check('the organizer opens with every page', cells === 300, { cells });
    await page.evaluate(() => window.ADDPDF.organize.close());
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
      const r = window.ADDPDF.S.items[0].box.getBoundingClientRect();
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

  /* ---- a heavy drawing is drawn off the main thread, and looks the same ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await page
      .waitForFunction(() => window.ADDPDF.renderWorker() === 'on', null, { timeout: 10000 })
      .catch(() => {});
    check('the render worker starts', (await page.evaluate(() => window.ADDPDF.renderWorker())) === 'on');
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({
        type: 'longtask',
      });
    });
    /* 8 A1 sheets of 40,000 lines each: over a second a sheet to draw */
    await open(page, join(CORPUS_DIR, 'cad-a1-8sheets.pdf'));
    await page.evaluate(() => window.ADDPDF.goTo(2));
    await page.waitForFunction(() => window.ADDPDF.S.items[1].rendered, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const longest = await page.evaluate(() => Math.round(Math.max(0, ...window.__long)));
    check('drawing two CAD sheets never freezes the page for more than 250 ms', longest < 250, {
      longestTaskMs: longest,
    });
    /* the same page drawn here by pdf.js, against the worker's bitmap */
    const diff = await page.evaluate(async () => {
      const it = window.ADDPDF.S.items[1];
      const a = it.canvas;
      const b = document.createElement('canvas');
      b.width = a.width;
      b.height = a.height;
      const rs = a.width / Math.floor(it.vp.width);
      await it.page.render({
        canvasContext: b.getContext('2d', { alpha: false }),
        viewport: it.vp,
        transform: Math.abs(rs - 1) > 0.01 ? [rs, 0, 0, rs, 0, 0] : null,
      }).promise;
      const pa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      const pb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let off = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 48)
          off++;
      }
      /* PDFium draws a hairline at least a pixel wide where pdf.js draws it
         fainter: what has to hold is that every line is where pdf.js puts
         it. Of the pixels pdf.js inks, the share PDFium inks within a pixel */
      const W = a.width,
        H = a.height,
        ink = (p, i) => p[i] + p[i + 1] + p[i + 2] < 600;
      let inked = 0,
        near = 0;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = (y * W + x) * 4;
          if (!ink(pb, i)) continue;
          inked++;
          let hit = false;
          for (let dy = -1; dy <= 1 && !hit; dy++)
            for (let dx = -1; dx <= 1 && !hit; dx++) hit = ink(pa, ((y + dy) * W + x + dx) * 4);
          if (hit) near++;
        }
      }
      return {
        engine: it.engine,
        w: W,
        h: H,
        percentOff: +((100 * off) / (pa.length / 4)).toFixed(3),
        linesInPlace: +((100 * near) / Math.max(1, inked)).toFixed(2),
      };
    });
    /* a page of many lines is PDFium's (bench/README.md, Stage H) */
    check(
      "the worker's picture of a CAD sheet is PDFium's, every line where pdf.js draws it",
      diff.engine === 'pdfium' && diff.linesInPlace > 99,
      diff,
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- zoomed right in, the part on screen is sharp (Stage D2) ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await page
      .waitForFunction(() => window.ADDPDF.renderWorker() === 'on', null, { timeout: 10000 })
      .catch(() => {});
    await open(page, join(CORPUS_DIR, 'cad-a1-8sheets.pdf'));
    await page.waitForTimeout(2500); /* the sheet proves heavy; PDFium loads */
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({
        type: 'longtask',
      });
    });
    const sharp = detailSharp;
    for (let i = 0; i < 20; i++) {
      if ((await page.evaluate(() => window.ADDPDF.S.scale)) >= 5.99) break;
      await page.click('#btnIn');
    }
    const ok = await page
      .waitForFunction(sharp, null, { timeout: 15000, polling: 20 })
      .then(() => true)
      .catch(() => false);
    const at600 = await page.evaluate(() => {
      const it = window.ADDPDF.S.items[0];
      return {
        scale: window.ADDPDF.S.scale,
        bitmap: it.canvas.width,
        pageWidth: Math.round(it.vp.width),
        engine: it.detailEngine,
        detailPx: it.detail ? it.detail.width : 0,
        detailCss: it.detail ? parseFloat(it.detail.style.width) : 0,
      };
    });
    check(
      'at 600% the capped page gets a sharp detail of the part on screen, drawn by PDFium',
      ok && at600.bitmap < at600.pageWidth && at600.detailPx >= at600.detailCss && at600.engine === 'pdfium',
      at600,
    );
    const longestZoom = await page.evaluate(() => Math.round(Math.max(0, ...window.__long)));
    /* PDFium's picture against pdf.js drawing the same part here (on this
       thread, so left out of the freeze measured below): they differ only
       in how edges are smoothed */
    const diff = await page.evaluate(detailDiff);
    check('the detail lines up with what pdf.js draws there', diff.percentOff < 3, diff);
    await page.evaluate(() => {
      window.__long = [];
    });

    /* one step back out, still past the cap: the page's bitmap is kept, only
       the detail is drawn again */
    await page.evaluate(() => {
      window.__base = window.ADDPDF.S.items[0].canvas;
    });
    await page.click('#btnOut');
    await page
      .waitForFunction(() => document.body.classList.contains('zooming'), null, { timeout: 5000 })
      .catch(() => {});
    const stepOk = await page
      .waitForFunction(sharp, null, { timeout: 15000, polling: 20 })
      .then(() => true)
      .catch(() => false);
    check(
      'a zoom step past the cap keeps the page bitmap and redraws only the detail',
      stepOk && (await page.evaluate(() => window.ADDPDF.S.items[0].canvas === window.__base)),
    );

    /* the detail follows the reader across the sheet */
    await page.evaluate(() => {
      const st = document.getElementById('stage');
      st.scrollLeft += st.clientWidth;
      st.scrollTop += st.clientHeight;
    });
    await page.waitForTimeout(200);
    const covers = await page
      .waitForFunction(
        () => {
          const d = window.ADDPDF.S.items[0].detail;
          if (!d || !d.isConnected) return false;
          const a = d.getBoundingClientRect(),
            s = document.getElementById('stage').getBoundingClientRect();
          return (
            a.left <= s.left + 1 && a.top <= s.top + 1 && a.right >= s.right - 20 && a.bottom >= s.bottom - 20
          );
        },
        null,
        { timeout: 15000, polling: 50 },
      )
      .then(() => true)
      .catch(() => false);
    check('after scrolling, the detail covers the new part on screen', covers);
    const longest = Math.max(
      longestZoom,
      await page.evaluate(() => Math.round(Math.max(0, ...window.__long))),
    );
    check('zooming in and scrolling the sheet never freezes the page for more than 250 ms', longest < 250, {
      longestTaskMs: longest,
    });
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- the detail lines up on a page turned by the file and by the reader ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    await page
      .waitForFunction(() => window.ADDPDF.renderWorker() === 'on', null, { timeout: 10000 })
      .catch(() => {});
    await open(page, TURNED);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.ADDPDF.rotateItem(0, 90));
    await page.waitForFunction(() => window.ADDPDF.S.items[0].rendered, null, { timeout: 30000 });
    for (let i = 0; i < 20; i++) {
      if ((await page.evaluate(() => window.ADDPDF.S.scale)) >= 5.99) break;
      await page.click('#btnIn');
    }
    const ok = await page
      .waitForFunction(detailSharp, null, { timeout: 15000, polling: 20 })
      .then(() => true)
      .catch(() => false);
    const diff = ok ? await page.evaluate(detailDiff) : null;
    check(
      'on a page turned 90° by the file and 90° more by the reader, the detail lines up',
      ok && diff.engine === 'pdfium' && diff.percentOff < 3,
      diff,
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- encrypted files: drawn in the worker with their password, and
     saving says why it cannot, rather than writing blank pages ---- */
  {
    const FIX = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'packages',
      'engine',
      'test',
      'fixtures',
    );
    const { ctx, page, errors } = await fresh(browser);
    await page
      .waitForFunction(() => window.ADDPDF.renderWorker() === 'on', null, { timeout: 10000 })
      .catch(() => {});
    /* the one that needs a password: typed in, the page is drawn by the worker */
    await page.setInputFiles('#fileIn', join(FIX, 'encrypted-password.pdf'));
    await page.waitForSelector('#pwRow.show', { timeout: 10000 });
    await page.fill('#pwIn', 'secret');
    await page.click('#pwBtn');
    const drawn = await page
      .waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
        timeout: 15000,
      })
      .then(() => true)
      .catch(() => false);
    /* the worker's picture has the page's text in it, not a blank page */
    const ink = drawn
      ? await page.evaluate(() => {
          const c = window.ADDPDF.S.items[0].canvas;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
          return n;
        })
      : 0;
    check(
      'a password-protected file opens with its password and is drawn by the worker',
      drawn && ink > 200,
      {
        darkPixels: ink,
        worker: await page.evaluate(() => window.ADDPDF.renderWorker()),
      },
    );
    await page.click('#btnSave');
    let dl = null;
    page.once('download', (d) => (dl = d));
    await page.click('#saveGo');
    await page
      .waitForFunction(
        () => /password-protected/.test(document.getElementById('saveNote').textContent),
        null,
        {
          timeout: 15000,
        },
      )
      .catch(() => {});
    check(
      'saving it says the original is password-protected, and saves nothing',
      /password-protected/.test(await page.textContent('#saveNote')) && !dl,
      await page.textContent('#saveNote'),
    );
    await page.keyboard.press('Escape');
    /* the one that opens without a password but is still encrypted */
    await open(page, join(FIX, 'encrypted-open.pdf'));
    await page.click('#btnSave');
    await page.click('#saveGo');
    await page
      .waitForFunction(
        () => /password-protected/.test(document.getElementById('saveNote').textContent),
        null,
        {
          timeout: 15000,
        },
      )
      .catch(() => {});
    check(
      'an encrypted file that opens without a password is not saved blank either',
      /password-protected/.test(await page.textContent('#saveNote')) && !dl,
      await page.textContent('#saveNote'),
    );
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---- a page pdf.js cannot load must not stop search or saving ---- */
  {
    const { ctx, page, errors } = await fresh(browser);
    /* page 150 of the file fails to load, as a damaged page would */
    await page.evaluate(() => {
      const watch = () => {
        const src = window.ADDPDF.S.sources[0];
        if (src && src.doc && !src.doc.__bad) {
          const get = src.doc.getPage.bind(src.doc);
          src.doc.getPage = (n) => (n === 150 ? Promise.reject(new Error('damaged page')) : get(n));
          src.doc.__bad = true;
        } else if (!src) setTimeout(watch, 0);
      };
      watch();
    });
    await open(page, PREFILLED);
    check(
      'a file with an unloadable page opens',
      await page.evaluate(() => window.ADDPDF.S.items.length === 400),
    );
    await page.waitForTimeout(4000);
    await page.click('#btnFind');
    await page.fill('#findIn', 'nothing here');
    const done = await page
      .waitForFunction(
        () => /matches|No matches/.test(document.getElementById('hitCount').textContent),
        null,
        {
          timeout: 30000,
        },
      )
      .then(() => true)
      .catch(() => false);
    check('search over it completes', done, await page.textContent('#hitCount'));
    await page.click('#btnSave');
    const dl = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#saveGo')])
      .then((r) => r[0])
      .catch(() => null);
    check('it still saves', !!dl, await page.textContent('#saveNote'));
    if (dl) {
      const out = await PDFDocument.load(readFileSync(await dl.path()));
      const c = out.getPage(399).node.Contents();
      const refs = c instanceof PDFArray ? c.asArray() : [c];
      const text = refs
        .map((r) => Buffer.from(decodePDFRawStream(out.context.lookup(r)).decode()).toString('latin1'))
        .join('');
      check(
        'fields after the bad page are still read: page 400 is saved filled in',
        text.includes(Buffer.from('Prefilled on page 400').toString('hex').toUpperCase()),
      );
    }
    check('no errors on the page', errors.length === 0, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
