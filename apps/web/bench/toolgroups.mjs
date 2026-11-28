/* Tool groups and flyouts on the bar beside the page (js/toolgroups.js),
   and the Rounded Rectangle, Polygon, Star and Spiral (js/shapetools.js),
   end to end in Chromium with the real mouse and keyboard: the bar in the
   registry's order; press and hold for the flyout, let go over a tool;
   a click picks the group's tool; the corner triangle, a right click,
   Alt+click and the keyboard; a shortcut shows its tool on its group's
   button; the last tool of each group kept after a reload; each new tool
   draws a shape that selects, undoes and is a Path in Properties; both themes.

   npm run build, then: node apps/web/bench/toolgroups.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4187;
await serve(join(import.meta.dirname, '..', 'dist'), PORT);
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: process.env.BENCH_CHANNEL || undefined },
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) =>
  errors.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')),
);
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
async function load() {
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
  await page.setInputFiles('#fileIn', join(CORPUS_DIR, 'small-text-12p.pdf'));
  await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(400);
}
await page.goto('http://localhost:' + PORT + '/');
await page.evaluate(() => localStorage.removeItem('adddots.toolgroups'));
await page.reload();
await load();

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};
let d;
const tool = () => page.evaluate(() => window.ADDPDF.S.tool);
const face = (g) => page.evaluate((g) => document.getElementById('qg-' + g).dataset.toolBtn, g);
const flyOpen = () => page.evaluate(() => !document.getElementById('toolFlyout').hidden);
const flyTools = () =>
  page.evaluate(() => [...document.querySelectorAll('#toolFlyout .tgitem')].map((b) => b.dataset.tool));
const box = async (sel) => {
  await page.locator(sel).scrollIntoViewIfNeeded();
  return page.locator(sel).boundingBox();
};
const toSelect = async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.ADDPDF.setTool('select'));
  await page.waitForTimeout(80);
};

/* ===================== the bar ===================== */
const rail = await page.evaluate(() =>
  [...document.querySelectorAll('#quickRail > button')].map(
    (b) => b.id + (b.dataset.tools ? ':' + b.dataset.tools : ''),
  ),
);
check(
  "the bar: one button a group, in Illustrator's order",
  JSON.stringify(rail.slice(0, 8)) ===
    JSON.stringify([
      'qtSelect',
      'qtVxDirect',
      'qtEditMove',
      'qg-pen:pen vadd vdel vconv',
      'qtText',
      'qg-shapes:rect rrect ellipse polygon star line arc spiral',
      'qg-draw:ink poly arrow cloud',
      'qtRotate',
    ]) &&
    rail.includes('qg-measure:dim dimal dimc dimb dima dimr dimd dimarc dimo') &&
    rail.at(-1) === 'qLast',
  rail,
);
check(
  'no tool twice on the bar',
  await page.evaluate(() => {
    const seen = new Set();
    for (const b of document.querySelectorAll('#quickRail [data-tool-btn]:not(#qLast)')) {
      const ts = (b.dataset.tools || b.dataset.toolBtn).split(' ');
      for (const t of ts) {
        if (t !== 'select' && seen.has(t)) return false;
        seen.add(t);
      }
    }
    return true;
  }),
);
check(
  'a group shows a corner triangle; a single tool does not',
  await page.evaluate(
    () => !!document.querySelector('#qg-shapes .tgtri') && !document.querySelector('#qtText .tgtri'),
  ),
);
check(
  '…and its tooltip names the tool and its shortcut',
  (await page.getAttribute('#qg-shapes', 'title')) === 'Rectangle Tool (X)',
  await page.getAttribute('#qg-shapes', 'title'),
);

