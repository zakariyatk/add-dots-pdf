/* Add Dots PDF — Layers
   ----------------------
   A panel listing every mark on the current page, topmost first — the way
   Illustrator's Layers panel lists a flat (ungrouped) artboard. Each row can
   be shown or hidden, duplicated, deleted, or moved up or down the stack; a
   click selects the mark on the page, the same as clicking it there.

   On top of that, a document-wide set of named layers (the bar above the
   list): every mark belongs to one (S.layers, s.layer — a mark with none is
   the first layer's), picked per row from a small dropdown there. The bar
   itself picks which layer is "focused" — hide it, rename it, merge it into
   another, or filter the list down to just its marks. A layer's hide is the
   same per-mark `hide` flag the eye button above sets, applied to every one
   of its members at once; there is nothing else to serialize, so Save needs
   no changes for either feature.

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
      note: 'Note', stamp: 'Stamp', vpath: 'Shape', sig: 'Signature',
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
    const EYE_ON = icon('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
    const EYE_OFF = icon('<path d="M3 3l18 18"/><path d="M10.6 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a15.5 15.5 0 0 1-3.1 4"/>' +
      '<path d="M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7a9.5 9.5 0 0 0 3.3-.6"/><path d="M9.5 9.8a3 3 0 0 0 4.2 4.2"/>');
    const UP = icon('<polyline points="18 15 12 9 6 15"/>');
    const DOWN = icon('<polyline points="6 9 12 15 18 9"/>');
    const DUP = icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 15V6a2 2 0 0 1 2-2h9"/>');
    const DEL = icon('<path d="M4 7h16"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>' +
      '<path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/>');
    const PENCIL = icon('<path d="M4 20h4L19 9l-4-4L4 16z"/>');
    const PLUS = icon('<path d="M12 4v16M4 12h16"/>');
    const MERGE = icon('<path d="M7 3v8a4 4 0 0 0 4 4h6"/><path d="M17 3v8a4 4 0 0 1-4 4h-1"/>' +
      '<polyline points="14 12 17 15 20 12"/>');
    /* a selection dropping into a layer: the same "add to layer" glyph
       Photoshop's own panel uses */
    const ADDSEL = icon('<path d="M12 3v9"/><polyline points="8.2 8.2 12 12 15.8 8.2"/>' +
      '<path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>');

    /* ---------------- layers ----------------
       A layer is just a name shapes can carry (s.layer, a layer's own id):
       organisational, not a PDF concept — a layer's "hide" works the same
       way a mark's own does (s.hide), which core.js's renderer and the
       engine's save already skip, so hiding a layer is only ever setting
       that flag on its members. A shape with no s.layer belongs to the
       first layer, so every shape has one without every tool that creates
       a mark (annotate.js, insert.js, …) needing to know layers exist. */
    let focusLayer = null;              /* the layer id picked in the bar below */
    let onlyThisLayer = false;          /* the list filtered to just it */
    let layerSeq = 1;

    function ensureLayers() {
      if (!S.layers || !S.layers.length) { S.layers = [{ id: 'L0', name: 'Layer 1', hidden: false }]; layerSeq = 1; }
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
      '<div class="laygroupbar" id="layGroupBar" style="display:flex;align-items:center;gap:4px;padding:4px 8px;">' +
        '<select id="layPick" aria-label="Layer" style="flex:1;min-width:0;"></select>' +
        '<button type="button" id="layEye" title="Show or hide this layer" aria-label="Show or hide this layer">' + EYE_ON + '</button>' +
        '<button type="button" id="layRename" title="Rename this layer" aria-label="Rename this layer">' + PENCIL + '</button>' +
        '<button type="button" id="layAdd" title="New layer" aria-label="New layer">' + PLUS + '</button>' +
        '<button type="button" id="layMerge" title="Merge this layer into another" aria-label="Merge into…">' + MERGE + '</button>' +
      '</div>' +
      '<div class="laygroupbar" id="layAddSelBar" style="display:flex;align-items:center;gap:6px;padding:0 8px 6px;">' +
        '<button type="button" class="layaddsel" id="layAddSel" disabled ' +
          'title="Add the marks selected on the page to the layer picked above" ' +
          'aria-label="Add selection to this layer">' + ADDSEL + '<span>Add selection to layer</span></button>' +
      '</div>' +
      '<label class="layfilter" style="display:flex;align-items:center;gap:6px;padding:0 8px 6px;font-size:12px;">' +
        '<input type="checkbox" id="layFilter"><span>This layer only</span></label>' +
      '<div id="layList"></div>';
    $('railPages').parentNode.appendChild(panel);

    /* the marks selected on the page right now, wherever that selection was
       made (the canvas, a marquee, Ctrl+click) — not just a row clicked
       here, which is the point: pick several things up on the page, then
       drop them in a layer in one click, the way Photoshop's panel does. */
    function pageSelection() {
      if (!S.sel || !S.sel.it) return null;
      const it = S.sel.it, list = X.selList().filter(function (i) { return it.shapes[i]; });
      return list.length ? { it: it, list: list } : null;
    }
    function syncAddSelBtn() {
      const sel = pageSelection();
      const btn = $('layAddSel');
      btn.disabled = !sel;
      btn.title = sel
        ? 'Add ' + (sel.list.length > 1 ? sel.list.length + ' selected marks' : 'the selected mark') +
          ' to the layer picked above'
        : 'Select one or more marks on the page first';
    }
    function renderLayerBar() {
      ensureLayers();
      $('layPick').innerHTML = S.layers.map(function (l) {
        return '<option value="' + l.id + '"' + (l.id === focusLayer ? ' selected' : '') + '>' +
          X.esc(l.name) + (l.hidden ? ' (hidden)' : '') + '</option>';
      }).join('');
      const L = layerOf(focusLayer);
      $('layEye').innerHTML = L.hidden ? EYE_OFF : EYE_ON;
      $('layEye').title = L.hidden ? 'Show this layer' : 'Hide this layer';
      $('layMerge').disabled = S.layers.length < 2;
      $('layFilter').checked = onlyThisLayer;
      $('layAdd').title = pageSelection() ? 'New layer from the selected marks' : 'New layer';
      syncAddSelBtn();
    }

    $('layPick').addEventListener('change', function () {
      focusLayer = this.value;
      renderLayerBar();
      render();
    });
    $('layEye').addEventListener('click', function () {
      const L = layerOf(focusLayer);
      X.snapshot();
      L.hidden = !L.hidden;
      S.items.forEach(function (it) {
        it.shapes.forEach(function (s) { if (layerIdOf(s) === L.id) s.hide = L.hidden; });
      });
      if (L.hidden) { S.sel = null; S.multi = null; }
      redrawEverywhere(); X.updateMeta();
      renderLayerBar(); render();
    });
    $('layRename').addEventListener('click', function () {
      const L = layerOf(focusLayer);
      const name = window.prompt('Rename this layer', L.name);
      if (!name || !name.trim()) return;
      L.name = name.trim().slice(0, 60);
      renderLayerBar(); render();
    });
    $('layAdd').addEventListener('click', function () {
      ensureLayers();
      layerSeq++;
      const L = { id: 'L' + Date.now().toString(36) + layerSeq, name: 'Layer ' + layerSeq, hidden: false };
      S.layers.push(L);
      focusLayer = L.id;
      /* marks already picked up on the page land straight in the new layer,
         the way "New layer from selection" works elsewhere */
      const sel = pageSelection();
      if (sel) {
        X.snapshot();
        sel.list.forEach(function (i) { const s = sel.it.shapes[i]; if (s) s.layer = L.id; });
        X.updateMeta();
      }
      renderLayerBar(); render();
      X.toast(sel
        ? '<b>' + X.esc(L.name) + '</b> added — ' + sel.list.length +
          (sel.list.length > 1 ? ' marks moved into it' : ' mark moved into it')
        : '<b>' + X.esc(L.name) + '</b> added — move marks into it from the list below');
    });
    $('layAddSel').addEventListener('click', function () {
      const sel = pageSelection();
      if (!sel) { X.toast('Select one or more marks on the page first'); return; }
      const L = layerOf(focusLayer);
      X.snapshot();
      sel.list.forEach(function (i) { const s = sel.it.shapes[i]; if (s) s.layer = L.id; });
      X.updateMeta();
      renderLayerBar(); render();
      X.toast((sel.list.length > 1 ? sel.list.length + ' marks' : '1 mark') +
        ' added to <b>' + X.esc(L.name) + '</b>');
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
        it.shapes.forEach(function (s) { if (layerIdOf(s) === source.id) s.layer = target.id; });
      });
      S.layers = S.layers.filter(function (l) { return l.id !== source.id; });
      focusLayer = target.id;
      redrawEverywhere(); X.updateMeta();
      renderLayerBar(); render();
      X.toast('Merged into <b>' + X.esc(target.name) + '</b>');
    });
    $('layFilter').addEventListener('change', function () {
      onlyThisLayer = this.checked;
      render();
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
      renderLayerBar();
      render();
    }
    tab.addEventListener('click', showPanel);
    /* any other tab hides this one, the way Bookmarks does for theirs */
    document.querySelectorAll('.rail-tabs .btn:not(#railClose)').forEach(function (t) {
      if (t === tab) return;
      t.addEventListener('click', function () { panel.hidden = true; tab.classList.remove('on'); });
    });

    /* ---------------- the list ---------------- */

    /* every selectable mark on the page, front of the stack first — just
       the focused layer's, while "This layer only" is checked */
    function rows(it) {
      const out = [];
      it.shapes.forEach(function (s, idx) {
        if (NOT_SELECTABLE[s.t]) return;
        if (onlyThisLayer && layerIdOf(s) !== focusLayer) return;
        out.push({ idx: idx, s: s });
      });
      out.reverse();
      return out;
    }
    function sigOf(it) {
      if (!it) return '';
      const multi = S.multi && S.multi.it === it ? S.multi.idx.join(',') : '';
      return S.current + ':' + it.shapes.map(function (s) { return (s.hide ? '1' : '0'); }).join('') +
        ':' + (S.sel && S.sel.it === it ? S.sel.i : -1) + ':' + multi;
    }

    let lastSig = null;
    function render() {
      const it = S.items[S.current - 1];
      lastSig = sigOf(it);
      syncAddSelBtn();
      const host = $('layList');
      if (!it) { host.innerHTML = ''; $('layCount').textContent = ''; return; }
      const list = rows(it);
      $('layCount').textContent = list.length ? list.length + ' on page ' + S.current : 'Page ' + S.current;
      if (!list.length) {
        host.innerHTML = '<div class="layempty">No marks on this page yet.<br><br>' +
          'Draw a box, line, or sign the page — each one lands here, with show/hide, duplicate ' +
          'and front-to-back ordering, the way Illustrator’s Layers panel works.</div>';
        return;
      }
      const it0 = list[0].idx, itN = list[list.length - 1].idx;
      host.innerHTML = list.map(function (r) {
        const s = r.s, hid = !!s.hide, sel = S.sel && S.sel.it === it && S.sel.i === r.idx;
        const rowLayer = layerIdOf(s);
        const layerPick = '<select class="rowlayer" data-idx="' + r.idx + '" title="Move to layer" ' +
          'aria-label="Layer, for this mark" style="max-width:72px;font-size:11px;">' +
          S.layers.map(function (l) {
            return '<option value="' + l.id + '"' + (l.id === rowLayer ? ' selected' : '') + '>' +
              X.esc(l.name) + '</option>';
          }).join('') + '</select>';
        return '<div class="layrow' + (hid ? ' hid' : '') + (sel ? ' sel' : '') + '" data-idx="' + r.idx + '">' +
          '<button type="button" class="layeye" data-act="eye" title="' + (hid ? 'Show' : 'Hide') +
            '" aria-label="' + (hid ? 'Show' : 'Hide') + '">' + (hid ? EYE_OFF : EYE_ON) + '</button>' +
          '<i class="layswatch" style="background:' + X.esc(swatch(s)) + '"></i>' +
          '<span class="laylabel">' + X.esc(label(s)) + '</span>' +
          (S.layers.length > 1 ? layerPick : '') +
          '<span class="laybtns">' +
            '<button type="button" data-act="up"' + (r.idx === it0 ? ' disabled' : '') +
              ' title="Bring forward" aria-label="Bring forward">' + UP + '</button>' +
            '<button type="button" data-act="down"' + (r.idx === itN ? ' disabled' : '') +
              ' title="Send backward" aria-label="Send backward">' + DOWN + '</button>' +
            '<button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate">' + DUP + '</button>' +
            '<button type="button" class="laydel" data-act="del" title="Delete" aria-label="Delete">' + DEL + '</button>' +
          '</span></div>';
      }).join('');
      Array.prototype.forEach.call(host.children, function (el) {
        const idx = +el.dataset.idx;
        el.addEventListener('click', function (e) {
          if (e.target.closest('.rowlayer')) { e.stopPropagation(); return; }
          const act = e.target.closest('[data-act]');
          if (act) { e.stopPropagation(); if (!act.disabled) doAction(it, idx, act.dataset.act); return; }
          select(it, idx);
        });
        const picker = el.querySelector('.rowlayer');
        if (picker) picker.addEventListener('change', function () {
          X.snapshot();
          it.shapes[idx].layer = this.value;
          X.updateMeta();
          render();
        });
      });
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
      if (act === 'eye') {
        X.snapshot();
        const s = it.shapes[idx];
        s.hide = !s.hide;
        if (s.hide) { S.sel = null; S.multi = null; }
        X.drawShapes(it); X.updateMeta();
      } else if (act === 'up') { X.stackSelected('up'); }
      else if (act === 'down') { X.stackSelected('down'); }
      else if (act === 'dup') { X.duplicateSelected(); }
      else if (act === 'del') { X.deleteSelected(); }
      X.syncMarkPop();
      render();
    }

    X.on('pages', function () { if (!panel.hidden) render(); });
    X.on('reset', function () {
      panel.hidden = true; tab.classList.remove('on'); lastSig = null;
      S.layers = null; focusLayer = null; onlyThisLayer = false;
    });
    /* the stack and selection also change straight from the canvas (drag,
       Delete key, the Format panel's Bring to front…); a light poll catches
       those while the panel is actually open, same as the side rail's own
       400ms tick (js/toolpanel.js) for its pressed state */
    setInterval(function () {
      if (panel.hidden) return;
      const it = S.items[S.current - 1];
      if (sigOf(it) !== lastSig) render();
    }, 400);
  });
})();
