/* ADD DOTS PDF — Look
   -------------------
   The WPS look (css/wps.css) over the light interface, with the status bar
   it brings: the sidebar, the page and the zoom along the bottom, as WPS
   has them. It is the only look: there is no plain look to switch to. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[skin] core bridge missing'); return; }

  document.body.dataset.skin = 'wps';
  /* a device that once chose the plain look forgets it */
  try { localStorage.removeItem('adddots.skin'); } catch (e) { /* nothing kept */ }

  X.on('ready', function () {
    const S = X.S, $ = X.$;

    /* ---------------- the status bar ---------------- */
    const ic = function (p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; };
    const bar = document.createElement('div');
    bar.className = 'statusbar'; bar.id = 'statusBar';
    /* a labelled region: a landmark, so nothing on the page sits outside one */
    bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Page and zoom');
    bar.innerHTML =
      '<button type="button" data-a="rail" title="Sidebar (S)" aria-label="Sidebar">' +
        ic('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>') + '</button>' +
      '<span class="sbsep"></span>' +
      '<button type="button" data-a="first" title="First page (Home)" aria-label="First page">' + ic('<polyline points="17 18 11 12 17 6"/><line x1="7" y1="6" x2="7" y2="18"/>') + '</button>' +
      '<button type="button" data-a="prev" title="Previous page" aria-label="Previous page">' + ic('<polyline points="15 18 9 12 15 6"/>') + '</button>' +
      '<span class="sbpage"><input id="sbPage" inputmode="numeric" aria-label="Page number"><span id="sbTotal">/ 0</span></span>' +
      '<button type="button" data-a="next" title="Next page" aria-label="Next page">' + ic('<polyline points="9 18 15 12 9 6"/>') + '</button>' +
      '<button type="button" data-a="last" title="Last page (End)" aria-label="Last page">' + ic('<polyline points="7 18 13 12 7 6"/><line x1="17" y1="6" x2="17" y2="18"/>') + '</button>' +
      '<span class="sbgrow"></span>' +
      '<button type="button" data-a="fitw" title="Fit width (W)" aria-label="Fit width">' + ic('<rect x="6" y="4" width="12" height="16" rx="1.5"/><polyline points="4 9 1.5 12 4 15"/><polyline points="20 9 22.5 12 20 15"/>') + '</button>' +
      '<button type="button" data-a="fitp" title="Fit page (P)" aria-label="Fit page">' + ic('<rect x="6" y="3" width="12" height="18" rx="1.5"/><line x1="9" y1="8" x2="15" y2="8"/>') + '</button>' +
      '<button type="button" data-a="two" title="Two pages side by side" aria-label="Two pages">' + ic('<rect x="2.5" y="5" width="8.5" height="14" rx="1.2"/><rect x="13" y="5" width="8.5" height="14" rx="1.2"/>') + '</button>' +
      '<span class="sbsep"></span>' +
      '<button type="button" data-a="out" title="Zoom out (−)" aria-label="Zoom out">' + ic('<line x1="5" y1="12" x2="19" y2="12"/>') + '</button>' +
      '<input type="range" class="sbzoom" id="sbZoom" min="0" max="1000" step="1" aria-label="Zoom">' +
      '<button type="button" data-a="in" title="Zoom in (+)" aria-label="Zoom in">' + ic('<line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/>') + '</button>' +
      '<span class="sbpct" id="sbPct">100%</span>';
    const app = document.querySelector('.app');
    const dock = $('dock');
    if (dock && dock.parentNode === app) app.insertBefore(bar, dock); else app.appendChild(bar);

    /* the slider runs in log steps, so 50% and 200% sit either side of 100% */
    const lo = Math.log(X.ZOOM_MIN || 0.2), hi = Math.log(X.ZOOM_MAX || 6);
    const toSlider = function (z) { return Math.round(1000 * (Math.log(z) - lo) / (hi - lo)); };
    const fromSlider = function (v) { return Math.exp(lo + (hi - lo) * v / 1000); };

    function click(id) { const el = $(id); if (el && !el.disabled) el.click(); }
    bar.addEventListener('click', function (e) {
      const b = e.target.closest('button'); if (!b || !S.items.length && b.dataset.a !== 'rail') return;
      const a = b.dataset.a, n = S.items.length;
      if (a === 'rail') click('btnRail');
      if (a === 'first') X.goTo(1);
      const step = X.pageStep ? X.pageStep() : 1;
      if (a === 'prev') X.goTo(Math.max(1, S.current - step));
      if (a === 'next') X.goTo(Math.min(n, S.current + step));
      if (a === 'last') X.goTo(n);
      if (a === 'fitw') click('btnFitW');
      if (a === 'fitp') { S.fit = 'page'; X.relayout(); }
      if (a === 'two' && X.setSpread) X.setSpread(!S.spread);
      if (a === 'out') click('btnOut');
      if (a === 'in') click('btnIn');
      setTimeout(paint, 60);
    });
    const page = bar.querySelector('#sbPage');
    page.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const v = parseInt(page.value, 10);
      if (v >= 1 && v <= S.items.length) X.goTo(v);
      page.blur();
    });
    page.addEventListener('blur', paint);
    const zoom = bar.querySelector('#sbZoom');
    zoom.addEventListener('input', function () { if (S.items.length && X.zoomTo) X.zoomTo(fromSlider(+zoom.value)); });
    zoom.addEventListener('keydown', function (e) { e.stopPropagation(); });

    let last = '';
    function paint() {
      bar.hidden = !S.items.length;
      if (!S.items.length) return;
      const z = X.zoom ? X.zoom() : S.scale;
      const k = S.current + '|' + S.items.length + '|' + z.toFixed(3) + '|' + S.fit + '|' + !$('rail').hidden + '|' + S.spread;
      if (k === last) return;
      last = k;
      if (document.activeElement !== page) page.value = S.current;
      $('sbTotal').textContent = '/ ' + S.items.length;
      if (document.activeElement !== zoom) zoom.value = toSlider(z);
      $('sbPct').textContent = Math.round(z * 100) + '%';
      bar.querySelector('[data-a="first"]').disabled = bar.querySelector('[data-a="prev"]').disabled = S.current <= 1;
      const step = X.pageStep ? X.pageStep() : 1;
      bar.querySelector('[data-a="last"]').disabled = bar.querySelector('[data-a="next"]').disabled = S.current + step > S.items.length;
      bar.querySelector('[data-a="two"]').classList.toggle('on', !!S.spread);
      bar.querySelector('[data-a="fitw"]').classList.toggle('on', S.fit === 'width');
      bar.querySelector('[data-a="fitp"]').classList.toggle('on', S.fit === 'page');
      bar.querySelector('[data-a="rail"]').classList.toggle('on', !$('rail').hidden);
    }
    $('stage').addEventListener('scroll', function () { requestAnimationFrame(paint); }, { passive: true });
    setInterval(paint, 400);
    paint();
  });
})();