/* ===================== press and hold ===================== */
let r = await box('#qg-shapes');
await page.mouse.move(r.x + 18, r.y + 18);
await page.mouse.down();
await page.waitForTimeout(120);
check('a short press does not open the flyout', !(await flyOpen()));
await page.waitForTimeout(350);
check('held, the flyout opens', await flyOpen());
d = await flyTools();
check(
  '…with the whole group: Rectangle, Rounded Rectangle, Ellipse, Polygon, Star, Line, Arc, Spiral',
  JSON.stringify(d) ===
    JSON.stringify(['rect', 'rrect', 'ellipse', 'polygon', 'star', 'line', 'arc', 'spiral']),
  d,
);
d = await page.evaluate(() => {
  const f = document.getElementById('toolFlyout').getBoundingClientRect();
  const b = document.getElementById('qg-shapes').getBoundingClientRect();
  const it = document.querySelector('#toolFlyout .tgitem');
  return {
    beside: f.left >= b.right,
    names: !!it.querySelector('.tgname') && !!it.querySelector('svg'),
    key: it.querySelector('.tgkey').textContent,
  };
});
check('…beside the button, each with its icon, name and shortcut', d.beside && d.names && d.key === 'X', d);
const sr = await page.locator('#toolFlyout .tgitem[data-tool="polygon"]').boundingBox();
await page.mouse.move(sr.x + 60, sr.y + 12, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(120);
check(
  'let go over Polygon: the Polygon tool, the flyout shut',
  (await tool()) === 'polygon' && !(await flyOpen()),
);
check(
  '…and the group button shows it, lit',
  (await face('shapes')) === 'polygon' &&
    (await page.evaluate(() => document.getElementById('qg-shapes').classList.contains('on'))),
);
await toSelect();
check('…kept on the button after the tool is put down', (await face('shapes')) === 'polygon');
r = await box('#qg-shapes');
await page.mouse.click(r.x + 18, r.y + 18);
await page.waitForTimeout(100);
check('a click picks up the tool it shows', (await tool()) === 'polygon' && !(await flyOpen()));
await toSelect();

/* ===================== the triangle, a right click, Alt+click ===================== */
r = await box('#qg-draw');
await page.mouse.click(r.x + r.width - 5, r.y + r.height - 5);
await page.waitForTimeout(100);
check('the corner triangle opens it at once', (await flyOpen()) && (await tool()) === 'select');
await page.click('#toolFlyout .tgitem[data-tool="cloud"]');
await page.waitForTimeout(100);
check('a click in the flyout picks the tool and closes it', (await tool()) === 'cloud' && !(await flyOpen()));
await toSelect();
r = await box('#qg-comment');
await page.mouse.click(r.x + 18, r.y + 18, { button: 'right' });
await page.waitForTimeout(100);
check('a right click opens it', (await flyOpen()) && JSON.stringify(await flyTools()) === '["note","stamp"]');
await page.mouse.click(700, 500);
await page.waitForTimeout(100);
check('a click anywhere else shuts it, nothing picked', !(await flyOpen()) && (await tool()) === 'select');
r = await box('#qg-view');
await page.keyboard.down('Alt');
await page.mouse.click(r.x + 18, r.y + 18);
await page.keyboard.up('Alt');
await page.waitForTimeout(100);
check(
  'Alt+click: the next tool in the group (Hand to Zoom)',
  (await face('view')) === 'zoombox' && (await tool()) === 'zoombox',
);
await toSelect();

/* ===================== two columns, the keyboard ===================== */
await page.focus('#qg-measure');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(100);
d = await page.evaluate(() => ({
  two: document.getElementById('toolFlyout').classList.contains('two'),
  focus: document.activeElement.dataset.tool,
  cols: getComputedStyle(document.getElementById('toolFlyout')).gridTemplateColumns.split(' ').length,
}));
check(
  '→ on a focused group opens it, the tool it shows focused; Dimensions in two columns',
  d.two && d.cols === 2 && d.focus === 'dim',
  d,
);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowRight');
d = await page.evaluate(() => document.activeElement.dataset.tool);
check('…↓ goes down a row, → along it', d === 'dimb', d);
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
check(
  '…Enter picks it',
  (await tool()) === 'dimb' && !(await flyOpen()) && (await face('measure')) === 'dimb',
);
await toSelect();
await page.focus('#qg-pen');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
check(
  'Esc shuts it and gives the focus back, the tool unchanged',
  !(await flyOpen()) &&
    (await tool()) === 'select' &&
    (await page.evaluate(() => document.activeElement.id)) === 'qg-pen',
);
await page.mouse.click(700, 500);
await toSelect();

/* ===================== shortcuts ===================== */
const KEYS = [
  ['x', 'rect', 'shapes'],
  ['l', 'ellipse', 'shapes'],
  ['\\', 'line', 'shapes'],
  ['Shift+A', 'arc', 'shapes'],
  ['Shift+L', 'cloud', 'draw'],
  ['Shift+P', 'ink', 'draw'],
  ['p', 'pen', 'pen'],
  ['Shift+C', 'vconv', 'pen'],
  ['u', 'underline', 'markup'],
  ['d', 'strike', 'markup'],
  ['Shift+H', 'highlight', 'markup'],
  ['n', 'note', 'comment'],
  ['b', 'stamp', 'comment'],
  ['Shift+D', 'dim', 'measure'],
  ['Shift+Q', 'dimc', 'measure'],
];
const missed = [];
for (const [k, t, g] of KEYS) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await toSelect();
  await page.keyboard.press(k);
  await page.waitForTimeout(60);
  const [now, f] = [await tool(), await face(g)];
  if (now !== t || f !== t) missed.push({ k, t, now, f });
}
check(
  "each shortcut the flyouts show picks its tool, and its group's button shows it",
  !missed.length,
  missed,
);
await toSelect();

