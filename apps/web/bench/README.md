# Performance benchmark

Measures what a reader feels in the web app, on five generated PDFs, so every
performance change can be checked against numbers rather than impressions.

```bash
npm run bench                                   # build, then measure every file once
npm run bench -- --runs 3 --label after         # medians of 3 runs, saved as results/after.json
npm run bench -- --only cad                     # just the files whose name contains "cad"
node apps/web/bench/run.mjs --dist <dir>        # measure another build (e.g. a saved baseline)
```

The first run generates the PDFs into `bench/.corpus/` (about 100 MB, gitignored,
about a minute). It uses Playwright's Chromium; to use an installed browser
instead, set `BENCH_CHANNEL=chrome` or `BENCH_CHANNEL=msedge`.

## The files

| File                 | What it stands for                                              |
| -------------------- | --------------------------------------------------------------- |
| `small-text-12p`     | a short report: 12 A4 pages of text                             |
| `medium-report-300p` | a long report: 300 pages, a vector figure every fifth page      |
| `large-text-2000p`   | a very long document: 2,000 pages of text                       |
| `cad-a1-8sheets`     | drawings: 8 A1 sheets, 40,000 line segments and 400 labels each |
| `scans-40p`          | a scanned document: 40 image-only pages, 85 MB                  |

## What is measured

Each file opens in a fresh headless browser at 1440×900.

| Column                                    | Meaning                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| first page ms                             | choosing the file → page 1 drawn                                                                   |
| open ms                                   | choosing the file → every page on screen drawn                                                     |
| open TBT                                  | main-thread time blocked (beyond 50 ms per task) while opening: how long the app could not respond |
| scroll p95 ms                             | a 4-second flick at 3,600 px/s: the 95th-percentile frame time (17 ms is a smooth 60 fps)          |
| scroll jank                               | frames over 50 ms during the flick                                                                 |
| scroll blank %                            | frames where the page in the middle of the screen was not drawn yet                                |
| jump end ms                               | "go to last page" → that page drawn                                                                |
| zoom ms                                   | three zoom-in clicks → the visible pages sharp again                                               |
| search ms                                 | searching every page for a word, until the result shows                                            |
| save ms / save max task                   | building the PDF to download, and its longest freeze                                               |
| browser MB                                | memory of the whole browser (PSS of every process: page, GPU, workers) after use                   |
| JS heap / canvas MB / DOM nodes / workers | where that memory sits                                                                             |

Timings from a shared machine are noisy (the same run can differ by 10–20%).
Compare runs made on the same machine, and use `--runs 3` for decisions.

## Results

Linux container, 4 CPUs, headless Chromium, medians of 3 runs.

### Baseline (`results/baseline.json`)

| file               | pages | first page ms | open ms | open TBT | scroll p95 ms | scroll jank | jump end ms | zoom ms | search ms | save ms | browser MB | DOM nodes |
| ------------------ | ----- | ------------- | ------- | -------- | ------------- | ----------- | ----------- | ------- | --------- | ------- | ---------- | --------- |
| small-text-12p     | 12    | 352           | 549     | 22       | 17            | 0           | 722         | 768     | 137       | 451     | 461        | 3329      |
| medium-report-300p | 300   | 770           | 1780    | 222      | 17            | 0           | 1070        | 1323    | 1210      | 1250    | 605        | 22874     |
| large-text-2000p   | 2000  | 2228          | 4226    | 1508     | 133           | 5           | 3404        | 6028    | 8617      | 2716    | 1143       | 127530    |
| cad-a1-8sheets     | 8     | 13460         | 13481   | 12444    | 17            | 0           | 3638        | 2869    | 975       | 250     | 558        | 3190      |
| scans-40p          | 40    | 556           | 1967    | 12       | 17            | 0           | 1637        | 797     | 137       | 556     | 972        | 4276      |

### After Stage B (`results/stage-b.json`), baseline → stage-b

| file               | first page ms | open TBT     | scroll p95 ms | jump end ms | zoom ms     | search ms   | save ms     | browser MB | DOM nodes      |
| ------------------ | ------------- | ------------ | ------------- | ----------- | ----------- | ----------- | ----------- | ---------- | -------------- |
| small-text-12p     | 352 → 198     | 22 → 0       | 17 → 17       | 722 → 734   | 768 → 749   | 137 → 153   | 451 → 665   | 461 → 520  | 3329 → 3245    |
| medium-report-300p | 770 → 367     | 222 → 21     | 17 → 17       | 1070 → 857  | 1323 → 877  | 1210 → 1203 | 1250 → 1127 | 605 → 590  | 22874 → 12832  |
| large-text-2000p   | 2228 → 1272   | 1508 → 607   | 133 → 17      | 3404 → 1218 | 6028 → 1478 | 8617 → 8950 | 2716 → 2726 | 1143 → 971 | 127530 → 42810 |
| cad-a1-8sheets     | 13460 → 2745  | 12444 → 2215 | 17 → 17       | 3638 → 3990 | 2869 → 2853 | 975 → 2205  | 250 → 236   | 558 → 549  | 3190 → 3469    |
| scans-40p          | 556 → 378     | 12 → 0       | 17 → 17       | 1637 → 920  | 797 → 729   | 137 → 144   | 556 → 566   | 972 → 651  | 4276 → 3870    |

What changed: page 1 no longer waits for every page to load (the rest load
in the background and take their real size as they arrive); scrolling reads
page positions by bisection and never interleaves reads with writes; zooming
resizes only the pages near the screen until it settles; thumbnails draw one
at a time, only when no page is being drawn, nobody is scrolling, saving or
searching, and are copied from the page's own bitmap when it has one; pages
far off screen release their bitmap and pdf.js data; one pdf.js worker serves
every document, and a closed document is freed; the hover tools and
translation panes are made when first needed.

Known limits, for the next stages:

- CAD sheets still block the main thread for about 2 s while page 1 draws:
  pdf.js 3.11 rasterises on the main thread, and one stroke of 40,000
  segments cannot be split. Drawing in a worker (Stage D) is the fix.
- Search on the CAD file measures 2.2 s here against 1 s before. Searched
  on an idle document it is unchanged (about 1 s in both); in the benchmark a
  sheet's thumbnail is being drawn when the search starts, work that v1 did
  during its 13-second open instead.
- The 2,000-page file still builds 43,000 DOM nodes and takes 1.3 s to page
  1, most of it the browser laying out every page's box: a virtualized page
  list (Stage C) removes it.
- pdf-lib is parsed at start-up although only saving uses it: about 65 ms,
  or 300 ms on a 4x slower CPU. Loading it on demand needs the engine bundle
  and four modules rewired, which belongs with the move to ES modules.
