/* The Properties panel open by default (js/toolprops.js), in Chromium:
   a document opens with the sidebar out on the right showing Properties;
   closed by hand, the next document this session leaves it closed; a new
   start opens it again; and a phone keeps its sidebar a closed drawer.

   npm run build, then: node apps/web/bench/propsopen.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { chromium, devices } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4191;
await serve(join(import.meta.dirname, '..', 'dist'), PORT);
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: process.env.BENCH_CHANNEL || undefined },
);
let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};
const FILE = join(CORPUS_DIR, 'small-text-12p.pdf');
const FILE2 = join(CORPUS_DIR, 'medium-report-300p.pdf');

async function openDoc(page, path) {
  await page.evaluate(() => (window.__before = window.ADDPDF.S.items[0] || null));
  await page.setInputFiles('#fileIn', path);
  await page.waitForFunction(
    () => {
      const it = window.ADDPDF.S.items[0];
      return it && it !== window.__before && it.rendered;
    },
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(400);
}
const state = (page) =>
  page.evaluate(() => {
    const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    return {
      rail: vis(document.getElementById('rail')),
      props: vis(document.getElementById('railProps')),
      name: (document.getElementById('propsName') || {}).textContent,
      lit: !!document.querySelector('#sTabProps.on'),
    };
  });

/* ===================== a wide screen ===================== */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:' + PORT + '/');
await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
await openDoc(page, FILE);
let s = await state(page);
check(
  'a document opens with the Properties panel out on the right',
  s.rail && s.props && s.name === 'Document',
  s,
);
await page.waitForTimeout(500);
s = await state(page);
check('…its icon in the side rail lit', s.lit, s);

/* the page fits beside it */
const fit = await page.evaluate(() => {
  const r = document.getElementById('rail').getBoundingClientRect();
  const p = window.ADDPDF.S.items[0].box.getBoundingClientRect();
  return { pageRight: Math.round(p.right), railLeft: Math.round(r.left) };
});
check('…the page laid out beside it, not under it', fit.pageRight <= fit.railLeft, fit);

/* select something: the same panel shows it */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes = [{ t: 'rect', a: [80, 600], b: [160, 650], c: '#E2483D', w: 2 }];
  X.drawShapes(it);
  X.setTool('select');
});
const pt = await page.evaluate(() => {
  const it = window.ADDPDF.S.items[0];
  const v = it.vp.convertToViewportPoint(80, 625);
  const r = it.anno.getBoundingClientRect();
  return { x: r.left + v[0], y: r.top + v[1] };
});
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(200);
s = await state(page);
check('a click on an object: its properties in the open panel', s.props && s.name === 'Rectangle', s);
await page.keyboard.press('Escape');

/* closed by hand: the next document leaves it closed */
await page.click('#sTabProps');
await page.waitForTimeout(200);
check('the side rail icon closes it', !(await state(page)).rail);
await openDoc(page, FILE2);
s = await state(page);
check('…and another document this session leaves it closed', !s.rail, s);
await page.click('#sTabProps');
await page.waitForTimeout(200);
check('…until it is opened again', (await state(page)).props);

/* a new start opens it again */
await page.reload();
await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
if (!(await page.evaluate(() => window.ADDPDF.S.items.length))) await openDoc(page, FILE);
else await page.waitForTimeout(800);
s = await state(page);
check('after a restart it is open again', s.rail && s.props, s);
check('no errors on the page', !errors.length, errors);
await ctx.close();

/* ===================== a phone ===================== */
const phone = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
const pp = await phone.newPage();
await pp.goto('http://localhost:' + PORT + '/');
await pp.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
await openDoc(pp, FILE);
s = await state(pp);
check('on a phone the sidebar stays a closed drawer over the page', !s.rail, s);
await phone.close();

console.log(fails ? fails + ' failed' : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
