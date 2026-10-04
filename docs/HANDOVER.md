# Handover: where the Windows app work stands

Last updated 2026-10-04. Read with `docs/windows-performance.md`, which has
the analysis, the plan and the measured results of each phase.

## Done

| Phase | What                                                                    | Where                  |
| ----- | ----------------------------------------------------------------------- | ---------------------- |
| 1     | Atomic saves; performance panel (Ctrl+Shift+P)                          | PR #45 (merged)        |
| 2     | Memory: PDFium reads from disk, render worker started only when needed  | PR #46 (merged)        |
| 3     | Big files (over 150 MB) read from disk by byte ranges                   | PR #47                 |
| 4     | Edit Object's work in the save worker; DXF conversion no longer freezes | PR #47 (second commit) |

Branch: `claude/festive-hypatia-aw32lc`. Once PR #47 is merged, start the
next phase from `main`.

## Open problem: the Android CI job fails most of the time

- **Symptom.** "Android app (Capacitor)" fails at the emulator step. Either
  page 1 is not drawn within 60 s and the WebView connection closes, or the
  run hangs at "open the first PDF and find the WebView" until the 10-minute
  watchdog fires.
- **History.** Over the last 40 CI runs it failed 17% of the time up to Oct 4,
  11:25 UTC, then 5 of 7 runs, including pushes to `main`.
- **Not caused by the app getting heavier.** On a 6×-throttled phone in
  Chrome, start-up is the same at the last always-green commit (`6fb543b`)
  and now: boot ~1.5 s, first page ~2 s, the same workers and memory.
- **Likely cause.** The emulator itself. It runs with 2 cores and the
  software GPU (`-gpu swiftshader_indirect`), logs
  `Failed to find ColorBuffer` / `Failed to bind to texture`, and isn't
  pinned (`channel: stable` takes the newest emulator).
- **Next steps to try,** in `.github/workflows/ci.yml` (`android` job) and
  `apps/mobile/e2e-android.mjs`:
  1. Compare the emulator version (the "Emulator 37.x" line) in a passing
     run (#126, #127, #129) with a failing one (#130, #132, #133). If it
     changed, pin the last good one (`emulator-build:` in
     reactivecircus/android-emulator-runner).
  2. Try `-gpu guest` or `-gpu swangle_indirect` instead of
     `swiftshader_indirect`, and `cores: 4` (the emulator itself suggests 4).
  3. In `e2e-android.mjs`, give `webview.page()` its own timeout and retry
     finding the WebView once. A hang currently uses up the whole
     10-minute watchdog and prints no logcat.

## Remaining phases

5. **Windows OCR.** Windows.Media.Ocr through the Rust side (a new Tauri
   command that takes a page bitmap and returns words with boxes). Keep
   Tesseract (`js/ocr.js`) for the website and as the fallback.
6. **Professional UI.** Dark theme pass, icon audit, toolbar groups,
   two-page view, High-DPI audit, Windows print, context menus.
7. **Security.** A CSP for the Tauri window (it has `csp: null` today in
   `apps/desktop/src-tauri/tauri.conf.json`), and a review of every path
   and file the Rust side accepts (`lib.rs`).

Smaller items noted along the way:

- Edit Text with the PDF's own embedded fonts (today the closest standard
  font or Google Font is used).
- Edit Object: shapes inside form XObjects.
- Thumbnails without marks (an option).
- Search on big files: pdf.js fills its copy of a big file as the
  background text indexing reads every page. Not indexing files over
  150 MB in the background would cut memory further, but search would
  start later.
- Real Windows numbers: open the app on Windows, press Ctrl+Shift+P, and
  "Copy" the panel for each test file.

## Setting up on another computer

```sh
git clone https://github.com/zakariyatk/add-dots-pdf
cd add-dots-pdf
git checkout claude/festive-hypatia-aw32lc   # or main once PR #47 is merged
npm ci
npm run build                                # engine + web app into apps/web/dist
```

Checks, as CI runs them:

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
npm run smoke -w @adddots/web                # Chrome smoke test, 155 checks
cd apps/desktop/src-tauri && cargo test      # Rust side
```

The Windows app (needs Rust and the PDFium DLL):

```sh
cd apps/desktop
node scripts/get-pdfium.mjs                  # downloads pdfium.dll (checked by sha256)
npx tauri build --no-bundle                  # release build
node e2e.mjs                                 # end to end; APP=<path to the exe> for another build
ADDDOTS_RANGE_MB=0 node e2e.mjs              # again, every file read by byte ranges
```

Benchmarks: `apps/web/bench/longtasks.mjs` (page-thread freezes during
search, Edit Object and Convert), `apps/web/bench/run.mjs` and the others
listed in `apps/web/bench/README.md`.
