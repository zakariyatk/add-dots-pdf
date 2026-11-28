/* Add Dots PDF — Tool groups and flyouts, as Illustrator's toolbar has them
   ----------------------------------------------------------------------
   The bar of tools beside the page (js/toolpanel.js, #quickRail) holds one
   button for each group of related tools, as Illustrator's does: the button
   shows the group's tool in hand (or the one last used), a small triangle
   in its corner says there are more, and pressing and holding it opens a
   flyout of the whole group to pick from.

   One registry (REGISTRY, below) says what the bar holds, in order: each
   group's tools with their names, keyboard shortcuts and icons, and how
   each is picked up. Nothing is a second copy of a tool: a tool is picked
   up by its own button on the ribbon (its handler, its toggling, the tab it
   lives on), so the drawing engine, selection, the Properties panel, undo
   and every shortcut are the ones the app already has. A new group is a new
   entry here, or X.toolGroups.add(group) from a module.

     Click             picks up the group's tool shown
     Press and hold    opens the flyout (or a click on the corner triangle,
                       a right click, or a long press on a touch screen);
                       let go over a tool to pick it, as Illustrator does
     Alt+click         the next tool in the group, round and round
     Keyboard          ↓ or → on a focused group opens it; arrows move;
                       Enter or Space picks; Esc closes
     A shortcut        picks its tool and the group's button shows it

   The tool last used in each group is kept on this device. Groups of many
   tools lay out in two columns (cols: 2). css/toolpanel.css has the look,
   in the app's own colours for the light and dark themes. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[toolgroups] core bridge missing'); return; }

  /* ---------------- the registry ----------------
     Each entry of RAIL is a button already on the bar ({ rail: id }, its own
     behaviour kept), or a group:
       id     the group's name for keeping its last tool
       name   what the flyout is called (for screen readers)
       cols   1 or 2 columns in the flyout
       tools  [{ tool, btn, name, key, icon?, run? }]
              tool  the tool's name in core (S.tool)
              btn   its button on the ribbon: clicked to pick it up, and
                    its icon unless one is given
              key   the shortcut shown (the app's own; it is not bound here)
              run   instead of clicking btn
     Groups' tools whose button the app does not have (an older build) are
     passed over, and a group left with one tool is a plain button. */
  const REGISTRY = [
    { rail: 'qtSelect' },
    { rail: 'qtVxDirect' },
    { rail: 'qtEditMove' },
    { id: 'pen', name: 'Pen tools', tools: [
      { tool: 'pen', btn: 'tPen', name: 'Pen Tool', key: 'P' },
      { tool: 'vadd', btn: 'tVxAdd', name: 'Add Anchor Point Tool' },
      { tool: 'vdel', btn: 'tVxDel', name: 'Delete Anchor Point Tool' },
      { tool: 'vconv', btn: 'tVxConv', name: 'Anchor Point Tool', key: 'Shift+C' }
    ] },
    { rail: 'qtText' },
    { id: 'shapes', name: 'Shape tools', tools: [
      { tool: 'rect', btn: 'tRect', name: 'Rectangle Tool', key: 'X' },
      { tool: 'rrect', btn: 'tRRect', name: 'Rounded Rectangle Tool' },
      { tool: 'ellipse', btn: 'tEllipse', name: 'Ellipse Tool', key: 'L' },
      { tool: 'polygon', btn: 'tPolygon', name: 'Polygon Tool' },
      { tool: 'star', btn: 'tStar', name: 'Star Tool' },
      { tool: 'line', btn: 'tLine', name: 'Line Segment Tool', key: '\\' },
      { tool: 'arc', btn: 'tArc', name: 'Arc Tool', key: 'Shift+A' },
      { tool: 'spiral', btn: 'tSpiral', name: 'Spiral Tool' }
    ] },
    { id: 'draw', name: 'Drawing tools', tools: [
      { tool: 'ink', btn: 'tInk', name: 'Draw Tool', key: 'Shift+P' },
      { tool: 'poly', btn: 'tPoly', name: 'Continuous Line Tool' },
      { tool: 'arrow', btn: 'tArrow', name: 'Arrow Tool' },
      { tool: 'cloud', btn: 'tCloud', name: 'Cloud Tool', key: 'Shift+L' }
    ] },
    { rail: 'qtRotate' },
    { rail: 'qtGradient' },
    { rail: 'qtShapeBuilder' },
    { id: 'markup', name: 'Text mark-up tools', tools: [
      { tool: 'highlight', btn: 'tHighlight', name: 'Highlight Text Tool', key: 'Shift+H' },
      { tool: 'hlarea', btn: 'tHlArea', name: 'Highlight Area Tool', key: 'Shift+G' },
      { tool: 'underline', btn: 'tUnderline', name: 'Underline Tool', key: 'U' },
      { tool: 'strike', btn: 'tStrike', name: 'Strikethrough Tool', key: 'D' }
    ] },
    { id: 'comment', name: 'Comment tools', tools: [
      { tool: 'note', btn: 'tNote', name: 'Sticky Note Tool', key: 'N' },
      { tool: 'stamp', btn: 'tStamp', name: 'Stamp Tool', key: 'B' }
    ] },
    { id: 'measure', name: 'Dimension tools', cols: 2, tools: [
      { tool: 'dim', btn: 'tDim', name: 'Linear', key: 'Shift+D' },
      { tool: 'dimal', btn: 'tDimAl', name: 'Aligned' },
      { tool: 'dimc', btn: 'tDimC', name: 'Continuous', key: 'Shift+Q' },
      { tool: 'dimb', btn: 'tDimB', name: 'Baseline' },
      { tool: 'dima', btn: 'tDimA', name: 'Angular' },
      { tool: 'dimr', btn: 'tDimR', name: 'Radius' },
      { tool: 'dimd', btn: 'tDimD', name: 'Diameter' },
      { tool: 'dimarc', btn: 'tDimArc', name: 'Arc Length' },
      { tool: 'dimo', btn: 'tDimO', name: 'Ordinate' }
    ] },
    { id: 'view', name: 'Navigation tools', tools: [
      { tool: 'pan', btn: 'tPan', name: 'Hand Tool', key: 'H', run: function () { X.setTool('pan'); } },
      { tool: 'zoombox', btn: 'tZoomBox', name: 'Zoom Tool' }
    ] },
    { rail: 'qbtnRulers' }
  ];
  /* rail buttons the groups take the place of */
  const REPLACED = ['qtPan', 'qtNote', 'qtHighlight', 'qtInk', 'qtDim'];

  const HOLD_MS = 320;          /* press this long for the flyout, as Illustrator */
  const KEEP = 'adddots.toolgroups';

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const rail = $('quickRail');
    if (!rail) return;

    let last = {};
    try { last = JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch (e) { last = {}; }
    function remember(gid, tool) {
      last[gid] = tool;
      try { localStorage.setItem(KEEP, JSON.stringify(last)); } catch (e) { /* this session only */ }
    }

    const groups = {};          /* id → { def, tools, btn } */
    const byTool = {};          /* tool → group */

    function iconOf(t) {
      if (t.icon) return t.icon;
      const src = $(t.btn), svg = src && src.querySelector('svg');
      return svg ? svg.outerHTML : '';
    }
    const label = function (t) { return t.name + (t.key ? ' (' + t.key + ')' : ''); };

    /* ---------------- a group's button ---------------- */

    function makeGroup(def) {
      const tools = def.tools.filter(function (t) { return !!$(t.btn) || !!t.run; });
      if (!tools.length) return null;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn tgbtn'; b.id = 'qg-' + def.id;
      b.dataset.group = def.id;
      b.dataset.tools = tools.map(function (t) { return t.tool; }).join(' ');
      const g = { def: def, tools: tools, btn: b, face: null };
      if (tools.length > 1) {
        b.classList.add('tgmore');
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
      }
      groups[def.id] = g;
      tools.forEach(function (t) { byTool[t.tool] = g; });
      const kept = tools.filter(function (t) { return t.tool === last[def.id]; })[0];
      setFace(g, kept || tools[0]);
      wire(g);
      return b;
    }

    function setFace(g, t) {
      g.face = t;
      const b = g.btn;
      b.dataset.toolBtn = t.tool;        /* core lights it with the tool (setTool) */
      b.innerHTML = iconOf(t) + (g.tools.length > 1 ? '<i class="tgtri" aria-hidden="true"></i>' : '');
      b.title = label(t);
      b.setAttribute('aria-label', g.tools.length > 1 ? t.name + ', ' + g.def.name + ': press and hold, or press Down, for more' : t.name);
      b.classList.toggle('on', S.tool === t.tool);
    }

    function pick(g, t) {
      setFace(g, t);
      remember(g.def.id, t.tool);
      if (t.run) t.run();
      else if (S.tool !== t.tool) { const src = $(t.btn); if (src) src.click(); else X.setTool(t.tool); }
      g.btn.classList.toggle('on', S.tool === t.tool);
    }

    /* the tool changed anywhere (a shortcut, the ribbon, a flyout): its
       group's button shows it, as Illustrator's does */
    X.on('tool', function (tool) {
      const g = byTool[tool];
      if (g && g.face.tool !== tool) {
        setFace(g, g.tools.filter(function (t) { return t.tool === tool; })[0]);
        remember(g.def.id, tool);
      }
      Object.keys(groups).forEach(function (id) {
        const x = groups[id];
        x.btn.classList.toggle('on', S.tool === x.face.tool);
      });
      if (fly.g) close(false);
      if (X.toolbar) X.toolbar.snapIcons();
    });

    /* ---------------- the flyout ---------------- */

    const flyEl = document.createElement('div');
    flyEl.className = 'tgfly'; flyEl.id = 'toolFlyout';
    flyEl.setAttribute('role', 'menu');
    flyEl.hidden = true;
    document.body.appendChild(flyEl);
    const fly = { g: null, held: false };

    function items() { return Array.prototype.slice.call(flyEl.querySelectorAll('.tgitem')); }

    function open(g, focus) {
      if (g.tools.length < 2) return;
      if (fly.g === g) return;
      close(false);
      fly.g = g;
      flyEl.style.setProperty('--tg-cols', String(g.def.cols || 1));
      flyEl.classList.toggle('two', (g.def.cols || 1) > 1);
      flyEl.setAttribute('aria-label', g.def.name);
      flyEl.innerHTML = '';
      g.tools.forEach(function (t) {
        const it = document.createElement('button');
        it.type = 'button'; it.className = 'tgitem';
        it.setAttribute('role', 'menuitemradio');
        const cur = t === g.face;
        it.setAttribute('aria-checked', cur ? 'true' : 'false');
        it.classList.toggle('cur', cur);
        it.classList.toggle('on', S.tool === t.tool);
        it.dataset.tool = t.tool;
        it.tabIndex = -1;
        it.title = label(t);
        it.innerHTML = '<i class="tgmark" aria-hidden="true"></i>' + iconOf(t) +
          '<span class="tgname">' + X.esc(t.name) + '</span>' +
          '<kbd class="tgkey">' + (t.key ? X.esc(t.key) : '') + '</kbd>';
        it.addEventListener('click', function (e) {
          e.stopPropagation();
          close(false);
          pick(g, t);
        });
        flyEl.appendChild(it);
      });
      flyEl.hidden = false;
      g.btn.setAttribute('aria-expanded', 'true');
      g.btn.classList.add('tgopen');
      place(g.btn);
      if (focus) {
        const list = items(), i = Math.max(0, g.tools.indexOf(g.face));
        if (list[i]) list[i].focus();
      }
    }
    /* beside the button, on the side away from the bar, kept on screen */
    function place(btn) {
      const r = btn.getBoundingClientRect(), w = flyEl.offsetWidth, h = flyEl.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = r.right + 6;
      if (x + w > vw - 8) x = Math.max(8, r.left - w - 6);
      let y = r.top - 4;
      if (y + h > vh - 8) y = Math.max(8, vh - 8 - h);
      flyEl.style.left = Math.round(x) + 'px';
      flyEl.style.top = Math.round(y) + 'px';
    }
    function close(refocus) {
      const g = fly.g;
      if (!g) return;
      fly.g = null; fly.held = false;
      flyEl.hidden = true;
      flyEl.innerHTML = '';
      g.btn.setAttribute('aria-expanded', 'false');
      g.btn.classList.remove('tgopen');
      if (refocus) g.btn.focus();
    }

    /* ---------------- the pointer and keyboard on a group button ---------------- */

    function wire(g) {
      const b = g.btn;
      let timer = 0, down = null, swallow = false;
      function clear() { if (timer) { clearTimeout(timer); timer = 0; } }
      b.addEventListener('pointerdown', function (e) {
        if (e.button > 0) return;
        swallow = false;
        if (g.tools.length < 2) return;
        down = { id: e.pointerId, x: e.clientX, y: e.clientY };
        /* the corner triangle opens it at once */
        const tri = e.target.closest && e.target.closest('.tgtri');
        const now = !!tri || fly.g === g;
        clear();
        if (now) {
          if (fly.g === g) { close(false); swallow = true; down = null; return; }
          open(g, false); fly.held = true; swallow = true;
        } else {
          timer = setTimeout(function () { timer = 0; open(g, false); fly.held = true; swallow = true; }, HOLD_MS);
        }
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* works without */ }
      });
      /* held open: dragging across the flyout lights the tool under the pointer */
      b.addEventListener('pointermove', function (e) {
        if (!fly.held || fly.g !== g) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const it = el && el.closest && el.closest('.tgitem');
        items().forEach(function (x) { x.classList.toggle('hot', x === it); });
      });
      b.addEventListener('pointerup', function (e) {
        clear();
        if (!down || down.id !== e.pointerId) return;
        down = null;
        if (fly.held && fly.g === g) {
          fly.held = false;
          /* let go over a tool: that one, as Illustrator does */
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const it = el && el.closest && el.closest('.tgitem');
          if (it) {
            const t = g.tools.filter(function (x) { return x.tool === it.dataset.tool; })[0];
            close(false);
            if (t) pick(g, t);
          }
        }
      });
      b.addEventListener('pointercancel', function () { clear(); down = null; fly.held = false; });
      b.addEventListener('click', function (e) {
        if (swallow) { swallow = false; return; }
        if (e.altKey && g.tools.length > 1) {
          /* Alt+click: the next tool in the group */
          e.preventDefault();
          const i = g.tools.indexOf(g.face);
          pick(g, g.tools[(i + 1) % g.tools.length]);
          return;
        }
        close(false);
        pick(g, g.face);
      });
      /* a right click, or the long press a touch screen turns into one */
      b.addEventListener('contextmenu', function (e) {
        if (g.tools.length < 2) return;
        e.preventDefault();
        clear();
        if (fly.g !== g) open(g, false);
        swallow = true;
      });
      b.addEventListener('keydown', function (e) {
        if (g.tools.length < 2) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.altKey && e.key === 'ArrowDown')) {
          e.preventDefault(); e.stopPropagation();
          open(g, true);
        }
      });
    }

    /* inside the flyout: arrows move through the tools (by column when two),
       Enter or Space picks, Esc or Tab closes */
    flyEl.addEventListener('keydown', function (e) {
      const list = items(), i = list.indexOf(document.activeElement);
      const cols = fly.g && fly.g.def.cols || 1;
      const go = function (n) { e.preventDefault(); e.stopPropagation(); const k = (n + list.length) % list.length; list[k].focus(); };
      if (e.key === 'ArrowDown') go(i + cols);
      else if (e.key === 'ArrowUp') go(i - cols);
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') { if (cols > 1) go(i - 1); else { e.preventDefault(); e.stopPropagation(); close(true); } }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (list[i]) list[i].click(); }
    });
    flyEl.addEventListener('pointerover', function (e) {
      const it = e.target.closest && e.target.closest('.tgitem');
      items().forEach(function (x) { x.classList.toggle('hot', x === it); });
    });
    flyEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    /* anywhere else closes it */
    document.addEventListener('pointerdown', function (e) {
      if (!fly.g) return;
      if (flyEl.contains(e.target) || fly.g.btn.contains(e.target)) return;
      close(false);
    }, true);
    window.addEventListener('keydown', function (e) {
      if (fly.g && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
    }, true);
    window.addEventListener('resize', function () { close(false); });
    window.addEventListener('blur', function () { close(false); });
    rail.addEventListener('scroll', function () { close(false); }, { passive: true });

    /* ---------------- the bar, in the registry's order ---------------- */

    function build(list) {
      const lastBtn = $('qLast');
      REPLACED.forEach(function (id) { const el = $(id); if (el) el.remove(); });
      list.forEach(function (entry) {
        let el = null;
        if (entry.rail) el = $(entry.rail);
        else if (entry.tools) {
          el = groups[entry.id] ? groups[entry.id].btn : makeGroup(entry);
        }
        if (el) rail.insertBefore(el, lastBtn && lastBtn.parentNode === rail ? lastBtn : null);
      });
      if (X.paintMove) X.paintMove();
      if (X.toolbar) X.toolbar.snapIcons();
    }
    build(REGISTRY);

    X.toolGroups = {
      registry: REGISTRY,
      groups: groups,
      /** a new group, or more tools for one already there (by id); placed
          before `before` (a rail button's or group's id) or at the end */
      add: function (def, before) {
        const old = groups[def.id];
        if (old) {
          old.btn.remove();
          delete groups[def.id];
          old.tools.forEach(function (t) { delete byTool[t.tool]; });
        }
        const at = before ? REGISTRY.findIndex(function (e) { return (e.rail || e.id) === before; }) : -1;
        const i = REGISTRY.findIndex(function (e) { return e.id === def.id; });
        if (i >= 0) REGISTRY.splice(i, 1);
        if (at >= 0) REGISTRY.splice(at, 0, def); else REGISTRY.push(def);
        build(REGISTRY);
        return groups[def.id] || null;
      },
      open: function (id) { const g = groups[id]; if (g) open(g, false); },
      close: function () { close(false); },
      groupOf: function (tool) { return byTool[tool] ? byTool[tool].def.id : null; }
    };
  });
})();
