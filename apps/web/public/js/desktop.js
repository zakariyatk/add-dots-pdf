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

  function openPaths(paths) {
    if (!paths || !paths.length || !api) return;
    trace.received = trace.received.concat(paths);
    Promise.all(paths.map(function (p) {
      return T.core.invoke('read_file', { path: p }).then(function (buf) {
        const f = new File([buf], base(p), { type: 'application/pdf' });
        /* where it is on disk: PDFium reads it from there, not from a copy (core.js NR) */
        f.adddotsPath = p;
        return f;
      });
    })).then(function (files) {
      /* ready is sticky: this runs at once if core has already booted */
      api.on('ready', function () {
        trace.opened = trace.opened.concat(files.map(function (f) { return f.name + ' (' + f.size + ' bytes)'; }));
        /* a document open: each in a tab of its own */
        if (api.hasDoc() && api.tabs && api.tabs.available()) { api.tabs.openFiles(files); return; }
        /* the picker asks before it replaces unsaved work; so does this */
        if (api.hasDoc() && !api.okToReplace()) return;
        api.openFiles(files);
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
  api.newWindow = function (doc) {
    var key = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return handoffRun('readwrite', function (st) { st.put({ doc: doc, at: Date.now() }, key); })
      .then(function () { return T.core.invoke('new_window', { handoff: key }); })
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
          if (ok && rec.doc.name) document.title = rec.doc.name + ' · ADD DOTS PDF';
        });
      });
    }).catch(function (e) {
      fail('handoff', e);
      if (api.toast) api.toast('The document could not be moved to this window');
    });
  } else {
    T.core.invoke('launch_files').then(function (paths) {
      trace.launched = paths;
      openPaths(paths);
    }, function (e) { fail('launch files', e); });
  }
  /* sent to this window only: a PDF handed over goes to the window used last */
  var me = T.webviewWindow && T.webviewWindow.getCurrentWebviewWindow ? T.webviewWindow.getCurrentWebviewWindow() : null;
  if (me) me.listen('open-files', function (e) { openPaths(e.payload); });
  else if (T.event) T.event.listen('open-files', function (e) { openPaths(e.payload); });
})();
