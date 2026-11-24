/* The Dimension tools end to end in Chromium, driven by the mouse and keys
   as a person would: every kind made (linear horizontal and vertical,
   aligned, angular from two lines and from a vertex, radius, diameter, arc
   length, continuous, baseline, ordinate X and Y), each measured; then
   association (geometry moved and resized), the grips (a defining point,
   the line, the text on its own), the properties and the Style dialog,
   retyping, duplicate, delete, undo and redo, group and ungroup, layers,
   zoom, and the SVG and PDF they export to.

   npm run build, then: node apps/web/bench/dimension.mjs [screenshot.png]
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
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
  acceptDownloads: true,
});
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
await page.waitForTimeout(500);

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};

/* the geometry to measure, in PDF points: a filled box, a line, two lines
   meeting at 45°, a circle and a half-circle arc */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  it.shapes.push(
    { t: 'rect', a: [100, 500], b: [250, 600], c: '#1F5FBF', w: 1, fill: '#DDE8FF' },
    { t: 'line', a: [320, 500], b: [400, 560], c: '#000000', w: 1 },
    { t: 'line', a: [100, 300], b: [250, 300], c: '#000000', w: 1 },
    { t: 'line', a: [100, 300], b: [200, 400], c: '#000000', w: 1 },
    { t: 'ellipse', a: [450, 150], b: [550, 250], c: '#000000', w: 1 },
    { t: 'arc', a: [100, 100], b: [200, 100], c: '#000000', w: 1, bulge: 0.5 },
  );
  X.drawShapes(it);
});
const N0 = await page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
/* scroll the part of the page in use into view and keep the zoom */
await page.evaluate(() => {
  const X = window.ADDPDF;
  X.zoomTo(1);
});
await page.waitForTimeout(600);

const at = (p) =>
  page.evaluate((p) => {
    const it = window.ADDPDF.S.items[0],
      r = it.anno.getBoundingClientRect(),
      v = it.vp.convertToViewportPoint(p[0], p[1]);
    return { x: r.left + v[0], y: r.top + v[1] };
  }, p);
async function onScreen(p) {
  let c = await at(p);
  if (c.y < 120 || c.y > 860) {
    await page.evaluate((dy) => {
      document.getElementById('stage').scrollTop += dy;
    }, c.y - 480);
    await page.waitForTimeout(250);
    c = await at(p);
  }
  return c;
}
async function click(p) {
  const c = await onScreen(p);
  await page.mouse.move(c.x, c.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
}
async function hover(p) {
  const c = await onScreen(p);
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await page.waitForTimeout(40);
}
const tool = (t) => page.evaluate((t) => window.ADDPDF.setTool(t), t);
const shapes = () => page.evaluate(() => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes)));
const last = async () => (await shapes()).slice(-1)[0];
const txt = (s) => page.evaluate((s) => window.ADDPDF.dimText(s), s);
const pt = (s) => page.evaluate((s) => window.ADDPDFEngine.dimMeasure(s).v, s);
const near = (a, b, d = 0.05) => Math.abs(a - b) <= d;
const DEG = 180 / Math.PI;

