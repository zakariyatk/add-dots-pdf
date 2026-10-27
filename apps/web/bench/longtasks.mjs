/* The page thread's long tasks (over 50 ms: the page cannot answer) during
   search, Edit Object and Convert, on the corpus files; see
   docs/windows-performance.md, phase 4.

     npm run build && node bench/longtasks.mjs [search|eo|convert]

   P4_SAVE=<dir> keeps the converted files, to compare them across a change. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

const PORT = 4188,
  URL = 'http://localhost:' + PORT + '/';
await ensureCorpus();
const server = await serve(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'), PORT);
const browser = await chromium.launch({ channel: process.env.BENCH_CHANNEL || undefined });
const only = process.argv[2] || '';

async function open(file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({
      type: 'longtask',
      buffered: true,
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.setInputFiles('#fileIn', join(CORPUS_DIR, file));
  await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
    timeout: 60000,
  });
  /* the opening settled (first pages, thumbnails), so what is measured is the work itself */
  await page.waitForTimeout(4000);
  return { ctx, page, errors };
}
/* long tasks from now until fn resolves */
async function longDuring(page, label, fn) {
  await page.evaluate(() => {
    window.__long = [];
  });
  const t = Date.now();
  const extra = await fn();
  const ms = Date.now() - t;
  await page.waitForTimeout(300);
  const l = await page.evaluate(() => window.__long.slice());
  const sum = Math.round(l.reduce((a, b) => a + b, 0)),
    max = Math.round(Math.max(0, ...l));
  console.log(
    label.padEnd(44),
    'took',
    String(ms).padStart(6),
    'ms | long tasks',
    String(l.length).padStart(3),
    'sum',
    String(sum).padStart(6),
    'max',
    String(max).padStart(5),
    extra ? JSON.stringify(extra) : '',
  );
}

if (!only || only === 'search') {
  const { ctx, page } = await open('large-text-2000p.pdf');
  /* text indexing in the background, then a search through all of it */
  await longDuring(page, 'search 2000p (indexing as it goes)', async () => {
    await page.click('#btnFind');
    await page.fill('#findIn', 'page');
    await page.waitForFunction(
      () => /match|No matches/.test(document.getElementById('hitCount').textContent),
      null,
      { timeout: 120000 },
    );
    return page.evaluate(() => window.ADDPDF.S.hits.length);
  });
  await longDuring(page, 'search 2000p again (text cached)', async () => {
    await page.fill('#findIn', 'lorem');
    await page.waitForFunction(
      () => /match|No matches/.test(document.getElementById('hitCount').textContent),
      null,
      { timeout: 120000 },
    );
    return page.evaluate(() => window.ADDPDF.S.hits.length);
  });
  await ctx.close();
}

async function editObject(file, label) {
  const { ctx, page, errors } = await open(file);
  await page.evaluate(() => window.ADDPDF.setTool('editobj'));
  const box = await page.evaluate(() => {
    const r = window.ADDPDF.S.items[0].anno.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height];
  });
  /* pointing at the page: its content is read (pdf-lib load, shapes, text) */
  await longDuring(page, 'Edit Object, first point: ' + label, async () => {
    for (let k = 0; k < 40; k++) {
      await page.mouse.move(box[0] + box[2] * (0.2 + 0.015 * k), box[1] + box[3] * (0.3 + 0.01 * k));
      if (await page.evaluate(() => !!document.querySelector('.anno .eohl'))) return { lit: k };
      await page.waitForTimeout(250);
    }
    return { lit: false };
  });
  const lit = await page.evaluate(() => !!document.querySelector('.anno .eohl'));
  if (lit) {
    await longDuring(page, 'Edit Object, lift one: ' + label, async () => {
      const before = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
      await page.mouse.down();
      await page.mouse.up();
      await page
        .waitForFunction((b) => window.ADDPDF.S.items[0].shapes.length > b, before, { timeout: 60000 })
        .catch(() => {});
      return { marks: await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length) };
    });
  }
  if (errors.length) console.log('  errors', errors);
  await ctx.close();
}
if (!only || only === 'eo') {
  await editObject('cad-a1-8sheets.pdf', 'CAD 13 MB');
  await editObject('medium-report-300p.pdf', 'report 300p');
}

async function convert(file, kind, label) {
  const { ctx, page, errors } = await open(file);
  await longDuring(page, 'Convert ' + kind + ': ' + label, async () => {
    const dl = page.waitForEvent('download', { timeout: 300000 }).catch(() => null);
    await page.evaluate((k) => {
      window.ADDPDF.convert.open(k);
    }, kind);
    await page.evaluate((k) => window.ADDPDF.convert.run(k), kind);
    const d = await dl;
    if (d && process.env.P4_SAVE) await d.saveAs(join(process.env.P4_SAVE, d.suggestedFilename()));
    return { file: d && d.suggestedFilename() };
  });
  if (errors.length) console.log('  errors', errors);
  await ctx.close();
}
if (!only || only === 'convert') {
  await convert('medium-report-300p.pdf', 'word', 'report 300p');
  await convert('medium-report-300p.pdf', 'excel', 'report 300p');
  await convert('cad-a1-8sheets.pdf', 'cad', 'CAD 13 MB');
}
await browser.close();
process.exit(0);
