/* Store screenshots, step 1: the real app, driven through each feature.

   Prints sample.html to an A4 PDF, opens it in the web app (npm run dev in
   apps/web, port 5199) in Edge, and saves one raw screen per scene to
   out/raw, with the boxes of the parts the layouts zoom in on
   (out/raw/boxes.json). compose.mjs turns them into the store images. */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = join(here, 'out', 'raw');
mkdirSync(raw, { recursive: true });
const APP = process.env.APP_URL || 'http://localhost:5199/';
const only = process.argv[2] || 'all'; /* desk | phone | all */
const boxes = {};

const browser = await chromium.launch({ channel: 'msedge' });

/* ---------------- the sample PDF, and where its words are ---------------- */

const sp = await browser.newPage();
await sp.goto(pathToFileURL(join(here, 'sample.html')).href);
const pdfPath = join(here, 'out', 'sample.pdf');
/* 595 CSS px across = 595 pt: one CSS px is one PDF point */
writeFileSync(pdfPath, await sp.pdf({ format: 'A4', scale: 4 / 3, printBackground: true }));
const geo = await sp.evaluate(() => {
  const pages = [...document.querySelectorAll('.page')];
  const H = 842;
  function where(el) {
    const pg = el.closest('.page');
    return { pg, top: pg.getBoundingClientRect().top, left: pg.getBoundingClientRect().left };
  }
  /* the lines a phrase takes, as PDF quads [x1, y1, x2, y2] */
  function quads(sel, phrase) {
    const el = document.querySelector(sel);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.data.indexOf(phrase);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + phrase.length);
      const { top, left } = where(el);
      const lines = [];
      for (const q of r.getClientRects()) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.top - q.top) < 3) {
          last.right = Math.max(last.right, q.right);
          continue;
        }
        lines.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right });
      }
      return lines.map((q) =>
        [q.left - left, H - (q.bottom - top), q.right - left, H - (q.top - top)].map(
          (v) => Math.round(v * 10) / 10,
        ),
      );
    }
    throw new Error('not found: ' + phrase);
  }
  function box(el) {
    const { top, left } = where(el);
    const r = el.getBoundingClientRect();
    return {
      x: r.left - left,
      y: H - (r.bottom - top),
      w: r.width,
      h: r.height,
      page: pages.indexOf(el.closest('.page')) + 1,
    };
  }
  return {
    hl1: quads('.art2 .lede', 'shipped 38% faster'),
    hl2: quads('.art2 .cols', 'Reviews that started in a shared PDF closed in two days on average.'),
    ul1: quads('.art2 .quote', 'When the document is the meeting, everyone arrives prepared.'),
    lines: [...document.querySelectorAll('.form .fld .line')].map(box),
    sig: box(document.querySelector('.form .sig .box')),
    chart: box(document.querySelector('.art2 .chart')),
    heading: box(document.querySelector('.art2 h2')),
    checks: [...document.querySelectorAll('.form .checks span')].map(box),
  };
});
await sp.close();

/* the signature: the ink strokes from assets/signature-dialog.png (a real
   signature drawn in the app's pad), on a clear background, with where it
   sat on the pad's canvas */
const sigShot =
  'data:image/png;base64,' + readFileSync(join(here, 'assets', 'signature-dialog.png')).toString('base64');
const ip = await browser.newPage();
const SIG = await ip.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  /* the pad in that screenshot: 190..793 across, 203..353 down (above its line) */
  const X0 = 192,
    Y0 = 205,
    X1 = 790,
    Y1 = 352;
  const d = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0);
  let minx = 1e9,
    miny = 1e9,
    maxx = -1,
    maxy = -1;
  for (let y = 0; y < d.height; y++)
    for (let x = 0; x < d.width; x++) {
      const i = (y * d.width + x) * 4,
        r = d.data[i],
        gg = d.data[i + 1],
        b = d.data[i + 2];
      const ink = Math.max(0, Math.min(1, (b - r - 25) / 90));
      d.data[i] = 0x12;
      d.data[i + 1] = 0x3c;
      d.data[i + 2] = 0x8c;
      d.data[i + 3] = Math.round(ink * 255);
      if (ink > 0.3) {
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
      }
    }
  const pad = 6;
  minx = Math.max(0, minx - pad);
  miny = Math.max(0, miny - pad);
  maxx = Math.min(d.width - 1, maxx + pad);
  maxy = Math.min(d.height - 1, maxy + pad);
  const o = document.createElement('canvas');
  o.width = maxx - minx + 1;
  o.height = maxy - miny + 1;
  const t = document.createElement('canvas');
  t.width = d.width;
  t.height = d.height;
  t.getContext('2d').putImageData(d, 0, 0);
  o.getContext('2d').drawImage(t, -minx, -miny);
  /* where it was on the pad, in the pad's own canvas (620 x 200, shown 603 + 26 px wide) */
  return {
    url: o.toDataURL('image/png'),
    w: o.width,
    h: o.height,
    x: minx + (X0 - 165),
    y: miny + (Y0 - 203),
  };
}, sigShot);
await ip.close();
console.log('signature', SIG.w + 'x' + SIG.h, 'at', SIG.x, SIG.y);

/* ---------------- the marks a scene shows ---------------- */

