/* The Move tool end to end in Chromium, with the real mouse and keyboard, as
   Illustrator moves objects: the tool itself (M) and its Select (V) and
   Direct Selection (A) neighbours; dragging one object, several and a
   group; a wobble that moves nothing; the arrow keys (Shift, the Keyboard
   Increment, Alt for a copy); X and Y typed, at each reference point, as
   sums and in other units; the Move dialog (Preview, Copy, Distance and
   Angle, the last move remembered); snapping the grabbed point to another
   object's anchor, to a guide and to the grid; Alt-drag copies in their
   place in the stack and their own group; layers and the stacking order
   kept; locked and hidden objects left alone; undo and redo of it all.

   npm run build, then: node apps/web/bench/move.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4181;
const server = await serve(join(import.meta.dirname, '..', 'dist'), PORT);
const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: process.env.BENCH_CHANNEL || undefined },
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
await page.goto('http://localhost:' + PORT + '/');
await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
/* points throughout, the rulers' unit for X and Y */
await page.evaluate(() => {
  localStorage.setItem('adpdf.rulerUnit', 'pt');
  localStorage.removeItem('adpdf.nudge');
  localStorage.removeItem('adpdf.refPoint');
  localStorage.removeItem('adpdf.grid');
  localStorage.removeItem('adpdf.gridSnap');
  localStorage.removeItem('adpdf.gridStep');
  localStorage.removeItem('adpdf.movePreview');
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
const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
const nearP = (p, q, t = 0.6) => near(p[0], q[0], t) && near(p[1], q[1], t);

/* object snap off to start with: each snap is turned on where it is tested */
const snapOn = (want) =>
  page.evaluate((want) => {
    const b = document.getElementById('snapOn');
    if (b && b.classList.contains('on') !== want) b.click();
  }, want);
await snapOn(false);

async function lay() {
  await page.evaluate(() => {
    const X = window.ADDPDF,
      it = X.S.items[0];
    X.snapshot();
    it.shapes = [
      { t: 'rect', a: [80, 600], b: [160, 650], c: '#E2483D', w: 2, fill: '#ffee00', layer: 'L0' },
      { t: 'ellipse', a: [330, 590], b: [390, 640], c: '#1a73e8', w: 3, fill: '#ccddff', layer: 'L0' },
      { t: 'rect', a: [220, 420], b: [280, 470], c: '#111111', w: 1.5, fill: '#dddddd', layer: 'L0' },
      { t: 'rect', a: [440, 430], b: [500, 470], c: '#0a0', w: 2, fill: '#cfc', layer: 'L0', grp: 'gA' },
      { t: 'ellipse', a: [510, 430], b: [550, 470], c: '#0a0', w: 2, fill: '#cfc', layer: 'L0', grp: 'gA' },
    ];
    X.S.sel = null;
    X.S.multi = null;
    X.drawShapes(it);
  });
}
await lay();
await page.evaluate(() => window.ADDPDF.setTool('select'));

const shapes = () => page.evaluate(() => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes)));
const sel = () =>
  page.evaluate(() => {
    const X = window.ADDPDF;
    return X.S.sel
      ? X.selList()
          .slice()
          .sort((a, b) => a - b)
      : [];
  });
const scr = (p) =>
  page.evaluate((p) => {
    const it = window.ADDPDF.S.items[0];
    const v = it.vp.convertToViewportPoint(p[0], p[1]);
    const r = it.anno.getBoundingClientRect();
    return { x: r.left + v[0], y: r.top + v[1] };
  }, p);
const scale = await page.evaluate(() => window.ADDPDF.S.scale);
const D = (px) => px / scale;
/* a page point as seen: points from the page's top-left corner, y down */
const seen = (p) =>
  page.evaluate((p) => {
    const vp = window.ADDPDF.S.items[0].vp;
    const v = vp.convertToViewportPoint(p[0], p[1]);
    return [v[0] / vp.scale, v[1] / vp.scale];
  }, p);
