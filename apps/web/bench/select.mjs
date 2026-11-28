/* The Select tool (V) and Direct Selection (A) end to end in Chromium, with
   the real mouse and keyboard, as Illustrator has them.

   Select: a click picks the whole object (a group, a path, text); a drag
   moves it, Shift along 0/45/90°; the box's corner and side grips resize,
   Shift keeping proportions, Alt from the middle; just off a corner it
   turns, Shift by 15°; Shift-click and Ctrl-click add and take away; a
   marquee picks what it touches, Shift adding to what is picked; Alt-drag
   (or Ctrl-drag) leaves a copy; copy, paste, duplicate, delete; every one
   undone and redone.

   Direct Selection: one anchor, several (Shift-click, marquee) moved alone;
   a Bézier handle pulled; a segment dragged without the rest of the path;
   a rectangle, an ellipse and a line edited in place (they become paths on
   the first edit, their look kept); an open end dropped on another joins
   them, on its own other end closes the path; all undone and redone.

   npm run build, then: node apps/web/bench/select.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4179;
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
await page.setInputFiles('#fileIn', join(CORPUS_DIR, 'small-text-12p.pdf'));
await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
  timeout: 60000,
});
await page.waitForTimeout(600);
/* the page across the whole width, as these drags were measured: the
   Properties panel opens with each document (toolprops.js) */
await page.evaluate(() => window.ADDPDF.setRail(false));
await page.waitForTimeout(400);

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};
const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
const nearP = (p, q, t = 0.6) => near(p[0], q[0], t) && near(p[1], q[1], t);

/* object snap off, so a drag lands where the pointer goes */
await page.evaluate(() => {
  const b = document.getElementById('snapOn');
  if (b && b.classList.contains('on')) b.click();
});

/* the marks to work on, laid out apart from one another and the page's middle */
async function lay() {
  await page.evaluate(() => {
    const X = window.ADDPDF,
      it = X.S.items[0];
    X.snapshot();
    it.shapes = [
      { t: 'rect', a: [80, 600], b: [160, 650], c: '#E2483D', w: 2, fill: '#ffee00', d: 'dash' },
      { t: 'ellipse', a: [330, 590], b: [390, 640], c: '#1a73e8', w: 3 },
      { t: 'line', a: [90, 420], b: [190, 470], c: '#111111', w: 1.5 },
      {
        t: 'pen',
        pts: [
          [330, 400],
          [350, 440],
          [390, 440],
          [410, 400],
        ],
        open: true,
        c: '#0a0',
        w: 2,
      },
      { t: 'text', a: [100, 520], text: 'Words here', size: 18, c: '#333333', f: 'helv' },
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
    return X.S.sel ? X.selList().slice().sort() : [];
  });
/* a page point (PDF points) on the screen */
const scr = (p) =>
  page.evaluate((p) => {
    const it = window.ADDPDF.S.items[0];
    const v = it.vp.convertToViewportPoint(p[0], p[1]);
    const r = it.anno.getBoundingClientRect();
    return { x: r.left + v[0], y: r.top + v[1] };
  }, p);
const scale = await page.evaluate(() => window.ADDPDF.S.scale);
/* a drag in screen pixels from a page point; mods held through it */
async function dragFrom(p, dx, dy, mods = []) {
  const s = await scr(p);
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + dx / 3, s.y + dy / 3, { steps: 3 });
  await page.mouse.move(s.x + dx, s.y + dy, { steps: 5 });
  await page.mouse.up();
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(60);
}
async function dragScr(s, dx, dy, mods = []) {
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + dx / 3, s.y + dy / 3, { steps: 3 });
  await page.mouse.move(s.x + dx, s.y + dy, { steps: 5 });
  await page.mouse.up();
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(60);
}
async function clickAt(p, mods = []) {
  const s = await scr(p);
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.click(s.x, s.y);
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(60);
}
async function key(k) {
  await page.keyboard.press(k);
  await page.waitForTimeout(120);
}
/* a marquee from a to b (page points), from a spot clear of the page's own
   text (a drag there selects the text, as before) */
async function marquee(a, b, mods = []) {
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
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps: 8 });
  await page.mouse.up();
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(60);
}
const undo = () => key('Control+z');
const redo = () => key('Control+Shift+z');
/* screen pixels as page points (points run up the page, pixels down) */
const D = (px) => px / scale;

