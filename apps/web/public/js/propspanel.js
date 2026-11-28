/* Add Dots PDF — the Properties panel, as Illustrator's: one panel whose
   contents follow what is in hand

   The panel itself is js/toolprops.js's (#railProps, on the right, opened
   from its icon). What it holds is unchanged: core's #markPop for the
   selection, with every module's own controls in it (the colour panel,
   Character and Paragraph, a rectangle's corners, Align, Transform…), and
   the tool's own options while a tool is in hand. This module only puts
   the selection's controls in Illustrator's order, under its headings, and
   fills the panel when nothing is selected:

   Nothing selected — Document (its file, pages and units), Artboard (the
              page in view: its size, turning it, the pasteboard, Crop),
              Background (the canvas colour round the pages), Rulers &
              Grids, Guides, Snap Options, Preferences (the Keyboard
              Increment), and Quick Actions (Select All).

   Something selected — Transform (js/move.js: X, Y, W, H, rotation,
              flip), Appearance (fill and stroke, the stroke's weight and
              style, opacity, a gradient), the kind's own section (a
              rectangle's corners, a path's points, text's Character and
              Paragraph, an image's pixels…), Align, and Quick Actions
              (arrange, group, duplicate, delete). With several selected
              core shows only what they all have, "Mixed" where they differ.

   A section with nothing to show for what is selected is left out. Every
   control keeps its own id and its own handler where it was made, so a
   change still goes through core's markEdit (one undo step each) and the
   page redraws at once. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[propspanel] core bridge missing'); return; }

  const KIND_NAME = {
    rect: 'Rectangle', ellipse: 'Ellipse', image: 'Image', pen: 'Path', vpath: 'Shape', poly: 'Continuous Line',
    line: 'Line', arrow: 'Arrow', dim: 'Dimension', dimr: 'Dimension', dimd: 'Dimension', dima: 'Dimension',
    dimx: 'Dimension', sig: 'Signature', stamp: 'Stamp', leader: 'Leader', cloud: 'Cloud', arc: 'Arc'
  };
  const CANVAS = [
    ['', 'Default', 'The interface\'s own'],
    ['white', 'White', 'White round the pages'],
    ['light', 'Light', 'Light grey'],
    ['dark', 'Dark', 'Dark grey, as Illustrator\'s canvas']
  ];

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* this session only */ } }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pop = $('markPop');
    if (!pop) return;

    /* ---------------- the selection: Illustrator's sections ---------------- */

    function section(id, title) {
      const sec = document.createElement('section');
      sec.className = 'ppsec'; sec.id = id;
      if (title != null) {
        const h = document.createElement('div');
        h.className = 'pphd'; h.textContent = title;
        sec.appendChild(h);
      }
      const body = document.createElement('div');
      body.className = 'ppbody';
      sec.appendChild(body);
      return { el: sec, body: body, head: sec.querySelector('.pphd') };
    }
    const head = document.createElement('div');
    head.className = 'pphead'; head.id = 'ppHead';
    const SEC = {
      transform: section('ppTransform', 'Transform'),
      appear: section('ppAppear', 'Appearance'),
      kind: section('ppKind', ''),
      align: section('ppAlign', null),
      quick: section('ppQuick', 'Quick Actions')
    };
    /* the elements each holds, by id, in order; whatever a module did not
       make (an older build, a phone) is passed over */
    const LAYOUT = {
      transform: ['mpMove'],
      appear: ['fsWrap', 'mpFillBtn', 'mpStrokeBtn', 'mpBgBtn', 'mpStyleWrap', 'mpWidthWrap', 'mpCapWrap', 'mpJoinWrap', '@mpOpacity', 'mpGrad'],
      kind: ['mpText', 'mpType', 'mpExt'],
      align: ['mpArrange'],
      quick: []
    };
    const byId = function (id) {
      /* '@id': the field's own row, the label it sits in */
      if (id[0] === '@') { const f = $(id.slice(1)); return f ? f.closest('.mfield') || f : null; }
      return $(id);
    };

    /* Quick Actions: core's own front, back and delete, with the rest of
       Illustrator's beside them */
    const ICON = {
      up: '<rect x="8" y="8" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/><path d="M12 2.5l2.5 2.5L12 7.5"/>',
      down: '<rect x="5" y="5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M19 9v9a1 1 0 0 1-1 1H9"/><path d="M12 21.5L9.5 19 12 16.5"/>',
      group: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5"/><rect x="7" y="7" width="5" height="5"/><rect x="12" y="12" width="5" height="5"/>',
      ungroup: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
      dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'
    };
    function qbtn(id, title, icon) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn mpstack ppq'; b.id = id; b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = '<svg viewBox="0 0 24 24">' + ICON[icon] + '</svg>';
      return b;
    }
    const qUp = qbtn('ppForward', 'Bring forward (one step)', 'up');
    const qDown = qbtn('ppBackward', 'Send backward (one step)', 'down');
    const qGroup = qbtn('ppGroup', 'Group (Ctrl+G)', 'group');
    const qUngroup = qbtn('ppUngroup', 'Ungroup (Ctrl+Shift+G)', 'ungroup');
    const qDup = qbtn('ppDup', 'Duplicate (Ctrl+D)', 'dup');
    qUp.addEventListener('click', function () { if (X.stackSelected('up')) after(); });
    qDown.addEventListener('click', function () { if (X.stackSelected('down')) after(); });
    qGroup.addEventListener('click', function () { X.groupSelected(); after(); });
    qUngroup.addEventListener('click', function () { X.ungroupSelected(); after(); });
    qDup.addEventListener('click', function () { X.duplicateSelected(); after(); });
    function after() { X.redrawAll(); X.syncMarkPop(); }
    const quickRow = document.createElement('div');
    quickRow.className = 'ppqrow';
    const arrange = document.createElement('div');
    arrange.className = 'ppqgrp'; arrange.setAttribute('role', 'group'); arrange.setAttribute('aria-label', 'Arrange');
    const grouping = document.createElement('div');
    grouping.className = 'ppqgrp'; grouping.setAttribute('role', 'group'); grouping.setAttribute('aria-label', 'Group');
    [[arrange, 'Arrange'], [grouping, 'Object']].forEach(function (g) {
      const l = document.createElement('span');
      l.className = 'ppql'; l.textContent = g[1];
      g[0].appendChild(l);
    });
    quickRow.appendChild(arrange); quickRow.appendChild(grouping);
    SEC.quick.body.appendChild(quickRow);

    let built = false;
    function build() {
      if (built) return;
      built = true;
      pop.classList.add('pp');
      const title = $('mpTitle');
      if (title) head.appendChild(title);
      pop.insertBefore(head, pop.firstChild);
      Object.keys(SEC).forEach(function (k) { pop.appendChild(SEC[k].el); });
      Object.keys(LAYOUT).forEach(function (k) {
        LAYOUT[k].forEach(function (id) { const el = byId(id); if (el) SEC[k].body.appendChild(el); });
      });
      /* the rotation, in Transform beside the flips */
      const ang = byId('@mpAngle'), slot = $('mvRotSlot');
      if (ang) (slot || SEC.transform.body).appendChild(ang);
      if (ang) { const lab = ang.querySelector('span'); if (lab) lab.textContent = 'Rotate'; }
      /* Move…'s own heading was "Transform": the section's now */
      const mvHd = $('mpMove') && $('mpMove').querySelector('.arhd');
      if (mvHd) mvHd.hidden = true;
      [$('mpFront'), qUp, qDown, $('mpBack')].forEach(function (b) { if (b) arrange.appendChild(b); });
      [qGroup, qUngroup, qDup, $('mpDel')].forEach(function (b) { if (b) grouping.appendChild(b); });
      /* what was left at the top level is the old popover's separators */
      Array.prototype.forEach.call(pop.querySelectorAll(':scope > .mdiv, :scope > #mpExtDiv'), function (d) { d.classList.add('ppgone'); });
      Array.prototype.forEach.call(pop.querySelectorAll(':scope > *'), function (el) {
        if (el === head || el.classList.contains('ppsec') || el.classList.contains('ppgone')) return;
        /* anything a module added that has no place above: its kind's section */
        SEC.kind.body.appendChild(el);
      });
    }

    /** an element is showing: not hidden, and not display:none */
    function shows(el) {
      if (!el || el.hidden) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none') return false;
      if (!el.children.length) return !!el.textContent.trim() || /^(INPUT|SELECT|BUTTON|TEXTAREA|CANVAS|SVG|IMG)$/i.test(el.tagName);
      return Array.prototype.some.call(el.children, shows) || /^(LABEL|BUTTON)$/i.test(el.tagName);
    }
    let pending = false;
    function soon() {
      if (pending) return;
      pending = true;
      Promise.resolve().then(function () { pending = false; arrangeNow(); });
    }
    /* only when it changes: re-setting an attribute is still a mutation,
       and the observer below would wake for it again, round and round */
    function hide(el, v) { if (el && el.hidden !== !!v) el.hidden = !!v; }
    function arrangeNow() {
      if (!built || pop.hidden) return;
      const kind = pop.dataset.kind || '';
      const count = +(pop.dataset.count || 1);
      /* the heading of the kind's own section: Text's sections are its own */
      const kname = kind === 'text' ? '' : KIND_NAME[kind] || (count === 1 && $('mpTitle') ? $('mpTitle').textContent : '');
      if (SEC.kind.head.textContent !== kname) SEC.kind.head.textContent = kname;
      hide(SEC.kind.head, !kname);
      /* Group only for several not already one group; Ungroup when a group is in it */
      const it = S.sel && S.sel.it;
      const list = it ? X.selList() : [];
      const anyGrp = list.some(function (i) { return it.shapes[i] && it.shapes[i].grp != null; });
      hide(qGroup, !(list.length > 1 && kind !== 'group'));
      hide(qUngroup, !anyGrp);
      /* the Fill and Border menus say again what the Fill and Stroke squares
         above them show: only where those are not (text's own colour) */
      const fs = $('fsWrap');
      const squares = !!fs && !fs.hidden;
      pop.classList.toggle('pp-fs', squares);
      /* a module's own little heading, where the section has one already */
      pop.classList.toggle('pp-named', !!kname);
      const sub = count > 1 ? count + ' objects' : '';
      if ($('ppHead').dataset.sub !== sub) $('ppHead').dataset.sub = sub;
      Object.keys(SEC).forEach(function (k) {
        const s = SEC[k];
        hide(s.el, !Array.prototype.some.call(s.body.children, shows));
      });
    }
    X.on('markpop', function (s) { if (s) { build(); soon(); } });
    if (window.MutationObserver) {
      new MutationObserver(soon).observe(pop, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    }

    /* ---------------- nothing selected: the document ---------------- */

    const host = $('railProps');
    const doc = document.createElement('div');
    doc.className = 'ppdoc'; doc.id = 'propsDoc'; doc.hidden = true;
    const sw = function (id, label, title) {
      return '<label class="ppsw" title="' + esc(title) + '"><span>' + esc(label) + '</span><input type="checkbox" role="switch" id="' + id + '"><i aria-hidden="true"></i></label>';
    };
    const row = function (label, value) { return '<div class="pprow"><span>' + label + '</span><b>' + value + '</b></div>'; };
    doc.innerHTML =
      '<section class="ppsec"><div class="pphd">Document</div><div class="ppbody">' +
        row('File', '<span id="pdName"></span>') +
        row('Pages', '<span id="pdPages"></span>') +
        '<label class="pprow"><span>Units</span><select id="pdUnits" aria-label="Units: rulers, Transform and Move"></select></label>' +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Artboard <span class="ppsub" id="pdPageNo"></span></div><div class="ppbody">' +
        row('Size', '<span id="pdSize"></span>') +
        row('Orientation', '<span id="pdOrient"></span>') +
        '<div class="ppbtns">' +
          '<button type="button" class="btn ppb" id="pdRotL" title="Turn this page a quarter to the left">⟲ 90°</button>' +
          '<button type="button" class="btn ppb" id="pdRotR" title="Turn this page a quarter to the right">⟳ 90°</button>' +
          '<button type="button" class="btn ppb" id="pdCrop" title="Crop the page: the artboard becomes what is kept (C)">Crop…</button>' +
        '</div>' +
        sw('pdBoard', 'Pasteboard', 'Room round each page to keep objects on, as Illustrator\'s; a standard PDF takes only what is on the page') +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Background</div><div class="ppbody">' +
        '<div class="pprow"><span>Canvas</span><div class="ppcanvas" id="pdCanvas" role="radiogroup" aria-label="Canvas colour">' +
          CANVAS.map(function (c) {
            return '<button type="button" role="radio" data-canvas="' + c[0] + '" title="' + esc(c[1] + ': ' + c[2]) + '" aria-label="' + esc(c[1]) + '"></button>';
          }).join('') +
        '</div></div>' +
        '<p class="ppnote">Round the pages on screen only; the pages themselves keep their own.</p>' +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Rulers &amp; Grids</div><div class="ppbody">' +
        sw('pdRulers', 'Rulers', 'Rulers along the top and left (Ctrl+R)') +
        sw('pdGrid', 'Grid', 'Gridlines behind the marks (Ctrl+\')') +
        sw('pdGridSnap', 'Snap to grid', 'Points and moved objects land on the grid (Ctrl+Shift+\')') +
        '<div class="ppbtns"><button type="button" class="btn ppb" id="pdGridSet" title="Gridline spacing and subdivisions">Grid spacing…</button></div>' +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Guides</div><div class="ppbody">' +
        row('On this page', '<span id="pdGuides"></span>') +
        '<p class="ppnote" id="pdGuideTip">Drag out of a ruler to make one.</p>' +
        '<div class="ppbtns"><button type="button" class="btn ppb" id="pdGuideClear">Clear guides</button></div>' +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Snap Options</div><div class="ppbody">' +
        sw('pdSnap', 'Snap to objects', 'Anchors, ends, middles, crossings, edges and guides (F3; Ctrl held lets go for a moment)') +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Preferences</div><div class="ppbody">' +
        '<label class="pprow" title="Keyboard Increment: how far an arrow key moves the selection (Shift: ten times, Alt: a copy)"><span>Arrow key step</span>' +
          '<span class="unit"><input id="mvInc" inputmode="decimal" autocomplete="off" aria-label="Keyboard increment"><em id="pdIncU"></em></span></label>' +
      '</div></section>' +
      '<section class="ppsec"><div class="pphd">Quick Actions</div><div class="ppbody"><div class="ppbtns">' +
        '<button type="button" class="btn ppb" id="pdSelAll" title="Select every object on this page (Ctrl+A)">Select All</button>' +
        '<button type="button" class="btn ppb" id="pdFit" title="Fit the page to the window">Fit Page</button>' +
      '</div></div></section>';
    const empty = $('propsEmpty');
    if (host) {
      if (empty && empty.parentNode === host) host.insertBefore(doc, empty.nextSibling); else host.appendChild(doc);
    }
    const q = function (id) { return doc.querySelector('#' + id); };

    function page() { return S.items[S.current - 1] || S.items[0] || null; }
    function unit() { return X.rulers ? X.rulers.unit() : 'pt'; }
    function per() { return X.rulers && X.rulers.per ? X.rulers.per() : 1; }
    function len(pt) {
      const v = pt * per(), dp = unit() === 'pt' ? 1 : unit() === 'in' ? 3 : unit() === 'mm' ? 1 : 2;
      return String(Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp));
    }
    const units = X.rulers && X.rulers.units ? X.rulers.units() : [{ id: 'pt', name: 'Points' }];
    q('pdUnits').innerHTML = units.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('');

    function snapBtn() { return $('snapOn'); }
    function canvas() { return document.body.dataset.canvas || ''; }

    function paintDoc() {
      if (doc.hidden) return;
      const it = page();
      q('pdName').textContent = X.docName ? X.docName() : '';
      q('pdName').title = q('pdName').textContent;
      q('pdPages').textContent = String(S.items.length);
      q('pdUnits').value = unit();
      q('pdPageNo').textContent = it ? 'Page ' + (S.items.indexOf(it) + 1) : '';
      const vp = it && it.vp;
      if (vp) {
        const w = vp.width / vp.scale, h = vp.height / vp.scale;
        q('pdSize').textContent = len(w) + ' × ' + len(h) + ' ' + unit();
        q('pdOrient').textContent = Math.abs(w - h) < 0.5 ? 'Square' : w > h ? 'Landscape' : 'Portrait';
      } else { q('pdSize').textContent = '—'; q('pdOrient').textContent = '—'; }
      q('pdBoard').checked = !!S.board;
      q('pdRulers').checked = !!(X.rulers && X.rulers.on());
      q('pdGrid').checked = !!(X.grid && X.grid.shown());
      q('pdGridSnap').checked = !!(X.grid && X.grid.snapping());
      const sb = snapBtn();
      q('pdSnap').checked = !!(sb && sb.classList.contains('on'));
      q('pdSnap').disabled = !sb;
      const n = it && it.guides ? it.guides.length : 0;
      q('pdGuides').textContent = n ? String(n) : 'None';
      q('pdGuideClear').disabled = !n;
      q('pdGuideTip').textContent = q('pdRulers').checked ? 'Drag out of a ruler to make one.' : 'Turn the rulers on, then drag out of one to make one.';
      const inc = q('mvInc');
      if (document.activeElement !== inc) inc.value = len(X.nudgeIncrement());
      q('pdIncU').textContent = unit();
      doc.querySelectorAll('[data-canvas]').forEach(function (b) {
        const on = b.dataset.canvas === canvas();
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      const selAll = it && it.shapes.some(function (s) { return !X.NOT_SELECTABLE[s.t] && !s.locked && !s.hide; });
      q('pdSelAll').disabled = !selAll;
    }
    X.propsDoc = { paint: paintDoc, el: doc };

    /* the canvas colour, kept for next time */
    function setCanvas(v) {
      if (v) document.body.dataset.canvas = v; else delete document.body.dataset.canvas;
      set('adpdf.canvas', v || '');
    }
    setCanvas(get('adpdf.canvas') || '');

    doc.addEventListener('change', function (e) {
      const id = e.target.id;
      if (id === 'pdUnits' && X.rulers) X.rulers.setUnit(e.target.value);
      else if (id === 'pdBoard') { if (!!S.board !== e.target.checked && $('btnBoard')) $('btnBoard').click(); }
      else if (id === 'pdRulers' && X.rulers) X.rulers.toggle(e.target.checked);
      else if (id === 'pdGrid' && X.grid) X.grid.show(e.target.checked);
      else if (id === 'pdGridSnap' && X.grid) X.grid.setSnap(e.target.checked);
      else if (id === 'pdSnap') { const b = snapBtn(); if (b && b.classList.contains('on') !== e.target.checked) b.click(); }
      else if (id === 'mvInc') commitInc(e.target);
      setTimeout(paintDoc, 0);
    });
    function commitInc(el) {
      const v = X.parseLen ? X.parseLen(el.value, X.nudgeIncrement()) : parseFloat(el.value);
      if (v != null && v > 0) X.nudgeIncrement(v);
      else X.toast('The increment: a length above 0, such as 1 pt or 0.5 mm', true);
      el.value = len(X.nudgeIncrement());
    }
    doc.addEventListener('keydown', function (e) {
      if (!e.target.matches('input')) return;
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitInc(e.target); e.target.dataset.done = '1'; e.target.blur(); delete e.target.dataset.done; }
      else if (e.key === 'Escape') { e.preventDefault(); e.target.value = len(X.nudgeIncrement()); e.target.blur(); }
    });
    doc.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const it = page(), i = it ? S.items.indexOf(it) : -1;
      if (b.dataset.canvas != null) setCanvas(b.dataset.canvas);
      else if (b.id === 'pdRotL' && i >= 0) X.rotateItem(i, -90);
      else if (b.id === 'pdRotR' && i >= 0) X.rotateItem(i, 90);
      else if (b.id === 'pdCrop') X.setTool('crop');
      else if (b.id === 'pdGridSet' && X.grid) X.grid.settings();
      else if (b.id === 'pdGuideClear' && it && X.rulers) X.rulers.clearGuides(it);
      else if (b.id === 'pdFit' && $('btnFitP')) $('btnFitP').click();
      else if (b.id === 'pdFit') { S.fit = 'page'; X.relayout(); }
      else if (b.id === 'pdSelAll' && it) {
        if (S.tool !== 'select') X.setTool('select');
        X.setGroup(it, it.shapes.map(function (s, k) { return X.NOT_SELECTABLE[s.t] ? -1 : k; }).filter(function (k) { return k >= 0; }));
        X.redrawAll();
        X.syncMarkPop();
      }
      setTimeout(paintDoc, 0);
    });

    /* it follows the document: the page in view, a turn, the zoom, the units */
    ['pages', 'layout', 'meta', 'board', 'units', 'tool', 'reset'].forEach(function (ev) { X.on(ev, function () { setTimeout(paintDoc, 0); }); });
    document.addEventListener('keyup', function () { if (!doc.hidden) setTimeout(paintDoc, 0); });
    /* the page in view changes as the pages scroll past */
    let scrollTick = 0;
    const stage = $('stage');
    if (stage) stage.addEventListener('scroll', function () {
      if (doc.hidden || scrollTick) return;
      scrollTick = setTimeout(function () { scrollTick = 0; paintDoc(); }, 200);
    }, { passive: true });
    const sb0 = snapBtn();
    if (sb0 && window.MutationObserver) new MutationObserver(paintDoc).observe(sb0, { attributes: true, attributeFilter: ['class'] });
    if (window.MutationObserver) {
      new MutationObserver(function () { if (!doc.hidden) paintDoc(); }).observe(doc, { attributes: true, attributeFilter: ['hidden'] });
      new MutationObserver(function () { if (!doc.hidden) paintDoc(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  });
})();
