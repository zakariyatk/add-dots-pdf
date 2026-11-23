/* Add Dots PDF on the desktop, in Electron: the web app (apps/web/dist) in
   a window.

   What the desktop side adds to the web app:
   - PDFs handed over by the system: a double-click in Explorer (or Finder,
     or a file manager) starts the app with the file's path; a second start
     hands its paths to the first and quits (single instance). The page asks
     for them (`launch_files`) or hears of them (`open-files`), then reads
     each one (`read_file`). It can read only files handed over this way.
   - Explorer's "Combine files in Add Dots PDF" (build/installer.nsh):
     the same, with --combine, gathered into one document.
   - Saving: the page sends the bytes (`save_file`); this asks where with
     the system's Save dialog and writes the file whole or not at all.
   - A tab moved to a window of its own (`new_window`).
   - The window's own controls: it has no frame, its top bar is the title bar.

   Security: context isolation on, Node off, the renderer sandboxed. The page
   is served from app://adddots (a scheme of this app's own) with the same
   Content Security Policy (csp.json); it reaches this side only
   through preload.js, by command name, and every command checks what it is
   given here. Navigation away from the app and new windows are refused;
   https links open in the system browser. */
'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { Opened, safeName, writeAtomic } = require('./files');

const SCHEME = 'app';
const HOST = 'adddots';
const APP_ORIGIN = SCHEME + '://' + HOST;
const DEV_URL = !app.isPackaged ? process.env.ADDDOTS_DEV_URL || '' : '';
/* scheme and host: URL.origin is "null" for a scheme of the app's own */
function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.host;
  } catch {
    return '';
  }
}
const ORIGIN = DEV_URL ? originOf(DEV_URL) : APP_ORIGIN;
const WEB_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '..', '..', 'web', 'dist');
const ICON = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

/* The Add Dots pages the top bar opens in the browser (js/appbar.js), by
   name: the page cannot hand this any other address to open. */
const SITES = {
  about: 'https://www.adddots.com/about.html',
  privacy: 'https://pdf.adddots.com/privacy.html',
  opbuilder: 'https://opbuilder.adddots.com/',
  call: 'https://call.adddots.com/',
};
const STORE_PAGE = 'ms-windows-store://pdp/?productid=9PGHPBRMLQMS';

const opened = new Opened();
let lastWindow = null;
let saveDir = null;

/* ---------------- one app, however many times it is started ---------------- */

/* the end-to-end test runs in a profile of its own, apart from any copy of
   the app already open (the single-instance lock goes with the profile) */
if (process.env.ADDDOTS_USER_DATA) app.setPath('userData', process.env.ADDDOTS_USER_DATA);

if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() })) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd, extra) => {
    /* the second start's own arguments, as it had them: Chromium may change
       the ones it passes here */
    const a = extra && Array.isArray(extra.argv) ? extra.argv : argv;
    const c = extra && typeof extra.cwd === 'string' ? extra.cwd : cwd;
    deliver(opened.handOver(a, c));
  });
}

/* macOS hands files over as events, not arguments, and may do so before ready */
app.on('open-file', (e, file) => {
  e.preventDefault();
  deliver(opened.handOver(['', file], path.dirname(file)));
});

function deliver({ files, combine }) {
  const w = targetWindow();
  if (!w) return; /* kept until the first window's page asks */
  if (w.isMinimized()) w.restore();
  w.focus();
  if (files.length) w.webContents.send('adddots:event', combine ? 'combine-files' : 'open-files', files);
}

function targetWindow() {
  if (lastWindow && !lastWindow.isDestroyed()) return lastWindow;
  return BrowserWindow.getAllWindows()[0] || null;
}

/* ---------------- the page, from app://adddots ---------------- */

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.traineddata': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/* The window's policy (csp.json, which the web app's smoke test also runs
   every page under: apps/web/vite.config.ts ADDDOTS_CSP), with the page's
   inline scripts allowed by their hashes. */
