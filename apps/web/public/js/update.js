/* ADD DOTS PDF — Updates
   ---------------------
   Telling the reader about a new version, wherever the app runs:

   - On the website the service worker fetches a new version by itself
     (js/pwa.js). With no document open the page simply reloads into it; with
     one open, the bar below says an update is ready and offers to take it.
   - The Windows and phone apps carry every file and do not change on their
     own. They load latest.js from the website, which names the build the
     website has; when that is newer than this one, the bar offers the update:
     on Windows, this app's page in the Microsoft Store.
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

  /* latest.js is a script, so loading it from the website needs no CORS
     header there; it sets window.ADDDOTS_LATEST */
  function fetchLatest() {
    return new Promise(function (resolve) {
      const s = document.createElement('script');
      s.src = site() + 'latest.js?t=' + Date.now();
      s.async = true;
      const done = function () {
        s.remove();
        const v = window.ADDDOTS_LATEST || null;
        window.ADDDOTS_LATEST = undefined;
        resolve(v);
      };
      s.onload = done;
      s.onerror = function () { s.remove(); resolve(null); };    /* offline: no notice */
      document.head.appendChild(s);
    });
  }

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

  function checkApp() {
    if (!(IN_DESKTOP || IN_PHONE) || !BUILD) return;
    fetchLatest().then(offerAppUpdate);
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
