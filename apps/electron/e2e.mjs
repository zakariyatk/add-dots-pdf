/* The Electron app, end to end, driven the way a person uses it from
   Explorer (the same checks as apps/desktop/e2e.mjs where they apply):

     npm run e2e -w @adddots/electron                 # unpackaged, over apps/web/dist
     APP=release/win-unpacked/"Add Dots PDF.exe" npm run e2e -w @adddots/electron
     SAMPLE=path/to/file.pdf npm run e2e -w @adddots/electron

   - started with a PDF as its argument (a double-click), it opens and page 1
     is drawn; the page is in the app's own window, with the desktop bridge,
     the engine bundle, no service worker and the content security policy
   - the page cannot read a file it was not handed, or reach Node
   - a second start with another PDF opens it in a new tab of the open
     window, and quits
   - Save, from that tab, writes the file (ADDDOTS_SAVE_TO stands in for the
     Save dialog), a PDF with every page

   Needs apps/web/dist (npx turbo run build --filter=@adddots/web...). */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { _electron } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PACKAGED = process.env.APP || '';
const EXE = PACKAGED || require('electron');
/* unpackaged, Electron is given the app's folder first */
const lead = PACKAGED ? [] : [here];

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makePdf(path, pages, label) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = d.addPage([595, 842]);
    p.drawText(label + ', page ' + i, { x: 60, y: 760, size: 24, font: f });
  }
  writeFileSync(path, await d.save());
}

if (!PACKAGED && !existsSync(join(here, '..', 'web', 'dist', 'index.html'))) {
  console.error('no apps/web/dist: build it first (npx turbo run build --filter=@adddots/web...)');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'adddots-e2e-'));
const saveTo = mkdtempSync(join(tmpdir(), 'adddots-saved-'));
let A = join(dir, 'first.pdf');
if (process.env.SAMPLE) {
  A = join(dir, basename(process.env.SAMPLE));
  copyFileSync(process.env.SAMPLE, A);
} else {
  await makePdf(A, 3, 'First');
}
const firstPages = (await PDFDocument.load(readFileSync(A), { ignoreEncryption: true })).getPageCount();
const B = join(dir, 'second.pdf');
await makePdf(B, 5, 'Second');

const env = { ...process.env, ADDDOTS_SAVE_TO: saveTo };
delete env.ADDDOTS_DEV_URL;

