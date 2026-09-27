/* Performance benchmark for the web app.

     npm run bench -w @adddots/web                  build, then measure every file
     node bench/run.mjs --label after --only cad    measure some files (substring match)

   Serves apps/web/dist with `vite preview`, opens each benchmark PDF (see
   corpus.mjs) in a fresh headless Chromium and measures what a reader feels:
   time to first page, a fast scroll, a jump to the end, zooming in, search,
   memory and saving. Results go to bench/results/<label>.json and a table is
   printed. Timings from a shared or throttled machine are noisy: compare runs
   made on the same machine, and prefer --runs 3 (medians) for decisions.

   Browser: Playwright's Chromium by default; BENCH_CHANNEL=chrome or msedge
   uses an installed browser instead. */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const LABEL = opt('label', 'run');
const ONLY = opt('only', '');
const RUNS = Math.max(1, parseInt(opt('runs', '1'), 10));
/* another build to serve instead of dist/ (e.g. a saved copy of the baseline) */
const DIST = opt('dist', join(app, 'dist'));
const PORT = 4174;
const VIEWPORT = { width: 1440, height: 900 };

const { chromium } = await import('playwright-core');

/* ---------- memory of the whole browser (Linux) ---------- */

/** Proportional set size of the browser's processes and everything under them,
    in MB: browser, renderer, GPU, utilities. PSS shares shared pages fairly
    between processes, so the total is not double counted. */
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
      /* gone, or not ours to read */
    }
  }
  return Math.round(kb / 1024);
}

/* ---------- what runs inside the page ---------- */

/* installed before the app loads: long tasks, and the moment a file is chosen */
function instrument() {
  const B = (window.__bench = { longTasks: [], t0: 0, firstPage: 0 });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) B.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long-task timing in this browser */
  }
  document.addEventListener(
    'change',
    (e) => {
      if (e.target && e.target.id === 'fileIn') {
        B.t0 = performance.now();
        B.firstPage = 0;
        const watch = () => {
          const it = window.ADDPDF && window.ADDPDF.S.items[0];
          if (it && it.rendered) B.firstPage = performance.now() - B.t0;
          else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }
    },
    true,
  );
}

/* in-page helpers, as source so they can be evaluated in the page */
const HELPERS = `
  window.__visible = function () {
    const S = window.ADDPDF.S, st = document.getElementById('stage');
    const top = st.scrollTop, bot = top + st.clientHeight;
    return S.items.filter(function (it) {
      if (!it.box) return false;
      const y = it.box.offsetTop, h = it.box.offsetHeight;
      return y + h > top && y < bot;
    });
  };
  window.__settled = function () {
    const vis = window.__visible();
    return vis.length > 0 && !document.body.classList.contains('zooming') &&
      vis.every(function (it) { return it.rendered && !it.task; });
  };
  window.__blocking = function (from, to) {
    let tbt = 0, max = 0;
    window.__bench.longTasks.forEach(function (t) {
      if (t.start + t.dur < from || t.start > to) return;
      tbt += Math.max(0, t.dur - 50); max = Math.max(max, t.dur);
    });
    return { tbt: Math.round(tbt), maxTask: Math.round(max) };
  };
`;

async function waitSettled(page, timeout) {
  await page.waitForFunction(() => window.__settled(), null, { timeout, polling: 50 });
}

async function memory(page, cdp, browser) {
  const inPage = await page.evaluate(() => {
    /* only canvases that hold a picture: an untouched <canvas> is 300 x 150 and
       a released one 1 x 1, and the browser allocates neither */
    let px = 0;
    document.querySelectorAll('canvas').forEach((c) => {
      if (c.width * c.height > 1 && !(c.width === 300 && c.height === 150)) px += c.width * c.height;
    });
    return { domNodes: document.getElementsByTagName('*').length, canvasMB: Math.round((px * 4) / 1048576) };
  });
  const { metrics } = await cdp.send('Performance.getMetrics');
  const heap = metrics.find((m) => m.name === 'JSHeapUsedSize');
  return {
    browserMB: await browserPssMB(browser),
    jsHeapMB: heap ? Math.round(heap.value / 1048576) : null,
    workers: page.workers().length,
    ...inPage,
  };
}

