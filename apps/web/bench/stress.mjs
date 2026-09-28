/* A long session: the same page opens file after file and, on each, scrolls,
   zooms, searches, marks and saves, round after round. After every round
   the page's garbage is collected and its memory measured, so memory that
   only grows (a leak: a closed file, a page's bitmaps or a worker's copy
   kept alive) shows as a rising line where it should stay level.

     npm run build && node bench/stress.mjs [--rounds 12] [--label name]

   Writes results/stress-<label>.json and prints one row a round. */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const ROUNDS = +opt('rounds', '12');
const LABEL = opt('label', 'run');
const PORT = 4175;
const FILES = ['medium-report-300p.pdf', 'cad-a1-8sheets.pdf', 'scans-40p.pdf', 'large-text-2000p.pdf'];

/* the browser's processes and their children, proportional set size, MB */
async function browserPssMB(browser) {
  if (!existsSync('/proc')) return null;
  const s = await browser.newBrowserCDPSession();
  const { processInfo } = await s.send('SystemInfo.getProcessInfo');
  await s.detach();
  const parent = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync('/proc/' + d + '/stat', 'utf8');
      parent.set(+d, +stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch {
      /* gone */
    }
  }
  const tree = new Set(processInfo.map((p) => p.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, pp] of parent) if (!tree.has(pid) && tree.has(pp)) (tree.add(pid), (grew = true));
  }
  let kb = 0;
  const byType = {};
  const typeOf = new Map(processInfo.map((p) => [p.id, p.type]));
  for (const pid of tree) {
    try {
      const m = /Pss:\s+(\d+) kB/.exec(readFileSync('/proc/' + pid + '/smaps_rollup', 'utf8'));
      if (m) {
        kb += +m[1];
        const t = typeOf.get(pid) || 'other';
        byType[t] = (byType[t] || 0) + +m[1];
      }
    } catch {
      /* gone */
    }
  }
  lastByType = Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)]));
  return Math.round(kb / 1024);
}
let lastByType = {};

await ensureCorpus();
const server = await serve(join(here, '..', 'dist'), PORT);
const browser = await chromium.launch({ channel: process.env.BENCH_CHANNEL || undefined });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.goto('http://localhost:' + PORT + '/');
await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);

