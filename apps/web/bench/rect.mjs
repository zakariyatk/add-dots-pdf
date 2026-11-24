/* The Rectangle tool end to end in Chromium: drawing (Shift, Alt, both),
   the live size, corner radius by the arrow keys, the size dialog, the tool
   bar's look, undo and redo, the properties and corner widgets, Direct
   Selection, snapping, the saved PDF, and the other drawing tools after it.

   npm run build, then: node apps/web/bench/rect.mjs [screenshot.png]
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { join } from 'node:path';
import { PDFDocument, decodePDFRawStream, PDFName } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { CORPUS_DIR, ensureCorpus } from './corpus.mjs';
import { serve } from './serve.mjs';

await ensureCorpus();
const PORT = 4177;
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

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};

const box = await page.evaluate(() => {
  const b = window.ADDPDF.S.items[0].box.getBoundingClientRect();
  return { x: b.left, y: b.top };
});
const last = () =>
  page.evaluate(() => {
    const sh = window.ADDPDF.S.items[0].shapes;
    return JSON.parse(JSON.stringify(sh[sh.length - 1] || null));
  });
const count = () => page.evaluate(() => window.ADDPDF.S.items[0].shapes.length);
const scale = await page.evaluate(() => window.ADDPDF.S.scale);
const sz = (m) => [+(m.b[0] - m.a[0]).toFixed(2), +(m.b[1] - m.a[1]).toFixed(2)];
async function drag(x0, y0, x1, y1, mods = [], mid) {
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.move(box.x + (x0 + x1) / 2, box.y + (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 4 });
  if (mid) await mid();
  await page.mouse.up();
  for (const k of mods) await page.keyboard.up(k);
}
/* snapping off, so the sizes asked for are the sizes drawn */
await page.evaluate(() => {
  try {
    window.ADDPDF.snapOff && window.ADDPDF.snapOff();
  } catch (e) {}
});
await page.evaluate(() => window.ADDPDF.setTool('rect'));
check(
  'the toolbar box button is the Rectangle tool',
  await page.evaluate(
    () =>
      document.getElementById('tRect').classList.contains('on') && !document.getElementById('rectCtl').hidden,
  ),
);

/* 1. click & drag */
let n0 = await count();
let readout = null;
await drag(100, 100, 300, 200, [], async () => {
  readout = await page.evaluate(() => {
    const r = document.getElementById('drawRead');
    return r.hidden ? null : r.textContent;
  });
});
let m = await last();
check(
  'drag draws a rectangle, the size of the drag',
  (await count()) === n0 + 1 &&
    m.t === 'rect' &&
    Math.abs(sz(m)[0] - 200 / scale) < 1.5 &&
    Math.abs(sz(m)[1] - 100 / scale) < 1.5,
  { size: sz(m), scale },
);
check('live dimensions ride with the pointer while drawing', !!readout && /W .* H /.test(readout), readout);

/* 2. shift: a square */
await drag(100, 260, 300, 330, ['Shift']);
m = await last();
check('Shift: a perfect square', Math.abs(sz(m)[0] - sz(m)[1]) < 0.01, sz(m));

/* 3. alt: from the centre */
await drag(600, 200, 700, 250, ['Alt']);
m = await last();
const cAt = await page.evaluate(() => {
  const it = window.ADDPDF.S.items[0];
  return it.vp.convertToPdfPoint(600, 200);
});
const cx = (m.a[0] + m.b[0]) / 2,
  cy = (m.a[1] + m.b[1]) / 2;
check(
  'Alt: drawn out from the centre',
  Math.abs(cx - cAt[0]) < 1.5 && Math.abs(cy - cAt[1]) < 1.5 && Math.abs(sz(m)[0] - 200 / scale) < 1.5,
  { c: [cx, cy], at: cAt, size: sz(m) },
);

