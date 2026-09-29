/* ADD DOTS PDF — first run on a phone ("01 Onboarding" in
   design/AD PDF Editor iOS.dc.html)
   ----------------------------------------------------------
   Three short pages the first time the app opens on a phone: what it does,
   the site photo pins, and that files stay on the device. Get Started (or
   Skip) closes it for good on this device. It never stands in front of a
   document: opened with a file, or once a file opens, it goes. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[welcome] core bridge missing'); return; }

  const KEY = 'adpdf-welcomed';
  const PHONE = window.matchMedia('(max-width: 760px)');

  X.on('ready', function () {
    const S = X.S, $ = X.$;
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { /* private window: show it */ }
    if (seen || !PHONE.matches || S.items.length) return;

    const ICON = {
      text: ['#3B82F6', '#E8F0FE', 'M5 7V4h14v3M12 4v16M9 20h6'],
      pin: ['#E03616', '#FDEBE6', 'M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 8.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6'],
      merge: ['#8B5CF6', '#F1ECFE', 'M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h4a2 2 0 0 1 2 2V13'],
      sign: ['#22A06B', '#E6F6EE', 'M3 17c3 0 4-6 6-6s1 5 3 5 3-3 5-3M3 21h18'],
      photo: ['#F59E0B', '#FEF4E2', 'M3 4h18v16H3zM4 17l5-5 4 4 3-3 4 4'],
      report: ['#0EA5E9', '#E2F4FC', 'M14 3v5h5M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7zM9 13h6M9 17h6'],
      lock: ['#0F766E', '#E0F2F0', 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3'],
      off: ['#51686E', '#EEF2F3', 'M3 3l18 18M8.5 8.5A5 5 0 0 0 7 12H5a7 7 0 0 1 2.1-5M12 5a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5z'],
      share: ['#2F7FE6', '#E8F0FE', 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5']
    };
    const PAGES = [
      { title: 'Read, Edit &amp; Mark Up Any PDF',
        text: 'Edit text, pin site photos, merge and sign — all on your device.',
        chips: [['text', 'Edit text'], ['pin', 'PIN photos'], ['merge', 'Merge'], ['sign', 'Sign']] },
      { title: 'Site Photos, Pinned Where They Belong',
        text: 'Drop numbered pins on a drawing, add photos to each, and export a report.',
        chips: [['pin', 'Numbered pins'], ['photo', 'Photos'], ['report', 'PDF report'], ['share', 'Share link']] },
      { title: 'Private by Design',
        text: 'Your files open and save on this device. Nothing is uploaded unless you share it.',
        chips: [['lock', 'On your device'], ['off', 'Works offline'], ['text', 'Edit'], ['sign', 'Sign']] }
    ];
    const chip = function (c, i) {
      const k = ICON[c[0]];
      return '<span class="wchip c' + i + '"><i style="background:' + k[1] + ';color:' + k[0] + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + k[2] + '"/></svg></i>' + c[1] + '</span>';
    };

    const el = document.createElement('div');
    el.className = 'welcome'; el.id = 'welcome';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'wTitle'); el.setAttribute('aria-describedby', 'wText');
    el.innerHTML =
      '<button type="button" class="wskip" id="wSkip">Skip</button>' +
      '<div class="whead"><div class="wframe"><i></i><i></i><i></i><i></i><h2 id="wTitle"></h2></div>' +
        '<p class="wtext"><span aria-hidden="true">↘</span><span id="wText"></span></p></div>' +
      /* a page of a drawing, marked up: where the design has its hero photo */
      '<div class="wart" aria-hidden="true"><div class="wpage"><b></b><u></u><u></u><u></u>' +
        '<em><s></s></em><u></u><u></u></div><div id="wChips"></div></div>' +
      '<div class="wfoot"><div class="wdots" id="wDots" aria-hidden="true"><i></i><i></i><i></i></div>' +
        '<button type="button" class="wgo" id="wGo"></button></div>';
    document.body.appendChild(el);

    let at = 0;
    function show(i) {
      at = i;
      const p = PAGES[i];
      $('wTitle').innerHTML = p.title;
      $('wText').textContent = p.text;
      $('wChips').innerHTML = p.chips.map(chip).join('');
      Array.prototype.forEach.call($('wDots').children, function (d, k) { d.classList.toggle('on', k === i); });
      const last = i === PAGES.length - 1;
      $('wGo').innerHTML = (last ? 'Get Started' : 'Next') + ' <span aria-hidden="true">→</span>';
      $('wSkip').hidden = last;
    }
    function done() {
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* private window */ }
      close();
    }
    function close() {
      if (!el.isConnected) return;
      el.remove();
      document.body.classList.remove('welcoming');
    }
    $('wGo').addEventListener('click', function () {
      if (at < PAGES.length - 1) show(at + 1); else done();
    });
    $('wSkip').addEventListener('click', done);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') done();
      else if (e.key === 'ArrowRight' && at < PAGES.length - 1) show(at + 1);
      else if (e.key === 'ArrowLeft' && at > 0) show(at - 1);
    });
    /* a swipe sideways turns the page */
    let x0 = null;
    el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -50 && at < PAGES.length - 1) show(at + 1);
      else if (dx > 50 && at > 0) show(at - 1);
    });
    /* a document opening (from another app, or any other way) comes first */
    X.on('pages', function () { if (S.items.length) close(); });
    if (PHONE.addEventListener) PHONE.addEventListener('change', function () { if (!PHONE.matches) close(); });

    document.body.classList.add('welcoming');
    show(0);
    $('wGo').focus({ preventScroll: true });
  });
})();
