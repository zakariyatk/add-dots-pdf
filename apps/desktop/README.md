# ADD DOTS PDF for Windows

The web app (`apps/web/dist`) in a Tauri 2 window. On Windows the window is
Edge WebView2, which is Chromium, the engine the web app's smoke test runs in.
The installer is about 10 MB and puts the app in the Start menu, opening PDFs
from Explorer.

## What the desktop side adds

The web app runs unchanged. `src-tauri/src/lib.rs` adds only what a browser
tab cannot do; `apps/web/public/js/desktop.js` is its other half and does
nothing outside the app.

- **PDFs from Explorer.** A double-click starts the app with the file's path.
  If the app is already open, the second start hands its paths to the open
  window and quits (single instance). The page asks for the paths
  (`launch_files`) or is told of them (`open-files`), then reads each one
  (`read_file`). It can read only the files handed over this way, never any
  other path.
- **Saving.** Save sends the file's bytes to `save_file`, which asks where with
  the Windows Save dialog and writes the file there. Cancelling it leaves the
  document unsaved: the Save popover stays open and crash recovery keeps the
  work.
- **No service worker.** The installer carries every file, and a new version
  comes as a new installer, so there is no offline copy to keep and no
  install offer.

Not in the desktop app yet: share links (they need the web server's API), and
updates from inside the app.

## Commands

```bash
npm ci                                       # once, at the repo root
cd apps/desktop
npx tauri dev                                # the app over Vite, with reload
npx tauri build                              # installer: src-tauri/target/release/bundle/nsis/*-setup.exe
npx tauri build --debug --no-bundle && node e2e.mjs   # end-to-end test
cargo test --manifest-path src-tauri/Cargo.toml       # the Rust side's tests
```

Needs Rust (stable) as well as Node. On Linux the app runs too (WebKitGTK:
`libwebkit2gtk-4.1-dev`), which is how the end-to-end test was first run;
there it needs `webkit2gtk-driver` and a display (`xvfb-run`).

## The end-to-end test (`e2e.mjs`)

The built app, started as Explorer starts it and driven through Playwright
over WebView2's DevTools port on Windows (the app opens it only when
`ADDDOTS_DEVTOOLS_PORT` is set; Edge's WebDriver cannot attach to a Tauri
app's WebView2), or `tauri-driver` (WebDriver) on Linux:

- started with a PDF as its argument, the PDF opens and page 1 is drawn, in
  the render worker
- it is the desktop app, with no service worker; the page cannot read a file
  it was not handed
- a second start with another PDF opens it in the open window, and quits
- Save writes a PDF with every page (`ADDDOTS_SAVE_TO` stands in for the Save
  dialog)

CI on `windows-latest` installs the release build from its setup `.exe` the
way a reader does: it checks the installer runs as the user (no administrator,
like WPS), puts the app under `%LOCALAPPDATA%` for this user only, runs this
test against the installed app, then uninstalls it. The setup `.exe` is
uploaded as the `windows-installer` artifact. There is no `.msi`: an MSI
installs for the whole computer and asks for an administrator.

## Signing

The installer is not signed yet: Windows SmartScreen warns before running
it ("Windows protected your PC", then "More info" and "Run anyway"), and a computer whose
IT only lets signed programs run (AppLocker, Smart App Control) refuses it
with "Windows cannot access the specified device, path, or file". Signing
needs a code-signing certificate; with one, Tauri signs during `tauri build`
(`bundle.windows.certificateThumbprint`, or a signing command for a cloud
certificate), from secrets added to GitHub.

## Microsoft Store (MSIX)

`msix/` packs the same app as an MSIX for the Microsoft Store, with the
identity Partner Center gave the product "ADD DOTS PDF" (Store ID
9PGHPBRMLQMS): `Name ADDDOTS.ADDDOTSPDF`, publisher `ADD DOTS`.

- `msix/AppxManifest.xml`: the package manifest (identity, Start menu
  logos, opening PDFs from Explorer, `runFullTrust` as a desktop app).
- `msix/Assets/`: the logos, made from the web app's icon.
- `msix/pack.ps1 -Version 1.0.N.0`: packs `src-tauri/target/release/adddots-pdf.exe`
  after `npx tauri build`, with the Windows SDK's `makepri` and `makeappx`.

CI packs it on every run as version `1.0.<run number>.0` (each Store
submission needs a higher version), installs it signed with a throwaway
certificate, starts it from its Start menu entry and removes it, then uploads
the unsigned `.msix` as the `windows-store-msix` artifact. That file is what
goes to Partner Center: the Store signs it, so no code-signing certificate is
needed, and Store installs update themselves.