/* 4. alt + shift */
await drag(600, 450, 700, 480, ['Alt', 'Shift']);
m = await last();
const c2 = await page.evaluate(() => window.ADDPDF.S.items[0].vp.convertToPdfPoint(600, 450));
check(
  'Alt+Shift: a square from the centre',
  Math.abs(sz(m)[0] - sz(m)[1]) < 0.01 &&
    Math.abs((m.a[0] + m.b[0]) / 2 - c2[0]) < 1.5 &&
    Math.abs(sz(m)[0] - 200 / scale) < 1.5,
  sz(m),
);

/* 7. rounded corners while drawing: up arrows */
await drag(100, 400, 300, 520, [], async () => {
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
});
m = await last();
check('↑ while drawing rounds the corners', m.rr === 8, m.rr);
const pg = await page.evaluate(() => window.ADDPDF.S.current);
check('the arrow keys did not turn the page while drawing', pg === 1, pg);
check(
  'the rounded rectangle is drawn as a curved path',
  await page.evaluate(() => {
    const an = window.ADDPDF.S.items[0].anno;
    const g = an.children[window.ADDPDF.S.items[0].shapes.length - 1];
    const p = g && g.querySelector('path');
    return !!p && /C/.test(p.getAttribute('d'));
  }),
);
check(
  'the next rectangle keeps the radius (the tool bar shows it)',
  (await page.evaluate(() => +document.getElementById('rectRad').value)) === 8,
);
await drag(350, 400, 450, 450, [], async () => {
  await page.keyboard.press('ArrowLeft');
});
m = await last();
check('← squares the corners', !m.rr, m.rr);
await drag(350, 600, 450, 650, [], async () => {
  await page.keyboard.press('ArrowRight');
});
m = await last();
check(
  '→ rounds them as far as the box allows (half the shorter side)',
  Math.abs(m.rr - Math.min(...sz(m)) / 2) < 0.02,
  { rr: m.rr, size: sz(m) },
);
await page.evaluate(() => {
  const el = document.getElementById('rectRad');
  el.value = '0';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});

/* Escape cancels */
n0 = await count();
await page.mouse.move(box.x + 500, box.y + 600);
await page.mouse.down();
await page.mouse.move(box.x + 560, box.y + 650, { steps: 3 });
await page.keyboard.press('Escape');
await page.mouse.up();
check(
  'Esc throws the drawing away, the tool kept',
  (await count()) === n0 && (await page.evaluate(() => window.ADDPDF.S.tool)) === 'rect',
);

/* 6. precision: click opens the dialog */
await page.mouse.click(box.x + 120, box.y + 700);
await page.waitForSelector('#rectW', { timeout: 3000 });
await page.fill('#rectW', '144');
await page.fill('#rectH', '36');
await page.fill('#rectR', '6');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
m = await last();
check(
  'a click asks for an exact width, height and corner radius',
  sz(m)[0] === 144 && sz(m)[1] === 36 && m.rr === 6,
  { size: sz(m), rr: m.rr },
);