function note(text, replies) {
  return {
    text,
    replies: (replies || []).map((t) => ({ text: t, created: Date.now() })),
    resolved: false,
    created: Date.now(),
  };
}
const COMMENT_MARKS = [
  ...[geo.hl1].map((q) => ({
    t: 'markup',
    k: 'highlight',
    id: 9001,
    quads: q,
    c: '#FFD84D',
    o: 0.5,
    quote: 'shipped 38% faster',
    note: note('Can we add the source for this number?', ['Added it to the appendix, page 22.']),
    created: Date.now(),
  })),
  {
    t: 'markup',
    k: 'highlight',
    id: 9002,
    quads: geo.hl2,
    c: '#7FB2FF',
    o: 0.45,
    quote: 'Reviews that started in a shared PDF closed in two days on average.',
    note: note("Let's make this the headline stat."),
    created: Date.now(),
  },
  {
    t: 'markup',
    k: 'underline',
    id: 9003,
    quads: geo.ul1,
    c: '#2F6BFF',
    o: 0.9,
    quote: '',
    note: null,
    created: Date.now(),
  },
  {
    t: 'note',
    a: [geo.chart.x + geo.chart.w - 14, geo.chart.y + geo.chart.h - 8],
    c: '#F2C14E',
    id: 9004,
    note: note('Use the new brand blue for 2027 too.', ['Done — updated the chart.']),
  },
];

/* a signature, drawn as one pen stroke: loops and a long tail */
function signaturePts(x0, y0, w, h) {
  const pts = [];
  const N = 220;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = x0 + t * w * 0.82 + Math.sin(t * Math.PI * 9) * w * 0.035;
    const env = Math.sin(Math.min(1, t * 1.4) * Math.PI) * (1 - t * 0.55);
    const y =
      y0 + h * 0.45 + Math.cos(t * Math.PI * 9) * h * 0.42 * env + (t > 0.85 ? -(t - 0.85) * h * 1.2 : 0);
    pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  for (let i = 1; i <= 40; i++) pts.push([x0 + w * 0.82 + i * w * 0.0045, y0 + h * 0.27 - i * 0.05]);
  return pts;
}
function formMarks() {
  const L = geo.lines;
  const vals = [
    'Mohinder Singh',
    'Brightline Labs',
    'mohinder@brightline.io',
    '+44 20 7946 0958',
    '2 March 2026',
    '$26,180',
  ];
  const marks = vals.map((v, i) => ({
    t: 'text',
    a: [L[i].x + 2, L[i].y + 6],
    c: '#111111',
    text: v,
    size: 13,
    f: 'helv',
  }));
  marks.push({
    t: 'text',
    a: [L[6].x + 2, L[6].y + 6],
    c: '#111111',
    text: '25 Oct 2026',
    size: 13,
    f: 'helv',
  });
  /* ticks in two boxes */
  for (const i of [0, 2]) {
    const c = geo.checks[i];
    marks.push({
      t: 'ink',
      c: '#1E3A8A',
      w: 2,
      pts: [
        [c.x + 1.5, c.y + 7],
        [c.x + 4.5, c.y + 3.5],
        [c.x + 11, c.y + 11],
      ],
    });
  }
  return marks;
}

/* ---------------- the app ---------------- */

