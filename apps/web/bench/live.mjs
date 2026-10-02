/* The live site, as a visitor gets it: opens it in Chrome, opens a PDF and
   uses the main tools, and prints every error, failed file and finding.

     SITE=https://pdf.adddots.com/ node bench/live.mjs

   Run by .github/workflows/sitecheck.yml (Actions -> Site check). */

import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SITE = process.env.SITE || 'https://pdf.adddots.com/';
const OUT = process.env.OUT || join(tmpdir(), 'sitecheck');
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
};

const d = await PDFDocument.create();
const f = await d.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++)
  d.addPage([595, 842]).drawText('Site check, page ' + i, { x: 60, y: 760, size: 24, font: f });
const PDF = join(OUT, 'sitecheck.pdf');
writeFileSync(PDF, await d.save());

const browser = await chromium.launch({ channel: process.env.BENCH_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const bad = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(r.status() + ' ' + r.url());
});
page.on('requestfailed', (r) => bad.push('failed ' + r.url() + ' ' + (r.failure() || {}).errorText));

try {
  await page.goto(SITE + '?sitecheck=' + Date.now(), { waitUntil: 'load', timeout: 60000 });
  const boot = await page
    .waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc, null, { timeout: 30000 })
    .then(
      () => true,
      () => false,
    );
  const shell = await page.evaluate(() => ({
    scripts: [...document.scripts].map((s) => s.getAttribute('src')).filter(Boolean),
    styles: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href')),
    engine: !!window.ADDPDFEngine,
    pdfjs: !!window.pdfjsLib,
    pdflib: !!window.PDFLib,
    err: (document.getElementById('errMsg') || {}).textContent || '',
    config: window.ADDDOTS_CONFIG || null,
  }));
  console.log('scripts: ' + shell.scripts.join(' '));
  console.log('styles:  ' + shell.styles.join(' '));
  console.log('config:  ' + JSON.stringify(shell.config));
  check('the app starts (core booted)', boot);
  check('the PDF libraries and the engine loaded', shell.engine && shell.pdfjs && shell.pdflib, {
    engine: shell.engine,
    pdfjs: shell.pdfjs,
    pdflib: shell.pdflib,
    message: shell.err,
  });

  await page.setInputFiles('#fileIn', PDF);
  const opened = await page
    .waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
      timeout: 30000,
    })
    .then(
      () => true,
      () => false,
    );
  const doc = await page.evaluate(() => ({
    pages: window.ADDPDF.S.items.length,
    homeHidden: document.getElementById('openPanel').hidden,
  }));
  check('a PDF opens and page 1 is drawn', opened && doc.pages === 3 && doc.homeHidden, doc);
  await page.screenshot({ path: join(OUT, 'opened.png') });

  /* a box drawn with the mouse, as a person would */
  await page.click('#ribDraw');
  await page.click('#tRect');
  const at = await page.evaluate(() => {
    const r = window.ADDPDF.S.items[0].anno.getBoundingClientRect();
    return { x: r.left + r.width * 0.3, y: r.top + 200 };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 80, { steps: 6 });
  await page.mouse.up();
  const box = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.map((s) => s.t));
  check('Draw > Box draws a box', box.includes('rect'), box);

  /* text: a click puts a box to type into */
  /* whichever ribbon tab the Text button lives in */
  await page.evaluate(() => {
    const pan = document.getElementById('tText').closest('.rpan');
    const tab = pan && document.getElementById(pan.getAttribute('aria-labelledby'));
    if (tab) tab.click();
  });
  await page.click('#tText', { timeout: 5000 });
  const tool = await page.evaluate(() => window.ADDPDF.S.tool);
  await page.mouse.click(at.x, at.y + 200);
  await page.waitForTimeout(800);
  const editing = await page.evaluate(() => !!window.ADDPDF.S.editing);
  console.log('text tool: ' + tool + ', editing: ' + editing);
  if (editing) {
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
  }
  check('Text opens a box to type in', editing);

  /* rotate a page from the Page tab */
  await page.click('#ribPage');
  await page.click('#btnRotR');
  const rot = await page.evaluate(() => window.ADDPDF.S.items[window.ADDPDF.S.current - 1].rot);
  check('Page > Rotate turns the page', rot === 90, rot);

  /* Save opens its popover, and Save there asks for a free account */
  await page.click('#btnSave');
  await page.waitForTimeout(300);
  const savePop = await page.evaluate(() => !document.getElementById('savePop').hidden);
  await page.click('#saveGo').catch(() => {});
  await page.waitForTimeout(1500);
  const acct = await page.evaluate(() => {
    const a = document.getElementById('authDlg');
    return { shown: !!a && !a.hidden, title: a && document.getElementById('authTitle').textContent };
  });
  check('Save opens, and saving asks for the free account', savePop && acct.shown, { savePop, ...acct });
  await page.screenshot({ path: join(OUT, 'save.png') });
} catch (e) {
  check('the check ran to the end', false, String((e && e.message) || e).split('\n')[0]);
}

console.log('\nfiles that failed (' + bad.length + '):\n' + bad.slice(0, 40).join('\n'));
console.log('\nerrors on the page (' + errors.length + '):\n' + errors.slice(0, 40).join('\n'));
check('no errors on the page', errors.length === 0);
check('no files failed to load', bad.length === 0);
await browser.close();
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