async function dragScr(s, dx, dy, mods = [], steps = 6) {
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + dx / 3, s.y + dy / 3, { steps: 3 });
  await page.mouse.move(s.x + dx, s.y + dy, { steps });
  await page.mouse.up();
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(60);
}
const dragFrom = async (p, dx, dy, mods) => dragScr(await scr(p), dx, dy, mods);
async function clickAt(p, mods = []) {
  const s = await scr(p);
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.click(s.x, s.y);
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(60);
}
async function key(k) {
  await page.keyboard.press(k);
  await page.waitForTimeout(110);
}
const undo = () => key('Control+z');
const redo = () => key('Control+Shift+z');
const empty = [250, 700];
/* a marquee from a spot clear of the page's own text */
async function marquee(a, b) {
  const s = await scr(a),
    t = await scr(b);
  const at = await page.evaluate(
    ({ s, t }) => {
      const sx = Math.sign(s.x - t.x) || 1,
        sy = Math.sign(s.y - t.y) || 1;
      for (let k = 0; k < 60; k++) {
        const x = s.x + sx * k * 2,
          y = s.y + sy * k * 2;
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('.textLayer span') && !el.closest('.anno .sh, .anno text')) return { x, y };
      }
      return s;
    },
    { s, t },
  );
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
const undoCount = () => page.evaluate(() => window.ADDPDF.S.undo.length);

/* ======================= the tool ======================= */

await clickAt([120, 625]);
await key('m');
let st = await page.evaluate(() => ({
  tool: window.ADDPDF.S.tool,
  mode: document.body.classList.contains('move-mode'),
  lit: Array.from(document.querySelectorAll('[data-move="1"]')).some((b) => b.classList.contains('on')),
}));
check(
  'M puts the Move tool down: Select underneath, its button lit',
  st.tool === 'select' && st.mode && st.lit,
  st,
);
check('…and what was selected stays selected', (await sel()).join() === '0', await sel());

/* ======================= dragging ======================= */

/* 1. one object, by the drag, everything else about it kept */
let before = await shapes();
await dragFrom([120, 625], 70, 35);
let after = await shapes();
check(
  'a drag moves the object by the drag',
  near(after[0].a[0] - before[0].a[0], D(70)) &&
    near(after[0].a[1] - before[0].a[1], -D(35)) &&
    near(after[0].b[0] - after[0].a[0], 80, 0.001) &&
    after[0].fill === '#ffee00' &&
    after[0].layer === 'L0',
  { a: after[0].a },
);
check(
  '…the stacking order and the other objects untouched',
  after.map((s) => s.t).join() === before.map((s) => s.t).join() && nearP(after[1].a, before[1].a, 0.001),
);
check(
  '…and still selected, with its box and grips',
  (await sel()).join() === '0' &&
    (await page.evaluate(() => document.querySelectorAll('.anno .kn[data-mode="corner"]').length)) === 4,
);
await undo();
check('Undo puts it back exactly', nearP((await shapes())[0].a, [80, 600], 1e-9));
await redo();
check('Redo moves it again', near((await shapes())[0].a[0] - 80, D(70)));
await undo();

/* 2. a wobble of a pixel or two is a click, not a move */
await clickAt(empty);
await clickAt([120, 625]);
let u0 = await undoCount();
const c0 = await scr([120, 625]);
await page.mouse.move(c0.x, c0.y);
await page.mouse.down();
await page.mouse.move(c0.x + 1, c0.y + 1);
await page.mouse.move(c0.x + 2, c0.y);
await page.mouse.up();
await page.waitForTimeout(60);
check(
  'a press that wobbles two pixels moves nothing, and adds no undo step',
  nearP((await shapes())[0].a, [80, 600], 1e-9) && (await undoCount()) === u0,
);

/* 3. several at once */
await clickAt([360, 640], ['Shift']);
check('Shift-click adds the ellipse', (await sel()).join() === '0,1', await sel());
before = await shapes();
await dragFrom([120, 625], 0, 40);
after = await shapes();
check(
  'several move together, by the same',
  near(after[0].a[1] - before[0].a[1], -D(40)) &&
    near(after[1].a[1] - before[1].a[1], after[0].a[1] - before[0].a[1], 1e-9) &&
    nearP(after[2].a, before[2].a, 1e-9),
);
await undo();

