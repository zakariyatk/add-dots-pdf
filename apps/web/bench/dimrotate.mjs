/* Dimension text rotation in the Properties panel (js/draw.js, engine
   dimension.ts sty.tr), end to end in Chromium with the real mouse and
   keyboard: every kind of dimension shows Rotation; typing an angle, the
   quarter turns and 0° turn its text on the page; several selected turn
   together; one undo step each; the Dimension Style dialog keeps it; and
   the saved PDF writes the text turned.

   npm run build, then: node apps/web/bench/dimrotate.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4189;
await serve(join(import.meta.dirname, '..', 'dist'), PORT);
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: process.env.BENCH_CHANNEL || undefined },
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
await page.goto('http://localhost:' + PORT + '/');
await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
await page.setInputFiles('#fileIn', join(CORPUS_DIR, 'small-text-12p.pdf'));
await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
  timeout: 60000,
});
await page.waitForTimeout(400);

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};

/* one of each kind, clear of each other */
const KINDS = {
  lin: {
    k: 'lin',
    pts: [
      [80, 700],
      [200, 700],
      [140, 730],
    ],
    dir: [1, 0],
  },
  ali: {
    k: 'ali',
    pts: [
      [260, 680],
      [360, 730],
      [300, 740],
    ],
  },
  ang: {
    k: 'ang',
    pts: [
      [420, 660],
      [500, 660],
      [420, 740],
      [460, 700],
    ],
  },
  rad: {
    k: 'rad',
    pts: [
      [120, 520],
      [170, 520],
      [150, 520],
    ],
  },
  dia: {
    k: 'dia',
    pts: [
      [300, 520],
      [350, 520],
      [330, 520],
    ],
  },
  arc: {
    k: 'arc',
    pts: [
      [460, 500],
      [510, 500],
      [460, 550],
      [495.36, 535.36],
      [520, 560],
    ],
  },
  ord: {
    k: 'ord',
    pts: [
      [80, 350],
      [180, 380],
      [200, 440],
    ],
    dir: [1, 0],
    ax: 'x',
  },
};
await page.evaluate((K) => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes = Object.values(K).map((k) => Object.assign({ t: 'dimx', c: '#1A73E8', w: 0.6 }, k));
  X.S.sel = null;
  X.drawShapes(it);
  X.setTool('select');
  X.setRail(true);
  document.getElementById('tabProps').click();
}, KINDS);
await page.waitForTimeout(200);

const shape = (i) => page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), i);
/* the text's turn as drawn on the page: its transform's rotate() */
const drawnAng = (i) =>
  page.evaluate((i) => {
    const it = window.ADDPDF.S.items[0];
    const s = it.shapes[i];
    const D = window.ADDPDFEngine.dimLayout(
      s,
      window.ADDPDF.dimScale ? window.ADDPDF.dimScale() : { unit: 'pt', denom: 1, custom: null },
      (t, z) => t.length * z * 0.5,
    );
    return Math.round(((D.text.ang * 180) / Math.PI) * 100) / 100;
  }, i);
async function pick(i) {
  await page.keyboard.press('Escape');
  await page.evaluate((i) => {
    const X = window.ADDPDF,
      it = X.S.items[0];
    X.S.sel = { it, i };
    X.S.multi = null;
    X.drawShapes(it);
    X.syncMarkPop();
  }, i);
  await page.waitForTimeout(120);
}
const shows = (sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, sel);

/* ===================== every kind ===================== */
const names = Object.keys(KINDS);
const missing = [];
for (let i = 0; i < names.length; i++) {
  await pick(i);
  if (!(await shows('#dxPTr')) || !(await shows('#dxPTrL'))) missing.push(names[i]);
}
check('every kind of dimension shows Rotation in Properties', !missing.length, missing);

