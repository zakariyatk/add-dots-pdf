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

### Stage F1: saving in a worker (`results/stage-f1.json`), stage-e → stage-f1

Saving rebuilt the file on the page: pdf-lib copied each page's content,
images included, then wrote the new file out in one piece, and the browser
copied that into a Blob to download it. None of it can be split into slices
(pdf-lib copies a whole image stream at once), so a large file froze the
page: on the 84 MB scans, for 773, 719 and 558 ms, 2.7 s in all, in a
profile of a first save.

Now `js/save-worker.js` builds it: pdf-lib and the engine run there with the
same hooks the page uses, and the file comes back as a Blob, so the page
does not copy it again. What the hooks need from the page is plain data
(`E.saveHooks(state)`: the drawing scale, form values, document details,
page count and name, photo pins), so the feature modules no longer register
painters one by one; the page and the worker build the same set. A file as
it was opened is handed over as the `File` and read there, not copied; one
changed on disk since is sent as bytes. Without a worker (or for marks that
cannot be posted) the page builds it as before (`?saveworker=0` forces it).

Medians of 3 runs:

| file               | save max task | save ms     | browser MB after use |
| ------------------ | ------------- | ----------- | -------------------- |
| small-text-12p     | 64 → 0        | 713 → 673   | 537 → 561            |
| medium-report-300p | 66 → 0        | 1208 → 1161 | 492 → 582            |
| large-text-2000p   | 227 → 0       | 2714 → 2829 | 809 → 831            |
| cad-a1-8sheets     | 202 → 0       | 331 → 340   | 592 → 564            |
| scans-40p          | 469 → 0       | 1391 → 1116 | 729 → 762            |

The smoke test checks that the worker builds the file and that it matches the
page's own, page for page: every module's marks (the engine's golden
fixtures) and photo pins with their photo pages. The engine's tests check
that `saveHooks` saves what the modules' own registrations did.

What it costs: the worker is started once a file is open and the page is
idle, and it keeps a copy of each file saved, freed when the document
closes: 20 to 90 MB more for the browser here. Zoomed right in on the scans,
the browser itself still does one or two tasks of 150 to 190 ms while the
worker builds, with no script of ours in them (building on the page froze it
five or six times, 100 to 150 ms each); the benchmark's median does not show
them. pdf-lib sets the saved file's Producer to its own name, as it always
did: the one we set is overwritten.

### Stage F2: saving onto the original (`results/stage-f2.json`)

Save now writes the marks onto the original as an incremental update: the
original's bytes exactly as they were, then the objects that changed, a new
cross-reference section and a trailer pointing back to the old one
(`packages/engine/src/append.ts`, `E.appendPdf`). The marks are painted onto
the loaded original by the same code a rebuild uses, the objects are
compared with how they were loaded, and the changed ones are written out in
the form the original's last section has (a table or a stream). What a
rebuild drops is kept: bookmarks, links, the structure, attachments. Only
Save does this, and only for the original's own pages, all of them, in
order, in a file without form fields (a rebuild paints the answers onto the
page, and on the original the live fields would disagree with them); any
other save rebuilds as before. Applying a redaction replaces its page with a
new source, so a redacted file is always rebuilt and the covered content is
gone from it.

Two things pdf-lib does not do for an update, and the tests now check:

- New objects must be numbered past every object in the original, counting
  the object streams pdf-lib unpacks and does not keep. The number comes from
  the original's `/Size`. Reusing those numbers overwrote the object streams:
  pdf-lib still read the file, but pdf.js saw 46 of 300 pages.
- Fonts and images are written by pdf-lib's `flush()`, which a whole-file
  save calls for it; without it the pages pointed at fonts that were never
  written.

Building the file (the worker's part of a save, timed on the page, median of
3, a mark on page 1; the rest of "save ms" is the browser writing the
download):

| file               | append ms | rebuild ms | file size (append / rebuild) |
| ------------------ | --------- | ---------- | ---------------------------- |
| small-text-12p     | 11        | 19         | 36 KB / 34 KB                |
| medium-report-300p | 72        | 179        | 2.18 MB / 2.18 MB            |
| large-text-2000p   | 579       | 1346       | 5.44 MB / 5.44 MB            |
| cad-a1-8sheets     | 65        | 116        | 13.34 MB / 13.33 MB          |
| scans-40p          | 547       | 1142       | 85.52 MB / 85.52 MB          |

