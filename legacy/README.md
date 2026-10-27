# Add Dots PDF Editor

A full PDF reader and editor that runs in the browser, plus a small PHP/MySQL
backend that turns any open document into a review link you can send to someone.

The editor itself needs no server at all. The backend is only for sharing.

## Layout

```
index.html          markup only — no inline CSS or JS
manifest.webmanifest
                    name, icons and file handlers for the installed app
sw.js               service worker: runs offline, updates itself when online
css/
  app.css           the original viewer styling
  pro.css           styling for everything added on top
  light.css         the light (default) interface; dark is the original look
js/
  core.js           viewer, page model, marks, search, save, pins, translate
  annotate.js       text markup, ink, sticky notes, stamps, comments panel
  draw.js           circle, revision cloud, arc, dimension (with calibration)
  organize.js       reorder, merge, insert, split, duplicate, Organize grid
  forms.js          AcroForm filling, signatures
  docops.js         watermark, header/footer, Bates, redaction, print, properties
  navigate.js       the Pan (hand) tool — unbounded, and hold-Space panning
  toolbar.js        tool order, group dividers, phone dock and sheet routing
  share.js          upload, share links, live review comments
  site-nav.js       the adddots.com header menu
  pwa.js            install prompt, worker registration, PDFs opened by the OS
  vendor/           pdf.js, its worker, and pdf-lib — all local
assets/
  icons/            the app icons, rasterised from icons/icon.svg
api/
  index.php         front controller and the whole route table
  setup.php         one-time installer — DELETE IT after running
  config.php        your database details (you create this; never commit it)
  src/              one class per job
  migrations/       the schema
  tests/            unit and end-to-end suites
```

`Add Dots PDF Editor.html` is the original browser "Save page as" dump the
project started from. Everything real was extracted out of it and nothing loads
from it now. About 1,800 of its 8,144 lines were CSS injected by browser
extensions (a flight-price widget, an AliExpress importer, Grammarly).

---

## Deploying to Hostinger

1. **Upload** everything except `Add Dots PDF Editor.html`, its `_files`
   folder, and `api/tests/` into `public_html` (or a subfolder such as
   `public_html/pdfreader`).

2. **Make a database** in hPanel → Databases → MySQL Databases. Note the
   database name, user and password — Hostinger prefixes them with your
   account id, like `u123456_pdfreader`.

3. **Create `api/config.php`** by copying `api/config.example.php` and filling
   in those details. It is the only file with secrets in it.

4. **Raise the upload limit** in hPanel → Advanced → PHP Configuration if you
   need documents bigger than the default. Both `upload_max_filesize` and
   `post_max_size` matter, and the smaller one wins.

5. **Open `api/setup.php` once** in a browser. It checks PHP, the database,
   the storage folder and the extensions, then creates the four tables and
   confirms they exist.

6. **Delete `api/setup.php`** from the server, and set `'debug' => false` in
   `api/config.php`.

Uploaded PDFs are written to `storage_path`, which defaults to one level above
the web root. Nothing there is reachable by URL — every download goes through
the API, which checks the token first.

### Checking it works

```bash
php api/tests/unit.php
php api/tests/integration.php https://yourdomain.com/api
```

The integration suite makes real writes, so point it at a staging copy rather
than a live site. It cleans up the records it creates.

---

---

## Installing it as an app

The editor is a progressive web app. `manifest.webmanifest` describes it, `sw.js`
keeps it current, and `js/pwa.js` joins the two to the page. Chrome and Edge then
offer **Install** three ways: the icon in the address bar, an *Install app* button
next to *Select files*, and a card that comes up by itself in the corner of the
home panel. Safari has no install prompt at all — there it is Share → Add to Home
Screen, by hand, and both the button and the card stay hidden.

### The install card

A browser will not open its own install dialog unasked: Chrome only opens it in
response to a click. So the card is what asks for that click, and `prompt()` runs
from the click on **Install**.

It appears a couple of seconds after the browser says the app can be installed,
and it is careful about when:

- never over a document. If the offer arrives while someone is reading, it waits
  and comes up the next time they are on the home panel;
- **Not now** — or Escape — puts it away for **30 days**, remembered in
  `localStorage` under `adpdf-install-snooze`;
- it never appears in the installed app, because the browser does not raise the
  event there;
- it cannot be clicked before it has faded in, which matters in a background tab
  where the browser holds back the frame that fades it.