/* ---- linear, horizontal and vertical ---- */
await tool('dim');
check(
  'the Linear tool shows the dimension bar with its Style…',
  await page.evaluate(
    () => !document.getElementById('dimCtl').hidden && !!document.getElementById('dimStyleBtn'),
  ),
);
await click([100, 600]);
await click([250, 600]);
await hover([175, 640]);
check(
  'a live preview follows the pointer before the click',
  await page.evaluate(() => !!window.ADDPDF.S.items[0].anno.querySelector('.dimx-art')),
);
await click([175, 640]);
let d = await last();
check(
  'Linear: two points and the line above them make a horizontal dimension',
  d.t === 'dimx' && d.k === 'lin' && near(Math.abs(d.dir[0]), 1, 1e-6) && near(await pt(d), 150),
  { k: d.k, dir: d.dir, v: await pt(d) },
);
check('…reading in the drawing units', (await txt(d)) === '53 mm', await txt(d));
check(
  '…its points held to the box they were snapped to',
  !!(d.ref && d.ref[0] && d.ref[1]) && d.ref[0].g === d.ref[1].g,
  d.ref,
);
const H = (await shapes()).length - 1;
await click([250, 600]);
await click([250, 500]);
await click([300, 550]);
d = await last();
check(
  'Linear: placed to the side it measures vertically',
  d.k === 'lin' && near(Math.abs(d.dir[1]), 1, 1e-6) && near(await pt(d), 100),
  { dir: d.dir, v: await pt(d) },
);
const V = (await shapes()).length - 1;
/* forced with a key: H over a sideways placement */
await click([100, 500]);
await click([250, 600]);
await hover([320, 560]);
await page.keyboard.press('h');
await click([320, 560]);
d = await last();
check(
  'H fixes it horizontal wherever the line goes',
  near(Math.abs(d.dir[0]), 1, 1e-6) && near(await pt(d), 150),
  d.dir,
);
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes.pop();
  X.drawShapes(it);
});
/* Esc in the middle */
let n = (await shapes()).length;
await click([400, 700]);
await page.keyboard.press('Escape');
await click([450, 700]);
await page.keyboard.press('Escape');
check(
  'Esc throws a half-made dimension away and keeps the tool',
  (await shapes()).length === n && (await page.evaluate(() => window.ADDPDF.S.tool)) === 'dim',
);

/* ---- aligned ---- */
await tool('dimal');
await click([320, 500]);
await click([400, 560]);
await click([340, 560]);
d = await last();
check(
  'Aligned: the true distance, the line parallel to it',
  d.k === 'ali' && near(await pt(d), 100),
  await pt(d),
);

/* ---- angular ---- */
await tool('dima');
await click([175, 300]);
await click([150, 350]);
await click([200, 330]);
d = await last();
check(
  'Angular from two lines: 45°',
  d.k === 'ang' && d.am === 'll' && near((await pt(d)) * DEG, 45),
  (await pt(d)) * DEG,
);
check('…reads 45°', (await txt(d)) === '45°', await txt(d));
await click([175, 300]);
await click([150, 350]);
await click([60, 330]);
d = await last();
check('…the other side of a line: its supplement, 135°', near((await pt(d)) * DEG, 135), (await pt(d)) * DEG);
await click([450, 420]);
await click([530, 420]);
await click([450, 500]);
await click([490, 460]);
d = await last();
check(
  'Angular from a vertex and a point on each arm: 90°',
  d.k === 'ang' && !d.am && near((await pt(d)) * DEG, 90),
  (await pt(d)) * DEG,
);

/* ---- radius and diameter ---- */
await tool('dimr');
await click([550, 200]);
await click([520, 215]);
d = await last();
check(
  'Radius of a circle you drew: R50 pt (18 mm), held to the circle',
  d.k === 'rad' && near(await pt(d), 50) && (await txt(d)) === 'R18 mm' && !!(d.ref && d.ref[0] && d.ref[1]),
  { v: await pt(d), t: await txt(d) },
);
const RAD = (await shapes()).length - 1;
await tool('dimd');
await click([450, 200]);
await click([400, 270]);
d = await last();
check(
  'Diameter placed outside, on a landing: Ø100 pt',
  d.k === 'dia' && near(await pt(d), 100) && (await txt(d)) === 'Ø35 mm',
  { v: await pt(d), t: await txt(d) },
);
/* three points on an edge in the drawing (no object there) */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  it.shapes.push({ t: 'ellipse', a: [470, 320], b: [550, 400], c: '#888888', w: 1, hide: true });
  X.drawShapes(it);
});
await click([550, 360]);
await click([510, 400]);
await click([470, 360]);
await click([440, 380]);
d = await last();
check(
  'Diameter from three points on an edge: Ø80 pt',
  d.k === 'dia' && near(await pt(d), 80, 0.2),
  await pt(d),
);

/* ---- arc length ---- */
await tool('dimarc');
await click([150, 150]);
await click([150, 175]);
d = await last();
check(
  'Arc length of an Arc you drew: π·50 pt',
  d.k === 'arc' && near(await pt(d), Math.PI * 50, 0.05),
  await pt(d),
);

