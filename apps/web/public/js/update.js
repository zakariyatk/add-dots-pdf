/* Add Dots PDF — Updates
   ---------------------
   Telling the reader about a new version, wherever the app runs — always
   through the bell (What is new, js/appbar.js), never a banner of its own
   over the page: flagBell() lights its dot, and the bell's own click
   handler asks X.checkForUpdate() fresh for what to show and do about it.

   - On the website the service worker fetches a new version by itself
     (js/pwa.js). With no document open the page simply reloads into it; with
     one open, the bell lights up and the reload is one click away there.
   - The Windows app from the Microsoft Store is updated by the Store
     itself, so it shows no notice (apps/electron store_update says false).
     The website is no guide there: a build reaches the Store only once it
     is submitted and certified, days after the website has it.
   - The setup .exe and the phone apps carry every file and do not change on
     their own. They load latest.js from the website, which names the build
     the website has; when that is newer than this one, the bell lights up,
     and its own click takes the update: on Windows, this app's page in the
     Microsoft Store.

   js/build.js says which build this is; without it (development) nothing
   here runs. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[update] core bridge missing'); return; }

  const BUILD = window.ADDDOTS_BUILD || null;
  const IN_DESKTOP = !!window.ADDDOTS_HOST;
  /* a document tab is a frame of the window, which tells of updates itself */
  const IN_FRAME = window.parent !== window;
  const IN_PHONE = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform());

  /* the one visible sign any of this ever gives: What is new's own dot
     (js/appbar.js) — lit, never a banner over the page */
  function flagBell() {
    const dot = document.querySelector('#abNews .abdot');
    if (dot) dot.hidden = false;
  }

  /* ---------------- website: the service worker has the update ---------------- */

  /* the website: the new version, fetched already, taken by reloading */
  let webReady = false;
  function reloadIntoUpdate() {
    if (X.isDirty && X.isDirty() &&
        !window.confirm('Update now? Changes you have not saved will be lost. ' +
                        'Choose Cancel, save your PDF, then click Update now again.')) {
      return;
    }
    location.reload();
  }
  /* js/pwa.js calls this when an update is ready but a document is open */
  X.updateReady = function () {
    webReady = true;
    flagBell();
  };

  /* ---------------- Windows and phone apps: is the website newer? ---------------- */

  /* read when needed: js/config.js loads after this file */
  function site() {
    const cfg = window.ADDDOTS_CONFIG || {};
    return String(cfg.shareServer || 'https://pdf.adddots.com/').replace(/\/?$/, '/');
  }

  /* What the website's latest.js says, in a frame sandboxed to an origin of
     its own (latest-frame.html): a script from the website never runs with
     the app's rights. Only a build id, a time and a few lines of notes are
     taken from its answer. */
  function cleanLatest(v) {
    if (!v || typeof v !== 'object' || typeof v.time !== 'number' || !isFinite(v.time)) return null;
    return {
      id: String(v.id || '').slice(0, 80),
      time: v.time,
      notes: (Array.isArray(v.notes) ? v.notes : [])
        .filter(function (n) { return typeof n === 'string'; })
        .slice(0, 4)
        .map(function (n) { return n.slice(0, 300); })
    };
  }
  function fetchLatest() {
    return new Promise(function (resolve) {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.title = 'Update check';
      f.hidden = true;
      let timer = 0;
      const done = function (v) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        f.remove();
        resolve(v);
      };
      const onMessage = function (e) {
        if (e.source !== f.contentWindow || !e.data || e.data.adddotsLatest !== true) return;
        done(cleanLatest(e.data.v));
      };
      window.addEventListener('message', onMessage);
      timer = setTimeout(function () { done(null); }, 30000);    /* no answer: no notice */
      f.src = 'latest-frame.html?site=' + encodeURIComponent(site());
      document.body.appendChild(f);
    });
  }

  /* for the desktop end-to-end test: what the website says, or null */
  X.latestBuild = fetchLatest;

  function newer(v) { return !!(v && v.time && BUILD && BUILD.time && v.time > BUILD.time + 60000); }
  function openStorePage() {
    X.openStore().catch(function () {
      X.toast('Open the Microsoft Store, then Library, to update Add Dots PDF');
    });
  }
  function openSite() { window.open(site(), '_blank'); }

  /* Asked by What is new (js/appbar.js), as a browser's About page asks:
     resolves to { state: 'latest' } or { state: 'update', run } (run takes
     the update the way its own button does), or { state: 'unknown' } when
     no one could say (offline, development). */
  X.checkForUpdate = function () {
    if (IN_DESKTOP || IN_PHONE) {
      const store = IN_DESKTOP && X.storeUpdate
        ? X.storeUpdate().catch(function () { return false; })
        : Promise.resolve(null);
      return store.then(function (has) {
        if (has === true) return { state: 'update', run: openStorePage };
        if (has === false) return { state: 'latest' };
        if (!BUILD) return { state: 'unknown' };
        return fetchLatest().then(function (v) {
          if (!v) return { state: 'unknown' };
          if (!newer(v)) return { state: 'latest' };
          return { state: 'update', run: IN_DESKTOP && X.openStore ? openStorePage : openSite };
        });
      });
    }
    /* the website: always the newest once reloaded; one may be waiting */
    return Promise.resolve(webReady ? { state: 'update', run: reloadIntoUpdate } : { state: 'latest' });
  };

  /* Soon after start, then every six hours while open: only ever lights
     the bell, the panel's own click asks fresh for what to do about it. */
  function checkApp() {
    if (!(IN_DESKTOP || IN_PHONE) || !BUILD || IN_FRAME) return;
    const store = IN_DESKTOP && X.storeUpdate
      ? X.storeUpdate().catch(function () { return false; })
      : Promise.resolve(null);
    store.then(function (has) {
      if (has === true) flagBell();
      else if (has === null) fetchLatest().then(function (v) { if (newer(v)) flagBell(); });
    });
  }

  X.on('ready', function () {
    if (!BUILD) return;
    setTimeout(checkApp, 8000);
    setInterval(checkApp, 6 * 3600000);
  });
})();
