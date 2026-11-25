/* The Properties panel end to end in Chromium, as Illustrator's: what it
   shows with nothing selected (the document), with one object of each kind,
   with several (what they share, "Mixed" where they differ), with a group,
   and with a tool in hand; editing from it, at once on the page, each
   change one undo step; and sections with nothing to show left out.

   npm run build, then: node apps/web/bench/props.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4183;
const server = await serve(join(import.meta.dirname, '..', 'dist'), PORT);
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
await page.evaluate(() => {
  localStorage.setItem('adpdf.rulerUnit', 'pt');
  ['adpdf.refPoint', 'adpdf.tfLink', 'adpdf.canvas', 'adpdf.grid', 'adpdf.gridSnap', 'adpdf.rulers'].forEach(
    (k) => localStorage.removeItem(k),
  );
});
await page.reload();
await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
await page.setInputFiles('#fileIn', join(CORPUS_DIR, 'small-text-12p.pdf'));
await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
  timeout: 60000,
});
await page.waitForTimeout(600);

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

await page.evaluate(() => {
  const b = document.getElementById('snapOn');
  if (b && b.classList.contains('on')) b.click();
});
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQI12P4z8DwnwEIGBgY/jMwMAAm+AX7S9iJ0wAAAABJRU5ErkJggg==';
await page.evaluate((png) => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes = [
    { t: 'rect', a: [80, 600], b: [160, 650], c: '#E2483D', w: 2, fill: '#FFEE00', rr: 6 },
    { t: 'ellipse', a: [330, 590], b: [390, 640], c: '#1A73E8', w: 3, fill: '#CCDDFF', o: 0.5 },
    { t: 'text', a: [100, 520], text: 'Words here', size: 18, c: '#333333', f: 'helv' },
    {
      t: 'pen',
      pts: [
        [330, 400],
        [350, 440],
        [390, 440],
        [410, 400],
      ],
      open: true,
      c: '#00AA00',
      w: 2,
    },
    { t: 'image', a: [440, 560], b: [540, 640], url: png, c: '#000000', w: 0 },
    { t: 'rect', a: [200, 420], b: [260, 470], c: '#111111', w: 1, grp: 'g1' },
    { t: 'ellipse', a: [262, 420], b: [300, 470], c: '#111111', w: 1, grp: 'g1' },
  ];
  X.S.sel = null;
  X.drawShapes(it);
  X.setTool('select');
}, PNG);
await page.click('#sTabProps').catch(() =>
  page.evaluate(() => {
    window.ADDPDF.setRail(true);
    document.getElementById('tabProps').click();
  }),
);
await page.waitForTimeout(200);

const shapes = () => page.evaluate(() => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes)));
const scr = (p) =>
  page.evaluate((p) => {
    const it = window.ADDPDF.S.items[0];
    const v = it.vp.convertToViewportPoint(p[0], p[1]);
    const r = it.anno.getBoundingClientRect();
    return { x: r.left + v[0], y: r.top + v[1] };
  }, p);
async function pick(p, shift) {
  const s = await scr(p);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(s.x, s.y);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(120);
}
async function none() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}
/* what the panel shows: its view, its name, the sections showing and their headings */
const view = () =>
  page.evaluate(() => {
    const p = document.getElementById('railProps');
    const vis = (el) =>
      !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const secs = [...document.querySelectorAll('#markPop .ppsec')].filter(vis).map((s) => s.id);
    return {
      view: p.dataset.view,
      name: document.getElementById('propsName').textContent,
      secs,
      kindHead:
        document.querySelector('#ppKind .pphd') && document.querySelector('#ppKind .pphd').textContent,
      doc: vis(document.getElementById('propsDoc')),
      docHeads: [...document.querySelectorAll('#propsDoc .pphd')].map((h) => h.firstChild.textContent.trim()),
    };
  });
const shows = (sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  }, sel);
async function setField(sel, v) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.fill(sel, String(v));
  await page.press(sel, 'Enter');
  await page.waitForTimeout(120);
}
const undo = async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
};
const redo = async () => {
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
};