/* 4. a group as one, from any of its members */
await clickAt(empty);
await clickAt([530, 450]);
check('a click on a member picks its group', (await sel()).join() === '3,4', await sel());
before = await shapes();
await dragFrom([470, 450], -40, 0);
after = await shapes();
const groupMoved = after[3].a[0] - before[3].a[0];
check(
  'the group moves whole',
  near(after[3].a[0] - before[3].a[0], -D(40), 4) &&
    near(after[4].a[0] - before[4].a[0], after[3].a[0] - before[3].a[0], 1e-9) &&
    after[3].grp === 'gA' &&
    after[4].grp === 'gA',
);
await undo();

/* ======================= arrow keys ======================= */

await clickAt(empty);
await clickAt([120, 625]);
u0 = await undoCount();
await key('ArrowRight');
await key('ArrowRight');
await key('ArrowUp');
after = await shapes();
check('the arrow keys move it 1 pt a press, as seen', nearP(after[0].a, [82, 601], 1e-6), after[0].a);
check('…a run of presses is one undo step', (await undoCount()) === u0 + 1, {
  was: u0,
  now: await undoCount(),
});
await key('Shift+ArrowDown');
check('Shift+arrow: 10 pt', nearP((await shapes())[0].a, [82, 591], 1e-6), (await shapes())[0].a);
await undo();
check(
  'Undo takes the run of nudges back at once',
  nearP((await shapes())[0].a, [80, 600], 1e-9),
  (await shapes())[0].a,
);

/* the Properties panel: the selection's Transform; with nothing selected,
   the document's Preferences, where the Keyboard Increment is */
await clickAt([120, 625]);
await page.evaluate(() => {
  window.ADDPDF.setRail(true);
  document.getElementById('tabProps').click();
});
await page.waitForTimeout(150);
await page.locator('#mpMove').scrollIntoViewIfNeeded();
check('the Transform section is there for the selection', await page.locator('#mpMove').isVisible());
await key('Escape');
await page.waitForTimeout(150);
const incField = page.locator('#mvInc');
await incField.scrollIntoViewIfNeeded();
check(
  "with nothing selected, the Keyboard Increment is in the document's Preferences",
  await incField.isVisible(),
);
await incField.fill('5');
await incField.press('Enter');
await page.mouse.move(10, 10);
await clickAt([120, 625]);
await key('ArrowLeft');
check(
  'a Keyboard Increment of 5 pt: one press moves 5',
  nearP((await shapes())[0].a, [75, 600], 1e-6),
  (await shapes())[0].a,
);
await key('Shift+ArrowLeft');
check('…and Shift ten of them, 50', nearP((await shapes())[0].a, [25, 600], 1e-6), (await shapes())[0].a);
await page.evaluate(() => window.ADDPDF.nudgeIncrement(1));
await page.waitForTimeout(900);
await undo();

/* Alt+arrow: a copy stays, the selection moves on */
await clickAt([120, 625]);
let n0 = (await shapes()).length;
await key('Alt+ArrowRight');
after = await shapes();
check(
  'Alt+arrow: a copy stays where it was, under the one moved, which stays selected',
  after.length === n0 + 1 &&
    nearP(after[0].a, [80, 600], 1e-9) &&
    nearP(after[1].a, [81, 600], 1e-6) &&
    (await sel()).join() === '1',
  { n: after.length, a0: after[0].a, a1: after[1].a, sel: await sel() },
);
await key('Alt+ArrowRight');
check('…each press another copy', (await shapes()).length === n0 + 2);
await undo();
check('Undo takes one press back at a time', (await shapes()).length === n0 + 1);
await undo();
check('…and the first', (await shapes()).length === n0 && nearP((await shapes())[0].a, [80, 600], 1e-9));

/* ======================= X and Y ======================= */

