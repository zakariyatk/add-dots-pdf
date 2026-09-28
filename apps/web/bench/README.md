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
instead, set `BENCH_CHANNEL=chrome` or `BENCH_CHANNEL=msedge`. To measure with pages
drawn on the main thread, as before Stage D, set `BENCH_NO_WORKER=1`.

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
  list (Stage C) removes it. (Done: see below.)
- pdf-lib is parsed at start-up although only saving uses it: about 65 ms,
  or 300 ms on a 4x slower CPU. Loading it on demand needs the engine bundle
  and four modules rewired, which belongs with the move to ES modules.

### After Stage C (`results/stage-c.json`), stage-b → stage-c

| file               | first page ms | open TBT    | jump end ms | zoom ms     | search ms   | browser MB | DOM nodes     |
| ------------------ | ------------- | ----------- | ----------- | ----------- | ----------- | ---------- | ------------- |
| small-text-12p     | 198 → 267     | 0 → 23      | 734 → 713   | 749 → 745   | 153 → 136   | 520 → 488  | 3245 → 2949   |
| medium-report-300p | 367 → 336     | 21 → 6      | 857 → 848   | 877 → 747   | 1203 → 1176 | 590 → 467  | 12832 → 5022  |
| large-text-2000p   | 1272 → 916    | 607 → 147   | 1218 → 911  | 1478 → 1033 | 8950 → 6976 | 971 → 790  | 42810 → 13434 |
| cad-a1-8sheets     | 2745 → 2752   | 2215 → 2203 | 3990 → 4041 | 2853 → 2884 | 2205 → 2260 | 549 → 552  | 3469 → 2958   |
| scans-40p          | 378 → 403     | 0 → 0       | 920 → 940   | 729 → 704   | 144 → 144   | 651 → 672  | 3870 → 2420   |

What changed: a page's content (the canvas, text layer, marks and tools)
sits in a `display: contents` wrapper that leaves the document while the page
is far off screen; the page's box stays, holding its size, so positions,
jumps and scrolling are unchanged, and every module keeps its references to
the elements. Thumbnails do the same in the rail, and are sized to their
page's proportions before they are drawn, so the rail no longer shifts as
they draw. Pages ahead of the scroll are drawn from 1,400 px off, pages
behind from 300 px. Side by side with a translation, every page stays in the
document, since its height depends on the text.

About 7,000 of the 2,000-page file's remaining nodes are the list of 2,376
search results, which is not virtualized yet. The small file measures the
same before and after (5 runs each: 243 ms and 252 ms to page 1).

### Stage D1: drawing in a worker (`results/stage-d1.json`), stage-c → stage-d1

| file               | first page ms | open TBT  | zoom TBT | search ms   | save ms     | browser MB |
| ------------------ | ------------- | --------- | -------- | ----------- | ----------- | ---------- |
| small-text-12p     | 267 → 277     | 23 → 0    | 13 → 0   | 136 → 154   | 502 → 708   | 488 → 539  |
| medium-report-300p | 336 → 398     | 6 → 0     | 0 → 0    | 1176 → 1151 | 1044 → 1170 | 467 → 572  |
| large-text-2000p   | 916 → 907     | 147 → 118 | 32 → 17  | 6976 → 7055 | 2462 → 2519 | 790 → 823  |
| cad-a1-8sheets     | 2752 → 2888   | 2203 → 0  | 2214 → 0 | 2260 → 1091 | 243 → 287   | 552 → 568  |
| scans-40p          | 403 → 509     | 0 → 0     | 0 → 0    | 144 → 149   | 566 → 571   | 672 → 771  |

What changed: pages and thumbnails are drawn by pdf.js in `js/render-worker.js`,
on an OffscreenCanvas, and come back as finished bitmaps. A CAD sheet still takes
over a second to draw, but the app no longer freezes while it does: opening and
zooming the CAD file used to block the main thread for 2.2 s each, and now do
not block it at all. JPG export and the rasterising behind redaction and
compression draw there too. The worker opens its own copy of each document,
reading the file itself as soon as it is chosen, so it parses alongside the main
thread's copy. Until it has started, and for any page it cannot draw, pages are
drawn on the main thread as before; its pictures match the main thread's pixel
for pixel (checked by the smoke test).

What it costs:

- memory: a second pdf.js parser with its own copy of each open file. Measured
  here, +16 to +105 MB (the 85 MB scans: +99 MB);
- page 1 of the medium and scanned files: 60–100 ms later, likely because both
  parsers work at once while the file opens;
