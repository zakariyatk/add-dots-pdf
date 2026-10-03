/* ADD DOTS PDF — Drawing Tool tab
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
        if (bar.parentNode !== holder) holder.appendChild(bar);
        if (pop && pop.parentNode !== markHolder) markHolder.appendChild(pop);
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

      if (!toolLive && !markLive) {
        const was = !tab.hidden;
        tab.hidden = true; mode = null;
        if (was && activeTab() === 'ribTool') X.setRibbon(fromTab);
        return;
      }

      holder.hidden = !toolLive;
      markHolder.hidden = !markLive;
      if (toolLive) {
        mode = 'tool';
        const b = toolButton(S.tool);
        const label = (b && (b.dataset.label || b.getAttribute('aria-label'))) || 'Tool';
        setBadge(b, label, label + ' — back to its tab to pick another tool');
        tab.textContent = 'Drawing Tool';
      } else {
        mode = 'mark';
        const s = selectedMark();
        const name = ($('mpTitle') && $('mpTitle').textContent) || 'Mark';
        setBadge(s ? toolButton(s.t) : null, name, 'Editing this ' + name.toLowerCase() +
          ' — back to the tab you were on');
        tab.textContent = 'Drawing Tool';
      }
      const cur = activeTab();
      if (cur && cur !== 'ribTool') fromTab = cur;
      tab.hidden = false;
      if (cur !== 'ribTool') X.setRibbon('ribTool');
    }

    /* ---------------- Done / Cancel beside the work ----------------
       The Done at the end of the ribbon was easy to miss, and so was the fact
       that a tool was in hand at all. A small bar comes up instead: first
       under the tool's name in the ribbon, then beside whatever you draw.
       Done keeps it all; Cancel takes back everything drawn since the tool
       was picked up and puts the tool down. */
    const chip = document.createElement('div');
    chip.className = 'toolchip'; chip.id = 'toolChip'; chip.hidden = true;
    chip.setAttribute('role', 'toolbar'); chip.setAttribute('aria-label', 'Tool in hand');
    chip.innerHTML = '<span class="tc-ico" aria-hidden="true"></span><b class="tc-name"></b>' +
      '<button type="button" class="btn tc-cancel" id="toolCancel" title="Take back what this tool drew, and put it down (Esc)">Cancel</button>' +
      '<button type="button" class="btn primary tc-done" id="toolDone" title="Keep it and put the tool down">Done</button>';
    document.body.appendChild(chip);
    let chipTool = null, undoMark = null;     /* the last undo step before the tool */

    function chipLive() {
      return !X.isMobile() && bar.classList.contains('show') && S.tool !== 'select' &&
        !(X.tools[S.tool] && X.tools[S.tool].bare);
    }
    function placeChip(x, y) {
      chip.hidden = false;
      const w = chip.offsetWidth, h = chip.offsetHeight;
      const sr = $('stage').getBoundingClientRect();
      chip.style.left = Math.max(sr.left + 8, Math.min(sr.right - w - 8, x)) + 'px';
      chip.style.top = Math.max(sr.top + 8, Math.min(sr.bottom - h - 8, y)) + 'px';
    }
    function chipUnderTool() {
      const r = badge.getBoundingClientRect();
      placeChip(r.left, Math.max(r.bottom, $('stage').getBoundingClientRect().top) + 10);
    }
    function syncChip() {
      if (!chipLive()) { chip.hidden = true; chipTool = null; return; }
      if (chipTool === S.tool) return;
      chipTool = S.tool;
      undoMark = S.undo[S.undo.length - 1] || null;
      const b = toolButton(S.tool), svg = b && b.querySelector('svg');
      chip.querySelector('.tc-ico').innerHTML = svg ? svg.outerHTML : '';
      chip.querySelector('.tc-name').textContent =
        (b && (b.dataset.label || b.getAttribute('aria-label'))) || 'Tool';
      chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop');
      requestAnimationFrame(chipUnderTool);
    }
    /* after each stroke, click or box on a page, the bar comes to sit beside it */
    $('stage').addEventListener('pointerup', function (e) {
      if (chip.hidden || e.target.closest('.toolchip')) return;
      setTimeout(function () {
        if (!chip.hidden) placeChip(e.clientX + 18, e.clientY + 18);
      }, 0);
    });
    $('toolDone').addEventListener('click', function () { X.setTool('select'); });
    $('toolCancel').addEventListener('click', async function () {
      /* text being typed: Esc throws it away, as it always has */
      const ta = document.querySelector('.texted textarea');
      if (S.editing && ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      /* back to the step before the tool; if that has dropped off the end of
         the undo list, every step left there is this tool's */
      let n = 0;
      while (S.undo.length && S.undo[S.undo.length - 1] !== undoMark && n++ < 100) await X.undo();
      X.setTool('select');
    });
    window.addEventListener('resize', function () { if (!chip.hidden) chipUnderTool(); });

    X.on('tool', function () { sync(); syncChip(); });
    /* core shows and hides the mark panel as marks are selected; follow it */
    if (pop && window.MutationObserver) {
      new MutationObserver(function () { sync(); })
        .observe(pop, { attributes: true, attributeFilter: ['hidden'] });
    }
    /* and a click on empty page, or Delete, clears the selection */
    document.addEventListener('pointerup', function () {
      if (mode === 'mark') setTimeout(sync, 0);
    });

    let resizeTick = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTick);
      resizeTick = setTimeout(sync, 120);
    });

    sync();
  });
})();