/* ===================== nothing selected: the document ===================== */
let v = await view();
check(
  'nothing selected: the panel shows the document',
  v.view === 'document' && v.doc && v.name === 'Document',
  v,
);
check(
  "…in Illustrator's sections: Document, Artboard, Background, Rulers & Grids, Guides, Snap, Preferences, Quick Actions",
  [
    'Document',
    'Artboard',
    'Background',
    'Rulers & Grids',
    'Guides',
    'Snap Options',
    'Preferences',
    'Quick Actions',
  ].every((h) => v.docHeads.includes(h)),
  v.docHeads,
);
let d = await page.evaluate(() => ({
  name: document.getElementById('pdName').textContent,
  pages: document.getElementById('pdPages').textContent,
  size: document.getElementById('pdSize').textContent,
  orient: document.getElementById('pdOrient').textContent,
  unit: document.getElementById('pdUnits').value,
}));
check(
  'Document: its file, its pages, the page size and orientation, the units',
  d.name === 'small-text-12p.pdf' &&
    d.pages === '12' &&
    /^595\.3 × 841\.9 pt$/.test(d.size) &&
    d.orient === 'Portrait' &&
    d.unit === 'pt',
  d,
);
await page.selectOption('#pdUnits', 'mm');
await page.waitForTimeout(150);
d = await page.evaluate(() => ({
  size: document.getElementById('pdSize').textContent,
  unit: window.ADDPDF.rulers.unit(),
}));
check('Units: millimetres, everywhere (the rulers too)', d.unit === 'mm' && /^210 × 297 mm$/.test(d.size), d);
await page.selectOption('#pdUnits', 'pt');
await page.click('#pdGrid');
await page.click('#pdGridSnap');
await page.waitForTimeout(100);
d = await page.evaluate(() => ({
  grid: window.ADDPDF.grid.shown(),
  snap: window.ADDPDF.grid.snapping(),
  btn: document.getElementById('btnGrid').classList.contains('on'),
}));
check('Rulers & Grids: the grid and Snap to Grid from here, in step with View', d.grid && d.snap && d.btn, d);
await page.click('#pdGrid');
await page.click('#pdGridSnap');
await page.click('#pdSnap');
check(
  'Snap to objects: the same switch as the snap button',
  await page.evaluate(() => document.getElementById('snapOn').classList.contains('on')),
);
await page.click('#pdSnap');
await page.click('#propsDoc [data-canvas="dark"]');
d = await page.evaluate(() => ({
  c: document.body.dataset.canvas,
  bg: getComputedStyle(document.getElementById('stage')).backgroundColor,
}));
check('Background: the canvas round the pages, dark', d.c === 'dark' && d.bg === 'rgb(64, 64, 64)', d);
await page.click('#propsDoc [data-canvas=""]');
await page.click('#pdRotR');
await page.waitForTimeout(400);
d = await page.evaluate(() => ({
  rot: window.ADDPDF.S.items[0].rot,
  orient: document.getElementById('pdOrient').textContent,
}));
check(
  'Artboard: the page turned from here, and its orientation follows',
  d.rot === 90 && d.orient === 'Landscape',
  d,
);
await page.click('#pdRotL');
await page.waitForTimeout(400);
await page.fill('#mvInc', '2');
await page.press('#mvInc', 'Enter');
check('Preferences: the Keyboard Increment', await page.evaluate(() => window.ADDPDF.nudgeIncrement() === 2));
await page.evaluate(() => window.ADDPDF.nudgeIncrement(1));
await page.click('#pdSelAll');
await page.waitForTimeout(150);
v = await view();
check(
  'Quick Actions: Select All, and the panel turns to the selection',
  v.view === 'selection' && (await page.evaluate(() => window.ADDPDF.selList().length)) === 7,
  v,
);
await none();