Parsing the original is most of what is left. The full benchmark
(`stage-f2.json`) was a noisy run: its save ms move by a second or more from
run to run on the scans, with the download written in them. The saved file
of the smoke test opens in qpdf with no warnings (all 300 pages, every font
there) and in the app.

What it costs: an update keeps the original whole, so a file never gets
smaller by being saved, and earlier revisions inside the original (its own
incremental updates) stay in it, as they do in Acrobat's Save.

### Stage F3: markups saved as PDF comments

Save now keeps markups editable: a highlight, underline or strike, ink, a
sticky note, a box, ellipse, line or arrow, a text box and a stamp each
become a PDF annotation of their own kind (Highlight, Underline, StrikeOut,
Ink, Text, Square, Circle, Line, FreeText, Stamp) with their colour,
opacity, points and comment text (a note's text and its replies), so
Acrobat lists them with the comments and can move, edit or delete them.
Measurements, pins, pictures, tables, watermarks, headers and footers,
signatures and a text edit's patch over the original words stay painted
into the page. "Flatten markups into the page" in the Save dialog paints
them all in, as before (`packages/engine/src/annots.ts`, `opts.annots`).

How each looks is not left to the reader: it is painted by the same code
that flattens it, onto a page of its own that is never added to the file,
and that drawing becomes the annotation's appearance, over a box around the
mark in page coordinates. The engine's tests check, for each of the 21
editable marks in the fixtures, that the appearance is exactly what
flattening paints onto the page, and that the page itself is left as it was.
pdf-lib's own `addAnnot` wraps the page's content in `q`..`Q` first; the
annotation is added to the page's list directly instead, so nothing but the
list changes (and an update onto the original stays small). The saved files
open in qpdf with no warnings and every annotation's appearance there.

### Stage H: a long session (`stress.mjs`, `results/stress-long.json`)

`node bench/stress.mjs --rounds 24` keeps one tab open for a whole session:
it opens the report, the CAD sheets, the scans and the 2,000 pages in turn,
six times over, and on each one jumps through, scrolls, zooms in and out,
searches, adds a mark and saves. After every round it collects the page's
garbage and records the page's JS heap, its elements and canvases, and the
browser's memory by process. A leak shows as a line that keeps rising where
the same file should come back to the same place.

It found one. The thumbnail rail built every thumbnail of a file opened
after another, with its tools: 46,474 elements for the 2,000 pages, carried
on into the next file (the report then had 9,208 where it first had 3,643).
The new file's thumbnails, not yet sized, all stood at one spot and all read
as near view; so did every thumbnail while the search tab covered the rail.
The rail now waits while its list is not laid out, skips thumbnails without
a size yet (the layout calls it back) and mounts at most 60 at a time: the
2,000 pages now hold 6,685 elements. The smoke test checks it.

After that fix, over 24 rounds (browser MB, the same file one lap apart):

| file               | lap 1 | lap 2 | lap 3 | lap 4 | lap 5 | lap 6 |
| ------------------ | ----- | ----- | ----- | ----- | ----- | ----- |
| medium-report-300p | 531   | 706   | 850   | 888   | 890   | 839   |
| cad-a1-8sheets     | 679   | 750   | 878   | 924   | 955   | 922   |
| scans-40p          | 1135  | 1274  | 1430  | 1421  | 1338  | 1382  |
| large-text-2000p   | 857   | 1006  | 933   | 969   | 1020  | 915   |

The browser's memory climbs over the first three laps and then holds, moving
up and down within a band; the page's JS heap (9, 6, 6 and 34 MB), its
elements and its canvases come back to the same values every lap, and no
error is raised in the 24 rounds. Each worker, measured through DevTools,
also holds the same for the same file every lap: pdf.js's parser, the save
worker (the open file's copy), and the render worker, which keeps 106 MB of
WebAssembly memory once PDFium has drawn a heavy page of the scans: it is
freed inside, but WebAssembly memory never shrinks. So the climb is each
part reaching its high-water mark (V8's heaps, PDFium's memory, the
browser's caches), not something kept that should have gone.

### Stage H: the limits (`limits.mjs`, `results/limits-*.json`)

`node bench/limits.mjs` opens files well past the everyday ones, generated
on demand (`LIMITS` in `corpus.mjs`, not part of the regular corpus or CI):
10,000 pages of text, 160 pages of scans (326 MB), and one A1 sheet drawn as
a single path of 400,000 lines. Each opens in a fresh tab watched for a
crash; page 1, all pages, a jump to the end and a save with a mark are
timed, with the longest freeze and the browser's memory.

| file (MB)          | page 1 ms       | all pages ms | save ms | longest freeze | browser MB, peak |
| ------------------ | --------------- | ------------ | ------- | -------------- | ---------------- |
| 10,000 pages (26)  | 5440            | 12020        | 5545    | 758            | 1640             |
| 160 scans (326)    | 1603            | at once      | 15087   | 157            | 3011             |
| 400,000 lines (16) | 116,564 -> 4698 | –            | 437     | 0              | 769              |

None crashed or raised an error. The sheet of 400,000 lines was the one
real limit: pdf.js strokes its one path in the canvas, which slows far
faster than the line count (116 s for ten times the lines of a sheet it
draws in 2.5 s), and a single stroke cannot be stopped once begun. PDFium
draws the same page in 1.1 s. The render worker now counts a page's points
as pdf.js builds its paths through the canvas, on the page's first drawing;
past 30,000 in one path or 200,000 on the page it stops before the stroke,
and PDFium draws that page from then on, whole page and parts. Page 1 of
the 400,000 lines now shows in 4.7 s (loading PDFium included), the
everyday CAD file's in 1.7 s (was 2.9). Pages with form fields stay pdf.js's,
and text pages are untouched (a smoke check holds them pixel for pixel to
pdf.js). PDFium draws a hairline at least a pixel wide where pdf.js draws it
fainter, as Chrome's own viewer does; the smoke check asks that every line
pdf.js inks has PDFium's ink within a pixel (100%).

Known limits, not changed here:

- 10,000 pages: the time to page 1 grows with the page count (1.2 s for
  2,000 pages, 5.4 s for 10,000), with freezes up to 0.8 s, from making and
  laying out a box for every page up front. Beyond that, a page list that
  makes boxes only near the screen would be needed.
- 326 MB: saving peaks at 3 GB for the browser, the file being held by the
  page, pdf.js's parser, the render worker and the save worker, and once
  more in the saved file. Fine on a desktop; too much for a phone.

### Stage H: short of memory (low-memory mode)

A device that says it has 4 GB or less (`navigator.deviceMemory`), or a touch
device that does not say (iPhones and iPads, whose tabs the system closes
first), runs in low-memory mode; `?lowmem=1` turns it on anywhere. It keeps
pages drawn two screens out rather than four (1,500 px at least, not 3,000),
thumbnails 1,500 px beyond the rail's view rather than 4,000, and caps one
page's bitmap at 4 million pixels (4096 on a side) where a desktop takes 22
million; zoomed past that, the detail layer draws the part on screen sharp
as before.

On any device, in Chrome (the one browser that reports it), the page's script
memory is read every 5 s: past three quarters of what the browser allows,
every page and thumbnail off screen gives its picture back at once, and the
low-memory caps hold until use falls under half. "Copy diagnostics" says
whether the mode is on and how often pictures were released.

The smoke test emulates a 2 GB phone: reading down thirty pages, no page
more than 1,800 px off screen is still drawn (the same reading on the test
machine keeps pages further out), and with memory short only the pages on
screen keep their pictures.

### Stage H: accessibility

axe-core (WCAG 2.1 A and AA, and axe's best practices) was run on the home
screen, the document view, the Save popover, search and the dark interface,
on a desktop and a phone. The words of the PDF (the text layer) were left
out: they are the document's, not the app's. It found:

- no landmarks: the toolbar, ribbon, tool options, side panel and pages
  were not marked, so a screen reader could not jump between them. They are
  now a banner, two labelled regions, a side panel and the main area
  ("Document"); on the home screen its content is the main area.
- no heading in the document view: a heading, read out and not shown, now
  names the file and its page count.
- the blue of the light interface (#1473E6) as text on its greys: 3.7:1 and
  4.0:1 (the active ribbon tab, the current page's number), under the 4.5:1
  asked for. Blue text is now #0D5FC2 (5.0:1 and 5.4:1); fills keep #1473E6.

Checked by hand, which axe cannot see:

- while the home screen shows, the app under it is inert: the keyboard and
  screen readers no longer reach the toolbar and pages behind it.
- the popovers (Save, Add pages, Extract, Translate…) are labelled dialogs;
  opened from the keyboard, the focus goes to their first control, and
  Escape brings it back to the button they opened from.
- messages ("Mark removed", "Diagnostics copied"…) are read out.
- each page is labelled "Page N", and its drawn number is not read twice.

The smoke test runs axe on the home screen, the document, the Save popover
and the dark interface and asks for no finding, and checks the focus into
and out of two popovers.

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