/* ========================= Select (V) ========================= */

/* 1. a click picks the whole object, with the box, eight grips and turn zones */
await clickAt([120, 625]);
let n = await page.evaluate(() => ({
  corners: document.querySelectorAll('.anno .kn[data-mode="corner"]').length,
  sides: document.querySelectorAll('.anno .kn.pill').length,
  turn: document.querySelectorAll('.anno .rotz').length,
}));
check(
  'a click picks the rectangle: the box with four corner grips, four side grips, turn zones',
  (await sel()).join() === '0' && n.corners === 4 && n.sides === 4 && n.turn >= 4,
  n,
);

/* 2. dragged, it moves by the drag exactly, its size and look kept */
let before = (await shapes())[0];
await dragFrom([120, 625], 83, 41);
let s0 = (await shapes())[0];
check(
  'a drag moves it by the drag, the size and every property kept',
  near(s0.a[0] - before.a[0], D(83)) &&
    near(s0.a[1] - before.a[1], -D(41)) &&
    near(s0.b[0] - s0.a[0], 80) &&
    near(s0.b[1] - s0.a[1], 50) &&
    s0.c === before.c &&
    s0.w === before.w &&
    s0.fill === before.fill &&
    s0.d === before.d,
  { d: [s0.a[0] - before.a[0], s0.a[1] - before.a[1]], want: [D(83), -D(41)] },
);
await undo();
s0 = (await shapes())[0];
check('Undo puts it back', nearP(s0.a, before.a, 0.01) && nearP(s0.b, before.b, 0.01), s0.a);
await redo();
s0 = (await shapes())[0];
check('Redo moves it again', near(s0.a[0] - before.a[0], D(83)), s0.a);
await undo();

/* 3. Shift: along 45° */
await clickAt([120, 625]);
before = (await shapes())[0];
await dragFrom([120, 625], 70, 61, ['Shift']);
s0 = (await shapes())[0];
let dx = s0.a[0] - before.a[0],
  dy = s0.a[1] - before.a[1];
check('Shift-drag keeps the move to 45°', Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6 && Math.abs(dx) > 10, {
  dx,
  dy,
});
await undo();
await dragFrom([120, 625], 90, 8, ['Shift']);
s0 = (await shapes())[0];
check(
  '…and to level when the drag is nearly level',
  near(s0.a[1], before.a[1], 0.01) && s0.a[0] - before.a[0] > 10,
  s0.a,
);
await undo();

