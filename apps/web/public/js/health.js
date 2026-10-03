/* The app's health, kept in this browser only.

   Errors the page and its workers run into (an uncaught error, a promise
   left rejected, a script that did not load, a worker that failed, anything
   logged with console.error) are kept here, the last 50, so that someone
   reporting a problem can copy them into the report ("Copy diagnostics" on
   the home screen). Nothing is sent anywhere. What is kept is the error's
   message and where it came from: never a document's text or marks, and a
   file's name is replaced by <file>.

   Loaded first, before pdf.js and core.js, so that errors while starting
   are caught too. core.js reports the workers' failures through log(). */
(function () {
  'use strict';
  const KEY = 'adpdf.errors';
  const MAX = 50;
  const started = Date.now();

  function read() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* private window: this session only */ }
  }

  /* a file's name is the reader's business: keep its kind, not its name */
  function scrub(s) {
    return String(s == null ? '' : s)
      .replace(/blob:[^\s)'"]+/g, 'blob:')
      .replace(/[^\s/\\'"():]+\.(pdf|png|jpe?g|gif|webp|heic|mp4|mov|docx?|xlsx?)\b/gi, '<file>.$1');
  }

  let last = '', lastAt = 0;
  const session = [];
  function log(where, message, stack) {
    const msg = scrub(message || 'unknown error').slice(0, 300);
    const now = Date.now();
    /* the same error again straight away (a loop, a frame handler) is one entry */
    if (msg === last && now - lastAt < 2000) return;
    last = msg; lastAt = now;
    const entry = { t: now, where: String(where || 'page'), msg: msg, stack: scrub(stack || '').slice(0, 800) };
    session.push(entry);
    const list = read();
    list.push(entry);
    write(list);
  }

  window.addEventListener('error', function (e) {
    const t = e.target;
    if (t && t !== window && t.tagName) {
      /* a load that may fail and says so itself (the update check, offline) */
      if (t.dataset && t.dataset.quiet !== undefined) return;
      /* a script, stylesheet or picture that did not load */
      const src = t.src || t.href || '';
      log('load', t.tagName.toLowerCase() + ' did not load: ' + src.replace(/^.*\//, ''));
      return;
    }
    log('page', e.message || (e.error && e.error.message), e.error && e.error.stack);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    const r = e.reason;
    log('page (promise)', r && r.message ? r.message : r, r && r.stack);
  });
  const consoleError = console.error;
  console.error = function () {
    try {
      const args = Array.prototype.slice.call(arguments);
      const err = args.filter(function (a) { return a && a.stack; })[0];
      log('console', args.map(function (a) { return a && a.message ? a.message : String(a); }).join(' '), err && err.stack);
    } catch (e) { /* never let the log break the page */ }
    return consoleError.apply(console, arguments);
  };

  /* what a report needs besides the errors: the browser and the machine,
     how the app is running, and how much memory it holds */
  function diagnostics(extra) {
    const n = navigator, m = performance.memory;
    const lines = [
      'ADD DOTS PDF diagnostics, ' + new Date().toISOString(),
      'Browser: ' + n.userAgent,
      'Screen: ' + screen.width + 'x' + screen.height + ' at ' + (window.devicePixelRatio || 1) + 'x, window ' +
        innerWidth + 'x' + innerHeight,
      'Device: ' + (n.deviceMemory ? n.deviceMemory + ' GB memory, ' : '') + (n.hardwareConcurrency || '?') + ' cores' +
        (n.onLine === false ? ', offline' : ''),
      m ? 'JS memory: ' + Math.round(m.usedJSHeapSize / 1048576) + ' MB used of ' +
        Math.round(m.jsHeapSizeLimit / 1048576) + ' MB' : 'JS memory: not reported by this browser',
      'Running for: ' + Math.round((Date.now() - started) / 1000) + ' s'
    ];
    if (extra) Object.keys(extra).forEach(function (k) { lines.push(k + ': ' + extra[k]); });
    const list = read();
    lines.push('', 'Errors (' + list.length + ', last ' + MAX + ' kept):');
    if (!list.length) lines.push('  none');
    list.forEach(function (e) {
      lines.push('  ' + new Date(e.t).toISOString() + ' [' + e.where + '] ' + e.msg);
      if (e.stack) lines.push('    ' + e.stack.split('\n').slice(0, 4).join('\n    '));
    });
    return lines.join('\n');
  }

  window.ADDPDF_HEALTH = {
    log: log,
    errors: read,
    session: function () { return session.slice(); },
    clear: function () { write([]); session.length = 0; },
    diagnostics: diagnostics
  };
})();
