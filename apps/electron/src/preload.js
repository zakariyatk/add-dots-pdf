/* The page's only way to the desktop side, with context isolation on and
   Node off in the page.

   The web app (apps/web/public/js) was written against the Tauri app and
   reaches the desktop through a small part of Tauri's global API:
   `__TAURI__.core.invoke(command, args | bytes, { headers })`, the window's
   own controls (its top bar is the title bar) and two events. This gives
   the page that same part, so one build of the web app serves both desktop
   apps; nothing else of Electron or Node reaches the page.

   Every command goes to the main process by name (main.js COMMANDS), which
   checks the name, its arguments and who is asking. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* the commands main.js answers; anything else is refused here already */
const COMMANDS = new Set([
  'launch_files',
  'combine_files',
  'read_file',
  'open_plan',
  'read_range',
  'range_close',
  'save_file',
  'open_store',
  'open_site',
  'store_update',
  'app_version',
  'store_install',
  'new_window',
  'pdf_native_status',
  'pdf_open',
  'pdf_open_path',
  'pdf_trim',
  'pdf_close',
  'pdf_render',
  'pdf_cancel',
  'print_printers',
  'print_caps',
  'print_properties',
  'print_send',
  'ocr_status',
  'ocr_page',
  'perf_native',
]);
const EVENTS = new Set(['open-files', 'combine-files']);
const WINDOW = new Set(['minimize', 'toggleMaximize', 'close', 'setAlwaysOnTop', 'isMaximized']);

function plainHeaders(h) {
  const out = {};
  if (h && typeof h === 'object') {
    for (const k of Object.keys(h)) if (typeof h[k] === 'string') out[k.toLowerCase()] = h[k];
  }
  return out;
}

/* bytes back as an ArrayBuffer, as Tauri hands a raw response */
function unwrap(r) {
  if (!r || !r.ok) return Promise.reject(r ? r.error : 'no answer');
  const v = r.value;
  if (v instanceof Uint8Array) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  return v;
}

function invoke(cmd, args, opts) {
  if (!COMMANDS.has(cmd)) return Promise.reject('not a command of this app: ' + String(cmd));
  let payload;
  if (args instanceof ArrayBuffer) {
    payload = { body: new Uint8Array(args), headers: plainHeaders(opts && opts.headers) };
  } else if (ArrayBuffer.isView(args)) {
    payload = {
      body: new Uint8Array(args.buffer, args.byteOffset, args.byteLength),
      headers: plainHeaders(opts && opts.headers),
    };
  } else {
    payload = { args: args && typeof args === 'object' ? args : {} };
  }
  return ipcRenderer.invoke('adddots:invoke', cmd, payload).then(unwrap);
}

/* Tauri's listen(): resolves to a function that stops listening */
function listen(name, fn) {
  if (!EVENTS.has(name) || typeof fn !== 'function') return Promise.reject('not an event of this app');
  const handler = (_e, got, payload) => {
    if (got === name) fn({ event: name, payload });
  };
  ipcRenderer.on('adddots:event', handler);
  return Promise.resolve(() => ipcRenderer.removeListener('adddots:event', handler));
}

function windowCall(action, arg) {
  if (!WINDOW.has(action)) return Promise.reject('not a window action');
  return ipcRenderer.invoke('adddots:window', action, arg);
}

const currentWindow = {
  minimize: () => windowCall('minimize'),
  toggleMaximize: () => windowCall('toggleMaximize'),
  close: () => windowCall('close'),
  setAlwaysOnTop: (on) => windowCall('setAlwaysOnTop', !!on),
  isMaximized: () => windowCall('isMaximized'),
  onResized: (fn) => {
    if (typeof fn !== 'function') return Promise.resolve(() => {});
    const handler = () => fn();
    ipcRenderer.on('adddots:resized', handler);
    return Promise.resolve(() => ipcRenderer.removeListener('adddots:resized', handler));
  },
};

contextBridge.exposeInMainWorld('__TAURI__', {
  core: { invoke },
  event: { listen },
  window: { getCurrentWindow: () => currentWindow },
  webviewWindow: { getCurrentWebviewWindow: () => ({ listen }) },
  /* what this desktop app can and cannot do, for the few places that differ */
  adddots: { shell: 'electron', nativePrint: false },
});
