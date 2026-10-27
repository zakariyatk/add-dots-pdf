/* Add Dots PDF — Document tabs
   ----------------------------
   Each PDF in a tab of its own, as in Acrobat and WPS. The first document is
   the app itself; every other one is the same app in a frame of its own
   (index.html?tab=N), so each tab keeps its own pages, marks, undo, search
   and recovery copy, and none can disturb another.

   Opening a file with one already open (Open, Ctrl+O, several files picked
   at once, a file dropped on the home screen) makes a new tab; dropping a
   PDF onto an open page still adds its pages there. In the Windows app the
   tabs sit in the title bar from the first document on, as in Acrobat; they
   are dragged along it to reorder them, and Ctrl+Tab / Ctrl+Shift+Tab move
   between them. On the website they are a strip that shows once there are
   two. A tab says what it holds (name, unsaved changes) to the bar; closing
   one with unsaved changes asks first.

   As in Acrobat, Home is not a tab: the house button in the top bar shows
   it, with no tab in view, and the app itself has a tab only while it holds
   a document. Closing a tab closes that one document and no other, and the
   tab beside it comes into view (the next one, else the one before); the
   last one closed leaves Home.

   In the Windows app a PDF opened from Explorer gets a tab too, and a tab
   can be moved to a window of its own, as in Acrobat: drag it down out of
   the bar, or right-click it, "Move to new window". It goes with its
   unsaved work, still editable (js/desktop.js carries it over).

   The Windows app only. On the website the browser's own tabs do this (a
   PDF in each), and another file opened replaces the one open, asking
   first when it has unsaved changes; the phone app keeps one document at
   a time too. Tests of the tabs in a browser set window.ADDDOTS_TABS; tests
   that open file after file in one page set window.ADDDOTS_NO_TABS. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[tabs] core bridge missing'); return; }

  const tabParam = /[?&]tab=(\d+)/.exec(location.search);
  const inTab = !!tabParam && window.parent !== window;
  /* the phone app keeps one document at a time */
  const IN_PHONE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  /* the Windows app (its window's, or the one this frame is in) */
  let desk = !!window.__TAURI__;
  try { if (!desk && window.parent !== window) desk = !!window.parent.__TAURI__; } catch (e) { /* not the app's */ }
  const off = function () { return !!window.ADDDOTS_NO_TABS || IN_PHONE || !(desk || window.__TAURI__ || window.ADDDOTS_TABS); };

  /* ================= inside a tab ================= */

  if (inTab) {
    const id = +tabParam[1];
    const up = function (m) { try { window.parent.postMessage(Object.assign({ tabId: id }, m), location.origin); } catch (e) {} };
    document.documentElement.classList.add('in-doctab');

    /* another file, from in here: a tab of its own, made by the bar */
    X.tabs = {
      available: function () { return true; },
      openFiles: function (files) { up({ t: 'adpdf-tab-open', files: files }); },
      openMerged: function (files) { up({ t: 'adpdf-tab-open', files: files, merge: true }); }
    };

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.t !== 'adpdf-tab-files') return;
      const files = e.data.files || [];
      if (files.length && X.openFiles) X.openFiles(files, { merge: !!e.data.merge });
    });

    /* the tab keys (Ctrl+Tab...) pressed in here are the bar's */
    document.addEventListener('keydown', function (e) {
      let k = null;
      try { k = window.parent.ADDPDF.tabKeyOf(e); } catch (err) { return; }
      if (!k) return;
      e.preventDefault(); e.stopPropagation();
      up({ t: 'adpdf-tab-key', k: k });
    }, true);

    X.on('ready', function () {
      up({ t: 'adpdf-tab-ready' });
      let last = '';
      setInterval(function () {
        const st = {
          name: X.hasDoc() && X.docName ? X.docName() : '',
          dirty: !!(X.isDirty && X.isDirty())
        };
        const k = JSON.stringify(st);
        if (k === last) return;
        last = k;
        up(Object.assign({ t: 'adpdf-tab-state' }, st));
      }, 700);
    });
    return;
  }

  /* ================= the bar, in the app itself ================= */

  X.on('ready', function () {
    const $ = X.$;
    let seq = 0, active = 0;
    /* a tab being dragged: { id, x, y, el, on, pid, moved } */
    let tear = null;
    /* tab 0 is the app itself; the others are frames */
    const tabs = [{ id: 0, frame: null, name: '', dirty: false, el: null }];

    const bar = document.createElement('div');
    bar.className = 'doctabs'; bar.id = 'docTabs'; bar.hidden = true;
    /* the list is the tablist: it holds tabs only, and + stays beside it */
    const list = document.createElement('div'); list.className = 'dtlist';
    list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', 'Open documents');
    const add = document.createElement('button');
    add.className = 'dtadd'; add.type = 'button'; add.title = 'Open a PDF in a new tab (Ctrl+O)';
    add.setAttribute('aria-label', 'Open a PDF in a new tab');
    add.textContent = '+';
    bar.appendChild(list); bar.appendChild(add);
    const app = document.querySelector('.app');
    app.insertBefore(bar, app.firstChild);

    const host = document.createElement('div');
    host.className = 'dtframes'; host.id = 'docFrames'; host.hidden = true;
    document.body.appendChild(host);

    function byId(id) { return tabs.filter(function (t) { return t.id === id; })[0]; }
    /* As in Acrobat, Home is not a tab: the app itself shows a tab only while
       it holds a document, and the house button in the top bar goes Home */
    function shown(t) { return t.id !== 0 || X.hasDoc(); }
    function visible() { return tabs.filter(shown); }
    /* on Home, no tab is the one in view */
    function atHome() { return active === 0 && X.homeShown(); }
    function label(t) {
      if (t.id === 0) return X.hasDoc() ? X.docName() : 'Home';
      return t.name || 'Opening…';
    }
    function dirtyOf(t) { return t.id === 0 ? !!(X.isDirty && X.isDirty()) : t.dirty; }

    /* The Windows app only: what the website and the phone apps have stays
       as it was (a strip of tabs from the second document on) */
    const DESK = !!window.__TAURI__;

    /* In the Windows app the tabs sit in the title bar (js/appbar.js), after
       Create, as in Acrobat. Elsewhere they are a strip of their own. */
    function place() {
      const ab = DESK && document.getElementById('appBar');
      const inAb = !!(ab && getComputedStyle(ab).display !== 'none');
      if (inAb && bar.parentNode !== ab) ab.insertBefore(bar, ab.querySelector('.abgrow'));
      else if (!inAb && bar.parentNode !== app) app.insertBefore(bar, app.firstChild);
      bar.classList.toggle('inbar', inAb);
      return inAb;
    }

    function paint() {
      const inAb = place();
      /* in the top bar a document shows its tab from the first one on */
      const vis = visible();
      bar.hidden = !(vis.length > 1 || (inAb && vis.length));
      document.body.classList.toggle('has-doctabs', !bar.hidden);
      document.documentElement.style.setProperty('--doctabs-h', bar.hidden || inAb ? '0px' : bar.offsetHeight + 'px');
      const home = atHome();
      /* Each tab keeps its element: one made again under the pointer would
         lose the click on its × or a drag under way. Only what changed is
         changed, and the order only when a tab is not being dragged. */
      tabs.forEach(function (t) {
        if (t.el && (!shown(t) || tabs.indexOf(t) < 0)) { t.el.remove(); t.el = null; }
      });
      Array.prototype.slice.call(list.children).forEach(function (b) {
        if (!vis.some(function (t) { return t.el === b; })) b.remove();
      });
      vis.forEach(function (t, i) {
        const on = t.id === active && !home;
        let b = t.el;
        if (!b) {
          b = document.createElement('div');
          b.setAttribute('role', 'tab');
          b.tabIndex = 0;
          b.dataset.id = t.id;
          b.innerHTML = '<svg viewBox="0 0 24 24" class="dtico"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>' +
            '<span class="dtname"></span><i class="dtdot" aria-hidden="true"></i>' +
            /* not a button of its own: a tab holds nothing focusable. Delete
               or Ctrl+W close the tab from the keyboard */
            '<span class="dtx" aria-hidden="true" title="Close">&times;</span>';
          t.el = b;
        }
        const cls = 'dtab' + (on ? ' on' : '') + (dirtyOf(t) ? ' dirty' : '') + (b.classList.contains('tearing') ? ' tearing' : '');
        if (b.className !== cls) b.className = cls;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        const name = label(t);
        const tip = name + (dirtyOf(t) ? ' — unsaved changes' : '') +
          (X.newWindow ? '\nDrag it down out of the bar, or right-click it, to move it to a window of its own' : '');
        if (b.title !== tip) b.title = tip;
        const nm = b.querySelector('.dtname');
        if (nm.textContent !== name) nm.textContent = name;
        if (list.children[i] !== b && !(tear && tear.on)) list.insertBefore(b, list.children[i] || null);
      });
    }

    function select(id) {
      const t = byId(id); if (!t) return;
      /* the app's own tab, picked while Home covers it: its document */
      if (id === 0 && X.hasDoc() && X.homeShown()) X.hideHome();
      active = id;
      tabs.forEach(function (x) { if (x.frame) x.frame.hidden = x.id !== id; });
      host.hidden = id === 0;
      document.body.classList.toggle('doctab-away', id !== 0);
      paint();
      if (t.frame) { try { t.frame.focus(); } catch (e) {} }
    }

    function newTab(files, merge) {
      const t = { id: ++seq, frame: null, name: '', dirty: false, el: null, files: files, ready: false, merge: !!merge };
      const f = document.createElement('iframe');
      f.className = 'dtframe';
      f.title = 'Document';
      f.src = location.pathname + '?tab=' + t.id;
      f.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
      t.frame = f;
      host.appendChild(f);
      tabs.push(t);
      t.name = files && files[0] ? files[0].name : '';
      select(t.id);
      return t;
    }

    /* Home, as the house button in the top bar has it: the app's own page,
       with no tab in view */
    function goHome() {
      active = 0;
      tabs.forEach(function (x) { if (x.frame) x.frame.hidden = true; });
      host.hidden = true;
      document.body.classList.remove('doctab-away');
      if (!X.homeShown()) X.showHome();
      paint();
    }

    /* Closes that tab and no other. The one in view goes to the tab beside
       it, the next one or else the one before, as in Acrobat; with none
       left, Home. force: no question about unsaved work (it has gone to
       another window) */
    function close(id, force) {
      const t = byId(id); if (!t || !shown(t)) return;
      if (!force && dirtyOf(t) && !confirm('Close "' + label(t) + '"? Its unsaved changes will be lost.')) return;
      const vis = visible(), at = vis.indexOf(t);
      const next = vis[at + 1] || vis[at - 1] || null;
      if (id === 0) {
        /* the app itself stays, out of the bar until it opens another document */
        if (X.closeDocument) X.closeDocument();
      } else {
        tabs.splice(tabs.indexOf(t), 1);
        if (t.frame) t.frame.remove();
      }
      if (active !== id) { paint(); return; }
      if (next) select(next.id); else goHome();
    }

    /* ---- a tab to a window of its own (the Windows app) ---- */
    function canDetach(id) {
      const t = byId(id);
      return !!(X.newWindow && t && shown(t) && visible().length > 1 && (id === 0 || t.ready));
    }
    /* at: where on the screen it was let go of, for the window to open there */
    function detach(id, at) {
      if (!canDetach(id)) return;
      const t = byId(id);
      const W = id === 0 ? X : t.frame.contentWindow && t.frame.contentWindow.ADDPDF;
      if (!W || !W.hasDoc() || !W.exportSession) return;
      let d;
      try { d = W.exportSession(); } catch (e) { X.toast('That document could not be moved'); return; }
      d.name = label(t);
      X.newWindow(d, at).then(function () {
        try { W.forgetSession(); } catch (e) { /* its record goes stale and is dropped */ }
        close(id, true);
      }, function (e) {
        console.error('[tabs] new window', e);
        X.toast('Could not open a new window');
      });
    }

    const menu = document.createElement('div');
    menu.className = 'dtmenu'; menu.hidden = true; menu.setAttribute('role', 'menu');
    menu.innerHTML = '<button type="button" role="menuitem" data-a="win">Move to new window</button>' +
      '<button type="button" role="menuitem" data-a="close">Close</button>';
    document.body.appendChild(menu);
    let menuFor = null;
    function hideMenu() { menu.hidden = true; menuFor = null; }
    list.addEventListener('contextmenu', function (e) {
      const tab = e.target.closest('.dtab'); if (!tab) return;
      e.preventDefault();
      menuFor = +tab.dataset.id;
      menu.querySelector('[data-a="win"]').hidden = !canDetach(menuFor);
      menu.hidden = false;
      menu.style.left = Math.min(window.innerWidth - menu.offsetWidth - 6, e.clientX) + 'px';
      menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 6, e.clientY) + 'px';
    });
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b || menuFor == null) return;
      const id = menuFor;
      hideMenu();
      if (b.dataset.a === 'win') detach(id); else close(id);
    });
    document.addEventListener('pointerdown', function (e) { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) hideMenu(); });

    /* dragged along the bar, a tab changes places with the others; dragged
       well clear of it, it tears off into a window */
    /* (declared with the tabs: paint() leaves the order alone while one is dragged) */
    list.addEventListener('pointerdown', function (e) {
      const tab = e.target.closest('.dtab');
      if (!tab || e.button !== 0 || e.target.closest('.dtx')) return;
      tear = { id: +tab.dataset.id, x: e.clientX, y: e.clientY, el: tab, on: false, pid: e.pointerId };
    });
    function reorder(e) {
      const over = Array.prototype.filter.call(list.children, function (b) {
        const r = b.getBoundingClientRect();
        return b !== tear.el && e.clientX >= r.left && e.clientX <= r.right;
      })[0];
      if (!over) return;
      const from = tabs.indexOf(byId(tear.id)), to = tabs.indexOf(byId(+over.dataset.id));
      if (from < 0 || to < 0) return;
      tabs.splice(to, 0, tabs.splice(from, 1)[0]);
      list.insertBefore(tear.el, to > from ? over.nextSibling : over);
      /* moved, it lets go of the pointer; it takes it back */
      try { tear.el.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works inside the window */ }
      tear.moved = true;
    }
    function away(e) {
      const r = bar.getBoundingClientRect();
      return e.clientY > r.bottom + 50 || e.clientY < 0 || e.clientX < 0 || e.clientX > window.innerWidth;
    }
    document.addEventListener('pointermove', function (e) {
      if (!tear || e.pointerId !== tear.pid) return;
      if (!tear.on && Math.hypot(e.clientX - tear.x, e.clientY - tear.y) > 8) {
        tear.on = true;
        try { tear.el.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works inside the window */ }
      }
      if (!tear.on) return;
      const out = away(e) && canDetach(tear.id);
      tear.el.classList.toggle('tearing', out);
      if (!out && DESK) reorder(e);
    });
    document.addEventListener('pointerup', function (e) {
      if (!tear || e.pointerId !== tear.pid) return;
      const t = tear; tear = null;
      t.el.classList.remove('tearing');
      if (t.on && away(e) && canDetach(t.id)) { suppressClick = true; detach(t.id, { x: e.screenX, y: e.screenY }); }
      else if (t.moved) suppressClick = true;
    });
    let suppressClick = false;

    list.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; return; }
      const tab = e.target.closest('.dtab'); if (!tab) return;
      const id = +tab.dataset.id;
      if (e.target.closest('.dtx')) { e.stopPropagation(); close(id); return; }
      select(id);
    });
    list.addEventListener('auxclick', function (e) {
      const tab = e.target.closest('.dtab');
      if (tab && e.button === 1) { e.preventDefault(); close(+tab.dataset.id); }
    });
    list.addEventListener('keydown', function (e) {
      const tab = e.target.closest('.dtab'); if (!tab) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(+tab.dataset.id); }
      if (e.key === 'Delete') { e.preventDefault(); close(+tab.dataset.id); }
    });
    add.addEventListener('click', function () {
      /* the picker of the tab in view: a file chosen there comes back here */
      const t = byId(active);
      if (t && t.frame && t.frame.contentDocument) {
        const fi = t.frame.contentDocument.getElementById('fileIn');
        if (fi) { fi.click(); return; }
      }
      $('fileIn').click();
    });

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || !e.data.t) return;
      const t = byId(e.data.tabId);
      if (e.data.t === 'adpdf-tab-open') {
        if (e.data.merge) newTab(e.data.files || [], true);
        else (e.data.files || []).forEach(function (f) { newTab([f]); });
        return;
      }
      if (!t) return;
      if (e.data.t === 'adpdf-tab-key') { if (t.id === active) tabKey(e.data.k); return; }
      if (e.data.t === 'adpdf-tab-ready') {
        t.ready = true;
        if (t.files && t.files.length) {
          t.frame.contentWindow.postMessage({ t: 'adpdf-tab-files', files: t.files, merge: t.merge }, location.origin);
          t.files = null;
        }
      } else if (e.data.t === 'adpdf-tab-state') {
        t.name = e.data.name || t.name;
        t.dirty = !!e.data.dirty;
        paint();
      }
    });

    /* the app's own name and changes follow its document (and in the top
       bar, its tab shows as soon as it has one) */
    let lastHost = '', hadDoc = X.hasDoc(), closedOnce = false;
    setInterval(function () {
      const host0 = byId(0);
      /* a document opened in the app itself after its first one was closed
         (from Home, or from Explorer with Home behind another tab): its tab
         joins the end of the bar, in view, as a new tab does. The first
         document, still opening as others arrive, keeps the first place. */
      if (hadDoc && !X.hasDoc()) closedOnce = true;
      if (X.hasDoc() && !hadDoc && closedOnce && tabs.length > 1) {
        tabs.push(tabs.splice(tabs.indexOf(host0), 1)[0]);
        select(0);
      }
      hadDoc = X.hasDoc();
      const k = label(host0) + '|' + dirtyOf(host0) + '|' + X.hasDoc() + '|' + X.homeShown();
      if (k !== lastHost) { lastHost = k; paint(); }
    }, 300);

    /* the keys Acrobat has: Ctrl+Tab and Ctrl+Page Down to the next tab,
       with Shift or Page Up to the one before; Ctrl+W and Ctrl+F4 close the
       tab in view. The Windows app only, as is dragging tabs to reorder them. */
    function tabKey(k) {
      if (k === 'close') {
        if (!atHome()) close(active);
        return;
      }
      const vis = visible();
      if (!vis.length || (vis.length < 2 && !atHome())) return;
      const at = atHome() ? -1 : vis.indexOf(byId(active));
      const n = (at + (k === 'next' ? 1 : at < 0 ? 0 : -1) + vis.length) % vis.length;
      select(vis[n].id);
      if (vis[n].el) vis[n].el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    X.tabKeyOf = function (e) {
      if (!DESK || !e.ctrlKey || e.altKey || e.metaKey) return null;
      if (e.key === 'Tab') return e.shiftKey ? 'prev' : 'next';
      if (e.key === 'PageDown' && !e.shiftKey) return 'next';
      if (e.key === 'PageUp' && !e.shiftKey) return 'prev';
      if (!e.shiftKey && (e.key === 'F4' || e.key === 'w' || e.key === 'W')) return 'close';
      return null;
    };
    document.addEventListener('keydown', function (e) {
      const k = X.tabKeyOf(e);
      if (!k || (k !== 'close' && visible().length < 2 && !atHome())) return;
      e.preventDefault(); e.stopPropagation();
      tabKey(k);
    }, true);

    /* closing the window with unsaved work in another tab asks too */
    window.addEventListener('beforeunload', function (e) {
      if (tabs.some(function (t) { return t.id !== 0 && t.dirty; })) { e.preventDefault(); e.returnValue = ''; }
    });

    X.tabs = {
      available: function () { return !off(); },
      openFiles: function (files) {
        (files || []).filter(function (f) { return /\.pdf$/i.test(f.name || '') || f.type === 'application/pdf'; })
          .forEach(function (f) { newTab([f]); });
      },
      /* several PDFs joined into one document, in a tab of its own */
      openMerged: function (files) {
        const pdfs = (files || []).filter(function (f) { return /\.pdf$/i.test(f.name || '') || f.type === 'application/pdf'; });
        if (pdfs.length) newTab(pdfs, true);
      },
      list: function () { return visible().map(function (t) { return { id: t.id, name: label(t), dirty: dirtyOf(t), active: t.id === active && !atHome() }; }); },
      select: select,
      close: close,
      /* the top bar's house button, with documents in tabs */
      home: goHome,
      frame: function (id) { const t = byId(id); return t && t.frame; }
    };
    window.addEventListener('resize', function () { if (!bar.hidden) paint(); });
  });
})();