/* ===================== kept on this device ===================== */
r = await box('#qg-shapes');
await page.mouse.click(r.x + r.width - 5, r.y + r.height - 5);
await page.click('#toolFlyout .tgitem[data-tool="spiral"]');
await toSelect();
await page.reload();
await load();
check(
  'the last tool of each group comes back after a reload',
  (await face('shapes')) === 'spiral' && (await face('measure')) === 'dimc',
  [await face('shapes'), await face('measure')],
);

/* ===================== the new tools draw ===================== */
await page.evaluate(() => {
  const X = window.ADDPDF;
  X.snapshot();
  X.S.items[0].shapes = [];
  X.drawShapes(X.S.items[0]);
});
const scr = (p) =>
  page.evaluate((p) => {
    const it = window.ADDPDF.S.items[0];
    const v = it.vp.convertToViewportPoint(p[0], p[1]);
    const r = it.anno.getBoundingClientRect();
    return { x: r.left + v[0], y: r.top + v[1] };
  }, p);
async function drag(t, from, by, keys) {
  r = await box('#qg-shapes');
  await page.mouse.click(r.x + r.width - 5, r.y + r.height - 5);
  await page.click('#toolFlyout .tgitem[data-tool="' + t + '"]');
  const a = await scr(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + by[0] / 2, a.y + by[1] / 2, { steps: 4 });
  for (const k of keys || []) await page.keyboard.press(k);
  await page.mouse.move(a.x + by[0], a.y + by[1], { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  return page.evaluate(() => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes.at(-1))));
}
const corners = (m) => (m.pts.length - 1) / 3;
const closedP = (m) => !m.open && m.pts[0][0] === m.pts.at(-1)[0] && m.pts[0][1] === m.pts.at(-1)[1];
await page.evaluate(() =>
  Object.assign(window.ADDPDF.shapeTools.opt, { sides: 6, points: 5, segs: 10, rr: 12 }),
);
let m = await drag('polygon', [150, 600], [60, 0]);
check(
  'Polygon: a closed path of 6 corners, from its centre',
  m.t === 'pen' && corners(m) === 6 && closedP(m),
  corners(m),
);
const R = Math.hypot(m.pts[0][0] - 150, m.pts[0][1] - 600);
check('…a corner where the pointer is (radius 60 px at this zoom)', R > 30, R);
m = await drag('polygon', [300, 600], [60, 0], ['ArrowUp', 'ArrowUp']);
check('…↑ while drawing adds a side', corners(m) === 8, corners(m));
m = await drag('star', [150, 450], [50, -20]);
check(
  'Star: a closed path of 5 points, 10 corners',
  m.t === 'pen' && corners(m) === 10 && closedP(m),
  corners(m),
);
const rad = m.pts.slice(0, 2).map((p, i) => Math.hypot(m.pts[i * 3][0] - 150, m.pts[i * 3][1] - 450));
check('…its inner corners half way in', Math.abs(rad[1] / rad[0] - 0.5) < 0.02, rad);
m = await drag('spiral', [300, 450], [50, 0]);
check(
  'Spiral: an open path of 10 quarter turns',
  m.t === 'pen' && m.open === true && corners(m) === 10 && !m.fill,
  corners(m),
);
m = await drag('rrect', [380, 400], [120, 80]);
check("Rounded Rectangle: core's rectangle, its corners rounded", m.t === 'rect' && m.rr === 12, m.rr);
check('every one in the colour and width in hand', m.c && m.w > 0);
const n = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
check('one shape a drag', n === 5, n);