/* ===================== one object ===================== */
await pick([120, 625]);
v = await view();
check("a click: the panel is the rectangle's, at once", v.view === 'selection' && v.name === 'Rectangle', v);
check(
  "…in Illustrator's order: Transform, Appearance, Rectangle, Align, Quick Actions",
  v.secs.join() === 'ppTransform,ppAppear,ppKind,ppAlign,ppQuick' && v.kindHead === 'Rectangle',
  v.secs,
);
d = await page.evaluate(() => ({
  x: document.getElementById('mvX').value,
  w: document.getElementById('mvW').value,
  h: document.getElementById('mvH').value,
  r: document.getElementById('mpAngle').value,
  hex: document.getElementById('fsHex').value,
  op: document.getElementById('mpOpacity').value,
  sw: document.getElementById('mpWidth').value,
  corners: document.getElementById('rectPR').value,
  dupX: getComputedStyle(document.getElementById('rectPX').closest('.mfield')).display,
}));
check(
  'Transform, fill, stroke weight, opacity and its corner radius, as it is',
  d.x === '120' &&
    d.w === '80' &&
    d.h === '50' &&
    d.r === '0' &&
    d.hex === '#FFEE00' &&
    d.op === '100' &&
    d.sw === '2' &&
    d.corners === '6',
  d,
);
check('its own X and Y are not said twice (Transform has them)', d.dupX === 'none');
await setField('#mvW', 120);
let s = (await shapes())[0];
check(
  'W typed: it is 120 wide, about the middle (the reference point)',
  near(s.b[0] - s.a[0], 120) && near((s.a[0] + s.b[0]) / 2, 120),
  s,
);
await undo();
s = (await shapes())[0];
check('Undo: 80 again', near(s.b[0] - s.a[0], 80));
await redo();
check('Redo: 120 again', near((await shapes())[0].b[0] - (await shapes())[0].a[0], 120));
await undo();
await pick([120, 625]);
await page.click('#mvLink');
await setField('#mvH', 100);
s = (await shapes())[0];
check(
  'with the link on, H typed keeps the proportions: 160 × 100',
  near(s.b[0] - s.a[0], 160) && near(s.b[1] - s.a[1], 100),
  s,
);
await page.click('#mvLink');
await undo();
await pick([120, 625]);
await setField('#mpAngle', 30);
check('Rotate typed: turned 30°', near((await shapes())[0].r, 30));
await undo();
await pick([120, 625]);
await setField('#mpOpacity', 40);
check('Opacity typed: 40%', near((await shapes())[0].o, 0.4));
await undo();
await pick([120, 625]);
await setField('#fsHex', '#00FF00');
check('the fill from its hex code', (await shapes())[0].fill === '#00FF00', (await shapes())[0].fill);
await undo();
await pick([120, 625]);
await setField('#rectPR', 12);
check('Rectangle: its corner radius', near((await shapes())[0].rr, 12), (await shapes())[0].rr);
await undo();
await pick([120, 625]);
await page.click('#mvFlipH');
s = (await shapes())[0];
check('Flip: a rectangle mirrors in place', near(s.a[0], 80) && near(s.b[0], 160));
await undo();
await pick([120, 625]);
await page.locator('#ppForward').scrollIntoViewIfNeeded();
await page.click('#ppForward');
check(
  'Quick Actions: Bring Forward, one step up the stack',
  (await shapes())[1].t === 'rect' && (await shapes())[0].t === 'ellipse',
);
await undo();
await none();

/* text */
await pick([140, 525]);
v = await view();
check(
  'text: Character and Paragraph, no fill and stroke squares, no stroke weight',
  v.name === 'Text' &&
    v.secs.includes('ppKind') &&
    !v.kindHead &&
    (await shows('#mpType')) &&
    !(await shows('#fsWrap')) &&
    !(await shows('#mpWidthWrap')),
  v,
);
d = await page.evaluate(() => ({
  w: +document.getElementById('mvW').value,
  h: +document.getElementById('mvH').value,
  flip: document.getElementById('mvFlipH').disabled,
}));
check('…its Transform has its real size, and it does not flip', d.w > 50 && d.h > 10 && d.flip, d);
await none();

