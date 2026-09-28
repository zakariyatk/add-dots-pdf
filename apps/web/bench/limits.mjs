/* The app at its limits: files well past the everyday ones (see LIMITS in
   corpus.mjs): 10,000 pages, 326 MB of scans, one sheet of 400,000 lines.
   Each opens in a fresh tab, which is watched for a crash; then page 1,
   all pages, a jump to the end, and a save with a mark, each timed, with
   the longest freeze and the browser's memory.

     npm run build && node bench/limits.mjs [--only name] [--label name]

   Writes results/limits-<label>.json. */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureLimits } from './corpus.mjs';
import { serve } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const ONLY = opt('only', '');
const LABEL = opt('label', 'run');
const PORT = 4186;

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
  for (const pid of tree) {
    try {
      const m = /Pss:\s+(\d+) kB/.exec(readFileSync('/proc/' + pid + '/smaps_rollup', 'utf8'));
      if (m) kb += +m[1];
    } catch {
      /* gone */
    }
  }
  return Math.round(kb / 1024);
}

const files = (await ensureLimits()).filter((f) => !ONLY || f.name.includes(ONLY));
const server = await serve(join(here, '..', 'dist'), PORT);
const browser = await chromium.launch({ channel: process.env.BENCH_CHANNEL || undefined });
const results = [];

for (const f of files) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const r = {
    file: f.name,
    kind: f.kind,
    sizeMB: Math.round(statSync(f.path).size / 1048576),
    errors: [],
    crashed: false,
  };
  page.on('pageerror', (e) => r.errors.push(e.message.slice(0, 200)));
  page.on('crash', () => (r.crashed = true));
  const step = async (name, fn) => {
    if (r.crashed) return;
    const t = Date.now();
    try {
      await fn();
      r[name + 'Ms'] = Date.now() - t;
    } catch (e) {
      r[name + 'Ms'] = null;
      r.errors.push(name + ': ' + String(e.message).split('\n')[0].slice(0, 200));
    }
  };
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration))),
    ).observe({
      type: 'longtask',
    });
    window.__before = window.ADDPDF.S.items[0] || null;
  });
  await step('firstPage', async () => {
    await page.setInputFiles('#fileIn', f.path);
    await page.waitForFunction(
      () => {
        const it = window.ADDPDF.S.items[0];
        return it && it !== window.__before && it.rendered;
      },
      null,
      { timeout: 300000, polling: 100 },
    );
  });
  await step('allPages', () =>
    page.waitForFunction(() => window.ADDPDF.S.items.every((i) => i.page && !i.estimated), null, {
      timeout: 600000,
      polling: 250,
    }),
  );
  await step('jumpEnd', async () => {
    await page.evaluate(() => window.ADDPDF.goTo(window.ADDPDF.S.items.length));
    await page.waitForFunction(() => window.ADDPDF.S.items[window.ADDPDF.S.items.length - 1].rendered, null, {
      timeout: 300000,
      polling: 100,
    });
  });
  if (!r.crashed) {
    r.pages = await page.evaluate(() => window.ADDPDF.S.items.length).catch(() => null);
    r.browserMBOpen = await browserPssMB(browser);
  }
  await step('save', async () => {
    await page.evaluate(() =>
      window.ADDPDF.S.items[0].shapes.push({
        t: 'rect',
        a: [60, 60],
        b: [200, 140],
        c: '#E2483D',
        w: 2,
        id: 'lim',
      }),
    );
    await page.click('#btnSave');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 600000 }),
      page.click('#saveGo'),
    ]);
    r.savedMB = Math.round(statSync(await dl.path()).size / 1048576);
    await dl.delete();
  });
  if (!r.crashed) {
    r.appended = await page.evaluate(() => window.ADDPDF.appended).catch(() => null);
    const long = await page.evaluate(() => window.__long).catch(() => []);
    r.longestTaskMs = long.length ? Math.max(...long) : 0;
    r.blockedMs = long.reduce((a, b) => a + Math.max(0, b - 50), 0);
    r.browserMBPeak = await browserPssMB(browser);
  }
  results.push(r);
  console.log(JSON.stringify(r));
  await ctx.close().catch(() => {});
}

writeFileSync(
  join(here, 'results', 'limits-' + LABEL + '.json'),
  JSON.stringify({ label: LABEL, date: new Date().toISOString(), results }, null, 2) + '\n',
);
await browser.close();
server.kill();
process.exit(0);
