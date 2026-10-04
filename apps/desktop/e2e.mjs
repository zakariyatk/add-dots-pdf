/* The desktop app, end to end: the built app driven the way a person uses
   it from Explorer.

     npx tauri build --debug --no-bundle && node e2e.mjs

   - started with a PDF as its argument (a double-click in Explorer), the
     PDF opens and page 1 is drawn, natively by PDFium (the render worker
     ready for what PDFium leaves to pdf.js)
   - no service worker in the app; the page reads only files it was handed
   - a second start with another PDF (a second double-click) opens it in a
     new tab of the window already open, and quits
   - Save, from that tab, writes the file (ADDDOTS_SAVE_TO stands in for the
     Save dialog), a PDF with every page

   Windows: Playwright over WebView2's DevTools port, which the app opens
   only when ADDDOTS_DEVTOOLS_PORT is set (Microsoft's way to test a WebView2
   app; Edge's WebDriver cannot find this app's WebView2). Linux: tauri-driver
   (WebDriver), with WebKitWebDriver and a display (xvfb-run). */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
const APP =
  process.env.APP || join(here, 'src-tauri', 'target', 'debug', WIN ? 'adddots-pdf.exe' : 'adddots-pdf');
const PORT = 4444;
const W = 'http://127.0.0.1:' + PORT;
const CDP = 9333;

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  if (!ok) failed++;
}

async function makePdf(path, pages, label) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = d.addPage([595, 842]);
    p.drawText(label + ', page ' + i, { x: 60, y: 760, size: 24, font: f });
  }
  writeFileSync(path, await d.save());
}

const dir = mkdtempSync(join(tmpdir(), 'adddots-e2e-'));
const saveTo = mkdtempSync(join(tmpdir(), 'adddots-saved-'));
const A = join(dir, 'first.pdf'),
  B = join(dir, 'second.pdf');
await makePdf(A, 3, 'First');
await makePdf(B, 5, 'Second');

if (!existsSync(APP)) {
  console.error('no app at ' + APP + ': build it first (npx tauri build --debug --no-bundle)');
  process.exit(1);
}
const env = { ...process.env, ADDDOTS_SAVE_TO: saveTo, ADDDOTS_DEVTOOLS_PORT: String(CDP) };
const driver = WIN
  ? null
  : spawn('tauri-driver', ['--port', String(PORT)], { env, stdio: ['ignore', 'inherit', 'inherit'] });

async function wd(method, path, body) {
  const r = await fetch(W + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + path + ': ' + JSON.stringify(j.value || j).slice(0, 300));
  return j.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Windows: the app started as Explorer starts it, then Playwright attached
   to its WebView2 */
async function viaDevTools() {
  const proc = spawn(APP, [A], { env, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 120 && !browser; i++) {
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP).catch(() => null);
    if (!browser) await sleep(500);
  }
  if (!browser) throw new Error('no DevTools on port ' + CDP + ': the app did not start its WebView2');
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => /tauri/.test(p.url()));
    if (!page) await sleep(500);
  }
  if (!page)
    throw new Error(
      'no app page among ' +
        browser
          .contexts()
          .flatMap((c) => c.pages())
          .map((p) => p.url()),
    );
  const run = (fn, arg) => page.evaluate(fn, arg);
  return { run, runAsync: run, close: async () => (await browser.close().catch(() => {}), proc.kill()) };
}

/* Linux: tauri-driver starts the app with the PDF */
async function viaWebDriver() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(W + '/status');
      break;
    } catch {
      await sleep(200);
    }
  }
  const s = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: { 'tauri:options': { application: APP, args: [A] } },
    },
  });
  const sid = s.sessionId;
  const run = (fn, ...args) =>
    wd('POST', '/session/' + sid + '/execute/sync', {
      script: 'return (' + fn + ').apply(null, arguments)',
      args,
    });
  const runAsync = (fn, ...args) =>
    wd('POST', '/session/' + sid + '/execute/async', {
      script:
        'var done = arguments[arguments.length - 1]; (' +
        fn +
        ').apply(null, Array.prototype.slice.call(arguments, 0, -1)).then(done, function (e) { done({ error: String(e) }); });',
      args,
    });
  return { run, runAsync, close: () => wd('DELETE', '/session/' + sid).catch(() => {}) };
}