/* ---- continuous and baseline, from the horizontal one ---- */
const base = (await shapes())[H];
await tool('dimc');
await click([175, 640 + 3.5]);
await click([320, 500]);
await click([400, 560]);
await page.keyboard.press('Enter');
const all = await shapes();
const c1 = all[all.length - 2],
  c2 = all[all.length - 1];
const nn = [-base.dir[1], base.dir[0]];
const offOf = (s) => s.pts[2][0] * nn[0] + s.pts[2][1] * nn[1];
check(
  'Continuous: each from the last point, on the same line',
  near(await pt(c1), 70) &&
    near(await pt(c2), 80) &&
    near(c1.pts[0][0], 250, 1e-6) &&
    near(c2.pts[0][0], 320, 1e-6) &&
    near(offOf(c1), offOf(base), 1e-6) &&
    near(offOf(c2), offOf(base), 1e-6),
  { a: await pt(c1), b: await pt(c2) },
);
await tool('dimb');
await click([175, 640 + 3.5]);
await click([320, 500]);
await click([400, 560]);
await page.keyboard.press('Escape');
const all2 = await shapes();
const b1 = all2[all2.length - 2],
  b2 = all2[all2.length - 1];
check(
  'Baseline: each from the first point, stacked further out',
  near(await pt(b1), 220) &&
    near(await pt(b2), 300) &&
    near(b1.pts[0][0], 100, 1e-6) &&
    offOf(b2) > offOf(b1) &&
    offOf(b1) > offOf(base),
  { a: await pt(b1), b: await pt(b2) },
);

/* ---- ordinate ---- */
await tool('dimo');
await page.keyboard.press('o');
await click([100, 500]);
await click([250, 600]);
await click([250, 660]);
d = await last();
check(
  'Ordinate X: from the datum along x, the leader up',
  d.k === 'ord' && d.ax === 'x' && near(await pt(d), 150),
  { ax: d.ax, v: await pt(d) },
);
await click([250, 600]);
await click([330, 600]);
d = await last();
check('Ordinate Y: the leader sideways', d.k === 'ord' && d.ax === 'y' && near(await pt(d), 100), {
  ax: d.ax,
  v: await pt(d),
});

/* ---- association: the box moved, then resized ---- */
await tool('select');
const before = (await shapes())[H];
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.S.sel = null;
  X.drawShapes(it);
});
/* drag the filled box 40 pt right with the mouse */
const from = await onScreen([175, 550]);
const k = await page.evaluate(() => window.ADDPDF.S.scale);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(from.x + 20 * k, from.y, { steps: 4 });
await page.mouse.move(from.x + 40 * k, from.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(100);
let after = (await shapes())[H];
const boxNow = (await shapes()).find((s) => s.t === 'rect');
const boxMoved = [boxNow.a[0] - 100, boxNow.a[1] - 500];
check(
  'the box dragged: its dimension follows, line and text too, still 150',
  boxMoved[0] > 20 &&
    near(after.pts[0][0] - before.pts[0][0], boxMoved[0], 1e-6) &&
    near(after.pts[2][0] - before.pts[2][0], boxMoved[0], 1e-6) &&
    near(after.pts[2][1] - before.pts[2][1], boxMoved[1], 1e-6) &&
    near(await pt(after), 150, 1e-6),
  { boxMoved, dim: after.pts[0][0] - before.pts[0][0] },
);
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0],
    r = it.shapes.find((s) => s.t === 'rect');
  X.snapshot();
  r.b = [r.b[0] + 60, r.b[1]];
  X.drawShapes(it);
});
after = (await shapes())[H];
check(
  'the box resized: the dimension reads the new width, its line kept',
  near(await pt(after), 210, 1e-6) && (await txt(after)) === '74 mm',
  await txt(after),
);
check(
  '…the vertical one is still 100 at the new edge',
  near(await pt((await shapes())[V]), 100, 1e-6) &&
    near((await shapes())[V].pts[0][0], 310 + boxMoved[0], 1e-6),
  (await shapes())[V].pts[0],
);
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0],
    c = it.shapes.find((s) => s.t === 'ellipse');
  X.snapshot();
  c.b = [c.b[0] + 50, c.b[1] + 50];
  X.drawShapes(it);
});
check(
  'the circle enlarged: its radius dimension reads R75 pt',
  near(await pt((await shapes())[RAD]), 75, 1e-6),
  await pt((await shapes())[RAD]),
);
await page.evaluate(() => window.ADDPDF.undo(true));
await page.waitForTimeout(150);
check(
  'undo puts the circle and its dimension back together',
  near(await pt((await shapes())[RAD]), 50, 1e-6),
);

