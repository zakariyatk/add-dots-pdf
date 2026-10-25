/* Add Dots PDF — where each page goes on the paper
   ------------------------------------------------
   The Print dialog (js/print.js) asks this for its sheets: which pages are
   printed, on how many sheets of paper, and where on each sheet each page
   is drawn, how big and which way round. Nothing here draws: the preview
   draws from the plan, the Windows app prints from it (src-tauri/src/print.rs)
   and a browser prints a PDF laid out from it.

   Everything is in PDF points (1/72 inch), from the sheet's top left corner,
   y running down. A page's size is as it is shown: its own turn (r) applied.
   A sheet may have a paper of its own (paper by page size, a poster's
   tiles turned the page's way): then it carries its w, h, landscape and
   paper (the paper's id), else it is the plan's paper.
   A cell's `rot` is a further turn, in quarters clockwise: 0, or 1 or 3 when
   the page is turned to fit, whichever way puts a page that was turned
   itself back the right way up.

   Plain functions with no page around them, so the tests run them as they are. */
(function () {
  'use strict';

  /* paper sizes, portrait, in points */
  const PAPERS = [
    { id: 'a4', name: 'A4', w: 595.28, h: 841.89 },
    { id: 'a3', name: 'A3', w: 841.89, h: 1190.55 },
    { id: 'a5', name: 'A5', w: 419.53, h: 595.28 },
    { id: 'letter', name: 'Letter', w: 612, h: 792 },
    { id: 'legal', name: 'Legal', w: 612, h: 1008 },
    { id: 'tabloid', name: 'Tabloid', w: 792, h: 1224 }
  ];

  /* the grids a sheet is split into for n pages, columns x rows */
  const GRIDS = { 2: [[1, 2], [2, 1]], 4: [[2, 2]], 6: [[2, 3], [3, 2]], 9: [[3, 3]], 16: [[4, 4]] };

  /* "1-5, 8, 11-13" as page indexes (from 0), in the order typed; null when
     it is not a range of this document's pages */
  function parseRange(text, n) {
    const out = [];
    const parts = String(text || '').split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    for (const p of parts) {
      const m = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(p);
      if (!m) return null;
      const a = +m[1], b = m[2] === undefined ? a : m[2] === '' ? n : +m[2];
      if (a < 1 || b < 1 || a > n || b > n) return null;
      const step = a <= b ? 1 : -1;
      for (let i = a; i !== b + step; i += step) out.push(i - 1);
    }
    return out;
  }

  /* the pages printed, as indexes: o.pick 'all', 'current' (o.current) or
     'range' (o.range); then odd or even page numbers only (o.subset), and
     last first (o.reverse). null when the range cannot be read. */
  function choosePages(n, o) {
    let list;
    if (o.pick === 'current') list = [Math.min(Math.max(o.current | 0, 0), n - 1)];
    else if (o.pick === 'range') list = parseRange(o.range, n);
    else list = Array.from({ length: n }, function (_, i) { return i; });
    if (!list) return null;
    if (o.subset === 'odd') list = list.filter(function (i) { return i % 2 === 0; });
    else if (o.subset === 'even') list = list.filter(function (i) { return i % 2 === 1; });
    if (o.reverse) list = list.slice().reverse();
    return list;
  }

  /* the part of the sheet that can be printed: the printer's margins, which
     come for portrait paper and are kept equal on opposite sides so they
     hold whichever way the driver turns the paper for landscape */
  function printable(w, h, m, landscape) {
    m = m || {};
    const lr = Math.max(m.l || 0, m.r || 0), tb = Math.max(m.t || 0, m.b || 0);
    const x = landscape ? tb : lr, y = landscape ? lr : tb;
    return { x: x, y: y, w: Math.max(1, w - 2 * x), h: Math.max(1, h - 2 * y) };
  }

  /* how big a page w x h is drawn in a box bw x bh */
  function scaleFor(fit, custom, w, h, bw, bh) {
    const s = Math.min(bw / w, bh / h);
    if (fit === 'actual') return 1;
    if (fit === 'shrink') return Math.min(1, s);
    if (fit === 'custom') return Math.max(0.01, (+custom || 100) / 100);
    return s;
  }

  /* page `page` (w x h) drawn in box b at scale s, quarter-turned rot,
     placed by ax/ay (0 left/top, 0.5 centred, 1 right/bottom) and cut to b */
  function place(page, w, h, rot, s, b, ax, ay, border) {
    const fw = (rot ? h : w) * s, fh = (rot ? w : h) * s;
    return {
      page: page, rot: rot,
      x: b.x + (b.w - fw) * ax, y: b.y + (b.h - fh) * ay, w: fw, h: fh,
      clip: { x: b.x, y: b.y, w: b.w, h: b.h }, border: !!border
    };
  }

  /* turned a quarter if that draws it bigger in the box */
  function bestTurn(w, h, bw, bh) {
    return Math.min(bh / w, bw / h) > Math.min(bw / w, bh / h) * 1.001 ? 1 : 0;
  }

  /* a layout drawing the page bigger than the best so far, or as big
     without turning it */
  function better(s, rot, best) {
    return !best || s > best.s * 1.001 || (s > best.s * 0.999 && best.rot && !rot);
  }

  /* the smallest paper a page w x h fits on, either way round; the
     biggest when none is big enough */
  function paperFor(papers, w, h) {
    const lo = Math.min(w, h) * 0.98, hi = Math.max(w, h) * 0.98;
    let fit = null, big = null;
    papers.forEach(function (p) {
      const a = p.w * p.h;
      if (Math.min(p.w, p.h) >= lo && Math.max(p.w, p.h) >= hi && (!fit || a < fit.w * fit.h)) fit = p;
      if (!big || a > big.w * big.h) big = p;
    });
    return fit || big;
  }

  /* a quarter turn to fit, back against the page's own turn when it has one */
  function upright(sheets, sizes) {
    sheets.forEach(function (s) {
      s.cells.forEach(function (c) { if (c.rot === 1 && sizes[c.page].r === 90) c.rot = 3; });
    });
    return sheets;
  }

  /* The sheets for pages `sizes` ([{w, h, r}], every page of the document) and
     the dialog's choices `o`:
       pick, current, range, subset, reverse — which pages (choosePages)
       mode       'size' | 'multiple' | 'booklet' | 'poster'
       fit        'fit' | 'actual' | 'shrink' | 'custom', with scale (%)
       byPage     for 'size': each page on the smallest of `papers`
                  ([{ id, w, h }]) it fits on, turned its way
       tile       for 'poster': the page's scale (%); overlap, in points,
                  repeated on the next tile; largeOnly, a page that fits
                  on one sheet at that scale is printed on one
       per        pages a sheet, for 'multiple' (2, 4, 6, 9, 16)
       order      'h' | 'hr' | 'v' | 'vr' (across, across from the right,
                  down, down from the right); border
       binding    'left' | 'right'; side 'both' | 'front' | 'back', for 'booklet'
       orient     'auto' | 'portrait' | 'landscape'
       paper      { w, h } portrait; margins { l, t, r, b }
     Gives { w, h, landscape, sheets: [{ cells }], scale, pages } or
     { error } when there is nothing to print. */
  function plan(sizes, o) {
    const n = sizes.length;
    if (!n) return { error: 'There is no page to print' };
    const pages = choosePages(n, o);
    if (!pages) return { error: 'Type pages as 1-5, 8, 11-13' };
    if (!pages.length) return { error: 'No page in that choice' };
    const paper = o.paper || PAPERS[0];
    const pw = Math.min(paper.w, paper.h), ph = Math.max(paper.w, paper.h);
    const sheetOf = function (land) { return land ? { w: ph, h: pw, land: true } : { w: pw, h: ph, land: false }; };
    const fixed = o.orient === 'portrait' ? [false] : o.orient === 'landscape' ? [true] : [false, true];
    const mode = o.mode === 'multiple' || o.mode === 'booklet' || o.mode === 'poster' ? o.mode : 'size';

    if (mode === 'size' && o.byPage && o.papers && o.papers.length) {
      let first = null;
      const sheets = pages.map(function (i) {
        const z = sizes[i], land = z.w > z.h;
        const pp = paperFor(o.papers, z.w, z.h);
        const w = land ? Math.max(pp.w, pp.h) : Math.min(pp.w, pp.h);
        const h = land ? Math.min(pp.w, pp.h) : Math.max(pp.w, pp.h);
        const b = printable(w, h, o.margins, land);
        const s = scaleFor(o.fit, o.scale, z.w, z.h, b.w, b.h);
        if (first === null) first = s;
        return { w: w, h: h, landscape: land, paper: pp.id, cells: [place(i, z.w, z.h, 0, s, b, 0.5, 0.5, false)] };
      });
      const f = sheets[0];
      return { w: f.w, h: f.h, landscape: f.landscape, sheets: sheets, scale: first, pages: pages };
    }

    if (mode === 'poster') {
      const s = Math.max(0.01, (+o.tile || 100) / 100);
      const ov = Math.max(0, +o.overlap || 0);
      let first = null;
      const sheets = [];
      pages.forEach(function (i) {
        const z = sizes[i], W = z.w * s, H = z.h * s;
        /* the paper's way that takes the fewest tiles (the page's way when equal) */
        let best = null;
        fixed.forEach(function (land) {
          const sh = sheetOf(land), b = printable(sh.w, sh.h, o.margins, land);
          const sx = Math.max(1, b.w - ov), sy = Math.max(1, b.h - ov);
          const cols = Math.max(1, Math.ceil((W - ov) / sx - 1e-6)), rows = Math.max(1, Math.ceil((H - ov) / sy - 1e-6));
          const n = cols * rows, mine = land === z.w > z.h;
          if (!best || n < best.n || (n === best.n && mine && !best.mine)) {
            best = { n: n, cols: cols, rows: rows, sh: sh, b: b, sx: sx, sy: sy, land: land, mine: mine };
          }
        });
        if (first === null) first = s;
        const b = best.b, sh = best.sh;
        const one = function (cell) { sheets.push({ w: sh.w, h: sh.h, landscape: best.land, cells: [cell] }); };
        if (o.largeOnly && W <= b.w + 0.5 && H <= b.h + 0.5) {
          one(place(i, z.w, z.h, 0, s, b, 0.5, 0.5, false));
          return;
        }
        /* the tiles cover a little more than the page: it sits centred on them */
        const ox = (best.cols * best.sx + ov - W) / 2, oy = (best.rows * best.sy + ov - H) / 2;
        for (let r = 0; r < best.rows; r++) {
          for (let c = 0; c < best.cols; c++) {
            one({
              page: i, rot: 0, x: b.x + ox - c * best.sx, y: b.y + oy - r * best.sy, w: W, h: H,
              clip: { x: b.x, y: b.y, w: b.w, h: b.h }, border: false, tile: [r + 1, c + 1]
            });
          }
        }
      });
      const f = sheets[0];
      return { w: f.w, h: f.h, landscape: f.landscape, sheets: sheets, scale: first, pages: pages };
    }

    if (mode === 'size') {
      /* auto: the paper the way most of the pages are */
      let land;
      if (fixed.length === 1) land = fixed[0];
      else land = pages.filter(function (i) { return sizes[i].w > sizes[i].h; }).length * 2 > pages.length;
      const sh = sheetOf(land), b = printable(sh.w, sh.h, o.margins, land);
      let first = null;
      const sheets = pages.map(function (i) {
        const z = sizes[i];
        /* auto turns a page the other way round from the paper to fit it */
        const rot = fixed.length === 2 && (z.w > z.h) !== land && Math.abs(z.w - z.h) > 1 ? 1 : 0;
        const w = rot ? z.h : z.w, h = rot ? z.w : z.h;
        const s = scaleFor(o.fit, o.scale, w, h, b.w, b.h);
        if (first === null) first = s;
        return { cells: [place(i, z.w, z.h, rot, s, b, 0.5, 0.5, false)] };
      });
      return { w: sh.w, h: sh.h, landscape: land, sheets: upright(sheets, sizes), scale: first, pages: pages };
    }

    if (mode === 'multiple') {
      const per = GRIDS[o.per] ? +o.per : 2;
      const z0 = sizes[pages[0]];
      /* the paper's way and the grid that draw the first page biggest */
      let best = null;
      fixed.forEach(function (land) {
        const sh = sheetOf(land), b = printable(sh.w, sh.h, o.margins, land);
        GRIDS[per].forEach(function (g) {
          const cw = b.w / g[0], chh = b.h / g[1];
          const rot = bestTurn(z0.w, z0.h, cw, chh);
          const s = rot ? Math.min(cw / z0.h, chh / z0.w) : Math.min(cw / z0.w, chh / z0.h);
          if (better(s, rot, best)) best = { s: s, rot: rot, land: land, sh: sh, b: b, cols: g[0], rows: g[1] };
        });
      });
      const cols = best.cols, rows = best.rows, cw = best.b.w / cols, chh = best.b.h / rows;
      const sheets = [];
      let min = Infinity;
      for (let k = 0; k < pages.length; k++) {
        const at = k % per;
        if (at === 0) sheets.push({ cells: [] });
        let col, row;
        if (o.order === 'v' || o.order === 'vr') { row = at % rows; col = Math.floor(at / rows); }
        else { col = at % cols; row = Math.floor(at / cols); }
        if (o.order === 'hr' || o.order === 'vr') col = cols - 1 - col;
        const cell = { x: best.b.x + col * cw, y: best.b.y + row * chh, w: cw, h: chh };
        const z = sizes[pages[k]];
        const rot = bestTurn(z.w, z.h, cw, chh);
        const s = rot ? Math.min(cw / z.h, chh / z.w) : Math.min(cw / z.w, chh / z.h);
        min = Math.min(min, s);
        sheets[sheets.length - 1].cells.push(place(pages[k], z.w, z.h, rot, s, cell, 0.5, 0.5, o.border));
      }
      return { w: best.sh.w, h: best.sh.h, landscape: best.land, sheets: upright(sheets, sizes), scale: min, pages: pages };
    }

    /* booklet: folded in half, so four pages to a sheet of paper, two on
       each side, in the order that reads right once the sheets are stacked
       and folded; blank pages make up the count to a multiple of four */
    const m = Math.ceil(pages.length / 4) * 4;
    const at = function (k) { return k < pages.length ? pages[k] : null; };
    const z0 = sizes[pages[0]];
    let best = null;
    fixed.forEach(function (land) {
      const sh = sheetOf(land), b = printable(sh.w, sh.h, o.margins, land);
      const hw = b.w / 2;
      const rot = bestTurn(z0.w, z0.h, hw, b.h);
      const s = rot ? Math.min(hw / z0.h, b.h / z0.w) : Math.min(hw / z0.w, b.h / z0.h);
      if (better(s, rot, best)) best = { s: s, rot: rot, land: land, sh: sh, b: b };
    });
    const b = best.b, hw = b.w / 2;
    const left = { x: b.x, y: b.y, w: hw, h: b.h }, right = { x: b.x + hw, y: b.y, w: hw, h: b.h };
    const sheets = [];
    let min = Infinity;
    for (let s = 0; s < m / 4; s++) {
      const sides = [[m - 1 - 2 * s, 2 * s], [2 * s + 1, m - 2 - 2 * s]];
      sides.forEach(function (pair, back) {
        if ((o.side === 'front' && back) || (o.side === 'back' && !back)) return;
        if (o.binding === 'right') pair = [pair[1], pair[0]];
        const cells = [];
        [left, right].forEach(function (box, j) {
          const p = at(pair[j]);
          if (p === null) return;
          const z = sizes[p];
          const rot = bestTurn(z.w, z.h, box.w, box.h);
          const sc = rot ? Math.min(box.w / z.h, box.h / z.w) : Math.min(box.w / z.w, box.h / z.h);
          min = Math.min(min, sc);
          /* each page against the fold */
          cells.push(place(p, z.w, z.h, rot, sc, box, j ? 0 : 1, 0.5, false));
        });
        sheets.push({ cells: cells });
      });
    }
    return { w: best.sh.w, h: best.sh.h, landscape: best.land, sheets: upright(sheets, sizes), scale: min, pages: pages };
  }

  (typeof window !== 'undefined' ? window : globalThis).ADDPRINT = {
    PAPERS: PAPERS, parseRange: parseRange, choosePages: choosePages, plan: plan
  };
})();
