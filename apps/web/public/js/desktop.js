/* The desktop app (apps/desktop, Tauri): PDFs handed over by the system.

   Double-clicking a PDF in Explorer starts the app with its path, or hands
   the path to the window already open. This asks for the paths the app was
   started with, listens for later ones, reads each file's bytes from the
   desktop side and opens them the way the file picker does. In a browser
   there is no window.__TAURI__ and this does nothing. */
(function () {
  'use strict';

  var T = window.__TAURI__;
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
        return new File([buf], base(p), { type: 'application/pdf' });
      });
    })).then(function (files) {
      /* ready is sticky: this runs at once if core has already booted */
      api.on('ready', function () {
        /* the picker asks before it replaces unsaved work; so does this */
        if (api.hasDoc() && !api.okToReplace()) return;
        trace.opened = trace.opened.concat(files.map(function (f) { return f.name + ' (' + f.size + ' bytes)'; }));
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
    if (b instanceof Blob) return b.arrayBuffer().then(function (x) { return new Uint8Array(x); });
    if (typeof b === 'string') return Promise.resolve(new TextEncoder().encode(b));
    if (ArrayBuffer.isView(b)) return Promise.resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    return Promise.resolve(new Uint8Array(b));
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

  T.core.invoke('launch_files').then(function (paths) {
    trace.launched = paths;
    openPaths(paths);
  }, function (e) { fail('launch files', e); });
  if (T.event) T.event.listen('open-files', function (e) { openPaths(e.payload); });
})();