if (process.env.WHERE) await page.evaluate(() => (window.__where = true));
const rows = [];
const t0 = Date.now();
for (let r = 1; r <= ROUNDS; r++) {
  const file = FILES[(r - 1) % FILES.length];
  const tr = Date.now();
  await page.evaluate(() => (window.__before = window.ADDPDF.S.items[0] || null));
  await page.setInputFiles('#fileIn', join(CORPUS_DIR, file));
  await page.waitForFunction(
    () => {
      const it = window.ADDPDF.S.items[0];
      return it && it !== window.__before && it.rendered;
    },
    null,
    { timeout: 120000 },
  );
  await page.waitForFunction(() => window.ADDPDF.S.items.every((i) => i.page && !i.estimated), null, {
    timeout: 120000,
  });
  /* read it: jump through, scroll a while, zoom in and out */
  for (const at of [0.33, 0.66, 1]) {
    await page.evaluate(
      (f) => window.ADDPDF.goTo(Math.max(1, Math.round(window.ADDPDF.S.items.length * f))),
      at,
    );
    await page.waitForTimeout(600);
  }
  await page.evaluate(
    () =>
      new Promise((done) => {
        const st = document.getElementById('stage');
        const end = performance.now() + 1500;
        const step = () => {
          st.scrollTop -= 60;
          if (performance.now() < end) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
  );
  for (let i = 0; i < 3; i++) await page.click('#btnIn');
  await page.waitForTimeout(900);
  for (let i = 0; i < 3; i++) await page.click('#btnOut');
  await page.waitForTimeout(900);
  /* search, then mark page 1 and save */
  await page.click('#btnFind');
  await page.fill('#findIn', 'engineer');
  await page.waitForFunction(
    () => {
      const t = document.getElementById('hitCount').textContent;
      return t && !/Reading/.test(t) && !/two characters/.test(t);
    },
    null,
    { timeout: 120000 },
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    window.ADDPDF.S.items[0].shapes.push({
      t: 'rect',
      a: [60, 60],
      b: [200, 140],
      c: '#E2483D',
      w: 2,
      id: 'st' + Date.now(),
    }),
  );
  await page.click('#btnSave');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#saveGo')]);
  await dl.delete();
  await page.waitForTimeout(1500);

  /* measure, with the garbage collected */
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const heap = metrics.find((m) => m.name === 'JSHeapUsedSize');
  const inPage = await page.evaluate(() => {
    let px = 0,
      canvases = 0;
    document.querySelectorAll('canvas').forEach((c) => {
      if (c.width * c.height > 1 && !(c.width === 300 && c.height === 150)) {
        px += c.width * c.height;
        canvases++;
      }
    });
    const S = window.ADDPDF.S;
    /* where the elements are, when asked */
    const where = {};
    if (window.__where) {
      for (const el of document.getElementsByTagName('*')) {
        const host = el.closest('#stage')
          ? 'stage'
          : el.closest('#railPages')
            ? 'rail'
            : el.closest('#hitList, .hits, #findPanel')
              ? 'find'
              : 'other';
        const k =
          host +
          ':' +
          (el.className && typeof el.className === 'string'
            ? el.className.split(' ')[0]
            : el.tagName.toLowerCase());
        where[k] = (where[k] || 0) + 1;
      }
    }
    return {
      where: Object.entries(where)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
      domNodes: document.getElementsByTagName('*').length,
      canvases,
      canvasMB: Math.round((px * 4) / 1048576),
      pages: S.items.length,
      sources: S.sources.length,
    };
  });
  const row = {
    round: r,
    file,
    ms: Date.now() - tr,
    browserMB: await browserPssMB(browser),
    byProcess: lastByType,
    jsHeapMB: heap ? Math.round(heap.value / 1048576) : null,
    workers: page.workers().length,
    ...inPage,
  };
  rows.push(row);
  if (process.env.WHERE) console.log('   ', JSON.stringify(row.where));
  delete row.where;
  console.log(
    [
      row.round,
      row.file.padEnd(24),
      row.ms + ' ms',
      row.browserMB + ' MB',
      'heap ' + row.jsHeapMB,
      'dom ' + row.domNodes,
      'canvases ' + row.canvases + ' (' + row.canvasMB + ' MB)',
      'workers ' + row.workers,
      'sources ' + row.sources,
      JSON.stringify(row.byProcess),
    ].join('  '),
  );
}

/* the same file, a lap apart: what one lap of the session left behind */
const laps = [];
for (let r = FILES.length; r < rows.length; r++) {
  laps.push({
    file: rows[r].file,
    round: rows[r].round,
    browserMB: rows[r].browserMB - rows[r - FILES.length].browserMB,
    jsHeapMB: rows[r].jsHeapMB - rows[r - FILES.length].jsHeapMB,
  });
}
console.log('\ngrowth over one lap (same file, ' + FILES.length + ' rounds apart):');
for (const l of laps)
  console.log(
    '  round ' +
      l.round +
      ' ' +
      l.file.padEnd(24) +
      ' browser ' +
      l.browserMB +
      ' MB, heap ' +
      l.jsHeapMB +
      ' MB',
  );
console.log(
  'errors on the page:',
  errors.length ? errors : 'none',
  '  total',
  Math.round((Date.now() - t0) / 1000) + ' s',
);
writeFileSync(
  join(here, 'results', 'stress-' + LABEL + '.json'),
  JSON.stringify({ label: LABEL, date: new Date().toISOString(), rows, laps, errors }, null, 2) + '\n',
);
await browser.close();
server.kill();
process.exit(0);