let app = null;
try {
  app = await _electron.launch({ executablePath: EXE, args: [...lead, A], env, timeout: 60000 });
  const page = await app.firstWindow();
  const run = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, ms = 30000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const v = await run(fn).catch(() => null);
      if (v) return v;
      await sleep(200);
    }
    return null;
  };

  /* ---- started with a PDF ---- */
  const first = await until(() => {
    const a = window.ADDPDF;
    const it = a && a.S && a.S.items[0];
    return it && it.rendered && a.S.sources[0]
      ? {
          pages: a.S.items.length,
          name: a.S.sources[0].name,
          url: location.href,
          ranged: !!a.S.sources[0].lazy,
        }
      : null;
  }, 60000);
  check(
    'started with a PDF, it opens and page 1 is drawn',
    !!first &&
      first.pages === firstPages &&
      first.name === basename(A) &&
      /^app:\/\/adddots\//.test(first.url),
    first,
  );
  /* ADDDOTS_RANGE_MB=0: every file is "big", read a part at a time from the
     file kept open (core.js RANGED), as one over 150 MB is */
  if (process.env.ADDDOTS_RANGE_MB === '0') {
    check('a big file is read a part at a time, not whole', !!first && first.ranged, first);
  }
  if (!first) {
    console.log('  state: ' + JSON.stringify(await run(() => window.ADDDOTS_DESKTOP || null).catch(String)));
  }

  const shell = await run(async () => ({
    bridge: !!(window.__TAURI__ && window.__TAURI__.adddots && window.__TAURI__.adddots.shell === 'electron'),
    node: typeof require !== 'undefined' || typeof process !== 'undefined',
    engine: !!window.ADDPDFEngine,
    /* app:// cannot have one at all: asking throws */
    workers: navigator.serviceWorker
      ? await navigator.serviceWorker.getRegistrations().then(
          (r) => r.length,
          () => 0,
        )
      : 0,
    drag: document.body.classList.contains('shell-electron'),
  }));
  check(
    'the desktop bridge, the engine bundle, no Node in the page, no service worker, the title bar drags',
    shell.bridge && !shell.node && shell.engine && shell.workers === 0 && shell.drag,
    shell,
  );

  const refused = await run(
    (p) =>
      window.__TAURI__.core.invoke('read_file', { path: p }).then(
        () => 'read',
        (e) => 'refused: ' + e,
      ),
    process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hostname',
  );
  const unknown = await run(() =>
    window.__TAURI__.core.invoke('fs_write', {}).then(
      () => 'ran',
      (e) => 'refused: ' + e,
    ),
  );
  check(
    'the page cannot read a file it was not handed, nor call anything else',
    /^refused/.test(refused) && /^refused/.test(unknown),
    { refused, unknown },
  );

  /* the content security policy is in force: an inline script added to the
     page does not run (Playwright's own evaluate is exempt) */
  const policy = await run(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true;';
    document.head.appendChild(s);
    s.remove();
    return { inline: window.__inlineRan === true };
  });
  check('the window has a content security policy', policy.inline === false, policy);

  /* ---- Print: the system print dialog, as on the website ----
     There is no native printing here (js/print.js stands aside): the PDF made
     for printing is shown in Chromium's PDF viewer in a frame, and that frame
     is printed. print() is swapped for a stand-in as the frame loads. */
  const printed = await run(async () => {
    const got = { called: false, pdf: null, dialog: !!document.getElementById('printModal') };
    new MutationObserver((ms, mo) => {
      const f = document.getElementById('printFrame');
      if (!f) return;
      mo.disconnect();
      f.addEventListener('load', () => {
        const w = f.contentWindow;
        w.print = () => {
          got.called = true;
          got.pdf =
            [...w.document.querySelectorAll('embed')].map((e) => e.type).join() || w.document.contentType;
        };
      });
    }).observe(document.body, { childList: true });
    await window.ADDPDF.print();
    for (let i = 0; i < 150 && !got.called; i++) await new Promise((r) => setTimeout(r, 200));
    const m = document.getElementById('printModal');
    got.dialogShown = !!m && !m.hidden;
    return got;
  });
  check(
    "Print: the PDF made for printing opens in Chromium's PDF viewer, and that frame is printed",
    printed.called && /application\/pdf/.test(printed.pdf) && !printed.dialogShown,
    printed,
  );

  /* ---- a second double-click, with the app open ---- */
  const second = spawn(EXE, [...lead, B], { env, stdio: 'ignore' });
  const quit = await new Promise((res) => {
    const t = setTimeout(() => res(null), 20000);
    second.on('exit', (code) => (clearTimeout(t), res(code)));
  });
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
    quit === 0 && !!got && got.pages === 5 && got.first === firstPages && got.tabs === 2,
    { quit, got },
  );

  /* ---- Save, from the tab ---- */
  await run(() => {
    const w = document.querySelector('.dtframe').contentWindow;
    window.ADDDOTS_CONFIG.requireSignIn = false;
    w.ADDDOTS_CONFIG.requireSignIn = false;
    w.ADDPDF.S.items[0].shapes.push({ t: 'rect', a: [60, 60], b: [200, 140], c: '#E2483D', w: 2, id: 'e2e' });
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
  check('Save, from a tab, writes the file where it was asked, a PDF with every page', pages === 5, {
    saved,
    pages,
  });

  /* ---- Save of the first document, the one started with ---- */
  await run(() => {
    window.ADDPDF.tabs.activate ? window.ADDPDF.tabs.activate(0) : null;
  });
  const before = readdirSync(saveTo).length;
  await run(() => {
    window.ADDPDF.S.items[0].shapes.push({
      t: 'rect',
      a: [80, 80],
      b: [220, 160],
      c: '#3385EE',
      w: 2,
      id: 'e2e1',
    });
    document.getElementById('btnSaveAs').click();
  });
  await sleep(400);
  await run(() => document.getElementById('saveGo').click());
  let saved1 = null;
  for (let i = 0; i < 150 && !saved1; i++) {
    const f = readdirSync(saveTo).filter((n) => n.endsWith('.pdf') && n !== basename(saved || ''));
    if (readdirSync(saveTo).length > before && f.length) saved1 = join(saveTo, f[0]);
    else await sleep(200);
  }
  let pages1 = null;
  if (saved1) {
    await sleep(300);
    pages1 = (await PDFDocument.load(readFileSync(saved1), { ignoreEncryption: true })).getPageCount();
  }
  check('Save of the document it was started with writes every page', pages1 === firstPages, {
    saved: saved1,
    pages: pages1,
  });

  /* ---- Explorer's "Combine files in Add Dots PDF": one start per file ---- */
  await Promise.all(
    [B, A].map((f) => {
      const c = spawn(EXE, [...lead, '--combine', f], { env, stdio: 'ignore' });
      return new Promise((res) => c.on('exit', res));
    }),
  );
  const combine = await until(() => {
    const m = document.getElementById('cmbModal');
    const names = m && !m.hidden ? [...m.querySelectorAll('.cmbname')].map((e) => e.textContent) : [];
    return names.length === 2 ? names : null;
  }, 15000);
  check(
    'Combine files: each start hands its file over, gathered and sorted by name in one list',
    !!combine &&
      combine.join() ===
        [basename(A), basename(B)].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).join(),
    combine,
  );
  await run(() => document.getElementById('cmbCancel').click());

  /* ---- a tab moved to a window of its own ---- */
  const opening = app.waitForEvent('window', { timeout: 20000 });
  await run(() => {
    const tab = [...document.querySelectorAll('.dtab')].find((t) => +t.dataset.id !== 0);
    const r = tab.getBoundingClientRect();
    tab.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 5,
        clientY: r.top + 5,
      }),
    );
    document.querySelector('.dtmenu [data-a="win"]').click();
  });
  const moved = await opening.catch(() => null);
  let there = null;
  if (moved) {
    for (let i = 0; i < 150 && !there; i++) {
      there = await moved
        .evaluate(() => {
          const a = window.ADDPDF;
          return a && a.S && a.S.items.length && a.S.items[0].rendered
            ? { pages: a.S.items.length, url: location.search }
            : null;
        })
        .catch(() => null);
      if (!there) await sleep(200);
    }
  }
  const left = await until(() => window.ADDPDF.tabs.list().length);
  check(
    'Move to new window: the tab opens in a window of its own and leaves this one',
    !!there && there.pages === 5 && /handoff=/.test(there.url) && left === 1,
    { there, left },
  );
} catch (e) {
  check('the Electron app could be driven', false, String(e.message || e));
} finally {
  /* unsaved edits would ask before closing: quit outright */
  if (app) await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
