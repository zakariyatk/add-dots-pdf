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
| Live | https://pdf.adddots.com/     | What people use. The Windows and phone apps share documents through it (`shareServer` in `apps/web/public/js/config.js`). |
| Test | https://staging.adddots.com/ | Every change goes here first and is tried before it goes live.                                                            |

The browser app works out its own address, so the same build runs on both;
share links made on the test site point to the test site. Give the test
site its own `api/config.php` and database, so trying things there never
touches live documents or links.

## Publishing

`.github/workflows/deploy.yml` (Actions → **Publish**) puts the web app on
the server over FTP:

- after CI passes on `main`, on the **test site** by itself;
- on the **live site** when you choose it: Actions → Publish → Run workflow →
  `live`.

It uploads `apps/web/dist/` plus `legacy/api/` (as `api/`), but never
`api/config.php` (each site keeps its own) or `api/setup.php`. Afterwards it
checks that the site serves what was uploaded.

### Setting it up (once)

1. **Hostinger, per site:** hPanel → Domains → Subdomains: `pdf` (and
   `staging`), each with its own folder; hPanel → Security → SSL: a
   certificate for each.
2. **GitHub secrets** (Settings → Secrets and variables → Actions):
   `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` from hPanel → Files → FTP
   Accounts, and `FTP_DIR_LIVE` / `FTP_DIR_STAGING`: each site's folder as
   that FTP account sees it, ending in `/`. If the host refuses FTPS, add the
   variable `FTP_PROTOCOL` = `ftp`.
3. **The share server, per site, the first time:** make a MySQL database,
   upload `api/config.php` (from `api/config.example.php`, with its details)
   and `api/setup.php`, open `/api/setup.php` once, then delete it. The
   Hostinger steps in `legacy/README.md` have the details.
4. **`.htaccess`** in each site's folder (edit the one Hostinger made): add
   `AddType application/manifest+json .webmanifest`, so browsers offer to
   install the app.
5. **Supabase** → Authentication → URL Configuration: Site URL
   `https://pdf.adddots.com`, and both sites in the Redirect URLs
   (`docs/accounts.md`).

To protect the live site, add required reviewers to the `live` environment
(Settings → Environments → live): each live publish then waits for approval.
