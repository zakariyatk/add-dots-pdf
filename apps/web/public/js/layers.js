/* Add Dots PDF — Layers
   ----------------------
   A panel listing every mark on the current page the way Illustrator's Layers
   panel does: a tree of named layers, each one opening to show its own marks,
   topmost first. Every mark can be shown or hidden, duplicated, deleted, or
   moved up or down the stack; a click selects it on the page, the same as
   clicking it there.

   Two things drive the tree:

   • the active layer — the row with the pencil. Click a layer to make it
     active, and every mark made from then on (drawn, stamped, signed,
     inserted…) lands in it by itself: claimNew() below stamps any shape that
     arrives without a layer, so no tool that creates a mark has to know
     layers exist.

   • drag and drop — pick a mark's row up and drop it on another layer's row
     to move it there, or on another mark's row to drop it in front of that
     mark. That is the only way to move a mark between layers; there is no
     "add selection" button and no per-row dropdown.

   Visibility is the column of dots down the left edge: filled is shown,
   hollow is hidden. A layer's dot is the same per-mark `hide` flag applied to
   every one of its members at once; there is nothing else to serialize, so
   Save needs no changes for either feature.

   Nothing new is stored to make the per-mark list work: a mark is already an
   ordinary entry in it.shapes (core.js), in the order it draws — last is
   topmost — so undo, Save and the thumbnails already follow every change
   made here. The one new field there is `hide`, which core.js's renderer and
   the engine's save (packages/engine/src/save.ts) both already skip.

   Opacity, as Illustrator's Transparency panel targets it: the slider under
   the buttons sets the selected objects' own opacity (s.o, the same as the
   Properties panel's), or with none selected the picked layers' (or the
   active one's). A layer's opacity is kept on the layer (L.opacity) and on
   each of its members as s.lo, the way hide is (syncOpacity below), so the
   screen fades each mark as a whole and the saved PDF does the same
   (packages/engine/src/painters/fade.ts), on top of the mark's own. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[layers] core bridge missing'); return; }

  X.on('ready', function () {
    const $ = X.$, S = X.S;
    const NOT_SELECTABLE = X.NOT_SELECTABLE || {};

    /* ---------------- how a mark reads in the list ---------------- */

    const LABEL = {
      rect: 'Rectangle', ellipse: 'Circle', line: 'Line', arrow: 'Arrow',
      cloud: 'Cloud', arc: 'Arc', dim: 'Dimension', dimr: 'Radius',
      dimd: 'Diameter', dima: 'Angle', ink: 'Drawing', markup: 'Highlight',
      note: 'Note', stamp: 'Stamp', istamp: 'Image stamp',
      vpath: 'Shape', sig: 'Signature',
      image: 'Image', table: 'Table', link: 'Link', video: 'Video',
      text: 'Text', leader: 'Leader', poly: 'Line'
    };
    function label(s) {
      if (s.t === 'text') { const t = String(s.text || '').trim(); return t ? t.slice(0, 28) : 'Text box'; }
      if (s.t === 'markup' && X.MARKUP && X.MARKUP[s.k]) return X.MARKUP[s.k].label;
      return LABEL[s.t] || (s.t.charAt(0).toUpperCase() + s.t.slice(1));
    }
    function swatch(s) { return s.fill || s.c || '#8A8F98'; }

    function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
    const UP = icon('<polyline points="18 15 12 9 6 15"/>');
    const DOWN = icon('<polyline points="6 9 12 15 18 9"/>');
    const DUP = icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 15V6a2 2 0 0 1 2-2h9"/>');
    const DEL = icon('<path d="M4 7h16"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>' +
      '<path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/>');
    const PENCIL = icon('<path d="M4 20h4L19 9l-4-4L4 16z"/>');
    const PLUS = icon('<path d="M12 4v16M4 12h16"/>');
    const MERGE = icon('<path d="M7 3v8a4 4 0 0 0 4 4h6"/><path d="M17 3v8a4 4 0 0 1-4 4h-1"/>' +
      '<polyline points="14 12 17 15 20 12"/>');
    const TWIST_OPEN = icon('<polyline points="6 9 12 15 18 9"/>');
    const TWIST_SHUT = icon('<polyline points="9 6 15 12 9 18"/>');
    const LOCK = icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
    const UNLOCK = icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.5"/>');

    /* ---------------- layers ----------------
       A layer is just a name shapes can carry (s.layer, a layer's own id):
       organisational, not a PDF concept — a layer's "hide" works the same
       way a mark's own does (s.hide), which core.js's renderer and the
       engine's save already skip, so hiding a layer is only ever setting
       that flag on its members. */
    let focusLayer = null;              /* the active layer: where new marks land */
    /* layers picked out in the panel (a click on a layer's row; Ctrl or
       Shift adds more), for Duplicate, Delete and Merge — kept apart from
       the marks selected on the page, and let go when marks are selected */
    let selLayers = [];
    let layerSeq = 1;
    const shut = {};                    /* layer id -> its branch is collapsed */

    /* the stripe at the left of a layer's row, so a glance tells them apart */
    const STRIPES = ['#7B5CFF', '#5DCAA5', '#E8B14C', '#E27C68', '#7FB3FF', '#D4537E', '#9FE1CB'];

    function ensureLayers() {
      if (!S.layers || !S.layers.length) { S.layers = [{ id: 'L0', name: 'Layer 1', hidden: false, locked: false }]; layerSeq = 1; }
      S.layers.forEach(function (l, i) { if (!l.color) l.color = STRIPES[i % STRIPES.length]; });
      if (!focusLayer || !S.layers.some(function (l) { return l.id === focusLayer; })) focusLayer = S.layers[0].id;
      return S.layers;
    }
    function layerOf(id) {
      return ensureLayers().filter(function (l) { return l.id === id; })[0] || S.layers[0];
    }
    /* the layer a shape belongs to — its own, or the first, if it names none
       or one that was since merged away */
    function layerIdOf(s) {
      const L = ensureLayers();
      return s.layer != null && L.some(function (l) { return l.id === s.layer; }) ? s.layer : L[0].id;
    }
    function redrawEverywhere() {
      S.items.forEach(function (it) { X.drawShapes(it); X.drawThumb(it); });
    }

    /* ---------------- new marks land in the active layer ----------------
       Every tool that makes a mark just pushes it onto it.shapes (annotate.js,
       draw.js, insert.js, forms.js…) and knows nothing about layers, so rather
       than touch all of them this claims whatever has turned up since the last
       look. A mark the user cannot see in this panel (a watermark, a header, a
       redaction — NOT_SELECTABLE) is left alone: it belongs to the first layer
       by default, the way everything did before layers existed. */
    function claimNew() {
      if (!S.items || !S.items.length) return false;
      ensureLayers();
      const L = layerOf(focusLayer);
      let got = false;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) {
          if (s.layer != null || NOT_SELECTABLE[s.t]) return;
          s.layer = L.id;
          if (L.hidden) s.hide = true;
          if (L.locked) s.locked = true;
          got = true;
        });
      });
      return got;
    }

    /* ---------------- a layer's opacity on its members ----------------
       Each mark carries its layer's opacity as s.lo, as it carries hide: the
       renderer and the save read the mark alone. A layer whose opacity was
       never set (the first one, on a document just opened) leaves its
       members as they are, so what a saved project held stays. */
    function layerOpacity(L) { return typeof L.opacity === 'number' ? L.opacity : null; }
    function syncOpacity() {
      if (!S.items || !S.items.length) return false;
      ensureLayers();
      let any = false;
      S.items.forEach(function (it) {
        let changed = false;
        it.shapes.forEach(function (s) {
          if (NOT_SELECTABLE[s.t]) return;
          const v = layerOpacity(layerOf(layerIdOf(s)));
          if (v == null) return;
          if (v >= 1) { if (s.lo != null) { delete s.lo; changed = true; } }
          else if (s.lo !== v) { s.lo = v; changed = true; }
        });
        if (changed) { any = true; if (it.anno) X.drawShapes(it); X.drawThumb(it); }
      });
      return any;
    }

    /* ---------------- the tab and its panel ----------------
       Like Bookmarks (js/books.js): reached from the side rail of icons
       (js/toolpanel.js) on a wide screen rather than this row of tabs,
       which only has room for so many. */
    const tab = document.createElement('button');
    tab.className = 'btn'; tab.id = 'tabLayers'; tab.type = 'button'; tab.textContent = 'Layers';
    tab.title = 'Layers on this page';
    tab.hidden = true;
    document.querySelector('.rail-tabs').insertBefore(tab, $('railClose'));

    const panel = document.createElement('div');
    panel.className = 'rail-body'; panel.id = 'railLayers'; panel.hidden = true;
    panel.innerHTML =
      '<div class="laybar"><b>Layers</b><span class="laycount" id="layCount"></span><span class="grow"></span></div>' +
      '<div class="laytools">' +
        '<button type="button" class="laynew" id="layAdd" title="New layer" aria-label="New layer">' +
          PLUS + '<span>New layer</span></button>' +
        '<span class="grow"></span>' +
        '<button type="button" id="layRename" title="Rename the active layer" aria-label="Rename layer">' + PENCIL + '</button>' +
        '<button type="button" id="layMerge" title="Merge the active layer into another" aria-label="Merge layer">' + MERGE + '</button>' +
      '</div>' +
      /* one Duplicate and one Delete for whatever is picked out: the marks
         selected on the page (one or several, together), or with none the
         active layer itself, as Illustrator's Layers panel has them. Up and
         down are for marks only. */
      '<div class="laytools laysel">' +
        '<span class="laysel-lbl" id="laySelLbl">Nothing selected</span>' +
        '<span class="grow"></span>' +
        '<button type="button" data-selact="up" data-marks="1" title="Bring forward" aria-label="Bring forward">' + UP + '</button>' +
        '<button type="button" data-selact="down" data-marks="1" title="Send backward" aria-label="Send backward">' + DOWN + '</button>' +
        '<button type="button" data-selact="dup" id="layDup" title="Duplicate" aria-label="Duplicate">' + DUP + '</button>' +
        '<button type="button" class="laydanger" data-selact="del" id="layDel" title="Delete" aria-label="Delete">' + DEL + '</button>' +
      '</div>' +
      /* opacity, for what is picked out: the selected objects, else the layer(s) */
      '<div class="laytools layop">' +
        '<span class="layop-lbl" id="layOpLbl">Layer</span>' +
        '<input type="range" id="layOpRange" min="0" max="100" step="1" aria-label="Opacity">' +
        '<span class="layop-num"><input type="text" id="layOpNum" inputmode="numeric" aria-label="Opacity in percent"><em>%</em></span>' +
      '</div>' +
      '<div id="layList"></div>';
    $('railPages').parentNode.appendChild(panel);

    /* the marks selected on the page right now, wherever that selection was
       made (the canvas, a marquee, Ctrl+click) — a new layer takes them with
       it, the way "New layer from selection" works elsewhere */
    function pageSelection() {
      if (!S.sel || !S.sel.it) return null;
      const it = S.sel.it, list = X.selList().filter(function (i) { return it.shapes[i]; });
      return list.length ? { it: it, list: list } : null;
    }

    $('layAdd').addEventListener('click', function () {
      ensureLayers();
      layerSeq++;
      const L = {
        id: 'L' + Date.now().toString(36) + layerSeq,
        name: 'Layer ' + (S.layers.length + 1),
        hidden: false,
        locked: false,
        opacity: 1,
        color: STRIPES[S.layers.length % STRIPES.length]
      };
      S.layers.push(L);
      focusLayer = L.id;
      const sel = pageSelection();
      if (sel) {
        X.snapshot();
        sel.list.forEach(function (i) { const s = sel.it.shapes[i]; if (s) s.layer = L.id; });
        X.updateMeta();
      }
      render();
      X.toast(sel
        ? '<b>' + X.esc(L.name) + '</b> added — ' + sel.list.length +
          (sel.list.length > 1 ? ' marks moved into it' : ' mark moved into it')
        : '<b>' + X.esc(L.name) + '</b> added — everything you draw now lands in it');
    });
    $('layRename').addEventListener('click', function () { renameInPlace(focusLayer); });
    $('layMerge').addEventListener('click', function () {
      /* marks selected from more than one layer: into one layer, the front one's */
      const picked = pageSelection();
      if (picked && marksPicked()) { mergeMarks(picked.it, picked.list); return; }
      /* several layers picked: into the active one */
      const many = pickedLayers();
      if (many.length > 1) { mergeLayers(many); return; }
      const source = layerOf(focusLayer);
      const others = ensureLayers().filter(function (l) { return l.id !== source.id; });
      if (!others.length) { X.toast('There is only one layer'); return; }
      const listing = others.map(function (l, i) { return (i + 1) + '. ' + l.name; }).join('\n');
      X.ask('Merge "' + source.name + '" into which layer?\n\n' + listing +
        '\n\nType its number.', '1', { title: 'Merge layer' }).then(function (ans) { mergeInto(source, others, ans); });
    });
    /* Several layers merged into one, as Illustrator's Merge Selected: every
       mark of the others moves into the active layer (or, if it is not one
       of them, the topmost of them), taking its visibility and lock, and
       the others go. */
    function mergeLayers(ids) {
      const target = layerOf(ids.indexOf(focusLayer) >= 0 ? focusLayer
        : S.layers.filter(function (l) { return ids.indexOf(l.id) >= 0; }).pop().id);
      const others = ids.filter(function (id) { return id !== target.id; });
      X.snapshot();
      let n = 0;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) {
          if (!NOT_SELECTABLE[s.t] && others.indexOf(layerIdOf(s)) >= 0) {
            s.layer = target.id; s.hide = !!target.hidden; s.locked = !!target.locked; n++;
          }
        });
      });
      S.layers = S.layers.filter(function (l) { return others.indexOf(l.id) < 0; });
      focusLayer = target.id;
      selLayers = [target.id];
      redrawEverywhere(); X.updateMeta();
      render();
      X.toast((others.length + 1) + ' layers merged into <b>' + X.esc(target.name) + '</b>' +
        (n ? ' — ' + n + (n === 1 ? ' mark moved' : ' marks moved') : ''));
    }
    /* Marks selected from more than one layer gathered into one: the layer of
       the frontmost of them. Their places in the page's stack stay as they
       are, so nothing moves in front of or behind anything else. */
    function mergeMarks(it, list) {
      const front = list.slice().sort(function (a, b) { return a - b; }).pop();
      const target = layerOf(layerIdOf(it.shapes[front]));
      const from = {};
      list.forEach(function (i) { const id = layerIdOf(it.shapes[i]); if (id !== target.id) from[id] = 1; });
      if (!Object.keys(from).length) { X.toast('These are all on <b>' + X.esc(target.name) + '</b> already'); return; }
      X.snapshot();
      list.forEach(function (i) {
        const s = it.shapes[i];
        if (s && !s.locked) { s.layer = target.id; s.hide = !!target.hidden; s.locked = !!target.locked; }
      });
      focusLayer = target.id;
      X.drawShapes(it); X.drawThumb(it); X.updateMeta();
      render();
      X.toast(list.length + ' marks merged into <b>' + X.esc(target.name) + '</b>');
    }
    /* the layers picked out in the panel that still exist */
    function pickedLayers() {
      ensureLayers();
      return selLayers.filter(function (id) { return S.layers.some(function (l) { return l.id === id; }); });
    }
    function mergeInto(source, others, ans) {
      if (!ans) return;
      const n = parseInt(ans, 10);
      const target = others[n - 1];
      if (!target) { X.toast('Not one of the layers listed'); return; }
      X.snapshot();
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) {
          if (layerIdOf(s) === source.id) { s.layer = target.id; s.hide = !!target.hidden; s.locked = !!target.locked; }
        });
      });
      S.layers = S.layers.filter(function (l) { return l.id !== source.id; });
      focusLayer = target.id;
      redrawEverywhere(); X.updateMeta();
      render();
      X.toast('Merged into <b>' + X.esc(target.name) + '</b>');
    }
    /* Illustrator's own rule: deleting a layer deletes what is on it, so the
       marks go with it — after saying how many, and undoably */
    function deleteLayer(ids) {
      ensureLayers();
      ids = (ids && ids.length ? ids : [focusLayer]).filter(function (id) { return S.layers.some(function (l) { return l.id === id; }); });
      if (S.layers.length - ids.length < 1) { X.toast('The last layer cannot be deleted'); return; }
      const gone = ids.map(layerOf);
      let n = 0;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) { if (ids.indexOf(layerIdOf(s)) >= 0) n++; });
      });
      const what = gone.length === 1 ? '"' + gone[0].name + '"' : gone.length + ' layers';
      if (n && !window.confirm('Delete ' + what + ' and the ' + n +
        (n === 1 ? ' mark on ' : ' marks on ') + (gone.length === 1 ? 'it?' : 'them?'))) return;
      X.snapshot();
      S.items.forEach(function (it) {
        it.shapes = it.shapes.filter(function (s) { return ids.indexOf(layerIdOf(s)) < 0; });
      });
      S.layers = S.layers.filter(function (l) { return ids.indexOf(l.id) < 0; });
      S.sel = null; S.multi = null;
      selLayers = [];
      focusLayer = S.layers[S.layers.length - 1].id;
      redrawEverywhere(); X.updateMeta(); X.syncMarkPop();
      render();
      X.toast((gone.length === 1 ? '<b>' + X.esc(gone[0].name) + '</b>' : gone.length + ' layers') + ' deleted');
    }
    /* A layer duplicated: a new layer just above it, named after it, with a
       copy of every mark on it on every page, in the same order, on top of
       the page's stack, and the copy the active layer — as Illustrator's
       Duplicate Layer. A copied group is a group of its own. */
    function duplicateLayers(ids) {
      ids = ids && ids.length ? ids : [focusLayer];
      X.snapshot();
      const made = ids.map(function (id) { return duplicateLayer(id); });
      selLayers = made.length > 1 ? made : [];
      redrawEverywhere(); X.updateMeta(); X.syncMarkPop();
      render();
      X.toast(made.length > 1 ? made.length + ' layers duplicated' : '<b>' + X.esc(layerOf(made[0]).name) + '</b> added');
    }
    /** one layer copied (the undo snapshot is the caller's); answers the copy's id */
    function duplicateLayer(id) {
      ensureLayers();
      const L = layerOf(id);
      layerSeq++;
      const C = {
        id: 'L' + Date.now().toString(36) + layerSeq,
        name: L.name + ' copy',
        hidden: !!L.hidden,
        locked: false,
        opacity: L.opacity,
        color: STRIPES[S.layers.length % STRIPES.length]
      };
      let n = 0;
      S.items.forEach(function (it) {
        const grpMap = {};
        const copies = [];
        it.shapes.forEach(function (sh, i) {
          if (NOT_SELECTABLE[sh.t] || layerIdOf(sh) !== L.id) return;
          const c = JSON.parse(JSON.stringify(sh));
          c.layer = C.id;
          c.locked = false;
          if (c.id != null) c.id = String(c.id) + '-' + Date.now().toString(36) + i;
          if (c.grp != null) {
            if (!grpMap[c.grp]) grpMap[c.grp] = 'g' + Date.now().toString(36) + 'd' + (++layerSeq);
            c.grp = grpMap[c.grp];
          }
          copies.push(c);
        });
        copies.forEach(function (c) { it.shapes.push(c); });
        n += copies.length;
      });
      S.layers.splice(S.layers.indexOf(L) + 1, 0, C);
      focusLayer = C.id;
      S.sel = null; S.multi = null;
      void n;
      return C.id;
    }

    function bodies() { return Array.prototype.slice.call(document.querySelectorAll('#rail > .rail-body')); }
    /* the tab always opens it, as Bookmarks' does: the side rail button
       (js/toolpanel.js) opens the rail and then presses this tab, and the
       panel is still marked shown from last time, so a toggle here would
       shut it again at once — the second time it would never come out */
    function showPanel() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      X.setRail(true);
      bodies().forEach(function (b) { b.hidden = b !== panel; });
      document.querySelectorAll('.rail-tabs .btn').forEach(function (t) { t.classList.toggle('on', t === tab); });
      render();
    }
    tab.addEventListener('click', showPanel);
    /* any other tab hides this one, the way Bookmarks does for theirs */
    document.querySelectorAll('.rail-tabs .btn:not(#railClose)').forEach(function (t) {
      if (t === tab) return;
      t.addEventListener('click', function () { panel.hidden = true; tab.classList.remove('on'); });
    });

    /* ---------------- the tree ---------------- */

    /* every selectable mark on the page, gathered under its layer, front of
       the stack first — the order the panel reads in */
    function marksByLayer(it) {
      const map = {};
      ensureLayers().forEach(function (l) { map[l.id] = []; });
      it.shapes.forEach(function (s, idx) {
        if (NOT_SELECTABLE[s.t]) return;
        map[layerIdOf(s)].push({ idx: idx, s: s });
      });
      Object.keys(map).forEach(function (k) { map[k].reverse(); });
      return map;
    }
    function sigOf(it) {
      if (!it) return '';
      const multi = S.multi && S.multi.it === it ? S.multi.idx.join(',') : '';
      const marks = it.shapes.map(function (s) {
        return (s.hide ? '1' : '0') + (s.locked ? '1' : '0') + (s.layer || '-') + (s.o == null ? '' : '/' + s.o);
      }).join('|');
      const lay = (S.layers || []).map(function (l) {
        return l.id + l.name + (l.hidden ? '1' : '0') + (l.locked ? '1' : '0') + (l.opacity == null ? '' : '/' + l.opacity);
      }).join('|');
      return S.current + ':' + marks + ':' + lay + ':' + focusLayer + ':' + selLayers.join(',') +
        ':' + (S.sel && S.sel.it === it ? S.sel.i : -1) + ':' + multi;
    }

    function dot(on, lab) {
      return '<button type="button" class="laydot" data-act="dot" title="' + lab +
        '" aria-label="' + lab + '"><i class="' + (on ? 'dot' : 'dot off') + '"></i></button>';
    }
    function lockBtn(on, lab) {
      return '<button type="button" class="laylock' + (on ? ' on' : '') + '" data-act="lock" title="' + lab +
        '" aria-label="' + lab + '">' + (on ? LOCK : UNLOCK) + '</button>';
    }

    let lastSig = null;
    let renaming = null;                 /* the layer whose name is being typed */
    function render() {
      if (renaming) return;              /* a redraw would take the field away mid-word */
      const it = S.items[S.current - 1];
      lastSig = sigOf(it);
      const host = $('layList');
      if (!it) { host.innerHTML = ''; $('layCount').textContent = ''; return; }
      ensureLayers();
      const map = marksByLayer(it);
      let total = 0;
      Object.keys(map).forEach(function (k) { total += map[k].length; });
      $('layCount').textContent = S.layers.length + (S.layers.length === 1 ? ' layer · ' : ' layers · ') +
        total + ' on page ' + S.current;
      $('layMerge').disabled = S.layers.length < 2;

      /* newest layer at the top, the way the stack reads everywhere else */
      const selected = S.sel && S.sel.it === it ? X.selList() : [];
      /* marks selected on the page take over from layers picked in the panel */
      if (selected.length) selLayers = [];
      paintSel(it, selected);
      let h = '';
      S.layers.slice().reverse().forEach(function (L) {
        const list = map[L.id] || [], open = !shut[L.id], active = L.id === focusLayer;
        h += '<div class="layrow layhead' + (active ? ' active' : '') + (selLayers.indexOf(L.id) >= 0 ? ' sel' : '') +
            (L.hidden ? ' hid' : '') +
            (L.locked ? ' locked' : '') + '" data-lay="' + L.id + '">' +
          dot(!L.hidden, L.hidden ? 'Show this layer' : 'Hide this layer') +
          lockBtn(!!L.locked, L.locked ? 'Unlock this layer' : 'Lock this layer') +
          '<button type="button" class="laytwist" data-act="twist" aria-label="' +
            (open ? 'Collapse' : 'Expand') + '">' + (open ? TWIST_OPEN : TWIST_SHUT) + '</button>' +
          '<i class="laystrip" style="background:' + X.esc(L.color) + '"></i>' +
          '<span class="laylabel">' + X.esc(L.name) + '</span>' +
          (layerOpacity(L) != null && layerOpacity(L) < 1
            ? '<span class="layop-badge" title="Layer opacity">' + Math.round(layerOpacity(L) * 100) + '%</span>' : '') +
          '<span class="laynum">' + list.length + '</span>' +
          '<span class="laypen" title="New marks land here">' + (active ? PENCIL : '') + '</span>' +
          '</div>';
        if (!open) return;
        if (!list.length) {
          h += '<div class="layrow mrow laynone" data-lay="' + L.id + '">Empty — drag marks here</div>';
          return;
        }
        list.forEach(function (r) {
          /* every mark in the selection, not just the last one picked */
          const s = r.s, hid = !!s.hide, lck = !!s.locked, sel = selected.indexOf(r.idx) >= 0;
          h += '<div class="layrow mrow' + (hid ? ' hid' : '') + (lck ? ' locked' : '') + (sel ? ' sel' : '') +
              '" data-lay="' + L.id + '" data-idx="' + r.idx + '" draggable="' + (lck ? 'false' : 'true') + '">' +
            dot(!hid, hid ? 'Show' : 'Hide') +
            lockBtn(lck, lck ? 'Unlock' : 'Lock') +
            '<i class="layswatch" style="background:' + X.esc(swatch(s)) + '"></i>' +
            '<span class="laylabel">' + X.esc(label(s)) + '</span>' +
            (s.o != null && s.o < 1 ? '<span class="layop-badge" title="Opacity">' + Math.round(s.o * 100) + '%</span>' : '') +
            '</div>';
        });
      });
      host.innerHTML = h;
    }

    /* ---------------- clicks, in one place for the whole tree ---------------- */

    const host = $('layList');
    host.addEventListener('click', function (e) {
      const row = e.target.closest('.layrow');
      if (!row) return;
      const it = S.items[S.current - 1];
      if (!it) return;
      const act = e.target.closest('[data-act]');
      const isMark = row.dataset.idx !== undefined;

      if (act && act.dataset.act === 'dot') {
        if (isMark) toggleMark(it, +row.dataset.idx);
        else toggleLayer(row.dataset.lay);
        return;
      }
      if (act && act.dataset.act === 'lock') {
        if (isMark) toggleMarkLock(it, +row.dataset.idx);
        else toggleLayerLock(row.dataset.lay);
        return;
      }
      if (act && act.dataset.act === 'twist') {
        shut[row.dataset.lay] = !shut[row.dataset.lay];
        render();
        return;
      }
      if (!isMark) {                       /* a layer's own row: make it active */
        if (e.target.closest('.layname')) return;
        /* and pick the layer out rather than marks, so Duplicate and Delete
           act on it, as clicking a layer in Illustrator targets the layer */
        const id = row.dataset.lay;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          /* Ctrl or Shift: one more layer picked out, or one taken back out */
          const have = pickedLayers();
          if (!have.length && focusLayer && focusLayer !== id) have.push(focusLayer);
          const k = have.indexOf(id);
          if (k >= 0 && have.length > 1) have.splice(k, 1); else if (k < 0) have.push(id);
          selLayers = have;
        } else {
          selLayers = [id];
        }
        focusLayer = selLayers.indexOf(id) >= 0 ? id : selLayers[selLayers.length - 1];
        if (S.sel) { S.sel = null; S.multi = null; X.redrawAll(); X.syncMarkPop(); }
        render();
        return;
      }
      /* Ctrl or Shift adds a mark to the selection, or takes it out, as on the page */
      if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleSelect(it, +row.dataset.idx); return; }
      select(it, +row.dataset.idx);
    });

    /* Rename: a double-click on a layer's row, or the Rename button, puts its
       name in a field on the row. Enter or a click elsewhere keeps the new
       name; Esc keeps the old one. */
    host.addEventListener('dblclick', function (e) {
      let t = e.target;
      if (!t.isConnected) t = document.elementFromPoint(e.clientX, e.clientY) || t;
      const row = t.closest && t.closest('.layhead');
      if (!row || !host.contains(row) || t.closest('[data-act]')) return;
      e.preventDefault();
      renameInPlace(row.dataset.lay);
    });
    function renameInPlace(id) {
      if (renaming) return;
      const L = layerOf(id);
      if (!L) return;
      if (focusLayer !== L.id || !host.querySelector('.layhead[data-lay="' + L.id + '"]')) {
        focusLayer = L.id;
        render();
      }
      const row = host.querySelector('.layhead[data-lay="' + L.id + '"]');
      const lab = row && row.querySelector('.laylabel');
      if (!lab) return;
      const field = document.createElement('input');
      field.className = 'layname';
      field.value = L.name;
      field.maxLength = 60;
      field.setAttribute('aria-label', 'Layer name');
      lab.replaceWith(field);
      renaming = L.id;
      let done = false;
      function finish(keep) {
        if (done) return;
        done = true;
        renaming = null;
        const name = field.value.trim().slice(0, 60);
        if (keep && name && name !== L.name) {
          L.name = name;
          X.updateMeta();
        }
        render();
      }
      field.addEventListener('keydown', function (e) {
        e.stopPropagation();               /* the app's own shortcuts stay out of the typing */
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      field.addEventListener('blur', function () { finish(true); });
      field.addEventListener('dblclick', function (e) { e.stopPropagation(); });
      field.focus();
      field.select();
    }

    function toggleLayer(id) {
      const L = layerOf(id);
      X.snapshot();
      L.hidden = !L.hidden;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) { if (layerIdOf(s) === L.id) s.hide = L.hidden; });
      });
      if (L.hidden) { S.sel = null; S.multi = null; }
      redrawEverywhere(); X.updateMeta(); X.syncMarkPop();
      render();
    }
    /* a mark shown again inside a hidden layer brings the layer back with it,
       otherwise the dot would say shown and the page would disagree */
    function toggleMark(it, idx) {
      const s = it.shapes[idx];
      if (!s) return;
      X.snapshot();
      s.hide = !s.hide;
      if (s.hide) { S.sel = null; S.multi = null; }
      else { const L = layerOf(layerIdOf(s)); if (L.hidden) L.hidden = false; }
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
      render();
    }

    /* locking is its own flag, separate from a layer's hidden one — a layer
       can be locked and still shown, or hidden and still unlocked. Locking
       it locks every one of its members at once, the same way hiding does
       (core.js's setGroup, markUnder and beginDrag all skip a locked mark),
       and nothing selected on it survives the lock. */
    function toggleLayerLock(id) {
      const L = layerOf(id);
      X.snapshot();
      L.locked = !L.locked;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) { if (layerIdOf(s) === L.id) s.locked = L.locked; });
      });
      if (L.locked) { S.sel = null; S.multi = null; }
      X.updateMeta(); X.syncMarkPop();
      render();
    }
    /* a mark unlocked on its own brings its layer's own lock off with it,
       the same symmetry toggleMark keeps for hidden */
    function toggleMarkLock(it, idx) {
      const s = it.shapes[idx];
      if (!s) return;
      X.snapshot();
      s.locked = !s.locked;
      if (s.locked && S.sel && S.sel.it === it && S.sel.i === idx) { S.sel = null; S.multi = null; }
      else if (!s.locked) { const L = layerOf(layerIdOf(s)); if (L.locked) L.locked = false; }
      X.updateMeta(); X.syncMarkPop();
      render();
    }

    function select(it, idx) {
      X.setTool('select');
      X.setGroup(it, [idx]);
      X.drawShapes(it);
      X.syncMarkPop();
      render();
    }

    function toggleSelect(it, idx) {
      const now = S.sel && S.sel.it === it ? X.selList() : [];
      const k = now.indexOf(idx);
      if (k >= 0) now.splice(k, 1); else now.push(idx);
      X.setTool('select');
      X.setGroup(it, now);
      X.drawShapes(it);
      X.syncMarkPop();
      render();
    }

    /* the selection's own buttons, above the tree: they act on every mark
       selected, so two picked together move, copy or go together */
    panel.querySelector('.laysel').addEventListener('click', function (e) {
      const b = e.target.closest('[data-selact]');
      if (!b || b.disabled) return;
      const act = b.dataset.selact;
      if (!marksPicked()) {
        /* nothing selected on the page: Duplicate and Delete act on the
           layers picked out, or the active one */
        const ids = pickedLayers();
        if (act === 'dup') duplicateLayers(ids.length ? ids : [focusLayer]);
        else if (act === 'del') deleteLayer(ids.length ? ids : [focusLayer]);
        return;
      }
      if (act === 'up') X.stackSelected('up');
      else if (act === 'down') X.stackSelected('down');
      else if (act === 'dup') X.duplicateSelected();
      else if (act === 'del') X.deleteSelected();
      X.syncMarkPop();
      render();
    });
    /* how many unlocked marks are selected on the page shown */
    function marksPicked() {
      const it = S.items[S.current - 1];
      if (!S.sel || !it || S.sel.it !== it) return 0;
      return X.selList().filter(function (i) { return it.shapes[i] && !it.shapes[i].locked; }).length;
    }
    function paintSel(it, selected) {
      const n = selected.filter(function (i) { return it && it.shapes[i] && !it.shapes[i].locked; }).length;
      /* with no marks selected, the buttons are the picked layers', or the active one's */
      const ids = n ? [] : pickedLayers();
      const L = n ? null : layerOf(ids.length === 1 ? ids[0] : focusLayer);
      $('laySelLbl').textContent = n ? (n === 1 ? '1 selected' : n + ' selected')
        : ids.length > 1 ? ids.length + ' layers selected' : L.name;
      panel.querySelectorAll('[data-marks]').forEach(function (b) { b.disabled = !n; });
      const what = n ? (n === 1 ? 'the selected mark' : 'the ' + n + ' selected marks')
        : ids.length > 1 ? 'the ' + ids.length + ' selected layers' : 'layer "' + L.name + '"';
      const leaves = n ? 1 : S.layers.length - Math.max(1, ids.length);
      $('layDup').disabled = false;
      $('layDup').title = 'Duplicate ' + what;
      $('layDup').setAttribute('aria-label', $('layDup').title);
      $('layDel').disabled = leaves < 1;
      $('layDel').title = leaves < 1 ? 'At least one layer has to stay' : 'Delete ' + what;
      $('layDel').setAttribute('aria-label', 'Delete ' + what);
      /* Merge says what it will do */
      let mergeWhat = 'Merge the active layer into another';
      if (n) {
        const layersOf = {};
        selected.forEach(function (i) { if (it.shapes[i]) layersOf[layerIdOf(it.shapes[i])] = 1; });
        mergeWhat = Object.keys(layersOf).length > 1 ? 'Merge the selected marks into one layer' : 'The selected marks are on one layer';
      } else if (ids.length > 1) mergeWhat = 'Merge the ' + ids.length + ' selected layers into one';
      paintOp(it, n ? selected.filter(function (i) { return it.shapes[i] && !it.shapes[i].locked; }) : null, ids);
      $('layMerge').title = mergeWhat;
      $('layMerge').setAttribute('aria-label', mergeWhat);
    }

    /* ---------------- drag and drop ----------------
       A mark's row dropped on a layer's row joins that layer, on top of what
       is already in it; dropped on another mark's row it lands next to that
       mark: on the row's upper half above it in the list (in front of it on
       the page), on its lower half below it (behind it). That moves it in the
       page's own stack (it.shapes) as well — the two orders are the same
       thing — so a mark can go anywhere, the bottom of a layer included. A
       line between the rows shows where it will land. A row that is part of
       the selection takes every selected mark with it, keeping their order. */
    let dragIdx = null, dragGroup = null;

    function clearOver() {
      Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('over', 'drop-above', 'drop-below'); });
    }
    host.addEventListener('dragstart', function (e) {
      const row = e.target.closest('.mrow[draggable]');
      if (!row) return;
      dragIdx = +row.dataset.idx;
      const it = S.items[S.current - 1];
      const now = S.sel && it && S.sel.it === it ? X.selList() : [];
      dragGroup = now.length > 1 && now.indexOf(dragIdx) >= 0
        ? now.filter(function (i) { return it.shapes[i] && !it.shapes[i].locked; }) : [dragIdx];
      dragGroup.forEach(function (i) {
        const r = host.querySelector('.mrow[data-idx="' + i + '"]');
        if (r) r.classList.add('dragging');
      });
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragIdx));
      } catch (err) { /* older engines refuse setData outside a user gesture */ }
    });
    host.addEventListener('dragend', function () { dragIdx = null; dragGroup = null; clearOver(); render(); });
    host.addEventListener('dragover', function (e) {
      if (dragIdx == null) return;
      const row = e.target.closest('.layrow');
      if (!row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      /* a mark's row: above or below it, by which half the pointer is on;
         a layer's row: into the layer */
      const cls = row.dataset.idx !== undefined ? (lowerHalf(row, e) ? 'drop-below' : 'drop-above') : 'over';
      if (!row.classList.contains(cls)) { clearOver(); row.classList.add(cls); }
    });
    function lowerHalf(row, e) {
      const r = row.getBoundingClientRect();
      return e.clientY > r.top + r.height / 2;
    }
    host.addEventListener('dragleave', function (e) {
      const row = e.target.closest('.layrow');
      if (row && !row.contains(e.relatedTarget)) row.classList.remove('over', 'drop-above', 'drop-below');
    });
    host.addEventListener('drop', function (e) {
      if (dragIdx == null) return;
      const row = e.target.closest('.layrow');
      if (!row) return;
      e.preventDefault();
      const group = dragGroup || [dragIdx];
      const below = row.dataset.idx !== undefined && lowerHalf(row, e);
      dragIdx = null; dragGroup = null; clearOver();
      drop(S.items[S.current - 1], group, row, below);
    });

    function drop(it, group, row, below) {
      group = (group || []).filter(function (i) { return it && it.shapes[i]; });
      if (!group.length) { render(); return; }
      const L = layerOf(row.dataset.lay);
      let at;
      if (row.dataset.idx !== undefined) {
        const onto = +row.dataset.idx;
        if (group.indexOf(onto) >= 0) { render(); return; }   /* dropped on itself */
        /* the list runs front to back: above a row is in front of its mark
           (after it in the stack), below is behind it (before it) */
        at = below ? onto : onto + 1;
      } else {
        /* a layer's own row, or its empty placeholder: on top of its members */
        let top = -1;
        it.shapes.forEach(function (x, i) {
          if (!NOT_SELECTABLE[x.t] && layerIdOf(x) === L.id && group.indexOf(i) < 0) top = i;
        });
        at = top >= 0 ? top + 1 : it.shapes.length;
      }
      const order = group.slice().sort(function (p, q) { return p - q; });
      const marks = order.map(function (i) { return it.shapes[i]; });
      const moving = marks.some(function (m) { return layerIdOf(m) !== L.id; });
      /* already a run in this layer, just where it would land: nothing to do */
      const run = order[order.length - 1] - order[0] === order.length - 1;
      if (!moving && run && at >= order[0] && at <= order[order.length - 1] + 1) { render(); return; }

      X.snapshot();
      const before = order.filter(function (i) { return i < at; }).length;
      for (let k = order.length - 1; k >= 0; k--) it.shapes.splice(order[k], 1);
      at -= before;
      if (at > it.shapes.length) at = it.shapes.length;
      Array.prototype.splice.apply(it.shapes, [at, 0].concat(marks));
      marks.forEach(function (m) {
        if (layerIdOf(m) !== L.id) { m.layer = L.id; m.hide = !!L.hidden; m.locked = !!L.locked; }
      });

      const shown = marks.map(function (m, k) { return m.hide ? -1 : at + k; })
        .filter(function (i) { return i >= 0; });
      if (shown.length) X.setGroup(it, shown); else { S.sel = null; S.multi = null; }
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
      render();
      if (moving) {
        X.toast((marks.length > 1 ? marks.length + ' marks moved' : 'Moved') + ' to <b>' + X.esc(L.name) + '</b>', true);
      }
    }

    /* ---------------- opacity ----------------
       One slider and its number, for the selected objects (their own
       opacity, as the Properties panel sets it) or, with none selected, the
       layers picked out (or the active layer). A drag of the slider is one
       undo step. */
    let opHeld = false;
    let opFor = null;                   /* what the slider is set for: {it, list} or {ids} */
    function paintOp(it, list, ids) {
      opFor = list && list.length ? { it: it, list: list } : { ids: ids && ids.length ? ids : [focusLayer] };
      let v, lbl;
      if (opFor.list) {
        v = X.shOp(it.shapes[opFor.list[0]]);
        lbl = opFor.list.length === 1 ? 'Object' : opFor.list.length + ' objects';
      } else {
        const L = layerOf(opFor.ids[0]);
        v = layerOpacity(L) == null ? 1 : layerOpacity(L);
        lbl = opFor.ids.length > 1 ? opFor.ids.length + ' layers' : 'Layer';
      }
      $('layOpLbl').textContent = lbl;
      $('layOpLbl').title = opFor.list ? 'The selected objects\' own opacity' : 'Fades everything on the layer';
      $('layOpRange').setAttribute('aria-label', lbl + ' opacity');
      const pc = Math.round(v * 100);
      if (!opHeld && document.activeElement !== $('layOpRange')) $('layOpRange').value = pc;
      if (document.activeElement !== $('layOpNum')) $('layOpNum').value = pc;
    }
    function setOpacity(pc, live) {
      const f = opFor;
      if (!f) return;
      const v = Math.max(0, Math.min(100, Math.round(pc))) / 100;
      if (!live || !opHeld) X.snapshot();
      if (live) opHeld = true;
      if (f.list) {
        f.list.forEach(function (i) {
          const s = f.it.shapes[i];
          if (!s || s.locked) return;
          if (v >= 1) delete s.o; else s.o = v;
        });
        X.drawShapes(f.it);
        if (!live) { X.drawThumb(f.it); X.updateMeta(); }
        X.syncMarkPop();
      } else {
        f.ids.forEach(function (id) { layerOf(id).opacity = v; });
        syncOpacity();
        if (!live) X.updateMeta();
      }
      $('layOpNum').value = Math.round(v * 100);
      render();
    }
    $('layOpRange').addEventListener('input', function () { setOpacity(+this.value, true); });
    $('layOpRange').addEventListener('change', function () {
      const was = opHeld;
      opHeld = false;
      if (was) {
        if (opFor && opFor.list) { X.drawThumb(opFor.it); }
        X.updateMeta();
      }
    });
    $('layOpNum').addEventListener('change', function () {
      const n = parseFloat(String(this.value).replace('%', ''));
      if (isNaN(n)) { render(); return; }
      setOpacity(n, false);
    });
    $('layOpNum').addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.dispatchEvent(new Event('change')); this.blur(); }
      else if (e.key === 'Escape') { this.blur(); render(); }
    });

    /* ---------------- keeping up with the page ---------------- */

    X.on('pages', function () { claimNew(); syncOpacity(); if (!panel.hidden) render(); });
    X.on('meta', function () { const a = claimNew(), b = syncOpacity(); if ((a || b) && !panel.hidden) render(); });
    X.on('reset', function () {
      panel.hidden = true; tab.classList.remove('on'); lastSig = null;
      S.layers = null; focusLayer = null;
      Object.keys(shut).forEach(function (k) { delete shut[k]; });
    });
    /* marks also arrive, move and vanish straight from the canvas (a drag, the
       Delete key, the Format panel's Bring to front…); a light poll claims the
       new ones for the active layer and catches the rest, the same 400ms tick
       the side rail (js/toolpanel.js) uses for its pressed state */
    setInterval(function () {
      const fresh = claimNew();
      if (!opHeld) syncOpacity();
      if (panel.hidden) return;
      const it = S.items[S.current - 1];
      if (fresh || sigOf(it) !== lastSig) render();
    }, 400);
  });
})();