On **iPhone and iPad** there is no event to wait for — Safari has no install
prompt on any platform — so the same card comes up on its own timing and carries
the two steps instead: Share, then *Add to Home Screen*. The Install button is
gone from it, *Not now* becomes *Got it*, and the button on the home panel brings
the card back rather than prompting. `apple-mobile-web-app-capable` in the head
is what makes the result open without Safari's chrome. **Android Chrome** needs
none of this: it raises the event and behaves like the desktop.

Change `MONTH` in `js/pwa.js` to make it ask again sooner or later than that.

Three things have to be true before a browser will offer the install, and all
three are in the repo already:

- a manifest with a name, a `start_url`, `display: standalone`, and 192px and
  512px icons — they live in `assets/icons/`, rasterised from `icon.svg`, which
  is the same square-and-AD lockup as `.admark` in the toolbar;
- a service worker with a `fetch` handler — `sw.js`;
- **HTTPS**. `http://localhost` counts, so the local server is enough to test
  with, but a plain `http://` domain will never show the option.

Every path in the manifest and the worker is relative, so the app installs the
same from `adddots.com/pdfreader/` as it would from the root of a domain.

Installed, it runs in its own window with no browser chrome, and it registers
as a handler for `.pdf`, so **Open with → Add Dots PDF** hands the file to
`ADDPDF.openFiles` — the same path the file picker uses, which is why several
files selected at once still merge in order.

### Offline, and current, at the same time

The app runs from a cache: it opens with no connection at all, and everything
the editor does — opening a PDF, marking it up, saving it — was already local,
so a plane or a basement changes nothing.

Being cached is usually how an app ends up stale, and this one does not, because
the worker checks itself against the server whenever there is a connection:

1. every file is answered from the cache, then revalidated behind the reader's
   back — a conditional request the server answers with a 304 when nothing has
   changed, so it costs headers, not bandwidth;
2. when a file *has* changed, the new copy is pulled down and stored, and the
   worker messages the page;
3. the page acts on it. **Nothing open** — it reloads itself, quietly, and the
   reader is on the new version. **A document open** — it does not touch it. It
   says an update is ready and leaves the reload to them, because swapping the
   scripts under a document full of unsaved marks would cost work. The new
   files are already downloaded either way, so the next ordinary load is
   instant and current.

So a tool you change and upload reaches people by itself. There is no version
to bump, nothing for anyone to clear, and no "hard refresh" to explain.

A window left open for days is not fetching anything, so the page asks for a
check at three moments: when the machine comes back **online**, when the window
is brought back to the **front**, and every **half hour**. The coming-back-online
one is the case this was built for — work offline all day, reconnect, and the
update lands.

"Changed" means the server's `ETag` or `Last-Modified` differs from the one
stored with the cached copy. Apache sends both for static files. If a host sent
neither, the worker would keep the cache fresh but stay quiet rather than guess,
since a guess would reload the page on every load.

### What is never cached

Anything under `api/`, and any request that is not a GET. Share links, uploads
and the live review comments are always the server's answer, never a stored one.

A PDF is never cached either: a document you open is read from disk into memory
and stays there.

Bump `VERSION` in `sw.js` if you ever want the stored copy thrown out wholesale
— after replacing the vendored pdf.js, say. Day-to-day changes do not need it.

### If the install option never appears

Check, in this order: the page is on HTTPS; `manifest.webmanifest` returns 200
rather than a 404 from a rewrite rule; and the two PNG icons load. If the host
serves `.webmanifest` as an unknown type, add this to `.htaccess` at the app
root — note that Hostinger may already have an `.htaccess` there, so edit it
rather than uploading over it:

```apache
AddType application/manifest+json .webmanifest
```

Chrome's Application panel (DevTools → Application → Manifest) names whichever
requirement is missing.

## How sharing works

There are **no accounts**. Access is by secret link, which is what lets a
reviewer open one and comment without signing up.

| Link | Shape | What it does |
| --- | --- | --- |
| Owner | `?d=<id>#k=<token>` | Full control: manage links, delete the document |
| Share | `?s=<token>` | View, comment or edit, as the owner chose |

A token is 32 random bytes — 256 bits, so guessing one is not a threat model.
**Only the SHA-256 of a token is ever stored**, so a copy of the database opens
nothing. That is also why a link is shown exactly once when it is created: the
server genuinely cannot show it to you again. Lose one and you revoke and
reissue it.

The owner token sits in the URL **fragment**, which browsers never send to the
server — so it stays out of access logs and `Referer` headers.

Each share link can carry a role, an expiry, a password and whether the PDF may
be downloaded, and can be switched off and back on without deleting it.

### Why reviewer comments are not part of the document