- thumbnails now pause while a saved file is written out: drawn alongside, they
  slowed the write down (the scans' save took 1.9 s before this was changed).

Some timings vary widely between benchmark runs: the small file's save measured
305, 352 and 708 ms in three runs of this build, and the CAD file's jump 4.0 to
5.2 s.

### Stage D2: sharp at high zoom (`results/stage-d2.json`)

Two new columns measure it: **deep zoom ms**, zooming in to 600% until the
page being read is sharp; and **deep step ms**, one step back out (500%) until
it is sharp again. For builds before this one, which only stretch a capped
bitmap, "sharp" means "drawn". The Stage D1 build, measured again the same day
for these columns, is `results/d1-deep.json`.

| file               | deep zoom ms       | deep step ms | zoom ms     | browser MB |
| ------------------ | ------------------ | ------------ | ----------- | ---------- |
| small-text-12p     | 454 → 483          | 774 → 787    | 711 → 741   | 499 → 499  |
| medium-report-300p | 496 → 707          | 622 → 582    | 710 → 764   | 573 → 572  |
| large-text-2000p   | 1384 → 1274        | 1154 → 1061  | 1050 → 1058 | 847 → 818  |
| cad-a1-8sheets     | 1876 (soft) → 1568 | 2170 → 638   | 2747 → 3805 | 551 → 606  |
| scans-40p          | 516 → 658          | 1681 → 1930  | 745 → 690   | 786 → 751  |

What changed:

- **Detail layer.** Past 8,192 pixels a side (4,096 on phones), or 22 million
  pixels (5.5 million on phones), a page's bitmap is capped and was stretched
  by CSS, so an A1 sheet at 600% (14,304 pixels wide) showed its lines soft.
  Now, once scrolling or zooming settles, each such page on screen gets a
  second canvas over it: just the part on screen, and a quarter screen round
  it, drawn at full resolution in the render worker. It follows scrolling and
  is dropped when the page leaves the screen.
- **PDFium for heavy pages.** pdf.js runs all of a page's drawing commands
  for any part of it, so a part of a CAD sheet cost as much as the sheet
  (about 1.2 s). A page that took pdf.js over 250 ms has its parts drawn by
  PDFium (`@embedpdf/pdfium`, vendored in `js/vendor/pdfium/`), in about 0.1
  to 0.2 s. It loads, 2.2 MB compressed, only when a page proves heavy, and
  not at all for other documents. Pages with form fields stay with pdf.js,
  which leaves the fields to the app's own controls. PDFium's parts differ
  from pdf.js's in 0.5–1.2% of pixels (edge smoothing), checked on pages
  turned by the file (90°, 270°), turned by the reader (90°, 180°), with an
  offset crop box, and on a 2× screen. If PDFium cannot load, pdf.js draws
  the parts.
- **A small bitmap under the detail.** With a detail over it, the page's own
  bitmap only fills the edges for a moment while scrolling, so past the cap it
  is at most 4 million pixels. At 22 million pixels, scrolling the A1 sheet at
  600% froze the page for about 0.4 s (in this headless, GPU-less browser)
  while it was stretched over a page 14,000 pixels wide; now it does not
  freeze at all. It is also kept, rather than drawn again, for further zoom
  steps past the cap: that is the CAD file's deep step, 2.2 s → 0.6 s.
- **The render worker reads messages while it draws.** pdf.js went from one
  15 ms chunk of drawing to the next as a microtask, so the worker read
  nothing (a cancel, a detail wanted now) until a whole page was done. It now
  gives way to its message queue between chunks.

What it costs:

- the CAD file holds 55 MB more: PDFium and its copy of the file;
- the CAD file's zoom (three steps from fit width) measured 3.8 s in every run
  of this build, and 2.7 or 3.8 s in runs of the build without the
  between-chunks change. Traced step by step, the pages zoomed were drawn in
  the same time with and without it; what else was being drawn when the zoom
  started decides the rest.

The other differences are within the run-to-run variation of this machine.

### Stage E: text and search (`results/stage-e.json`)

| file               | search ms (D2 → E) | zoom ms (D2 → E) | deep step ms (D2 → E) | DOM nodes (D2 → E) |
| ------------------ | ------------------ | ---------------- | --------------------- | ------------------ |
| small-text-12p     | 143 → 151          | 741 → 810        | 787 → 865             | 2981 → 2873        |
| medium-report-300p | 1179 → 226         | 764 → 891        | 582 → 1047            | 5082 → 3350        |
| large-text-2000p   | 7599 → 7297        | 1058 → 1291      | 1061 → 1528           | 13388 → 6776       |
| cad-a1-8sheets     | 1081 → 165         | 3805 → 3674      | 638 → 643             | 2990 → 2990        |
| scans-40p          | 150 → 186          | 690 → 815        | 1930 → 1902           | 2420 → 2420        |

The D2 column is `results/stage-d2.json`, from an earlier day; most of the
drop in DOM nodes is the search list written in chunks (the Stage D2
follow-ups, merged between the two). Measured again the same day as E, the D2
build zoomed the 300- and 2,000-page files in 869 and 1,230 ms (E: 891 and
1,291) and made the deep step in 716 and 962 ms.

What changed:

- **The text of every page is read in the background** once the pages have
  loaded, a few pages at a time while nothing is being drawn. A search then
  looks through text already read: 300 pages answer in about 0.2 s instead of
  1.2 s. The 2,000-page file takes about 12 s to read, and the benchmark
  searches before that is done, so its search time is unchanged.
- **Every match is listed.** A limit of 400 stopped only the page it was
  reached on, so every later page listed just its first match: "engineer" in
  the 300-page file has 4,647 matches, of which 674 were listed. The limit is
  now 50,000, and the list is written as it is read (Stage D2 follow-ups).
- **Matches are marked on the word**, not on the whole run of text around it,
  and the one stepped to is scrolled into view where it is on its page. A step
  to the next match on the same page no longer scrolls back to the page's top.
- **The words are laid out once per turn of the page**, at 100%, in units a
  CSS variable scales. A zoom used to ask pdf.js for each page's text again
  and rebuild and re-measure every word; now it sets one variable, and the
  same elements stay (checked by the smoke test).

What it costs: after a zoom the words are shown and selectable at once, where
before they came back only after being rebuilt. Laying them out at the new
size is part of the deep step now: 50 to 100 ms in a direct comparison (D2 743
to 801 ms, E 764 to 910 ms), and more in the benchmark, where search marks are
on the page. While a zoom glides the words are out of layout (`display: none`);
only hidden, they were laid out every frame and the zoom took 0.2 s longer.
The CAD file's zoom (3.8 s for D2, 3.7 s here) varies between about 2.7 and
3.8 s from run to run, as noted for Stage D2.

**Selecting text** (checked by the smoke test on a two-column page, drawn
column by column and row by row):

- **A copy keeps its spaces and line breaks.** Each run of text is its own
  box, so a copy of five lines gave `Left line 2tail2Left line 3tail3...`.
  The copy is now built from where the runs sit on the page: a space where two
  runs on a line are apart, a line break where the next run starts a new line
  (`packages/engine/src/reading.ts`, `joinRuns`). A text markup's quote reads
  the same way.
- **A gap no longer resets the selection.** Between words the pointer is over
  the layer itself, which the browser reads as its start, so the selection
  jumped to the page's first word. While a drag selects, a blank box under
  the words covers the gaps, kept just after the end being dragged (as pdf.js
  does).
- **A drag stays in its column.** Some files draw two columns row by row, left
  line then right line, so a drag down the left column picked up the right one
  too. The runs are laid out in reading order (`readingOrder`): a gutter with a
  text column at least 10 font sizes wide on each side is read one side after
  the other, and a page without one keeps the file's order. Search still
  counts its matches in the file's order. Ordering takes 3 ms or less a page
  on the CAD sheets (400 labels) and 0.2 ms on the reports.

### Choosing the drawing engine (Stage D0)

Before moving drawing off the main thread, three engines were compared in
headless Chromium on the benchmark files and two real-world PDFs, drawing page 1
at 1400 px wide:

| engine                    | CAD sheet | CAD, one 1024 px tile at 4× | text page | scanned page | download (gzip) |
| ------------------------- | --------- | --------------------------- | --------- | ------------ | --------------- |
| pdf.js 3.11 (in use)      | 1.4 s     | 1.17 s                      | 30–60 ms  | 80–120 ms    | 380 KB          |
| pdf.js 6.3                | 1.3 s     | not measured                | 25–70 ms  | 50–75 ms     | 540 KB          |
| PDFium (@embedpdf/pdfium) | 0.3 s     | 0.08 s                      | 45–115 ms | 130–300 ms   | 2.2 MB          |

- pdf.js 3.11 in a worker draws exactly what it draws on the main thread, so it
  went first.
- PDFium draws CAD sheets 4–5× faster, and a zoomed-in tile about 15× faster,
  because it draws only the tile while pdf.js runs the whole page for every
  tile. It also drew a radial gradient under a multiply blend correctly, which
  pdf.js 3.11 draws pink; pdf.js 6.3 fixes most of that. Stage D2 uses it for
  the zoomed-in parts of heavy pages, loaded only when a document needs it.
- pdf.js 6.x needs `Map.prototype.getOrInsertComputed` (Chrome 145 and later)
  unless its legacy build is used.