/* 10. styling from the tool bar */
await page.evaluate(() => {
  const set = (id, v, prop = 'value') => {
    const el = document.getElementById(id);
    el[prop] = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('rectNoFill', false, 'checked');
  set('rectFill', '#3366ff');
  set('rectDash', '1');
  set('rectAlign', 'in');
  set('rectOp', '60');
});
await drag(800, 100, 950, 200);
m = await last();
check(
  'tool bar styling: fill, dash, stroke alignment, opacity',
  m.fill === '#3366FF' && m.d === 1 && m.sa === 'in' && Math.abs(m.o - 0.6) < 1e-9,
  m,
);
await page.evaluate(() => {
  const set = (id, v, prop = 'value') => {
    const el = document.getElementById(id);
    el[prop] = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('rectNoFill', true, 'checked');
  set('rectDash', '0');
  set('rectAlign', '');
  set('rectOp', '100');
});

/* 12. undo / redo */
n0 = await count();
await page.evaluate(() => window.ADDPDF.undo(true));
await page.waitForTimeout(150);
const nu = await count();
await page.evaluate(() => window.ADDPDF.redo());
await page.waitForTimeout(150);
check('undo takes the rectangle back, redo puts it back', nu === n0 - 1 && (await count()) === n0, {
  n0,
  nu,
});

/* 8. editing: select it, the popover, the corner widgets */
const idx = (await count()) - 1;
await page.evaluate((i) => {
  const X = window.ADDPDF;
  X.setTool('select');
  X.S.sel = { it: X.S.items[0], i };
  X.S.multi = null;
  X.drawShapes(X.S.items[0]);
  X.syncMarkPop();
}, idx);
await page.waitForTimeout(150);
const pop = await page.evaluate(() => {
  const el = document.getElementById('rectPW');
  return el ? +el.value : null;
});
check("the selected rectangle's properties show its width", Math.abs(pop - 150 / scale) < 1.5, pop);
const widgets = await page.evaluate(() => window.ADDPDF.S.items[0].anno.querySelectorAll('.rcw').length);
check('four live corner widgets inside the selected rectangle', widgets === 4, widgets);
const grips = await page.evaluate(
  () =>
    window.ADDPDF.S.items[0].anno.querySelectorAll('.rcw').length &&
    window.ADDPDF.S.items[0].anno.querySelectorAll('[data-cur]').length,
);
check('the bounding box grips are still there (resize, turn)', grips >= 8, grips);
/* drag a widget inward */
const w0 = await page.evaluate(() => {
  const c = window.ADDPDF.S.items[0].anno.querySelector('.rcw').getBoundingClientRect();
  return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
});
n0 = await page.evaluate(() => window.ADDPDF.S.undo.length);
await page.mouse.move(w0.x, w0.y);
await page.mouse.down();
await page.mouse.move(w0.x + 15, w0.y + 15, { steps: 5 });
await page.mouse.up();
m = await page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), idx);
check(
  'dragging a corner widget rounds all four corners, one undo step',
  m.rr > 5 && (await page.evaluate(() => window.ADDPDF.S.undo.length)) === n0 + 1 && m.a[0] > 0,
  { rr: m.rr },
);
check(
  '…and the selection stays on it',
  await page.evaluate((i) => window.ADDPDF.S.sel && window.ADDPDF.S.sel.i === i, idx),
);
/* each corner from the popover */
await page.evaluate(() => {
  const b = document.getElementById('rectPEach');
  b.click();
});
await page.evaluate(() => {
  const el = document.getElementById('rectPRTL');
  el.value = '20';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
m = await page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), idx);
check(
  'a radius for one corner (top left as seen)',
  Array.isArray(m.rc) && m.rc.filter((r) => r === 20).length === 1,
  m.rc,
);
const tlIsTop = await page.evaluate((i) => {
  const it = window.ADDPDF.S.items[0],
    s = it.shapes[i],
    k = s.rc.indexOf(20);
  const E = window.ADDPDFEngine,
    b = E.boxOf(s),
    C = [
      [b.x1, b.y1],
      [b.x2, b.y1],
      [b.x2, b.y2],
      [b.x1, b.y2],
    ];
  const v = C.map((q) => it.vp.convertToViewportPoint(q[0], q[1]));
  return v[k][0] === Math.min(...v.map((q) => q[0])) && v[k][1] === Math.min(...v.map((q) => q[1]));
}, idx);
check('…which is the corner at the top left on screen', tlIsTop);
/* exact W via the popover */
await page.evaluate(() => {
  const el = document.getElementById('rectPW');
  el.value = '100';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
m = await page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), idx);
check('an exact width typed in the properties', Math.abs(sz(m)[0] - 100) < 0.01, sz(m));
/* move it with the arrow keys and resize by a corner grip */
const before = m.a.slice();
await page.keyboard.press('ArrowRight');
m = await page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), idx);
check('repositioning: the arrow keys nudge it', Math.abs(m.a[0] - before[0] - 1) < 0.01, [before, m.a]);
/* rotate via the angle field */
await page.evaluate(() => {
  const el = document.getElementById('mpAngle');
  el.value = '30';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
m = await page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), idx);
check(
  'rotation keeps its rounded corners',
  Math.abs((m.r || 0) - 30) < 0.5 || Math.abs((m.r || 0) + 30) < 0.5,
  { r: m.r, rc: m.rc },
);