A comment stores its own geometry (`anchor_json`) instead of being written into
the owner's saved marks. Two consequences, both deliberate:

- Two people commenting at the same moment cannot overwrite each other.
- Nothing a reviewer does can corrupt the document itself.

The owner's own marks are saved separately, with optimistic locking: you send
the version you started from, and a stale write is refused rather than quietly
clobbering someone else's.

Shared hosting has no websockets, so the client polls every 10 seconds with
`?since=`, which returns only what changed. Deletions come back as tombstones
so clients know to drop them.

---

## API

All routes are under `/api`. Authentication is `Authorization: Bearer <token>`,
falling back to `?token=` for the file endpoint (an `<img>` or `<iframe>` src
cannot set headers). No cookies are set anywhere, which is what makes the API
immune to CSRF.

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `health` | anyone |
| `GET` | `resolve` | any valid token — says which document it opens |
| `POST` | `documents` | anyone — returns the owner token once |
| `GET` | `documents/{id}` | any valid token |
| `DELETE` | `documents/{id}` | owner |
| `GET` | `documents/{id}/file` | any valid token |
| `PUT` | `documents/{id}/state` | owner, edit |
| `GET`/`POST` | `documents/{id}/shares` | owner |
| `PATCH`/`DELETE` | `documents/{id}/shares/{shareId}` | owner |
| `GET` | `documents/{id}/comments` | any valid token |
| `POST` | `documents/{id}/comments` | comment, edit, owner |
| `PATCH`/`DELETE` | `documents/{id}/comments/{commentId}` | the author, or owner/edit |

`PATCH`, `PUT` and `DELETE` can be tunnelled through `POST` with
`X-HTTP-Method-Override`, because some shared hosts still drop them.

---

## How the frontend modules plug in

`core.js` publishes a small bridge on `window.ADDPDF`. Feature modules load
after it and register through that rather than editing core:

| What you register | Where it goes | Effect |
| --- | --- | --- |
| `X.shapeRenderers[type]` | `(it, s, vp, idx) → SVGElement` | draws the mark on screen |
| `X.shapePainters[type]` | `(page, s, ctx)` | draws the mark into the saved PDF |
| `X.fontNeeds[type]` | `(s) → 'Helvetica'` | embeds a standard font for that mark |
| `X.tools[id]` | `{down, move, up}` | a pointer tool on the page |
| `X.prepare[]` | `async (out, items, extra)` | async work before painting (image embeds) |
| `X.finish[]` | `async (out, items, slots, extra)` | async work after painting (metadata) |
| `X.addRibbonTab(tabId, panId)` | — | a new ribbon tab |
| `X.on('ready' \| 'pages' \| 'reset' \| 'tool')` | — | lifecycle hooks |
| `X.openFiles(files)` | `async (File[])` | opens a PDF as the picker does — merging the rest, reattaching a saved report |
| `X.markPop[type]` | `{el, sync(s)}` | extra controls on the properties popover for that mark type |

The key idea: **a mark is a plain object in `it.shapes`, stored in PDF points.**
Because of that, undo, Save, the JPG export and the thumbnails all handle new
mark types with no extra wiring. `'ready'` is sticky, so a module that loads
after core still receives it.

### The marks

`rect` `line` `arrow` `text` `pin` (core) ·
`markup` `ink` `note` `stamp` (annotate) ·
`ellipse` `cloud` `arc` `dim` (draw) · `sig` (forms) ·
`redact` `wm` `hf` `bates` (docops) · `remote` (share — server-owned, never
written into the PDF)

---

## Two deliberate trade-offs

**Filled form fields are flattened on save.** Saving rebuilds the document page
by page — that is what lets pages be reordered, dropped and merged — and a
rebuilt page cannot carry the original interactive widgets. Values are
therefore painted into the page, which is what an issued, signed copy should be
anyway.

**Redaction rasterises the page.** A black rectangle drawn over live text is
the classic way to leak a document, so *Apply* re-renders each marked page with
the boxes burnt in and replaces the page with that image. The covered content is
genuinely gone — verified by extracting zero text afterwards — but the rest of
that page's text stops being selectable. Keep the original.

---

## Keyboard

