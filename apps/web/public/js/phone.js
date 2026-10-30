/* The phone app's own screens (apps/mobile, Android first).

   On by body[data-phone] (set in index.html's first script: the Capacitor
   app, or ?phone=1 to try it in a browser) and, in css/phone.css, only at
   phone width, so a tablet keeps the full layout. Nothing here is a second
   copy of a feature: every screen drives the app's own buttons and
   functions (EXT), so what a tool does stays in one place.

   - Home: a shell of four tabs (Home, Files, Search, Tools) and Settings,
     inside the home screen (#openPanel), which still decides when it shows.
   - Merge: the files to join, in order, before they are opened as one.
   - The document: its name in the top bar, a page counter at the side, and
     the More button opens the document menu (tools, pages, export, save).
   - Site photos: Add photos asks how (camera, gallery, files). */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X || document.body.dataset.phone !== '1') return;
  const $ = function (id) { return document.getElementById(id); };
  const esc = X.esc || function (t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------------- icons (24-unit stroke paths) ---------------- */
  const P = {
    home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5',
    tools: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.9 4.9L7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
    plus: 'M12 5v14M5 12h14',
    chev: 'M9 6l6 6-6 6',
    back: 'M15 5l-7 7 7 7',
    close: 'M6 6l12 12M18 6L6 18',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
    image: 'M3 5h18v14H3zM8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 16l-5-5-8 8',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    newpdf: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
    text: 'M4 6V4h12v2M10 4v14M7 18h6M15 13l5 5M20 13l-5 5',
    mark: 'M4 20h8M6 16l9.5-9.5 3 3L9 19H6zM13.5 8.5l3 3',
    pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    sign: 'M3 17c3-6 5-9 6-8s-2 7 0 7 3-5 5-5 1 4 3 4 2-2 4-2M3 21h18',
    merge: 'M4 4h7v9H4zM13 11h7v9h-7zM11 8h4v3M13 16H9v-3',
    organize: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15 16.5h4M17 14.5v4',
    extract: 'M6 3h8l4 4v14H6zM14 3v4h4M9 14h6',
    jpg: 'M3 5h18v14H3zM8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 16l-5-5-8 8',
    crop: 'M6 2v16h16M2 6h16v16',
    translate: 'M4 5h8M8 3v2M6 5c0 4 2 7 5 8M10 5c0 4-3 7-6 8M13 21l4-10 4 10M14.5 17h5',
    eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    pages: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    comment: 'M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5',
    ruler: 'M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4',
    read: 'M3 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3zM21 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z',
    measure: 'M4 20L20 4M7 17l2 2M10 14l2 2M13 11l2 2M16 8l2 2',
    ocr: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 15l3-7 3 7M10.2 12.5h3.6',
    add: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
    rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    copy: 'M8 8h11v13H8zM5 16V3h11',
    rotl: 'M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7',
    compress: 'M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M4 12h16',
    export: 'M6 3h8l4 4v6M14 3v4h4M6 3v18h7M15 18h6M18 15l3 3-3 3',
    save: 'M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2zM8 3v5h7V3M7 21v-8h10v8',
    share: 'M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v8h14v-8',
    print: 'M7 9V3h10v6M7 17H4v-8h16v8h-3M7 14h10v7H7z',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    stamp: 'M9 4h6v6l3 3v3H6v-3l3-3zM5 20h14',
    note: 'M4 4h16v12l-4 4H4zM16 20v-4h4',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    word: 'M6 3h8l4 4v14H6zM14 3v4h4M8.5 11l1.5 6 2-4.5 2 4.5 1.5-6',
    sheet: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
    slides: 'M3 5h18v11H3zM12 16v4M8 20h8',
    txt: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 15h6M9 18h4',
    cad: 'M4 20L12 4l8 16zM8 13h8',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    snap: 'M6 6h12v12H6zM4 4h4v4H4zM16 16h4v4h-4z'
  };
  function ic(name, size) {
    const s = size || 22;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      P[name] + '"></path></svg>';
  }
  const LOGO = '<svg class="ph-logo" width="36" height="36" viewBox="0 0 100 100" role="img" aria-label="Add Dots PDF">' +
    '<rect width="100" height="100" rx="20" fill="#000"></rect>' +
    '<path d="M33 18.5H54V31a7 7 0 0 0 7 7H74.5V75a7.5 7.5 0 0 1-7.5 7.5H33a7.5 7.5 0 0 1-7.5-7.5V26a7.5 7.5 0 0 1 7.5-7.5z" fill="#fff"></path>' +
    '<path d="M57.8 19.2L74 35.4H62a4.2 4.2 0 0 1-4.2-4.2z" fill="#7357FF"></path>' +
    '<path d="M36.3 58.8L41.7 52.2L43.9 58.8z" fill="#7357FF"></path>' +
    '<path d="M45.8 61.4H33.6L42 47.4L51.1 63.8H58.8A9 9 0 0 0 58.8 45.8H49.9" fill="none" stroke="#000" stroke-width="4.6"></path>' +
    '<g fill="#7357FF"><circle cx="40.7" cy="73" r="3.3"></circle><circle cx="49.9" cy="73" r="3.3"></circle>' +
    '<circle cx="59" cy="73" r="3.3"></circle></g></svg>';

  function click(id) {
    const b = $(id);
    if (!b) return false;
    b.click();
    return true;
  }
  function sizeLabel(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function whenLabel(t) {
    const d = new Date(t), now = new Date(), day = 86400000;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (t >= start) return 'Today, ' + hm;
    if (t >= start - day) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  /* ---------------- the tools, as the home screen lists them ---------------- */
  const TOOLS = [
    { t: 'text', short: 'Edit text', name: 'Edit text', desc: 'Retype a line of the PDF or add new text', ico: 'text', hue: 'v' },
    { t: 'mark', name: 'Comment & mark up', desc: 'Highlight, pen, boxes, arrows, notes', ico: 'mark', hue: 'v' },
    { t: 'pin', short: 'PIN photos', name: 'PIN site photos', desc: 'Numbered pins with photos on drawings', ico: 'pin', hue: 'r' },
    { t: 'sign', short: 'Sign', name: 'Fill & sign', desc: 'Fill form fields and add your signature', ico: 'sign', hue: 'v' },
    { t: 'merge', short: 'Merge', name: 'Merge PDFs', desc: 'Combine several files into one, in order', ico: 'merge' },
    { t: 'organize', name: 'Organise pages', desc: 'Reorder, rotate, insert or remove pages', ico: 'organize' },
    { t: 'extract', name: 'Extract & split', desc: 'Pull out pages as one PDF or many', ico: 'extract' },
    { t: 'jpg', name: 'PDF to JPG', desc: 'Save each page as a picture', ico: 'jpg' },
    { t: 'crop', name: 'Crop pages', desc: 'Trim margins on one page or all', ico: 'crop' },
    { t: 'translate', name: 'Translate', desc: 'Read the PDF in another language', ico: 'translate' }
  ];
  const QUICK = ['text', 'pin', 'sign', 'merge'];
  function toolOf(t) { return TOOLS.filter(function (x) { return x.t === t; })[0]; }

  function useTool(t) {
    if (t === 'merge') { openMerge(); return; }
    if (X.hasDoc()) {
      /* a document is open: the tool works on it, as the home screen's cards do */
      X.hideHome();
      setTimeout(function () { X.runTool(t); }, 0);
      return;
    }
    X.pickFile(t);
  }
  function pick() { click('pickBtn') || click('fileIn'); }

  /* ---------------- the home shell ---------------- */
  const ph = document.createElement('div');
  ph.id = 'ph';
  ph.className = 'ph';
  ph.dataset.view = 'home';

  function navBtn(view, name, ico) {
    return '<button type="button" class="ph-tab" data-go="' + view + '">' +
      '<span class="pill">' + ic(ico) + '</span>' + name + '</button>';
  }
  function row(attrs, icoName, title, sub, end, tone) {
    return '<button type="button" class="ph-row" ' + attrs + '>' +
      '<span class="ph-ico' + (tone ? ' ' + tone : '') + '">' + ic(icoName) + '</span>' +
      '<span class="ph-txt"><b>' + title + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      (end === false ? '' : '<span class="ph-end">' + ic(end || 'chev', 20) + '</span>') + '</button>';
  }

  ph.innerHTML =
    /* Home */
    '<section class="ph-view" data-v="home" aria-label="Home">' +
      '<header class="ph-head"><div class="ph-brand">' + LOGO +
        '<span class="ph-word">Add Dots <em>PDF</em></span></div>' +
        '<button type="button" class="ph-round" data-go="settings" aria-label="Settings">' + ic('gear') + '</button></header>' +
      '<h1 class="ph-h1">Read, edit and mark up any PDF</h1>' +
      '<button type="button" class="ph-resume" id="phResume" hidden>' +
        '<span class="ph-ico v">' + ic('file') + '</span>' +
        '<span class="ph-txt"><small>Back to</small><b id="phResumeName"></b></span>' + ic('chev', 20) + '</button>' +
      '<button type="button" class="ph-open" id="phOpen">' + ic('newpdf', 30) +
        '<b>Open a PDF</b><small>From phone storage, Downloads or WhatsApp</small></button>' +
      '<div class="ph-slot" id="phHomeSlot"></div>' +
      '<div class="ph-sechead"><h2>Quick tools</h2><button type="button" class="ph-link" data-go="tools">All tools</button></div>' +
      '<div class="ph-quick" id="phQuick"></div>' +
      '<div class="ph-sechead"><h2>Recent files</h2><button type="button" class="ph-link" data-go="files">See all</button></div>' +
      '<div class="ph-list" id="phRecentHome"></div>' +
    '</section>' +
    /* Files */
    '<section class="ph-view" data-v="files" aria-label="Files">' +
      '<header class="ph-head"><h1 class="ph-title">File locations</h1></header>' +
      '<div class="ph-sechead"><h2>Recent files</h2></div>' +
      '<div class="ph-cards" id="phCards"></div>' +
      '<div class="ph-group">' +
        row('id="phPhone"', 'folder', 'Phone storage', 'PDFs in Downloads, Documents or any folder', null, 'v') +
        row('id="phPhotos"', 'image', 'Photos &amp; images', 'A picture opens as a page of a new PDF') +
      '</div>' +
      '<p class="ph-note">A PDF opened from WhatsApp, Gmail or Files opens here too, and joins Recent files.</p>' +
    '</section>' +
    /* Search */
    '<section class="ph-view" data-v="search" aria-label="Search">' +
      '<header class="ph-head"><h1 class="ph-title">Search</h1></header>' +
      '<label class="ph-search">' + ic('search') +
        '<input id="phQ" type="search" placeholder="Search recent files and tools" aria-label="Search recent files and tools" enterkeyhint="search"></label>' +
      '<div class="ph-list" id="phHits"></div>' +
    '</section>' +
    /* Tools */
    '<section class="ph-view" data-v="tools" aria-label="Tools">' +
      '<header class="ph-head"><div><h1 class="ph-title">Tools</h1><p class="ph-sub">Pick a tool, then choose a PDF</p></div></header>' +
      '<div class="ph-list" id="phTools"></div>' +
    '</section>' +
    /* Settings */
    '<section class="ph-view" data-v="settings" aria-label="Settings">' +
      '<header class="ph-head ph-bar"><button type="button" class="ph-icon" data-go="home" aria-label="Back">' + ic('back', 24) + '</button>' +
        '<h1 class="ph-title sm">Settings</h1></header>' +
      '<h2 class="ph-cap">Appearance</h2>' +
      '<div class="ph-card"><span class="ph-lbl">Interface</span>' +
        '<div class="ph-seg" role="radiogroup" aria-label="Interface">' +
          '<button type="button" role="radio" data-ui="light">Light</button>' +
          '<button type="button" role="radio" data-ui="dark">Dark</button></div></div>' +
      '<h2 class="ph-cap">Site photos</h2>' +
      '<div class="ph-card ph-sw">' +
        '<label><span>Stamp the date on photos</span><input type="checkbox" role="switch" data-stamp="camStDate"></label>' +
        '<label><span>Stamp the time on photos</span><input type="checkbox" role="switch" data-stamp="camStTime"></label>' +
        '<label><span>Stamp the pin number on photos</span><input type="checkbox" role="switch" data-stamp="camStPin"></label>' +
      '</div>' +
      '<h2 class="ph-cap">About</h2>' +
      '<div class="ph-card ph-about">' +
        '<button type="button" id="phNews"><span>What’s new</span>' + ic('chev', 18) + '</button>' +
        '<a href="privacy.html" target="_blank" rel="noopener"><span>Privacy policy</span>' + ic('chev', 18) + '</a>' +
        '<button type="button" id="phDiag"><span>Copy diagnostics</span>' + ic('chev', 18) + '</button>' +
        '<div><span>Version</span><span class="ph-dim" id="phVer"></span></div>' +
      '</div>' +
      '<p class="ph-note">Private by design: your files are opened and edited on this phone. Nothing is uploaded.</p>' +
    '</section>' +
    '<button type="button" class="ph-fab" id="phFab" aria-label="Open a PDF">' + ic('plus', 26) + '</button>' +
    '<nav class="ph-nav" aria-label="Main">' +
      navBtn('home', 'Home', 'home') + navBtn('files', 'Files', 'file') +
      navBtn('search', 'Search', 'search') + navBtn('tools', 'Tools', 'tools') +
    '</nav>';

  const panel = $('openPanel');
  panel.appendChild(ph);
  /* What the home screen reports — a password to type, an error, work to
     recover — moves in with it; the app still finds them by id. */
  ['pwRow', 'errMsg', 'hRecover'].forEach(function (id) { if ($(id)) $('phHomeSlot').appendChild($(id)); });

  function go(view) {
    ph.dataset.view = view;
    Array.prototype.forEach.call(ph.querySelectorAll('.ph-tab'), function (b) {
      const on = b.dataset.go === view;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const v = ph.querySelector('.ph-view[data-v="' + view + '"]');
    if (v) v.scrollTop = 0;
    if (view === 'search') setTimeout(function () { $('phQ').focus(); }, 50);
    if (view === 'settings') syncSettings();
  }
  ph.addEventListener('click', function (e) {
    const g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); return; }
    const tl = e.target.closest('[data-tool]');
    if (tl) { useTool(tl.dataset.tool); return; }
    const x = e.target.closest('[data-forget]');
    if (x) { e.stopPropagation(); X.forgetRecent(+x.dataset.forget); return; }
    const r = e.target.closest('[data-recent]');
    if (r) { X.openRecent(+r.dataset.recent); }
  });
  $('phOpen').addEventListener('click', pick);
  $('phFab').addEventListener('click', pick);
  $('phPhone').addEventListener('click', pick);
  $('phResume').addEventListener('click', function () { X.hideHome(); });

  /* a picture becomes a page of a new PDF, as with the picker */
  const imgIn = document.createElement('input');
  imgIn.type = 'file'; imgIn.accept = 'image/*'; imgIn.multiple = true; imgIn.hidden = true;
  document.body.appendChild(imgIn);
  $('phPhotos').addEventListener('click', function () {
    if (X.hasDoc() && !X.okToReplace()) return;
    imgIn.click();
  });
  imgIn.addEventListener('change', function () {
    const files = Array.prototype.slice.call(imgIn.files || []);
    imgIn.value = '';
    if (files.length) X.openFiles(files);
  });

  /* tools: the quick four on Home, all of them on Tools */
  $('phQuick').innerHTML = QUICK.map(function (t) {
    const x = toolOf(t);
    return '<button type="button" class="ph-qt" data-tool="' + t + '"><span class="ph-ico ' + (x.hue || '') + '">' +
      ic(x.ico, 26) + '</span>' + esc(x.short) + '</button>';
  }).join('');
  $('phTools').innerHTML = TOOLS.map(function (x) {
    return row('data-tool="' + x.t + '"', x.ico, esc(x.name), esc(x.desc), null, x.hue);
  }).join('');

  /* recent files, from the app's own list (IndexedDB) */
  function recentRow(r, i) {
    const bits = [sizeLabel(r.size)];
    if (r.pages) bits.push(r.pages + (r.pages === 1 ? ' page' : ' pages'));
    if (!r.blob) bits.push('select again to open');
    return '<div class="ph-file">' +
      '<button type="button" class="ph-filego" data-recent="' + i + '">' +
        '<span class="ph-doc" aria-hidden="true"></span>' +
        '<span class="ph-txt"><b>' + esc(r.name) + '</b><small>' + esc(whenLabel(r.time) + ' · ' + bits.join(' · ')) + '</small></span>' +
      '</button>' +
      '<button type="button" class="ph-x" data-forget="' + i + '" aria-label="Remove ' + esc(r.name) + ' from the list">' + ic('close', 18) + '</button>' +
    '</div>';
  }
  const EMPTY = '<p class="ph-empty">Files you open appear here, so you can pick up where you left off.</p>';
  function renderRecent(all) {
    all = all || X.recent();
    $('phRecentHome').innerHTML = all.length ? all.slice(0, 4).map(recentRow).join('') : EMPTY;
    $('phCards').innerHTML = all.length ? all.map(function (r, i) {
      return '<button type="button" class="ph-card-file" data-recent="' + i + '">' +
        '<span class="ph-thumb" aria-hidden="true"><span class="pg"><i></i><i></i><i></i><i class="box"></i><i></i></span></span>' +
        '<b>' + esc(r.name.replace(/\.pdf$/i, '')) + '</b><small>' + esc('PDF · ' + sizeLabel(r.size)) + '</small></button>';
    }).join('') : EMPTY;
    if (ph.dataset.view === 'search') search();
  }
  X.on('recent', renderRecent);
  renderRecent();

  function search() {
    const q = $('phQ').value.trim().toLowerCase();
    const out = $('phHits');
    if (!q) { out.innerHTML = '<p class="ph-empty">Type part of a file name or a tool.</p>'; return; }
    const files = X.recent().map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return x.r.name.toLowerCase().indexOf(q) >= 0; });
    const tools = TOOLS.filter(function (x) { return (x.name + ' ' + x.desc).toLowerCase().indexOf(q) >= 0; });
    let html = '';
    if (files.length) html += '<h2 class="ph-cap">Files</h2>' + files.map(function (x) { return recentRow(x.r, x.i); }).join('');
    if (tools.length) {
      html += '<h2 class="ph-cap">Tools</h2>' + tools.map(function (x) {
        return row('data-tool="' + x.t + '"', x.ico, esc(x.name), esc(x.desc), null, x.hue);
      }).join('');
    }
    out.innerHTML = html || '<p class="ph-empty">Nothing matches “' + esc(q) + '”.</p>';
  }
  $('phQ').addEventListener('input', search);
  search();

  /* settings: each choice is the app's own control, clicked */
  function syncSettings() {
    const ui = document.body.dataset.ui;
    Array.prototype.forEach.call(ph.querySelectorAll('[data-ui]'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.ui === ui));
    });
    Array.prototype.forEach.call(ph.querySelectorAll('[data-stamp]'), function (c) {
      const chip = $(c.dataset.stamp);
      c.checked = !!(chip && chip.classList.contains('on'));
    });
    const B = window.ADDDOTS_BUILD;
    $('phVer').textContent = B && B.id ? B.id + (B.time ? ' · ' + new Date(B.time).toLocaleDateString() : '') : 'Development build';
  }
  ph.querySelector('.ph-seg').addEventListener('click', function (e) {
    const b = e.target.closest('[data-ui]');
    if (b && document.body.dataset.ui !== b.dataset.ui) click('btnUi');
    syncSettings();
  });
  Array.prototype.forEach.call(ph.querySelectorAll('[data-stamp]'), function (c) {
    c.addEventListener('change', function () {
      const chip = $(c.dataset.stamp);
      if (chip && chip.classList.contains('on') !== c.checked) chip.click();
      syncSettings();
    });
  });
  $('phNews').addEventListener('click', function () { click('abNews'); });
  $('phDiag').addEventListener('click', function () { click('diagCopy'); });

  /* The home screen opening is the shell opening: on Home, with the
     document it would go back to. */
  function homeOpened() {
    if (panel.hidden) { syncPage(); return; }
    go('home');
    $('phResume').hidden = !X.hasDoc();
    if (X.hasDoc()) $('phResumeName').textContent = X.docName();
    sheetClose();
    syncPage();
  }

  /* ---------------- bottom sheets ---------------- */
  const scrim = document.createElement('div');
  scrim.className = 'ph-scrim';
  const sheet = document.createElement('section');
  sheet.className = 'ph-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.hidden = true;
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  let sheetActs = [], sheetBack = null;

  function sheetOpen(label, html, acts) {
    sheetActs = acts || [];
    sheet.setAttribute('aria-label', label);
    sheet.innerHTML = '<i class="grab" aria-hidden="true"></i>' + html;
    sheet.hidden = false;
    scrim.classList.add('show');
    void sheet.offsetHeight;
    sheet.classList.add('show');
    const first = sheet.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function sheetClose() {
    if (sheet.hidden) return;
    sheet.classList.remove('show');
    scrim.classList.remove('show');
    sheet.hidden = true;
    if (sheetBack) { const f = sheetBack; sheetBack = null; f(); }
  }
  scrim.addEventListener('click', sheetClose);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) sheetClose(); });
  sheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { sheetClose(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = sheetActs[+a.dataset.act];
    sheetClose();
    /* after the sheet is gone, so a popover it opens is not closed with it */
    if (act) setTimeout(act.run, 0);
  });
  function sheetHead(title, sub) {
    return '<header class="ph-shead"><div><h2>' + title + '</h2>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>' +
      '<button type="button" class="ph-round" data-close aria-label="Close">' + ic('close', 20) + '</button></header>';
  }
  /* actions whose button the app does not have (a module not loaded) are left out */
  function usable(list) {
    return list.filter(function (a) { return a.rule || !a.need || $(a.need); });
  }
  function listHtml(list, from) {
    return list.map(function (a, k) {
      if (a.rule) return '<i class="ph-rule" aria-hidden="true"></i>';
      return '<button type="button" class="ph-mi" data-act="' + (from + k) + '">' + ic(a.ico) +
        '<span>' + a.name + '</span>' + (a.more ? '<span class="ph-end">' + ic('chev', 20) + '</span>' : '') + '</button>';
    }).join('');
  }

  /* ---------------- the document: top bar and page counter ---------------- */
  const bar = $('bar');
  const docLbl = document.createElement('div');
  docLbl.className = 'ph-docname';
  docLbl.innerHTML = '<b></b><small></small>';
  if ($('btnHome')) $('btnHome').after(docLbl);
  const findBtn = document.createElement('button');
  findBtn.type = 'button';
  findBtn.className = 'btn ph-find';
  findBtn.setAttribute('aria-label', 'Find in this document');
  findBtn.innerHTML = ic('search');
  findBtn.addEventListener('click', function () { click('btnFind'); });
  if ($('btnSave')) $('btnSave').before(findBtn);
  function syncName() {
    const n = X.S.items.length;
    docLbl.querySelector('b').textContent = n ? X.docName().replace(/\.pdf$/i, '') : '';
    docLbl.querySelector('small').textContent = n ? n + (n === 1 ? ' page' : ' pages') + (X.isDirty() ? ' · edited' : '') : '';
  }
  X.on('meta', syncName);
  syncName();

  const pageTag = document.createElement('div');
  pageTag.className = 'ph-page';
  pageTag.setAttribute('aria-hidden', 'true');
  document.body.appendChild(pageTag);
  let pageTick = 0, pageHide = 0;
  function syncPage() {
    const n = X.S.items.length;
    if (!n || !panel.hidden) { pageTag.classList.remove('show'); return; }
    pageTag.textContent = (X.S.current || 1) + ' / ' + n;
    pageTag.classList.add('show');
    clearTimeout(pageHide);
    pageHide = setTimeout(function () { pageTag.classList.remove('show'); }, 1800);
  }
  if ($('stage')) {
    $('stage').addEventListener('scroll', function () {
      if (pageTick) return;
      pageTick = requestAnimationFrame(function () { pageTick = 0; syncPage(); });
    }, { passive: true });
  }

  /* ---------------- the document menu (More) ---------------- */
  function tool(id, name) { return function () { if (X.setTool) X.setTool(id); else click(name); }; }
  function rail(tab) { return function () { X.setRail(true); click(tab); }; }
  const GRID = [
    { name: 'Highlight', ico: 'mark', need: 'tHighlight', run: function () { click('tHighlight'); } },
    { name: 'Edit text', ico: 'text', run: tool('text', 'tText') },
    { name: 'Sign', ico: 'sign', need: 'btnSign', run: function () { click('btnSign'); } },
    { name: 'Comment', ico: 'note', need: 'tNote', run: function () { click('tNote'); } },
    { name: 'Site photos', ico: 'pin', run: function () { X.runTool('pin'); } },
    { name: 'Organise', ico: 'organize', need: 'btnOrganize', run: function () { click('btnOrganize'); } },
    { name: 'Crop', ico: 'crop', run: tool('crop', 'tCrop') },
    { name: 'Recognise text', ico: 'ocr', need: 'btnOcr', run: function () { click('btnOcr'); } }
  ];
  const MENU = [
    { name: 'Pages', ico: 'pages', need: 'tabPages', more: true, run: rail('tabPages') },
    { name: 'Bookmarks', ico: 'bookmark', need: 'btnBookmarks', more: true, run: function () { click('btnBookmarks'); } },
    { name: 'Comments', ico: 'comment', need: 'tabComments', more: true, run: rail('tabComments') },
    { name: 'Reading theme', ico: 'sun', need: 'btnTheme', run: function () { click('btnTheme'); } },
    { name: 'Read mode', ico: 'read', need: 'btnReadMode', run: function () { click('btnReadMode'); } },
    { name: 'Rulers & guides', ico: 'ruler', need: 'btnRulers', run: function () { click('btnRulers'); } },
    { name: 'Snap on or off', ico: 'snap', need: 'snapOn', run: function () { click('snapOn'); } },
    { rule: true },
    { name: 'Add pages', ico: 'add', need: 'btnAdd', run: function () { click('btnAdd'); } },
    { name: 'Combine files', ico: 'merge', need: 'addMerge', run: function () { click('addMerge'); } },
    { name: 'Extract & split', ico: 'extract', need: 'btnExtract', run: function () { click('btnExtract'); } },
    { name: 'Rotate page', ico: 'rotate', need: 'btnRotR', run: function () { click('btnRotR'); } },
    { name: 'Measure', ico: 'measure', need: 'tDim', run: function () { click('tDim'); } },
    { name: 'Translate', ico: 'translate', need: 'btnTr', run: function () { click('btnTr'); } },
    { name: 'Compress PDF', ico: 'compress', need: 'btnCompress', run: function () { click('btnCompress'); } },
    { name: 'Export as…', ico: 'export', more: true, run: function () { exportMenu(); } },
    { rule: true },
    { name: 'Save a copy', ico: 'save', need: 'btnSaveAs', run: function () { click('btnSaveAs'); } },
    { name: 'Send a copy', ico: 'share', run: function () { X.shareCopy(); }, when: function () { return !!X.shareFile; } },
    { name: 'Print', ico: 'print', run: function () { X.print(); } },
    { name: 'Properties', ico: 'info', need: 'btnProps', run: function () { click('btnProps'); } },
    { rule: true },
    { name: 'All tools and options', ico: 'tools', more: true, run: function () { X.openSheet(); } }
  ];
  function docMenu() {
    const grid = usable(GRID);
    const list = usable(MENU).filter(function (a) { return !a.when || a.when(); });
    const n = X.S.items.length;
    sheetOpen('Document',
      sheetHead(esc(X.docName()), n + (n === 1 ? ' page' : ' pages') + (X.isDirty() ? ' · edited' : '')) +
      '<div class="ph-sbody"><h3 class="ph-cap">Tools</h3><div class="ph-grid">' +
      grid.map(function (a, k) {
        return '<button type="button" class="ph-gt" data-act="' + k + '"><span class="ph-ico ' + (k < 4 ? 'v' : '') + '">' +
          ic(a.ico, 26) + '</span>' + a.name + '</button>';
      }).join('') + '</div><i class="ph-rule" aria-hidden="true"></i>' + listHtml(list, grid.length) + '</div>',
      grid.concat(list));
  }
  function exportMenu() {
    const list = usable([
      { name: 'Word (.docx)', ico: 'word', need: 'btnToWord', run: function () { click('btnToWord'); } },
      { name: 'Excel (.xlsx)', ico: 'sheet', need: 'btnToExcel', run: function () { click('btnToExcel'); } },
      { name: 'PowerPoint (.pptx)', ico: 'slides', need: 'btnToPpt', run: function () { click('btnToPpt'); } },
      { name: 'Pictures (JPG or PNG)', ico: 'jpg', need: 'btnToImg', run: function () { click('btnToImg'); } },
      { name: 'Text (.txt)', ico: 'txt', need: 'btnToTxt', run: function () { click('btnToTxt'); } },
      { name: 'CAD drawing (.dxf)', ico: 'cad', need: 'btnToCad', run: function () { click('btnToCad'); } }
    ]);
    sheetOpen('Export as', sheetHead('Export as…', 'A copy in another format') +
      '<div class="ph-sbody">' + listHtml(list, 0) + '</div>', list);
  }
  /* More opens this menu; the app's own sheet is its last entry */
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#btnMore')) return;
    if (!window.matchMedia('(max-width:760px)').matches) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    docMenu();
  }, true);

  /* ---------------- site photos: how to add them ---------------- */
  /* Add photos asks: the camera (stamped), the gallery, or any file. */
  let photoBypass = false;
  document.addEventListener('click', function (e) {
    if (photoBypass || !e.target.closest || !e.target.closest('#pe_add')) return;
    if (!window.matchMedia('(max-width:760px)').matches) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const ref = $('pe_ref') ? $('pe_ref').value.trim() : '';
    const num = $('pe_n') ? $('pe_n').value.trim() : '';
    const acts = [
      { name: 'Take photo', sub: 'Stamped with the date, time and pin', ico: 'camera', run: function () { click('pe_cam'); } },
      { name: 'Choose from gallery', sub: 'Pick several at once', ico: 'image', run: function () { addPhotos('image/*'); } },
      { name: 'Browse files', sub: 'Phone storage, Downloads, WhatsApp images', ico: 'folder', run: function () { addPhotos('*/*'); } }
    ];
    sheetOpen('Attach photos',
      '<header class="ph-shead"><span class="ph-pinno">' + esc(num || '•') + '</span><div><h2>Attach photos</h2>' +
        '<small>' + esc(['Pin ' + num, ref].filter(Boolean).join(' · ')) + '</small></div>' +
        '<button type="button" class="ph-round" data-close aria-label="Close">' + ic('close', 20) + '</button></header>' +
      '<div class="ph-sbody">' + acts.map(function (a, k) {
        return row('data-act="' + k + '"', a.ico, a.name, a.sub, null, k === 0 ? 'v' : '');
      }).join('') + '</div>', acts);
  }, true);
  function addPhotos(accept) {
    const inp = $('pinPhotoIn');
    if (!inp) return;
    const was = inp.accept;
    inp.accept = accept;
    photoBypass = true;
    click('pe_add');
    photoBypass = false;
    /* back once the picker has been shown */
    setTimeout(function () { inp.accept = was; }, 1000);
  }

  /* ---------------- merge: pick, order, join ---------------- */
  const mg = document.createElement('section');
  mg.className = 'ph-merge';
  mg.setAttribute('role', 'dialog');
  mg.setAttribute('aria-label', 'Merge PDFs');
  mg.hidden = true;
  mg.innerHTML =
    '<header class="ph-head ph-bar"><button type="button" class="ph-icon" id="mgBack" aria-label="Back">' + ic('back', 24) + '</button>' +
      '<h1 class="ph-title sm">Merge PDFs</h1></header>' +
    '<p class="ph-sub" id="mgInfo"></p>' +
    '<div class="ph-mlist" id="mgList"></div>' +
    '<button type="button" class="ph-addmore" id="mgAdd">' + ic('plus', 20) + 'Add PDFs</button>' +
    '<footer class="ph-foot"><button type="button" class="ph-primary" id="mgGo" disabled>Merge</button></footer>';
  document.body.appendChild(mg);
  const mgIn = document.createElement('input');
  mgIn.type = 'file'; mgIn.accept = 'application/pdf,.pdf'; mgIn.multiple = true; mgIn.hidden = true;
  document.body.appendChild(mgIn);
  let mgFiles = [];

  function openMerge() {
    mgFiles = [];
    drawMerge();
    mg.hidden = false;
    mgIn.click();
  }
  function closeMerge() { mg.hidden = true; mgFiles = []; }
  function drawMerge() {
    const pages = mgFiles.length;
    $('mgInfo').textContent = pages ? pages + (pages === 1 ? ' file' : ' files') + ' · joined in this order' :
      'Choose two or more PDFs. They are joined into one, in the order shown.';
    $('mgList').innerHTML = mgFiles.map(function (f, i) {
      return '<div class="ph-mrow"><span class="ph-num">' + (i + 1) + '</span>' +
        '<span class="ph-doc" aria-hidden="true"></span>' +
        '<span class="ph-txt"><b>' + esc(f.name) + '</b><small>' + esc(sizeLabel(f.size)) + '</small></span>' +
        '<button type="button" class="ph-icon" data-mv="' + i + ',-1" aria-label="Move ' + esc(f.name) + ' up"' + (i ? '' : ' disabled') + '>' + ic('up', 20) + '</button>' +
        '<button type="button" class="ph-icon" data-mv="' + i + ',1" aria-label="Move ' + esc(f.name) + ' down"' + (i < pages - 1 ? '' : ' disabled') + '>' + ic('down', 20) + '</button>' +
        '<button type="button" class="ph-icon" data-rm="' + i + '" aria-label="Remove ' + esc(f.name) + '">' + ic('close', 18) + '</button></div>';
    }).join('');
    $('mgGo').disabled = pages < 2;
    $('mgGo').textContent = pages < 2 ? 'Merge' : 'Merge ' + pages + ' files';
  }
  mgIn.addEventListener('change', function () {
    const add = Array.prototype.slice.call(mgIn.files || []).filter(function (f) {
      return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    });
    mgIn.value = '';
    mgFiles = mgFiles.concat(add);
    drawMerge();
  });
  $('mgList').addEventListener('click', function (e) {
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const a = mv.dataset.mv.split(','), i = +a[0], j = i + +a[1];
      const t = mgFiles[i]; mgFiles[i] = mgFiles[j]; mgFiles[j] = t;
      drawMerge();
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { mgFiles.splice(+rm.dataset.rm, 1); drawMerge(); }
  });
  $('mgAdd').addEventListener('click', function () { mgIn.click(); });
  $('mgBack').addEventListener('click', closeMerge);
  $('mgGo').addEventListener('click', function () {
    if (mgFiles.length < 2) return;
    if (X.hasDoc() && !X.okToReplace()) return;
    const files = mgFiles.slice();
    closeMerge();
    X.openFiles(files, { merge: true });
  });

  /* ---------------- organise: its page actions in a bar at the bottom ---------------- */
  /* the buttons themselves move (organize.js still finds them by id) */
  function orgBar() {
    const org = $('orgView');
    if (!org || org.querySelector('.ph-orgbar')) return;
    const bar = document.createElement('nav');
    bar.className = 'ph-orgbar';
    bar.setAttribute('aria-label', 'Selected pages');
    [['orgRotL', 'rotl', 'Rotate left'], ['orgRotR', 'rotate', 'Rotate right'], ['orgDup', 'copy', 'Duplicate'],
     ['orgExtract', 'share', 'Extract'], ['orgDel', 'trash', 'Remove']].forEach(function (b) {
      const el = $(b[0]);
      if (!el) return;
      el.innerHTML = ic(b[1]) + '<span>' + b[2].replace(' left', ' ←').replace(' right', ' →') + '</span>';
      el.setAttribute('aria-label', b[2]);
      bar.appendChild(el);
    });
    org.appendChild(bar);
  }
  if (window.matchMedia('(max-width:760px)').matches) orgBar();

  /* last: it reaches the sheet and the page counter */
  new MutationObserver(homeOpened).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  homeOpened();

  X.phone = { go: go, docMenu: docMenu, openMerge: openMerge };
})();
