/* The pasteboard and the two kinds of PDF, end to end in Chromium, as a
   person works: draw outside the page and across its edge; select, move,
   resize, turn, copy, paste, duplicate and box-select out there; save a
   standard PDF (only the page's content) and an editable one; close the
   browser, open the editable PDF again and carry on editing every object;
   and Save asking only when it has to (a plain PDF only read saves without
   a question, an editable one saves as itself, Save as… always asks).

   npm run build, then: node apps/web/bench/workspace.mjs
   (BENCH_CHANNEL=chrome for an installed browser, CHROME_PATH for a binary) */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
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
const OUT = join(CORPUS_DIR, 'workspace');
mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (name, ok, info) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
};

/* a fresh browser window (the app started anew), the browser's own Save
   dialog answered: each save lands in __saves */
async function launch(file) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__saves = [];
    window.__asked = [];
    window.showSaveFilePicker = async (o) => {
      window.__asked.push(o.suggestedName);
      return {
        name: o.suggestedName,
        createWritable: async () => ({
          write: async (b) => {
            const u = new Uint8Array(await b.arrayBuffer());
            let s = '';
            for (let i = 0; i < u.length; i += 0x8000)
              s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
            window.__saves.push({ name: o.suggestedName, b64: btoa(s) });
          },
          close: async () => {},
        }),
      };
    };
  });
  await page.goto('http://localhost:' + PORT + '/');
  await page.waitForFunction(() => window.ADDPDF && window.ADDPDF.hasDoc);
  await page.setInputFiles('#fileIn', file);
  await page.waitForFunction(() => window.ADDPDF.S.items[0] && window.ADDPDF.S.items[0].rendered, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const saves = (page) => page.evaluate(() => window.__saves.length);
async function lastSave(page) {
  const b64 = await page.evaluate(() => window.__saves[window.__saves.length - 1].b64);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
const waitSave = (page, n) =>
  page
    .waitForFunction((n) => window.__saves.length > n, n, { timeout: 60000 })
    .then(
      () => true,
      () => false,
    );
const shapes = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.ADDPDF.S.items[0].shapes)));
const popOpen = (page) => page.evaluate(() => !document.getElementById('savePop').hidden);
async function pageOps(bytes) {
  const d = await PDFDocument.load(bytes);
  const c = d.getPage(0).node.Contents();
  const parts = c instanceof PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
  return parts
    .map((p) => new TextDecoder().decode(decodePDFRawStream(p instanceof PDFRawStream ? p : p).decode()))
    .join('\n');
}
const hasMarker = (bytes) => Buffer.from(bytes).includes('/AddDotsProject');
/* where each mark is against page 1: on it, across its edge, off it */
const places = (page) =>
  page.evaluate(() => {
    const it = window.ADDPDF.S.items[0],
      v = it.page.view;
    return it.shapes.map((s) => window.ADDPDFEngine.markPlace(s, { x1: v[0], y1: v[1], x2: v[2], y2: v[3] }));
  });
/* the boxes painted onto the page (a rectangle is drawn as a closed path) */
const boxesIn = (ops) => (ops.match(/\bh\s+S\b/g) || []).length;
const noLayer = (list) =>
  list.map((x) => {
    const c = Object.assign({}, x);
    delete c.layer;
    return c;
  });
