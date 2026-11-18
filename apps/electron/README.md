# Add Dots PDF in Electron

The web app (`apps/web/dist`) in an Electron window, for Windows, macOS and
Linux. It sits beside the Tauri app (`apps/desktop`) while the two are
compared; the web app runs unchanged in both.

## Commands

Run from the repo root (or drop `-w @adddots/electron` inside `apps/electron`).

```bash
npm ci                                          # once
npm run electron:dev -w @adddots/electron       # the app over Vite, with reload
npm run electron:start -w @adddots/electron     # the app over a fresh apps/web/dist build
npm run electron:build -w @adddots/electron     # Windows installer (NSIS)
npm run electron:build:mac -w @adddots/electron     # macOS .dmg and .zip (on a Mac)
npm run electron:build:linux -w @adddots/electron   # Linux AppImage and .deb (on Linux)
npm test -w @adddots/electron                   # the file rules, in plain Node
npm run e2e -w @adddots/electron                # end to end, over apps/web/dist
```

`electron:dev` builds the engine, starts Vite on port 5173 (or uses one
already running) and opens the app on it. Arguments after `--` go to the
app, so `npm run electron:dev -w @adddots/electron -- C:\path\file.pdf` opens
a PDF as a double-click in Explorer would. F12 opens DevTools (unpackaged
only).

The installers land in `apps/electron/release/`. Electron downloads its own
binary the first time it runs; nothing needs Rust.

## How it works

- `src/main.js` is the main process: the windows, the Save dialog, single
  instance, and the commands the page may ask for.
- `src/preload.js` is the page's only way to it. With context isolation on,
  Node off and the renderer sandboxed, it hands the page, through
  `contextBridge`, the small part of Tauri's global API that the web app
  already calls (`__TAURI__.core.invoke`, the window's controls and two
  events), plus `__TAURI__.adddots = { shell: 'electron', nativePrint: false }`
  for the few places that differ. So one build of the web app serves both
  desktop apps.
- Every command is checked by name in both processes, and only for the app's
  own page in one of its windows. The page can read only the files the
  system handed over, and never names a path to write to.
- `src/files.js` has the file rules (which arguments are PDFs, atomic saves,
  reading a big file a part at a time), apart from Electron so `test/` can
  test them in Node.
- The page is served from `app://adddots/` with the Tauri app's Content
  Security Policy; the page's inline scripts are allowed by their hashes.
  Navigation away from the app and new windows are refused; `https` links
  open in the system browser. The page gets no permissions but the
  clipboard and full screen.
- The packaged `.exe` has Electron's fuses flipped (`electron-builder.yml`):
  no running as plain Node, no `NODE_OPTIONS`, the app only from its asar,
  checked against a hash in the `.exe`.

## What it carries over from the Tauri app

| Tauri (`src-tauri`)                                                 | Electron                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| PDFs from Explorer, single instance (`launch_files`, `open-files`)  | the same; `requestSingleInstanceLock`, macOS `open-file`  |
| Explorer's "Combine files in Add Dots PDF" (`--combine`)            | the same (`build/installer.nsh`)                          |
| `read_file`, big files read a part at a time (`open_plan`, ...)     | the same, from `src/files.js`                             |
| Save with the system's Save dialog, written atomically              | the same                                                  |
| A tab moved to a window of its own (`new_window`)                   | the same                                                  |
| Frameless window, the page's top bar as title bar                   | the same; CSS drag region (`app.css` `shell-electron`)    |
| Always on top, minimise, maximise, close                            | the same                                                  |
| `.pdf` file association, PDF file icon, per-user NSIS installer     | the same, plus macOS (dmg, zip) and Linux (AppImage, deb) |
| The top bar's Add Dots links (`open_site`), version (`app_version`) | the same                                                  |

Not carried over (the web app falls back to what it does in a browser):

- **Pages drawn by PDFium** (`pdfium.rs`): pdf.js draws every page.
- **The app's own Print dialog** (`print.rs`: printers, paper, trays,
  booklet, poster): Print uses the system print dialog, as the website does.
- **Windows' own text reader** (`ocr.rs`): text recognition uses Tesseract.
- **Microsoft Store updates** (`store.rs`): this is not a Store package, so
  the update notice compares with the website, as the Tauri setup `.exe`
  does. There is no auto-updater yet (`electron-updater` needs a place to
  publish releases).
- **The MSIX package** (`apps/desktop/msix`).
- **The app's memory in the Performance panel** shows the main process only.

The installer is about 140 MB (Electron carries Chromium); the Tauri one is
about 10 MB, as it uses the WebView2 that Windows already has. Neither is
code-signed, so SmartScreen warns before running it.

## The end-to-end test (`e2e.mjs`)

The app started as Explorer starts it, driven by Playwright's Electron
support: a PDF opens and is drawn, the page has the bridge and no Node, its
policy is in force, it cannot read other files, a second start opens a tab
and quits, Save writes the file (`ADDDOTS_SAVE_TO` stands in for the Save
dialog), Explorer's Combine gathers files, and a tab moves to a new window.

```bash
npm run e2e -w @adddots/electron                                 # unpackaged
APP="release/win-unpacked/Add Dots PDF.exe" npm run e2e -w @adddots/electron
SAMPLE=path/to/file.pdf npm run e2e -w @adddots/electron         # start with this PDF
ADDDOTS_RANGE_MB=0 npm run e2e -w @adddots/electron              # every file read a part at a time
```

CI (`.github/workflows/ci.yml`, "Windows app (Electron)") builds the
installer, runs the test unpackaged, packaged and with every file read a part
at a time, and keeps the installer as an artifact.
