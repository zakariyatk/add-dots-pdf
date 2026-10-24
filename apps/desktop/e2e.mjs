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

  /* the window's content security policy (tauri.conf.json) is in force: an
     inline script put into the page does not run (eval is no test here:
     DevTools, which drives WebView2, lets the code it runs use eval
     whatever the policy); and the update check's sandboxed frame still runs
     and answers (with what the website says, or nothing when offline) */
  const policy = await runAsync(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true;';
    document.head.appendChild(s);
    s.remove();
    const inline = window.__inlineRan === true;
    /* a site that refuses at once (a closed port here), so the frame's answer
       does not wait on the network: nothing, quickly */
    const cfg = window.ADDDOTS_CONFIG;
    const site = cfg.shareServer;
    cfg.shareServer = 'http://127.0.0.1:9/';
    const t = Date.now();
    const latest = window.ADDPDF.latestBuild ? await window.ADDPDF.latestBuild() : 'missing';
    cfg.shareServer = site;
    return { inline, answered: latest === null && Date.now() - t < 20000, ms: Date.now() - t };
  });
  /* Windows' own text reader (src-tauri/src/ocr.rs): a picture of words,
     drawn here, read back. Off Windows there is no reader, and says so. */
  const ocr = await runAsync(async () => {
    const T = window.__TAURI__;
    const st = await T.core.invoke('ocr_status');
    const tag = (st.languages || []).filter((l) => /^en/i.test(l))[0];
    if (!tag) return { languages: st.languages, max: st.max };
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.font = '64px Arial';
    g.fillText('Site Inspection Report', 60, 170);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const words = await T.core.invoke('ocr_page', new Uint8Array(px.buffer), {
      headers: { 'x-w': '1200', 'x-h': '300', 'x-lang': tag },
    });
    /* English and Arabic at once: each word from the reader of its letters */
    const ar = (st.languages || []).filter((l) => /^ar/i.test(l))[0];
    let both = null;
    if (ar) {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000';
      g.fillText('Invoice', 60, 170);
      g.fillText('\u0641\u0627\u062A\u0648\u0631\u0629', 700, 170);
      const px2 = g.getImageData(0, 0, c.width, c.height).data;
      const got = await T.core.invoke('ocr_page', new Uint8Array(px2.buffer), {
        headers: { 'x-w': '1200', 'x-h': '300', 'x-lang': tag + ',' + ar },
      });
      both = got.map((w) => ({ text: w.text, x: Math.round(w.x) }));
    }
    return {
      languages: st.languages,
      max: st.max,
      tag,
      words: words.map((w) => w.text).join(' '),
      first: words[0],
      ar,
      both,
    };
  });
  check(
    WIN ? "Windows' own text reader reads a picture of words" : 'off Windows there is no Windows text reader',
    WIN
      ? /Inspection/.test(ocr.words || '') && ocr.first && ocr.first.x > 30 && ocr.first.x < 120
      : !!ocr.languages && ocr.languages.length === 0,
    ocr,
  );
  if (WIN) {
    /* the English word from the English reader, the Arabic from the Arabic
       one, and no Latin reading of the Arabic word beside it */
    const both = ocr.both || [];
    const arabic = both.filter((w) => /[\u0600-\u06FF]/.test(w.text));
    check(
      "English and Arabic at once: each word read by Windows' reader for its letters",
      both.some((w) => w.text === 'Invoice' && w.x < 400) &&
        arabic.length > 0 &&
        arabic.every((w) => w.x > 500) &&
        !both.some((w) => w.x > 500 && /[A-Za-z]/.test(w.text)),
      { ar: ocr.ar, both },
    );
  }

  check(
    'the window has a content security policy, and the update check still answers',
    policy.inline === false && policy.answered,
    policy,
  );

  /* ---- Print: the app's own Print dialog (js/print.js) ----
     It lists the computer's printers (print.rs), shows the first sheet, and
     asks the printer picked what paper it has. Nothing is printed: a
     runner's printers (if any) save to a file through a dialog of their own. */
  if (WIN) {
    const dialog = await runAsync(async () => {
      const T = window.__TAURI__;
      const listed = await T.core.invoke('print_printers');
      await window.ADDPDF.print();
      const $ = (id) => document.getElementById(id);
      for (let i = 0; i < 150 && !$('prWait').hidden; i++) await new Promise((r) => setTimeout(r, 200));
      await new Promise((r) => setTimeout(r, 500));
      const shown = [...$('prPrinter').options].map((o) => o.value);
      const caps = listed.list.length
        ? await T.core.invoke('print_caps', { name: $('prPrinter').value, setup: {} }).catch((e) => String(e))
        : null;
      const got = {
        open: !$('printModal').hidden,
        listed,
        shown,
        sheets: $('prOf').textContent,
        preview: $('prCanvas').width,
        papers: caps && caps.papers ? caps.papers.length : caps,
        bins: caps && caps.bins ? caps.bins.length : null,
        margins: caps && caps.margins,
      };
      /* Advanced and Page Setup open over the dialog and close again */
      $('prAdvanced').click();
      got.advanced = !$('prAdvBox').hidden && !!$('prImage');
      $('prAdvBox').querySelector('[data-pop="ok"]').click();
      $('prSetup').click();
      got.setup = !$('prSetupBox').hidden;
      got.setupPapers = $('prPaper').options.length;
      got.setupSources = $('prSource').options.length;
      $('prSetupBox').querySelector('[data-pop="ok"]').click();
      got.popsClosed = $('prAdvBox').hidden && $('prSetupBox').hidden;
      /* Poster: the first page at 400% takes more than one sheet */
      document.querySelector('.prseg [data-mode="poster"]').click();
      $('prTile').value = '400';
      $('prTile').dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      got.poster = $('prOf').textContent;
      document.querySelector('.prseg [data-mode="size"]').click();
      $('prCancel').click();
      got.closed = $('printModal').hidden;
      return got;
    });
    check(
      "Print: the app's own dialog lists the printers, shows the sheet, and asks the printer for its paper",
      dialog.open &&
        dialog.closed &&
        /^Page 1 of \d+$/.test(dialog.sheets) &&
        dialog.preview > 0 &&
        (dialog.listed.list.length
          ? dialog.listed.list.every((n) => dialog.shown.includes(n)) && dialog.papers > 0
          : true),
      dialog,
    );
    check(
      'Print: Advanced (print as image) and Page Setup (paper, tray) open over it; Poster tiles a page',
      dialog.advanced &&
        dialog.setup &&
        dialog.setupPapers > 0 &&
        dialog.setupSources > 0 &&
        dialog.popsClosed &&
        /^Page 1 of (\d+)$/.test(dialog.poster) &&
        +/of (\d+)$/.exec(dialog.poster)[1] > 1,
      dialog,
    );
  }

  /* ---- Print using system dialog: the PDF made for printing, in WebView2's PDF viewer ----
     The frame core prints (printSystem) is a blob: PDF; WebView2 shows it with
     its own PDF viewer, under the window's policy (frame-src blob:). Off
     Windows, WebKitGTK has no PDF viewer in a frame: not checked there. */
  if (WIN) {
    const printed = await runAsync(async () => {
      /* the print dialog cannot be answered here: print() is swapped for a
         stand-in on the frame as it loads, before core calls it 300 ms on */
      const got = { called: false, pdf: null };
      new MutationObserver((ms, mo) => {
        const f = document.getElementById('printFrame');
        if (!f) return;
        mo.disconnect();
        f.addEventListener('load', () => {
          const w = f.contentWindow;
          w.print = () => {
            const d = w.document;
            got.called = true;
            got.pdf =
              [...d.querySelectorAll('embed')].map((e) => e.type).join() || 'no viewer: ' + d.contentType;
          };
        });
      }).observe(document.body, { childList: true });
      window.ADDPDF.printSystem();
      for (let i = 0; i < 150 && !got.called; i++) await new Promise((r) => setTimeout(r, 200));
      return got;
    });
    check(
      "Print: the PDF made for printing opens in WebView2's PDF viewer, and that frame is printed",
      printed.called && /application\/pdf/.test(printed.pdf),
      printed,
    );
  }

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