async function openApp(kind, beforeOpen) {
  return openAppWith(kind, pdfPath, beforeOpen);
}
async function openAppWith(kind, file, beforeOpen) {
  const desk = kind === 'desk';
  const ctx = await browser.newContext(
    desk
      ? { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 }
      : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  );
  await ctx.addInitScript(() => {
    window.ADDDOTS_CONFIG = Object.assign({ requireSignIn: false }, window.ADDDOTS_CONFIG || {});
    window.ADDDOTS_ALL_TOOLS = true;
    try {
      localStorage.setItem('adpdf.whatsnew.seen', '1');
    } catch (e) {
      /* fine */
    }
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[' + kind + '] pageerror', e.message));
  /* the phone: the Android app's own screens (js/phone.js), as ?phone=1 turns them on */
  await p.goto(desk ? APP : APP + (APP.includes('?') ? '&' : '?') + 'phone=1');
  await p.waitForFunction(() => window.ADDPDF && window.ADDPDF.S);
  if (beforeOpen) await beforeOpen(p);
  await p.setInputFiles('#fileIn', file);
  await p.waitForFunction(() => window.ADDPDF.hasDoc);
  await p.waitForTimeout(1500);
  /* no update or what's-new bars over the screens */
  await p.addStyleTag({ content: '.updbar, .toast, #toast, .blankmark { display: none !important }' });
  return { ctx, p };
}
const click = (p, id) => p.evaluate((i) => document.getElementById(i).click(), id);
async function settle(p, ms) {
  await p.waitForTimeout(ms || 1200);
}
async function shot(p, name) {
  await settle(p);
  await p.screenshot({ path: join(raw, name + '.png') });
  console.log('saved', name);
}
async function rectOf(p, sel) {
  return p.evaluate((s) => {
    const el = typeof s === 'string' ? document.querySelector(s) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel);
}
/* a page's point on screen */
async function screenPt(p, page, x, y) {
  return p.evaluate(
    ([n, x, y]) => {
      const it = window.ADDPDF.S.items[n - 1];
      const r = it.inner.getBoundingClientRect();
      const v = it.vp.convertToViewportPoint(x, y);
      return { x: r.left + v[0], y: r.top + v[1] };
    },
    [page, x, y],
  );
}
async function addMarks(p, page, marks) {
  await p.evaluate(
    ([n, marks]) => {
      const X = window.ADDPDF,
        it = X.S.items[n - 1];
      marks.forEach((m) => it.shapes.push(m));
      X.drawShapes(it);
      X.drawThumb && X.drawThumb(it);
      X.updateMeta();
      X.renderComments && X.renderComments();
    },
    [page, marks],
  );
}
async function goPage(p, n, zoom) {
  if (zoom) {
    await p.evaluate((z) => {
      const X = window.ADDPDF;
      if (z === 'page') X.fitPage();
      else X.zoomTo(z);
    }, zoom);
    await settle(p, 1500);
  }
  await p.evaluate((n) => window.ADDPDF.goTo(n), n);
  await settle(p, 1500);
  /* the page's top at the top of the view */
  await p.evaluate((n) => {
    const it = window.ADDPDF.S.items[n - 1];
    let sc = it.inner.parentElement;
    while (
      sc &&
      !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))
    )
      sc = sc.parentElement;
    if (sc) sc.scrollTop += it.inner.getBoundingClientRect().top - sc.getBoundingClientRect().top - 18;
    window.scrollTo(0, 0);
  }, n);
  await settle(p, 1200);
}

/* ---------------- desktop scenes ---------------- */

async function desk() {
  const { ctx, p } = await openApp('desk');

  /* 1. reading: two pages side by side */
  await click(p, 'ribView');
  await p.evaluate(() => {
    const X = window.ADDPDF;
    X.setSpread && X.setSpread(true);
  });
  await goPage(p, 1, 'page');
  await shot(p, 'd1-read');
  boxes.d1 = { panel: await rectOf(p, '#ribbon') };
  await p.evaluate(() => {
    const X = window.ADDPDF;
    X.setSpread && X.setSpread(false);
  });

  /* 5. organize pages */
  await click(p, 'sTabPages');
  await settle(p, 1000);
  await p.evaluate(() => window.ADDPDF.drawVisibleThumbs && window.ADDPDF.drawVisibleThumbs());
  await p
    .waitForFunction(() => window.ADDPDF.S.items.every((it) => it.thumbDone), null, { timeout: 20000 })
    .catch(() => console.log('thumbs not all done'));
  await click(p, 'sTabPages');
  /* sharper thumbnails than the app's quick ones, for print-size images */
  await p.evaluate(async () => {
    for (const it of window.ADDPDF.S.items) {
      if (!it.page) continue;
      const v1 = it.page.getViewport({ scale: 1 });
      const v = it.page.getViewport({ scale: 560 / v1.width });
      const c = document.createElement('canvas');
      c.width = Math.floor(v.width);
      c.height = Math.floor(v.height);
      await it.page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      it.thumbCanvas = c;
      it.thumbDone = true;
    }
  });
  await p.evaluate(() => window.scrollTo(0, 0));
  await click(p, 'btnOrganize');
  await settle(p, 1500);
  await p.addStyleTag({
    content:
      '#orgGrid { grid-template-columns: repeat(6, 222px) !important; gap: 30px !important; padding: 36px 40px !important; justify-content: center }',
  });
  await p.evaluate(() => {
    const c = document.querySelectorAll('#orgGrid .orgcell');
    c[2] && c[2].click();
    c[3] && c[3].click();
  });
  console.log(
    'thumb widths',
    await p.evaluate(() => window.ADDPDF.S.items.map((it) => it.thumbCanvas && it.thumbCanvas.width)),
  );
  await shot(p, 'd5-organize');
  await p.keyboard.press('Escape');
  await p.evaluate(() => {
    const d = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Done' && b.offsetParent,
    );
    d && d.click();
  });
  await p.evaluate(() => {
    const X = window.ADDPDF;
    X.S.items.forEach((it) => {
      it.pick = false;
    });
    X.syncPicks && X.syncPicks();
  });
  await settle(p, 800);

  /* 2. comments on page 2, with the notes panel and a thread open */
  await addMarks(p, 2, COMMENT_MARKS);
  await click(p, 'ribEdit');
  await goPage(p, 2, 1.25);
  await click(p, 'sTabComments');
  await settle(p, 600);
  await p.evaluate(() => {
    const a = [...document.querySelectorAll('article')].find(
      (x) => x.offsetParent && /38%/.test(x.textContent),
    );
    a && a.click();
  });
  await settle(p, 900);
  await shot(p, 'd2-comment');
  boxes.d2 = { thread: await rectOf(p, '#cthread:not([hidden])'), rail: await rectOf(p, '#rail') };
  await p.keyboard.press('Escape');
  await p.evaluate(() => {
    const c = document.getElementById('cthread');
    if (c) c.hidden = true;
  });
  await click(p, 'sTabComments');

  /* 3. Edit Text: the heading on page 2 lifted and retyped */
  await click(p, 'ribEdit');
  await goPage(p, 2, 1.25);
  await click(p, 'tEditText');
  await p.evaluate(() => {
    const g = document.getElementById('grpEditObj');
    let sc = g.parentElement;
    while (
      sc &&
      !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))
    )
      sc = sc.parentElement;
    if (sc) sc.scrollTop += g.getBoundingClientRect().top - sc.getBoundingClientRect().top - 260;
    window.scrollTo(0, 0);
  });
  await p.evaluate(() => {
    document.getElementById('grpEditObj').scrollIntoView({ block: 'center' });
    window.scrollTo(0, 0);
  });
  await settle(p, 500);
  {
    const g = await rectOf(p, '#grpEditObj');
    console.log('edit group at', JSON.stringify(g));
    await p.screenshot({
      path: join(raw, 'd3-group.png'),
      clip: { x: g.x - 14, y: g.y - 10, width: g.w + 28, height: g.h + 14 },
    });
  }
  const h = geo.heading;
  const hp = await screenPt(p, 2, h.x + 60, h.y + h.h - 22);
  await p.mouse.move(hp.x, hp.y);
  await settle(p, 600);
  await p.mouse.click(hp.x, hp.y);
  await settle(p, 2500);
  await p.keyboard.press('End');
  await p.keyboard.press('Shift+Home');
  await p.keyboard.type('Clear documents create', { delay: 20 });
  await settle(p, 500);
  /* done typing: a click on the empty grey beside the page */
  const st = await rectOf(p, '#stage');
  await p.mouse.click(st.x + 40, st.y + st.h - 40);
  await settle(p, 1500);
  /* the edited line picked up, as after the edit */
  await p.evaluate(() => {
    const X = window.ADDPDF,
      it = X.S.items[1];
    const i = it.shapes.map((s) => s.t).lastIndexOf('text');
    X.setTool('select');
    X.S.sel = { it, i };
    X.drawShapes(it);
    X.syncMarkPop();
  });
  await shot(p, 'd3-edit');
  boxes.d3 = {
    group: await rectOf(p, '#grpEditObj'),
    editor: await rectOf(p, '.tedit, .texted, #textEditor, [contenteditable="true"]'),
  };
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.evaluate(() => {
    const X = window.ADDPDF;
    X.setTool('select');
  });

  /* 4. fill and sign the form on page 3 */
  await addMarks(p, 3, formMarks());
  await click(p, 'ribForm');
  await goPage(p, 3, 1.15);
  boxes.d4 = { panel: await rectOf(p, '#ribbon') };
  await click(p, 'btnSign');
  await settle(p, 800);
  await p.evaluate(() => document.querySelector('#sigModal [data-c="#123C8C"]').click());
  /* a touch of the pen where the signature starts, so the pad counts as
     signed, then the signature itself on the pad's canvas */
  const cvr = await rectOf(p, '#sigCanvas');
  const k = cvr.w / 620;
  const sx = cvr.x + (SIG.x + 8) * k,
    sy = cvr.y + (SIG.y + SIG.h - 10) * k;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.mouse.move(sx + 1, sy);
  await p.mouse.up();
  await p.evaluate(async (S) => {
    const cv = document.getElementById('sigCanvas'),
      g = cv.getContext('2d');
    const img = new Image();
    img.src = S.url;
    await img.decode();
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(img, S.x, S.y);
  }, SIG);
  await shot(p, 'd4-pad');
  boxes.d4.pad = await rectOf(p, '#sigModal .sigbox');
  await click(p, 'sigApply');
  await settle(p, 700);
  /* drag the box it goes in, on the signature line */
  const sb = geo.sig,
    hgt = sb.h - 6,
    wid = (hgt * SIG.w) / SIG.h;
  const a = await screenPt(p, 3, sb.x + 18, sb.y + sb.h - 2);
  const b2 = await screenPt(p, 3, sb.x + 18 + wid, sb.y + 4);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move((a.x + b2.x) / 2, (a.y + b2.y) / 2, { steps: 4 });
  await p.mouse.move(b2.x, b2.y, { steps: 4 });
  await p.mouse.up();
  await settle(p, 800);
  await p.evaluate(() => {
    const X = window.ADDPDF;
    X.S.sel = null;
    X.setTool('select');
    X.redrawAll();
  });
  await shot(p, 'd4-sign');

  /* 6. convert */
  await click(p, 'ribConvert');
  await goPage(p, 2, 'page');
  await shot(p, 'd6-convert');
  boxes.d6 = { panel: await rectOf(p, '#ribbon') };
  await click(p, 'btnToWord');
  await shot(p, 'd6-dialog');
  boxes.d6.dialog = await p.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog], .cvbox, .modal > div')]
      .filter((x) => x.offsetParent && /PDF to Word/.test(x.textContent))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  await p.keyboard.press('Escape');

  await ctx.close();
}