/* select one: Properties calls it a Path; undo takes it back */
await toSelect();
await page.evaluate(() => {
  window.ADDPDF.setRail(true);
  document.getElementById('tabProps').click();
});
const starPt = await page.evaluate(() => window.ADDPDF.S.items[0].shapes[2].pts[0]);
const sp = await scr(starPt);
await page.mouse.click(sp.x, sp.y);
await page.waitForTimeout(150);
d = await page.evaluate(() => ({
  sel: window.ADDPDF.S.sel && window.ADDPDF.S.sel.i,
  name: document.getElementById('propsName').textContent,
}));
check('a star selects with the Selection tool, a Path in Properties', d.sel === 2 && /Path/i.test(d.name), d);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
check(
  'undo takes the last one back',
  (await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length)) === 4,
);

/* a click with no drag asks for the numbers, as Illustrator does */
r = await box('#qg-shapes');
await page.mouse.click(r.x + r.width - 5, r.y + r.height - 5);
await page.click('#toolFlyout .tgitem[data-tool="polygon"]');
const ck = await scr([450, 650]);
await page.mouse.click(ck.x, ck.y);
await page.waitForTimeout(200);
check('a click asks for the radius and sides', await page.isVisible('#stN'));
await page.fill('#stR', '40');
await page.fill('#stN', '5');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
m = await page.evaluate(() => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes.at(-1))));
check(
  '…and draws it there: 5 sides, radius 40 pt, a corner straight up',
  corners(m) === 5 && Math.abs(m.pts[0][0] - 450) < 0.1 && Math.abs(m.pts[0][1] - 690) < 0.1,
  m.pts[0],
);
await toSelect();

/* ===================== the dark theme ===================== */
d = await page.evaluate(() => {
  const b = document.body,
    was = b.dataset.ui;
  const read = () => {
    window.ADDPDF.toolGroups.open('shapes');
    const v = getComputedStyle(document.getElementById('toolFlyout')).backgroundColor;
    window.ADDPDF.toolGroups.close();
    return v;
  };
  b.dataset.ui = 'light';
  const light = read();
  delete b.dataset.ui;
  const dark = read();
  if (was) b.dataset.ui = was;
  return { light, dark };
});
check("the flyout in the theme's own colours, light and dark", d.light !== d.dark, d);

check('no errors on the page', !errors.length, errors);
console.log(fails ? fails + ' failed' : 'all passed');
await browser.close();
process.exit(fails ? 1 : 0);