await clickAt(empty);
await clickAt([120, 625]);
await page.waitForTimeout(80);
/* the rectangle as seen: x 80…160 from the left, its top 650 pt up the page */
const tl = await seen([80, 650]);
const vals = async () => ({
  x: +(await page.locator('#mvX').inputValue()),
  y: +(await page.locator('#mvY').inputValue()),
  w: +(await page.locator('#mvSize').getAttribute('data-w')),
  h: +(await page.locator('#mvSize').getAttribute('data-h')),
});
let v = await vals();
check(
  'X and Y show the middle (the reference point at first), W and H its size',
  near(v.x, tl[0] + 40, 0.01) && near(v.y, tl[1] + 25, 0.01) && near(v.w, 80, 0.01) && near(v.h, 50, 0.01),
  { v, tl },
);
await page.click('#mpMove [data-ref="tl"]');
v = await vals();
check(
  'the top-left reference point: X and Y are its top-left corner',
  near(v.x, tl[0], 0.01) && near(v.y, tl[1], 0.01),
  v,
);
await page.locator('#mvX').fill('200');
await page.locator('#mvX').press('Enter');
after = await shapes();
check(
  'X typed: it moves across to there, its size kept',
  near((await seen(after[0].a))[0], 200, 0.001) && near(after[0].b[0] - after[0].a[0], 80, 1e-6),
  after[0].a,
);
await page.locator('#mvY').fill('100');
await page.locator('#mvY').press('Enter');
after = await shapes();
check(
  'Y typed: its top 100 pt down from the top of the page',
  near((await seen([after[0].a[0], after[0].b[1]]))[1], 100, 0.001),
  after[0],
);
await page.locator('#mvX').fill('+10');
await page.locator('#mvX').press('Enter');
check('"+10": 10 further across', near((await seen((await shapes())[0].a))[0], 210, 0.001));
await page.locator('#mvX').fill('1in+2');
await page.locator('#mvX').press('Enter');
check('"1in+2": a sum in another unit, 74 pt', near((await seen((await shapes())[0].a))[0], 74, 0.001));
await page.locator('#mvX').fill('2*(10+5)mm');
await page.locator('#mvX').press('Enter');
check('"2*(10+5)mm": 30 mm', near((await seen((await shapes())[0].a))[0], (30 * 72) / 25.4, 0.001));
const bad0 = (await shapes())[0].a;
await page.locator('#mvX').fill('abc');
await page.locator('#mvX').press('Enter');
check('nonsense typed moves nothing', nearP((await shapes())[0].a, bad0, 1e-9));
await page.locator('#mvX').press('Escape');
for (let k = 0; k < 5; k++) await undo();
check('each one is its own undo', nearP((await shapes())[0].a, [80, 600], 1e-9), (await shapes())[0].a);
await redo();
check('…and Redo', near((await seen((await shapes())[0].a))[0], 200, 0.001), {
  a: (await shapes())[0].a,
  seen: await seen((await shapes())[0].a),
});
await undo();

/* several, and the bottom-right reference point */
await clickAt(empty);
await clickAt([120, 625]);
await clickAt([360, 640], ['Shift']);
await page.click('#mpMove [data-ref="br"]');
v = await vals();
const br = await seen([390, 590]);
check(
  'with two selected: X and Y are of their box together',
  near(v.x, br[0], 0.01) && near(v.y, br[1], 0.01) && near(v.w, 310, 0.01),
  v,
);
await page.locator('#mvX').fill('500');
await page.locator('#mvX').press('Enter');
after = await shapes();
check(
  'X typed moves both together',
  near((await seen([after[1].b[0], 0]))[0], 500, 0.001) &&
    near(after[0].a[0] - 80, after[1].a[0] - 330, 1e-6),
);
await undo();
await clickAt([120, 625]);
await page.click('#mpMove [data-ref="mc"]');

/* ======================= the Move dialog ======================= */