/* ---- the grips, the properties, the text ---- */
const sel = (i) =>
  page.evaluate((i) => {
    const X = window.ADDPDF,
      it = X.S.items[0];
    X.setTool('select');
    X.S.sel = { it, i };
    X.S.multi = null;
    X.drawShapes(it);
    X.syncMarkPop();
  }, i);
await sel(H);
const grips = await page.evaluate(() =>
  [...window.ADDPDF.S.items[0].anno.querySelectorAll('.dxg')].map(
    (g) => g.dataset.grip + (g.classList.contains('assoc') ? '*' : ''),
  ),
);
check(
  'grips: two defining points (held), the line and the text',
  JSON.stringify(grips) === JSON.stringify(['def0*', 'def1*', 'line', 'text']),
  grips,
);
const gripAt = (name) =>
  page.evaluate((n) => {
    const g = window.ADDPDF.S.items[0].anno.querySelector('[data-grip="' + n + '"]').getBoundingClientRect();
    return { x: g.left + g.width / 2, y: g.top + g.height / 2 };
  }, name);
async function dragGrip(name, dxp, dyp) {
  const g = await gripAt(name);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x + dxp / 2, g.y + dyp / 2, { steps: 3 });
  await page.mouse.move(g.x + dxp, g.y + dyp, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
let s0 = (await shapes())[H];
await dragGrip('line', 0, -30);
let s1 = (await shapes())[H];
check(
  'the line grip moves the dimension line alone',
  near(s1.pts[2][1] - s0.pts[2][1], 30 / k, 0.6) && near(s1.pts[0][1], s0.pts[0][1], 1e-6) && !s1.tm,
  { dy: s1.pts[2][1] - s0.pts[2][1] },
);
await dragGrip('text', 60, -20);
s1 = (await shapes())[H];
check(
  'the text grip moves the text on its own',
  s1.tm === true && s1.pts.length === 4 && near(s1.pts[2][1], (await shapes())[H].pts[2][1], 1e-6),
);
const leader = await page.evaluate(
  (i) => window.ADDPDF.dimLayout(window.ADDPDF.S.items[0].shapes[i]).lines.length,
  H,
);
check('…with a leader back to the line when it is well clear', leader >= 2, leader);
await sel(H);
await page.evaluate(() => document.getElementById('dxPHome').click());
s1 = (await shapes())[H];
check('Reset text puts it back', !s1.tm && s1.pts.length === 3);
/* a defining point dragged off the box onto empty paper: it lets go */
await sel(H);
await dragGrip('def1', 40, 25);
s1 = (await shapes())[H];
check('a defining point dragged clear lets go of the box', !!s1.ref && !!s1.ref[0] && !s1.ref[1], s1.ref);
await page.evaluate(() => window.ADDPDF.undo(true));
await page.waitForTimeout(120);

await sel(H);
const setVal = (id, v) =>
  page.evaluate(
    ([id, v]) => {
      const el = document.getElementById(id);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [id, v],
  );
await setVal('dxPTh', '10');
await setVal('dxPAh', 'oblique');
await setVal('dxPU', 'in');
await setVal('dxPDp', '3');
await setVal('dxPPre', '2× ');
await setVal('dxPSuf', ' TYP');
await setVal('dxPBg', true);
s1 = (await shapes())[H];
check(
  'properties: height, arrowheads, unit, precision, prefix, suffix, background',
  s1.sty.th === 10 &&
    s1.sty.ah === 'oblique' &&
    s1.sty.u === 'in' &&
    s1.sty.dp === 3 &&
    (await txt(s1)) === '2× 2.917 in TYP' &&
    s1.sty.bg === true,
  { sty: s1.sty, t: await txt(s1) },
);
await setVal('dxText', 'MAX <>');
s1 = (await shapes())[H];
check('the text overridden, <> the measured value', (await txt(s1)) === '2× MAX 2.917 in TYP', await txt(s1));
const shown = await page.evaluate(
  (i) => window.ADDPDF.S.items[0].anno.children[i].querySelector('text').textContent,
  H,
);
check('…and shown so on the page', shown === '2× MAX 2.917 in TYP', shown);
/* the Style dialog */
await page.evaluate(() => document.getElementById('dxPStyle').click());
await page.waitForSelector('#dxExo');
await page.fill('#dxExo', '4');
await page.fill('#dxExe', '5');
await page.fill('#dxSc', '150');
await page.selectOption('#dxTp', 'center');
await page.selectOption('#dxTa', 'horizontal');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
s1 = (await shapes())[H];
check(
  'the Style dialog: extension offset and overshoot, scale, text centred and level',
  s1.sty.exo === 4 &&
    s1.sty.exe === 5 &&
    s1.sty.sc === 1.5 &&
    s1.sty.tp === 'center' &&
    s1.sty.ta === 'horizontal',
  s1.sty,
);
await page.evaluate(() => document.getElementById('dxPCur').click());
await tool('dim');
await click([100, 400 + 200 + 0]);
await click([250 + 60 + 40, 600]);
await click([200, 700]);
d = await last();
check(
  'Make current: the next dimension takes that look',
  d.sty && d.sty.exo === 4 && d.sty.sc === 1.5 && d.sty.ah === 'oblique',
  d.sty,
);
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes.pop();
  X.drawShapes(it);
});

