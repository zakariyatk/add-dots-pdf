# ADD DOTS PDF

PDF reader and editor for web, Windows, iOS and Android.

This repo is being rebuilt in phases. The plan is in `C:\Users\zak\.claude\plans\linear-wibbling-babbage.md`, and the v1 app is tagged `v1-legacy` as the reference for how things should behave.

## Layout

```
apps/web            the editor, served by Vite (v1 code under public/, unchanged)
apps/desktop        the Windows app: apps/web in a Tauri window (see its README)
apps/mobile         the Android (later iOS) app: apps/web in Capacitor (see its README)
packages/engine     PDF engine in TypeScript, no UI; filled in during Phase 1
legacy/api          PHP/MySQL share-link API; replaced by Supabase in Phase 7
legacy/README.md    v1 documentation: modules, marks, keyboard, deploying
design/             redesign mockups (Web, iOS) and the reference image
```

## Commands

```bash
npm install          # once
npm run dev          # the editor at http://localhost:5173
npm test             # all tests
npm run typecheck
npm run lint
npm run build        # apps/web/dist, deployable as a static site
```

Requires Node 20 or newer. The PHP tests need PHP 8.2: `php legacy/api/tests/unit.php`.

## Sites

| Site | Address                      | What it is for                                                                                                            |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Live | https://app.adddots.com/     | What people use. The Windows and phone apps share documents through it (`shareServer` in `apps/web/public/js/config.js`). |
| Test | https://staging.adddots.com/ | Every change goes here first and is tried before it goes live.                                                            |

The browser app works out its own address, so the same build runs on both;
share links made on the test site point to the test site. Give the test
site its own `api/config.php` and database, so trying things there never
touches live documents or links.

## Deploying the web app (unchanged from v1)

Upload `apps/web/dist/` plus `legacy/api/` (as `api/`) to the test site first, check it, then to the live site. Follow the Hostinger steps in `legacy/README.md` for each.