| Key | Action |
| --- | --- |
| `V` | Select |
| `Space` (hold) | Pan — borrowed from whatever tool is live, given back on release |
| Middle-mouse drag | Pan from any tool, without switching tool at all |
| `X` `L` `A` `E` `C` `M` | Box, line, arrow, text, crop, pin |
| `Shift+C` `Shift+L` | Circle, revision cloud |
| Double-click a dimension | Retype its reading |
| `Shift+A` `Shift+D` | Arc, dimension |
| `U` `D` | Underline, strike out |
| `N` `B` | Sticky note, stamp |
| `Shift+H` | Highlight |
| `Shift+P` | Pen |
| `Shift+X` | Redact |
| `Shift+O` | Organize pages |
| `Shift+S` | Signature |
| `Ctrl+P` | Print |
| `Ctrl+F` Find · `Ctrl+Z` Undo · `Ctrl+S` Save · `Ctrl+O` Open |

Highlight, Pen and Redact sit on `Shift` because core already owns plain `k`
(previous page), `p` (fit page) and `r` (rotate). Pan has no letter of its own —
`h` is Home — so it lives on the **View** tab beside the zoom controls, and on
held `Space`.

### Drawing tools

Circle, revision cloud, arc and linear dimension. Each is **two points**, the
same shape core's own box and line marks take — so selecting, moving, resizing
and rotating come straight from core, and so do undo, Save, the JPG export and
the thumbnails. A mark tells core which grips it wants through `X.handleKind`:
`rect` for the box-shaped ones, `line` for the chord-shaped ones.

`Shift` does the obvious thing in each: a true circle, and an arc that bulges
the other way. Scallop size and bulge depth sit in the mode bar.

New marks are **1pt** by default — `WIDTHS` in `js/core.js` is `[1, 3, 5]` and
the first is the default. A dimension or a circle on a drawing is a drafted
line, not a highlighter stroke, and 3pt swamped the detail underneath. The other
two widths are a click away, and any mark's width is editable after the fact in
the properties popover.

Curves are written into the PDF as short straight segments rather than as an
SVG path. pdf-lib's path drawing has its own flipped coordinate system and its
own idea of where the origin sits; approximating the curve the same way on
screen and on paper costs a few more operators but is exactly right in both
places, which matters on a drawing someone builds from.

#### Dimensions, scale and calibration

A PDF point is 1/72 inch, so a drawing issued at actual size measures correctly
straight away — 595 pt reads as 210 mm, which is A4.

Drawings are rarely at actual size, so the dimension tool carries a **Scale**
list: 1:1 through 1:500. A plan at 1:50 draws a 50 mm wall as 1 mm of paper, so
the paper measurement is multiplied by the denominator to read back as the real
thing. **Units** is separate from that — mm, cm, m, in or pt — because a 1:100
site plan is usually read in metres while its details are in millimetres.

When the sheet's scale is not written on it, **Calibrate** works it out: drag
along something whose real length you know, type that length in, and the scale
is derived and reported back as a ratio.

**Scale, Units and Calibrate also sit on the properties popover** of a selected
dimension, not only on the ribbon. A dimension is normally drawn and then the
tool put down — which used to take the ribbon row away at exactly the moment
someone reads the number and wants to correct the scale behind it. Both copies
drive the same setting and stay in step. Calibrating from the popover picks the
dimension tool back up for you, since calibrating means drawing a line.

**Double-click any dimension to retype its reading**, for when the drawing says
one thing and the site says another. No need to select it first — the
double-click hit-tests the line directly. Clearing the text returns it to the
measured value.

### Phone and tablet

The three widths are genuinely different layouts, not one layout that shrinks:

| Width | Tools live in | Notes |
| --- | --- | --- |
| Phone (≤760px) | the bottom dock, scrolling | the ribbon and its tabs are hidden |
| Tablet (761–1100px) | the ribbon, scrolling | narrower buttons, coarse-pointer targets |
| Desktop | the ribbon | full labels |

Two things follow from that, and both were broken until they were fixed:

The dock used to divide the width evenly between its buttons. That was fine for
seven tools and unusable for seventeen — each got **20px**, under half the size
a fingertip can reliably hit, and the labels collided. The dock now scrolls and
every button keeps a real target, with dividers marking the groups.

The Form and Document tabs live in the ribbon, which a phone never shows, so
their tools were simply **unreachable** there. `toolbar.js` hands those groups
to `X.mobileSheet()`, which carries them into the more-sheet instead. All 27
tools are reachable on a phone.

The tools are split across two tabs, both defined in `toolbar.js`:

| Tab | Holds |
| --- | --- |
| **Edit** | Select, text, highlight/underline/strike, pen, note, stamp, crop, pin |
| **Draw** | Select, box, circle, line, arrow, arc, cloud, dimension |

