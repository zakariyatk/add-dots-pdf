# ADD DOTS PDF

PDF reader and editor for web, Windows, iOS and Android.

This repo is being rebuilt in phases. The plan is in `C:\Users\zak\.claude\plans\linear-wibbling-babbage.md`, and the v1 app is tagged `v1-legacy` as the reference for how things should behave.

## Layout

```
apps/web            the editor, served by Vite (v1 code under public/, unchanged)
apps/desktop        the Windows app: apps/web in a Tauri window (see its README)
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

## Deploying the web app (unchanged from v1)

Upload `apps/web/dist/` plus `legacy/api/` (as `api/`) to the host, then follow the Hostinger steps in `legacy/README.md`.