/* the page's frame on screen */
const frame = (page) =>
  page.evaluate(() => {
    const r = window.ADDPDF.S.items[0].wrap.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
const PLAIN = join(CORPUS_DIR, 'small-text-12p.pdf');

/* ================= a plain PDF, only read: Save asks nothing ================= */
let { ctx, page, errors } = await launch(PLAIN);
check(
  'a plain PDF opens to read: no pasteboard round the pages',
  await page.evaluate(() => !window.ADDPDF.board() && window.ADDPDF.S.items[0].box.style.margin === ''),
);
await page.click('#btnQSave');
let got = await waitSave(page, 0);
check(
  'Save on a plain PDF only read: saved at once as a PDF, no question',
  got &&
    !(await popOpen(page)) &&
    (await page.evaluate(() => window.__asked[0])) === 'small-text-12p-edited.pdf',
  await page.evaluate(() => window.__asked),
);
check('…a standard PDF', !hasMarker(await lastSave(page)));

/* ================= the pasteboard ================= */
await page.evaluate(() => window.ADDPDF.setTool('rect'));
await page.waitForTimeout(200);
const pb = await page.evaluate(() => {
  const it = window.ADDPDF.S.items[0];
  return { on: window.ADDPDF.board(), pb: it.pb, page: it.wrap.getBoundingClientRect().top };
});
check(
  'picking a drawing tool brings the pasteboard: room round the page',
  pb.on && pb.pb && pb.pb.l > 100 && pb.pb.t > 50,
  pb.pb,
);
await page.evaluate(() => window.ADDPDF.zoomTo(0.45));
await page.waitForTimeout(900);
await page.evaluate(() => {
  const X = window.ADDPDF,
    st = document.getElementById('stage'),
    r = X.S.items[0].box.getBoundingClientRect(),
    s = st.getBoundingClientRect();
  st.scrollLeft += r.left + r.width / 2 - (s.left + s.width / 2);
  st.scrollTop += r.top - s.top - 220;
});
await page.waitForTimeout(400);
let f = await frame(page);
/* a rectangle wholly to the left of the page */
await drag(page, f.l - 170, f.t + 60, f.l - 50, f.t + 150);
let S = await shapes(page);
const R = S.length - 1;
const W = await page.evaluate(() => window.ADDPDF.S.items[0].page.view[2]);
check('a rectangle drawn wholly outside the page', S[R].t === 'rect' && Math.max(S[R].a[0], S[R].b[0]) < 0, {
  a: S[R].a,
  b: S[R].b,
});
const seen = await page.evaluate((i) => {
  const it = window.ADDPDF.S.items[0],
    el = it.anno.children[i],
    b = el.getBoundingClientRect(),
    w = it.wrap.getBoundingClientRect();
  const st = document.getElementById('stage').getBoundingClientRect();
  return {
    left: b.right < w.left,
    width: b.width,
    inView: b.left >= st.left,
    page: getComputedStyle(it.wrap).overflow,
    shown: getComputedStyle(el).display !== 'none',
  };
}, R);
check(
  '…shown there, out on the pasteboard, not cut off by the page',
  seen.left && seen.width > 20 && seen.inView && seen.page === 'visible' && seen.shown,
  seen,
);
/* a circle across the page's right edge */
await page.evaluate(() => window.ADDPDF.setTool('ellipse'));
await drag(page, f.r - 40, f.t + 200, f.r + 60, f.t + 300);
S = await shapes(page);
const C = S.length - 1;
check(
  'a circle drawn partly on, partly off the page',
  S[C].t === 'ellipse' && S[C].a[0] < W && S[C].b[0] > W,
  { a: S[C].a, b: S[C].b, W },
);
/* snapping out there: a box started on the outside one's corner lands on it */
await page.evaluate(() => window.ADDPDF.setTool('rect'));
const corner = await page.evaluate((i) => {
  const it = window.ADDPDF.S.items[0],
    s = it.shapes[i],
    r = it.anno.getBoundingClientRect(),
    v = it.vp.convertToViewportPoint(s.a[0], s.b[1]);
  return { x: r.left + v[0], y: r.top + v[1], p: [s.a[0], s.b[1]] };
}, R);
await drag(page, corner.x + 3, corner.y + 2, corner.x - 60, corner.y - 50);
S = await shapes(page);
check(
  'snapping works on the pasteboard: the new box starts on the corner',
  Math.abs(S[S.length - 1].a[0] - corner.p[0]) < 0.01 || Math.abs(S[S.length - 1].b[0] - corner.p[0]) < 0.01,
  { got: [S[S.length - 1].a, S[S.length - 1].b], corner: corner.p },
);
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes.pop();
  X.drawShapes(it);
});

