/* Add Dots PDF — Top bar
   ---------------------
   The strip along the top of the window, as Acrobat has it: Menu, Home and
   Create on the left; help, what is new and the other Add Dots apps on the
   right. In the Windows app it is the window's title bar as well: the
   window has no frame of its own (tauri.conf.json, decorations off), so the
   strip is where the window is dragged from, and it carries minimise,
   maximise and close.

   Each button does what the same button in the document does (Save, Print,
   Home...), in the document in view: with tabs, that is the tab's frame.
   A tab's frame has no strip of its own, and neither has the phone app; on
   a narrow screen the website leaves it out (the phone layout has its own
   bars). */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[appbar] core bridge missing'); return; }

  if (/[?&]tab=\d+/.test(location.search) && window.parent !== window) return;
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;

  const T = window.__TAURI__;
  const win = T && T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null;
  /* which build this is (js/build.js): read when asked, as build.js loads
     after this file */
  const build = function () { return window.ADDDOTS_BUILD || null; };
  const NEWS = 'adddots.news.seen';

  const ic = function (p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; };
  const ICON = {
    menu: ic('<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>'),
    home: ic('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    plus: ic('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    help: ic('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17.2" r=".7" fill="currentColor"/>'),
    bell: ic('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    apps: ic('<circle cx="6" cy="6" r="1.6" fill="currentColor"/><circle cx="12" cy="6" r="1.6" fill="currentColor"/><circle cx="18" cy="6" r="1.6" fill="currentColor"/>' +
      '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>' +
      '<circle cx="6" cy="18" r="1.6" fill="currentColor"/><circle cx="12" cy="18" r="1.6" fill="currentColor"/><circle cx="18" cy="18" r="1.6" fill="currentColor"/>'),
    open: ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a1 1 0 0 0 1 1h14.5a1 1 0 0 0 1-.8L21.5 11H7.2a1 1 0 0 0-1 .8L4 19"/>'),
    blank: ic('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>'),
    combine: ic('<rect x="3" y="3" width="8" height="10" rx="1"/><rect x="13" y="11" width="8" height="10" rx="1"/><path d="M11 8h4v3"/><polyline points="13 9 15 11 17 9"/>'),
    save: ic('<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><rect x="8" y="3" width="7" height="5"/><rect x="7" y="13" width="10" height="8"/>'),
    saveas: ic('<path d="M5 3h11l4 4v5"/><path d="M4 5v14a2 2 0 0 0 2 2h5"/><rect x="8" y="3" width="7" height="5"/><path d="M14 21l1-3 5-5 2 2-5 5z"/>'),
    print: ic('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><rect x="7" y="14" width="10" height="7"/>'),
    ui: ic('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>'),
    close: ic('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
    link: ic('<path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    news: ic('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
    shield: ic('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
    /* drawn on a 10-unit grid, as Windows draws its own */
    wmin: '<svg viewBox="0 0 10 10" aria-hidden="true"><line x1="0" y1="5.5" x2="10" y2="5.5"/></svg>',
    wmax: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9"/></svg>',
    wrestore: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V.5h7v7h-2"/></svg>',
    wclose: '<svg viewBox="0 0 10 10" aria-hidden="true"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg>'
  };

  /* the Add Dots PDF logo: a page with AD and three dots */
  const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="20" fill="#000"/><path d="M33 18.5H54V31a7 7 0 0 0 7 7H74.5V75a7.5 7.5 0 0 1-7.5 7.5H33a7.5 7.5 0 0 1-7.5-7.5V26a7.5 7.5 0 0 1 7.5-7.5z" fill="#fff"/><path d="M57.8 19.2L74 35.4H62a4.2 4.2 0 0 1-4.2-4.2z" fill="#7357FF"/><path d="M36.3 58.8L41.7 52.2L43.9 58.8z" fill="#7357FF"/><path d="M45.8 61.4H33.6L42 47.4L51.1 63.8H58.8A9 9 0 0 0 58.8 45.8H49.9" fill="none" stroke="#000" stroke-width="4.6"/><g fill="#7357FF"><circle cx="40.7" cy="73" r="3.3"/><circle cx="49.9" cy="73" r="3.3"/><circle cx="59" cy="73" r="3.3"/></g></svg>';

  /* the other Add Dots apps, as on www.adddots.com; `site` is the name the
     Windows app opens in the browser (src-tauri open_site) */
  /* the Option Builder mark: an "A" with rising candles and a violet trend
     arrow, as in that app's public/favicon.svg */
  const LOGO_OB = '<svg viewBox="162 157 928 935" aria-hidden="true"><rect x="162" y="157" width="928" height="935" rx="220" fill="#000"/><g fill="#fff"><path d="M578,322 C600,285 658,285 680,322 L790,527 L706,612 L626,472 L520,655 C440,738 360,805 286,866 C276,873 266,866 272,856 Z"/><path d="M276,903 L382,816 L382,918 C382,926 376,932 368,932 L286,932 C266,932 262,914 276,903 Z"/><rect x="410" y="793" width="55" height="140" rx="9"/><rect x="573" y="679" width="55" height="156" rx="9"/><path d="M828,606 L982,888 C996,912 984,932 958,932 L842,932 C822,932 808,924 800,910 L724,768 C712,744 716,722 732,704 Z"/></g><g fill="#7B61FF" stroke="#000" stroke-width="14" stroke-linejoin="round" paint-order="stroke"><rect x="488" y="739" width="63" height="138" rx="9" stroke="none"/><path d="M482,710 L604,584 C610,578 618,578 624,584 L692,648 L832,516 L852,540 L702,704 C694,712 684,712 678,704 L606,622 Z"/><path d="M806,488 L900,458 C910,455 916,462 913,472 L894,560 C891,570 882,572 876,566 Z"/></g></svg>';
  /* the Add Call mark: an "A" whose crossbar is a violet "+", on its app-icon
     tile (that app's branding/logo.ts, icon variant) */
  const LOGO_AC = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="13" fill="#0A0A0A"/><g transform="translate(32 32) scale(.82) translate(-32 -32)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 45L32 15.5L44.5 45" stroke="#fff" stroke-width="6.5"/><path d="M32 30.5V41.5M26.5 36H37.5" stroke="#7B61FF" stroke-width="4.5"/></g></svg>';
  const APPS = [
    { name: 'PDF Reader + Editor', sub: 'This app', here: true, logo: LOGO },
    { name: 'Option Builder', sub: 'Web app', url: 'https://opbuilder.adddots.com/', site: 'opbuilder', logo: LOGO_OB },
    { name: 'Add Call', sub: 'Web app', url: 'https://call.adddots.com/', site: 'call', logo: LOGO_AC }
  ];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return X.esc ? X.esc(s) : String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } }

  /* ---------------- the document in view ---------------- */

  /* the window whose document is in view: this one, or a tab's frame */
  function docWin() {
    try {
      const a = X.tabs && X.tabs.list ? X.tabs.list().filter(function (t) { return t.active; })[0] : null;
      if (a && a.id) {
        const f = X.tabs.frame(a.id);
        if (f && f.contentWindow && f.contentWindow.ADDPDF) return f.contentWindow;
      }
    } catch (e) { /* the frame is still loading */ }
    return window;
  }
  function docBtn(id) { return docWin().document.getElementById(id); }
  /* press a button of the document in view, as if it had been clicked there */
  function press(id) {
    const b = docBtn(id);
    if (b && !b.disabled) b.click();
  }
  function hasDoc() {
    const A = docWin().ADDPDF;
    return !!(A && A.hasDoc && A.hasDoc());
  }
  function allWins() {
    const out = [window];
    if (X.tabs && X.tabs.list) X.tabs.list().forEach(function (t) {
      const f = t.id && X.tabs.frame(t.id);
      if (f && f.contentWindow && f.contentWindow.document) out.push(f.contentWindow);
    });
    return out;
  }

  /* ---------------- links out ---------------- */

  function openLink(url, site) {
    if (T && X.openSite && site) {
      X.openSite(site).catch(function () { if (X.toast) X.toast('Could not open ' + url); });
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  /* ---------------- the strip ---------------- */

  /* a labelled region, not a <header>: the toolbar below is the page's banner */
  const bar = el('div', 'appbar');
  bar.id = 'appBar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'App menu');
  bar.innerHTML =
    '<span class="ablogo" title="Add Dots PDF">' + LOGO + '</span>' +
    '<button type="button" class="abbtn abmenu-t" id="abMenu" aria-haspopup="menu" aria-expanded="false" title="Menu">' + ICON.menu + '<span>Menu</span></button>' +
    '<button type="button" class="abbtn abicon abhome" id="abHome" title="Home (H)" aria-label="Home">' + ICON.home + '</button>' +
    '<button type="button" class="abbtn abcreate" id="abCreate" aria-haspopup="menu" aria-expanded="false" title="Create">' + ICON.plus + '<span>Create</span></button>' +
    '<span class="abgrow"></span>' +
    '<label class="abfind" title="Find text, tools, or help">' +
      '<input id="abFind" type="text" placeholder="Find text, tools, or help" aria-label="Find text, tools, or help" autocomplete="off" spellcheck="false">' +
      ic('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>') +
    '</label>' +
    '<button type="button" class="abbtn abicon" id="abHelp" aria-haspopup="menu" aria-expanded="false" title="Help" aria-label="Help">' + ICON.help + '</button>' +
    '<button type="button" class="abbtn abicon" id="abNews" aria-haspopup="dialog" aria-expanded="false" title="What is new" aria-label="What is new">' + ICON.bell + '<i class="abdot" hidden></i></button>' +
    '<button type="button" class="abbtn abicon" id="abApps" aria-haspopup="dialog" aria-expanded="false" title="Other Add Dots apps" aria-label="Other Add Dots apps">' + ICON.apps + '</button>';
  if (win) {
    bar.insertAdjacentHTML('beforeend',
      '<span class="abwin">' +
        '<button type="button" class="abw" id="abMin" title="Minimise" aria-label="Minimise">' + ICON.wmin + '</button>' +
        '<button type="button" class="abw" id="abMax" title="Maximise" aria-label="Maximise">' + ICON.wmax + '</button>' +
        '<button type="button" class="abw abwx" id="abClose" title="Close" aria-label="Close">' + ICON.wclose + '</button>' +
      '</span>');
    /* the window is dragged by the strip, and a double click maximises it */
    bar.setAttribute('data-tauri-drag-region', '');
    bar.querySelector('.abgrow').setAttribute('data-tauri-drag-region', '');
    bar.querySelector('.ablogo').setAttribute('data-tauri-drag-region', '');
    document.body.classList.add('appbar-win');
  }
  document.body.insertBefore(bar, document.body.firstChild);
  document.body.classList.add('has-appbar');

  const $b = function (id) { return document.getElementById(id); };

  /* ---------------- drop-down menus ---------------- */

  let openMenu = null;   /* { pop, btn } */

  function closeMenu() {
    if (!openMenu) return;
    openMenu.pop.remove();
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu.btn.classList.remove('on');
    openMenu = null;
  }

  /* items: { label, icon, key, act, off } or '-' for a line */
  function menu(btn, items, opts) {
    const was = openMenu && openMenu.btn === btn;
    closeMenu();
    if (was) return;
    opts = opts || {};
    const pop = el('div', 'abpop' + (opts.cls ? ' ' + opts.cls : ''));
    if (opts.html) {
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', btn.getAttribute('aria-label') || btn.title);
      pop.innerHTML = opts.html;
    } else {
      pop.setAttribute('role', 'menu');
      items.forEach(function (it) {
        if (it === '-') { pop.appendChild(el('div', 'absep')); return; }
        if (it.group) { pop.appendChild(el('div', 'abgroup', esc(it.group))); return; }
        const b = el('button', 'abitem',
          (it.icon || '<span class="abnoic"></span>') + '<span class="ablbl">' + esc(it.label) + '</span>' +
          (it.key ? '<kbd>' + esc(it.key) + '</kbd>' : ''));
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        if (it.off) b.disabled = true;
        b.addEventListener('click', function () { closeMenu(); it.act(); });
        pop.appendChild(b);
      });
    }
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    let left = opts.right ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    pop.style.left = left + 'px';
    pop.style.top = (r.bottom + 4) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('on');
    openMenu = { pop: pop, btn: btn };
    if (opts.onOpen) opts.onOpen(pop);
    const first = pop.querySelector('.abitem:not(:disabled), a, button');
    if (first && opts.focus !== false) first.focus({ preventScroll: true });
  }

  document.addEventListener('mousedown', function (e) {
    if (openMenu && !openMenu.pop.contains(e.target) && !openMenu.btn.contains(e.target)) closeMenu();
  }, true);
  /* a click in a tab's frame never reaches this page; the window losing focus to it does */
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('keydown', function (e) {
    if (!openMenu) return;
    if (e.key === 'Escape') { const b = openMenu.btn; closeMenu(); b.focus(); e.preventDefault(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [].slice.call(openMenu.pop.querySelectorAll('.abitem:not(:disabled), .abapp'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items[n].focus();
    e.preventDefault();
  });

  /* ---------------- Menu ---------------- */

  function isDark() { return document.body.dataset.ui === 'dark'; }
  /* every window of this one together: the strip, the app and each tab */
  function toggleUi() {
    const to = isDark() ? 'light' : 'dark';
    allWins().forEach(function (w) {
      try {
        if (w.document.body.dataset.ui === to) return;
        const b = w.document.getElementById('btnUi');
        if (b) b.click(); else w.document.body.dataset.ui = to;
      } catch (e) { /* a frame still loading reads the setting when it starts */ }
    });
  }

  $b('abMenu').addEventListener('click', function () {
    const doc = hasDoc();
    const items = [
      { label: 'Open…', icon: ICON.open, key: 'Ctrl+O', act: function () { press('fileIn'); } },
      { label: 'Save', icon: ICON.save, key: 'Ctrl+S', off: !doc, act: function () { press('btnQSave'); } },
      { label: 'Save as…', icon: ICON.saveas, off: !doc, act: function () { press('btnSaveAs'); } },
      { label: 'Print…', icon: ICON.print, key: 'Ctrl+P', off: !doc, act: function () { press('btnQPrint'); } },
      '-',
      { label: isDark() ? 'Light interface' : 'Dark interface', icon: ICON.ui, act: toggleUi }
    ];
    if (win) items.push('-', { label: 'Exit', icon: ICON.close, act: function () { win.close(); } });
    menu(this, items);
  });

  /* ---------------- Home ---------------- */

  $b('abHome').addEventListener('click', function () {
    /* with documents in tabs, Home is the app's own, with no tab in view, as in Acrobat */
    if (X.tabs && X.tabs.home && X.tabs.list().length) { X.tabs.home(); paintHome(); return; }
    const A = docWin().ADDPDF;
    if (A && A.homeShown && A.homeShown()) return;
    press('btnHome');
  });
  function paintHome() {
    const A = docWin().ADDPDF;
    $b('abHome').classList.toggle('here', !!(A && A.homeShown && A.homeShown()));
  }

  /* ---------------- Create ---------------- */

  $b('abCreate').addEventListener('click', function () {
    menu(this, [
      { label: 'New blank PDF…', icon: ICON.blank, act: function () {
        /* after this click, or the page's click-outside closes it at once */
        if (X.openNewPdfDialog) setTimeout(function () { X.openNewPdfDialog($b('abCreate')); }, 0);
      } },
      { label: 'Combine files', icon: ICON.combine, act: function () {
        const c = docWin().document.querySelector('#toolGrid .tcard[data-tool="merge"]');
        if (c) c.click();
      } },
      { label: 'Open files', icon: ICON.open, key: 'Ctrl+O', act: function () { press('fileIn'); } }
    ]);
  });

  /* ---------------- Help ---------------- */

  function helpItems() {
    return [
      { label: 'What is new', icon: ICON.news, act: function () { $b('abNews').click(); } },
      '-',
      { label: 'About Add Dots', icon: ICON.link, act: function () { openLink('https://www.adddots.com/about.html', 'about'); } },
      { label: 'Privacy', icon: ICON.shield, act: function () { openLink('https://pdf.adddots.com/privacy.html', 'privacy'); } }
    ];
  }
  $b('abHelp').addEventListener('click', function () { menu(this, helpItems(), { right: true }); });

  /* ---------------- Find text, tools, or help ---------------- */

  const findBox = $b('abFind');

  /* every button of the panels, by what it says, once each */
  function toolsLike(q) {
    const d = docWin().document, seen = {}, out = [];
    Array.prototype.forEach.call(d.querySelectorAll('.rpan button[id]'), function (b) {
      const lbl = b.querySelector('.lbl');
      const label = (b.dataset.label || (lbl && lbl.textContent) || b.getAttribute('aria-label') || '').trim();
      if (!label || seen[label] || b.disabled || b.hidden) return;
      if ((label + ' ' + (b.title || '')).toLowerCase().indexOf(q) < 0) return;
      seen[label] = 1;
      const svg = b.querySelector('svg');
      out.push({ label: label, icon: svg ? svg.outerHTML : null, act: function () {
        const A = docWin().ADDPDF;
        if (A && A.showBtn) A.showBtn(b);
        b.click();
      } });
    });
    return out.slice(0, 6);
  }

  /* the Find panel, opened on these words */
  function findInDoc(q) {
    const w = docWin(), A = w.ADDPDF;
    if (!A || !hasDoc()) { if (X.toast) X.toast('Open a PDF first'); return; }
    A.setRail(true);
    press('tabFind');
    const box = docBtn('findIn');
    box.value = q;
    box.dispatchEvent(new w.Event('input', { bubbles: true }));
    box.focus();
  }

  function paintFind() {
    const raw = findBox.value.trim(), q = raw.toLowerCase();
    closeMenu();
    if (!q) return;
    const tools = toolsLike(q);
    const help = helpItems().filter(function (it) { return it !== '-' && it.label.toLowerCase().indexOf(q) >= 0; });
    const items = [{ group: 'In this document' },
      { label: 'Find “' + raw + '”', icon: ic('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
        act: function () { findBox.value = ''; findInDoc(raw); } }];
    if (tools.length) items.push({ group: 'Tools' });
    tools.forEach(function (t) { items.push(t); });
    if (help.length) items.push({ group: 'Help' });
    help.forEach(function (h) { items.push(h); });
    menu(findBox, items, { cls: 'abfindpop', focus: false });
  }
  findBox.addEventListener('input', paintFind);
  findBox.addEventListener('focus', paintFind);
  findBox.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = findBox.value.trim();
      if (raw) { closeMenu(); findBox.value = ''; findInDoc(raw); }
    } else if (e.key === 'Escape') {
      findBox.value = ''; closeMenu(); findBox.blur();
    }
  });

  /* ---------------- What is new ---------------- */

  /* the version in use: in the Windows app the Store's number (1.0.N) or
     the setup's (src-tauri app_version); on the website, the build */
  let ver = null;
  function version() {
    if (!ver) {
      ver = T && T.core
        ? T.core.invoke('app_version').then(function (v) { return 'Version ' + v; }, function () { return 'Windows app'; })
        : Promise.resolve('Web version · always the newest when the page loads');
    }
    return ver;
  }

  const notesOf = function (B) { return B && B.notes && B.notes.length ? B.notes : null; };
  /* the dot: notes this build has that have not been read */
  X.on('ready', function () {
    const B = build();
    if (notesOf(B) && get(NEWS) !== B.id) bar.querySelector('.abdot').hidden = false;
  });

  $b('abNews').addEventListener('click', function () {
    const BUILD = build(), notes = notesOf(BUILD);
    let when = '';
    if (BUILD && BUILD.time) {
      const d = new Date(BUILD.time);
      if (!isNaN(d)) when = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    }
    const html = '<div class="abhead">What is new' + (when ? '<small>' + esc(when) + '</small>' : '') + '</div>' +
      /* as a browser's About page has it: up to date, or a new update, and
         the version under it (js/update.js asks the Store or the website) */
      '<div class="abver" id="abVerBox" data-state="checking"><span class="abvico" aria-hidden="true"></span>' +
      '<div class="abvtxt"><b id="abVerState">Checking for updates…</b><small id="abVer">Version …</small></div>' +
      '<button type="button" class="btn primary" id="abVerGo" hidden>Update</button></div>' +
      (notes ? '<ul class="abnews">' + notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '');
    menu(this, null, { html: html, right: true, cls: 'abwide', focus: false });
    version().then(function (v) {
      const b = document.getElementById('abVer');
      if (b) b.textContent = v;
    });
    const check = X.checkForUpdate ? X.checkForUpdate() : Promise.resolve({ state: 'unknown' });
    check.catch(function () { return { state: 'unknown' }; }).then(function (u) {
      const box = document.getElementById('abVerBox');
      if (!box) return;
      box.dataset.state = u.state;
      document.getElementById('abVerState').textContent =
        u.state === 'update' ? 'New update available' :
        u.state === 'latest' ? 'Add Dots PDF is up to date' : 'Could not check for updates';
      const go = document.getElementById('abVerGo');
      go.hidden = u.state !== 'update';
      if (u.run) go.onclick = function () { closeMenu(); u.run(); };
    });
    if (notes) { set(NEWS, BUILD.id); bar.querySelector('.abdot').hidden = true; }
  });

  /* ---------------- other Add Dots apps ---------------- */

  $b('abApps').addEventListener('click', function () {
    const html = '<div class="abhead">Other Add Dots apps</div>' +
      APPS.map(function (a, i) {
        return '<div class="abapprow">' +
          '<span class="abappic ablogo">' + a.logo + '</span>' +
          '<span class="abappn"><b>' + esc(a.name) + '</b><small>' + esc(a.sub) + '</small></span>' +
          (a.here ? '<span class="abhere">In use</span>' :
            '<button type="button" class="abapp" data-i="' + i + '">Open</button>') + '</div>';
      }).join('');
    menu(this, null, {
      html: html, right: true, cls: 'abwide',
      onOpen: function (pop) {
        pop.addEventListener('click', function (e) {
          const b = e.target.closest('.abapp'); if (!b) return;
          const a = APPS[+b.dataset.i];
          closeMenu();
          openLink(a.url, a.site);
        });
      }
    });
  });

  /* ---------------- the window (Windows app) ---------------- */

  if (win) {
    $b('abMin').addEventListener('click', function () { win.minimize(); });
    $b('abMax').addEventListener('click', function () { win.toggleMaximize(); });
    $b('abClose').addEventListener('click', function () { win.close(); });
    const paintMax = function () {
      win.isMaximized().then(function (m) {
        const b = $b('abMax');
        b.innerHTML = m ? ICON.wrestore : ICON.wmax;
        b.title = m ? 'Restore down' : 'Maximise';
        b.setAttribute('aria-label', b.title);
        document.body.classList.toggle('win-max', m);
      }, function () {});
    };
    paintMax();
    if (win.onResized) win.onResized(paintMax);
    window.addEventListener('focus', function () { document.body.classList.remove('win-blur'); });
    window.addEventListener('blur', function () {
      /* focus gone to a tab's frame is still this window */
      setTimeout(function () {
        if (!document.hasFocus() && !(document.activeElement && document.activeElement.tagName === 'IFRAME')) {
          document.body.classList.add('win-blur');
        }
      }, 0);
    });
  }

  /* the strip follows the document in view */
  setInterval(paintHome, 600);
  X.on('ready', paintHome);
})();
