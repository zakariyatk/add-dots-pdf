/* ADD DOTS PDF — Performance panel
   -------------------------------
   Ctrl+Shift+P shows what the app is doing and what it costs, to measure
   before and after a change on the computer it runs on (see
   docs/windows-performance.md): the last file opened (read, parsed, first
   page drawn), drawings by engine (count, ms each, ms per megapixel),
   pages and thumbnails holding a picture now, the file bytes held, the
   page's JavaScript memory, and in the Windows app its own memory.
   "Copy" puts it all on the clipboard as text, for a report. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[perf] core bridge missing'); return; }
  let T = window.__TAURI__;
  try { if (!T && window.parent !== window) T = window.parent.__TAURI__; } catch (e) { /* not the app's */ }

  let box = null, timer = 0;
  const mb = function (b) { return b == null ? '–' : (b / 1048576).toFixed(0) + ' MB'; };
  const ms = function (v) { return v == null ? '–' : Math.round(v) + ' ms'; };

  function lines(native) {
    const p = X.perf ? X.perf() : {};
    const out = [];
    const o = p.open;
    out.push(['File', o ? o.name + ' (' + mb(o.size) + ')' : '–']);
    if (o) {
      out.push(['Read from disk', ms(o.read)]);
      out.push(['Opened (parsed)', ms(o.parsed)]);
      out.push(['First page drawn', ms(o.first)]);
    }
    out.push(['Pages', String(p.pages || 0) + ' · ' + (p.drawnNow || 0) + ' drawn now · ' +
      (p.thumbsNow || 0) + ' thumbnails']);
    Object.keys(p.drawn || {}).forEach(function (k) {
      const d = p.drawn[k];
      out.push(['Drawn by ' + k, d[0] + ' × ' + ms(d[1] / d[0]) + ' · ' +
        (d[2] ? Math.round(d[1] / d[2]) : '–') + ' ms/MP']);
    });
    out.push(['PDF bytes held', mb(p.bytes) + ' in ' + (p.sources || 0) + ' file(s)']);
    const m = performance.memory;
    out.push(['Page JS memory', m ? mb(m.usedJSHeapSize) + ' of ' + mb(m.jsHeapSizeLimit) : 'not reported here']);
    if (T) out.push(['App (native) memory', native ? mb(native.now) + ' · peak ' + mb(native.peak) : '–']);
    out.push(['Native drawing', p.native || 'off']);
    out.push(['Low-memory mode', p.lowMemory ? 'on' : 'off']);
    return out;
  }

  function paint() {
    const done = function (native) {
      const rows = lines(native);
      box.querySelector('.pfrows').innerHTML = rows.map(function (r) {
        return '<div><span>' + X.esc(r[0]) + '</span><b>' + X.esc(r[1]) + '</b></div>';
      }).join('');
      box.dataset.text = rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
    };
    if (T && T.core) T.core.invoke('perf_native').then(done, function () { done(null); });
    else done(null);
  }

  function toggle() {
    if (!box) {
      box = document.createElement('div');
      box.className = 'perfbox'; box.id = 'perfBox'; box.hidden = true;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Performance');
      box.innerHTML = '<header><b>Performance</b><span class="grow"></span>' +
        '<button type="button" class="btn" id="perfCopy">Copy</button>' +
        '<button type="button" class="x" id="perfX" aria-label="Close">&times;</button></header>' +
        '<div class="pfrows"></div>';
      document.body.appendChild(box);
      box.querySelector('#perfX').addEventListener('click', toggle);
      box.querySelector('#perfCopy').addEventListener('click', function () {
        navigator.clipboard.writeText(box.dataset.text || '').then(function () { X.toast('Copied'); }, function () {});
      });
    }
    box.hidden = !box.hidden;
    clearInterval(timer);
    if (!box.hidden) { paint(); timer = setInterval(paint, 1000); }
  }
  X.perfPanel = toggle;

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      toggle();
    }
  });
})();
