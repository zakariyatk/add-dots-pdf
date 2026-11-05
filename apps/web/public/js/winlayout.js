/* Add Dots PDF — Window layout
   -----------------------------
   Several open documents tiled at once, as SwifDoo's View > Windows has it:
   1 View, 2 Vertical, 2 Horizontal, 3 Views (one tall, two stacked) or
   4 Views (2x2). The Windows app only — on the website the browser's own
   tabs hold documents side by side instead (js/tabs.js).

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

    grp.hidden = false;
    X.registerPop('winPop', 'btnWinLayout');
    btn.addEventListener('click', function () { X.togglePop('winPop', btn); });

    let layout = '1';
    let panes = [];       /* { el, ro } for each pane while split */
    let lastActive = 0;   /* the tab to come back to on "1 View" */

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
      panes.forEach(function (p) { if (p.ro) p.ro.disconnect(); p.el.remove(); });
      panes = [];
      const RESET = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'zIndex'];
      const app = document.querySelector('.app');
      RESET.forEach(function (k) { app.style[k] = ''; });
      (X.tabs ? X.tabs.list() : []).forEach(function (t) {
        const f = X.tabs.frame(t.id);
        if (f) RESET.forEach(function (k) { f.style[k] = ''; });
      });
    }

    /* mode: '1' | '2v' | '2h' | '3' | '4' */
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

      grid.dataset.layout = mode;
      grid.hidden = false;
      document.body.classList.add('winsplit');
      /* a frame can only be read off the pool while it is not hidden */
      const frames = $('docFrames'); if (frames) frames.hidden = false;

      const n = COUNT[mode];
      for (let i = 0; i < n; i++) {
        const cell = document.createElement('div');
        cell.className = 'winpane';
        grid.appendChild(cell);
        const t = open[i];
        if (!t) { openHere(cell); panes.push({ el: cell, ro: null }); continue; }
        const target = t.id === 0 ? document.querySelector('.app') : X.tabs.frame(t.id);
        if (!target) { openHere(cell); panes.push({ el: cell, ro: null }); continue; }
        if (t.id !== 0) target.hidden = false;
        target.style.zIndex = '56';
        panes.push({ el: cell, ro: track(target, cell) });
      }
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
