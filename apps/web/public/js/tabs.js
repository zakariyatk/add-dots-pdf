/* Add Dots PDF — Document tabs
   ----------------------------
   Each PDF in a tab of its own, as in Acrobat and WPS. The first document is
   the app itself; every other one is the same app in a frame of its own
   (index.html?tab=N), so each tab keeps its own pages, marks, undo, search
   and recovery copy, and none can disturb another.

   Opening a file with one already open (Open, Ctrl+O, several files picked
   at once, a file dropped on the home screen) makes a new tab; dropping a
   PDF onto an open page still adds its pages there. The bar shows once there
   are two tabs. A tab says what it holds (name, unsaved changes) to the bar;
   closing one with unsaved changes asks first.

   In the Windows app a PDF opened from Explorer gets a tab too, and a tab
   can be moved to a window of its own, as in Acrobat: drag it down out of
   the bar, or right-click it, "Move to new window". It goes with its
   unsaved work, still editable (js/desktop.js carries it over).

   Tests that open file after file in one page set window.ADDDOTS_NO_TABS.
   The phone app has none: one document at a time on a phone. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[tabs] core bridge missing'); return; }

  const tabParam = /[?&]tab=(\d+)/.exec(location.search);
  const inTab = !!tabParam && window.parent !== window;
  /* the phone app keeps one document at a time */
  const IN_PHONE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const off = function () { return !!window.ADDDOTS_NO_TABS || IN_PHONE; };

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
    /* tab 0 is the app itself; the others are frames */
    const tabs = [{ id: 0, frame: null, name: '', dirty: false, el: null }];

    const bar = document.createElement('div');
    bar.className = 'doctabs'; bar.id = 'docTabs'; bar.hidden = true;
    bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Open documents');
    const list = document.createElement('div'); list.className = 'dtlist';
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
    function label(t) {
      if (t.id === 0) return X.hasDoc() ? X.docName() : 'Home';
      return t.name || 'Opening…';
    }
    function dirtyOf(t) { return t.id === 0 ? !!(X.isDirty && X.isDirty()) : t.dirty; }

    function paint() {
      bar.hidden = tabs.length < 2;
      document.body.classList.toggle('has-doctabs', !bar.hidden);
      document.documentElement.style.setProperty('--doctabs-h', bar.hidden ? '0px' : bar.offsetHeight + 'px');
      list.innerHTML = '';
      tabs.forEach(function (t) {
        const b = document.createElement('div');
        b.className = 'dtab' + (t.id === active ? ' on' : '') + (dirtyOf(t) ? ' dirty' : '');
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', t.id === active ? 'true' : 'false');
        b.tabIndex = 0;
        b.dataset.id = t.id;
        const name = label(t);
        b.title = name + (dirtyOf(t) ? ' — unsaved changes' : '') +
          (X.newWindow ? '\nDrag it down out of the bar, or right-click it, to move it to a window of its own' : '');
        b.innerHTML = '<svg viewBox="0 0 24 24" class="dtico"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>' +
          '<span class="dtname"></span><i class="dtdot" aria-hidden="true"></i>' +
          (t.id === 0 && !X.hasDoc() ? '' :
            '<button type="button" class="dtx" aria-label="Close ' + X.esc(name) + '" title="Close">&times;</button>');
        b.querySelector('.dtname').textContent = name;
        list.appendChild(b);
        t.el = b;
      });
    }

    function select(id) {
      const t = byId(id); if (!t) return;
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

    /* force: no question about unsaved work (it has gone to another window) */
    function close(id, force) {
      const t = byId(id); if (!t) return;
      if (!force && dirtyOf(t) && !confirm('Close "' + label(t) + '"? Its unsaved changes will be lost.')) return;
      const at = tabs.indexOf(t);
      if (id === 0) {
        /* the app itself stays, as the Home tab: its document is put away */
        if (X.hasDoc() && X.closeDocument) X.closeDocument();
        if (active === 0 && tabs.length > 1) select(tabs[1].id); else paint();
        return;
      }
      tabs.splice(at, 1);
      if (t.frame) t.frame.remove();
      if (active === id) {
        const next = tabs[Math.min(at, tabs.length - 1)] || tabs[0];
        select(next.id);
      } else paint();
    }

    /* ---- a tab to a window of its own (the Windows app) ---- */
    function canDetach(id) {
      const t = byId(id);
      return !!(X.newWindow && t && tabs.length > 1 && (id !== 0 || X.hasDoc()) && (id === 0 || t.ready));
    }
    function detach(id) {
      if (!canDetach(id)) return;
      const t = byId(id);
      const W = id === 0 ? X : t.frame.contentWindow && t.frame.contentWindow.ADDPDF;
      if (!W || !W.hasDoc() || !W.exportSession) return;
      let d;
      try { d = W.exportSession(); } catch (e) { X.toast('That document could not be moved'); return; }
      d.name = label(t);
      X.newWindow(d).then(function () {
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

    /* dragged well clear of the bar, a tab tears off into a window */
    let tear = null;
    list.addEventListener('pointerdown', function (e) {
      const tab = e.target.closest('.dtab');
      if (!tab || e.button !== 0 || e.target.closest('.dtx') || !canDetach(+tab.dataset.id)) return;
      tear = { id: +tab.dataset.id, x: e.clientX, y: e.clientY, el: tab, on: false, pid: e.pointerId };
    });
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
      if (tear.on) tear.el.classList.toggle('tearing', away(e));
    });
    document.addEventListener('pointerup', function (e) {
      if (!tear || e.pointerId !== tear.pid) return;
      const t = tear; tear = null;
      t.el.classList.remove('tearing');
      if (t.on && away(e)) { suppressClick = true; detach(t.id); }
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

    /* the app's own name and changes follow its document */
    let lastHost = '';
    setInterval(function () {
      const k = label(tabs[0]) + '|' + dirtyOf(tabs[0]);
      if (k !== lastHost) { lastHost = k; if (!bar.hidden) paint(); }
    }, 700);

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
      list: function () { return tabs.map(function (t) { return { id: t.id, name: label(t), dirty: dirtyOf(t), active: t.id === active }; }); },
      select: select,
      close: close,
      frame: function (id) { const t = byId(id); return t && t.frame; }
    };
    window.addEventListener('resize', function () { if (!bar.hidden) paint(); });
  });
})();
