/* The web app in WebKit, the engine of Safari and of the iOS app (WKWebView):
   a short check of what the iOS app does most, where the Chrome smoke test
   cannot see.

     npm run build && npx playwright-core install webkit && node bench/webkit.mjs

   - a PDF opens and page 1 is drawn; the render worker is on (WebKit's
     OffscreenCanvas) or, where it cannot be, pages are drawn on the page
   - its text can be searched
   - Save downloads a PDF with every page
   - no errors on the page */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium, webkit } from 'playwright-core';
import { serve } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4191;
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  if (!ok) failed++;
}

const dir = mkdtempSync(join(tmpdir(), 'adddots-webkit-'));
const file = join(dir, 'webkit.pdf');
{
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++)
    d.addPage([595, 842]).drawText('WebKit page ' + i, { x: 60, y: 760, size: 24, font: f });
  writeFileSync(file, await d.save());
}

const server = await serve(join(here, '..', 'dist'), PORT);
/* ENGINE=chromium runs the same checks in Chromium, to try the script where
   WebKit cannot be downloaded */
const engine = process.env.ENGINE === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  /* no account service here: the check is the reader, not the sign-in */
  await ctx.addInitScript(() => (window.ADDDOTS_CONFIG = { supabaseUrl: '', supabaseKey: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc, null, { timeout: 30000 });
  console.log('browser: ' + (engine === webkit ? 'WebKit ' : 'Chromium ') + browser.version());

  await page.setInputFiles('#fileIn', file);
  const opened = await page
    .waitForFunction(
      () => {
        const a = window.ADDPDF;
        const it = a.S.items[0];
        return it && it.rendered && { pages: a.S.items.length };
      },
      null,
      { timeout: 60000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  check('a PDF opens and page 1 is drawn', !!opened && opened.pages === 4, opened);
  const worker = await page
    .waitForFunction(() => window.ADDPDF.renderWorker() !== 'wait' && window.ADDPDF.renderWorker(), null, {
      timeout: 30000,
    })
    .then((h) => h.jsonValue())
    .catch(() => 'wait');
  check(
    'the render worker has started (or pages are drawn on the page)',
    worker === 'on' || worker === 'off',
    worker,
  );
  console.log('  render worker: ' + worker);

  const found = await page.evaluate(async () => {
    const a = window.ADDPDF;
    let text = '';
    for (const it of a.S.items) {
      await a.ensurePage(it);
      const tc = await it.page.getTextContent();
      text += tc.items.map((x) => x.str).join(' ') + '\n';
    }
    return text;
  });
  check('its text can be read (search)', /WebKit page 4/.test(found), found.slice(0, 80));

  await page.evaluate(() =>
    window.ADDPDF.S.items[0].shapes.push({
      t: 'rect',
      a: [60, 60],
      b: [200, 140],
      c: '#E2483D',
      w: 2,
      id: 'wk',
    }),
  );
  await page.click('#btnSaveAs');
  const dl = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#saveGo')])
    .then((r) => r[0])
    .catch(() => null);
  let pages = null;
  if (dl) pages = (await PDFDocument.load(readFileSync(await dl.path()))).getPageCount();
  check('Save downloads a PDF with every page', pages === 4, { pages });
  check('no errors on the page', errors.length === 0, errors);
  await ctx.close();
} catch (e) {
  check('the app could be driven in WebKit', false, String((e && e.message) || e).split('\n')[0]);
} finally {
  await browser.close();
  server.kill();
}

console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
