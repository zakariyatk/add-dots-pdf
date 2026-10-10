/* ADD DOTS PDF — Updates
   ---------------------
   Telling the reader about a new version, wherever the app runs:

   - On the website the service worker fetches a new version by itself
     (js/pwa.js). With no document open the page simply reloads into it; with
     one open, the bar below says an update is ready and offers to take it.
   - The Windows app from the Microsoft Store asks the Store itself whether
     it has a newer version (src-tauri/src/store.rs), and installs it from
     the app. The website is no guide there: a build reaches the Store only
     once it is submitted and certified, days after the website has it.
   - The setup .exe and the phone apps carry every file and do not change on
     their own. They load latest.js from the website, which names the build
     the website has; when that is newer than this one, the bar offers the
     update: on Windows, this app's page in the Microsoft Store.
   - After any update, the first start shows what is new (whatsnew.json,
     built into js/build.js).

   js/build.js says which build this is; without it (development) nothing
   here runs. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[update] core bridge missing'); return; }

  const BUILD = window.ADDDOTS_BUILD || null;
  const IN_DESKTOP = !!window.__TAURI__;
  /* a document tab is a frame of the window, which tells of updates itself */
  const IN_FRAME = window.parent !== window;
  const IN_PHONE = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform());
  const SEEN = 'adddots.build.seen';
  const LATER = 'adddots.update.later';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } }
  function esc(s) { return X.esc ? X.esc(s) : String(s); }

  /* ---------------- the bar ----------------
     One at a time, under the top bar on the right, until it is acted on or
     closed: a toast would be gone before it is read. */
  let bar = null;
  function showBar(title, text, actions) {
    hideBar();
    bar = document.createElement('div');
    bar.className = 'updbar'; bar.id = 'updBar';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span class="updico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12"/>' +
      '<polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg></span>' +
      '<div class="updtxt"><b>' + esc(title) + '</b>' + (text ? '<span>' + text + '</span>' : '') + '</div>' +
      '<div class="updacts"></div>' +
      '<button type="button" class="updx" aria-label="Close" title="Close">×</button>';
    const acts = bar.querySelector('.updacts');
    (actions || []).forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', function () { if (a.run) a.run(); if (a.close !== false) hideBar(); });
      acts.appendChild(b);
    });
    bar.querySelector('.updx').addEventListener('click', function () {
      hideBar();
      if (bar && bar.onclose) bar.onclose();
    });
    document.body.appendChild(bar);
    return bar;
  }
  function hideBar() { if (bar) { bar.remove(); bar = null; } }

  function notesHtml(notes) {
    const n = (notes || []).slice(0, 4);
    return n.length ? '<ul>' + n.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '';
  }

  /* ---------------- website: the service worker has the update ---------------- */

  /* js/pwa.js calls this when an update is ready but a document is open */
  X.updateReady = function () {
    showBar('A new version of ADD DOTS PDF is ready', 'Update now to get the latest tools.', [
      {
        label: 'Update now', primary: true,
        run: function () {
          if (X.isDirty && X.isDirty() &&
              !window.confirm('Update now? Changes you have not saved will be lost. ' +
                              'Choose Cancel, save your PDF, then click Update now again.')) {
            return;
          }
          location.reload();
        }
      },
      { label: 'Later' }
    ]);
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

  function offerAppUpdate(v) {
    if (!v || !v.time || !BUILD || !BUILD.time) return;
    if (v.time <= BUILD.time + 60000) return;                   /* this build, or older */
    /* "Later" waits a day before asking about the same build again */
    const later = (get(LATER) || '').split('|');
    if (later[0] === v.id && Date.now() - (+later[1] || 0) < 86400000) return;
    const later1 = { label: 'Later', run: function () { set(LATER, v.id + '|' + Date.now()); } };
    if (IN_DESKTOP && X.openStore) {
      showBar('An update for ADD DOTS PDF is available',
        'The Microsoft Store installs it. What is new:' + notesHtml(v.notes),
        [{ label: 'Update', primary: true, run: function () {
          X.openStore().catch(function () {
            X.toast('Open the Microsoft Store, then Library, to update ADD DOTS PDF');
          });
        } }, later1]);
    } else {
      /* the phone apps, until they are in their stores: the website has it */
      showBar('A newer version of ADD DOTS PDF is available',
        'It is on the website now. What is new:' + notesHtml(v.notes),
        [{ label: 'Open website', primary: true, run: function () { window.open(site(), '_blank'); } }, later1]);
    }
  }

  /* the Store's install: the Store has a newer version */
  function offerStoreUpdate() {
    const later = (get(LATER) || '').split('|');
    if (later[0] === 'store' && Date.now() - (+later[1] || 0) < 86400000) return;
    showBar('An update for ADD DOTS PDF is available',
      'The Microsoft Store has a new version. The app closes to install it, then starts again.',
      [{ label: 'Update', primary: true, run: function () {
        if (!window.confirm('ADD DOTS PDF closes to install the update. ' +
                            'Save your PDFs first. Install the update now?')) return;
        X.storeInstall().then(function (r) {
          if (r === 'failed') {
            X.toast('The Microsoft Store could not install the update; opening its page');
            X.openStore().catch(function () {});
          } else if (r === 'nothing') {
            X.toast('ADD DOTS PDF is up to date');
          }
        }, function () {
          X.openStore().catch(function () {
            X.toast('Open the Microsoft Store, then Library, to update ADD DOTS PDF');
          });
        });
      } }, { label: 'Later', run: function () { set(LATER, 'store|' + Date.now()); } }]);
  }

  function checkApp() {
    if (!(IN_DESKTOP || IN_PHONE) || !BUILD || IN_FRAME) return;
    /* the Store's install asks the Store; null means this is not one */
    const store = IN_DESKTOP && X.storeUpdate
      ? X.storeUpdate().catch(function () { return false; })
      : Promise.resolve(null);
    store.then(function (has) {
      if (has === true) offerStoreUpdate();
      else if (has === null) fetchLatest().then(offerAppUpdate);
    });
  }

  /* ---------------- after an update: what is new ---------------- */

  function whatsNew() {
    if (!BUILD || !BUILD.id) return;
    const seen = get(SEEN);
    set(SEEN, BUILD.id);
    /* the very first start is not an update */
    if (!seen || seen === BUILD.id || !(BUILD.notes && BUILD.notes.length)) return;
    const b = showBar('ADD DOTS PDF has been updated', 'What is new:' + notesHtml(BUILD.notes), [
      { label: 'Got it', primary: true }
    ]);
    b.classList.add('updnew');
  }

  X.on('ready', function () {
    if (!BUILD) return;
    setTimeout(whatsNew, 1200);
    /* the apps: soon after start, then every six hours while open */
    setTimeout(checkApp, 8000);
    setInterval(checkApp, 6 * 3600000);
  });
})();
