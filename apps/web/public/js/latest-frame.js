/* The update check's frame (latest-frame.html). The website's latest.js is a
   script, so it needs no CORS header there; but a script from the website
   should not run with the app's rights (in the Windows app, every command of
   the desktop side). So it runs here, in a frame sandboxed to an origin of
   its own, and this hands its answer to the page, which takes only a build
   id, a time and a few lines of notes from it. */
(function () {
  'use strict';

  var site = new URLSearchParams(location.search).get('site') || '';
  function send(v) {
    parent.postMessage({ adddotsLatest: true, v: v || null }, '*');
  }
  /* the website only: https, or a server on this computer (development) */
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)[^\s"'<>\\]*\/$/.test(site)) {
    send(null);
    return;
  }
  var s = document.createElement('script');
  s.src = site + 'latest.js?t=' + Date.now();
  s.onload = function () { send(window.ADDDOTS_LATEST); };
  s.onerror = function () { send(null); };            /* offline: no notice */
  document.head.appendChild(s);
})();