/* ---------- one file ---------- */

async function measure(browser, file) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(instrument);
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc, null, { timeout: 30000 });
  await page.evaluate(HELPERS);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const r = { file: file.name, kind: file.kind, sizeKB: Math.round(file.bytes / 1024) };

  /* open */
  await page.setInputFiles('#fileIn', file.path);
  await page.waitForFunction(() => window.__bench.firstPage > 0, null, { timeout: 300000, polling: 50 });
  await waitSettled(page, 300000);
  Object.assign(
    r,
    await page.evaluate(() => {
      const B = window.__bench;
      const b = window.__blocking(B.t0, performance.now());
      return {
        pages: window.ADDPDF.S.items.length,
        firstPageMs: Math.round(B.firstPage),
        openSettledMs: Math.round(performance.now() - B.t0),
        openTBT: b.tbt,
        openMaxTask: b.maxTask,
      };
    }),
  );
  /* let the rest of the opening (thumbnails, form scan) finish before scrolling */
  await page.waitForTimeout(1500);
  r.memAfterOpen = await memory(page, cdp, browser);

  /* a fast scroll: 3600 px/s for 4 s, as a reader flicking through */
  Object.assign(
    r,
    await page.evaluate(
      () =>
        new Promise((done) => {
          const st = document.getElementById('stage');
          const S = window.ADDPDF.S;
          const t0 = performance.now();
          let last = t0;
          const gaps = [];
          let blank = 0,
            frames = 0;
          const step = (now) => {
            gaps.push(now - last);
            last = now;
            frames++;
            /* is the page in the middle of the screen drawn yet? */
            const mid = st.scrollTop + st.clientHeight / 2;
            const it = S.items.find(
              (x) => x.box && x.box.offsetTop <= mid && x.box.offsetTop + x.box.offsetHeight >= mid,
            );
            if (it && !it.rendered) blank++;
            if (now - t0 < 4000) {
              st.scrollTop += 3600 * (gaps[gaps.length - 1] / 1000 || 1 / 60);
              requestAnimationFrame(step);
            } else {
              gaps.sort((a, b) => a - b);
              const b = window.__blocking(t0, now);
              done({
                scrollFrames: frames,
                scrollP95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] || 0),
                scrollJankFrames: gaps.filter((g) => g > 50).length,
                scrollBlankPct: Math.round((blank / frames) * 100),
                scrollTBT: b.tbt,
              });
            }
          };
          requestAnimationFrame(step);
        }),
    ),
  );
  await waitSettled(page, 120000);

  /* jump to the last page */
  r.jumpEndMs = await page.evaluate(
    () =>
      new Promise((done) => {
        const S = window.ADDPDF.S;
        const t0 = performance.now();
        window.ADDPDF.goTo(S.items.length);
        const it = S.items[S.items.length - 1];
        const watch = () =>
          it.rendered ? done(Math.round(performance.now() - t0)) : requestAnimationFrame(watch);
        requestAnimationFrame(watch);
      }),
  );
  await waitSettled(page, 120000);

  /* zoom in three steps, then until the visible pages are sharp again */
  const zt0 = await page.evaluate(() => performance.now());
  for (let i = 0; i < 3; i++) await page.click('#btnIn');
  await page.waitForFunction(() => document.body.classList.contains('zooming') === false, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(250); /* the settle is debounced */
  await waitSettled(page, 120000);
  Object.assign(
    r,
    await page.evaluate((t0) => {
      const b = window.__blocking(t0, performance.now());
      return { zoomSettleMs: Math.round(performance.now() - t0), zoomTBT: b.tbt };
    }, zt0),
  );

  /* search every page for a word the text files contain */
  const st0 = await page.evaluate(() => performance.now());
  await page.click('#btnFind');
  await page.fill('#findIn', 'engineer');
  await page.waitForFunction(
    () => {
      const t = document.getElementById('hitCount').textContent;
      return t && !/Reading/.test(t) && !/two characters/.test(t);
    },
    null,
    { timeout: 300000, polling: 100 },
  );
  Object.assign(
    r,
    await page.evaluate((t0) => {
      const b = window.__blocking(t0, performance.now());
      return {
        searchMs: Math.round(performance.now() - t0 - 220) /* the input is debounced 220 ms */,
        searchTBT: b.tbt,
        searchResult: document.getElementById('hitCount').textContent,
      };
    }, st0),
  );

  r.memAfterUse = await memory(page, cdp, browser);

  /* save */
  const sv0 = await page.evaluate(() => performance.now());
  await page.click('#btnSave');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('#saveGo')]);
  Object.assign(
    r,
    await page.evaluate((t0) => {
      const b = window.__blocking(t0, performance.now());
      return { saveMs: Math.round(performance.now() - t0), saveMaxTask: b.maxTask };
    }, sv0),
  );
  await dl.delete();

  r.errors = errors;
  await ctx.close();
  return r;
}