await clickAt(empty);
await clickAt([120, 625]);
await page.mouse.move(10, 10);
await page.keyboard.press('Enter');
let dlg = page.locator('.wdbox[aria-label="Move"]');
await dlg.waitFor({ timeout: 2000 });
check('Enter opens the Move dialog', await dlg.isVisible());
await page.fill('#mvdH', '30');
await page.fill('#mvdV', '40');
let dv = await page.evaluate(() => ({
  d: document.getElementById('mvdD').value,
  a: document.getElementById('mvdA').value,
}));
check(
  'Distance and Angle follow Horizontal and Vertical',
  near(+dv.d, 50, 0.01) && near(+dv.a, -53.13, 0.01),
  dv,
);
await page.fill('#mvdD', '10');
await page.fill('#mvdA', '90');
dv = await page.evaluate(() => ({
  h: document.getElementById('mvdH').value,
  v: document.getElementById('mvdV').value,
}));
check('…and the other way: 10 at 90° is straight up', near(+dv.h, 0, 0.01) && near(+dv.v, -10, 0.01), dv);
/* Preview shows it, Cancel puts it back */
await page.fill('#mvdH', '30');
await page.fill('#mvdV', '40');
await page.check('#mvdP');
await page.waitForTimeout(80);
let pv = (await shapes())[0];
check('Preview: shown on the page as typed', nearP(pv.a, [110, 560], 1e-6), pv.a);
await page.click('.wdbox[aria-label="Move"] .wdno');
await page.waitForTimeout(80);
check('Cancel: back where it was, and nothing to undo', nearP((await shapes())[0].a, [80, 600], 1e-9));
/* OK */
await page.keyboard.press('Control+Shift+M');
await dlg.waitFor({ timeout: 2000 });
dv = await page.evaluate(() => ({
  h: document.getElementById('mvdH').value,
  v: document.getElementById('mvdV').value,
}));
/* a cancelled dialog is not remembered: it opens on the last move made, the group's drag */
check(
  'Ctrl+Shift+M opens it too, on the last move made (Cancel is not remembered)',
  near(+dv.h, groupMoved, 0.01) && near(+dv.v, 0, 0.01),
  { dv, groupMoved },
);
await page.fill('#mvdH', '30');
await page.fill('#mvdV', '40');
await page.click('.wdbox[aria-label="Move"] .wdok');
await page.waitForTimeout(80);
check(
  'OK: moved 30 across and 40 down',
  nearP((await shapes())[0].a, [110, 560], 1e-6),
  (await shapes())[0].a,
);
await undo();
check('one Undo takes it back', nearP((await shapes())[0].a, [80, 600], 1e-9));
/* Copy */
n0 = (await shapes()).length;
await clickAt([120, 625]);
await page.keyboard.press('Enter');
await dlg.waitFor({ timeout: 2000 });
await page.fill('#mvdH', '0');
await page.fill('#mvdV', '-100');
await page.click('.wdbox[aria-label="Move"] .mvcopy');
await page.waitForTimeout(80);
after = await shapes();
check(
  'Copy: a copy moved, the original left, in its place in the stack',
  after.length === n0 + 1 &&
    nearP(after[0].a, [80, 600], 1e-9) &&
    nearP(after[1].a, [80, 700], 1e-6) &&
    after[1].fill === '#ffee00',
  { n: after.length, a1: after[1] && after[1].a },
);
await undo();
check('Undo takes the copy away', (await shapes()).length === n0);
/* after a drag, the dialog offers that move */
await clickAt([120, 625]);
await dragFrom([120, 625], 50, 0);
const moved = (await shapes())[0].a[0] - 80;
await page.mouse.move(10, 10);
await page.keyboard.press('Enter');
await dlg.waitFor({ timeout: 2000 });
dv = await page.evaluate(() => ({
  h: document.getElementById('mvdH').value,
  v: document.getElementById('mvdV').value,
}));
check(
  'after a drag it opens on that move, as Illustrator does',
  near(+dv.h, moved, 0.01) && near(+dv.v, 0, 0.01),
  { dv, moved },
);
await page.click('.wdbox[aria-label="Move"] .wdno');
await undo();
/* a double-click on the Move tool opens it */
await clickAt([120, 625]);
await page.evaluate(() => window.ADDPDF.setRibbon && window.ADDPDF.setRibbon('ribEdit'));
const mvBtn = page.locator('#tEditMove');
if (await mvBtn.isVisible()) {
  await mvBtn.dblclick();
  await page.waitForTimeout(100);
  check('a double-click on the Move tool opens it', await dlg.isVisible());
  if (await dlg.isVisible()) await page.click('.wdbox[aria-label="Move"] .wdno');
}

