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
          Math.abs(it.box.offsetWidth - Math.floor(v.width)) > 1 ||
          Math.abs(it.box.offsetHeight - Math.floor(v.height)) > 1;
        return off ? i + 1 : 0;
      })
      .filter(Boolean);
  });

await ensureCorpus();
const MIXED = join(CORPUS_DIR, 'smoke-mixed-60p.pdf');
const PREFILLED = join(CORPUS_DIR, 'smoke-prefilled-400p.pdf');
writeFileSync(MIXED, await mixedPdf());
writeFileSync(PREFILLED, await prefilledPdf());
/* the CAD sheets, the first turned a quarter by the file itself (/Rotate) */
const TURNED = join(CORPUS_DIR, 'smoke-cad-turned.pdf');
{
  const d = await PDFDocument.load(readFileSync(join(CORPUS_DIR, 'cad-a1-8sheets.pdf')));
  d.getPage(0).setRotation(degrees(90));
  writeFileSync(TURNED, await d.save());
}

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
    const workersBefore = page.workers().length;
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
    /* pdf.js's parser, the render worker and the render worker's own parser */
    check(
      'no new workers for the second file',
      page.workers().length === workersBefore && workersBefore <= 3,
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
      return { w: a.width, h: a.height, percentOff: +((100 * off) / (pa.length / 4)).toFixed(3) };
    });
    check("the worker's picture matches pdf.js drawing it here", diff.percentOff < 0.5, diff);
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