/* ---------------- phone scenes ---------------- */

async function phone() {
  const { ctx, p } = await openApp('phone', async (p) => {
    await p.addStyleTag({ content: '.updbar, .toast, #toast { display: none !important }' });
    await settle(p, 1500);
    await shot(p, 'p0-home');
  });
  await settle(p, 1500);
  await shot(p, 'p1-read');

  /* comments: the thread on the first highlight */
  await addMarks(p, 2, COMMENT_MARKS);
  await goPage(p, 2);
  await p.evaluate(() => {
    const it = window.ADDPDF.S.items[1];
    const f = [...it.anno.querySelectorAll('polygon')][0];
    f && f.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await shot(p, 'p2-comment');
  boxes.p2 = { thread: await rectOf(p, '#cthread') };
  await p.evaluate(() => {
    const c = document.getElementById('cthread');
    if (c) c.hidden = true;
  });

  /* the form, filled and signed */
  const sb = geo.sig,
    hgt = sb.h - 6,
    wid = (hgt * SIG.w) / SIG.h;
  await addMarks(p, 3, [
    ...formMarks(),
    {
      t: 'sig',
      id: 'sigstore',
      kind: 'sig',
      url: SIG.url,
      iw: SIG.w,
      ih: SIG.h,
      a: [sb.x + 18, sb.y + 2],
      b: [sb.x + 18 + wid, sb.y + 2 + hgt],
    },
  ]);
  await goPage(p, 3);
  await shot(p, 'p3-sign');

  /* the signature pad */
  await click(p, 'btnSign');
  await settle(p, 800);
  await p.evaluate(() => document.querySelector('#sigModal [data-c="#123C8C"]').click());
  const cvr = await rectOf(p, '#sigCanvas');
  const k = cvr.w / 620;
  const sx = cvr.x + (SIG.x + 8) * k,
    sy = cvr.y + (SIG.y + SIG.h - 10) * k;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.mouse.move(sx + 1, sy);
  await p.mouse.up();
  await p.evaluate(async (S) => {
    const cv = document.getElementById('sigCanvas'),
      g = cv.getContext('2d');
    const img = new Image();
    img.src = S.url;
    await img.decode();
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(img, S.x, S.y);
  }, SIG);
  await shot(p, 'p3-pad');
  boxes.p3 = { pad: await rectOf(p, '#sigModal .sigbox') };
  await p.keyboard.press('Escape');
  await p.evaluate(() => {
    const m = document.getElementById('sigModal');
    if (m) m.hidden = true;
  });

  /* organize */
  await p.evaluate(async () => {
    for (const it of window.ADDPDF.S.items) {
      if (!it.page) await window.ADDPDF.ensurePage(it);
      const v1 = it.page.getViewport({ scale: 1 });
      const v = it.page.getViewport({ scale: 420 / v1.width });
      const c = document.createElement('canvas');
      c.width = Math.floor(v.width);
      c.height = Math.floor(v.height);
      await it.page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      it.thumbCanvas = c;
      it.thumbDone = true;
    }
  });
  await click(p, 'btnOrganize');
  await settle(p, 1500);
  await p.evaluate(() => {
    const c = document.querySelectorAll('#orgGrid .orgcell');
    c[2] && c[2].click();
  });
  await shot(p, 'p4-organize');
  await p.evaluate(() => {
    const d = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Done' && b.offsetParent,
    );
    d && d.click();
  });
  await settle(p, 800);

  /* the menu of tools */
  await goPage(p, 2);
  await p.evaluate(() => {
    const b = document.elementFromPoint(innerWidth - 22, 28);
    (b.closest('button') || b).click();
  });
  await shot(p, 'p5-menu');
  await ctx.close();
}

/* ---------------- the floor plan: site photos, dimensions, rulers ---------------- */

/* photos for the pins: real ones from assets/site-photos if there are any,
   else drawn: a room in one-point perspective with what is being built in it */
async function sitePhotos() {
  const dir = join(here, 'assets', 'site-photos');
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort();
  } catch (e) {
    /* none */
  }
  if (files.length) {
    return files.map(
      (f) =>
        'data:image/' +
        (/png$/i.test(f) ? 'png' : /webp$/i.test(f) ? 'webp' : 'jpeg') +
        ';base64,' +
        readFileSync(join(dir, f)).toString('base64'),
    );
  }
  const pg = await browser.newPage();
  const out = await pg.evaluate(() => {
    function room(o) {
      const W = 1200,
        H = 900,
        c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      const bx = W * 0.27,
        by = H * 0.2,
        bw = W * 0.46,
        bh = H * 0.46; /* the back wall */
      const grad = (x0, y0, x1, y1, a, b) => {
        const q = g.createLinearGradient(x0, y0, x1, y1);
        q.addColorStop(0, a);
        q.addColorStop(1, b);
        return q;
      };
      const poly = (pts, fill) => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
        g.fillStyle = fill;
        g.fill();
      };
      poly(
        [
          [0, 0],
          [W, 0],
          [bx + bw, by],
          [bx, by],
        ],
        grad(0, 0, 0, by, o.ceil[0], o.ceil[1]),
      );
      poly(
        [
          [0, 0],
          [bx, by],
          [bx, by + bh],
          [0, H],
        ],
        grad(0, 0, bx, 0, o.side[0], o.side[1]),
      );
      poly(
        [
          [W, 0],
          [W, H],
          [bx + bw, by + bh],
          [bx + bw, by],
        ],
        grad(W, 0, bx + bw, 0, o.side[0], o.side[1]),
      );
      poly(
        [
          [0, H],
          [bx, by + bh],
          [bx + bw, by + bh],
          [W, H],
        ],
        grad(0, by + bh, 0, H, o.floor[0], o.floor[1]),
      );
      g.fillStyle = grad(bx, by, bx, by + bh, o.back[0], o.back[1]);
      g.fillRect(bx, by, bw, bh);
      /* the floor's tiles or boards, run to the vanishing point */
      const vx = W / 2,
        vy = H * 0.42;
      g.save();
      g.beginPath();
      g.moveTo(0, H);
      g.lineTo(bx, by + bh);
      g.lineTo(bx + bw, by + bh);
      g.lineTo(W, H);
      g.closePath();
      g.clip();
      g.strokeStyle = o.joint;
      g.lineWidth = 2;
      for (let i = -14; i <= 14; i++) {
        const x = W / 2 + i * 120;
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(vx + (x - vx) * ((by + bh - vy) / (H - vy)), by + bh);
        g.stroke();
      }
      for (let k = 1; k < 7; k++) {
        const t = Math.pow(k / 7, 1.7),
          y = by + bh + (H - by - bh) * t;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      g.restore();
      if (o.draw) o.draw(g, { W, H, bx, by, bw, bh, grad, poly });
      /* light from the window, grain and a soft edge, as a phone camera gives */
      const lg = g.createRadialGradient(W * 0.5, H * 0.35, 50, W * 0.5, H * 0.4, W * 0.75);
      lg.addColorStop(0, 'rgba(255,248,235,.22)');
      lg.addColorStop(1, 'rgba(0,0,0,.38)');
      g.fillStyle = lg;
      g.fillRect(0, 0, W, H);
      const im = g.getImageData(0, 0, W, H),
        d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
      }
      g.putImageData(im, 0, 0);
      return c.toDataURL('image/jpeg', 0.86);
    }
    const kitchen = room({
      ceil: ['#E9E6E1', '#CFCBC4'],
      side: ['#B9B2A7', '#D8D2C8'],
      back: ['#E6E0D6', '#D3CCC0'],
      floor: ['#A9A39A', '#7E786F'],
      joint: 'rgba(60,55,50,.35)',
      draw(g, r) {
        g.fillStyle = '#F4F7FB';
        g.fillRect(r.bx + r.bw * 0.3, r.by + r.bh * 0.12, r.bw * 0.4, r.bh * 0.38);
        g.strokeStyle = '#5E5A55';
        g.lineWidth = 8;
        g.strokeRect(r.bx + r.bw * 0.3, r.by + r.bh * 0.12, r.bw * 0.4, r.bh * 0.38);
        g.fillStyle = '#2F3237';
        g.fillRect(r.bx - 2, r.by + r.bh * 0.62, r.bw + 4, r.bh * 0.38);
        g.fillStyle = '#C8C3BA';
        g.fillRect(r.bx - 6, r.by + r.bh * 0.58, r.bw + 12, r.bh * 0.06);
        for (let i = 1; i < 5; i++) {
          g.fillStyle = 'rgba(255,255,255,.12)';
          g.fillRect(r.bx + (r.bw * i) / 5 - 1, r.by + r.bh * 0.64, 2, r.bh * 0.34);
        }
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = 2;
        for (let y = r.by + r.bh * 0.33; y < r.by + r.bh * 0.56; y += 26)
          for (let x = r.bx; x < r.bx + r.bw * 0.3; x += 52) g.strokeRect(x, y, 52, 26);
      },
    });
    const bath = room({
      ceil: ['#E3E5E8', '#C9CCD1'],
      side: ['#8FA3A8', '#B5C3C6'],
      back: ['#9DB4B5', '#87A0A2'],
      floor: ['#8D9294', '#6A6F72'],
      joint: 'rgba(40,45,50,.25)',
      draw(g, r) {
        g.fillStyle = 'rgba(40,120,120,.55)';
        g.fillRect(r.bx, r.by + r.bh * 0.35, r.bw, r.bh * 0.65);
        g.fillStyle = '#E9ECEE';
        g.fillRect(r.bx + r.bw * 0.08, r.by + r.bh * 0.66, r.bw * 0.5, r.bh * 0.34);
        g.fillStyle = '#C9CDD0';
        g.fillRect(r.bx + r.bw * 0.08, r.by + r.bh * 0.66, r.bw * 0.5, r.bh * 0.05);
        g.fillStyle = '#B8BCC0';
        g.beginPath();
        g.arc(r.bx + r.bw * 0.82, r.by + r.bh * 0.25, 22, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#B8BCC0';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(r.bx + r.bw * 0.82, r.by + r.bh * 0.25);
        g.lineTo(r.bx + r.bw * 0.82, r.by + r.bh * 0.55);
        g.stroke();
      },
    });
    const windowFrame = room({
      ceil: ['#ECEAE6', '#D2CFC9'],
      side: ['#C8C1B5', '#E0DACF'],
      back: ['#DAD4C8', '#C9C2B5'],
      floor: ['#B48A5E', '#8A6440'],
      joint: 'rgba(70,40,15,.35)',
      draw(g, r) {
        const x = r.bx + r.bw * 0.12,
          y = r.by + r.bh * 0.12,
          w = r.bw * 0.76,
          h = r.bh * 0.7;
        g.fillStyle = r.grad(0, y, 0, y + h, '#9CC4EA', '#E7F1F8');
        g.fillRect(x, y, w, h);
        g.fillStyle = '#6F8F5A';
        g.fillRect(x, y + h * 0.72, w, h * 0.28);
        g.strokeStyle = '#8A6A45';
        g.lineWidth = 14;
        g.strokeRect(x, y, w, h);
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(x + w / 2, y);
        g.lineTo(x + w / 2, y + h);
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.fillRect(x + 10, y + 10, w * 0.18, h - 20);
      },
    });
    const electrical = room({
      ceil: ['#E5E3DF', '#C8C5C0'],
      side: ['#BDB7AD', '#D6D1C8'],
      back: ['#D8D3CA', '#C5BFB4'],
      floor: ['#9B958C', '#77716A'],
      joint: 'rgba(50,45,40,.3)',
      draw(g, r) {
        for (let i = 0; i < 3; i++) {
          const x = r.bx + r.bw * (0.2 + i * 0.28),
            y = r.by + r.bh * 0.62;
          g.fillStyle = '#F2F2F0';
          g.fillRect(x, y, 46, 46);
          g.strokeStyle = '#8B8780';
          g.lineWidth = 2;
          g.strokeRect(x, y, 46, 46);
          g.fillStyle = '#3A3836';
          g.fillRect(x + 12, y + 14, 6, 14);
          g.fillRect(x + 28, y + 14, 6, 14);
        }
        g.strokeStyle = '#D9462B';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(r.bx + r.bw * 0.2 + 23, r.by + r.bh * 0.62);
        g.bezierCurveTo(
          r.bx + r.bw * 0.25,
          r.by + r.bh * 0.2,
          r.bx + r.bw * 0.6,
          r.by + r.bh * 0.3,
          r.bx + r.bw * 0.76 + 23,
          r.by + r.bh * 0.62,
        );
        g.stroke();
        g.strokeStyle = '#2B5FD9';
        g.beginPath();
        g.moveTo(r.bx + r.bw * 0.48 + 23, r.by + r.bh * 0.62);
        g.lineTo(r.bx + r.bw * 0.5, r.by);
        g.stroke();
      },
    });
    return [kitchen, bath, windowFrame, electrical];
  });
  await pg.close();
  return out;
}

