/* ADD DOTS PDF — the panel on the right (the design's "Web Editor" screen)
   ---------------------------------------------------------------------
   On a wide window, beside the pages: the page being read (its size, turn
   it, take it out, remove it) and Download & share (the whole PDF, pages
   as JPG, or the pages ticked in the sidebar; a link, printing and
   compressing). Everything here opens what the ribbon already has, the
   same popovers and the same code, so nothing is done two ways.

   It only shows where there is room for it (brand.css, 1280px and wider)
   and can be closed; the View tab's Panel button brings it back, and the
   choice is kept on this device. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[inspector] core bridge missing'); return; }

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    const KEY = 'adpdf-inspector';
    const WIDE = window.matchMedia('(min-width: 1280px)');

    const ICONS = {
      rotL: '<path d="M3 4v6h6"/><path d="M3.5 14a8.5 8.5 0 1 0 2.1-7.4L3 9"/>',
      rotR: '<path d="M21 4v6h-6"/><path d="M20.5 14a8.5 8.5 0 1 1-2.1-7.4L21 9"/>',
      ext: '<path d="M14 3v5h5"/><path d="M19 11V8l-5-5H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M17 14v7M14 18l3 3 3-3"/>',
      del: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
      down: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
      link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
      print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
      zip: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
      word: '<path d="M14 3v5h5"/><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z"/><path d="M8 12l1.5 6 2.5-4.5 2.5 4.5 1.5-6"/>',
      close: '<path d="M6 6l12 12M18 6 6 18"/>',
      panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/>'
    };
    const svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>'; };

    /* ---------------- the panel ---------------- */
    const el = document.createElement('aside');
    el.className = 'insp'; el.id = 'insp';
    el.setAttribute('aria-label', 'Page and download');
    el.innerHTML =
      '<section class="icard" id="inspPage">' +
        '<header><h2 id="inspPgTitle">Page</h2><span class="itag" id="inspPgSize"></span>' +
          '<button class="ix" id="inspClose" type="button" title="Close this panel" aria-label="Close this panel">' + svg('close') + '</button></header>' +
        '<p class="inote" id="inspPgNote"></p>' +
        '<div class="igrid">' +
          '<button type="button" id="inspRotL">' + svg('rotL') + 'Turn left</button>' +
          '<button type="button" id="inspRotR">' + svg('rotR') + 'Turn right</button>' +
          '<button type="button" id="inspExt" data-opens-pop>' + svg('ext') + 'Extract</button>' +
          '<button type="button" id="inspDel" class="danger">' + svg('del') + 'Remove</button>' +
        '</div>' +
      '</section>' +
      '<section class="icard grow" id="inspOut">' +
        '<header><h2>Download &amp; share</h2></header>' +
        '<div class="iseg" role="radiogroup" aria-label="What to download">' +
          '<button type="button" role="radio" data-k="pdf" aria-checked="true">PDF</button>' +
          '<button type="button" role="radio" data-k="jpg" aria-checked="false">JPG pages</button>' +
          '<button type="button" role="radio" data-k="sel" aria-checked="false">Ticked</button>' +
        '</div>' +
        '<label class="itoggle" id="inspFlatRow"><span>Flatten markups into the page</span>' +
          '<input type="checkbox" role="switch" id="inspFlat"><i aria-hidden="true"></i></label>' +
        '<p class="inote" id="inspOutNote"></p>' +
        '<button type="button" class="igo" id="inspGo" data-opens-pop>' + svg('down') + '<span id="inspGoLbl">Download PDF</span></button>' +
        '<h3>More ways to send it</h3>' +
        '<div class="iapps" id="inspApps"></div>' +
      '</section>';
    $('stage').after(el);

    /* the tiles: each clicks the button that already does it, when it is there */
    const APPS = [
      ['btnShare', 'Share link', 'link', '#2F7FE6'],
      ['btnPrint', 'Print', 'print', '#0B2A31'],
      ['btnCompress', 'Compress', 'zip', '#22A06B'],
      ['btnToWord', 'Word', 'word', '#8B5CF6']
    ];
    APPS.forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.for = a[0];
      b.innerHTML = '<i style="background:' + a[3] + '">' + svg(a[2]) + '</i><span>' + a[1] + '</span>';
      b.addEventListener('click', function () {
        const t = $(a[0]);
        if (t && !t.disabled) t.click();
      });
      $('inspApps').appendChild(b);
    });

    /* ---------------- shown or not ---------------- */
    let closed = false;
    try { closed = localStorage.getItem(KEY) === 'off'; } catch (e) { /* private window */ }

    /* the View tab's button that brings it back */
    const btn = document.createElement('button');
    btn.className = 'btn'; btn.id = 'btnInsp'; btn.type = 'button';
    btn.title = 'The page and download panel on the right';
    btn.dataset.label = 'Panel';
    btn.setAttribute('aria-label', 'Page and download panel');
    btn.innerHTML = svg('panel') + '<span class="lbl">Panel</span>';
    const view = $('grpView');
    if (view) view.appendChild(btn);

    function sync() {
      const shown = WIDE.matches && !closed && !!S.items.length;
      const was = !el.hidden;
      el.hidden = !shown;
      document.body.classList.toggle('insp-on', shown);
      btn.classList.toggle('on', shown);
      btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
      btn.hidden = !WIDE.matches;
      if (shown) render();
      /* the pages fit to what is left of the window */
      if (was !== shown && S.items.length && S.fit) X.relayout();
    }
    function setClosed(v) {
      closed = v;
      try { localStorage.setItem(KEY, v ? 'off' : 'on'); } catch (e) { /* private window */ }
      sync();
    }
    $('inspClose').addEventListener('click', function () { setClosed(true); $('stage').focus({ preventScroll: true }); });
    btn.addEventListener('click', function () { setClosed(!closed); });
    if (WIDE.addEventListener) WIDE.addEventListener('change', sync);
    else if (WIDE.addListener) WIDE.addListener(sync);

    /* ---------------- this page ---------------- */
    const SIZES = [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297],
                   ['A5', 148, 210], ['Letter', 216, 279], ['Legal', 216, 356], ['Tabloid', 279, 432]];
    function sizeName(it) {
      if (!it || !it.page) return '';
      const v = it.page.getViewport({ scale: 1, rotation: it.page.rotate + it.rot });
      const w = v.width / 72 * 25.4, h = v.height / 72 * 25.4;
      const lo = Math.min(w, h), hi = Math.max(w, h);
      const hit = SIZES.find(function (s) { return Math.abs(s[1] - lo) < 3 && Math.abs(s[2] - hi) < 3; });
      const turn = w > h ? ' landscape' : '';
      return hit ? hit[0] + turn : Math.round(w) + ' × ' + Math.round(h) + ' mm';
    }
    function render() {
      if (el.hidden) return;
      const n = S.items.length, i = S.current - 1, it = S.items[i];
      $('inspPgTitle').textContent = n ? 'Page ' + S.current + ' of ' + n : 'Page';
      $('inspPgSize').textContent = sizeName(it);
      const marks = it && it.shapes ? it.shapes.length : 0;
      const bits = [];
      if (marks) bits.push(marks + (marks === 1 ? ' mark' : ' marks'));
      if (it && it.rot) bits.push('turned ' + ((it.rot % 360 + 360) % 360) + '°');
      if (it && it.crop) bits.push('cropped');
      if (it && it.added) bits.push('added');
      $('inspPgNote').textContent = bits.length ? bits.join(' · ') : 'As it came in the file';
      $('inspDel').disabled = n <= 1;
      renderOut();
    }

    $('inspRotL').addEventListener('click', function () { if (S.items.length) X.rotateItem(S.current - 1, -90); render(); });
    $('inspRotR').addEventListener('click', function () { if (S.items.length) X.rotateItem(S.current - 1, 90); render(); });
    $('inspDel').addEventListener('click', function () {
      if (S.items.length > 1) X.removeItem(S.current - 1);
      render();
    });
    $('inspExt').addEventListener('click', function () {
      if (!S.items.length) return;
      X.openPop('extractPop', $('inspExt'));
      /* this page, whatever is ticked */
      $('exRange').value = String(S.current);
      $('exRange').dispatchEvent(new Event('input'));
    });

    /* ---------------- download & share ---------------- */
    let kind = 'pdf';
    const ticked = function () { return S.items.filter(function (it) { return it.pick; }).length; };
    function renderOut() {
      el.querySelectorAll('.iseg button').forEach(function (b) {
        b.setAttribute('aria-checked', b.dataset.k === kind ? 'true' : 'false');
      });
      const n = S.items.length, t = ticked();
      $('inspFlatRow').hidden = kind !== 'pdf';
      $('inspFlat').checked = $('saveFlat').checked;
      let lbl = 'Download PDF', note = '', off = !n;
      if (kind === 'pdf') {
        note = 'The whole document, ' + n + (n === 1 ? ' page' : ' pages') + ', with your changes.';
      } else if (kind === 'jpg') {
        lbl = 'Download JPGs';
        note = 'Each page as a picture. Choose the pages and the detail next.';
      } else {
        lbl = t ? 'Download ' + t + (t === 1 ? ' page' : ' pages') : 'Download ticked pages';
        note = t ? 'The pages ticked in the sidebar, as one PDF or one each.'
                 : 'Tick pages in the sidebar (Pages) to take just those.';
        off = off || !t;
      }
      $('inspGoLbl').textContent = lbl;
      $('inspOutNote').textContent = note;
      $('inspGo').disabled = off;
      el.querySelectorAll('#inspApps button').forEach(function (b) {
        const t2 = $(b.dataset.for);
        b.hidden = !t2;
        b.disabled = !t2 || t2.disabled || !n;
      });
    }
    el.querySelector('.iseg').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      kind = b.dataset.k;
      renderOut();
    });
    /* arrow keys move along the choices, as in any radio group */
    el.querySelector('.iseg').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const all = Array.prototype.slice.call(el.querySelectorAll('.iseg button'));
      const i = all.findIndex(function (b) { return b.dataset.k === kind; });
      const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      kind = next.dataset.k; renderOut(); next.focus();
      e.preventDefault();
    });
    /* one switch, two places: the Save popover has the same choice */
    $('inspFlat').addEventListener('change', function () { $('saveFlat').checked = $('inspFlat').checked; });
    $('saveFlat').addEventListener('change', function () { $('inspFlat').checked = $('saveFlat').checked; });

    $('inspGo').addEventListener('click', function () {
      if (!S.items.length) return;
      const go = $('inspGo');
      if (kind === 'pdf') X.openPop('savePop', go);
      else if (kind === 'jpg') X.openPop('jpgPop', go);
      else if (ticked()) X.openPop('extractPop', go);
    });

    /* ---------------- keeping up ---------------- */
    X.on('pages', sync);
    X.on('current', render);
    X.on('reset', sync);
    /* a tick in the sidebar changes what Ticked can take */
    $('railPages').addEventListener('click', function () { setTimeout(renderOut, 0); });
    sync();
  });
})();