const CSP = require('./csp.json');
function csp(html) {
  const hashes = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] && /\ssrc\s*=/.test(m[1])) continue;
    hashes.push("'sha256-" + crypto.createHash('sha256').update(m[2], 'utf8').digest('base64') + "'");
  }
  return (
    Object.entries(CSP)
      /* the app's own origin too, for the update check's sandboxed frame
       (latest-frame.html), where 'self' matches nothing */
      .map(([k, v]) => k + ' ' + (k === 'script-src' ? [v, APP_ORIGIN, ...hashes].join(' ') : v))
      .join('; ')
  );
}

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep))
    return new Response('not found', { status: 404 });
  let body;
  try {
    body = await fs.promises.readFile(file);
  } catch {
    return new Response('not found', { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  };
  if (ext === '.html') headers['content-security-policy'] = csp(body.toString('utf8'));
  return new Response(body, { status: 200, headers });
}

/* ---------------- windows ---------------- */

function pageUrl(query) {
  const base = DEV_URL ? DEV_URL.replace(/\/?$/, '/') : APP_ORIGIN + '/';
  return base + 'index.html' + (query || '');
}

function createWindow(opts) {
  const o = opts || {};
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    x: o.x,
    y: o.y,
    center: o.x === undefined,
    frame: false,
    show: false,
    title: 'Add Dots PDF',
    icon: ICON,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      /* Chromium's PDF viewer, for the system print dialog (core.js printFrame) */
      plugins: true,
    },
  });
  if (!lastWindow) lastWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => {
    lastWindow = win;
  });
  win.on('closed', () => {
    if (lastWindow === win) lastWindow = null;
  });
  const resized = () => {
    if (!win.isDestroyed()) win.webContents.send('adddots:resized');
  };
  win.on('maximize', resized);
  win.on('unmaximize', resized);
  win.on('resize', resized);
  if (!app.isPackaged) {
    /* development only: F12 opens DevTools, and Ctrl+R or F5 reloads the
       page from disk. The window has no menu, which is what gives Electron's
       usual reload shortcut, so it is wired here. */
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12') win.webContents.toggleDevTools();
      else if (
        input.key === 'F5' ||
        ((input.control || input.meta) && !input.alt && input.key.toLowerCase() === 'r')
      ) {
        e.preventDefault();
        win.webContents.reloadIgnoringCache();
      }
    });
  }
  win.loadURL(pageUrl(o.query));
  return win;
}

/* Only the app's own pages, in its own windows. */
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.on('will-navigate', (e, url) => {
    if (originOf(url) === ORIGIN) return;
    e.preventDefault();
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  });
  /* the page asks before unsaved work is lost (beforeunload); Electron
     would keep the window open without a word, so ask as a browser does */
  contents.on('will-prevent-unload', (e) => {
    const win = BrowserWindow.fromWebContents(contents);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Add Dots PDF',
      message: 'Close without saving?',
      detail: 'Changes you have not saved will be lost.',
    });
    if (choice === 0) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

/* ---------------- what the page may ask for ---------------- */