/* the photo on show in the viewer */
function viewerBox(p) {
  return p.evaluate(() => {
    const im = [...document.querySelectorAll('#lb img')]
      .filter((x) => x.offsetParent)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const r = (im || document.getElementById('lb')).getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

async function planScenes(kind) {
  const pp = await browser.newPage();
  await pp.goto(pathToFileURL(join(here, 'plan.html')).href);
  const planPdf = join(here, 'out', 'plan.pdf');
  writeFileSync(
    planPdf,
    await pp.pdf({ format: 'A3', landscape: true, scale: 4 / 3, printBackground: true }),
  );
  await pp.close();
  const photos = await sitePhotos();
  /* the plan's metres as PDF points (plan.html: 1:50, origin at 120, 130) */
  const M = 56.693,
    PX = (m) => 120 + m * M,
    PY = (m) => 841.89 - (130 + m * M);
  /* assets/site-photos in name order: lobby finishes, ceiling framing,
     ceiling boards, edge protection, crane lift (the drawn ones repeat) */
  const ph = (i, cap) => ({ src: photos[i % photos.length], cap });
  const LOCS = [
    {
      id: 'Lk',
      n: '1',
      ref: 'F-01',
      desc: 'Living · finishes',
      boq: '9.2.1',
      note: 'Marble and brass trims done',
      photos: [ph(0, 'Finishes complete'), ph(1, 'Ceiling before boarding')],
      at: [1.0, 7.4],
    },
    {
      id: 'Lb',
      n: '2',
      ref: 'C-02',
      desc: 'Kitchen · ceiling framing',
      boq: '7.4.2',
      note: 'Grid levelled and checked',
      photos: [ph(1, 'Ceiling grid, levels checked')],
      at: [5.9, 2.3],
    },
    {
      id: 'Ll',
      n: '3',
      ref: 'C-03',
      desc: 'Bath · ceiling boards',
      boq: '7.4.3',
      note: 'Moisture-resistant boards',
      photos: [ph(2, 'First boards fixed')],
      at: [8.6, 6.4],
    },
    {
      id: 'Le',
      n: '4',
      ref: 'S-04',
      desc: 'Structure · edge protection',
      boq: '2.1.6',
      note: 'Loading bays in place',
      photos: [ph(3, 'Loading bays, levels 6 to 9'), ph(4, 'Rebar lift to the roof')],
      at: [12.4, 2.6],
    },
    {
      id: 'Lr',
      n: '5',
      ref: 'D-07',
      desc: 'Laundry · door',
      boq: '5.1.7',
      note: '',
      photos: [],
      at: [12.2, 6.2],
    },
  ];
  const DIMS = [
    { t: 'dim', a: [PX(0), PY(-0.75)], b: [PX(14), PY(-0.75)], c: '#6A4BF0', w: 1 },
    { t: 'dim', a: [PX(0), PY(-0.35)], b: [PX(7), PY(-0.35)], c: '#6A4BF0', w: 0.8, ds: 'tick' },
    { t: 'dim', a: [PX(7), PY(-0.35)], b: [PX(10.5), PY(-0.35)], c: '#6A4BF0', w: 0.8, ds: 'tick' },
    { t: 'dim', a: [PX(10.5), PY(-0.35)], b: [PX(14), PY(-0.35)], c: '#6A4BF0', w: 0.8, ds: 'tick' },
    { t: 'dim', a: [PX(-0.75), PY(0)], b: [PX(-0.75), PY(10)], c: '#6A4BF0', w: 1 },
    { t: 'dim', a: [PX(-0.35), PY(0)], b: [PX(-0.35), PY(6)], c: '#6A4BF0', w: 0.8, ds: 'tick' },
    { t: 'dim', a: [PX(-0.35), PY(6)], b: [PX(-0.35), PY(10)], c: '#6A4BF0', w: 0.8, ds: 'tick' },
    { t: 'dim', a: [PX(1.5), PY(1.0)], b: [PX(5.5), PY(1.0)], c: '#E2483D', w: 1 },
    { t: 'dimr', a: [PX(2.3), PY(8.5)], b: [PX(3.7), PY(7.25)], rad: 0.75 * M, c: '#E2483D', w: 1 },
  ];

  const { ctx, p } = await openAppWith(kind, planPdf);
  const desk = kind === 'desk';
  await p.evaluate((locs) => {
    const X = window.ADDPDF;
    locs.forEach((L) => {
      const loc = Object.assign({}, L);
      delete loc.at;
      X.S.locs[L.id] = loc;
    });
  }, LOCS);
  await addMarks(
    p,
    1,
    LOCS.map((L) => ({ t: 'pin', id: L.id, a: [PX(L.at[0]), PY(L.at[1])] })),
  );
  /* the drawing's scale, 1:50 in millimetres */
  await p.evaluate(() => {
    const u = document.getElementById('dimUnit'),
      sc = document.getElementById('dimScale');
    if (u) {
      u.value = 'mm';
      u.dispatchEvent(new Event('change'));
    }
    if (sc) {
      if (![...sc.options].some((o) => o.value === '50')) sc.add(new Option('1:50', '50'));
      sc.value = '50';
      sc.dispatchEvent(new Event('change'));
    }
  });

  if (desk) {
    /* 7. site photos: the pins, the list and one location open */
    await click(p, 'ribView');
    await goPage(p, 1, 'page');
    await p.evaluate(() => window.ADDPDF.setRail(true));
    await click(p, 'sTabPins');
    await settle(p, 800);
    await p.evaluate(() => {
      const r = [...document.querySelectorAll('#pinList .loc')][0];
      if (r) r.click();
    });
    await settle(p, 900);
    await shot(p, 'd7-pins');
    boxes.d7 = { rail: await rectOf(p, '#rail') };
    /* the photo viewer, from a pin on the page */
    await p.evaluate(() => {
      const g = document.querySelector('.anno g.pin');
      if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(p, 1000);
    await shot(p, 'd7-viewer');
    boxes.d7.viewer = await viewerBox(p);
    await p.keyboard.press('Escape');
    await p.evaluate(() => {
      const lb = document.getElementById('lb');
      if (lb) lb.hidden = true;
    });
    await click(p, 'sTabPins');
    await settle(p, 500);

    /* 8. dimensions to scale, with the Draw tab's measuring tools */
    await addMarks(p, 1, DIMS);
    await click(p, 'ribDraw');
    await goPage(p, 1, 'page');
    await p.evaluate(() => window.ADDPDF.setTool('dim'));
    await settle(p, 800);
    await shot(p, 'd8-dims');
    {
      const g = await rectOf(p, '#grpDraw');
      await p.screenshot({
        path: join(raw, 'd8-tools.png'),
        clip: { x: g.x - 10, y: g.y - 10, width: g.w + 20, height: g.h + 16 },
      });
      boxes.d8 = { tools: g };
    }
    await p.evaluate(() => window.ADDPDF.setTool('select'));

    /* 9. rulers and guides, close in on the plan */
    await click(p, 'ribView');
    await p.evaluate(() => {
      const it = window.ADDPDF.S.items[0];
      it.guides = [
        { v: true, at: (120 + 7 * 56.693) / 1190.55 },
        { v: true, at: (120 + 10.5 * 56.693) / 1190.55 },
        { v: false, at: (130 + 4 * 56.693) / 841.89 },
        { v: false, at: (130 + 6 * 56.693) / 841.89 },
      ];
    });
    await click(p, 'btnRulers');
    await goPage(p, 1, 1.45);
    await p.evaluate(() => {
      const st = document.getElementById('stage');
      st.scrollLeft = 260;
      st.scrollTop += 120;
      window.ADDPDF.redrawAll();
    });
    await settle(p, 1200);
    await shot(p, 'd9-rulers');
  } else {
    /* phone: the pins on the plan and the list of locations */
    await goPage(p, 1);
    await p.evaluate(() => {
      window.ADDPDF.setRail(true);
      const t = document.getElementById('tabPins');
      if (t) t.click();
    });
    await settle(p, 1000);
    await shot(p, 'p6-pins');
    await p.evaluate(() => {
      const g = document.querySelector('.anno g.pin');
      if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(p, 1000);
    await shot(p, 'p6-viewer');
    boxes.p6 = { viewer: await viewerBox(p) };
  }
  await ctx.close();
}

if (only === 'all' || only === 'desk') await desk();
if (only === 'all' || only === 'phone') await phone();
if (only === 'all' || only === 'plan') {
  await planScenes('desk');
  await planScenes('phone');
}
writeFileSync(join(raw, 'boxes-' + only + '.json'), JSON.stringify(boxes, null, 2));
await browser.close();