/* ======================= snapping ======================= */

await snapOn(true);
await clickAt(empty);
await clickAt([250, 445]);
/* grab the grey box just inside its top-right corner (not on the grip, which
   resizes) and bring that corner near the yellow one's bottom right: the
   corner is what snaps, as Illustrator's Snap to Point has it */
let tr = await scr([276, 466]);
let target = await scr([160, 600]);
await dragScr(tr, target.x - tr.x + 4, target.y - tr.y + 3);
after = await shapes();
check(
  "object snap: the grabbed corner lands exactly on the other object's anchor",
  nearP([after[2].b[0], after[2].b[1]], [160, 600], 1e-6),
  { b: after[2].b },
);
await undo();

/* a guide */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  if (X.rulers && !X.rulers.on()) X.rulers.toggle(true);
  it.guides = [{ v: true, at: 0.5 }];
});
await page.waitForTimeout(300);
const guideX = await page.evaluate(() => {
  const it = window.ADDPDF.S.items[0];
  const off = it.off || { left: 0, top: 0 };
  const x = 0.5 * it.wrap.clientWidth + off.left;
  return it.vp.convertToPdfPoint(x, 0)[0];
});
await clickAt([250, 445]);
const left0 = await scr([224, 424]);
const gS = await scr([guideX, 445]);
await dragScr(left0, gS.x - left0.x + 5, 0);
after = await shapes();
check('the grabbed corner lands on a ruler guide', near(after[2].a[0], guideX, 1e-6), {
  a: after[2].a[0],
  guideX,
});
await undo();
await page.evaluate(() => {
  const X = window.ADDPDF;
  X.S.items[0].guides = [];
  if (X.rulers && X.rulers.on()) X.rulers.toggle(false);
});
await page.waitForTimeout(200);

/* the grid: shown and snapped to, from View */
await page.evaluate(() => window.ADDPDF.setRibbon && window.ADDPDF.setRibbon('ribView'));
await page.click('#btnGrid');
await page.click('#btnGridSnap');
const gst = await page.evaluate(() => ({
  shown: !document.querySelector('.pgrid').hidden,
  img: document.querySelector('.pgrid').style.backgroundImage.length > 0,
  snap: window.ADDPDF.grid.snapping(),
  step: window.ADDPDF.grid.step(),
}));
check(
  'View > Grid shows the grid, Snap to Grid turns it on (72 pt, 8 subdivisions in points)',
  gst.shown && gst.img && gst.snap && near(gst.step.every, 72, 1e-9) && gst.step.sub === 8,
  gst,
);
await snapOn(false);
await clickAt(empty);
await clickAt([250, 445]);
await dragFrom([250, 445], 37, 23);
after = await shapes();
const sTL = await seen([after[2].a[0], after[2].b[1]]);
const sMid = await seen([(after[2].a[0] + after[2].b[0]) / 2, (after[2].a[1] + after[2].b[1]) / 2]);
const onGrid = (n) => Math.abs(n / 9 - Math.round(n / 9)) < 1e-6;
check(
  'Snap to Grid: what is grabbed lands on the grid (every 9 pt), object snap off or not',
  (onGrid(sMid[0]) && onGrid(sMid[1])) || (onGrid(sTL[0]) && onGrid(sTL[1])),
  { sTL, sMid },
);
await undo();
await page.keyboard.press("Control+Shift+'");
await page.keyboard.press("Control+'");
await page.waitForTimeout(80);
check(
  "Ctrl+' and Ctrl+Shift+' turn them off again",
  await page.evaluate(() => document.querySelector('.pgrid').hidden && !window.ADDPDF.grid.snapping()),
);