let app = null;
try {
  app = WIN ? await viaDevTools() : await viaWebDriver();
  const { run, runAsync } = app;
  const until = async (fn, ms = 30000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const v = await run(fn).catch(() => null);
      if (v) return v;
      await sleep(200);
    }
    return null;
  };

  /* ---- started from Explorer with a PDF ---- */
  const first = await until(() => {
    const a = window.ADDPDF;
    const it = a && a.S && a.S.items[0];
    return it && it.rendered && a.S.sources[0]
      ? {
          pages: a.S.items.length,
          name: a.S.sources[0].name,
          worker: a.renderWorker(),
          ranged: !!a.S.sources[0].lazy,
        }
      : null;
  }, 60000);
  check(
    'started with a PDF, it opens and page 1 is drawn',
    !!first && first.pages === 3 && first.name === 'first.pdf',
    first,
  );
  /* ADDDOTS_RANGE_MB=0: every file is "big", read a part at a time from
     the file kept open (core.js RANGED), as one over 150 MB is */
  if (process.env.ADDDOTS_RANGE_MB === '0') {
    check('a big file is read a part at a time, not whole', !!first && first.ranged, first);
  }
  /* the render worker says ready only once pdf.js has opened and drawn a
     page in it (up to two tries of 8 s); pages are drawn on the page
     meanwhile */
  const rw = await until(() => {
    const a = window.ADDPDF;
    return a.renderWorker() !== 'wait' && { state: a.renderWorker(), mode: a.renderWorkerMode() };
  }, 40000);
  /* the render worker starts only when a page needs it: PDFium draws them all here */
  check(
    'the render worker is ready, or idle while PDFium draws',
    !!rw && (rw.state === 'on' || rw.state === 'idle'),
    rw,
  );
  /* and by PDFium, natively, once it has loaded (src-tauri/src/pdfium.rs) */
  const native = await until(() => {
    const n = window.ADDPDF.nativeRender();
    return n.state !== 'wait' && n.drawn > 0 ? n : n.state === 'off' ? n : null;
  }, 30000);
  check('pages are drawn natively, by PDFium', !!native && native.state === 'on' && native.drawn > 0, native);
  if (!first) {
    /* why not: what the desktop side handed over, what the page did with it */
    const why = await run(() => {
      const a = window.ADDPDF;
      return {
        desktop: window.ADDDOTS_DESKTOP || null,
        home: !document.getElementById('openPanel').hidden,
        items: a && a.S ? a.S.items.length : null,
        rendered: a && a.S ? a.S.items.filter((i) => i.rendered).length : null,
        sources: a && a.S ? a.S.sources.map((s) => s.name) : null,
        worker: a && a.renderWorker ? a.renderWorker() : null,
        workerMode: a && a.renderWorkerMode ? a.renderWorkerMode() : null,
        errors: window.ADDPDF_HEALTH ? window.ADDPDF_HEALTH.session().slice(0, 8) : null,
        err: document.getElementById('errMsg').textContent,
      };
    }).catch((e) => String(e));
    console.log('  state: ' + JSON.stringify(why));
  }

  const shell = await runAsync(async () => ({
    tauri: !!window.__TAURI__,
    engine: !!window.ADDPDFEngine,
    workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  }));
  check(
    'in the desktop app, with the engine bundle, and no service worker',
    shell.tauri === true && shell.engine === true && shell.workers === 0,
    shell,
  );

  const refused = await runAsync(
    (p) =>
      window.__TAURI__.core.invoke('read_file', { path: p }).then(
        () => 'read',
        (e) => 'refused: ' + e,
      ),
    WIN ? 'C:\\Windows\\win.ini' : '/etc/hostname',
  );
  check('the page cannot read a file it was not handed', /^refused/.test(refused), refused);

  /* ---- a second double-click, with the app open ---- */
  const second = spawn(APP, [B], { env, stdio: 'ignore' });
  const quit = await new Promise((res) => {
    const t = setTimeout(() => res(null), 20000);
    second.on('exit', (code) => (clearTimeout(t), res(code)));
  });
  /* in a tab of its own (a frame of the window), the first one kept */
  const got = await until(() => {
    const f = document.querySelector('.dtframe');
    const a = f && f.contentWindow && f.contentWindow.ADDPDF;
    return a &&
      a.S &&
      a.S.sources[0] &&
      a.S.sources[0].name === 'second.pdf' &&
      a.S.items[0] &&
      a.S.items[0].rendered
      ? {
          pages: a.S.items.length,
          name: a.S.sources[0].name,
          first: window.ADDPDF.S.items.length,
          tabs: window.ADDPDF.tabs.list().length,
        }
      : null;
  });
  check(
    'a second start opens its PDF in a new tab of the open window, and quits',
    quit === 0 && !!got && got.pages === 5 && got.first === 3 && got.tabs === 2,
    { quit, got },
  );

  /* ---- Save, from the tab ---- */
  await run(() => {
    const w = document.querySelector('.dtframe').contentWindow;
    /* the run has no account: saving without one (js/config.js requireSignIn) */
    window.ADDDOTS_CONFIG.requireSignIn = false;
    w.ADDDOTS_CONFIG.requireSignIn = false;
    w.ADDPDF.S.items[0].shapes.push({
      t: 'rect',
      a: [60, 60],
      b: [200, 140],
      c: '#E2483D',
      w: 2,
      id: 'e2e',
    });
    w.document.getElementById('btnSaveAs').click();
  });
  await sleep(400);
  await run(() => document.querySelector('.dtframe').contentWindow.document.getElementById('saveGo').click());
  let saved = null;
  for (let i = 0; i < 100 && !saved; i++) {
    const f = readdirSync(saveTo).filter((n) => n.endsWith('.pdf'));
    if (f.length) saved = join(saveTo, f[0]);
    else await sleep(200);
  }
  let pages = null;
  if (saved) {
    await sleep(300);
    pages = (await PDFDocument.load(readFileSync(saved))).getPageCount();
  }
  const toast = await run(
    () => document.querySelector('.dtframe').contentWindow.document.getElementById('toast').textContent,
  );
  check('Save, from a tab, writes the file where it was asked, a PDF with every page', pages === 5, {
    saved,
    pages,
    toast,
  });
} catch (e) {
  check('the desktop app could be driven', false, String(e.message || e));
} finally {
  if (app) await app.close();
  if (driver) driver.kill();
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
