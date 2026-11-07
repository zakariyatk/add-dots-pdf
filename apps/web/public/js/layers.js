/* Add Dots PDF — Layers
   ----------------------
   A panel listing every mark on the current page, topmost first — the way
   Illustrator's Layers panel lists a flat (ungrouped) artboard. Each row can
   be shown or hidden, duplicated, deleted, or moved up or down the stack; a
   click selects the mark on the page, the same as clicking it there.

   Nothing new is stored to make this work: a mark is already an ordinary
   entry in it.shapes (core.js), in the order it draws — last is topmost —
   so undo, Save and the thumbnails already follow every change made here.
   The one new field is `hide`, which core.js's renderer and the engine's
   save (packages/engine/src/save.ts) both already skip. */
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
      text: 'Text', leader: 'Leader'
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
      '<div id="layList"></div>';
    $('railPages').parentNode.appendChild(panel);

    function bodies() { return Array.prototype.slice.call(document.querySelectorAll('#rail > .rail-body')); }
    function showPanel() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!$('rail').hidden && !panel.hidden) { X.setRail(false); return; }
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

    /* ---------------- the list ---------------- */

    /* every selectable mark on the page, front of the stack first */
    function rows(it) {
      const out = [];
      it.shapes.forEach(function (s, idx) { if (!NOT_SELECTABLE[s.t]) out.push({ idx: idx, s: s }); });
      out.reverse();
      return out;
    }
    function sigOf(it) {
      if (!it) return '';
      return S.current + ':' + it.shapes.map(function (s) { return (s.hide ? '1' : '0'); }).join('') +
        ':' + (S.sel && S.sel.it === it ? S.sel.i : -1);
    }

    let lastSig = null;
    function render() {
      const it = S.items[S.current - 1];
      lastSig = sigOf(it);
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
        return '<div class="layrow' + (hid ? ' hid' : '') + (sel ? ' sel' : '') + '" data-idx="' + r.idx + '">' +
          '<button type="button" class="layeye" data-act="eye" title="' + (hid ? 'Show' : 'Hide') +
            '" aria-label="' + (hid ? 'Show' : 'Hide') + '">' + (hid ? EYE_OFF : EYE_ON) + '</button>' +
          '<i class="layswatch" style="background:' + X.esc(swatch(s)) + '"></i>' +
          '<span class="laylabel">' + X.esc(label(s)) + '</span>' +
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
          const act = e.target.closest('[data-act]');
          if (act) { e.stopPropagation(); if (!act.disabled) doAction(it, idx, act.dataset.act); return; }
          select(it, idx);
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
    X.on('reset', function () { panel.hidden = true; tab.classList.remove('on'); lastSig = null; });
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
