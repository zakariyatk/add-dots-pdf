# Handover: where the Windows app work stands

Last updated 2026-10-04, end of the second session. Read with
`docs/windows-performance.md`, which has the analysis, the plan and the
measured results of each phase.

## Start here tomorrow

1. Merge PR #51 (toolbar groups, branch `claude/toolbar-groups`) once its
   CI is green. Everything else from these sessions is already in `main`.
2. Pull `main` on the new computer and set it up (below).
3. Pick the next item from "What is left".

## Done

| Phase | What                                                                     | Where  |
| ----- | ------------------------------------------------------------------------ | ------ |
| 1     | Atomic saves; performance panel (Ctrl+Shift+P)                           | PR #45 |
| 2     | Memory: PDFium reads from disk, render worker started only when needed   | PR #46 |
| 3     | Big files (over 150 MB) read from disk by byte ranges                    | PR #47 |
| 4     | Edit Object's work in the save worker; DXF conversion no longer freezes  | PR #47 |
| 5     | OCR by Windows' own reader (`src-tauri/src/ocr.rs`), Tesseract fallback  | PR #48 |
| 6     | High-DPI (pages up to 3x, redrawn when the density changes)              | PR #48 |
| 6     | Right-click page menu (`js/pagemenu.js`)                                 | PR #49 |
| 6     | Two pages side by side; dark-interface pass; icon audit (ribbon at 24px) | PR #50 |
| 6     | Toolbar groups: Page and Document tabs read by job                       | PR #51 |
| 7     | Window CSP; update check sandboxed; `read_range` bounded                 | PR #48 |

PRs #45-#50 are merged. All work is in `main` except #51.

## The Android CI job

It failed most runs (the WebView went away before page 1 was checked).
Fixed in PR #48: 4 cores, 4 GB, `-gpu swangle_indirect`, and
`apps/mobile/e2e-android.mjs` reconnects when the system recreates the
WebView on a freshly booted emulator (it prints each time it does), reports
the app's state when a check times out, and keeps Google's log noise out of
the report. If it fails again, the report now says why; next ideas: pin the
emulator version (`emulator-build:` in reactivecircus/android-emulator-runner)
or wait for the emulator to settle after boot before starting the app.

## What is left

Phase 6 (professional UI):

- A cover-page option for two-page view (page 1 alone, as a book's cover).
- Windows print: check printing in the Windows app, with a CI check on the
  Windows runner.

Phase 5 follow-ups:

- Windows reading both languages at once (today "English and Arabic" goes
  to Tesseract).
- Timing Windows OCR against Tesseract on a real Windows machine. CI checks
  that Windows' reader reads a picture of words (it installs the English
  OCR component on the runner if missing).

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
git checkout main                            # after PR #51 is merged
npm ci
npm run build                                # engine + web app into apps/web/dist
```

Checks, as CI runs them:

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
npm run smoke -w @adddots/web                # Chrome smoke test, 179 checks
ADDDOTS_CSP=1 npm run smoke -w @adddots/web  # again, under the Windows app's CSP
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
