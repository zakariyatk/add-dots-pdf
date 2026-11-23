# Add Dots PDF for the desktop (Electron)

**In the Microsoft Store:** https://apps.microsoft.com/detail/9PGHPBRMLQMS.
That is the way to install it on Windows: the Store signs the app, so there
is no SmartScreen warning, and it updates itself. The setup `.exe` is for
testing.

The web app (`apps/web/dist`) in an Electron window, for Windows (setup
`.exe` and the Microsoft Store), macOS and Linux. The web app runs unchanged;
`apps/web/public/js/desktop.js` is its side of the bridge and does nothing
in a browser.

## Commands

Run from the repo root (or drop `-w @adddots/electron` inside `apps/electron`).

```bash
npm ci                                                 # once
npm run electron:dev -w @adddots/electron              # the app over Vite, with reload
npm run electron:start -w @adddots/electron            # the app over a fresh apps/web/dist build
npm run electron:build -w @adddots/electron            # Windows setup .exe (NSIS)
npm run electron:build:store -w @adddots/electron      # Microsoft Store package (.msix)
npm run electron:build:mac -w @adddots/electron        # macOS .dmg and .zip (on a Mac)
npm run electron:build:linux -w @adddots/electron      # Linux AppImage and .deb (on Linux)
npm test -w @adddots/electron                          # the file and update rules, in plain Node
npm run e2e -w @adddots/electron                       # end to end, over apps/web/dist
```

`electron:dev` builds the engine, starts Vite on port 5173 (or uses one
already running) and opens the app on it. Arguments after `--` go to the
app, so `npm run electron:dev -w @adddots/electron -- C:\path\file.pdf` opens
a PDF as a double-click in Explorer would. Saving any file in
`apps/web/public` or `packages/engine` reloads the window by itself. F12
opens DevTools and Ctrl+R or F5 reloads (unpackaged only).

`electron:start` runs the built copy (`apps/web/dist`) instead: it never
reloads, and shows a change only after it is built again.

Everything lands in `apps/electron/release/`. Electron downloads its own
binary the first time it runs.

## How it works

- `src/main.js` is the main process: the windows, the Save dialog, single
  instance, and the commands the page may ask for.
- `src/preload.js` is the page's only way to it. With context isolation on,
  Node off and the renderer sandboxed, it hands the page, through
  `contextBridge`, one object, `window.ADDDOTS_HOST`: `core.invoke` for an
  allow-listed set of commands, the window's controls and two events. A
  document tab (a frame) reaches it through its window.
- Every command is checked by name in both processes, and only for the app's
  own page in one of its windows. The page can read only the files the
  system handed over, and never names a path to write to.
- `src/files.js` has the file rules (which arguments are PDFs, atomic saves,
  reading a big file a part at a time), apart from Electron so `test/` can
  test them in Node.
- The page is served from `app://adddots/` with the policy in `src/csp.json`
  (the web app's smoke test runs every page under it too: `ADDDOTS_CSP=1`);
  the page's inline scripts are allowed by their hashes. Navigation away
  from the app and new windows are refused; `https` links open in the system
  browser. The page gets no permissions but the clipboard and full screen.
- The packaged `.exe` has Electron's fuses flipped (`electron-builder.yml`):
  no running as plain Node, no `NODE_OPTIONS`, the app only from its asar,
  checked against a hash in the `.exe`.

What it does:

- **PDFs from Explorer.** A double-click starts the app with the file's path;
  a second start hands its paths to the open window and quits (single
  instance). On macOS, Finder's `open-file`. A PDF handed over with one open
  gets a tab of its own (`js/tabs.js`).
- **Combine files in Add Dots PDF...** on PDFs picked in Explorer (setup:
  `build/installer.nsh`; Store: `build/AppxManifest.xml`): one start per
  file, with `--combine`, gathered into one list to combine.
- **Big files** (over 150 MB, or `ADDDOTS_RANGE_MB`) are read a part at a
  time from the file as it was opened, not whole.
- **Saving** with the system's Save dialog, written whole or not at all.
- **A tab moved to a window of its own** (drag it out of the tab bar, or
  right-click it).
- **The window** has no frame: the page's top bar is the title bar (a CSS
  drag region), with minimise, maximise, close and always on top. Closing a
  window with unsaved changes asks first.
- **Pages** are drawn by pdf.js, **printing** goes through the system print
  dialog and **text recognition** uses Tesseract, as on the website.

## The Microsoft Store package

`npm run electron:build:store` makes `release/ADD-DOTS-PDF-<version>.0.msix`
with electron-builder's `appx` target. The manifest is
`build/AppxManifest.xml`, with the product's Store identity from Partner
Center (Product management > Product identity), which must match exactly:

| Field                | Value                                     |
| -------------------- | ----------------------------------------- |
| Identity Name        | `ADDDOTS.ADDDOTSPDF`                      |
| Publisher            | `CN=B4571263-B820-4F66-B107-5B0CC5616541` |
| PublisherDisplayName | `ADD DOTS`                                |
| Store ID             | `9PGHPBRMLQMS`                            |

The tile and logo images are `build/appx/` (made by `scripts/icons.mjs`).
The version is `package.json`'s as `1.0.N.0`; CI sets N to its run number,
which only grows, as the Store wants each package newer than the last. The
package is not signed: the Store signs it on upload.

In the Store package the Store updates the app in the background, but not
while it is open, nor where the user has turned updates off. So the app asks
the Store's public catalog (`displaycatalog.mp.microsoft.com`, at most once an
hour, `src/updates.js`) which version it now offers. When that is newer than
`package.json`'s, `store_update` answers true: the bell lights up and a notice
in the corner offers **Update now** (this app's page in the Store) or **Later**
(not again for a day). The setup `.exe` compares its build with the website's
the same way and points to the Store page.

CI ("Windows app (Electron)") builds the `.msix`, installs it signed with a
throwaway certificate for the same Publisher, starts it from its Start menu
entry, removes it, and keeps it as the `windows-store-msix` artifact. The
**Microsoft Store** workflow (`.github/workflows/store.yml`) uploads that
artifact to Partner Center and submits it: Actions > Microsoft Store > Run
workflow (or by itself after CI on `main`, while the repository variable
`STORE_AUTO_SUBMIT` is true). Its secrets are listed at the top of that file.

## The end-to-end test (`e2e.mjs`)

The app started as Explorer starts it, driven by Playwright's Electron
support, in a profile of its own (`ADDDOTS_USER_DATA`): a PDF opens and is
drawn, the page has the bridge and no Node, its policy is in force and the
update check still answers, it cannot read other files, Print opens the PDF
viewer, a second start opens a tab and quits, Save writes the file
(`ADDDOTS_SAVE_TO` stands in for the Save dialog), Explorer's Combine gathers
files, and a tab moves to a new window.

```bash
npm run e2e -w @adddots/electron                                 # unpackaged
APP="release/win-unpacked/Add Dots PDF.exe" npm run e2e -w @adddots/electron
SAMPLE=path/to/file.pdf npm run e2e -w @adddots/electron         # start with this PDF
ADDDOTS_RANGE_MB=0 npm run e2e -w @adddots/electron              # every file read a part at a time
```