`setTool` shows whichever tab the tool's button lives on. It used to always
jump to Edit, which was right when that was the only tool tab — with a Draw
tab, picking a circle would have thrown you back to Edit every time.

Draw carries its own Select button, tagged `data-tool-btn="select"` so core
keeps it in step with the one on Edit. On a phone there are no tabs, both
groups share the dock, and that duplicate is hidden.

Anything a module adds that neither list names stays on Edit rather than
disappearing.

The sidebar tab strip had the same problem in miniature: built for three tabs,
now carrying five, it gave each 38px and the labels ran into one another. It is
a two-column grid now — four tabs in two rows, with Review stretching across a
third once a document has been shared. Flex wrapping was tried first and was
worse: `flex: 1 1 auto` grows each item to fill its row, so five tabs became
four rows.

### Tools are toggles

Every tool button is a toggle: press it to pick the tool up, press it again to
put it down. There is one `toggleTool()` in core and every button and shortcut
routes through it, so a button and its key cannot drift apart. Before this the
only way out of a tool was the **Done** button in the mode bar, which is not
where anyone looks.

Escape also puts the tool down — unless a dialog is open, in which case Escape
belongs to the dialog and dropping the tool as well would be a second,
unasked-for thing happening on one key press.

### Popovers and dialogs

Core's popovers toggle, but the list of which ones existed — and which buttons
were allowed to open them — was hardcoded in two places: `closePops()` and the
click-outside handler. A module's popover was in neither, so its button opened
something that was closed again a millisecond later by the same click.

Both are extensible now. A module calls
`X.registerPop('splitPop', 'btnSplit')` — the popover **and** its anchor — and
then `X.togglePop(id, anchor)` behaves exactly like core's own.

Every dialog toggles: Split, Organize, Share, Signature, and each Document
panel. Pressing a *different* Document button swaps the panel rather than
closing it, which is what you want when comparing two of them.

Option rows inside a popover use `.opt` / `.optlabel` / `.optnum` / `.optfield`.
They exist because app.css styles `.pop label` for stacked forms — mono,
uppercase, 10px — and `.pop input` at 100% by 34px. A radio button picked up
both, which is how the Split panel ended up with giant circles beside shouting
labels. Only the field belonging to the selected option stays enabled.

### Touch

A tool registers `cancel` alongside `down`/`move`/`up`. Core calls it the
moment a second finger lands, because abandoning a gesture is not the same as
finishing it — `up` commits the mark, so a pinch-zoom was drawing the very
circle the guard existed to prevent. Every module tool implements `cancel`.

Under `@media (pointer: coarse)` the minimum target is 44px, and hover-only
affordances (page tools, thumbnail controls) are permanently visible.

### Pan is a view mode, not an editing mode

The Pan tool declares itself `bare`, so `setTool` gives it none of the editing
chrome — no mode bar, no colour row, no **Done**. You are not in a mode you have
to leave; you are just looking at the page from somewhere else. Any module tool
can opt out the same way.

There are three ways to pan, and the middle mouse button is the one that costs
nothing: it pans from whatever tool is live and **does not switch tool**, so you
can be halfway through an arrow, shove the page across, and carry on. Chrome's
autoscroll ring is suppressed on middle-down so it does not fight the drag.

### Panning is not bounded by the content

A scroller stops dead at the edge of what it holds, which is the wrong
behaviour when you are zoomed into the corner of a large drawing and want to
swing it into the middle of the screen.

The drag is therefore tracked as one continuous coordinate per axis. Whatever
the scroller will take it takes; everything it refuses becomes a CSS translate
on the pages, so the document floats free in all four directions. Dragging back
consumes that float before it touches the scroller again, so there is no jump
at the hand-over.

The translate is applied to `.pagebox`, which does **not** move `offsetTop` —
so `goTo`, the lazy-render pass and the thumbnails are all untouched by it.
A **Recentre** pill appears over the page once it has been floated — over the
page rather than in the toolbar, so the toolbar never jumps, and it fades out
while a drag is in progress so it cannot sit under the pointer. Double-clicking
while panning does the same, and jumping to a page or hitting Fit width clears
the float automatically (otherwise the page would land off screen).

---

## Privacy

Editing happens entirely on the device. The pdf.js worker used to be pulled
from a CDN, which quietly broke that promise and the offline story; it is now
vendored in `js/vendor/`.

A document only reaches the server when you press **Share**, and only that
document — nothing else in the app phones home.

Installing changes none of that. The service worker caches the app's own files
and nothing else: a PDF you open is read from disk into memory, never written
into a cache, and `api/` is excluded from the worker outright.
