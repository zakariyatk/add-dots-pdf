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
npx tauri build                              # installers: src-tauri/target/release/bundle/{nsis,msi}
npx tauri build --debug --no-bundle && node e2e.mjs   # end-to-end test
cargo test --manifest-path src-tauri/Cargo.toml       # the Rust side's tests
```

Needs Rust (stable) as well as Node. On Linux the app runs too (WebKitGTK:
`libwebkit2gtk-4.1-dev`), which is how the end-to-end test was first run;
there it needs `webkit2gtk-driver` and a display (`xvfb-run`).

## The end-to-end test (`e2e.mjs`)

The built app, driven through `tauri-driver` (WebDriver):

- started with a PDF as its argument, the PDF opens and page 1 is drawn, in
  the render worker
- it is the desktop app, with no service worker; the page cannot read a file
  it was not handed
- a second start with another PDF opens it in the open window, and quits
- Save writes a PDF with every page (`ADDDOTS_SAVE_TO` stands in for the Save
  dialog)

CI runs it on `windows-latest` against the release build, with Edge's driver
matched to the runner's WebView2 (`msedgedriver-tool`), then uploads the
installers as the `windows-installers` artifact.

## Signing

The installers are not signed yet: Windows SmartScreen warns before running
them ("Windows protected your PC", then "More info" and "Run anyway"). Signing
needs a code-signing certificate; with one, Tauri signs during `tauri build`
(`bundle.windows.certificateThumbprint`, or a signing command for a cloud
certificate), from secrets added to GitHub.
