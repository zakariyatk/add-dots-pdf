/* Add Dots PDF — Window layout
   -----------------------------
   Several open documents tiled at once, as SwifDoo's View > Windows has it:
   1 View, 2 Vertical, 2 Horizontal, 3 Views (one tall, two stacked) or
   4 Views (2x2), each split draggable between panes. The Windows app only —
   on the website the browser's own tabs hold documents side by side instead
   (js/tabs.js).

   Each tab already keeps a full copy of the app, ribbon and all: the app
   itself for tab 0, a frame of its own (index.html?tab=N) for every other
   one (js/tabs.js). A pane never holds content of its own — it is a
   placeholder in #winGrid's CSS grid that a tab's own element (the app, or
   a frame) is sized and moved on top of, kept in step by a ResizeObserver.
   So every pane keeps the full toolbar and tools of the document it shows,
   exactly as a tab does on its own; nothing here reads or draws a page.

   A pane short of a document invites one: picking a file there opens it as
   a new tab (js/tabs.js), then the grid is rebuilt so it takes that pane. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[winlayout] core bridge missing'); return; }

  X.on('ready', function () {
    const $ = X.$;
    /* tests of this in a browser set window.ADDDOTS_TABS, as js/tabs.js does */
    if (!window.__TAURI__ && !window.ADDDOTS_TABS) return;

    const grp = $('grpWindows'), btn = $('btnWinLayout'), lbl = $('winLbl'), pop = $('winPop'), grid = $('winGrid');
    if (!grp || !btn || !lbl || !pop || !grid) return;

    const NAMES = { '1': 'Windows', '2v': '2 Vertical', '2h': '2 Horizontal', '3': '3 Views', '4': '4 Views' };
    const COUNT = { '1': 1, '2v': 2, '2h': 2, '3': 3, '4': 4 };
    const GUTTER = 6; /* px, the draggable divider's thickness */
    const MIN_PX = 140; /* a pane never drags smaller than this */

    grp.hidden = false;
    X.registerPop('winPop', 'btnWinLayout');
    btn.addEventListener('click', function () { X.togglePop('winPop', btn); });

    let layout = '1';
    let panes = [];       /* { el, ro } for each pane while split */
    let lastActive = 0;   /* the tab to come back to on "1 View" */
    let colPct = 50, rowPct = 50; /* the split ratio, reset whenever a layout is (re)chosen */
    let drag = null;

    /* a file picked in an empty pane: a new tab, then the grid picks it up */
    const fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = 'application/pdf,.pdf'; fileIn.multiple = true; fileIn.hidden = true;
    document.body.appendChild(fileIn);
    fileIn.addEventListener('change', function () {
      const files = Array.prototype.slice.call(fileIn.files);
      fileIn.value = '';
      if (files.length && X.tabs) { X.tabs.openFiles(files); apply(layout); }
    });

    /* keeps `target` (the app itself, or a tab's frame) sized to `cell`,
       the pane it has been given, as the window or the layout changes */
    function track(target, cell) {
      const isFrame = target.tagName === 'IFRAME';
      const sync = function () {
        const r = cell.getBoundingClientRect();
        target.style.position = 'fixed';
        target.style.left = r.left + 'px';
        target.style.top = r.top + 'px';
        target.style.right = 'auto';
        target.style.bottom = 'auto';
        target.style.width = r.width + 'px';
        target.style.height = r.height + 'px';
        target.style.margin = '0';
        /* the page layout inside only re-fits on its own window's `resize`
           (core.js onResize): an iframe's window gets that for free when its
           box changes size, but tab 0 shares this window — nothing ever
           tells it its box just shrank, so a document with more than one
           page stayed sized for the full window and ran off the pane.
           Sending it to both kinds alike is cheap and never wrong. */
        const w = isFrame ? target.contentWindow : window;
        if (w) w.dispatchEvent(new Event('resize'));
      };
      sync();
      const ro = new ResizeObserver(sync);
      ro.observe(cell);
      return ro;
    }

    function openHere(cell) {
      cell.innerHTML = '<div class="winopen"><button type="button" class="pick">Select files</button><p>Open a PDF here</p></div>';
      cell.querySelector('.pick').addEventListener('click', function () { fileIn.click(); });
    }

    function clearPanes() {
      panes.forEach(function (p) { if (p.ro) p.ro.disconnect(); });
      panes = [];
      grid.innerHTML = '';
      const RESET = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'zIndex'];
      const app = document.querySelector('.app');
      RESET.forEach(function (k) { app.style[k] = ''; });
      (X.tabs ? X.tabs.list() : []).forEach(function (t) {
        const f = X.tabs.frame(t.id);
        if (f) RESET.forEach(function (k) { f.style[k] = ''; });
      });
    }

    /* the column and/or row track list for the current mode and split
       ratio — a plain '1fr' where that axis is not split at all */
    function template(axis) {
      const pct = axis === 'col' ? colPct : rowPct;
      const split = axis === 'col' ? (layout === '2v' || layout === '3' || layout === '4')
                                    : (layout === '2h' || layout === '3' || layout === '4');
      if (!split) return '1fr';
      return 'calc(' + pct + '% - ' + (GUTTER / 2) + 'px) ' + GUTTER + 'px calc(' + (100 - pct) + '% - ' + (GUTTER / 2) + 'px)';
    }
    function applyGridTemplate() {
      grid.style.gridTemplateColumns = template('col');
      grid.style.gridTemplateRows = template('row');
    }

    function endDrag() {
      if (!drag) return;
      drag.el.classList.remove('dragging');
      drag.el.removeEventListener('pointermove', onDragMove);
      drag.el.removeEventListener('pointerup', endDrag);
      drag.el.removeEventListener('pointercancel', endDrag);
      if (drag.raf) cancelAnimationFrame(drag.raf);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      drag = null;
    }
    function onDragMove(e) {
      if (!drag) return;
      drag.pending = e;
      if (drag.raf) return;
      drag.raf = requestAnimationFrame(function () {
        drag.raf = 0;
        const e2 = drag && drag.pending; if (!e2 || !drag) return;
        const r = drag.rect, size = drag.axis === 'col' ? r.width : r.height;
        const minPct = Math.max(5, Math.min(40, (MIN_PX / size) * 100));
        const raw = drag.axis === 'col' ? ((e2.clientX - r.left) / r.width) * 100 : ((e2.clientY - r.top) / r.height) * 100;
        const pct = Math.max(minPct, Math.min(100 - minPct, raw));
        if (drag.axis === 'col') colPct = pct; else rowPct = pct;
        applyGridTemplate();
      });
    }
    function beginDrag(axis, e) {
      e.preventDefault();
      drag = { axis: axis, rect: grid.getBoundingClientRect(), raf: 0, el: e.currentTarget };
      document.body.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      drag.el.classList.add('dragging');
      drag.el.setPointerCapture(e.pointerId);
      drag.el.addEventListener('pointermove', onDragMove);
      drag.el.addEventListener('pointerup', endDrag);
      drag.el.addEventListener('pointercancel', endDrag);
    }
    function makeGutter(axis) {
      const g = document.createElement('div');
      g.className = 'wingut ' + (axis === 'col' ? 'wingut-v' : 'wingut-h');
      g.style.gridColumn = axis === 'col' ? '2' : '1';
      g.style.gridRow = axis === 'col' ? '1' : '2';
      g.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        beginDrag(axis, e);
      });
      return g;
    }

    function makePane(col, row, rowSpan) {
      const cell = document.createElement('div');
      cell.className = 'winpane';
      cell.style.gridColumn = String(col);
      cell.style.gridRow = rowSpan ? (row + ' / ' + (row + rowSpan)) : String(row);
      grid.appendChild(cell);
      return cell;
    }
    function fillPane(cell, tab) {
      if (!tab) { openHere(cell); panes.push({ el: cell, ro: null }); return; }
      const target = tab.id === 0 ? document.querySelector('.app') : X.tabs.frame(tab.id);
      if (!target) { openHere(cell); panes.push({ el: cell, ro: null }); return; }
      if (tab.id !== 0) target.hidden = false;
      target.style.zIndex = '56';
      panes.push({ el: cell, ro: track(target, cell) });
    }

    /* mode: '1' | '2v' | '2h' | '3' | '4' — builds the pane cells and, for
       every split axis, one draggable gutter between them. Track layout:
       '2v'/'2h' split one axis (3 tracks: pane, gutter, pane); '3' and '4'
       split both. '3' is one tall pane spanning every row track beside a
       column of two stacked panes; '4' is a 2x2 grid, its row gutter drawn
       as a single bar the full width so it never crosses the column one. */
    function buildCells(mode) {
      if (mode === '2v') return [makePane(1, 1), makePane(3, 1)];
      if (mode === '2h') return [makePane(1, 1), makePane(1, 3)];
      if (mode === '3') return [makePane(1, 1, 3), makePane(3, 1), makePane(3, 3)];
      return [makePane(1, 1), makePane(3, 1), makePane(1, 3), makePane(3, 3)]; /* '4' */
    }
    function buildGutters(mode) {
      if (mode === '2v') { grid.appendChild(makeGutter('col')); return; }
      if (mode === '2h') { grid.appendChild(makeGutter('row')); return; }
      if (mode === '3') {
        const vg = makeGutter('col'); vg.style.gridRow = '1 / 4'; grid.appendChild(vg);
        const hg = makeGutter('row'); hg.style.gridColumn = '3'; grid.appendChild(hg);
        return;
      }
      /* '4': two short vertical segments (top row, bottom row) so the one
         horizontal bar can run uninterrupted across the middle */
      const vgTop = makeGutter('col'); vgTop.style.gridRow = '1'; grid.appendChild(vgTop);
      const vgBot = makeGutter('col'); vgBot.style.gridRow = '3'; grid.appendChild(vgBot);
      const hg = makeGutter('row'); hg.style.gridColumn = '1 / 4'; grid.appendChild(hg);
    }

    function apply(mode) {
      layout = mode;
      lbl.textContent = NAMES[mode];
      Array.prototype.forEach.call(pop.querySelectorAll('.winopt'), function (b) {
        b.classList.toggle('on', b.dataset.layout === mode);
      });
      X.closePops();

      const open = X.tabs ? X.tabs.list() : [];
      const now = open.filter(function (t) { return t.active; })[0];
      if (now) lastActive = now.id;

      endDrag();
      clearPanes();

      if (mode === '1') {
        grid.hidden = true;
        document.body.classList.remove('winsplit');
        if (X.tabs) {
          const still = open.some(function (t) { return t.id === lastActive; });
          X.tabs.select(still ? lastActive : (open[0] ? open[0].id : 0));
        }
        return;
      }

      colPct = 50; rowPct = 50;
      grid.dataset.layout = mode;
      grid.hidden = false;
      document.body.classList.add('winsplit');
      applyGridTemplate();
      /* a frame can only be read off the pool while it is not hidden */
      const frames = $('docFrames'); if (frames) frames.hidden = false;

      const cells = buildCells(mode);
      buildGutters(mode);
      const n = COUNT[mode];
      for (let i = 0; i < n; i++) fillPane(cells[i], open[i]);
      /* a tab past the panes stays out of the way, as if not the one in view */
      open.slice(n).forEach(function (t) { const f = X.tabs.frame(t.id); if (f) f.hidden = true; });
    }

    pop.addEventListener('click', function (e) {
      const b = e.target.closest('.winopt');
      if (b) apply(b.dataset.layout);
    });

    /* a document opened or closed elsewhere is picked up the next time a
       layout is (re)chosen — picking a file in an empty pane does that
       itself; the tab strip is hidden while split (below) so it cannot
       fight the grid for which frames are shown */
  });
})();
