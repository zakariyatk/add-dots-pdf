/* Fetches PDFium, which the Windows app draws pages with (src-tauri/src/pdfium.rs),
   into src-tauri/pdfium/: pdfium.dll on Windows (bundled with the app),
   libpdfium.so on Linux (for `cargo test`).

     node scripts/get-pdfium.mjs

   A pinned build of github.com/bblanchon/pdfium-binaries, checked against its
   sha256 before it is used. To move to a newer one, change TAG and the sums.
   Its licences (BSD-style, PDFium's and its libraries') go beside it. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'chromium/8076';
const BUILDS = {
  'win32-x64': {
    file: 'pdfium-win-x64.tgz',
    sha256: '808d36da9bc5a3104315fb307c80998121f565ee53953633bf33e80d7429e5ac',
    lib: 'bin/pdfium.dll',
    out: 'pdfium.dll',
  },
  'linux-x64': {
    file: 'pdfium-linux-x64.tgz',
    sha256: 'd9d67bc40af03aef4fe28a60b19b1086f28ace019c8c9caf19cb7fe3d14ceca3',
    lib: 'lib/libpdfium.so',
    out: 'libpdfium.so',
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'src-tauri', 'pdfium');
const build = BUILDS[process.platform + '-' + process.arch];
if (!build) {
  console.error('no PDFium build pinned for ' + process.platform + '-' + process.arch);
  process.exit(1);
}
const stamp = join(dest, 'VERSION.txt');
if (
  existsSync(join(dest, build.out)) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8').trim() === TAG + ' ' + build.sha256
) {
  console.log('PDFium ' + TAG + ' already in ' + dest);
  process.exit(0);
}

const url = 'https://github.com/bblanchon/pdfium-binaries/releases/download/' + TAG + '/' + build.file;
const res = await fetch(url);
if (!res.ok) {
  console.error(url + ': HTTP ' + res.status);
  process.exit(1);
}
const tgz = Buffer.from(await res.arrayBuffer());
const sum = createHash('sha256').update(tgz).digest('hex');
if (sum !== build.sha256) {
  console.error(build.file + ': sha256 ' + sum + ', expected ' + build.sha256);
  process.exit(1);
}
const tmp = mkdtempSync(join(tmpdir(), 'pdfium-'));
try {
  writeFileSync(join(tmp, build.file), tgz);
  /* tar is on Windows 10+ and every Linux */
  execFileSync('tar', ['-xzf', build.file], { cwd: tmp });
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(tmp, build.lib), join(dest, build.out));
  copyFileSync(join(tmp, 'LICENSE'), join(dest, 'LICENSE'));
  writeFileSync(stamp, TAG + ' ' + build.sha256 + '\n');
  console.log('PDFium ' + TAG + ' -> ' + join(dest, build.out));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
