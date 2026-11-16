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
   the engine's save (packages/engine/src/save.ts) both already skip. */
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
        '<button type="button" class="laydanger" id="layDel" title="Delete the active layer" aria-label="Delete layer">' + DEL + '</button>' +
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
    $('layRename').addEventListener('click', function () {
      const L = layerOf(focusLayer);
      const name = window.prompt('Rename this layer', L.name);
      if (!name || !name.trim()) return;
      L.name = name.trim().slice(0, 60);
      render();
    });
    $('layMerge').addEventListener('click', function () {
      const source = layerOf(focusLayer);
      const others = ensureLayers().filter(function (l) { return l.id !== source.id; });
      if (!others.length) { X.toast('There is only one layer'); return; }
      const listing = others.map(function (l, i) { return (i + 1) + '. ' + l.name; }).join('\n');
      const ans = window.prompt('Merge "' + source.name + '" into which layer?\n\n' + listing +
        '\n\nType its number.', '1');
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
    });
    /* Illustrator's own rule: deleting a layer deletes what is on it, so the
       marks go with it — after saying how many, and undoably */
    $('layDel').addEventListener('click', function () {
      ensureLayers();
      if (S.layers.length < 2) { X.toast('The last layer cannot be deleted'); return; }
      const L = layerOf(focusLayer);
      let n = 0;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) { if (layerIdOf(s) === L.id) n++; });
      });
      if (n && !window.confirm('Delete "' + L.name + '" and the ' + n +
        (n === 1 ? ' mark on it?' : ' marks on it?'))) return;
      X.snapshot();
      S.items.forEach(function (it) {
        it.shapes = it.shapes.filter(function (s) { return layerIdOf(s) !== L.id; });
      });
      S.layers = S.layers.filter(function (l) { return l.id !== L.id; });
      S.sel = null; S.multi = null;
      focusLayer = S.layers[0].id;
      redrawEverywhere(); X.updateMeta(); X.syncMarkPop();
      render();
      X.toast('<b>' + X.esc(L.name) + '</b> deleted');
    });

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
        return (s.hide ? '1' : '0') + (s.locked ? '1' : '0') + (s.layer || '-');
      }).join('|');
      const lay = (S.layers || []).map(function (l) {
        return l.id + l.name + (l.hidden ? '1' : '0') + (l.locked ? '1' : '0');
      }).join('|');
      return S.current + ':' + marks + ':' + lay + ':' + focusLayer +
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
    function render() {
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
      $('layDel').disabled = S.layers.length < 2;

      /* newest layer at the top, the way the stack reads everywhere else */
      let h = '';
      S.layers.slice().reverse().forEach(function (L) {
        const list = map[L.id] || [], open = !shut[L.id], active = L.id === focusLayer;
        h += '<div class="layrow layhead' + (active ? ' active' : '') + (L.hidden ? ' hid' : '') +
            (L.locked ? ' locked' : '') + '" data-lay="' + L.id + '">' +
          dot(!L.hidden, L.hidden ? 'Show this layer' : 'Hide this layer') +
          lockBtn(!!L.locked, L.locked ? 'Unlock this layer' : 'Lock this layer') +
          '<button type="button" class="laytwist" data-act="twist" aria-label="' +
            (open ? 'Collapse' : 'Expand') + '">' + (open ? TWIST_OPEN : TWIST_SHUT) + '</button>' +
          '<i class="laystrip" style="background:' + X.esc(L.color) + '"></i>' +
          '<span class="laylabel">' + X.esc(L.name) + '</span>' +
          '<span class="laynum">' + list.length + '</span>' +
          '<span class="laypen" title="New marks land here">' + (active ? PENCIL : '') + '</span>' +
          '</div>';
        if (!open) return;
        if (!list.length) {
          h += '<div class="layrow mrow laynone" data-lay="' + L.id + '">Empty — drag marks here</div>';
          return;
        }
        const top = list[0].idx, bottom = list[list.length - 1].idx;
        list.forEach(function (r) {
          const s = r.s, hid = !!s.hide, lck = !!s.locked, sel = S.sel && S.sel.it === it && S.sel.i === r.idx;
          h += '<div class="layrow mrow' + (hid ? ' hid' : '') + (lck ? ' locked' : '') + (sel ? ' sel' : '') +
              '" data-lay="' + L.id + '" data-idx="' + r.idx + '" draggable="' + (lck ? 'false' : 'true') + '">' +
            dot(!hid, hid ? 'Show' : 'Hide') +
            lockBtn(lck, lck ? 'Unlock' : 'Lock') +
            '<i class="layswatch" style="background:' + X.esc(swatch(s)) + '"></i>' +
            '<span class="laylabel">' + X.esc(label(s)) + '</span>' +
            '<span class="laybtns">' +
              '<button type="button" data-act="up"' + (r.idx === top || lck ? ' disabled' : '') +
                ' title="Bring forward" aria-label="Bring forward">' + UP + '</button>' +
              '<button type="button" data-act="down"' + (r.idx === bottom || lck ? ' disabled' : '') +
                ' title="Send backward" aria-label="Send backward">' + DOWN + '</button>' +
              '<button type="button" data-act="dup"' + (lck ? ' disabled' : '') +
                ' title="Duplicate" aria-label="Duplicate">' + DUP + '</button>' +
              '<button type="button" class="laydel" data-act="del"' + (lck ? ' disabled' : '') +
                ' title="Delete" aria-label="Delete">' + DEL + '</button>' +
            '</span></div>';
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
        focusLayer = row.dataset.lay;
        render();
        return;
      }
      if (act && !act.disabled) { doAction(it, +row.dataset.idx, act.dataset.act); return; }
      select(it, +row.dataset.idx);
    });

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

    function doAction(it, idx, act) {
      X.setTool('select');
      X.setGroup(it, [idx]);
      if (act === 'up') { X.stackSelected('up'); }
      else if (act === 'down') { X.stackSelected('down'); }
      else if (act === 'dup') { X.duplicateSelected(); }
      else if (act === 'del') { X.deleteSelected(); }
      X.syncMarkPop();
      render();
    }

    /* ---------------- drag and drop ----------------
       A mark's row dropped on a layer's row joins that layer, on top of what
       is already in it; dropped on another mark's row it lands in front of
       that mark, which moves it in the page's own stack (it.shapes) as well —
       the two orders are the same thing. */
    let dragIdx = null;

    function clearOver() {
      Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('over'); });
    }
    host.addEventListener('dragstart', function (e) {
      const row = e.target.closest('.mrow[draggable]');
      if (!row) return;
      dragIdx = +row.dataset.idx;
      row.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragIdx));
      } catch (err) { /* older engines refuse setData outside a user gesture */ }
    });
    host.addEventListener('dragend', function () { dragIdx = null; clearOver(); render(); });
    host.addEventListener('dragover', function (e) {
      if (dragIdx == null) return;
      const row = e.target.closest('.layrow');
      if (!row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('over')) { clearOver(); row.classList.add('over'); }
    });
    host.addEventListener('dragleave', function (e) {
      const row = e.target.closest('.layrow');
      if (row && !row.contains(e.relatedTarget)) row.classList.remove('over');
    });
    host.addEventListener('drop', function (e) {
      if (dragIdx == null) return;
      const row = e.target.closest('.layrow');
      if (!row) return;
      e.preventDefault();
      const from = dragIdx;
      dragIdx = null; clearOver();
      drop(S.items[S.current - 1], from, row);
    });

    function drop(it, from, row) {
      if (!it || !it.shapes[from]) { render(); return; }
      const s = it.shapes[from];
      const L = layerOf(row.dataset.lay);
      const was = layerIdOf(s);
      let at;
      if (row.dataset.idx !== undefined) {
        const onto = +row.dataset.idx;
        if (onto === from) { render(); return; }
        at = onto + 1;                      /* in front of the mark dropped on */
      } else {
        /* a layer's own row, or its empty placeholder: on top of its members */
        let top = -1;
        it.shapes.forEach(function (x, i) {
          if (!NOT_SELECTABLE[x.t] && layerIdOf(x) === L.id) top = i;
        });
        at = top >= 0 ? top + 1 : it.shapes.length;
      }
      if (was === L.id && (at === from || at === from + 1)) { render(); return; }

      X.snapshot();
      it.shapes.splice(from, 1);
      if (from < at) at--;
      if (at > it.shapes.length) at = it.shapes.length;
      it.shapes.splice(at, 0, s);
      if (was !== L.id) { s.layer = L.id; s.hide = !!L.hidden; s.locked = !!L.locked; }

      if (s.hide) { S.sel = null; S.multi = null; } else { X.setGroup(it, [at]); }
      X.drawShapes(it); X.drawThumb(it); X.updateMeta(); X.syncMarkPop();
      render();
      if (was !== L.id) X.toast('Moved to <b>' + X.esc(L.name) + '</b>');
    }

    /* ---------------- keeping up with the page ---------------- */

    X.on('pages', function () { claimNew(); if (!panel.hidden) render(); });
    X.on('meta', function () { if (claimNew() && !panel.hidden) render(); });
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
      if (panel.hidden) return;
      const it = S.items[S.current - 1];
      if (fresh || sigOf(it) !== lastSig) render();
    }, 400);
  });
})();