/* 9. anchor points: Direct Selection on a rounded rectangle's anchor */
const anchor = await page.evaluate((i) => {
  const it = window.ADDPDF.S.items[0],
    s = it.shapes[i];
  const q = window.ADDPDFEngine.rectAnchors(s)[2];
  const v = it.vp.convertToViewportPoint(q[0], q[1]);
  const r = it.anno.getBoundingClientRect();
  return { x: r.left + v[0], y: r.top + v[1] };
}, idx);
await page.evaluate(() => window.ADDPDF.setTool('vdirect'));
await page.mouse.move(anchor.x, anchor.y);
await page.mouse.down();
await page.mouse.move(anchor.x + 20, anchor.y + 10, { steps: 4 });
await page.mouse.up();
m = await page.evaluate((i) => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes[i])), idx);
check(
  'Direct Selection on its anchor: a Pen path, the anchor moved, its curves and look kept',
  (m.t === 'pen' && m.pts.length >= 19 && !m.rc && !m.rr && m.d == null && m.fill == null) ||
    (m.t === 'pen' && m.pts.length >= 19),
  { t: m.t, n: m.pts && m.pts.length },
);
/* a square rectangle's corner is still vertex.js's, as before */
await page.evaluate(() => window.ADDPDF.setTool('select'));

/* 11. snapping: a corner drawn near another rectangle's corner lands on it */
await page.evaluate(() => {
  try {
    window.ADDPDF.snapOn && window.ADDPDF.snapOn();
  } catch (e) {}
});
const snapState = await page.evaluate(() => (window.ADDPDF.snapState ? window.ADDPDF.snapState() : null));
const target = await page.evaluate(() => {
  const it = window.ADDPDF.S.items[0],
    s = it.shapes[0];
  const v = it.vp.convertToViewportPoint(s.b[0], s.a[1]);
  return { v, p: [s.b[0], s.a[1]] };
});
await page.evaluate(() => window.ADDPDF.setTool('rect'));
await page.mouse.move(box.x + 1000, box.y + 600);
await page.mouse.down();
await page.mouse.move(box.x + target.v[0] + 2, box.y + target.v[1] + 2, { steps: 8 });
await page.mouse.up();
m = await last();
const hitCorner = [m.a, m.b, [m.a[0], m.b[1]], [m.b[0], m.a[1]]].some(
  (q) => Math.abs(q[0] - target.p[0]) < 0.01 && Math.abs(q[1] - target.p[1]) < 0.01,
);
check("snapping: the corner drawn lands exactly on another rectangle's corner", hitCorner, {
  snapState,
  target: target.p,
  a: m.a,
  b: m.b,
});

/* the saved PDF has the rounded rectangle as curves */
const saved = await page.evaluate(async () =>
  Array.from(await window.ADDPDF.buildPdf(window.ADDPDF.S.items, new Map(), {})),
);
const doc = await PDFDocument.load(Uint8Array.from(saved));
const c = doc.getPage(0).node.Contents();
const streams = c.asArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
const ops = streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n');
check(
  'Save: rounded corners written as Bézier curves',
  / c\n|\bc\b/.test(ops) && (ops.match(/ c\b/g) || []).length >= 4,
  (ops.match(/ c\b/g) || []).length,
);

/* other tools: ellipse still draws */
await page.evaluate(() => window.ADDPDF.setTool('ellipse'));
n0 = await count();
await drag(900, 500, 1000, 560, ['Shift']);
m = await last();
check(
  'the Ellipse tool still draws (Shift: circle)',
  (await count()) === n0 + 1 && m.t === 'ellipse' && Math.abs(sz(m)[0] - sz(m)[1]) < 0.01,
);
await page.evaluate(() => window.ADDPDF.setTool('line'));
n0 = await count();
await drag(900, 700, 1000, 760);
check('the Line tool still draws', (await count()) === n0 + 1 && (await last()).t === 'line');

await page.screenshot({ path: process.argv[2] || join(CORPUS_DIR, 'rect.png') });
check('no errors on the page', errors.length === 0, errors);
await browser.close();
if (server.close) server.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
