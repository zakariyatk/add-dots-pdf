/* Add Dots PDF — Drawing Tool tab
   ------------------------------
   The properties of the tool in hand — colour, width, font, style, scale and
   the rest — used to open as a bar under the ribbon. On a desktop they live in
   a ribbon tab of their own instead, "Drawing Tool", after Convert: it appears
   and comes forward when a tool is picked up, and goes away again when the
   tool is put down. Selecting a mark to edit it works the same way: its
   properties (colour, fill, opacity, style, width, angle…) open in the same
   tab rather than in a panel floating over the page.

   Nothing about the controls changes. Core and the modules still build them
   into #modeBar and #markPop and core still shows or hides those; this file
   only moves them into the tab and follows their state. On a phone there is
   no ribbon, so both stay where they were, docked above the tools. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[toolprops] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const bar = $('modeBar');
    if (!bar) return;
    const home = { parent: bar.parentNode, next: bar.nextSibling };

    /* ---------------- the tab, last in the row ---------------- */

    const tab = document.createElement('button');
    tab.className = 'tab ctx'; tab.id = 'ribTool'; tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panTool');
    tab.textContent = 'Drawing Tool';
    tab.hidden = true;
    const after = $('ribConvert');
    if (after) after.insertAdjacentElement('afterend', tab); else $('ribTabs').appendChild(tab);

    const pan = document.createElement('div');
    pan.className = 'rpan'; pan.id = 'panTool'; pan.hidden = true;
    pan.setAttribute('role', 'tabpanel'); pan.setAttribute('aria-labelledby', 'ribTool');
    const panAfter = $('panConvert');
    if (panAfter) panAfter.insertAdjacentElement('afterend', pan); else $('ribbon').appendChild(pan);
    X.addRibbonTab('ribTool', 'panTool');

    /* Which tool is in hand, and a way back to the tab it came from so you
       can pick up a different one. */
    const badgeGrp = document.createElement('div');
    badgeGrp.className = 'grp'; badgeGrp.id = 'grpToolNow';
    const badge = document.createElement('button');
    badge.className = 'btn on'; badge.id = 'btnToolNow'; badge.type = 'button';
    badgeGrp.appendChild(badge);
    pan.appendChild(badgeGrp);
    const sep = document.createElement('span');
    sep.className = 'sep'; sep.setAttribute('aria-hidden', 'true');
    pan.appendChild(sep);

    const holder = document.createElement('div');
    holder.className = 'grp toolprops'; holder.id = 'grpToolProps';
    holder.setAttribute('role', 'group'); holder.setAttribute('aria-label', 'Tool properties');
    pan.appendChild(holder);

    /* The selected mark's properties — core's markPop — get a place of their
       own in the same tab, so editing a mark works like drawing one. */
    const pop = $('markPop');
    const popHome = pop ? { parent: pop.parentNode, next: pop.nextSibling } : null;
    const markHolder = document.createElement('div');
    markHolder.className = 'grp toolprops'; markHolder.id = 'grpMarkProps';
    markHolder.setAttribute('role', 'group'); markHolder.setAttribute('aria-label', 'Selected mark');
    pan.appendChild(markHolder);

    /* ---------------- the selected mark's properties, on the right ----------------
       Not in the Drawing Tool tab, which would take the left panel over from
       whatever tools were open there: a panel of their own in the rail on the
       right, after Layers, opened by its icon (it never opens by itself). */
    const railHost = $('railPages') ? $('railPages').parentNode : null;
    const ptab = document.createElement('button');
    ptab.className = 'btn'; ptab.id = 'tabProps'; ptab.type = 'button'; ptab.textContent = 'Properties';
    ptab.title = 'Properties of the selected object';
    ptab.hidden = true;                         /* reached from the side rail's icon (js/toolpanel.js) */
    if ($('railClose')) $('railClose').parentNode.insertBefore(ptab, $('railClose'));
    const ppanel = document.createElement('div');
    ppanel.className = 'rail-body'; ppanel.id = 'railProps'; ppanel.hidden = true;
    ppanel.innerHTML =
      '<div class="laybar"><b>Properties</b><span class="laycount" id="propsName"></span></div>' +
      '<div class="rtool" id="propsTool" hidden></div>' +
      '<p class="props-empty" id="propsEmpty">Open a document: its properties, then those of what you select or the tool you pick, show here.</p>' +
      '<div class="rprops" id="propsHost"></div>';
    if (railHost) railHost.appendChild(ppanel);
    const propsHost = ppanel.querySelector('#propsHost');
    /* the tool in hand's own options (core's #modeBar) go here too, not into
       a tab that would take the left panel over while drawing */
    const toolSec = ppanel.querySelector('#propsTool');

    function railBodies() { return railHost ? Array.prototype.slice.call(railHost.querySelectorAll(':scope > .rail-body')) : []; }
    function showProps() {
      if (!S.items.length || !railHost) return;
      X.setRail(true);
      railBodies().forEach(function (b) { b.hidden = b !== ppanel; });
      document.querySelectorAll('.rail-tabs .btn').forEach(function (t) { t.classList.toggle('on', t === ptab); });
    }
    ptab.addEventListener('click', showProps);
    document.querySelectorAll('.rail-tabs .btn:not(#railClose)').forEach(function (t) {
      if (t === ptab) return;
      t.addEventListener('click', function () { ppanel.hidden = true; ptab.classList.remove('on'); });
    });
    function railOpen() { return !!$('rail') && !$('rail').hidden; }
    function propsSpot() { return propsHost; }
    /* Three things it can show, as Illustrator's Properties panel: the tool
       in hand's options, the selection's properties, or, with neither,
       the document's (js/propspanel.js) */
    function paintProps() {
      const on = pop && !pop.hidden;
      const tool = !toolSec.hidden;
      const mark = on && pop.parentNode === propsHost;
      const docView = !tool && !mark && S.items.length > 0 && !!$('propsDoc');
      const name = tool ? (badge.dataset.label || '') : mark ? ($('mpTitle') && $('mpTitle').textContent) || '' : docView ? 'Document' : '';
      $('propsEmpty').hidden = tool || mark || docView;
      if ($('propsDoc')) $('propsDoc').hidden = !docView;
      $('propsName').textContent = name;
      ppanel.dataset.view = tool ? 'tool' : mark ? 'selection' : docView ? 'document' : 'empty';
    }
    X.paintProps = paintProps;

    let fromTab = 'ribDraw';                    /* the tab to go back to */
    let mode = null;                            /* 'tool', 'mark' or null */

    badge.addEventListener('click', function () { X.setRibbon(fromTab); });

    const CORE_BTN = { select: 'tSelect', rect: 'tRect', line: 'tLine', arrow: 'tArrow',
      text: 'tText', crop: 'tCrop', pin: 'tPin' };
    function toolButton(t) {
      const id = X.toolBtn[t] || CORE_BTN[t];
      return (id && $(id)) || document.querySelector('[data-tool-btn="' + t + '"]');
    }

    function activeTab() {
      const on = document.querySelector('#ribTabs .tab.on');
      return on ? on.id : null;
    }

    /* ---------------- where the bars live ---------------- */

    function place() {
      const phone = X.isMobile();
      if (phone) {
        if (bar.parentNode !== home.parent) home.parent.insertBefore(bar, home.next);
        if (pop && pop.parentNode !== popHome.parent) popHome.parent.insertBefore(pop, popHome.next);
      } else {
        if (bar.parentNode !== toolSec) toolSec.appendChild(bar);
        const spot = propsSpot();
        if (pop && pop.parentNode !== spot) spot.appendChild(pop);
      }
      document.body.classList.toggle('props-in-ribbon', !phone);
    }

    function selectedMark() {
      if (S.tool !== 'select' || !S.sel || !S.sel.it) return null;
      const s = S.sel.it.shapes[S.sel.i];
      return s && s.t !== 'pin' ? s : null;
    }

    function setBadge(btnEl, label, title) {
      const svg = btnEl && btnEl.querySelector('svg');
      badge.innerHTML = svg ? svg.outerHTML : '';
      badge.dataset.label = label;
      badge.title = title;
    }

    function sync() {
      place();
      const phone = X.isMobile();
      const toolLive = !phone && bar.classList.contains('show');
      /* a mark stays "being edited" while it is selected, even for the moment
         core hides its panel during a drag — so the tab does not flicker away */
      const markLive = !phone && !toolLive && pop &&
        (!pop.hidden || (mode === 'mark' && !!selectedMark()));

      /* the Drawing Tool tab is not used on a desktop any more: both kinds
         of properties are on the right (the phone keeps them docked) */
      const was = !tab.hidden;
      tab.hidden = true;
      if (was && activeTab() === 'ribTool') X.setRibbon(fromTab);
      const cur = activeTab();
      if (cur && cur !== 'ribTool') fromTab = cur;

      toolSec.hidden = !toolLive;
      if (toolLive) {
        const b = toolButton(S.tool);
        const label = (b && (b.dataset.label || b.getAttribute('aria-label'))) || 'Tool';
        setBadge(b, label, label);
      }
      const now = toolLive ? 'tool' : markLive ? 'mark' : null;
      /* nothing opens the rail by itself: the Properties icon does, and the
         panel shows whatever is in hand then */
      mode = now;
      place();
      paintProps();
    }

    /* No Done, Cancel or Delete bar beside the work: as in Acrobat and
       Foxit, what a tool puts down is kept as it is put down, and editing
       ends by itself when another tool is picked, the page or the space
       round it is clicked, or Esc is pressed (core setTool, closeEditor). */

    X.on('tool', sync);
    X.on('pages', function () { setTimeout(sync, 0); });
    /* core shows and hides the mark panel as marks are selected; follow it */
    if (pop && window.MutationObserver) {
      new MutationObserver(sync)
        .observe(pop, { attributes: true, attributeFilter: ['hidden'] });
    }
    /* the name over the Properties panel follows the mark picked out */
    if ($('mpTitle') && window.MutationObserver) {
      new MutationObserver(paintProps).observe($('mpTitle'), { childList: true, characterData: true, subtree: true });
    }
    /* and a click on empty page, or Delete, clears the selection */
    document.addEventListener('pointerup', function () {
      if (mode === 'mark') setTimeout(sync, 0);
    });

    /* opening Layers or Properties on the right moves the panel to it */
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.rail-tabs, #sideRail')) setTimeout(sync, 0);
    });

    let resizeTick = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTick);
      resizeTick = setTimeout(sync, 120);
    });

    sync();
  });
})();