function header(headers, k) {
  const v = headers && headers[k];
  if (typeof v !== 'string') return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function num(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('no ' + name);
  return Math.floor(v);
}

const COMMANDS = {
  launch_files: () => opened.take('pending'),
  combine_files: () => opened.take('combine'),
  read_file: ({ args }) => fs.promises.readFile(opened.check(args.path)),
  open_plan: ({ args }) => opened.openPlan(args.path, args.keep === true),
  read_range: ({ args }) =>
    opened.range(num(args.id, 'id'), num(args.offset, 'offset'), Math.min(num(args.len, 'len'), 0xffffffff)),
  range_close: ({ args }) => {
    opened.closeRange(num(args.id, 'id'));
    return null;
  },

  save_file: async ({ body, headers }, win) => {
    if (!body) throw new Error("expected the file's bytes");
    const name = safeName(header(headers, 'x-name') || 'document.pdf');
    let file;
    if (process.env.ADDDOTS_SAVE_TO) {
      file = path.join(process.env.ADDDOTS_SAVE_TO, name);
    } else {
      const ext = path.extname(name).slice(1);
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(saveDir || app.getPath('documents'), name),
        filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
      });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    writeAtomic(file, body);
    saveDir = path.dirname(file);
    return file;
  },

  new_window: ({ args }) => {
    const h = args.handoff;
    if (typeof h !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(h)) throw new Error('not a document to move');
    const o = { query: '?handoff=' + h };
    if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
      /* the pointer over the new window's top bar, a little in from its left */
      o.x = Math.max(0, Math.round(args.x - 160));
      o.y = Math.max(0, Math.round(args.y - 16));
    }
    createWindow(o);
    return null;
  },

  open_site: ({ args }) => {
    const url = Object.prototype.hasOwnProperty.call(SITES, args.name) ? SITES[args.name] : null;
    if (!url) throw new Error('not a page this app opens');
    return shell.openExternal(url).then(() => null);
  },
  open_store: () => {
    if (process.platform !== 'win32') throw new Error('the Microsoft Store is on Windows only');
    return shell.openExternal(STORE_PAGE).then(() => null);
  },
  /* the Store package's version is package.json's, 1.0.N (CI sets N) */
  app_version: () => app.getVersion(),
  /* The Microsoft Store package (process.windowsStore) is updated by the
     Store itself: no update notice in the app (false, js/update.js). The
     setup .exe is not a Store install (null): it compares with the website
     and points to the Store page. */
  store_update: () => (process.windowsStore ? false : null),

  perf_native: () => ({ now: process.memoryUsage().rss, peak: process.resourceUsage().maxRSS * 1024 }),

  /* the app's Print dialog (apps/web/public/js/printdlg.js): this computer's
     printers, and a job's sheets printed on the one chosen */
  printers: async (_req, win) => {
    const list = await win.webContents.getPrintersAsync();
    return list.map((p) => ({
      name: String(p.name),
      displayName: String(p.displayName || p.name),
      isDefault: !!p.isDefault,
    }));
  },
  print_pages: ({ args }) => printPages(args),
  /* Properties, beside the printer: the printer's own settings, from its
     driver (trays, quality, stapling, finishing). On Windows that is the
     printer's Printing Preferences, which the job then prints with; on
     macOS and Linux the system's printer settings. Answers once it is
     closed, so the dialog can read the printers again. */
  printer_properties: async ({ args }, win) => {
    const name = typeof args.printer === 'string' ? args.printer : '';
    const list = await win.webContents.getPrintersAsync();
    const known = list.find((p) => p.name === name) || list.find((p) => p.isDefault) || list[0];
    if (!known) throw new Error('no printer found');
    return printerProperties(String(known.name));
  },
};

function run(file, argv) {
  return new Promise((resolve, reject) => {
    execFile(file, argv, { windowsHide: false }, (e) => (e && e.code === 'ENOENT' ? reject(e) : resolve()));
  });
}
async function printerProperties(name) {
  if (process.platform === 'win32') {
    /* printui's own way to a printer's Printing Preferences: /e, by its name (/n) */
    const rundll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
    await run(rundll, ['printui.dll,PrintUIEntry', '/e', '/n', name]);
    return { shown: 'preferences', printer: name };
  }
  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.Print-Scanner-Settings.extension');
    return { shown: 'settings', printer: name };
  }
  try {
    await run('system-config-printer', []);
  } catch {
    await shell.openExternal('http://localhost:631/printers/' + encodeURIComponent(name));
  }
  return { shown: 'settings', printer: name };
}

/* Each sheet comes as a PNG, at the sheet's own size; they go on the paper
   edge to edge in a hidden window of their own, which prints them, silently
   on the printer named (the system's default when none is). With
   ADDDOTS_PRINT_TO set (the end-to-end test) the job is written there as a
   PDF instead of printed. */