/* double-click to retype */
await tool('select');
await sel(V);
const vt = await page.evaluate((i) => {
  const t = window.ADDPDF.S.items[0].anno.children[i].querySelector('text').getBoundingClientRect();
  return { x: t.left + t.width / 2, y: t.top + t.height / 2 };
}, V);
await page.mouse.dblclick(vt.x, vt.y);
const askField = page.locator('input.wdin:visible');
const opened = await askField.waitFor({ timeout: 3000 }).then(
  () => true,
  () => false,
);
if (opened) {
  await askField.fill('<> CLEAR');
  await page.keyboard.press('Enter');
} else console.log('no text dialog opened');
await page.waitForTimeout(150);
check(
  'double-click a dimension to retype it',
  (await txt((await shapes())[V])) === '35 mm CLEAR',
  await txt((await shapes())[V]),
);

/* ---- duplicate, group, layers, delete, undo, redo ---- */
const ids = await page.evaluate(() => {
  const it = window.ADDPDF.S.items[0];
  return [it.shapes.findIndex((s) => s.t === 'rect')];
});
await page.evaluate(
  ([r, h, v]) => {
    const X = window.ADDPDF,
      it = X.S.items[0];
    X.setTool('select');
    X.S.sel = { it, i: r };
    X.setGroup(it, [r, h, v]);
    X.groupSelected();
    X.drawShapes(it);
  },
  [ids[0], H, V],
);
const grouped = await shapes();
check(
  'grouped with the box they measure',
  grouped[H].grp != null && grouped[H].grp === grouped[ids[0]].grp && grouped[V].grp === grouped[H].grp,
);
const count0 = grouped.length;
await page.evaluate(() => window.ADDPDF.duplicateSelected());
let dup = await shapes();
const copies = dup.slice(count0);
const rc = copies.find((s) => s.t === 'rect'),
  dc = copies.filter((s) => s.t === 'dimx');
