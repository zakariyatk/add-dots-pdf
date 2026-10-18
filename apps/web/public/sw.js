/* ADD DOTS — PDF Editor service worker.

   The app runs from a cache, so it opens instantly and works with no connection
   at all. The moment there is a connection it checks what it is holding against
   the server, and when anything has changed it pulls the new copy down and tells
   the page, which puts it on screen by itself. Nobody has to clear anything, and
   there is no version to bump on a deploy.

   How the two halves fit together:

     • every file is answered from the cache first and revalidated behind the
       reader's back — the copy they already had is what they see for that load;
     • "changed" means the server's ETag or Last-Modified differs from the one
       stored with the cached copy, so a check costs a conditional request and a
       304, not a download;
     • when something did change, the worker messages every open window. The page
       reloads itself if the editor is idle, and only offers the reload if a
       document is open — see js/pwa.js. That is why the new version arrives
       without anyone asking for it, and why it never interrupts an edit;
     • a window left open for days is not fetching anything, so the page asks for
       a check when it comes back to the front, and every half hour;
     • anything under api/ is never touched. Share links, uploads and the live
       review comments always go straight to the server.

   Paths are relative so the app works from a subfolder (adddots.com/pdfreader/)
   exactly as it does from a domain root. */

const VERSION = 'v42';
const CACHE = 'adpdf-' + VERSION;

/* Everything the app is made of. The pdf.js worker is in here too — without it
   an offline launch would open to a blank stage. */
const SHELL = [
  './',
  'manifest.webmanifest',
  'css/app.css',
  'css/pro.css',
  'css/light.css',
  'css/wps.css',
  'js/engine.js',
  'js/fonts-list.js',
  'js/fonts.js',
  'js/core.js',
  'js/navigate.js',
  'js/annotate.js',
  'js/draw.js',
  'js/organize.js',
  'js/forms.js',
  'js/insert.js',
  'js/enhance.js',
  'js/docops.js',
  'js/convert.js',
  'js/ocr.js',
  'js/editobj.js',
  'js/pagemenu.js',
  'js/tabs.js',
  'js/skin.js',
  'js/books.js',
  'js/toolprops.js',
  'js/toolbar.js',
  'js/appbar.js',
  'js/winonly.js',
  'js/perf.js',
  'js/pwa.js',
  'js/build.js',
  'js/update.js',
  'js/desktop.js',
  'js/mobile.js',
  'js/config.js',
  'js/vendor/supabase.js',
  /* shown in the account dialog, offline too */
  'privacy.html',
  /* draws the pages, off the main thread (see core.js) */
  'js/health.js',
  'js/render-worker.js',
  'js/save-worker.js',
  'js/vendor/pdf.min.js',
  'js/vendor/pdf.worker.min.js',
  'js/vendor/pdf-lib.min.js',
  /* loaded on the first save that needs the Unicode font (see core.js) */
  'js/vendor/fontkit.umd.min.js',
  'assets/fonts/DejaVuSans.ttf',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon-180.png'
];

/* What a timed check looks at: the markup, the styles and the code. The vendored
   libraries and the icons are left out because they are big, they change about
   once a year, and an ordinary load revalidates them anyway. */
const WATCHED = SHELL.filter(function (u) {
  return u.indexOf('js/vendor/') !== 0 && u.indexOf('assets/') !== 0;
});

const HOME = new URL('./', self.location.href).href;

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    /* one at a time, so a single missing file cannot fail the whole install */
    return Promise.all(SHELL.map(function (u) {
      return c.add(new Request(u, { cache: 'reload' })).catch(function (err) {
        console.warn('[sw] skipped ' + u, err);
      });
    }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return k !== CACHE && k.indexOf('adpdf-') === 0 ? caches.delete(k) : null;
    }));
  }).then(function () { return self.clients.claim(); }));
});

/* ---------- telling the page ---------- */

let notifyTimer = null;

function announce() {
  /* One message per burst. A deploy that changed six files should cost the page
     one reload, not six. */
  if (notifyTimer) return;
  notifyTimer = setTimeout(function () {
    notifyTimer = null;
    self.clients.matchAll({ type: 'window' }).then(function (list) {
      list.forEach(function (c) { c.postMessage({ type: 'adpdf-update' }); });
    });
  }, 2500);
}

/* ---------- is the server holding a different copy? ---------- */

function changed(cached, fresh) {
  const a = cached.headers.get('ETag'), b = fresh.headers.get('ETag');
  if (a && b) return a !== b;
  const c = cached.headers.get('Last-Modified'), d = fresh.headers.get('Last-Modified');
  if (c && d) return c !== d;
  /* No validators at all: refresh the cache but say nothing. A guess here would
     reload the page on every single load. Apache sends both for static files. */
  return false;
}

function ask(url) {
  /* Skip the browser's own HTTP cache: its heuristic freshness window is the
     usual reason a deploy looks like it has not landed. */
  return fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' }));
}

function store(url, res) {
  return caches.open(CACHE).then(function (c) { return c.put(url, res); });
}

/* Resolves true when the server turned out to be holding a newer copy. */
function revalidate(url, cached) {
  return ask(url).then(function (res) {
    if (!res || !res.ok || res.type !== 'basic') return false;
    const isNew = !!cached && changed(cached, res);
    return store(url, res.clone()).then(function () { return isNew; });
  }).catch(function () { return false; });          /* offline: nothing to do */
}

/* ---------- answering the page ---------- */

function offline() {
  return new Response('This file is not available offline.', {
    status: 503, headers: { 'Content-Type': 'text/plain' }
  });
}

function cacheFirst(e, url) {
  return caches.match(url).then(function (hit) {
    if (hit) {
      e.waitUntil(revalidate(url, hit).then(function (isNew) {
        if (isNew) announce();
      }));
      return hit;
    }
    /* first run, or a file that is not part of the shell */
    return ask(url).then(function (res) {
      if (res && res.ok && res.type === 'basic') store(url, res.clone());
      return res;
    }).catch(offline);
  });
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          /* nothing of ours */

  const scope = new URL('./', self.location.href).pathname;
  if (url.pathname.indexOf(scope) !== 0) return;            /* the rest of adddots.com */

  const path = url.pathname.slice(scope.length);
  if (path.indexOf('api/') === 0) return;                   /* shares and comments: live only */
  if (path === 'latest.js') return;                         /* which build the site has: always asked */

  /* A review link carries ?t=… — the same document with a different query, so
     every navigation is answered with the home document. */
  e.respondWith(cacheFirst(e, req.mode === 'navigate' ? HOME : req.url));
});

/* ---------- the check the page asks for ---------- */

self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'adpdf-check') return;
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(WATCHED.map(function (u) {
        const url = new URL(u, self.location.href).href;
        return c.match(url).then(function (hit) { return revalidate(url, hit); });
      }));
    }).then(function (results) {
      /* every file settles before anyone is told, so the reload that follows
         picks up a whole deploy rather than half of one */
      if (results.some(Boolean)) announce();
    })
  );
});
