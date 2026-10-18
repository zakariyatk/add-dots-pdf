/* ADD DOTS PDF — Tools as Acrobat lays them out
   ---------------------------------------------
   On a wide screen the ribbon becomes what Acrobat has: a row of tabs (All
   tools, View, Edit, Draw, Convert, Sign), the tools of the tab in a panel
   down the left, read as a list with a heading over each group, the tools
   reached for most beside the page, the options of the tool in hand (or of
   the mark picked up) at the top of that panel, as Acrobat's Format text,
   and the side panels, page and zoom in a rail down the right.

   Nothing is rebuilt. The buttons are the ribbon's own, with their handlers
   and shortcuts; the panels move and several show at once (Edit is the Edit,
   Insert, Page and Document panels together). Core still switches its panels
   (setRibbon), and this file follows it: whatever core shows, the tab that
   holds that panel lights and its companions show with it.

   On a narrow screen (and on a phone) everything goes back where it was and
   the ribbon is the ribbon again. css/toolpanel.css has the look. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[toolpanel] core bridge missing'); return; }

  X.on('ready', function () {
    const $ = X.$;
    const ribbon = $('ribbon'), tabs = $('ribTabs'), main = document.querySelector('.main');
    if (!ribbon || !tabs || !main) return;
    const WIDE = window.matchMedia('(min-width:901px)');

    /* ---------------- the tabs and what each one shows ---------------- */

    const GROUPS = [
      { key: 'all', tab: 'ribAll', name: 'All tools', pans: ['panAll'] },
      { key: 'view', tab: 'ribView', name: 'View', pans: ['panView', 'panBooks'],
        what: 'Zoom, find, read aloud, bookmarks, translate' },
      { key: 'edit', tab: 'ribEdit', name: 'Edit', pans: ['panPage', 'panInsert', 'panEdit', 'panDoc'],
        what: 'Pages, text, images, links, mark-up, watermark, redact' },
      { key: 'draw', tab: 'ribDraw', name: 'Draw', pans: ['panDraw'],
        what: 'Boxes, lines, arcs, clouds and dimensions' },
      { key: 'convert', tab: 'ribConvert', name: 'Convert', pans: ['panConvert'],
        what: 'PDF to Word, Excel, PowerPoint, pictures, text or CAD' },
      { key: 'sign', tab: 'ribForm', name: 'Sign', pans: ['panForm'],
        what: 'Fill in forms, sign and add initials' }
    ];
    const byTab = {}, byPan = {};
    GROUPS.forEach(function (g) {
      byTab[g.tab] = g;
      g.pans.forEach(function (p) { byPan[p] = g; });
    });

    /* Sign: the Form tab, named as Acrobat names it */
    const formTab = $('ribForm');
    const formName = formTab ? formTab.textContent : '';

    /* All tools, first in the row */
    const allTab = document.createElement('button');
    allTab.className = 'tab'; allTab.id = 'ribAll'; allTab.type = 'button';
    allTab.setAttribute('role', 'tab');
    allTab.setAttribute('aria-selected', 'false');
    allTab.setAttribute('aria-controls', 'panAll');
    allTab.textContent = 'All tools';
    allTab.hidden = true;
    tabs.insertBefore(allTab, tabs.firstChild);

    const ic = function (p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; };
    const ALL_ICON = {
      view: ic('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
      edit: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>'),
      draw: ic('<path d="M3 21l3-9 9-9 6 6-9 9z"/><line x1="3" y1="21" x2="8" y2="16"/>'),
      convert: ic('<polyline points="16 3 20 7 16 11"/><path d="M4 11V9a2 2 0 0 1 2-2h14"/><polyline points="8 21 4 17 8 13"/><path d="M20 13v2a2 2 0 0 1-2 2H4"/>'),
      sign: ic('<path d="M3 17c3 0 4-8 7-8s1 8 4 8 3-4 7-4"/><line x1="3" y1="21" x2="21" y2="21"/>')
    };
    const panAll = document.createElement('div');
    panAll.className = 'rpan'; panAll.id = 'panAll'; panAll.hidden = true;
    panAll.setAttribute('role', 'tabpanel');
    panAll.setAttribute('aria-labelledby', 'ribAll');
    const allGrp = document.createElement('div');
    allGrp.className = 'grp'; allGrp.dataset.head = 'Tools by job';
    GROUPS.slice(1).forEach(function (g) {
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button'; b.id = 'all' + g.key[0].toUpperCase() + g.key.slice(1);
      b.dataset.label = g.name;
      b.title = g.name + ': ' + g.what;
      b.innerHTML = ALL_ICON[g.key];
      b.addEventListener('click', function () { const t = $(g.tab); if (t) t.click(); });
      allGrp.appendChild(b);
    });
    panAll.appendChild(allGrp);
    ribbon.appendChild(panAll);

    /* the panel's title, and a cross that folds it away */
    const head = document.createElement('div');
    head.className = 'acro-head'; head.hidden = true;
    head.innerHTML = '<span id="acroTitle"></span>' +
      '<button type="button" class="btn" id="acroClose" title="Hide the tools panel" aria-label="Hide the tools panel">' +
      ic('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>') + '</button>';
    ribbon.insertBefore(head, ribbon.firstChild);
    $('acroClose').addEventListener('click', function () { setClosed(true); });

    /* a heading over each group of tools, read where the group starts */
    const HEADS = [
      ['grpZoom', 'Page view'], ['grpFind', 'Find'], ['grpTr', 'Read'],
      ['btnReadMode', 'Read aloud'], ['btnBookmark', 'Bookmarks'],
      ['grpPage', 'Pages'], ['grpCombine', 'Combine and split'], ['grpImages', 'Export pages'],
      ['grpInsMedia', 'Add content'],
      ['grpTools', 'Mark up'], ['grpEditObj', 'Edit objects'],
      ['btnWatermark', 'Document'], ['btnRedact', 'Protect'], ['btnPrint', 'Export'], ['btnCompress', 'Optimize'],
      ['grpDraw', 'Draw and measure'],
      ['grpConvert', 'PDF to'],
      ['btnFields', 'Fill'], ['btnSign', 'Sign'], ['btnFlatten', 'Finish']
    ];
    HEADS.forEach(function (h) {
      const el = $(h[0]);
      const grp = el && (el.classList.contains('grp') ? el : el.closest('.grp'));
      if (grp) grp.dataset.head = h[1];
    });

    /* ---------------- the quick tools, beside the page ---------------- */

    const rail = document.createElement('nav');
    rail.className = 'qrail'; rail.id = 'quickRail';
    rail.setAttribute('aria-label', 'Quick tools');
    const CORE_TOOL = { tSelect: 'select', tPan: 'pan', tRect: 'rect', tLine: 'line', tArrow: 'arrow',
      tText: 'text', tCrop: 'crop', tPin: 'pin' };
    const TOOL_ID = {};
    Object.keys(CORE_TOOL).forEach(function (id) { TOOL_ID[CORE_TOOL[id]] = id; });
    function toolOf(id) {
      const tb = X.toolBtn || {};
      for (const k in tb) if (tb[k] === id) return k;
      return CORE_TOOL[id] || null;
    }
    [
      ['tSelect', 'Select (V)'], ['tPan', 'Pan (H)'], ['tNote', 'Comment'], ['tHighlight', 'Highlight text'],
      ['tInk', 'Draw'], ['tText', 'Add or edit text'], ['tDim', 'Measure'], ['btnSign', 'Sign']
    ].forEach(function (q) {
      const src = $(q[0]);
      if (!src) return;
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button'; b.id = 'q' + q[0];
      b.title = q[1]; b.setAttribute('aria-label', q[1]);
      const svg = src.querySelector('svg');
      b.innerHTML = svg ? svg.outerHTML : '';
      const tool = toolOf(q[0]);
      if (tool) {
        b.dataset.toolBtn = tool;           /* core lights it with the tool */
        b.classList.toggle('on', X.S.tool === tool);
      }
      b.addEventListener('click', function () {
        if (q[0] === 'tSelect') X.setTool('select');
        else if (q[0] === 'tPan') X.toggleTool('pan');
        else src.click();
      });
      rail.appendChild(b);
    });

    /* Floating, as Acrobat's: dragged by its grip anywhere over the page
       area, and kept where it was put (on this device) */
    const grip = document.createElement('span');
    grip.className = 'qgrip'; grip.title = 'Drag to move the tools';
    grip.setAttribute('aria-hidden', 'true');
    rail.insertBefore(grip, rail.firstChild);
    const QPOS = 'adddots.qrail.pos';
    function keepIn(x, y) {
      const m = main.getBoundingClientRect();
      return [Math.max(4, Math.min(m.width - rail.offsetWidth - 4, x)),
              Math.max(4, Math.min(m.height - rail.offsetHeight - 4, y))];
    }
    function putRail(x, y) {
      const p = keepIn(x, y);
      rail.style.left = p[0] + 'px'; rail.style.top = p[1] + 'px';
      return p;
    }
    function placeRail() {
      let pos = null;
      try { pos = JSON.parse(localStorage.getItem(QPOS) || 'null'); } catch (e) { pos = null; }
      if (!on) { rail.style.left = ''; rail.style.top = ''; return; }
      if (pos && rail.offsetWidth) { putRail(pos[0], pos[1]); return; }
      /* its own place: just inside the page area, beside the panel */
      const st = $('stage');
      if (!st) return;
      rail.style.left = Math.round(st.getBoundingClientRect().left - main.getBoundingClientRect().left + 12) + 'px';
      rail.style.top = '';
    }

    grip.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.preventDefault();
      const m = main.getBoundingClientRect(), r = rail.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      rail.classList.add('dragging');
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* mouse works without it */ }
      function move(ev) { putRail(ev.clientX - m.left - dx, ev.clientY - m.top - dy); }
      function up() {
        rail.classList.remove('dragging');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        try { localStorage.setItem(QPOS, JSON.stringify([parseFloat(rail.style.left), parseFloat(rail.style.top)])); }
        catch (err) { /* not kept */ }
      }
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    /* a double click on the grip puts it back beside the panel */
    grip.addEventListener('dblclick', function () {
      try { localStorage.removeItem(QPOS); } catch (e) { /* nothing kept */ }
      placeRail();
    });
    window.addEventListener('resize', function () { if (on) placeRail(); });

    /* ---------------- the options of the tool in hand ----------------
       The Drawing Tool panel (js/toolprops.js) stays in the ribbon, which is
       the panel down the left here: core shows it while a tool is in hand or
       a mark is picked up, and it heads the panel above the tab's tools. */
    const HEAD_OPTS = [['grpToolProps', 'Tool options'], ['grpMarkProps', 'Format']];
    HEAD_OPTS.forEach(function (h) { const g = $(h[0]); if (g) g.dataset.head = h[1]; });

    /* ---------------- the rail down the right ----------------
       As Acrobat's: the side panels at the top (the sidebar opens on the
       right, and only when one is pressed), the page and zoom below. The
       page and zoom are the status bar's own controls, stood on end. */

    const side = document.createElement('nav');
    side.className = 'srail'; side.id = 'sideRail';
    side.setAttribute('aria-label', 'Side panels, page and zoom');
    const SIDE_ICON = {
      tabPages: ic('<rect x="7" y="3" width="13" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/>'),
      tabFind: ic('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
      tabPins: ic('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
      tabComments: ic('<path d="M4 5h16v11H9l-5 4z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="12" x2="13" y2="12"/>'),
      btnBookmarks: ic('<path d="M6 3h10v18l-5-4-5 4z"/><line x1="19" y1="7" x2="22" y2="7"/><line x1="19" y1="11" x2="22" y2="11"/>')
    };
    const SIDE = [
      ['tabPages', 'Pages'], ['tabFind', 'Find'], ['tabComments', 'Notes'],
      ['tabPins', 'Site photos'], ['btnBookmarks', 'Bookmarks']
    ];
    SIDE.forEach(function (s) {
      if (!$(s[0])) return;
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button'; b.id = 's' + s[0][0].toUpperCase() + s[0].slice(1);
      b.title = s[1]; b.setAttribute('aria-label', s[1]);
      b.innerHTML = SIDE_ICON[s[0]];
      b.addEventListener('click', function () {
        const src = $(s[0]);
        if (s[0] === 'btnBookmarks') { src.click(); return; }
        const railEl = $('rail');
        /* pressed again, it closes */
        if (!railEl.hidden && src.classList.contains('on')) { X.setRail(false); }
        else { X.setRail(true); src.click(); }
        paintSide();
      });
      side.appendChild(b);
    });
    const sgrow = document.createElement('span');
    sgrow.className = 'sgrow';
    side.appendChild(sgrow);
    /* rotate sits with the page and zoom, as in Acrobat */
    const rot = document.createElement('button');
    rot.className = 'sbrot'; rot.type = 'button'; rot.title = 'Rotate this page'; rot.setAttribute('aria-label', 'Rotate this page');
    rot.innerHTML = ic('<polyline points="21 4 21 10 15 10"/><path d="M20.5 14a8.5 8.5 0 1 1-2.1-7.4L21 9"/>');
    rot.addEventListener('click', function () { const r = $('btnRotR'); if (r && !r.disabled) r.click(); });

    function paintSide() {
      const railEl = $('rail');
      SIDE.forEach(function (s) {
        const b = $('s' + s[0][0].toUpperCase() + s[0].slice(1)), src = $(s[0]);
        if (!b || !src) return;
        b.classList.toggle('on', s[0] === 'btnBookmarks' ? src.classList.contains('on')
          : !railEl.hidden && src.classList.contains('on'));
      });
    }
    setInterval(function () { if (on) paintSide(); }, 400);

    /* ---------------- where each piece lives ---------------- */

    /* where it was: after the same neighbour, or before the other one (the
       mode bar that followed the ribbon has gone into the Drawing Tool panel) */
    function spot(el) {
      return el ? { el: el, parent: el.parentNode, prev: el.previousElementSibling, next: el.nextElementSibling } : null;
    }
    const HOME = [spot(ribbon), spot($('statusBar'))].filter(Boolean);
    let on = false;

    function place(wide) {
      if (wide) {
        main.insertBefore(ribbon, main.firstChild);
        main.appendChild(rail);
        main.appendChild(side);
        if ($('statusBar')) { side.appendChild($('statusBar')); $('statusBar').insertBefore(rot, $('statusBar').querySelector('[data-a="fitw"]')); }
      } else {
        HOME.forEach(function (h) {
          if (h.prev && h.prev.parentNode === h.parent) h.prev.insertAdjacentElement('afterend', h.el);
          else h.parent.insertBefore(h.el, h.next && h.next.parentNode === h.parent ? h.next : null);
        });
        if (rail.parentNode) rail.remove();
        if (side.parentNode) side.remove();
      }
    }

    /* ---------------- which tab is lit ---------------- */

    let group = 'view', lastCore = null, closed = false;

    function coreTab() {
      const t = tabs.querySelector('.tab.on');
      return t ? t.id : null;
    }

    function setClosed(c) {
      closed = c;
      document.body.classList.toggle('acro-closed', c && on);
      ribbon.hidden = c && on;
      /* the page area moved: the quick tools go with it */
      placeRail();
    }

    function show() {
      if (!on) return;
      const g = GROUPS.filter(function (x) { return x.key === group; })[0];
      const want = g ? g.pans : [group];          /* a module's own tab shows alone */
      Array.prototype.forEach.call(ribbon.querySelectorAll(':scope > .rpan'), function (p) {
        if (p.id === 'panTool') return;           /* core shows it with a tool */
        const vis = want.indexOf(p.id) >= 0;
        if (p.hidden === vis) p.hidden = !vis;
      });
      GROUPS.forEach(function (x) {
        const t = $(x.tab);
        if (t) t.classList.toggle('acro-on', x.key === group);
      });
      $('acroTitle').textContent = g ? g.name : '';
    }

    /* follow core: a tool picked from anywhere opens the tab it lives on.
       Only a change of core's tab counts: lighting a tab here changes
       classes too. */
    function follow() {
      if (!on) return;
      const t = coreTab();
      if (t && t !== lastCore && t !== 'ribTool' && lastCore !== 'ribTool') {
        const pan = $(t) && $(t).getAttribute('aria-controls');
        group = byPan[pan] ? byPan[pan].key : pan || group;
      } else if (t === 'ribTool' && lastCore !== 'ribTool') {
        /* core went past the tool's own tab to its options: open the tab
           the tool lives on, unless it is in the panel already */
        const id = (X.toolBtn || {})[X.S.tool] || TOOL_ID[X.S.tool];
        const p = id && $(id) && $(id).closest('#ribbon > .rpan');
        if (p && p.hidden && byPan[p.id]) group = byPan[p.id].key;
      }
      lastCore = t;
      show();
    }
    new MutationObserver(follow).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
    /* core hides every panel but its own each time a tab is clicked, the
       one already lit too (no class changes then): show the group again */
    new MutationObserver(function (recs) {
      if (recs.some(function (r) { return r.target.parentNode === ribbon; })) show();
    }).observe(ribbon, { subtree: true, attributes: true, attributeFilter: ['hidden'] });

    /* A tab picked while a tool is in hand changes the panel only: the
       tool's options stay up until the tool is put down. */
    tabs.addEventListener('click', function (e) {
      if (!on) return;
      const t = e.target.closest('.tab');
      if (!t) return;
      if (closed) setClosed(false);
      const g = byTab[t.id];
      if (!g) return;
      group = g.key;
      show();
      const toolLive = $('ribTool') && !$('ribTool').hidden;
      if (g.key === 'all' || toolLive) e.stopPropagation();
    }, true);

    /* the home screen covers the page: the rails go with it */
    function behindHome() {
      const home = X.homeShown ? X.homeShown() : false;
      document.body.classList.toggle('acro-home', home);
      rail.inert = home; side.inert = home;
    }
    new MutationObserver(behindHome).observe($('openPanel'), { attributes: true, attributeFilter: ['hidden'] });

    /* ---------------- switching between the two layouts ---------------- */

    function apply() {
      const wide = WIDE.matches && !X.isMobile();
      if (wide === on) return;
      on = wide;
      document.body.classList.toggle('acro', on);
      /* the sidebar opens when a side panel is pressed, not with each file */
      X.railOnPress = on;
      place(on);
      allTab.hidden = !on;
      head.hidden = !on;
      if (formTab) formTab.textContent = on ? 'Sign' : formName;
      if (on) {
        lastCore = null;
        follow();
      } else {
        ribbon.hidden = false;
        document.body.classList.remove('acro-closed');
        panAll.hidden = true;
        GROUPS.forEach(function (x) { const t = $(x.tab); if (t) t.classList.remove('acro-on'); });
        /* core's own panel, and only that one, as the ribbon has it */
        const t = coreTab();
        if (t && X.setRibbon) X.setRibbon(t);
      }
      setClosed(closed);
      behindHome();
      paintSide();
      placeRail();
    }
    if (WIDE.addEventListener) WIDE.addEventListener('change', apply);
    window.addEventListener('resize', apply);
    apply();

    X.toolpanel = { group: function () { return on ? group : null; }, groups: GROUPS };
  });
})();