/* ======================= copies, layers, the stack ======================= */

/* Alt-drag of a group: its copy is a group of its own */
await clickAt(empty);
await clickAt([530, 450]);
n0 = (await shapes()).length;
await dragFrom([530, 450], 0, -60, ['Alt']);
after = await shapes();
const copyGrp = after.filter((s) => s.grp && s.grp !== 'gA');
check(
  'Alt-drag of a group: the copy left behind is a group of its own, in the stack where the group was',
  after.length === n0 + 2 &&
    copyGrp.length === 2 &&
    copyGrp[0].grp === copyGrp[1].grp &&
    after.filter((s) => s.grp === 'gA').length === 2 &&
    after[3].grp === after[4].grp &&
    after[3].grp !== 'gA' &&
    after[5].grp === 'gA' &&
    after[6].grp === 'gA' &&
    (await sel()).join() === '5,6',
  { g: after.map((s) => s.grp || '-'), sel: await sel() },
);
await undo();
check('Undo takes the copy away', (await shapes()).length === n0);

/* a locked object, and a hidden one, are never moved or picked */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes[1] = Object.assign({}, it.shapes[1], { locked: true });
  it.shapes[2] = Object.assign({}, it.shapes[2], { hide: true });
  X.S.sel = null;
  X.drawShapes(it);
});
before = await shapes();
await dragFrom([360, 640], 40, 0);
check('a locked object cannot be dragged', nearP((await shapes())[1].a, before[1].a, 1e-9));
await clickAt(empty);
await marquee([60, 690], [420, 400]);
const mq = await sel();
check(
  'a marquee over them picks neither the locked nor the hidden one',
  mq.indexOf(1) < 0 && mq.indexOf(2) < 0 && mq.indexOf(0) >= 0,
  mq,
);
await key('ArrowRight');
after = await shapes();
check(
  '…so the arrow keys move only what may move',
  nearP(after[1].a, before[1].a, 1e-9) &&
    nearP(after[2].a, before[2].a, 1e-9) &&
    near(after[0].a[0], before[0].a[0] + 1, 1e-6),
);
await page.waitForTimeout(900);
await undo();
await undo();
check(
  'Undo: nothing locked or hidden any more, as before',
  await page.evaluate(() => !window.ADDPDF.S.items[0].shapes.some((s) => s.locked || s.hide)),
);

/* ======================= Direct Selection beside it ======================= */

await clickAt(empty);
await page.evaluate(() => window.ADDPDF.setTool('vdirect'));
await clickAt([120, 625]);
await clickAt([160, 650]);
await key('ArrowRight');
after = await shapes();
check(
  'Direct Selection (A): the arrow key moves only the anchor picked',
  after[0].t === 'pen' &&
    after[0].pts.some((q) => nearP(q, [161, 650], 1e-6)) &&
    after[0].pts.some((q) => nearP(q, [80, 600], 1e-9)),
  after[0].t,
);
await page.waitForTimeout(900);
await undo();
check('…undone, the rectangle is a rectangle again', (await shapes())[0].t === 'rect');
await key('Escape');
await key('m');
await clickAt([120, 625]);
before = await shapes();
await dragFrom([120, 625], 0, 30);
after = await shapes();
/* the rulers came and went, and the fit with them: the zoom now */
const k2 = await page.evaluate(() => window.ADDPDF.S.scale);
check(
  'back on Move (M): the whole object moves, not a point',
  after[0].t === 'rect' &&
    near(after[0].a[1] - before[0].a[1], -30 / k2, 4) &&
    near(after[0].b[1] - after[0].a[1], 50, 1e-9),
  { t: after[0].t, d: after[0].a[1] - before[0].a[1], want: -30 / k2 },
);
await undo();
await key('v');
check(
  'V: Select, Move let go of',
  await page.evaluate(
    () => window.ADDPDF.S.tool === 'select' && !document.body.classList.contains('move-mode'),
  ),
);

check('no errors on the page', errors.length === 0, errors);
await browser.close();
if (server.close) server.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