/* a path */
await pick([370, 430]);
v = await view();
d = await page.evaluate(() => ({
  n: document.getElementById('mpPathPts').textContent,
  k: document.getElementById('mpPathKind').textContent,
}));
check(
  'a path: its points, open or closed, and its path work',
  v.kindHead === 'Path' && d.n === '2' && d.k === 'Open' && (await shows('#markPop [data-pa="reverse"]')),
  { kind: v.kindHead, d },
);
await none();

/* an image */
await pick([490, 600]);
await page.waitForTimeout(200);
v = await view();
d = await page.evaluate(() => ({
  px: document.getElementById('mpImgPx').textContent,
  ppi: document.getElementById('mpImgPpi').textContent,
}));
check(
  'an image: its pixels, its resolution, Crop',
  v.kindHead === 'Image' && d.px === '2 × 2 px' && /ppi$/.test(d.ppi) && (await shows('#mpCropImg')),
  { v, d },
);
await page.click('#mpImgRatio');
s = (await shapes())[4];
check(
  'Original proportions: square again, as its pixels are',
  near(Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1])),
  s,
);
await undo();
await none();

/* ===================== several ===================== */
await pick([120, 625]);
await pick([390, 615], true);
v = await view();
d = await page.evaluate(() => ({
  w: document.getElementById('mvW').value,
  op: [document.getElementById('mpOpacity').value, document.getElementById('mpOpacity').placeholder],
  sw: document.getElementById('mpWidth').placeholder,
  hex: document.getElementById('fsHex').value,
  fillMixed: document.getElementById('fsFill').classList.contains('mixed'),
}));
check('two objects: the panel says so, and their box together', v.name === '2 objects' && d.w === '310', {
  v,
  d,
});
check(
  '…"Mixed" where they differ: opacity, stroke weight, fill',
  d.op[0] === '' && d.op[1] === 'Mixed' && d.sw === 'Mixed' && d.hex === 'Mixed' && d.fillMixed,
  d,
);
check(
  "…and no one kind's own section (no Rectangle or Ellipse) for a mix",
  !v.secs.includes('ppKind'),
  v.secs,
);
check('…Group offered', await shows('#ppGroup'));
await setField('#mpOpacity', 70);
let all = await shapes();
check('a value typed goes to both: 70%', near(all[0].o, 0.7) && near(all[1].o, 0.7));
await undo();
await pick([120, 625]);
await pick([390, 615], true);
await setField('#mpAngle', 90);
all = await shapes();
check(
  'Rotate for several turns them together about their middle',
  near(all[0].r, 90) && near(all[1].r, 90) && Math.abs(all[0].a[1] - 600) > 20,
);
check('…and reads 0 again after', (await page.inputValue('#mpAngle')) === '0');
await undo();
await pick([120, 625]);
await pick([390, 615], true);
await page.locator('#ppGroup').scrollIntoViewIfNeeded();
await page.click('#ppGroup');
all = await shapes();
check('Quick Actions: Group', all[0].grp != null && all[0].grp === all[1].grp);
await undo();
await none();

/* ===================== a group ===================== */
await pick([200, 445]);
v = await view();
check(
  'a group: "Group", its Transform and appearance, Ungroup offered',
  v.name === 'Group' &&
    v.secs.includes('ppTransform') &&
    v.secs.includes('ppAppear') &&
    (await shows('#ppUngroup')) &&
    !(await shows('#ppGroup')),
  v,
);
await setField('#mpWidth', 4);
all = await shapes();
check('a stroke weight typed goes to the whole group', all[5].w === 4 && all[6].w === 4);
await undo();
await none();

/* ===================== a tool in hand, and back ===================== */
await page.evaluate(() => window.ADDPDF.setTool('rect'));
await page.waitForTimeout(150);
v = await view();
check("a tool in hand: the panel is the tool's", v.view === 'tool' && !v.doc, v);
await page.evaluate(() => window.ADDPDF.setTool('select'));
await page.waitForTimeout(150);
v = await view();
check('put down, nothing selected: the document again', v.view === 'document' && v.doc, v);

check('no errors on the page', errors.length === 0, errors);
await browser.close();
if (server.kill) server.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
