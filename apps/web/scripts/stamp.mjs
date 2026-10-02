/* Puts the build's version on every address of the app's own code, so a cache
   in front of the website (Hostinger's CDN keeps .js and .css for days) can
   never hand out last week's core.js beside this week's index.html.

     node scripts/stamp.mjs <site folder> <version>

   Run by .github/workflows/deploy.yml on the copy it uploads; the apps and
   dist/ keep plain addresses. Only quoted addresses that name a file in the
   site are touched: 'js/core.js' becomes 'js/core.js?v=<version>' in
   index.html, sw.js and the app's scripts, and so do the addresses the
   workers use ('engine.js', 'vendor/pdf.min.js'), and sw.js gets a new
   VERSION so every browser fills a fresh cache. */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !/^[\w.-]+$/.test(version || '')) {
  console.error('usage: node scripts/stamp.mjs <site folder> <version>');
  process.exit(2);
}

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/* the files an address can name: the site's scripts, styles and wasm */
const files = [...walk(join(dir, 'js')), ...walk(join(dir, 'css'))]
  .map((p) => relative(dir, p).split(sep).join('/'))
  .filter((p) => /\.(js|css|wasm)$/.test(p));

/* as the page names them (js/core.js) and as a worker in js/ does (engine.js) */
const names = new Set(files);
for (const f of files) if (f.startsWith('js/')) names.add(f.slice(3));
/* and the service worker, which the CDN keeps for a week like the rest */
if (existsSync(join(dir, 'sw.js'))) names.add('sw.js');
const quoted = new RegExp(
  '([\'"])(' + [...names].map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') + ')\\1',
  'g',
);

/* the page, the service worker and the app's own scripts (not the vendored
   libraries: nothing in them names our files) */
const targets = [
  'index.html',
  'sw.js',
  ...files.filter((f) => f.startsWith('js/') && !f.startsWith('js/vendor/') && f.endsWith('.js')),
];
let total = 0;
for (const t of targets) {
  const p = join(dir, t);
  if (!existsSync(p)) continue;
  const before = readFileSync(p, 'utf8');
  let n = 0;
  let after = before.replace(quoted, (m, q, name) => {
    n++;
    return q + name + '?v=' + version + q;
  });
  if (t === 'sw.js') {
    const v = after.replace(/const VERSION = '([^']*)';/, "const VERSION = '$1-" + version + "';");
    if (v === after) {
      console.error('sw.js has no VERSION line');
      process.exit(1);
    }
    after = v;
  }
  if (after !== before) writeFileSync(p, after);
  if (n) console.log('stamped ' + n + ' address(es) in ' + t);
  total += n;
}
if (!total) {
  console.error('nothing was stamped: the site folder does not look like the app');
  process.exit(1);
}