/* 4. corner grip: resize; Shift: in proportion; Alt: from the middle */
await clickAt([120, 625]);
before = (await shapes())[0];
/* the corner grip nearest the box's bottom right (x2, y1 in points) */
const gp = await scr([before.b[0], before.a[1]]);
const cg = await page.evaluate(
  (p) =>
    Array.from(document.querySelectorAll('.anno .kn[data-mode="corner"]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0],
  gp,
);
await dragScr(cg, 40, 30);
s0 = (await shapes())[0];
check(
  'a corner grip resizes, the opposite corner staying put',
  near(s0.a[0], before.a[0]) &&
    near(s0.b[1], before.b[1]) &&
    near(s0.b[0] - s0.a[0], 80 + D(40)) &&
    near(s0.b[1] - s0.a[1], 50 + D(30)),
  { a: s0.a, b: s0.b },
);
await undo();
await clickAt([120, 625]);
await dragScr(cg, 40, 5, ['Shift']);
s0 = (await shapes())[0];
let w = s0.b[0] - s0.a[0],
  h = s0.b[1] - s0.a[1];
check('Shift: the corner keeps the proportions', near(w / h, 80 / 50, 0.02) && w > 85, { w, h });
await undo();
await clickAt([120, 625]);
await dragScr(cg, 40, 30, ['Alt']);
s0 = (await shapes())[0];
w = s0.b[0] - s0.a[0];
h = s0.b[1] - s0.a[1];
check(
  'Alt: resized from the middle, which stays where it was',
  nearP([(s0.a[0] + s0.b[0]) / 2, (s0.a[1] + s0.b[1]) / 2], [120, 625]) &&
    near(w, 80 + 2 * D(40)) &&
    near(h, 50 + 2 * D(30)),
  { w, h, mid: [(s0.a[0] + s0.b[0]) / 2, (s0.a[1] + s0.b[1]) / 2] },
);
const altCount = (await shapes()).length;
check('…and Alt on a grip is a resize, not a copy', altCount === 5, altCount);
await undo();

/* 5. a side grip: one way only */
await clickAt([120, 625]);
const rp = await scr([160, 625]);
const sg = await page.evaluate(
  (p) =>
    Array.from(document.querySelectorAll('.anno .kn.pill'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0],
  rp,
);
await dragScr(sg, 35, 20);
s0 = (await shapes())[0];
check(
  'a side grip stretches one way only',
  near(s0.b[0] - s0.a[0], 80 + D(35)) &&
    near(s0.a[0], 80) &&
    near(s0.a[1], 600, 0.01) &&
    near(s0.b[1], 650, 0.01),
  { a: s0.a, b: s0.b },
);
await undo();
await clickAt([120, 625]);
await dragScr(sg, 35, 0, ['Alt']);
s0 = (await shapes())[0];
check(
  'Alt on a side grip: both sides move, the middle stays',
  near((s0.a[0] + s0.b[0]) / 2, 120) && near(s0.b[0] - s0.a[0], 80 + 2 * D(35)),
  { a: s0.a, b: s0.b },
);
await undo();

/* 6. just off a corner: it turns; Shift by 15° */
await clickAt([120, 625]);
const tz = await page.evaluate(() => {
  const z = document.querySelector('.anno .rotz');
  const r = z.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await dragScr(tz, 0, 60);
s0 = (await shapes())[0];
check(
  'dragged from just off a corner, it turns about its middle',
  Math.abs(s0.r || 0) > 5 && nearP([(s0.a[0] + s0.b[0]) / 2, (s0.a[1] + s0.b[1]) / 2], [120, 625]),
  { r: s0.r },
);
await undo();
await clickAt([120, 625]);
await dragScr(tz, 0, 47, ['Shift']);
s0 = (await shapes())[0];
check(
  'Shift: the turn goes by 15°',
  (Math.abs(s0.r || 0) >= 14 && Math.abs(((s0.r % 15) + 15) % 15) < 0.01) ||
    Math.abs((((s0.r % 15) + 15) % 15) - 15) < 0.01,
  { r: s0.r },
);
await undo();
s0 = (await shapes())[0];
check('Undo takes the turn back', !s0.r, s0.r);

/* 7. Shift-click adds and takes away; Ctrl-click too */
await clickAt([120, 625]);
await clickAt([390, 615], ['Shift']);
check('Shift-click adds the ellipse to the rectangle', (await sel()).join() === '0,1', await sel());
await clickAt([370, 430], ['Shift']);
check('…and the path', (await sel()).join() === '0,1,3', await sel());
await clickAt([390, 615], ['Shift']);
check('Shift-click on a picked one takes it away', (await sel()).join() === '0,3', await sel());
await clickAt([140, 445], ['Control']);
check('Ctrl-click adds as before', (await sel()).join() === '0,2,3', await sel());

/* 8. the selection moves together, and undoes as one */
before = await shapes();
await dragFrom([120, 625], 50, 25);
let after = await shapes();
check(
  'the picked marks move together; the one left out stays',
  near(after[0].a[0] - before[0].a[0], D(50)) &&
    near(after[2].a[0] - before[2].a[0], D(50)) &&
    near(after[3].pts[0][0] - before[3].pts[0][0], D(50)) &&
    nearP(after[1].a, before[1].a, 0.001),
);
await undo();
after = await shapes();
check(
  'one Undo puts them all back',
  nearP(after[0].a, before[0].a, 0.01) && nearP(after[3].pts[0], before[3].pts[0], 0.01),
);

/* 9. marquee: what it touches; Shift adds */
await page.keyboard.press('Escape');
await clickAt([250, 700]);
check('a click on empty page picks nothing', (await sel()).length === 0, await sel());
await marquee([60, 690], [420, 580]);
check(
  'a marquee picks what it touches: the rectangle and the ellipse',
  (await sel()).join() === '0,1',
  await sel(),
);
await marquee([60, 490], [250, 410], ['Shift']);
check('Shift-marquee adds the line to them', (await sel()).join() === '0,1,2', await sel());

/* 10. copy, paste, duplicate, delete */
await clickAt([250, 700]);
await clickAt([120, 625]);
let count = (await shapes()).length;
await key('Control+c');
await key('Control+v');
after = await shapes();
check(
  'Copy and Paste: a copy, its look the same, the copy picked',
  after.length === count + 1 &&
    after[count].t === 'rect' &&
    after[count].fill === '#ffee00' &&
    after[count].d === 'dash' &&
    (await sel()).join() === String(count),
  { n: after.length },
);
await undo();
check('Undo takes the paste away', (await shapes()).length === count);
await clickAt([120, 625]);
await key('Control+d');
check('Duplicate (Ctrl+D) adds a copy', (await shapes()).length === count + 1);
await undo();
await clickAt([120, 625]);
await key('Delete');
after = await shapes();
check('Delete takes it away', after.length === count - 1 && after[0].t === 'ellipse');
await undo();
after = await shapes();
check(
  'Undo brings it back, all of it',
  after.length === count && after[0].t === 'rect' && after[0].fill === '#ffee00',
);

/* 11. Alt-drag leaves a copy where it was; Ctrl-drag as before */
await clickAt([120, 625]);
before = (await shapes())[0];
await dragFrom([120, 625], 60, 0, ['Alt']);
after = await shapes();
check(
  'Alt-drag: one stays in its place and its turn in the stack, the one dragged just above it',
  after.length === count + 1 &&
    nearP(after[0].a, before.a, 0.001) &&
    near(after[1].a[0] - before.a[0], D(60)) &&
    after[0].fill === before.fill &&
    after[2].t === 'ellipse' &&
    (await sel()).join() === '1',
  { n: after.length, t: after.map((x) => x.t), sel: await sel() },
);
await undo();
check(
  'Undo takes the copy back',
  (await shapes()).length === count && nearP((await shapes())[0].a, before.a, 0.01),
);

/* 12. a group: one click picks it all; a drag moves it all */
await clickAt([120, 625]);
await clickAt([390, 615], ['Shift']);
await key('Control+g');
await page.keyboard.press('Escape');
await clickAt([250, 700]);
await clickAt([390, 615]);
check('grouped: a click on one picks the group', (await sel()).join() === '0,1', await sel());
before = await shapes();
await dragFrom([390, 615], -30, 20);
after = await shapes();
/* smart guides may pull the drop onto a neighbour's edge: about the drag, all by the same */
check(
  'the group moves as one',
  near(after[0].a[0] - before[0].a[0], -D(30), 4) &&
    near(after[1].a[0] - before[1].a[0], after[0].a[0] - before[0].a[0], 0.001) &&
    near(after[1].a[1] - before[1].a[1], after[0].a[1] - before[0].a[1], 0.001),
  { b: before.slice(0, 2).map((x) => [x.t, x.a, x.grp]), a: after.slice(0, 2).map((x) => [x.t, x.a]) },
);
await undo();
await undo();

/* 13. text and a path are whole objects too */
await clickAt([250, 700]);
const tx = (await shapes())[4];
const tAt = await page.evaluate(() => {
  const el = document.querySelector('.anno text');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await dragScr(tAt, 40, 0);
after = await shapes();
check(
  'text: picked and moved whole, its words and size kept',
  near(after[4].a[0] - tx.a[0], D(40), 4) &&
    near(after[4].a[1], tx.a[1], 4) &&
    after[4].text === 'Words here' &&
    after[4].size === 18,
  { was: tx.a, now: after[4].a, sel: await sel() },
);
await undo();
await clickAt([370, 430]);
before = await shapes();
await dragFrom([370, 430], 0, 30);
after = await shapes();
check(
  'a path: picked and moved whole, every point with it',
  near(after[3].pts[0][1] - before[3].pts[0][1], -D(30), 4) &&
    after[3].pts.every(
      (q, i) =>
        near(q[0] - before[3].pts[i][0], after[3].pts[0][0] - before[3].pts[0][0], 0.001) &&
        near(q[1] - before[3].pts[i][1], after[3].pts[0][1] - before[3].pts[0][1], 0.001),
    ),
);
await undo();

/* ===================== Direct Selection (A) ===================== */
await page.keyboard.press('Escape');
await page.evaluate(() => window.ADDPDF.setTool('vdirect'));
await page.waitForTimeout(60);

/* 14. a rectangle's corner moved alone: the rest stays; it becomes a path, its look kept */
await clickAt([120, 625]);
before = await shapes();
await dragFrom([160, 650], 30, -20);
after = await shapes();
let r0 = after[0];
const has = (P, q) => P.some((p) => nearP(p, q, 0.01));
check(
  "Direct Selection: the rectangle's one corner moved, the other three where they were",
  r0.t === 'pen' &&
    !r0.open &&
    has(r0.pts, [160 + D(30), 650 + D(20)]) &&
    has(r0.pts, [80, 600]) &&
    has(r0.pts, [160, 600]) &&
    has(r0.pts, [80, 650]) &&
    !has(r0.pts, [160, 650]),
  { t: r0.t, pts: r0.pts && r0.pts.filter((q, i) => i % 3 === 0) },
);
check(
  '…its stroke, fill and dash kept',
  r0.c === '#E2483D' && r0.w === 2 && r0.fill === '#ffee00' && r0.d === 'dash',
  r0,
);
await undo();
after = await shapes();
check(
  'Undo: the rectangle again, as it was',
  after[0].t === 'rect' && nearP(after[0].a, [80, 600], 0.001) && nearP(after[0].b, [160, 650], 0.001),
  after[0].t,
);
await redo();
after = await shapes();
check('Redo: the corner moved again', after[0].t === 'pen' && has(after[0].pts, [160 + D(30), 650 + D(20)]));
await undo();

/* 15. Shift-click picks two anchors; both move, nothing else */
await clickAt([120, 625]);
await clickAt([80, 600]);
await clickAt([160, 600], ['Shift']);
let picked = await page.evaluate(() => window.ADDPDF.penEdit.selected());
check('Shift-click picks a second anchor', picked === 2, picked);
await dragFrom([160, 600], 0, 25);
after = await shapes();
r0 = after[0];
check(
  'the two picked anchors move together, the others stay',
  has(r0.pts, [80, 600 - D(25)]) &&
    has(r0.pts, [160, 600 - D(25)]) &&
    has(r0.pts, [80, 650]) &&
    has(r0.pts, [160, 650]),
  r0.pts && r0.pts.filter((q, i) => i % 3 === 0),
);
await undo();

/* 16. a marquee picks anchors within it */
await clickAt([120, 625]);
await marquee([60, 670], [100, 580]);
picked = await page.evaluate(() => window.ADDPDF.penEdit.selected());
check("a marquee picks the anchors inside it: the rectangle's left two", picked === 2, picked);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(80);
after = await shapes();
check(
  '…and the arrow keys nudge just those',
  after[0].t === 'pen' &&
    has(after[0].pts, [79, 600]) &&
    has(after[0].pts, [79, 650]) &&
    has(after[0].pts, [160, 600]),
  after[0].t,
);
await undo();

/* 17. a Bézier handle: the anchor's handle pulled, the curve changes, the anchor stays */
const S_CURVE = [
  [330, 500],
  [350, 540],
  [380, 540],
  [400, 500],
  [420, 460],
  [440, 460],
  [460, 500],
];
async function curvePath() {
  await page.evaluate((pts) => {
    const X = window.ADDPDF,
      it = X.S.items[0];
    X.snapshot();
    it.shapes.push({ t: 'pen', open: true, c: '#0a0', w: 2, pts });
    X.drawShapes(it);
  }, S_CURVE);
  return (await shapes()).length - 1;
}
let ci = await curvePath();
await clickAt([365, 530]);
await clickAt([400, 500]);
const hEl = await scr([420, 460]);
await dragScr(hEl, 20, 15);
after = await shapes();
let pp = after[ci].pts;
check(
  'a Bézier handle pulled: it moves, the anchor stays, the opposite handle turns with it (smooth)',
  nearP(pp[3], [400, 500], 0.01) &&
    nearP(pp[4], [420 + D(20), 460 - D(15)]) &&
    !nearP(pp[2], [380, 540], 0.01),
  { a: pp[3], out: pp[4], in: pp[2] },
);
await undo();
after = await shapes();
check(
  'Undo puts the handle back',
  nearP(after[ci].pts[4], [420, 460], 0.001) && nearP(after[ci].pts[2], [380, 540], 0.001),
);
await clickAt([400, 500]);
await dragScr(hEl, 20, 15, ['Alt']);
pp = (await shapes())[ci].pts;
check(
  'Alt on a handle: that one alone, the point becomes a corner',
  nearP(pp[4], [420 + D(20), 460 - D(15)]) && nearP(pp[2], [380, 540], 0.001),
  { out: pp[4], in: pp[2] },
);
await undo();

/* 18. a segment dragged: the curve between two anchors bends; the anchors and the rest stay */
await dragFrom([365, 530], 0, -20);
after = await shapes();
pp = after[ci].pts;
check(
  'a curved segment dragged reshapes it alone: its ends and the next curve stay',
  nearP(pp[0], [330, 500], 0.01) &&
    nearP(pp[3], [400, 500], 0.01) &&
    nearP(pp[6], [460, 500], 0.01) &&
    nearP(pp[4], [420, 460], 0.01) &&
    (pp[1][1] > 541 || pp[2][1] > 541),
  { h1: pp[1], h2: pp[2] },
);
await undo();
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  it.shapes.pop();
  X.S.sel = null;
  X.drawShapes(it);
});
/* a straight segment dragged moves its two ends together */
before = await shapes();
await dragFrom([140, 445], 0, 20);
after = await shapes();
const ln = after[2];
check(
  "a line's segment dragged: both its ends move, as one",
  ln.t === 'pen' &&
    nearP(ln.pts[0], [90, 420 - D(20)]) &&
    nearP(ln.pts[ln.pts.length - 1], [190, 470 - D(20)]),
  { t: ln.t, pts: ln.pts },
);
await undo();

/* 19. an open path's end dropped on its other end closes it */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes.push({
    t: 'poly',
    pts: [
      [540, 500],
      [600, 500],
      [600, 560],
    ],
    c: '#808',
    w: 2,
  });
  X.drawShapes(it);
});
const pi = (await shapes()).length - 1;
const endS = await scr([600, 560]),
  farS = await scr([540, 500]);
await dragScr(endS, farS.x - endS.x + 1, farS.y - endS.y + 1);
after = await shapes();
check(
  "an open end dropped on the path's other end closes it",
  after[pi].t === 'pen' && !after[pi].open && after.length === pi + 1,
  { t: after[pi].t, open: after[pi].open, n: after.length },
);
await undo();
after = await shapes();
check('Undo opens it again, as it was', after[pi].t === 'poly' && after[pi].pts.length === 3);

/* 20. an open end dropped on another path's open end joins them */
const lineEnd = await scr([190, 470]),
  pathEnd = await scr([330, 400]);
await dragScr(lineEnd, pathEnd.x - lineEnd.x, pathEnd.y - lineEnd.y + 1);
after = await shapes();
check(
  'an open end dropped on another open end: joined into one path',
  after.length === pi &&
    after.some(
      (s) =>
        s.t === 'pen' &&
        !nearP(s.pts[0], s.pts[s.pts.length - 1], 0.01) &&
        has(s.pts, [90, 420]) &&
        has(s.pts, [410, 400]),
    ),
  {
    n: after.length,
    t: after.map((x) => x.t),
    pts: after.filter((x) => x.t === 'pen').map((x) => x.pts.filter((q, i) => i % 3 === 0)),
  },
);
await undo();
check('Undo parts them again', (await shapes()).length === pi + 1);

/* 21. an ellipse is edited in place, its curves kept */
await clickAt([360, 590]);
await dragFrom([360, 640], 0, -15);
after = await shapes();
check(
  'an ellipse: its top anchor moved alone, the rest of its curve kept',
  after[1].t === 'pen' &&
    !after[1].open &&
    after[1].pts.length === 13 &&
    has(after[1].pts, [360, 640 + D(15)]) &&
    has(after[1].pts, [360, 590]),
  { t: after[1].t, n: after[1].pts && after[1].pts.length },
);
await undo();

/* 22. a click on nothing picks nothing; back on Select, all is as before */
await clickAt([250, 700]);
picked = await page.evaluate(() => window.ADDPDF.penEdit.selected());
check('a click on empty page lets the anchors go', !picked, picked);
await page.evaluate(() => window.ADDPDF.setTool('select'));
await clickAt([120, 625]);
check(
  'back on Select, a click picks the whole rectangle again',
  (await sel()).join() === '0' && (await shapes())[0].t === 'rect',
);

/* the other tools are still there and still draw */
await page.evaluate(() => window.ADDPDF.setTool('rect'));
count = (await shapes()).length;
const p0 = await scr([250, 720]);
await dragScr(p0, 60, 40);
check(
  'the Rectangle tool still draws',
  (await shapes()).length === count + 1 && (await shapes())[count].t === 'rect',
);

check('no errors on the page', errors.length === 0, errors);
await browser.close();
if (server.close) server.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