const PAPER_NAME = { a3: 'A3', a4: 'A4', a5: 'A5', letter: 'Letter', legal: 'Legal', tabloid: 'Tabloid' };
async function printPages(args) {
  const pages = Array.isArray(args.pages) ? args.pages : [];
  if (!pages.length || pages.length > 5000) throw new Error('nothing to print');
  if (
    !pages.every(
      (p) => p instanceof Uint8Array && p.length > 8 && p[1] === 0x50 && p[2] === 0x4e && p[3] === 0x47,
    )
  ) {
    throw new Error('the sheets are not pictures');
  }
  const w = Number(args.w),
    h = Number(args.h);
  if (!(w > 10 && w < 20000 && h > 10 && h < 20000)) throw new Error('no sheet size');
  const copies = Math.max(1, Math.min(999, Math.floor(Number(args.copies) || 1)));
  const printer = typeof args.printer === 'string' ? args.printer.slice(0, 300) : '';
  const landscape = w > h;
  const duplexMode = ['simplex', 'longEdge', 'shortEdge'].includes(args.duplex) ? args.duplex : 'simplex';
  const collate = args.collate !== false;
  const dialog = args.dialog === true;
  const dir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'adddots-print-'));
  let pw = null;
  try {
    const imgs = [];
    for (let i = 0; i < pages.length; i++) {
      await fs.promises.writeFile(path.join(dir, 'p' + i + '.png'), pages[i]);
      imgs.push('<img src="p' + i + '.png">');
    }
    const html =
      '<!doctype html><meta charset="utf-8"><style>' +
      '@page{size:' +
      w +
      'pt ' +
      h +
      'pt;margin:0}html,body{margin:0;padding:0;background:#fff}' +
      'img{display:block;width:' +
      w +
      'pt;height:' +
      h +
      'pt;break-after:page}img:last-child{break-after:auto}' +
      '</style>' +
      imgs.join('');
    const file = path.join(dir, 'job.html');
    await fs.promises.writeFile(file, html);
    pw = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
    });
    await pw.loadFile(file);
    const micron = (pt) => Math.round((pt / 72) * 25400);
    const named = PAPER_NAME[args.paper];
    const pageSize = named || { width: micron(Math.min(w, h)), height: micron(Math.max(w, h)) };
    if (process.env.ADDDOTS_PRINT_TO) {
      const pdf = await pw.webContents.printToPDF({
        landscape,
        pageSize,
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      writeAtomic(path.join(process.env.ADDDOTS_PRINT_TO, 'printed.pdf'), pdf);
      return { printed: pages.length, copies, printer, color: args.color !== false, duplexMode, collate };
    }
    const how = await new Promise((resolve, reject) => {
      pw.webContents.print(
        {
          /* the system's own print dialog when asked for (Advanced), with
             everything the driver offers; straight to the printer otherwise */
          silent: !dialog,
          printBackground: true,
          deviceName: printer || undefined,
          copies,
          collate,
          duplexMode,
          color: args.color !== false,
          landscape,
          pageSize,
          margins: { marginType: 'none' },
        },
        (ok, why) =>
          ok
            ? resolve()
            : dialog && /cancel/i.test(why || '')
              ? resolve('cancelled')
              : reject(new Error(why || 'not printed')),
      );
    });
    return how === 'cancelled' ? { printed: 0, cancelled: true } : { printed: pages.length, copies };
  } finally {
    if (pw && !pw.isDestroyed()) pw.destroy();
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* asked by the app's own page, in one of its windows */
function fromApp(e) {
  const f = e.senderFrame;
  return !!f && originOf(f.url) === ORIGIN && !!BrowserWindow.fromWebContents(e.sender);
}

ipcMain.handle('adddots:invoke', async (e, cmd, payload) => {
  if (!fromApp(e)) return { ok: false, error: 'not this app' };
  const fn = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!fn) return { ok: false, error: 'not a command of this app' };
  const p = payload && typeof payload === 'object' ? payload : {};
  const req = {
    args: p.args && typeof p.args === 'object' ? p.args : {},
    body:
      p.body instanceof Uint8Array ? Buffer.from(p.body.buffer, p.body.byteOffset, p.body.byteLength) : null,
    headers: p.headers && typeof p.headers === 'object' ? p.headers : {},
  };
  try {
    const value = await fn(req, BrowserWindow.fromWebContents(e.sender));
    return { ok: true, value: value === undefined ? null : value };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('adddots:window', (e, action, arg) => {
  if (!fromApp(e)) return null;
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return null;
  switch (action) {
    case 'minimize':
      win.minimize();
      return null;
    case 'toggleMaximize':
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return null;
    case 'close':
      win.close();
      return null;
    case 'setAlwaysOnTop':
      win.setAlwaysOnTop(arg === true);
      return null;
    case 'isMaximized':
      return win.isMaximized();
    default:
      return null;
  }
});

/* ---------------- start ---------------- */

app.whenReady().then(() => {
  /* the files first: the page asks for them as soon as it loads */
  opened.handOver(process.argv, process.cwd());

  protocol.handle(SCHEME, serve);

  /* the page asks for nothing but the clipboard and full screen */
  const ALLOWED = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));

  /* no menu bar: the page's top bar is the window's; on macOS the usual
     app menu, for Quit and the edit shortcuts */
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  );

  createWindow();

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
