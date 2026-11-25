/* The Electron app, end to end, driven the way a person uses it from
   Explorer:

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
   - Save on the PDF it was started with, nothing drawn on it: the Save
     dialog, then back onto that file with no system dialog
   - an editable PDF, saved and then opened from Explorer, comes back with
     its objects ready to edit, and Save writes it back onto that file

   Needs apps/web/dist (npx turbo run build --filter=@adddots/web...). */

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
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
const printTo = mkdtempSync(join(tmpdir(), 'adddots-printed-'));
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

/* a profile of its own: apart from any copy of the app already open */
const env = {
  ...process.env,
  ADDDOTS_SAVE_TO: saveTo,
  ADDDOTS_PRINT_TO: printTo,
  ADDDOTS_USER_DATA: mkdtempSync(join(tmpdir(), 'adddots-profile-')),
};
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

  /* when a file on disk last changed, and the editable project it carries */
  const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);
  async function projectOf(f) {
    const d = await PDFDocument.load(readFileSync(f), { ignoreEncryption: true });
    const st = d.context.lookup(d.catalog.get(PDFName.of('AddDotsProject')));
    if (!(st instanceof PDFRawStream)) return null;
    return JSON.parse(new TextDecoder().decode(decodePDFRawStream(st).decode()));
  }
  const marksIn = (proj) => (proj ? proj.items.reduce((n, it) => n + it.shapes.length, 0) : -1);
  /* Save: the Save dialog comes up, its kind and name chosen; what it
     showed, then its Save pressed (in a tab's frame, by its tab id) */
  const saveDialog = (tab) =>
    run(async (tab) => {
      const w = tab == null ? window : window.ADDPDF.tabs.frame(tab).contentWindow,
        d = w.document;
      w.ADDDOTS_CONFIG.requireSignIn = false;
      d.getElementById('btnQSave').click();
      for (let i = 0; i < 50 && d.getElementById('savePop').hidden; i++)
        await new Promise((r) => setTimeout(r, 100));
      const shown = {
        open: !d.getElementById('savePop').hidden,
        kind: (d.querySelector('input[name="saveFmt"]:checked') || {}).value,
        name: d.getElementById('saveName').value,
      };
      d.getElementById('saveGo').click();
      return shown;
    }, tab);

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
    bridge: !!(
      window.ADDDOTS_HOST &&
      window.ADDDOTS_HOST.adddots &&
      window.ADDDOTS_HOST.adddots.shell === 'electron'
    ),
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
      window.ADDDOTS_HOST.core.invoke('read_file', { path: p }).then(
        () => 'read',
        (e) => 'refused: ' + e,
      ),
    process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hostname',
  );
  const unknown = await run(() =>
    window.ADDDOTS_HOST.core.invoke('fs_write', {}).then(
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
  const policy = await run(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true;';
    document.head.appendChild(s);
    s.remove();
    /* the update check's sandboxed frame still runs and answers: a site
       that refuses at once (a closed port), so nothing, quickly */
    const cfg = window.ADDDOTS_CONFIG;
    const site = cfg.shareServer;
    cfg.shareServer = 'http://127.0.0.1:9/';
    const t = Date.now();
    const latest = window.ADDPDF.latestBuild ? await window.ADDPDF.latestBuild() : 'missing';
    cfg.shareServer = site;
    return { inline: window.__inlineRan === true, answered: latest === null && Date.now() - t < 20000 };
  });
  check(
    'the window has a content security policy, and the update check still answers',
    policy.inline === false && policy.answered,
    policy,
  );
  const updates = await run(() =>
    window.ADDDOTS_HOST.core.invoke('store_update').then(
      (v) => v,
      (e) => 'error: ' + e,
    ),
  );
  check(
    'outside the Store package, updates are compared with the website (store_update null)',
    updates === null,
    updates,
  );

  /* ---- Print: the app's own dialog (js/printdlg.js), with this computer's
     printers; Print sends the sheets to the desktop side, which prints them
     (ADDDOTS_PRINT_TO stands in for the printer: the job is written there) ---- */
  const dlg = await run(async () => {
    window.ADDPDF.print();
    for (let i = 0; i < 150; i++) {
      const ready =
        !document.querySelector('.prwrap').hidden &&
        document.getElementById('prBusy').hidden &&
        / of \d+$/.test(document.getElementById('prCount').textContent);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      open: !document.querySelector('.prwrap').hidden,
      count: document.getElementById('prCount').textContent,
      printers: [...document.getElementById('prPrinter').options].length,
      copies: !document.getElementById('prCopies').closest('.prrow').hidden,
    };
  });
  await run(() => document.getElementById('prGo').click());
  let job = null;
  for (let i = 0; i < 150 && !job; i++) {
    if (existsSync(join(printTo, 'printed.pdf'))) job = join(printTo, 'printed.pdf');
    else await sleep(200);
  }
  let jobPages = null;
  if (job) {
    await sleep(300);
    jobPages = (await PDFDocument.load(readFileSync(job))).getPageCount();
  }
  const after = await run(() => ({
    closed: document.querySelector('.prwrap').hidden,
    toast: document.getElementById('toast').textContent,
  }));
  check(
    "Print opens the app's dialog with this computer's printers, and Print sends every sheet to the printer",
    dlg.open &&
      dlg.count === 'Page 1 of ' + firstPages &&
      dlg.printers >= 1 &&
      dlg.copies &&
      jobPages === firstPages &&
      after.closed,
    { dlg, jobPages, after },
  );

  /* ---- Save on the PDF it was started with, nothing drawn on it: the Save
     dialog, its own name chosen; Save writes back onto that file, with no
     system dialog (its stand-in folder stays empty) ---- */
  const aWas = mtime(A),
    inSaveTo = readdirSync(saveTo).length;
  const plainDlg = await saveDialog();
  for (let i = 0; i < 100 && mtime(A) === aWas; i++) await sleep(200);
  await sleep(300);
  const plain = {
    dialog: plainDlg,
    rewritten: mtime(A) !== aWas,
    dialogFolder: readdirSync(saveTo).length - inSaveTo,
    asked: await run(() => !document.getElementById('savePop').hidden),
    pages: (await PDFDocument.load(readFileSync(A), { ignoreEncryption: true })).getPageCount(),
  };
  check(
    'Save on a PDF only read: the Save dialog with its own name, then back onto its own file, no system dialog',
    plain.dialog.open &&
      plain.dialog.kind === 'pdf' &&
      plain.dialog.name === basename(A) &&
      plain.rewritten &&
      plain.dialogFolder === 0 &&
      !plain.asked &&
      plain.pages === firstPages,
    plain,
  );

  /* ---- a second double-click, with the app open ---- */
  /* (Chromium refuses to run as root, a container's user, without this;
     Playwright gives its own launch the same) */
  const asRoot = process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : [];
  const second = spawn(EXE, [...asRoot, ...lead, B], { env, stdio: 'ignore' });
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

  /* ---- an editable PDF: Save as… Editable PDF; then opened from Explorer
     it comes back ready to edit, and Save writes it back onto that file ---- */
  const nMarks = await run(() => window.ADDPDF.S.items.reduce((n, it) => n + it.shapes.length, 0));
  await run(() => document.getElementById('btnSaveAs').click());
  await sleep(300);
  await run(() => {
    const r = document.querySelector('input[name="saveFmt"][value="project"]');
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('saveGo').click();
  });
  let editable = null;
  for (let i = 0; i < 150 && !editable; i++) {
    const f = readdirSync(saveTo).find((n) => n.endsWith('-editable.pdf'));
    if (f) editable = join(saveTo, f);
    else await sleep(200);
  }
  await sleep(500);
  const carried = editable ? await projectOf(editable) : null;
  check(
    'Save as… Editable PDF writes a PDF carrying the whole document',
    !!carried && marksIn(carried) === nMarks,
    {
      editable,
      marks: marksIn(carried),
      nMarks,
    },
  );

  const P = join(dir, 'project.pdf');
  if (editable) copyFileSync(editable, P);
  const pStart = spawn(EXE, [...asRoot, ...lead, P], { env, stdio: 'ignore' });
  await new Promise((res) => {
    const t = setTimeout(res, 20000);
    pStart.on('exit', () => (clearTimeout(t), res()));
  });
  const reopened = await until(() => {
    for (const t of window.ADDPDF.tabs.list()) {
      const f = window.ADDPDF.tabs.frame(t.id);
      const w = f && f.contentWindow,
        a = w && w.ADDPDF;
      const meta = w && w.document.getElementById('meta');
      if (a && a.S && a.S.items[0] && a.S.items[0].rendered && meta && /project\.pdf/.test(meta.textContent))
        return {
          id: t.id,
          meta: meta.textContent,
          marks: a.S.items.reduce((n, it) => n + it.shapes.length, 0),
          board: a.board(),
        };
    }
    return null;
  });
  check(
    'an editable PDF opened from Explorer comes back ready to edit: every object, as an editable PDF',
    !!reopened && reopened.marks === nMarks && /editable PDF/.test(reopened.meta),
    reopened,
  );
  if (reopened) {
    const pWas = mtime(P),
      dialogBefore = readdirSync(saveTo).length;
    await run((id) => {
      const w = window.ADDPDF.tabs.frame(id).contentWindow,
        a = w.ADDPDF;
      w.ADDDOTS_CONFIG.requireSignIn = false;
      a.snapshot();
      a.S.items[0].shapes.push({ t: 'rect', a: [-200, 300], b: [-80, 380], c: '#1F5FBF', w: 2 });
      a.drawShapes(a.S.items[0]);
    }, reopened.id);
    const projDlg = await saveDialog(reopened.id);
    for (let i = 0; i < 100 && mtime(P) === pWas; i++) await sleep(200);
    await sleep(500);
    const back = {
      dialog: projDlg,
      rewritten: mtime(P) !== pWas,
      dialogFolder: readdirSync(saveTo).length - dialogBefore,
      asked: await run(
        (id) => !window.ADDPDF.tabs.frame(id).contentWindow.document.getElementById('savePop').hidden,
        reopened.id,
      ),
      marks: mtime(P) !== pWas ? marksIn(await projectOf(P)) : null,
    };
    check(
      'Save on the reopened editable PDF: the Save dialog, Editable chosen; back onto its own file with the new object, no system dialog',
      back.dialog.open &&
        back.dialog.kind === 'project' &&
        back.dialog.name === 'project.pdf' &&
        back.rewritten &&
        back.dialogFolder === 0 &&
        !back.asked &&
        back.marks === nMarks + 1,
      back,
    );
    await run((id) => window.ADDPDF.tabs.close(id, true), reopened.id);
  }

  /* ---- Explorer's "Combine files in Add Dots PDF": one start per file ---- */
  await Promise.all(
    [B, A].map((f) => {
      const c = spawn(EXE, [...asRoot, ...lead, '--combine', f], { env, stdio: 'ignore' });
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
