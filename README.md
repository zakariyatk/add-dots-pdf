# ADD DOTS PDF

PDF reader and editor for web, Windows, iOS and Android.

- Web: https://pdf.adddots.com/
- Windows: [Microsoft Store](https://apps.microsoft.com/detail/9PGHPBRMLQMS)

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

| Site | Address                  | What it is for                                                                                                            |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Live | https://pdf.adddots.com/ | What people use. The Windows and phone apps share documents through it (`shareServer` in `apps/web/public/js/config.js`). |

There is no test site: every change that passes CI on `main` goes live.

## Publishing

`.github/workflows/deploy.yml` (Actions → **Publish**) puts the web app on
the server over FTP:

- after CI passes on `main`, on the **live site** by itself;
- again by hand: Actions → Publish → Run workflow.

It uploads `apps/web/dist/` plus `legacy/api/` (as `api/`), but never
`api/config.php` (each site keeps its own) or `api/setup.php`. Afterwards it
checks that the site serves what was uploaded.

### Setting it up (once)

1. **Hostinger, per site:** hPanel → Domains → Subdomains: `pdf`, with
   its own folder; hPanel → Security → SSL: a certificate for it. Add `www.pdf.adddots.com` too, redirecting to
   `https://pdf.adddots.com/` (hPanel → Domains → Redirects), so both
   addresses work.
2. **GitHub secrets** (Settings → Secrets and variables → Actions):
   `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` from hPanel → Files → FTP
   Accounts, and `FTP_DIR_LIVE`: the site's folder as
   that FTP account sees it, ending in `/`. If the host refuses FTPS, add the
   variable `FTP_PROTOCOL` = `ftp`.
3. **The share server, the first time:** make a MySQL database,
   upload `api/config.php` (from `api/config.example.php`, with its details)
   and `api/setup.php`, open `/api/setup.php` once, then delete it. The
   Hostinger steps in `legacy/README.md` have the details.
4. **`.htaccess`** in the site's folder (edit the one Hostinger made): add
   `AddType application/manifest+json .webmanifest`, so browsers offer to
   install the app.
5. **Supabase** → Authentication → URL Configuration: Site URL
   `https://pdf.adddots.com`, and the site in the Redirect URLs
   (`docs/accounts.md`).

Publishing waits for nobody: leave the `live` environment (Settings →
Environments → live) without required reviewers, or each publish stops for
approval.
