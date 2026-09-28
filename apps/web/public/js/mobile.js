/* The phone app (apps/mobile, Capacitor): files handed over by the system.

   A PDF opened from another app ("Open with ADD DOTS PDF" in Files, Gmail,
   WhatsApp...) starts the app, or reaches the one already open. This asks
   the native side for it once, listens for later ones, and opens each the
   way the file picker does. Saving goes to Android's own "save to" picker.
   Files cross the bridge as base64. In a browser there is no native
   Capacitor and this does nothing. */
(function () {
  'use strict';

  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins && C.Plugins.AddDots;
  var api = window.ADDPDF;
  if (!P || !api) return;

  function fromBase64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function toBase64(bytes) {
    /* in slices: one String.fromCharCode over megabytes overflows the stack */
    var parts = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(parts.join(''));
  }
  /* whatever the app saves (a Blob, bytes, or text) as bytes */
  function toBytes(b) {
    if (b instanceof Blob) return b.arrayBuffer().then(function (x) { return new Uint8Array(x); });
    if (typeof b === 'string') return Promise.resolve(new TextEncoder().encode(b));
    if (ArrayBuffer.isView(b)) return Promise.resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    return Promise.resolve(new Uint8Array(b));
  }

  function openHanded(o) {
    if (!o) return;
    if (o.error) { if (api.toast) api.toast('Could not open that file'); return; }
    if (!o.data) return;
    var file = new File([fromBase64(o.data)], o.name || 'document.pdf', { type: 'application/pdf' });
    /* ready is sticky: this runs at once if core has already booted */
    api.on('ready', function () {
      /* the picker asks before it replaces unsaved work; so does this */
      if (api.hasDoc() && !api.okToReplace()) return;
      api.openFiles([file]);
    });
  }

  /* Resolves to the saved file's name, or false when the picker was cancelled.
     window.ADDDOTS_TEST_SAVE (tests, debug builds only) skips the picker. */
  api.saveFile = function (data, name, type) {
    return toBytes(data).then(function (bytes) {
      return P.saveFile({ name: name, type: type || 'application/pdf', data: toBase64(bytes),
        test: !!window.ADDDOTS_TEST_SAVE });
    }).then(function (r) {
      return r && !r.cancelled ? (r.name || name) : false;
    }, function (e) {
      console.error('[mobile] save', e);
      if (api.toast) api.toast('Could not save: ' + String(e && e.message || e).slice(0, 120));
      return false;
    });
  };

  P.launchFile().then(openHanded, function (e) { console.error('[mobile] launch file', e); });
  P.addListener('openFile', openHanded);
})();