const turned = [];
for (let i = 0; i < names.length; i++) {
  await pick(i);
  const a0 = await drawnAng(i);
  await page.locator('#dxPTr').scrollIntoViewIfNeeded();
  await page.fill('#dxPTr', '30');
  await page.press('#dxPTr', 'Enter');
  await page.waitForTimeout(80);
  const s = await shape(i);
  const a1 = await drawnAng(i);
  const d = Math.round(((a1 - a0 + 540) % 360) - 180);
  if (!(s.sty && s.sty.tr === 30) || d !== 30) turned.push({ k: names[i], tr: s.sty && s.sty.tr, d });
}
check('…typing 30° turns the text of each kind 30° from where it was', !turned.length, turned);

/* ===================== the buttons, undo ===================== */
await pick(0);
await page.click('#dxPTrL');
check('⟲ 90° turns it a quarter more', (await shape(0)).sty.tr === 120);
await page.click('#dxPTrR');
await page.click('#dxPTrR');
check('⟳ 90° turns it back the other way', (await shape(0)).sty.tr === -60, (await shape(0)).sty.tr);
check('…and the field reads it', (await page.inputValue('#dxPTr')) === '-60');
await page.fill('#dxPTr', '270');
await page.press('#dxPTr', 'Enter');
check('an angle past 180 is written the short way round (270 → -90)', (await shape(0)).sty.tr === -90);
await page.click('#dxPTr0');
let s0 = await shape(0);
check(
  '0° puts it back as its alignment has it, nothing left in its style',
  !(s0.sty && 'tr' in s0.sty),
  s0.sty,
);
check('…and 0° is off then', await page.isDisabled('#dxPTr0'));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
check(
  'one undo takes back one step (0° undone: -90 again)',
  (await shape(0)).sty.tr === -90,
  (await shape(0)).sty,
);

/* ===================== several at once ===================== */
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
/* Shift+click each one's text, as on the page */
for (const [i, shift] of [
  [3, false],
  [4, true],
]) {
  const p = await page.evaluate((i) => {
    const it = window.ADDPDF.S.items[0];
    const D = window.ADDPDFEngine.dimLayout(
      it.shapes[i],
      { unit: 'pt', denom: 1, custom: null },
      (t, z) => t.length * z * 0.5,
    );
    const v = it.vp.convertToViewportPoint(D.text.at[0], D.text.at[1]);
    const r = it.anno.getBoundingClientRect();
    return { x: r.left + v[0], y: r.top + v[1] };
  }, i);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
}
const many = await page.evaluate(() => window.ADDPDF.selList());
check('two dimensions selected with Shift+click', many.length === 2, many);
await page.click('#dxPTrL');
const [r3, r4] = [await shape(3), await shape(4)];
check('two selected: each turns a quarter from its own', r3.sty.tr === 120 && r4.sty.tr === 120, [
  r3.sty.tr,
  r4.sty.tr,
]);

/* ===================== Dimension Style ===================== */
await pick(1);
await page.click('#dxPStyle');
await page.waitForSelector('#dxTr');
check('the Dimension Style dialog shows its rotation', (await page.inputValue('#dxTr')) === '30');
await page.fill('#dxTr', '45');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('…and sets it', (await shape(1)).sty.tr === 45, (await shape(1)).sty);

/* ===================== the saved PDF ===================== */
const tm = await page.evaluate(async () => {
  const E = window.ADDPDFEngine;
  const it = window.ADDPDF.S.items[0];
  const s = Object.assign({}, it.shapes[0], { sty: Object.assign({}, it.shapes[0].sty, { tr: 90 }) });
  const D = E.dimLayout(s, { unit: 'pt', denom: 1, custom: null }, (t, z) => t.length * z * 0.5);
  return Math.round((D.text.ang * 180) / Math.PI);
});
check('the layout the PDF and the screen share has the text turned', tm === 90, tm);

await page.keyboard.press('Escape');
check('no errors on the page', !errors.length, errors);
console.log(fails ? fails + ' failed' : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