/* ---------- report ---------- */

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
function combine(runs) {
  const out = { ...runs[runs.length - 1] };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'number') out[k] = median(runs.map((r) => r[k]));
    else if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = { ...out[k] };
      for (const j of Object.keys(out[k])) out[k][j] = median(runs.map((r) => r[k][j]));
    }
  }
  return out;
}

const COLS = [
  ['file', (r) => r.file.replace(/\.pdf$/, '')],
  ['pages', (r) => r.pages],
  ['first page ms', (r) => r.firstPageMs],
  ['open ms', (r) => r.openSettledMs],
  ['open TBT', (r) => r.openTBT],
  ['scroll p95 ms', (r) => r.scrollP95FrameMs],
  ['scroll jank', (r) => r.scrollJankFrames],
  ['scroll blank %', (r) => r.scrollBlankPct],
  ['jump end ms', (r) => r.jumpEndMs],
  ['zoom ms', (r) => r.zoomSettleMs],
  ['search ms', (r) => r.searchMs],
  ['save ms', (r) => r.saveMs],
  ['save max task', (r) => r.saveMaxTask],
  ['browser MB', (r) => r.memAfterUse.browserMB],
  ['JS heap MB', (r) => r.memAfterUse.jsHeapMB],
  ['canvas MB', (r) => r.memAfterUse.canvasMB],
  ['DOM nodes', (r) => r.memAfterUse.domNodes],
  ['workers', (r) => r.memAfterUse.workers],
];

export function table(results) {
  const head = '| ' + COLS.map((c) => c[0]).join(' | ') + ' |';
  const sep = '|' + COLS.map(() => '---').join('|') + '|';
  return [head, sep, ...results.map((r) => '| ' + COLS.map((c) => c[1](r) ?? '–').join(' | ') + ' |')].join(
    '\n',
  );
}

const corpus = (await ensureCorpus()).filter((f) => !ONLY || f.name.includes(ONLY));
const server = await serve(DIST, PORT);
const channel = process.env.BENCH_CHANNEL || undefined;
const results = [];
try {
  for (const file of corpus) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const browser = await chromium.launch({ channel, args: ['--enable-precise-memory-info'] });
      try {
        runs.push(await measure(browser, file));
      } finally {
        await browser.close();
      }
    }
    const r = combine(runs);
    results.push(r);
    console.log(file.name, JSON.stringify(r));
  }
} finally {
  server.kill();
}

mkdirSync(join(here, 'results'), { recursive: true });
const out = {
  label: LABEL,
  date: new Date().toISOString(),
  runs: RUNS,
  viewport: VIEWPORT,
  cpus: (await import('node:os')).cpus().length,
  results,
};
writeFileSync(join(here, 'results', LABEL + '.json'), JSON.stringify(out, null, 2) + '\n');
console.log('\n' + table(results));
