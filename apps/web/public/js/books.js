/* ADD DOTS PDF — Books
   -------------------
   The Books tab, for reading rather than editing: a full-screen book view
   with one or two pages and page turns, read aloud, bookmarks, the PDF's own
   table of contents, and a note of where you stopped so the next visit can
   carry on from there.

   The book view shows the document as it stands — edits, marks and page order
   included — by rebuilding it with core's buildPdf, the same way Convert does.
   Read aloud uses the browser's own speech, so nothing leaves the device.
   Bookmarks and the last-read page live in this browser, keyed by file name
   and page count. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[books] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const pdfjs = X.pdfjsLib;

    /* ---------------- ribbon tab, just before Convert ---------------- */

    const tab = document.createElement('button');
    tab.className = 'tab'; tab.id = 'ribBooks'; tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panBooks');
    tab.textContent = 'Books';
    const before = $('ribConvert');
    if (before) before.insertAdjacentElement('beforebegin', tab); else $('ribTabs').appendChild(tab);

    const pan = document.createElement('div');
    pan.className = 'rpan'; pan.id = 'panBooks'; pan.hidden = true;
    pan.setAttribute('role', 'tabpanel'); pan.setAttribute('aria-labelledby', 'ribBooks');
    const panBefore = $('panConvert');
    if (panBefore) panBefore.insertAdjacentElement('beforebegin', pan); else $('ribbon').appendChild(pan);
    X.addRibbonTab('ribBooks', 'panBooks');

    function grp(label) {
      if (pan.children.length) {
        const sep = document.createElement('span'); sep.className = 'sep'; pan.appendChild(sep);
      }
      const g = document.createElement('div');
      g.className = 'grp'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
      pan.appendChild(g);
      return g;
    }
    function btn(host, id, label, title, path, fn) {
      const b = document.createElement('button');
      b.className = 'btn'; b.id = id; b.type = 'button';
      b.title = title; b.dataset.label = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = '<svg viewBox="0 0 24 24">' + path + '</svg><span class="lbl">' + label + '</span>';
      b.addEventListener('click', fn);
      host.appendChild(b);
      return b;
    }

    const ICON = {
      book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/>' +
            '<line x1="12" y1="6.5" x2="12" y2="19.5"/>',
      speak: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
      pause: '<line x1="9" y1="6" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="18"/>',
      stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
      mark: '<path d="M7 3.5h10v17l-5-4-5 4z"/>',
      list: '<line x1="9" y1="7" x2="20" y2="7"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17" x2="20" y2="17"/>' +
            '<circle cx="5" cy="7" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>' +
            '<circle cx="5" cy="17" r="1" fill="currentColor"/>',
      resume: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><polyline points="4 4 4 8.5 8.5 8.5"/><polyline points="11 9 14.5 12 11 15"/>'
    };

    const g1 = grp('Reading');
    btn(g1, 'btnReadMode', 'Read', 'Read like a book — full screen, one or two pages, turn with the arrow keys',
      ICON.book, function () { openReader(S.current); });
    const bSpeak = btn(g1, 'btnSpeak', 'Read aloud', 'Read the document aloud from this page',
      ICON.speak, function () { speakToggle(); });
    const g2 = grp('Bookmarks');
    const bMark = btn(g2, 'btnBookmark', 'Bookmark', 'Bookmark this page (Ctrl+B)',
      ICON.mark, function () { toggleMark(currentPage()); });
    btn(g2, 'btnBookmarks', 'Bookmarks', 'Your bookmarks, and the chapters of this PDF',
      ICON.list, function (e) { openMarks(e.currentTarget); });
    const bResume = btn(g2, 'btnResume', 'Resume', 'Go back to the page you last read',
      ICON.resume, function () { const n = lastRead(); if (n) goPage(n); });
    bResume.disabled = true;

    /* ---------------- where you are, and what this browser remembers ---------------- */

    function docKey() {
      const name = (S.sources[0] && S.sources[0].name) || (S.baseName + '.pdf');
      return 'adpdf.books.' + name + '|' + S.items.length;
    }
    function load() {
      try { return JSON.parse(localStorage.getItem(docKey()) || '{}') || {}; } catch (e) { return {}; }
    }
    function save(d) {
      try { localStorage.setItem(docKey(), JSON.stringify(d)); } catch (e) { /* private window: forget it */ }
    }
    function marks() { return (load().marks || []).filter(function (m) { return m.p >= 1 && m.p <= S.items.length; }); }
    function lastRead() { const n = load().last; return n && n <= S.items.length ? n : 0; }
    function setLast(n) {
      if (!S.items.length) return;
      const d = load();
      if (d.last === n) return;
      d.last = n; save(d);
    }

    function currentPage() { return R.open ? R.n : S.current; }
    function goPage(n) {
      if (R.open) readerGo(n); else X.goTo(n);
      syncButtons();
    }

    function toggleMark(n) {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      const d = load(); d.marks = d.marks || [];
      const at = d.marks.findIndex(function (m) { return m.p === n; });
      if (at >= 0) { d.marks.splice(at, 1); X.toast('Bookmark removed from page ' + n); }
      else {
        d.marks.push({ p: n, name: 'Page ' + n });
        d.marks.sort(function (a, b) { return a.p - b.p; });
        X.toast('Page <b>' + n + '</b> bookmarked');
      }
      save(d);
      syncButtons();
    }

    function syncButtons() {
      const n = currentPage();
      const on = marks().some(function (m) { return m.p === n; });
      bMark.classList.toggle('on', on);
      if ($('bkMark')) $('bkMark').classList.toggle('on', on);
      const last = lastRead();
      bResume.disabled = !last;
      bResume.querySelector('.lbl').textContent = last ? 'Resume p.' + last : 'Resume';
      bSpeak.classList.toggle('on', T.on);
    }

    /* Note the page as you scroll, and keep the bookmark button honest. */
    let scrollTick = 0;
    $('stage').addEventListener('scroll', function () {
      clearTimeout(scrollTick);
      scrollTick = setTimeout(function () {
        if (!S.items.length || R.open) return;
        setLast(S.current);
        syncButtons();
      }, 400);
    }, { passive: true });

    /* A newly opened document: offer to carry on where it was left. */
    let seenKey = '';
    X.on('pages', function () {
      if (!S.items.length) return;
      const k = docKey();
      if (k === seenKey) { syncButtons(); return; }
      seenKey = k;
      const last = lastRead();
      if (last > 1) X.toast('You were reading page <b>' + last + '</b> — <b>Books › Resume</b> takes you back');
      syncButtons();
    });
    X.on('reset', function () { closeReader(); speakStop(); closeMarks(); });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,textarea,select')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b' && S.items.length) {
        e.preventDefault(); toggleMark(currentPage());
      }
    });

    /* ---------------- bookmarks and contents ---------------- */

    const mp = document.createElement('div');
    mp.className = 'bkpop'; mp.id = 'bkMarksPop'; mp.hidden = true;
    mp.setAttribute('role', 'dialog'); mp.setAttribute('aria-label', 'Bookmarks and contents');
    document.body.appendChild(mp);

    function closeMarks() { mp.hidden = true; }
    document.addEventListener('mousedown', function (e) {
      if (mp.hidden || mp.contains(e.target)) return;
      const t = e.target && e.target.closest ? e.target : null;
      if (!t || !t.closest('#btnBookmarks,#bkList')) closeMarks();
    });

    async function openMarks(anchor) {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!mp.hidden) { closeMarks(); return; }
      const list = marks();
      let html = '<div class="bkpop-h">Bookmarks</div>';
      if (!list.length) {
        html += '<p class="bkpop-empty">None yet. <b>Bookmark</b> (Ctrl+B) marks the page you are on.</p>';
      } else {
        html += '<ul class="bkpop-list">' + list.map(function (m) {
          return '<li><button class="bkpop-go" data-p="' + m.p + '"><b>' + m.p + '</b><span>' +
            X.esc(m.name || ('Page ' + m.p)) + '</span></button>' +
            '<button class="bkpop-ren" data-p="' + m.p + '" title="Rename">✎</button>' +
            '<button class="bkpop-del" data-p="' + m.p + '" title="Remove">×</button></li>';
        }).join('') + '</ul>';
      }
      html += '<div class="bkpop-h">Contents</div><div id="bkToc"><p class="bkpop-empty">Reading…</p></div>';
      mp.innerHTML = html;
      mp.hidden = false;
      const r = anchor.getBoundingClientRect();
      mp.style.top = Math.round(r.bottom + 6) + 'px';
      mp.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mp.offsetWidth - 8, r.left))) + 'px';

      const toc = await outline();
      if (mp.hidden) return;
      $('bkToc').innerHTML = toc.length
        ? '<ul class="bkpop-list toc">' + toc.map(function (o) {
            return '<li style="padding-left:' + (o.depth * 14) + 'px"><button class="bkpop-go" data-p="' + o.p + '">' +
              '<span>' + X.esc(o.title) + '</span><b>' + o.p + '</b></button></li>';
          }).join('') + '</ul>'
        : '<p class="bkpop-empty">This PDF has no table of contents.</p>';
    }

    mp.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b) return;
      const p = parseInt(b.dataset.p, 10);
      if (b.classList.contains('bkpop-go')) { goPage(p); closeMarks(); return; }
      const d = load(); d.marks = d.marks || [];
      const m = d.marks.filter(function (x) { return x.p === p; })[0];
      if (!m) return;
      if (b.classList.contains('bkpop-del')) {
        d.marks = d.marks.filter(function (x) { return x !== m; });
        save(d); syncButtons();
        b.closest('li').remove();
      } else if (b.classList.contains('bkpop-ren')) {
        const v = window.prompt('Name for this bookmark', m.name || ('Page ' + p));
        if (v === null) return;
        m.name = v.trim() || ('Page ' + p);
        save(d);
        b.closest('li').querySelector('span').textContent = m.name;
      }
    });

    /* The PDF's own outline, flattened, with each entry pointed at the page
       it lands on in the document as it is now (pages may have moved). */
    async function outline() {
      const src = S.sources[0];
      if (!src || !src.doc) return [];
      let items;
      try { items = await src.doc.getOutline(); } catch (e) { items = null; }
      if (!items || !items.length) return [];
      const out = [];
      async function walk(list, depth) {
        for (const o of list) {
          if (out.length > 400) return;
          let p = 0;
          try {
            let dest = o.dest;
            if (typeof dest === 'string') dest = await src.doc.getDestination(dest);
            if (Array.isArray(dest) && dest[0] != null) {
              const idx = typeof dest[0] === 'number' ? dest[0] : await src.doc.getPageIndex(dest[0]);
              const at = S.items.findIndex(function (it) { return it.src === src && it.num === idx + 1; });
              p = at + 1;
            }
          } catch (e) { p = 0; }
          if (p > 0) out.push({ title: o.title || 'Untitled', p: p, depth: depth });
          if (o.items && o.items.length) await walk(o.items, depth + 1);
        }
      }
      await walk(items, 0);
      return out;
    }

    /* ---------------- the book view ---------------- */

    const R = { open: false, pdf: null, n: 1, count: 0, spread: true, theme: 'day', job: 0, sizes: [] };
    try {
      const pref = JSON.parse(localStorage.getItem('adpdf.books.view') || '{}');
      if (pref.spread === false) R.spread = false;
      if (pref.theme) R.theme = pref.theme;
    } catch (e) { /* defaults */ }
    function savePref() {
      try { localStorage.setItem('adpdf.books.view', JSON.stringify({ spread: R.spread, theme: R.theme })); } catch (e) { /* fine */ }
    }

    const view = document.createElement('div');
    view.className = 'bk'; view.id = 'bkView'; view.hidden = true;
    view.setAttribute('role', 'dialog'); view.setAttribute('aria-label', 'Book view');
    view.innerHTML =
      '<header class="bk-top">' +
        '<b class="bk-title" id="bkTitle"></b><span class="grow"></span>' +
        '<button class="bk-b" id="bkSpread" title="One page or two (D)"></button>' +
        '<button class="bk-b" id="bkTheme" title="Paper colour (T)"></button>' +
        '<button class="bk-b ic" id="bkSpeak" title="Read aloud (R)"><svg viewBox="0 0 24 24">' + ICON.speak + '</svg></button>' +
        '<button class="bk-b ic" id="bkMark" title="Bookmark this page (B)"><svg viewBox="0 0 24 24">' + ICON.mark + '</svg></button>' +
        '<button class="bk-b ic" id="bkList" title="Bookmarks and contents"><svg viewBox="0 0 24 24">' + ICON.list + '</svg></button>' +
        '<button class="bk-b ic" id="bkFull" title="Full screen (F)"><svg viewBox="0 0 24 24">' +
          '<polyline points="4 9 4 4 9 4"/><polyline points="15 4 20 4 20 9"/><polyline points="20 15 20 20 15 20"/>' +
          '<polyline points="9 20 4 20 4 15"/></svg></button>' +
        '<button class="bk-b ic" id="bkClose" title="Close (Esc)"><svg viewBox="0 0 24 24">' +
          '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>' +
      '</header>' +
      '<div class="bk-stage" id="bkStage">' +
        '<button class="bk-nav prev" id="bkPrev" aria-label="Previous page"><svg viewBox="0 0 24 24"><polyline points="15 5 8 12 15 19"/></svg></button>' +
        '<div class="bk-spread" id="bkPages"><p class="bk-wait">Preparing the book…</p></div>' +
        '<button class="bk-nav next" id="bkNext" aria-label="Next page"><svg viewBox="0 0 24 24"><polyline points="9 5 16 12 9 19"/></svg></button>' +
      '</div>' +
      '<footer class="bk-foot">' +
        '<input type="range" id="bkRange" min="1" max="1" value="1" aria-label="Page">' +
        '<span class="bk-pg" id="bkPg"></span>' +
      '</footer>';
    document.body.appendChild(view);

    const THEMES = [['day', 'Day'], ['sepia', 'Sepia'], ['night', 'Night']];
    function paintChrome() {
      view.dataset.theme = R.theme;
      $('bkSpread').textContent = R.spread ? 'Two pages' : 'One page';
      $('bkTheme').textContent = THEMES.filter(function (t) { return t[0] === R.theme; })[0][1];
    }

    async function openReader(n) {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      closeMarks();
      R.open = true; R.n = Math.max(1, Math.min(S.items.length, n || 1));
      view.hidden = false;
      document.body.classList.add('bk-on');
      $('bkTitle').textContent = S.baseName;
      paintChrome();
      $('bkPages').innerHTML = '<p class="bk-wait">Preparing the book…</p>';
      const job = ++R.job;
      try {
        const bytes = await X.buildPdf(S.items, null, {});
        if (job !== R.job || !R.open) return;
        R.pdf = await pdfjs.getDocument({ data: bytes }).promise;
      } catch (e) {
        console.warn('[books] rebuild failed; reading the pages as opened', e);
        R.pdf = null;
      }
      if (job !== R.job || !R.open) return;
      R.count = S.items.length;
      R.sizes = [];
      $('bkRange').max = String(R.count);
      readerGo(R.n, 0);
    }

    function closeReader() {
      if (!R.open) return;
      R.open = false; R.job++;
      if (document.fullscreenElement === view) { try { document.exitFullscreen(); } catch (e) { /* fine */ } }
      view.hidden = true;
      document.body.classList.remove('bk-on');
      if (R.pdf) { try { R.pdf.destroy(); } catch (e) { /* gone */ } }
      R.pdf = null;
      X.goTo(R.n);                                  /* land the editor where the reading stopped */
      setLast(R.n);
      syncButtons();
    }

    function narrow() { return view.clientWidth < 760 || view.clientWidth < view.clientHeight * 0.9; }
    /* Two pages sit side by side like an open book: the cover alone on the
       right, then even pages on the left and odd on the right. */
    function shown(n) {
      if (!R.spread || narrow()) return [n];
      if (n <= 1) return [1];
      const left = n % 2 === 0 ? n : n - 1;
      return left + 1 <= R.count ? [left, left + 1] : [left];
    }
    function step(dir) {
      const now = shown(R.n);
      if (dir > 0) {
        const nxt = now[now.length - 1] + 1;
        if (nxt <= R.count) readerGo(nxt, 1);
      } else {
        const prv = now[0] - 1;
        if (prv >= 1) readerGo(prv, -1);
      }
    }

    async function pageOf(n) {
      if (R.pdf) return R.pdf.getPage(n);
      return X.ensurePage(S.items[n - 1]);
    }

    async function readerGo(n, dir) {
      if (!R.open) return;
      R.n = Math.max(1, Math.min(R.count || S.items.length, n));
      const list = shown(R.n);
      const job = ++R.job;
      $('bkRange').value = String(R.n);
      $('bkPg').textContent = (list.length > 1 ? list[0] + '–' + list[1] : list[0]) + ' / ' + R.count;
      $('bkPrev').disabled = list[0] <= 1;
      $('bkNext').disabled = list[list.length - 1] >= R.count;

      const host = $('bkPages');
      const W = host.clientWidth - 8, H = host.clientHeight - 8;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const pages = await Promise.all(list.map(pageOf));
      if (job !== R.job) return;
      const vps = pages.map(function (p, i) {
        const rot = R.pdf ? 0 : ((p.rotate + (S.items[list[i] - 1].rot || 0)) % 360);
        return p.getViewport({ scale: 1, rotation: R.pdf ? p.rotate : rot });
      });
      const totalW = vps.reduce(function (a, v) { return a + v.width; }, 0);
      const maxH = Math.max.apply(null, vps.map(function (v) { return v.height; }));
      const scale = Math.max(0.1, Math.min(W / totalW, H / maxH));

      const canvases = [];
      for (let i = 0; i < pages.length; i++) {
        const vp = pages[i].getViewport({ scale: scale * dpr, rotation: vps[i].rotation });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        c.style.width = Math.round(vp.width / dpr) + 'px';
        c.style.height = Math.round(vp.height / dpr) + 'px';
        c.className = 'bk-page' + (list.length > 1 ? (i === 0 ? ' l' : ' r') : '');
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pages[i].render({ canvasContext: ctx, viewport: vp }).promise;
        if (job !== R.job) return;
        canvases.push(c);
      }
      host.replaceChildren.apply(host, canvases);
      host.classList.remove('turn-next', 'turn-prev');
      if (dir) { void host.offsetWidth; host.classList.add(dir > 0 ? 'turn-next' : 'turn-prev'); }
      setLast(R.n);
      syncButtons();
      if (T.on && !T.following && T.page !== R.n && list.indexOf(T.page) < 0) {
        /* you turned the page by hand while it was reading: read from here */
        speakFrom(R.n);
      }
    }

    $('bkPrev').addEventListener('click', function () { step(-1); });
    $('bkNext').addEventListener('click', function () { step(1); });
    $('bkClose').addEventListener('click', closeReader);
    $('bkSpread').addEventListener('click', function () { R.spread = !R.spread; savePref(); paintChrome(); readerGo(R.n, 0); });
    $('bkTheme').addEventListener('click', function () {
      const i = THEMES.findIndex(function (t) { return t[0] === R.theme; });
      R.theme = THEMES[(i + 1) % THEMES.length][0];
      savePref(); paintChrome();
    });
    $('bkSpeak').addEventListener('click', function () { speakToggle(); });
    $('bkMark').addEventListener('click', function () { toggleMark(R.n); });
    $('bkList').addEventListener('click', function (e) { openMarks(e.currentTarget); });
    $('bkFull').addEventListener('click', toggleFull);
    $('bkRange').addEventListener('input', function () {
      $('bkPg').textContent = this.value + ' / ' + R.count;
    });
    $('bkRange').addEventListener('change', function () { readerGo(parseInt(this.value, 10) || 1, 0); });

    function toggleFull() {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (view.requestFullscreen) view.requestFullscreen();
      } catch (e) { /* not allowed here */ }
    }

    /* click the outer thirds of the page to turn; swipe on a touch screen */
    let swipe = null;
    $('bkStage').addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    $('bkStage').addEventListener('pointerup', function (e) {
      if (!swipe || e.target.closest('button')) { swipe = null; return; }
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      const tap = Math.abs(dx) < 8 && Math.abs(dy) < 8;
      swipe = null;
      if (!tap) { if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1); return; }
      const w = $('bkStage').clientWidth;
      if (e.clientX < w / 3) step(-1); else if (e.clientX > w * 2 / 3) step(1);
    });
    $('bkStage').addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) < 30 || R.wheelLock) return;
      R.wheelLock = true; setTimeout(function () { R.wheelLock = false; }, 350);
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (!R.open) return;
      if (e.target.matches && e.target.matches('input:not([type=range]),textarea,select')) return;
      const k = e.key;
      let used = true;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') step(1);
      else if (k === 'ArrowLeft' || k === 'PageUp') step(-1);
      else if (k === 'Home') readerGo(1, -1);
      else if (k === 'End') readerGo(R.count, 1);
      else if (k === 'Escape') { if (!mp.hidden) closeMarks(); else if (!document.fullscreenElement) closeReader(); }
      else if (k === 'f' || k === 'F') toggleFull();
      else if (k === 'd' || k === 'D') $('bkSpread').click();
      else if (k === 't' || k === 'T') $('bkTheme').click();
      else if (k === 'b' || k === 'B') toggleMark(R.n);
      else if (k === 'r' || k === 'R') speakToggle();
      else used = false;
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    let resizeTick = 0;
    window.addEventListener('resize', function () {
      if (!R.open) return;
      clearTimeout(resizeTick);
      resizeTick = setTimeout(function () { readerGo(R.n, 0); }, 150);
    });

    /* ---------------- read aloud ---------------- */

    const synth = window.speechSynthesis;
    const T = { on: false, paused: false, page: 1, token: 0, rate: 1, voice: '', following: false };
    try {
      const pref = JSON.parse(localStorage.getItem('adpdf.books.voice') || '{}');
      if (pref.rate) T.rate = pref.rate;
      if (pref.voice) T.voice = pref.voice;
    } catch (e) { /* defaults */ }

    const bar = document.createElement('div');
    bar.className = 'ttsbar'; bar.id = 'ttsBar'; bar.hidden = true;
    bar.innerHTML =
      '<button class="tts-b" id="ttsPlay" title="Pause"><svg viewBox="0 0 24 24">' + ICON.pause + '</svg></button>' +
      '<button class="tts-b" id="ttsStop" title="Stop"><svg viewBox="0 0 24 24">' + ICON.stop + '</svg></button>' +
      '<span class="tts-pg" id="ttsPg"></span>' +
      '<select id="ttsRate" aria-label="Speed">' +
        [0.75, 1, 1.25, 1.5, 1.75, 2].map(function (r) { return '<option value="' + r + '">' + r + '×</option>'; }).join('') +
      '</select>' +
      '<select id="ttsVoice" aria-label="Voice"></select>';
    document.body.appendChild(bar);
    $('ttsRate').value = String(T.rate);

    function saveVoice() {
      try { localStorage.setItem('adpdf.books.voice', JSON.stringify({ rate: T.rate, voice: T.voice })); } catch (e) { /* fine */ }
    }
    function fillVoices() {
      if (!synth) return;
      const vs = synth.getVoices();
      const sel = $('ttsVoice');
      sel.innerHTML = '<option value="">Default voice</option>' + vs.map(function (v) {
        return '<option value="' + X.esc(v.name) + '">' + X.esc(v.name) + ' (' + X.esc(v.lang) + ')</option>';
      }).join('');
      sel.value = vs.some(function (v) { return v.name === T.voice; }) ? T.voice : '';
    }
    if (synth) { fillVoices(); synth.addEventListener && synth.addEventListener('voiceschanged', fillVoices); }

    $('ttsRate').addEventListener('change', function () { T.rate = parseFloat(this.value) || 1; saveVoice(); });
    $('ttsVoice').addEventListener('change', function () { T.voice = this.value; saveVoice(); });
    $('ttsStop').addEventListener('click', speakStop);
    $('ttsPlay').addEventListener('click', speakToggle);

    function paintBar() {
      bar.hidden = !T.on;
      $('ttsPlay').innerHTML = '<svg viewBox="0 0 24 24">' + (T.paused
        ? '<polygon points="7 5 19 12 7 19" fill="currentColor"/>' : ICON.pause) + '</svg>';
      $('ttsPlay').title = T.paused ? 'Carry on' : 'Pause';
      $('ttsPg').textContent = T.on ? (T.paused ? 'Paused · page ' : 'Reading page ') + T.page : '';
      $('bkSpeak').classList.toggle('on', T.on);
      bSpeak.classList.toggle('on', T.on);
      bSpeak.querySelector('.lbl').textContent = !T.on ? 'Read aloud' : T.paused ? 'Carry on' : 'Pause';
    }

    function speakToggle() {
      if (!synth) { X.toast('This browser cannot read aloud'); return; }
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!T.on) { speakFrom(currentPage()); return; }
      if (T.paused) { T.paused = false; synth.resume(); }
      else { T.paused = true; synth.pause(); }
      paintBar();
    }
    function speakStop() {
      T.token++; T.on = false; T.paused = false;
      if (synth) synth.cancel();
      paintBar();
    }

    async function speakFrom(n) {
      if (!synth) return;
      T.token++; synth.cancel();
      const tok = T.token;
      T.on = true; T.paused = false; T.page = n;
      paintBar();
      let spoke = false;
      while (tok === T.token && T.page <= S.items.length) {
        follow(T.page);
        paintBar();
        const parts = chunks(await pageText(T.page));
        if (tok !== T.token) return;
        for (let i = 0; i < parts.length; i++) {
          if (tok !== T.token) return;
          await say(parts[i]);
          spoke = true;
        }
        if (tok !== T.token) return;
        T.page++;
      }
      if (tok === T.token) {
        speakStop();
        X.toast(spoke ? 'Finished reading' : 'No text to read — these pages look scanned');
      }
    }

    /* keep the page being read in view, without that counting as a hand turn */
    function follow(n) {
      T.following = true;
      if (R.open) { if (shown(R.n).indexOf(n) < 0) readerGo(n, 1); }
      else if (S.current !== n) X.goTo(n);
      setTimeout(function () { T.following = false; }, 800);
    }

    function say(text) {
      return new Promise(function (res) {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = T.rate;
        const v = synth.getVoices().filter(function (x) { return x.name === T.voice; })[0];
        if (v) { u.voice = v; u.lang = v.lang; }
        u.onend = res; u.onerror = res;
        synth.speak(u);
      });
    }

    async function pageText(n) {
      let page;
      try { page = R.open && R.pdf ? await R.pdf.getPage(n) : await X.ensurePage(S.items[n - 1]); }
      catch (e) { return ''; }
      let tc;
      try { tc = await page.getTextContent(); } catch (e) { return ''; }
      let out = '';
      tc.items.forEach(function (it) {
        if (typeof it.str !== 'string') return;
        out += it.str + (it.hasEOL ? '\n' : '');
      });
      return out
        .replace(/([A-Za-z])-\n([a-z])/g, '$1$2')     /* words broken over a line */
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    /* Short pieces: some browsers stop a long utterance part-way through. */
    function chunks(text) {
      if (!text) return [];
      const out = [];
      text.split(/(?<=[.!?;:])\s+/).forEach(function (s) {
        while (s.length > 220) {
          let cut = s.lastIndexOf(', ', 200);
          if (cut < 80) cut = s.lastIndexOf(' ', 200);
          if (cut < 40) cut = 200;
          out.push(s.slice(0, cut + 1).trim());
          s = s.slice(cut + 1);
        }
        if (s.trim()) out.push(s.trim());
      });
      return out;
    }

    window.addEventListener('beforeunload', function () { if (synth) synth.cancel(); });

    X.books = { open: openReader, close: closeReader, speak: speakFrom, stop: speakStop, toggleMark: toggleMark };
  });
})();