check(
  'duplicated with the box: the copies measure the copy',
  dup.length === count0 + 3 &&
    !!rc &&
    rc.gid &&
    rc.gid !== grouped[ids[0]].gid &&
    dc.every((m) => m.ref && m.ref.every((r) => !r || r.g === rc.gid)),
  { n: dup.length - count0 },
);
await page.evaluate((gid) => {
  const X = window.ADDPDF,
    it = X.S.items[0],
    r = it.shapes.find((s) => s.gid === gid);
  X.snapshot();
  r.b = [r.b[0] + 30, r.b[1]];
  X.drawShapes(it);
}, rc.gid);
dup = await shapes();
check(
  '…resizing the copy changes the copy’s dimension, not the first one',
  near(await pt(dup[count0 + 1]), 240, 1e-6) && near(await pt(dup[H]), 210, 1e-6),
  [await pt(dup[count0 + 1]), await pt(dup[H])],
);
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.ungroupSelected();
});
check(
  'ungrouped',
  (await shapes()).slice(count0).every((s) => s.grp == null),
);
const layered = (await shapes())[H];
check(
  'on a layer, like any mark',
  layered.layer != null || (await page.evaluate(() => !window.ADDPDF.S.layers)),
  layered.layer,
);
n = (await shapes()).length;
await page.evaluate((i) => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.S.sel = { it, i };
  X.S.multi = null;
  X.deleteSelected();
}, n - 1);
const afterDel = (await shapes()).length;
await page.evaluate(() => window.ADDPDF.undo(true));
await page.waitForTimeout(120);
const afterUndo = (await shapes()).length;
await page.evaluate(() => window.ADDPDF.redo());
await page.waitForTimeout(120);
check('delete, undo, redo', afterDel === n - 1 && afterUndo === n && (await shapes()).length === n - 1, {
  n,
  afterDel,
  afterUndo,
});
await page.evaluate(() => window.ADDPDF.undo(true));
await page.waitForTimeout(120);

/* ---- zoom: the same measurement, the same size on paper ---- */
const sizeAt = async (z) => {
  await page.evaluate((z) => window.ADDPDF.zoomTo(z), z);
  await page.waitForTimeout(700);
  return page.evaluate((i) => {
    const it = window.ADDPDF.S.items[0],
      t = it.anno.children[i].querySelector('text').getBoundingClientRect(),
      p = it.anno.getBoundingClientRect();
    return { w: t.width / p.width, text: it.anno.children[i].querySelector('text').textContent };
  }, RAD);
};
const z1 = await sizeAt(1),
  z3 = await sizeAt(3);
check(
  'zoomed 1× and 3×: the same reading, the same size on the page',
  z1.text === z3.text && Math.abs(z1.w - z3.w) / z1.w < 0.03,
  { z1, z3 },
);
await page.evaluate(() => window.ADDPDF.zoomTo(1));
await page.waitForTimeout(500);

/* ---- SVG and PDF ---- */
const svg = await page.evaluate(() => window.ADDPDF.exportPageSvg(window.ADDPDF.S.items[0]));
const svgOk = await page.evaluate((x) => {
  const doc = new DOMParser().parseFromString(x, 'image/svg+xml');
  return {
    err: !!doc.querySelector('parsererror'),
    dims: doc.querySelectorAll('.dimx-art').length,
    texts: [...doc.querySelectorAll('.dimx-art text')].map((t) => t.textContent),
  };
}, svg);
const nDims = (await shapes()).filter((s) => s.t === 'dimx').length;
check(
  'SVG export: well-formed, every dimension in it with its text',
  !svgOk.err && svgOk.dims === nDims && svgOk.texts.includes('R18 mm') && !/dxhit|dxg/.test(svg),
  { dims: svgOk.dims, nDims },
);
const pdfTexts = await page.evaluate(async () => {
  const X = window.ADDPDF;
  const bytes = await X.buildPdf(X.S.items.slice(0, 1), new Map(), {});
  const doc = await X.pdfjsLib.getDocument({ data: bytes }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  /* pdf.js may split one string into pieces: read the page as one run */
  return tc.items.map((i) => i.str).join('');
});
const want = await page.evaluate(() =>
  window.ADDPDF.S.items[0].shapes
    .filter((s) => s.t === 'dimx' && !s.hide)
    .map((s) => window.ADDPDF.dimText(s)),
);
const missing = want.filter((w) => !pdfTexts.includes(w));

check('PDF export: every dimension’s text is in the saved page', missing.length === 0, { missing });

await page.evaluate(() => {
  const X = window.ADDPDF;
  X.setTool('select');
  X.S.sel = null;
  X.drawShapes(X.S.items[0]);
});
await onScreen([300, 450]);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
check('no errors on the page', errors.length === 0, errors);
await browser.close();
if (server.close) server.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
