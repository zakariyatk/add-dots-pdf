/* ADD DOTS PDF — Toolbar arrangement
   ----------------------------------
   Loads last, once every module has registered its buttons, and decides where
   they all live.

   Two jobs. It splits the tools across the Edit and Draw tabs — geometry on
   Draw, text and review marks on Edit — because seventeen in one row is too
   many to scan. And it keeps the phone working, where there is no ribbon at
   all: both tool groups go into the bottom dock, which scrolls rather than
   dividing the width until each button is twenty pixels wide.

   It also carries the Form, Document and Convert panels into the phone's more-sheet.
   Their ribbon tabs are hidden at that width, so without this they would be
   simply unreachable there. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[toolbar] core bridge missing'); return; }

  X.on('ready', function () {
    const $ = X.$;

    /* ---------------- the Draw tab ---------------- */

    /* Everything that draws a shape on the page. Ordered so the pair you
       reach for most sit first, and grouped by what they are for. */
    const DRAW_GROUPS = [
      { ids: ['tDrawPan', 'tDrawSelect'] },
      { ids: ['tRect', 'tEllipse', 'tLine', 'tArrow'] },
      { ids: ['tArc', 'tCloud'] },
      { ids: ['tText'] },
      { ids: ['tDim', 'tDimC', 'tDimR', 'tDimD', 'tDimA'] }
    ];

    /* What is left on Edit: review marks, and the page tools. Text moved to
       Draw — it puts a shape on the page like everything else there. */
    const EDIT_GROUPS = [
      { ids: ['tEditPan', 'tSelect'] },
      { ids: ['tHighlight', 'tUnderline', 'tStrike'] },
      { ids: ['tInk', 'tNote', 'tStamp'] },
      { ids: ['tCrop', 'tPin'] }
    ];

    /* Build the tab and its panel, sitting immediately after Edit. */
    const tab = document.createElement('button');
    tab.className = 'tab'; tab.id = 'ribDraw'; tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panDraw');
    tab.textContent = 'Draw';
    $('ribEdit').insertAdjacentElement('afterend', tab);

    const panel = document.createElement('div');
    panel.className = 'rpan'; panel.id = 'panDraw'; panel.hidden = true;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'ribDraw');
    $('panEdit').insertAdjacentElement('afterend', panel);

    const drawTools = document.createElement('div');
    drawTools.className = 'grp'; drawTools.id = 'grpDraw';
    drawTools.setAttribute('role', 'group');
    drawTools.setAttribute('aria-label', 'Drawing tools');
    panel.appendChild(drawTools);

    X.addRibbonTab('ribDraw', 'panDraw');

    /* ---------------- Pan and Select, first on every tab ---------------- */

    /* The two tools you move between most. Each tab gets its own copy at the
       front, so you never cross to another tab just to put a tool down or
       drag the page about. Copies carry data-tool-btn, so core lights them
       together with the originals (tPan on View, tSelect on Edit). */
    const PAN_SVG =
      '<svg viewBox="0 0 24 24">' +
      '<path d="M9 11V4.6a1.6 1.6 0 0 1 3.2 0V10"/>' +
      '<path d="M12.2 10V3.8a1.6 1.6 0 0 1 3.2 0V10"/>' +
      '<path d="M15.4 10.4V5.6a1.6 1.6 0 0 1 3.2 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.5-2l-3-3.4a1.7 1.7 0 0 1 2.4-2.4L9 15.4V11"/>' +
      '</svg>';
    const SEL_SVG = '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.4L10 19z"/></svg>';

    function toolCopy(id, tool) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = id; b.type = 'button';
      b.dataset.toolBtn = tool;
      if (tool === 'pan') {
        b.title = 'Pan — drag the page anywhere (H, or hold Space)';
        b.setAttribute('aria-label', 'Pan tool');
        b.dataset.label = 'Pan';
        b.innerHTML = PAN_SVG;
        b.addEventListener('click', function () { X.toggleTool('pan'); });
      } else {
        b.title = 'Select (V)';
        b.setAttribute('aria-label', 'Select tool');
        b.dataset.label = 'Select';
        b.innerHTML = SEL_SVG;
        b.addEventListener('click', function () { X.setTool('select'); });
      }
      b.classList.toggle('on', X.S.tool === tool);
      return b;
    }

    /* A leading group on a tab that has no tool row of its own. */
    function leadTools(panId, key, pan, sel) {
      const host = $(panId);
      if (!host || $('nav' + key)) return;
      const g = document.createElement('div');
      g.className = 'grp navtools'; g.id = 'nav' + key;
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', 'Pan and select');
      g.appendChild(pan || toolCopy('t' + key + 'Pan', 'pan'));
      g.appendChild(sel || toolCopy('t' + key + 'Select', 'select'));
      const sep = document.createElement('span');
      sep.className = 'sep'; sep.setAttribute('aria-hidden', 'true');
      host.insertBefore(sep, host.firstChild);
      host.insertBefore(g, sep);
    }

    /* Edit and Draw already open with a tool row, so the pair joins it. */
    $('grpTools').insertBefore(toolCopy('tEditPan', 'pan'), $('tSelect'));
    drawTools.appendChild(toolCopy('tDrawPan', 'pan'));
    drawTools.appendChild(toolCopy('tDrawSelect', 'select'));

    /* ---------------- moving the buttons ---------------- */

    function fill(host, groups) {
      Array.prototype.slice.call(host.querySelectorAll('.tsep'))
        .forEach(function (el) { el.remove(); });

      let placed = 0;
      groups.forEach(function (g) {
        const found = g.ids.map(function (id) { return $(id); }).filter(Boolean);
        if (!found.length) return;
        if (placed) {
          const s = document.createElement('span');
          s.className = 'tsep';
          s.setAttribute('aria-hidden', 'true');
          host.appendChild(s);
        }
        found.forEach(function (el) { host.appendChild(el); placed++; });
      });
      return placed;
    }

    function arrange() {
      fill(drawTools, DRAW_GROUPS);
      fill($('grpTools'), EDIT_GROUPS);

      /* Anything a module adds later that neither list knows about stays on
         Edit rather than disappearing. */
      const known = {};
      DRAW_GROUPS.concat(EDIT_GROUPS).forEach(function (g) {
        g.ids.forEach(function (id) { known[id] = 1; });
      });
      Array.prototype.slice.call($('grpTools').children).forEach(function (el) {
        if (el.classList.contains('btn') && !known[el.id]) $('grpTools').appendChild(el);
      });
      countTools();
    }

    /* ---------------- the phone dock ---------------- */

    /* No ribbon at that width, so both groups live in the dock together. */
    X.dockGroup(drawTools);

    function countTools() {
      const n = $('grpTools').querySelectorAll('.btn').length +
                drawTools.querySelectorAll('.btn').length;
      document.body.dataset.toolCount = String(n);
      $('dock').dataset.crowded = n > 6 ? 'yes' : 'no';
    }

    /* Keep the live tool in view when the dock is scrolled, or picking one
       from the sheet leaves it selected but off screen. */
    X.on('tool', function () {
      const dock = $('dock');
      if (!dock || getComputedStyle(dock).display === 'none') return;
      const on = dock.querySelector('.btn.on');
      if (on && on.scrollIntoView) {
        on.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      }
    });

    /* ---------------- reach the phone sheet ---------------- */

    function adoptPanel(panId) {
      const pan = $(panId);
      if (!pan) return;
      Array.prototype.slice.call(pan.querySelectorAll(':scope > .grp'))
        .forEach(function (g) { X.mobileSheet(g); });
    }
    adoptPanel('panInsert');
    adoptPanel('panForm');
    adoptPanel('panDoc');
    adoptPanel('panBooks');
    adoptPanel('panConvert');

    /* After the phone adoption on purpose: these copies stay with the ribbon,
       since on a phone the dock already opens with Pan and Select. The real
       Pan button moves off the zoom row to head View. */
    leadTools('panView', 'View', $('tPan'), null);
    leadTools('panInsert', 'Insert');
    leadTools('panPage', 'Page');
    leadTools('panForm', 'Form');
    leadTools('panDoc', 'Doc');
    leadTools('panBooks', 'Books');
    leadTools('panConvert', 'Convert');
    leadTools('panTool', 'Tool');

    /* ---------------- go ---------------- */

    /* Modules register on 'ready' in script order and this file is last, so
       everything exists by now. The frame after is for anything that defers. */
    arrange();
    requestAnimationFrame(arrange);

    /* ---------------- sharp icons ----------------
       A one-pixel line drawn between two screen pixels comes out as two grey
       half-pixels — soft, the opposite of how WPS or Office look. So the line
       is exactly one device pixel wide, and each ribbon icon is nudged by the
       fraction of a pixel that puts its straight lines on the pixel grid.
       Icons are 24px on a 24-unit grid, so one unit is one CSS pixel. */
    function snapIcons() {
      const dpr = window.devicePixelRatio || 1;
      /* one device pixel, two on high-density screens so it is not hairline */
      const devW = Math.max(1, Math.round(dpr * 1.1));
      document.documentElement.style.setProperty('--ico-stroke', (devW / dpr).toFixed(3));
      /* an odd number of device pixels is crisp centred on a pixel's middle,
         an even number on a pixel's edge */
      const want = devW % 2 ? 0.5 : 0;
      const svgs = document.querySelectorAll('#ribbon .rpan:not([hidden]) .btn > svg');
      Array.prototype.forEach.call(svgs, function (svg) { svg.style.transform = ''; });
      Array.prototype.forEach.call(svgs, function (svg) {
        const r = svg.getBoundingClientRect();
        if (!r.width) return;
        function nudge(v) {
          const d = v * dpr;                                /* in device pixels */
          let n = Math.floor(d) + want - d;
          if (n < -0.5) n += 1;
          if (n > 0.5) n -= 1;
          return n / dpr;
        }
        const dx = nudge(r.left), dy = nudge(r.top);
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          svg.style.transform = 'translate(' + dx.toFixed(3) + 'px,' + dy.toFixed(3) + 'px)';
        }
      });
    }
    let snapTick = 0;
    function snapSoon() {
      if (snapTick) return;
      /* a timer, not a frame: it must also run for a tab opened in the background */
      snapTick = setTimeout(function () { snapTick = 0; snapIcons(); }, 16);
    }
    /* anything that can move an icon: a tab change, a label changing width,
       the window, the fonts arriving — but not the nudges themselves */
    if (window.MutationObserver) {
      new MutationObserver(snapSoon).observe($('ribbon'), {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['hidden', 'class', 'data-label', 'disabled']
      });
    }
    window.addEventListener('resize', snapSoon);
    $('ribbon').addEventListener('scroll', snapSoon, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(snapSoon);
    X.on('tool', snapSoon);
    snapSoon();

    X.toolbar = { arrange: arrange, drawGroups: DRAW_GROUPS, editGroups: EDIT_GROUPS, snapIcons: snapIcons };
  });
})();
