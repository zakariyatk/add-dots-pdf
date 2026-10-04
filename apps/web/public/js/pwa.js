/* Installability, the offline copy, and staying current.

   Loads last, after core.js has published window.ADDPDF, and touches the rest
   of the app through three things only: ADDPDF.toast for messages, ADDPDF.hasDoc
   to find out whether reloading would interrupt someone, and ADDPDF.openFiles
   for a PDF handed over by the operating system. Nothing here is required for
   the editor to work — if the service worker is blocked, or the browser has no
   install prompt, the page carries on unchanged. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var api = window.ADDPDF;
  function toast(html) { if (api && api.toast) api.toast(html); }
  function ready(fn) {
    /* ADDPDF.on('ready') is sticky, so this runs even though core finished
       booting before this file was parsed */
    if (api && api.on) api.on('ready', fn); else window.addEventListener('load', fn);
  }

  /* ---------- staying current ----------
     The app runs from the cache, so it opens with no connection at all. When
     there is one, sw.js compares what it holds against the server and says so
     here; this is the half that decides what the reader sees happen. Idle: the
     page swaps itself over. Mid-document: it waits to be asked, because a
     reload under unsaved marks would cost work. */
  /* The desktop app (Tauri) and the phone app (Capacitor) carry every file
     in the app and update with a new version of it: no offline copy to
     keep, nothing to install. */
  /* a document tab in the Windows app is a frame: the app is its parent */
  var tauri = window.__TAURI__;
  try { if (!tauri && window.parent !== window) tauri = window.parent.__TAURI__; } catch (e) { /* not the app's */ }
  var IN_APP = !!tauri ||
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var hadWorker = !!navigator.serviceWorker && !!navigator.serviceWorker.controller;
  var reloading = false;
  var reg = null, lastCheck = 0;

  function busy() {
    /* a document on screen: reloading would throw away the reader's place,
       and any marks they have not saved */
    try { return !!(api && api.hasDoc && api.hasDoc()); } catch (e) { return true; }
  }

  function applyUpdate() {
    if (reloading) return;
    /* a document open: a bar that stays until it is answered (js/update.js) */
    if (busy()) {
      if (api && api.updateReady) api.updateReady(); else toast('An update is ready · reload when you have saved');
      return;
    }
    /* A belt-and-braces stop on reload loops: if anything ever reports an
       update on every load, this turns the second one into a message. */
    var last = 0;
    try { last = +sessionStorage.getItem('adpdf-reloaded') || 0; } catch (e) {}
    if (Date.now() - last < 15000) { toast('An update is ready · reload to take it'); return; }
    try { sessionStorage.setItem('adpdf-reloaded', String(Date.now())); } catch (e) {}
    reloading = true;
    location.reload();
  }

  function checkForUpdate() {
    var now = Date.now();
    if (now - lastCheck < 60000) return;
    lastCheck = now;
    /* two different questions: has sw.js itself changed, and has anything it
       is holding changed */
    if (reg) reg.update().catch(function () {});
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'adpdf-check' });
    }
  }

  if (!IN_APP && 'serviceWorker' in navigator) {
    /* after load: the first paint matters more than the worker does */
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (r) {
        reg = r;
        /* a deploy that lands while this window sits open */
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) checkForUpdate();
        });
        window.addEventListener('online', function () { lastCheck = 0; checkForUpdate(); });
        setInterval(checkForUpdate, 1800000);
      }).catch(function (e) {
        /* file:// , a private window, or the host refusing the script */
        console.warn('[pwa] service worker not registered', e);
      });
    });

    /* sw.js found newer files and has already stored them */
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'adpdf-update') applyUpdate();
    });
    /* addEventListener alone leaves the queue closed — only setting .onmessage
       opens it implicitly, and a message sent before this point would be lost */
    if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();

    /* sw.js itself changed and the new worker has taken over */
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadWorker) applyUpdate();       /* the first worker to claim a fresh page is not an update */
    });
  }

  /* ---------- offering the install ----------
     Two ways in on Chrome and Edge, both driven by the one beforeinstallprompt
     event the browser hands over: the button on the home panel, and the card
     that comes up on its own a few seconds later. A browser will not open its
     own install dialog without a click, so the card is what asks for that click.

     iPhone and iPad get neither — Safari has no install prompt at all, on any
     platform — so there the same card carries the two steps to do it by hand.
     Android Chrome behaves like the desktop and needs nothing special. */
  var btn = $('btnInstall'), prompted = null;
  var pop = $('instPop'), popTimer = null;
  var SNOOZE = 'adpdf-install-snooze', MONTH = 30 * 864e5;

  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function installed() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           navigator.standalone === true;
  }

  function snoozed() {
    try { return Date.now() < (+localStorage.getItem(SNOOZE) || 0); } catch (e) { return false; }
  }
  function snooze(ms) {
    try { localStorage.setItem(SNOOZE, String(Date.now() + ms)); } catch (e) {}
  }

  function onHome() {
    /* the home panel covers the editor, so this is "no document on screen" */
    var panel = $('openPanel');
    return !!panel && !panel.hidden;
  }

  function reveal() {
    pop.hidden = false;
    /* the fade waits for a painted frame, so a background tab shows it the
       moment it is looked at rather than animating where nobody is */
    requestAnimationFrame(function () { pop.classList.add('show'); });
  }

  function ready4Pop() {
    /* never over a document: someone reading is not someone to interrupt. The
       retry brings it back when they are next on the home panel. */
    return pop && pop.hidden && !snoozed() && onHome();
  }

  function showPop() {
    if (!prompted || !ready4Pop()) return;
    reveal();
  }

  /* Safari cannot be asked, so the card tells them where the button is. */
  function showIosPop() {
    if (installed() || !ready4Pop()) return;
    $('instBody').textContent =
      'Tap the Share button in Safari, then choose "Add to Home Screen".';
    $('instYes').hidden = true;
    $('instNo').textContent = 'Got it';
    reveal();
  }
  function hidePop() {
    if (!pop || pop.hidden) return;
    pop.classList.remove('show');
    setTimeout(function () { pop.hidden = true; }, 220);
  }

  function install() {
    if (!prompted) return;
    clearInterval(popTimer);
    hidePop();
    if (btn) btn.hidden = true;
    var e = prompted;
    prompted = null;                        /* a prompt event is good for one use */
    e.prompt();
    /* Chrome will not offer again for a while after a dismissal, so there is
       nothing to put back on screen either way. */
    if (e.userChoice) e.userChoice.catch(function () {});
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    if (IN_APP) return;
    /* Chrome and Edge only. Holding the event is what lets the app do the
       asking instead of leaving it to the icon in the address bar. */
    e.preventDefault();
    prompted = e;
    if (btn) btn.hidden = false;
    /* A breath after the page settles, so it reads as an offer rather than
       something that jumped out on load. It keeps trying quietly because that
       first moment can land while a document is open — then it waits and asks
       once they are back on the home panel. */
    clearInterval(popTimer);
    popTimer = setInterval(function () {
      if (!prompted || snoozed() || (pop && !pop.hidden)) { clearInterval(popTimer); return; }
      showPop();
    }, 2500);
  });

  if (IOS && !IN_APP && !installed() && pop) {
    /* nothing to wait for on iOS: there is no event, so the offer is ours to
       time. Same manners as the other one — home panel only, and it keeps
       looking until they are there. */
    if (btn) btn.hidden = false;
    popTimer = setInterval(function () {
      if (snoozed() || (pop && !pop.hidden)) { clearInterval(popTimer); return; }
      showIosPop();
    }, 2500);
  }

  if (btn) btn.addEventListener('click', function () {
    if (IOS) { snooze(0); showIosPop(); return; }   /* snooze(0) clears a dismissal */
    install();
  });
  if (pop) {
    $('instYes').addEventListener('click', install);
    $('instNo').addEventListener('click', function () {
      clearInterval(popTimer); snooze(MONTH); hidePop();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.hidden) { clearInterval(popTimer); snooze(MONTH); hidePop(); }
    });
  }

  window.addEventListener('appinstalled', function () {
    prompted = null;
    clearInterval(popTimer);
    hidePop();
    if (btn) btn.hidden = true;
    toast('Installed · open it from your desktop or home screen');
  });

  /* ---------- the Windows app ----------
     On Windows, outside the apps, the home panel links to the Store page:
     the Store app opens PDFs from Explorer and updates itself. */
  var getWin = $('hGetWin');
  if (getWin && !IN_APP && /Windows/.test(navigator.userAgent)) getWin.hidden = false;

  /* ---------- PDFs opened from the desktop ---------- */
  if ('launchQueue' in window && window.LaunchParams && 'files' in window.LaunchParams.prototype) {
    window.launchQueue.setConsumer(function (params) {
      if (!params.files || !params.files.length) return;
      Promise.all(params.files.map(function (h) { return h.getFile(); })).then(function (files) {
        /* straight into the same path the file picker uses, so several files
           still merge in order and a saved report still reattaches */
        ready(function () {
          /* the picker asks before it replaces unsaved work; a file sent in by
             the operating system has to ask the same question */
          if (api && api.okToReplace && api.hasDoc && api.hasDoc() && !api.okToReplace()) return;
          if (api && api.openFiles) api.openFiles(files);
        });
      });
    });
  }
})();