/* select, move, resize, turn, copy, paste, duplicate, box-select — out there */
await page.evaluate(() => window.ADDPDF.setTool('select'));
f = await frame(page);
const mid = await page.evaluate((i) => {
  const it = window.ADDPDF.S.items[0],
    s = it.shapes[i],
    r = it.anno.getBoundingClientRect(),
    v = it.vp.convertToViewportPoint(s.a[0], (s.a[1] + s.b[1]) / 2);
  return { x: r.left + v[0], y: r.top + v[1] };
}, R);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(150);
check(
  'the outside rectangle is selected with a click',
  await page.evaluate((i) => !!window.ADDPDF.S.sel && window.ADDPDF.S.sel.i === i, R),
  await page.evaluate(() => window.ADDPDF.S.sel && window.ADDPDF.S.sel.i),
);
const s0 = (await shapes(page))[R];
/* moved further out, clear of the page whatever is pasted from it */
await drag(page, mid.x, mid.y, mid.x - 90, mid.y + 20);
const s1 = (await shapes(page))[R];
check('…moved out there', s1.a[0] < s0.a[0] - 50 && Math.max(s1.a[0], s1.b[0]) < 0, { from: s0.a, to: s1.a });
const knob = await page.evaluate(() => {
  const ks = [...document.querySelectorAll('.anno .hnd .kn')].map((e) => e.getBoundingClientRect());
  const r = ks.sort((a, b) => b.x + b.y - (a.x + a.y))[0];
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (knob) await drag(page, knob.x, knob.y, knob.x + 25, knob.y + 20);
const s2 = (await shapes(page))[R];
check('…resized by a corner grip', Math.abs(s2.b[0] - s2.a[0]) > Math.abs(s1.b[0] - s1.a[0]) + 5, {
  w1: s1.b[0] - s1.a[0],
  w2: s2.b[0] - s2.a[0],
});
await page.evaluate(() => {
  const el = document.getElementById('mpAngle');
  el.value = '20';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
check('…turned', Math.abs(((await shapes(page))[R].r || 0) - 20) < 0.5, (await shapes(page))[R].r);
/* well clear of the page before copying (a paste steps down and to the right) */
await page.evaluate((i) => {
  const X = window.ADDPDF,
    it = X.S.items[0],
    s = it.shapes[i];
  X.snapshot();
  s.a = [s.a[0] - 250, s.a[1]];
  s.b = [s.b[0] - 250, s.b[1]];
  X.drawShapes(it);
}, R);
let n = (await shapes(page)).length;
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(150);
S = await shapes(page);
check(
  'Ctrl+C, Ctrl+V: a copy, off the page too, the copy selected',
  S.length === n + 1 &&
    S[n].t === 'rect' &&
    (await places(page))[n] === 'out' &&
    (await page.evaluate((n) => window.ADDPDF.S.sel.i === n, n)),
  {
    n: S.length,
    place: (await places(page))[n],
    orig: [S[R].a, S[R].b],
    copy: [S[n].a, S[n].b],
    scale: await page.evaluate(() => window.ADDPDF.S.scale),
  },
);
await page.keyboard.press('Control+d');
await page.waitForTimeout(150);
S = await shapes(page);
check('Ctrl+D: duplicated out there', S.length === n + 2 && (await places(page))[n + 1] === 'out');
await page.keyboard.press('Control+x');
await page.waitForTimeout(100);
await page.keyboard.press('Control+v');
await page.waitForTimeout(150);
check('Ctrl+X then Ctrl+V: cut and put back', (await shapes(page)).length === n + 2);
/* a box drawn on the empty pasteboard picks what it touches */
await page.evaluate(() => {
  const X = window.ADDPDF;
  X.S.sel = null;
  X.S.multi = null;
  X.drawShapes(X.S.items[0]);
});
f = await frame(page);
await drag(page, f.l - 260, f.t + 20, f.l - 8, f.t + 230);
const picked = await page.evaluate(() => (window.ADDPDF.S.sel ? window.ADDPDF.selList().length : 0));
check('a selection box drawn on the pasteboard picks the objects there', picked >= 3, picked);
await page.evaluate(() => {
  const X = window.ADDPDF;
  X.S.sel = null;
  X.S.multi = null;
  X.drawShapes(X.S.items[0]);
});
/* and one on the page, to show what a standard PDF keeps */
await page.evaluate(() => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.snapshot();
  it.shapes.push({ t: 'rect', a: [100, 500], b: [200, 600], c: '#1F5FBF', w: 2 });
  X.drawShapes(it);
});
const marks = await shapes(page);
const where = await places(page);
const rectsShown = marks.filter((x, i) => x.t === 'rect' && where[i] !== 'out').length;

/* ================= Save with something drawn: which kind? ================= */
n = await saves(page);
await page.keyboard.press('Control+s');
await page.waitForTimeout(300);
const dlg = await page.evaluate(() => ({
  open: !document.getElementById('savePop').hidden,
  kinds: [...document.querySelectorAll('input[name="saveFmt"]')].map((r) => r.value),
  note: document.getElementById('saveFmtNote').textContent,
}));
check(
  'Ctrl+S with drawing on it: the Save dialog asks which kind',
  dlg.open && JSON.stringify(dlg.kinds) === '["pdf","project"]' && (await saves(page)) === n,
  dlg,
);
check(
  '…and says what a standard PDF leaves out',
  /off the page will be left out/.test(dlg.note) && /cut there/.test(dlg.note),
  dlg.note,
);
await page.click('#saveGo');
got = await waitSave(page, n);
const std = await lastSave(page);
writeFileSync(join(OUT, 'standard.pdf'), std);
const ops = await pageOps(std);
check('a standard PDF saved', got && !hasMarker(std));
check(
  '…the page’s own content in it, nothing from the pasteboard',
  /1 0 0 1 100 500 cm/.test(ops) &&
    boxesIn(ops) === rectsShown &&
    where.filter((p) => p === 'out').length >= 3,
  { boxes: boxesIn(ops), shown: rectsShown, where },
);
check('…the circle across the edge cut at the page’s edge', /0 0 [\d.]+ [\d.]+ re\s+W\s+n/.test(ops));
check(
  '…and the workspace untouched by saving',
  JSON.stringify(noLayer(await shapes(page))) === JSON.stringify(noLayer(marks)),
);
n = await saves(page);
await page.keyboard.press('Control+s');
got = await waitSave(page, n);
check(
  'Ctrl+S again: saved straight to the same file, the same kind, no dialog',
  got && !(await popOpen(page)) && (await page.evaluate(() => window.__asked.length)) === 2,
  await page.evaluate(() => window.__asked),
);

/* Save as…: the editable kind */
await page.evaluate(() => document.getElementById('btnSaveAs').click());
await page.waitForTimeout(150);
check('Save as… always asks', await popOpen(page));
await page.check('input[name="saveFmt"][value="project"]');
const nm = await page.inputValue('#saveName');
check('…the editable kind named apart from the plain one', /-editable\.pdf$/.test(nm), nm);
/* Save as… saves under the name typed, as a download (as it always has) */
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#saveGo')]);
got = dl.suggestedFilename() === nm;
const ed = new Uint8Array(readFileSync(await dl.path()));
writeFileSync(join(OUT, 'editable.pdf'), ed);
check('an editable PDF saved', got && hasMarker(ed), ed.length);
const viewable = await page.evaluate(async (b64) => {
  const X = window.ADDPDF,
    bin = atob(b64),
    u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const doc = await X.pdfjsLib.getDocument({ data: u }).promise;
  const p = await doc.getPage(1);
  const v = p.getViewport({ scale: 0.5 }),
    cv = document.createElement('canvas');
  cv.width = v.width;
  cv.height = v.height;
  await p.render({ canvasContext: cv.getContext('2d'), viewport: v }).promise;
  return { pages: doc.numPages, attachments: await doc.getAttachments() };
}, Buffer.from(ed).toString('base64'));
check(
  '…a valid PDF any reader shows: every page, nothing in its attachments',
  viewable.pages === 12 && !viewable.attachments,
  viewable,
);
check(
  '…its pages, like the standard one, only the page’s content',
  boxesIn(await pageOps(ed)) === rectsShown,
);
const layers0 = await page.evaluate(() =>
  JSON.stringify((window.ADDPDF.S.layers || []).map((l) => [l.id, l.name])),
);
check('no errors on the page', errors.length === 0, errors);
await ctx.close();

/* ================= closed, and the editable PDF opened again ================= */
({ ctx, page, errors } = await launch(join(OUT, 'editable.pdf')));
const back = await shapes(page);
const st = await page.evaluate(() => ({
  meta: document.getElementById('meta').textContent,
  board: window.ADDPDF.board(),
  pages: window.ADDPDF.S.items.length,
  layers: JSON.stringify((window.ADDPDF.S.layers || []).map((l) => [l.id, l.name])),
}));
check(
  'the editable PDF opens ready to edit: every object back, exactly',
  JSON.stringify(noLayer(back)) === JSON.stringify(noLayer(marks)),
  { back: back.length, was: marks.length },
);
const whereBack = await places(page);
check(
  '…the ones out on the pasteboard too, the pasteboard on',
  JSON.stringify(whereBack) === JSON.stringify(where) && st.board,
  { whereBack, board: st.board },
);
check(
  '…as an editable PDF, every page, its layers',
  /editable PDF/.test(st.meta) && st.pages === 12 && st.layers === layers0,
  st,
);
await page.evaluate(() => window.ADDPDF.zoomTo(0.45));
await page.waitForTimeout(900);
await page.evaluate(() => {
  const X = window.ADDPDF,
    stg = document.getElementById('stage'),
    r = X.S.items[0].box.getBoundingClientRect(),
    s = stg.getBoundingClientRect();
  stg.scrollLeft += r.left + r.width / 2 - (s.left + s.width / 2);
  stg.scrollTop += r.top - s.top - 220;
});
await page.waitForTimeout(400);
/* the turned box, by a point of its outline (its corner a, turned), brought into view */
const outline = (i) =>
  page.evaluate((i) => {
    const E = window.ADDPDFEngine,
      it = window.ADDPDF.S.items[0],
      s = it.shapes[i],
      r = it.anno.getBoundingClientRect();
    const q = E.rectCorners(s),
      m = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2],
      v = it.vp.convertToViewportPoint(m[0], m[1]);
    return { x: r.left + v[0], y: r.top + v[1] };
  }, i);
let o = await outline(R);
await page.evaluate((x) => {
  const st = document.getElementById('stage'),
    b = st.getBoundingClientRect();
  if (x < b.left + 80) st.scrollLeft -= b.left + 200 - x;
}, o.x);
await page.waitForTimeout(300);
o = await outline(R);
const before = (await shapes(page))[R];
await page.mouse.click(o.x, o.y);
await page.waitForTimeout(150);
await drag(page, o.x, o.y, o.x - 20, o.y - 25);
const after = (await shapes(page))[R];
check(
  '…each object picked and edited on its own, out on the pasteboard too',
  JSON.stringify(after.a) !== JSON.stringify(before.a) &&
    after.b[0] - after.a[0] === before.b[0] - before.a[0],
  { before: before.a, after: after.a },
);
await page.evaluate((i) => {
  const X = window.ADDPDF,
    it = X.S.items[0];
  X.setTool('select');
  X.S.sel = { it, i };
  X.S.multi = null;
  X.drawShapes(it);
  X.syncMarkPop();
}, C);
await page.evaluate(() => {
  const el = document.getElementById('mpWidth');
  el.value = '3';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
check(
  '…its properties too (the circle’s stroke)',
  (await shapes(page))[C].w === 3,
  (await shapes(page))[C].w,
);
n = await saves(page);
await page.keyboard.press('Control+s');
got = await waitSave(page, n);
check(
  'Ctrl+S on an editable PDF: saved as one, no question',
  got &&
    !(await popOpen(page)) &&
    hasMarker(await lastSave(page)) &&
    (await page.evaluate(() => window.__asked[0])) === 'editable.pdf',
  await page.evaluate(() => window.__asked),
);
n = await saves(page);
await page.keyboard.press('Control+s');
got = await waitSave(page, n);
check(
  '…and again: straight to the same file',
  got && (await page.evaluate(() => window.__asked.length)) === 1,
);
writeFileSync(join(OUT, 'editable-2.pdf'), await lastSave(page));
await page.evaluate(() => document.getElementById('btnSaveAs').click());
await page.waitForTimeout(150);
check(
  'Save as… on an editable PDF: asks, the editable kind chosen',
  (await popOpen(page)) &&
    (await page.evaluate(() => document.querySelector('input[name="saveFmt"]:checked').value)) === 'project',
);
await page.keyboard.press('Escape');
/* moved to a window of its own (a tab dragged out): the same document
   arrives there through exportSession / importSession, still an editable
   PDF, its pasteboard and layers as they were, Save still going straight
   to its file */
page.on('dialog', (dl) => dl.accept());
const movedFrom = await page.evaluate(() => ({
  board: window.ADDPDF.board(),
  marks: window.ADDPDF.S.items[0].shapes.length,
  layers: (window.ADDPDF.S.layers || []).length,
}));
await page.evaluate(async () => {
  const X = window.ADDPDF,
    d = X.exportSession();
  await X.importSession(d);
});
await page.waitForTimeout(600);
const movedTo = await page.evaluate(() => ({
  board: window.ADDPDF.board(),
  marks: window.ADDPDF.S.items[0].shapes.length,
  layers: (window.ADDPDF.S.layers || []).length,
  meta: document.getElementById('meta').textContent,
}));
n = await saves(page);
await page.keyboard.press('Control+s');
got = await waitSave(page, n);
check(
  'moved to a window of its own: still an editable PDF, pasteboard and layers kept, Save straight to its file',
  movedTo.board === movedFrom.board &&
    movedTo.marks === movedFrom.marks &&
    movedTo.layers === movedFrom.layers &&
    /editable PDF/.test(movedTo.meta) &&
    got &&
    !(await popOpen(page)) &&
    hasMarker(await lastSave(page)),
  { movedFrom, movedTo },
);
check('no errors on the page', errors.length === 0, errors);
await ctx.close();

({ ctx, page, errors } = await launch(join(OUT, 'editable-2.pdf')));
const third = await shapes(page);
check(
  'saved again and opened again: the edits kept',
  third[R] && JSON.stringify(third[R].a) === JSON.stringify(after.a) && third[C].w === 3,
);
await ctx.close();

/* ================= the standard PDF opened: a plain PDF ================= */
({ ctx, page, errors } = await launch(join(OUT, 'standard.pdf')));
const plain = await page.evaluate(() => ({
  marks: window.ADDPDF.S.items.reduce((n, it) => n + it.shapes.length, 0),
  board: window.ADDPDF.board(),
  meta: document.getElementById('meta').textContent,
}));
check(
  'a standard PDF opens as a plain PDF to read: no objects made of its content',
  plain.marks === 0 && !plain.board && !/editable/.test(plain.meta),
  plain,
);
check('no errors on the page', errors.length === 0, errors);
await ctx.close();

await browser.close();
if (server.close) server.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
