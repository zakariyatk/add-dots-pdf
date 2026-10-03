/* ADD DOTS PDF — Organize & combine
   ---------------------------------
   Drag-to-reorder thumbnails, an Organize Pages grid, merge, insert pages
   from another PDF, split, duplicate and page-range selection.

   Page order is just the order of S.items, so every operation here is a
   splice plus a call to X.syncAll(). Undo comes free from core's snapshot. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[organize] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$, PDFLib = X.PDFLib, pdfjsLib = X.pdfjsLib;
    const E = window.ADDPDFEngine;

    /* ---------------- ribbon buttons ---------------- */

    const panPage = $('panPage');

    function group(id) {
      const sep = document.createElement('span'); sep.className = 'sep';
      const g = document.createElement('div'); g.className = 'grp'; g.id = id;
      panPage.appendChild(sep); panPage.appendChild(g);
      return g;
    }
    function button(host, id, label, title, path, fn, primary) {
      const b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.id = id; b.title = title; b.dataset.label = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = '<svg viewBox="0 0 24 24">' + path + '</svg><span class="lbl">' + label + '</span>';
      b.addEventListener('click', fn);
      host.appendChild(b);
      return b;
    }

    const gOrg = group('grpOrganize');
    button(gOrg, 'btnOrganize', 'Organize', 'Organize pages — drag to reorder (Shift+O)',
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
      openOrganize);

    const gComb = group('grpCombine');
    button(gComb, 'btnMerge', 'Merge', 'Append another PDF to the end of this one',
      '<path d="M9 3H5a2 2 0 0 0-2 2v6"/><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M3 11v2"/>',
      function () { pickPdf('append'); });
    button(gComb, 'btnInsert', 'Insert', 'Insert another PDF after the current page',
      '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
      function () { pickPdf('insert'); });
    button(gComb, 'btnDuplicate', 'Duplicate', 'Make a copy of the current page',
      '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      duplicatePage);
    button(gComb, 'btnSplit', 'Split', 'Split this document into separate files',
      '<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="3 3"/><path d="M8 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3"/>' +
      '<path d="M16 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3"/>',
      openSplit);

    /* a hidden picker of our own so we never fight core over its file inputs */
    const pdfIn = document.createElement('input');
    pdfIn.type = 'file'; pdfIn.accept = 'application/pdf,.pdf'; pdfIn.multiple = true; pdfIn.hidden = true;
    document.body.appendChild(pdfIn);
    let pickMode = 'append';
    function pickPdf(mode) {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      pickMode = mode; pdfIn.value = ''; pdfIn.click();
    }

    pdfIn.addEventListener('change', async function (e) {
      const files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      let added = 0, failed = 0;
      X.snapshot();
      for (const f of files) {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const src = await X.addSource(f.name, bytes);
          const items = [];
          for (let i = 1; i <= src.doc.numPages; i++) items.push(X.newItem(src, i, 0, true));
          if (pickMode === 'append') S.items.push.apply(S.items, items);
          else S.items.splice(S.current, 0, ...items);
          added += items.length;
        } catch (err) { failed++; }
      }
      if (!added) { X.toast('Nothing could be added — those files could not be opened'); return; }
      X.invalidateSearch();
      await X.syncAll();
      X.toast('<b>' + added + '</b> page' + (added === 1 ? '' : 's') + ' ' +
        (pickMode === 'append' ? 'appended' : 'inserted') +
        (failed ? ' · ' + failed + ' file' + (failed === 1 ? '' : 's') + ' could not be opened' : '') +
        ' · <b>Ctrl+Z</b> to undo');
    });

    async function duplicatePage() {
      const i = S.current - 1, it = S.items[i];
      if (!it) return;
      X.snapshot();
      const copy = X.newItem(it.src, it.num, it.rot, true);
      copy.crop = it.crop ? Object.assign({}, it.crop) : null;
      copy.shapes = it.shapes.map(function (s) { return JSON.parse(JSON.stringify(s)); });
      S.items.splice(i + 1, 0, copy);
      X.invalidateSearch();
      await X.syncAll();
      X.goTo(i + 2);
      X.toast('Page duplicated · <b>Ctrl+Z</b> to undo');
    }

    /* ---------------- split ---------------- */

    const splitPop = document.createElement('div');
    splitPop.className = 'pop'; splitPop.id = 'splitPop'; splitPop.hidden = true;
    splitPop.innerHTML =
      '<h3>Split this document</h3>' +
      '<div class="optlist">' +
        '<label class="opt">' +
          '<input type="radio" name="splitHow" value="each" checked>' +
          '<span class="optlabel">One file per page</span>' +
        '</label>' +
        '<label class="opt">' +
          '<input type="radio" name="splitHow" value="every">' +
          '<span class="optlabel">Every</span>' +
          '<input id="splitN" class="optnum" value="10" inputmode="numeric" aria-label="Pages per file">' +
          '<span class="optlabel">pages</span>' +
        '</label>' +
        '<label class="opt">' +
          '<input type="radio" name="splitHow" value="ranges">' +
          '<span class="optlabel">Page ranges</span>' +
        '</label>' +
        '<input id="splitR" class="optfield" placeholder="e.g. 1-3, 4, 5-8" aria-label="Page ranges" disabled>' +
      '</div>' +
      '<p class="note" id="splitNote"></p>' +
      '<div class="acts"><button class="btn" id="splitCancel">Cancel</button>' +
      '<button class="btn primary" id="splitGo">Split</button></div>';
    document.body.appendChild(splitPop);

    X.registerPop('splitPop', 'btnSplit');
    function openSplit() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      const wasOpen = X.popOpen('splitPop');
      X.togglePop('splitPop', $('btnSplit'));
      if (!wasOpen) splitNote();
    }
    splitPop.addEventListener('change', splitNote);
    splitPop.addEventListener('input', splitNote);
    $('splitCancel').addEventListener('click', function () { X.closePops(true); });
    $('splitGo').addEventListener('click', runSplit);

    function splitHow() {
      const r = splitPop.querySelector('input[name="splitHow"]:checked');
      return r ? r.value : 'each';
    }
    function splitGroups() {
      const n = S.items.length, how = splitHow();
      if (how === 'each') return E.splitEach(n);
      if (how === 'every') return E.splitEvery(n, $('splitN').value);
      return parseRanges($('splitR').value, n);
    }
    function parseRanges(text, n) { return E.parseRangeGroups(text, n); }
    function splitNote() {
      /* grey out the inputs that do not belong to the chosen option, so the
         panel says what it is going to do rather than offering three at once */
      const how = splitHow();
      $('splitN').disabled = how !== 'every';
      $('splitR').disabled = how !== 'ranges';
      Array.prototype.forEach.call(splitPop.querySelectorAll('.opt'), function (el) {
        const r = el.querySelector('input[type="radio"]');
        el.classList.toggle('on', !!r && r.checked);
      });

      const g = splitGroups();
      $('splitNote').textContent = g.length
        ? g.length + ' file' + (g.length === 1 ? '' : 's') + ' will be saved'
        : 'Enter at least one page range, like 1-3, 7';
      $('splitGo').disabled = !g.length;
    }

    async function runSplit() {
      const groups = splitGroups();
      if (!groups.length) return;
      const btn = $('splitGo');
      btn.disabled = true;
      const cache = new Map();
      try {
        for (let gi = 0; gi < groups.length; gi++) {
          btn.textContent = 'Saving ' + (gi + 1) + '/' + groups.length + '…';
          const items = groups[gi].map(function (i) { return S.items[i]; }).filter(Boolean);
          if (!items.length) continue;
          const bytes = await X.buildPdf(items, cache, {});
          const nums = groups[gi].map(function (i) { return i + 1; });
          const tag = nums.length === 1 ? nums[0] : nums[0] + '-' + nums[nums.length - 1];
          X.download(bytes, S.baseName + ' — ' + tag + '.pdf');
          await new Promise(function (r) { setTimeout(r, 220); });   /* let each download land */
        }
        X.closePops(true);
        X.toast('Split into <b>' + groups.length + '</b> file' + (groups.length === 1 ? '' : 's'));
      } catch (err) {
        $('splitNote').innerHTML = '<span style="color:var(--danger)">' +
          X.esc(X.saveError(err, 'This file could not be split')) + '</span>';
      } finally {
        btn.disabled = false; btn.textContent = 'Split';
      }
    }

    /* ---------------- drag to reorder, in the sidebar ---------------- */

    let drag = null;

    function indexOfThumb(el) {
      return S.items.findIndex(function (it) { return it.thumb === el; });
    }

    function wireThumbs() {
      S.items.forEach(function (it) {
        if (!it.thumb || it.thumb.dataset.dnd) return;
        it.thumb.dataset.dnd = '1';
        it.thumb.draggable = true;
        it.thumb.addEventListener('dragstart', function (e) {
          drag = { from: indexOfThumb(it.thumb), host: 'rail' };
          /* a selected page carries the whole selection with it */
          if (it.pick && selected().length > 1) drag.many = selected();
          it.thumb.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(drag.from)); } catch (err) {}
        });
        it.thumb.addEventListener('dragend', function () {
          it.thumb.classList.remove('dragging');
          clearDropMarks($('railPages'));
          drag = null;
        });
      });
      wireDropZone($('railPages'), function () { return S.items.map(function (i) { return i.thumb; }); });
    }

    function clearDropMarks(host) {
      Array.prototype.forEach.call(host.querySelectorAll('.drop-before,.drop-after'), function (el) {
        el.classList.remove('drop-before', 'drop-after');
      });
    }

    function wireDropZone(host, cells) {
      if (host.dataset.dnd) return;
      host.dataset.dnd = '1';
      host.addEventListener('dragover', function (e) {
        if (!drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const t = nearestCell(cells(), e.clientX, e.clientY);
        clearDropMarks(host);
        if (t) t.el.classList.add(t.after ? 'drop-after' : 'drop-before');
      });
      host.addEventListener('drop', function (e) {
        if (!drag) return;
        e.preventDefault();
        const list = cells();
        const t = nearestCell(list, e.clientX, e.clientY);
        clearDropMarks(host);
        if (!t) return;
        let to = list.indexOf(t.el) + (t.after ? 1 : 0);
        if (drag.many) moveMany(drag.many, to); else moveTo(drag.from, to);
      });
    }

    /* which gap the pointer is closest to — works for a column or a grid */
    function nearestCell(list, x, y) {
      let best = null, bestD = Infinity;
      list.forEach(function (el) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bestD) {
          bestD = d;
          /* a tall narrow column splits top/bottom; a grid splits left/right */
          const wide = r.width > r.height * 0.8;
          best = { el: el, after: wide ? (y > cy) : (x > cx) };
        }
      });
      return best;
    }

    async function moveTo(from, to) {
      if (from < 0 || from >= S.items.length) return;
      if (to > from) to--;
      if (to === from || to < 0) return;
      X.snapshot();
      const it = S.items.splice(from, 1)[0];
      S.items.splice(to, 0, it);
      X.invalidateSearch();
      await X.syncAll();
      X.goTo(to + 1);
      X.toast('Page moved to <b>' + (to + 1) + '</b> · <b>Ctrl+Z</b> to undo');
      if (!org.hidden) paintOrganize();
    }

    /* several pages, in their order, to the gap before index `to` */
    async function moveMany(idx, to) {
      const set = {};
      idx.forEach(function (i) { set[i] = 1; });
      const moving = idx.map(function (i) { return S.items[i]; });
      const before = idx.filter(function (i) { return i < to; }).length;
      const rest = S.items.filter(function (_, i) { return !set[i]; });
      const at = to - before;
      const next = rest.slice(0, at).concat(moving, rest.slice(at));
      if (next.every(function (it, i) { return it === S.items[i]; })) return;
      X.snapshot();
      S.items.splice.apply(S.items, [0, S.items.length].concat(next));
      X.invalidateSearch();
      await X.syncAll();
      X.goTo(at + 1);
      X.toast(moving.length + ' pages moved to <b>' + (at + 1) + '</b> · <b>Ctrl+Z</b> to undo');
      repaint();
    }

    /* ---------------- Organize Pages grid ---------------- */

    const org = document.createElement('div');
    org.className = 'orgview'; org.id = 'orgView'; org.hidden = true;
    org.innerHTML =
      '<header>' +
      '<b>Organize pages</b>' +
      '<span class="orgcount" id="orgCount"></span>' +
      '<span class="grow"></span>' +
      '<button class="btn" id="orgAll">Select all</button>' +
      '<button class="btn" id="orgNone">Clear</button>' +
      '<span class="sep"></span>' +
      '<button class="btn" id="orgRotL" title="Rotate selected left">Rotate ↺</button>' +
      '<button class="btn" id="orgRotR" title="Rotate selected right">Rotate ↻</button>' +
      '<button class="btn" id="orgDup" title="Duplicate selected">Duplicate</button>' +
      '<button class="btn" id="orgExtract" title="Save the selected pages as a new PDF">Extract</button>' +
      '<button class="btn del" id="orgDel" title="Remove selected">Remove</button>' +
      '<span class="sep"></span>' +
      '<button class="btn primary" id="orgDone">Done</button>' +
      '</header>' +
      '<p class="orghint">Drag a page to reorder it. Click to select — <b>Shift</b> picks a run.</p>' +
      '<div class="orggrid" id="orgGrid"></div>';
    document.body.appendChild(org);

    let lastClicked = -1;

    function openOrganize() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!org.hidden) { closeOrganize(); return; }   /* the button toggles */
      org.hidden = false;
      document.body.classList.add('organizing');
      paintOrganize();
    }
    function closeOrganize() {
      org.hidden = true;
      document.body.classList.remove('organizing');
    }
    $('orgDone').addEventListener('click', closeOrganize);

    function selected() {
      return S.items.map(function (it, i) { return it.pick ? i : -1; }).filter(function (i) { return i >= 0; });
    }

    function paintOrganize() {
      const grid = $('orgGrid');
      grid.innerHTML = '';
      S.items.forEach(function (it, i) {
        const cell = document.createElement('figure');
        cell.className = 'orgcell' + (it.pick ? ' picked' : '');
        cell.draggable = true;
        cell.dataset.i = i;
        const shell = document.createElement('div');
        shell.className = 'orgshell';
        /* reuse the thumbnail core already painted rather than rendering twice
           (one far from view has given its bitmap back, and shows as pending) */
        if (it.thumbDone && it.thumbCanvas && it.thumbCanvas.width > 1) {
          const img = document.createElement('img');
          try { img.src = it.thumbCanvas.toDataURL('image/png'); } catch (e) {}
          shell.appendChild(img);
        } else {
          shell.classList.add('pending');
        }
        cell.appendChild(shell);
        const cap = document.createElement('figcaption');
        cap.textContent = i + 1;
        if (it.rot) cap.textContent += ' · ' + it.rot + '°';
        if (it.added) cap.className = 'isnew';
        cell.appendChild(cap);

        cell.addEventListener('click', function (e) {
          if (e.shiftKey && lastClicked >= 0) {
            const lo = Math.min(lastClicked, i), hi = Math.max(lastClicked, i);
            for (let k = lo; k <= hi; k++) S.items[k].pick = true;
          } else {
            it.pick = !it.pick;
            lastClicked = i;
          }
          syncOrg();
        });
        cell.addEventListener('dblclick', function () {
          closeOrganize(); X.goTo(i + 1);
        });
        cell.addEventListener('dragstart', function (e) {
          drag = { from: i, host: 'grid' };
          cell.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) {}
        });
        cell.addEventListener('dragend', function () {
          cell.classList.remove('dragging'); clearDropMarks(grid); drag = null;
        });
        grid.appendChild(cell);
      });
      wireGridDrop(grid);
      syncOrg();
    }

    function wireGridDrop(grid) {
      if (grid.dataset.dnd) return;
      grid.dataset.dnd = '1';
      grid.addEventListener('dragover', function (e) {
        if (!drag) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const cells = Array.prototype.slice.call(grid.children);
        const t = nearestCell(cells, e.clientX, e.clientY);
        clearDropMarks(grid);
        if (t) t.el.classList.add(t.after ? 'drop-after' : 'drop-before');
      });
      grid.addEventListener('drop', function (e) {
        if (!drag) return;
        e.preventDefault();
        const cells = Array.prototype.slice.call(grid.children);
        const t = nearestCell(cells, e.clientX, e.clientY);
        clearDropMarks(grid);
        if (!t) return;
        moveTo(drag.from, cells.indexOf(t.el) + (t.after ? 1 : 0));
      });
    }

    function syncOrg() {
      const n = selected().length;
      $('orgCount').textContent = S.items.length + ' pages' + (n ? ' · ' + n + ' selected' : '');
      ['orgRotL', 'orgRotR', 'orgDel', 'orgDup', 'orgExtract'].forEach(function (id) {
        $(id).disabled = !n;
      });
      Array.prototype.forEach.call($('orgGrid').children, function (c, i) {
        c.classList.toggle('picked', !!S.items[i].pick);
      });
      /* keep the sidebar selection and the Extract counter in step */
      S.items.forEach(function (it) {
        if (it.thumb) it.thumb.classList.toggle('picked', !!it.pick);
      });
      document.body.classList.toggle('picking', n > 0);
      const c = $('exCount');
      c.textContent = n ? String(n) : ''; c.hidden = !n;
      $('btnExtract').classList.toggle('on', n > 0);
      if (X.syncPicks) X.syncPicks();    /* the sidebar's selection bar */
    }

    $('orgAll').addEventListener('click', function () {
      S.items.forEach(function (it) { it.pick = true; }); syncOrg();
    });
    $('orgNone').addEventListener('click', function () {
      S.items.forEach(function (it) { it.pick = false; }); lastClicked = -1; syncOrg();
    });
    $('orgRotL').addEventListener('click', function () { rotateSelected(-90); });
    $('orgRotR').addEventListener('click', function () { rotateSelected(90); });

    function rotateSelected(deg) {
      const sel = selected(); if (!sel.length) return;
      X.snapshot();
      sel.forEach(function (i) {
        const it = S.items[i];
        it.rot = ((it.rot + deg) % 360 + 360) % 360;
        it.thumbDone = false; it.rendered = false;
        if (it.tl) it.tl.innerHTML = '';
      });
      X.relayout().then(function () {
        X.drawVisibleThumbs();
        X.updateMeta();
        setTimeout(repaint, 400);
      });
      X.toast(sel.length + ' page' + (sel.length === 1 ? '' : 's') + ' rotated');
    }

    async function removeSelected() {
      const sel = selected(); if (!sel.length) return;
      if (sel.length >= S.items.length) { X.toast('A PDF needs at least one page'); return; }
      X.snapshot();
      sel.slice().reverse().forEach(function (i) {
        const it = S.items[i];
        if (it.task) { try { it.task.cancel(); } catch (e) {} }
        if (S.sel && S.sel.it === it) S.sel = null;
        S.items.splice(i, 1);
      });
      X.invalidateSearch();
      await X.syncAll();
      repaint();
      X.toast(sel.length + ' page' + (sel.length === 1 ? '' : 's') + ' removed · <b>Ctrl+Z</b> to undo');
    }
    $('orgDel').addEventListener('click', removeSelected);

    async function duplicateSelected() {
      const sel = selected(); if (!sel.length) return;
      X.snapshot();
      sel.slice().reverse().forEach(function (i) {
        const it = S.items[i];
        const copy = X.newItem(it.src, it.num, it.rot, true);
        copy.crop = it.crop ? Object.assign({}, it.crop) : null;
        copy.shapes = it.shapes.map(function (s) { return JSON.parse(JSON.stringify(s)); });
        S.items.splice(i + 1, 0, copy);
      });
      X.invalidateSearch();
      await X.syncAll();
      repaint();
      X.toast(sel.length + ' page' + (sel.length === 1 ? '' : 's') + ' duplicated');
    }
    $('orgDup').addEventListener('click', duplicateSelected);

    /* btn: the button that asked, which reads Building… meanwhile */
    async function extractSelected(btn) {
      const sel = selected(); if (!sel.length) return;
      const label = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
      try {
        const items = sel.map(function (i) { return S.items[i]; });
        const bytes = await X.buildPdf(items, new Map(), {});
        const nums = sel.map(function (i) { return i + 1; });
        const tag = nums.length === 1 ? nums[0] : nums[0] + '-' + nums[nums.length - 1];
        X.download(bytes, S.baseName + ' — pages ' + tag + '.pdf');
        X.toast('Extracted <b>' + sel.length + '</b> page' + (sel.length === 1 ? '' : 's'));
      } catch (e) {
        X.toast(X.esc(X.saveError(e, 'These pages could not be extracted')));
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
      }
    }
    $('orgExtract').addEventListener('click', function () { extractSelected($('orgExtract')); });

    /* after a change from the sidebar or the grid: both show the same picks */
    function repaint() {
      if (!org.hidden) paintOrganize();
      if (X.syncPicks) X.syncPicks();
    }

    /* ---------------- keyboard ---------------- */

    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if (!org.hidden && e.key === 'Escape') { closeOrganize(); return; }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'o' && S.items.length) {
        e.preventDefault();
        org.hidden ? openOrganize() : closeOrganize();
      }
    });

    X.on('pages', function () {
      wireThumbs();
      if (!org.hidden) paintOrganize();
    });
    X.on('reset', closeOrganize);
    wireThumbs();

    X.organize = {
      open: openOrganize, close: closeOrganize, moveTo: moveTo, moveMany: moveMany, parseRanges: parseRanges,
      /* the selected pages (it.pick), from the sidebar's selection bar too */
      rotateSelected: rotateSelected, removeSelected: removeSelected,
      duplicateSelected: duplicateSelected, extractSelected: extractSelected
    };
  });
})();
