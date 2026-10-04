/* The Android app, end to end, on a device or emulator (adb), the way a
   person uses it: a PDF opened from another app, then another while it is
   open, then Save. The app's WebView is driven through Playwright.

     (web built, npx cap sync android, gradlew assembleDebug)
     node e2e-android.mjs [path/to/app-debug.apk]

   - "Open with" a PDF (a VIEW intent, content:// as from Files or Gmail):
     it opens and page 1 is drawn, in the render worker
   - the phone app, with the engine bundle, and no service worker
   - a second PDF while the app is open (file://) replaces it
   - Save writes a PDF with every page (window.ADDDOTS_TEST_SAVE, honoured
     by debug builds only, stands in for Android's "save to" picker) */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { _android as android } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = 'com.adddots.pdf';
const APK = process.argv[2] || join(here, 'android/app/build/outputs/apk/debug/app-debug.apk');

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  if (!ok) failed++;
}
async function makePdf(pages, label) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    d.addPage([595, 842]).drawText(label + ', page ' + i, { x: 60, y: 760, size: 24, font: f });
  }
  return Buffer.from(await d.save());
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [device] = await android.devices();
if (!device) {
  console.error('no Android device or emulator (adb devices)');
  process.exit(1);
}
const sh = async (cmd) => (await device.shell(cmd)).toString().trim();

let page = null;

/* a promise that gives up after ms */
const within = (p, ms) =>
  Promise.race([p, sleep(ms).then(() => Promise.reject(new Error('no answer in ' + ms / 1000 + ' s')))]);

/* where the app is, when a check times out: was the file handed over, did it
   open, how far did drawing get */
async function appState() {
  if (!page) return { page: 'not connected' };
  return within(
    page.evaluate(() => {
      const a = window.ADDPDF;
      if (!a || !a.S) return { core: 'not booted' };
      return {
        sources: a.S.sources.map((s) => s && s.name),
        pages: a.S.items.length,
        rendered: a.S.items.slice(0, 3).map((it) => !!it.rendered),
        worker: a.renderWorker(),
        errors: window.ADDPDF_HEALTH ? window.ADDPDF_HEALTH.session().slice(0, 5) : null,
      };
    }),
    10000,
  ).catch((e) => ({ page: String((e && e.message) || e).split('\n')[0] }));
}

/* on a failure, what the device saw: the app's own errors, and the system
   log's crashes and WebView messages (a WebView that goes away leaves its
   reason here) */
async function report() {
  const health = page
    ? await within(
        page.evaluate(() => (window.ADDPDF_HEALTH ? window.ADDPDF_HEALTH.session() : null)),
        10000,
      ).catch(() => null)
    : null;
  if (health) console.log('\napp errors: ' + JSON.stringify(health.slice(0, 10)));
  /* the crash buffer holds the whole report of any crash, Java or native */
  const crashes = await sh('logcat -d -b crash -v time').catch(() => '');
  console.log('\ncrash log:\n' + (crashes.split('\n').slice(-150).join('\n') || '(empty)'));
  const log = await sh('logcat -d -v time').catch(() => '');
  const lines = log
    .split('\n')
    .filter((l) =>
      /fatal|crash|chromium|cr_|webview|renderer|sandboxed|gpu|lowmemory|lmkd|kill|anr|adddots|console|capacitor/i.test(
        l,
      ),
    )
    /* system chatter that matches the words above and says nothing about the app
       (crashrecovery: thousands of lines from NamespaceManager) */
    .filter((l) => !/AiAiEcho|DynamiteModule|NamespaceManager|crashrecovery|AppsFilter|OomAdjuster/.test(l));
  console.log('\nlogcat (' + lines.length + ' lines):\n' + lines.slice(-200).join('\n'));
}
/* A step the emulator never answers (an adb shell, an install) would wait for
   ever: after ten minutes, say where it stopped and fail. */
