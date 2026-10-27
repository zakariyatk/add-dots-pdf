/* The desktop app (apps/desktop, Tauri): PDFs handed over by the system.

   Double-clicking a PDF in Explorer starts the app with its path, or hands
   the path to the window already open. This asks for the paths the app was
   started with, listens for later ones, reads each file's bytes from the
   desktop side and opens them the way the file picker does: with a
   document open, in a tab of its own (js/tabs.js). In a browser there is no
   window.__TAURI__ and this does nothing.

   A tab is a frame of the window's page. It saves through the window's own
   connection to the desktop side (its bytes copied into the window's realm
   first, or they would not travel as bytes), and leaves PDFs handed over to
   the window. */
(function () {
  'use strict';

  var inTab = window.parent !== window;
  var T = window.__TAURI__, U8 = Uint8Array;
  if (inTab) {
    try { T = window.parent.__TAURI__; U8 = window.parent.Uint8Array; } catch (e) { T = null; }
  }
  if (!T || !T.core) return;
  var api = window.ADDPDF;

  /* what the desktop side handed over and what became of it: for "Copy
     diagnostics" and the end-to-end test when a file does not open */
  var trace = window.ADDDOTS_DESKTOP = { launched: null, received: [], opened: [], errors: [] };
  function fail(where, e) {
    trace.errors.push(where + ': ' + String((e && e.message) || e));
    console.error('[desktop] ' + where, e);
  }

  function base(p) { return String(p).split(/[\\/]/).pop() || 'document.pdf'; }

  /* Several PDFs picked in Explorer and opened together reach the app one
     by one (Windows starts it once per file; the first start takes the
     others), often while the first is still loading. Until it has, the
     others would replace it: they go to tabs of their own instead. */
  var loading = null;

  function openPaths(paths) {
    if (!paths || !paths.length || !api) return;
    trace.received = trace.received.concat(paths);
    Promise.all(paths.map(function (p) {
      return T.core.invoke('open_plan', { path: p }).then(function (plan) {
        /* a big file is not read whole: the desktop side keeps it open and
           pdf.js reads the parts it needs (core.js RANGED). What stands in
           for it is plain data, so it reaches a tab as it is. */
        if (plan && plan.id != null) {
          return { name: base(p), size: plan.size, type: 'application/pdf', adddotsPath: p, adddotsRange: plan.id };
        }
        return T.core.invoke('read_file', { path: p }).then(function (buf) {
          const f = new File([buf], base(p), { type: 'application/pdf' });
          /* where it is on disk: PDFium reads it from there, not from a copy (core.js NR) */
          f.adddotsPath = p;
          return f;
        });
      });
    })).then(function (files) {
      /* ready is sticky: this runs at once if core has already booted */
      api.on('ready', function () {
        trace.opened = trace.opened.concat(files.map(function (f) { return f.name + ' (' + f.size + ' bytes)'; }));
        /* a document open: each in a tab of its own */
        if ((api.hasDoc() || loading) && api.tabs && api.tabs.available()) { api.tabs.openFiles(files); return; }
        /* the picker asks before it replaces unsaved work; so does this */
        if (api.hasDoc() && !api.okToReplace()) {
          files.forEach(function (f) { if (f.adddotsRange != null) T.core.invoke('range_close', { id: f.adddotsRange }).catch(function () {}); });
          return;
        }
        var mine = loading = Promise.resolve(api.openFiles(files)).catch(function () {}).then(function () {
          if (loading === mine) loading = null;
        });
      });
    }).catch(function (e) {
      fail('could not open', e);
      if (api.toast) api.toast('Could not open that file');
    });
  }

  /* Saving: the desktop side asks where (a Save dialog) and writes the file.
     Resolves to where it went, or false when the dialog was cancelled. */
  /* whatever the app saves (a Blob, bytes, or text) as bytes */
  function toBytes(b) {
    var got;
    if (b instanceof Blob) got = b.arrayBuffer().then(function (x) { return new Uint8Array(x); });
    else if (typeof b === 'string') got = Promise.resolve(new TextEncoder().encode(b));
    else if (ArrayBuffer.isView(b)) got = Promise.resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    else got = Promise.resolve(new Uint8Array(b));
    /* in a tab: the window's own kind of bytes */
    return U8 === Uint8Array ? got : got.then(function (x) { return new U8(x); });
  }
  /* an update: this app's page in the Microsoft Store (js/update.js) */
  api.openStore = function () { return T.core.invoke('open_store'); };
  /* an Add Dots page, by name, in the browser (the top bar's links) */
  api.openSite = function (name) { return T.core.invoke('open_site', { name: name }); };
  /* whether the Store has a newer version: true, false, or null when this
     is not the Store's install (the setup .exe) */
  api.storeUpdate = function () { return T.core.invoke('store_update'); };
  /* installs it from the app: 'completed', 'canceled', 'nothing' or 'failed' */
  api.storeInstall = function () { return T.core.invoke('store_install'); };

  api.saveFile = function (data, name, type) {
    return toBytes(data).then(function (body) {
      return T.core.invoke('save_file', body, {
        headers: { 'x-name': encodeURIComponent(name), 'x-type': type || '' }
      });
    }).then(function (path) {
      return path ? base(path) : false;
    }, function (e) {
      fail('save', e);
      if (api.toast) api.toast('Could not save: ' + String(e).slice(0, 120));
      return false;
    });
  };

  if (inTab) return;

  /* ---- a tab moved to a window of its own (js/tabs.js) ----
     The document as it stands goes into the browser storage every window of
     the app shares, under a name the new window is opened with; it takes it
     from there and the record is gone. */
  function handoffDb() {
    return new Promise(function (res, rej) {
      var q = indexedDB.open('adpdf-handoff', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('docs'); };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  }
  function handoffRun(mode, fn) {
    return handoffDb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('docs', mode), out = fn(tx.objectStore('docs'));
        tx.oncomplete = function () { db.close(); res(out && out.result); };
        tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
      });
    });
  }
  /* at: a point on the screen for the window's top bar, where a tab dragged
     out of the bar was let go of; else Windows places it */
  api.newWindow = function (doc, at) {
    var key = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var pos = at && isFinite(at.x) && isFinite(at.y) ? { x: at.x, y: at.y } : { x: null, y: null };
    return handoffRun('readwrite', function (st) { st.put({ doc: doc, at: Date.now() }, key); })
      .then(function () { return T.core.invoke('new_window', { handoff: key, x: pos.x, y: pos.y }); })
      .catch(function (e) {
        handoffRun('readwrite', function (st) { st.delete(key); }).catch(function () {});
        throw e;
      });
  };

  var handoff = /[?&]handoff=([a-z0-9]+)/.exec(location.search);
  if (handoff) {
    trace.handoff = handoff[1];
    var rec = null;
    handoffRun('readwrite', function (st) {
      var q = st.get(handoff[1]);
      q.onsuccess = function () { rec = q.result; st.delete(handoff[1]); };
    }).then(function () {
      if (!rec || !rec.doc) throw new Error('nothing was handed over');
      api.on('ready', function () {
        api.importSession(rec.doc).then(function (ok) {
          if (ok && rec.doc.name) document.title = rec.doc.name + ' · Add Dots PDF';
        });
      });
    }).catch(function (e) {
      fail('handoff', e);
      if (api.toast) api.toast('The document could not be moved to this window');
    });
  }
  /* ---- Explorer's "Combine files in Add Dots PDF" ----
     Explorer starts the app once for each PDF picked (src-tauri is_combine),
     so they arrive one by one: they are gathered until none has come for a
     moment, then listed in order, as Acrobat's Combine Files does, to be
     moved up or down or left out, and combined into one document (a tab of
     its own when one is open). The bytes are read whole: they are joined. */
  var gathered = [], gatherTimer = null, cmb = null;
  function byName(a, b) { return base(a).localeCompare(base(b), undefined, { numeric: true, sensitivity: 'base' }); }
  function takeCombine() {
    return T.core.invoke('combine_files').then(function (paths) {
      if (!paths || !paths.length) return;
      trace.received = trace.received.concat(paths);
      paths.forEach(function (p) { if (gathered.indexOf(p) < 0) gathered.push(p); });
      clearTimeout(gatherTimer);
      gatherTimer = setTimeout(function () {
        var list = gathered.sort(byName);
        gathered = [];
        api.on('ready', function () { showCombine(list); });
      }, 900);
    }, function (e) { fail('combine files', e); });
  }

  function combineDialog() {
    if (cmb) return cmb;
    var el = document.createElement('div');
    el.className = 'docmodal'; el.id = 'cmbModal'; el.hidden = true;
    el.innerHTML = '<div class="docbox cmbbox" role="dialog" aria-modal="true" aria-labelledby="cmbTitle">' +
      '<header><b id="cmbTitle">Combine Files</b><span class="grow"></span>' +
      '<button class="x" id="cmbClose" type="button" aria-label="Close">&times;</button></header>' +
      '<div class="docbody"><p class="cmbnote">Joined into one PDF in this order. Move a file up or down, or leave it out.</p>' +
      '<ol class="cmblist" id="cmbList"></ol></div>' +
      '<footer><button class="btn" id="cmbSort" type="button">Sort by name</button>' +
      '<span class="docnote" id="cmbNote"></span><span class="grow"></span>' +
      '<button class="btn" id="cmbCancel" type="button">Cancel</button>' +
      '<button class="btn primary" id="cmbGo" type="button">Combine</button></footer></div>';
    document.body.appendChild(el);
    cmb = { el: el, list: [], busy: false };
    var $c = function (id) { return el.querySelector('#' + id); };
    function close() { if (!cmb.busy) { el.hidden = true; cmb.list = []; } }
    $c('cmbClose').addEventListener('click', close);
    $c('cmbCancel').addEventListener('click', close);
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $c('cmbSort').addEventListener('click', function () { cmb.list.sort(byName); paintCombine(); });
    $c('cmbList').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var i = +b.dataset.i, L = cmb.list;
      if (b.dataset.a === 'up' && i > 0) L.splice(i - 1, 0, L.splice(i, 1)[0]);
      else if (b.dataset.a === 'down' && i < L.length - 1) L.splice(i + 1, 0, L.splice(i, 1)[0]);
      else if (b.dataset.a === 'out') L.splice(i, 1);
      paintCombine();
      var again = el.querySelector('#cmbList button[data-a="' + b.dataset.a + '"][data-i="' +
        Math.max(0, Math.min(L.length - 1, b.dataset.a === 'up' ? i - 1 : b.dataset.a === 'down' ? i + 1 : i)) + '"]');
      if (again) again.focus();
    });
    $c('cmbGo').addEventListener('click', combineNow);
    return cmb;
  }
  function paintCombine() {
    var el = cmb.el, L = cmb.list;
    el.querySelector('#cmbList').innerHTML = L.map(function (p, i) {
      return '<li><span class="cmbname" title="' + api.esc(p) + '">' + api.esc(base(p)) + '</span>' +
        '<button type="button" class="btn" data-a="up" data-i="' + i + '" aria-label="Move up" title="Move up"' + (i ? '' : ' disabled') + '>&uarr;</button>' +
        '<button type="button" class="btn" data-a="down" data-i="' + i + '" aria-label="Move down" title="Move down"' + (i < L.length - 1 ? '' : ' disabled') + '>&darr;</button>' +
        '<button type="button" class="btn" data-a="out" data-i="' + i + '" aria-label="Leave out" title="Leave out">&times;</button></li>';
    }).join('');
    el.querySelector('#cmbNote').textContent = L.length + (L.length === 1 ? ' file' : ' files');
    el.querySelector('#cmbGo').disabled = L.length < 2 || cmb.busy;
  }
  function showCombine(paths) {
    var c = combineDialog();
    /* more picked while it is open: added at the end */
    paths.forEach(function (p) { if (c.list.indexOf(p) < 0) c.list.push(p); });
    paintCombine();
    c.el.hidden = false;
    c.el.querySelector('#cmbGo').focus();
  }
  function combineNow() {
    var L = cmb.list.slice();
    if (L.length < 2 || cmb.busy) return;
    cmb.busy = true; paintCombine();
    cmb.el.querySelector('#cmbNote').textContent = 'Combining…';
    Promise.all(L.map(function (p) {
      return T.core.invoke('read_file', { path: p }).then(function (buf) {
        var f = new File([buf], base(p), { type: 'application/pdf' });
        f.adddotsPath = p;
        return f;
      });
    })).then(function (files) {
      cmb.busy = false; cmb.el.hidden = true; cmb.list = [];
      trace.opened = trace.opened.concat(files.map(function (f) { return f.name + ' (' + f.size + ' bytes)'; }));
      if (api.hasDoc() && api.tabs && api.tabs.available() && api.tabs.openMerged) api.tabs.openMerged(files);
      else api.openFiles(files, { merge: true });
    }, function (e) {
      cmb.busy = false; paintCombine();
      fail('combine', e);
      cmb.el.querySelector('#cmbNote').textContent = 'Could not read ' + String((e && e.message) || e).slice(0, 80);
    });
  }
  api.showCombine = showCombine;   /* for the tests */

  /* What has been handed over and not yet opened: the desktop side keeps
     it until a page takes it, each path once. Asked at start, on each
     `open-files`, and once more when this page is listening, for any that
     came while it was still loading. */
  function takePending(first) {
    return T.core.invoke('launch_files').then(function (paths) {
      if (first) trace.launched = paths;
      openPaths(paths);
    }, function (e) { fail('launch files', e); });
  }
  if (!handoff) { takePending(true); takeCombine(); }
  /* sent to this window only: a PDF handed over goes to the window used last */
  var me = T.webviewWindow && T.webviewWindow.getCurrentWebviewWindow ? T.webviewWindow.getCurrentWebviewWindow() : null;
  var listen = function (name, fn) {
    var l = me ? me.listen(name, fn) : T.event ? T.event.listen(name, fn) : null;
    if (l && l.then) l.then(fn, function (e) { fail('listen ' + name, e); });
  };
  listen('open-files', function () { takePending(false); });
  listen('combine-files', function () { takeCombine(); });
})();