let step = 'start';
const watchdog = setTimeout(
  async () => {
    console.log('FAIL the Android run finished in time  ' + JSON.stringify({ stuckAt: step }));
    /* what the device saw, as on any other failure, but no longer than a minute */
    await Promise.race([report(), sleep(60000)]);
    process.exit(1);
  },
  10 * 60 * 1000,
);
try {
  step = 'install';
  console.log('device: ' + device.model() + ', installing ' + APK);
  await device.installApk(APK);
  await sh('am force-stop ' + PKG);

  step = 'copy the PDFs to the device';
  /* the PDFs, in the app's own files (run-as works on a debug build) */
  for (const [name, n, label] of [
    ['first.pdf', 3, 'First'],
    ['second.pdf', 5, 'Second'],
  ]) {
    await device.push(await makePdf(n, label), '/data/local/tmp/' + name, { mode: 0o644 });
    await sh('run-as ' + PKG + ' mkdir -p files');
    /* read by the shell, written by the app: the app itself may not read /data/local/tmp */
    await sh('cat /data/local/tmp/' + name + ' | run-as ' + PKG + " sh -c 'cat > files/" + name + "'");
  }

  /* "Open with ADD DOTS PDF", as from Files: a content:// URI */
  await sh(
    'am start -W -a android.intent.action.VIEW -t application/pdf -d content://' +
      PKG +
      '.fileprovider/files/first.pdf -n ' +
      PKG +
      '/.MainActivity',
  );
  step = 'open the first PDF and find the WebView';
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  step = 'connect to the WebView';
  /* connecting can hang on a WebView that is still starting: once more, then fail */
  page = await within(webview.page(), 30000).catch(async () => {
    await sleep(2000);
    return within((await device.webView({ pkg: PKG }, { timeout: 30000 })).page(), 30000);
  });
  step = 'wait for page 1';
  const until = async (fn, ms = 60000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const v = await page.evaluate(fn).catch(() => null);
      if (v) return v;
      await sleep(250);
    }
    return null;
  };

  const first = await until(() => {
    const a = window.ADDPDF;
    const it = a && a.S && a.S.items[0];
    return it && it.rendered && a.S.sources[0]
      ? { pages: a.S.items.length, name: a.S.sources[0].name, worker: a.renderWorker() }
      : null;
  });
  check(
    'opened from another app (content://), the PDF opens and page 1 is drawn',
    !!first && first.pages === 3 && first.name === 'first.pdf',
    first || (await appState()),
  );
  /* the render worker may still be starting on a slow phone: pages are drawn
     on the page meanwhile; once it has started, it draws */
  const worker = await until(
    () => (window.ADDPDF.renderWorker() !== 'wait' ? window.ADDPDF.renderWorker() : null),
    30000,
  );
  check('pages are drawn in the render worker once it has started', worker === 'on', worker);

  const shell = await page.evaluate(async () => ({
    native: !!(window.Capacitor && window.Capacitor.isNativePlatform()),
    engine: !!window.ADDPDFEngine,
    workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    webview: navigator.userAgent.replace(/^.*(Chrome\/[\d.]+).*$/, '$1'),
  }));
  check(
    'the phone app, with the engine bundle, and no service worker',
    shell.native && shell.engine && shell.workers === 0,
    shell,
  );

  step = 'open a second PDF';
  /* another PDF while the app is open (file://): reaches the same app */
  await sh(
    'am start -a android.intent.action.VIEW -t application/pdf -d file:///data/data/' +
      PKG +
      '/files/second.pdf -n ' +
      PKG +
      '/.MainActivity',
  );
  const got = await until(() => {
    const a = window.ADDPDF;
    return a.S.sources[0] && a.S.sources[0].name === 'second.pdf' && a.S.items[0].rendered
      ? { pages: a.S.items.length, name: a.S.sources[0].name }
      : null;
  });
  check(
    'a second PDF opened while the app is open replaces the first',
    !!got && got.pages === 5,
    got || (await appState()),
  );

  step = 'save';
  /* Save */
  await page.evaluate(() => {
    window.ADDDOTS_TEST_SAVE = true;
    /* the run has no account: saving without one (js/config.js requireSignIn) */
    window.ADDDOTS_CONFIG.requireSignIn = false;
    window.ADDPDF.S.items[0].shapes.push({
      t: 'rect',
      a: [60, 60],
      b: [200, 140],
      c: '#E2483D',
      w: 2,
      id: 'e2e',
    });
    document.getElementById('btnSaveAs').click();
  });
  await sleep(500);
  await page.evaluate(() => document.getElementById('saveGo').click());
  let listing = '';
  for (let i = 0; i < 60 && !/\.pdf/.test(listing); i++) {
    await sleep(500);
    listing = await sh('run-as ' + PKG + ' ls files/saved').catch(() => '');
  }
  const savedName = listing.split(/\s+/).find((n) => n.endsWith('.pdf'));
  let pages = null;
  if (savedName) {
    const b64 = await sh('run-as ' + PKG + ' base64 -w 0 files/saved/' + savedName);
    pages = (await PDFDocument.load(Buffer.from(b64, 'base64'))).getPageCount();
  }
  const toast = await page.evaluate(() => document.getElementById('toast').textContent);
  check('Save writes a PDF with every page', pages === 5, { savedName, pages, toast });

  const errors = await page.evaluate(() => (window.ADDPDF_HEALTH ? window.ADDPDF_HEALTH.session() : []));
  check('no errors in the app', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  check('the Android app could be driven', false, String((e && e.message) || e).split('\n')[0]);
} finally {
  if (failed) await report();
  await device.close().catch(() => {});
  clearTimeout(watchdog);
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
