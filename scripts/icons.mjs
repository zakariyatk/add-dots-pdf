/* Every icon of the app, drawn from the Add Dots PDF logo: a page with AD
   and three dots on a black square.

     node scripts/icons.mjs

   Writes the website's icons and tab icon, the Windows app's (.ico, .png,
   .icns and the Store's tiles), and the Android and iOS apps' icons and
   splash screens. The logo is drawn here (LOGO below); change it here and
   run this again. Chromium draws each size (playwright-core, as the e2e
   tests use it); the PNGs are written here, without an alpha channel where
   the old ones had none (Apple turns down an app icon with one). */

import { writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('playwright-core');

/* the logo on a 100-unit square, without its black square */
const LOGO =
  '<path d="M33 18.5H54V31a7 7 0 0 0 7 7H74.5V75a7.5 7.5 0 0 1-7.5 7.5H33a7.5 7.5 0 0 1-7.5-7.5V26a7.5 7.5 0 0 1 7.5-7.5z" fill="#fff"/>' +
  '<path d="M57.8 19.2L74 35.4H62a4.2 4.2 0 0 1-4.2-4.2z" fill="#7357FF"/>' +
  '<path d="M36.3 58.8L41.7 52.2L43.9 58.8z" fill="#7357FF"/>' +
  '<path d="M45.8 61.4H33.6L42 47.4L51.1 63.8H58.8A9 9 0 0 0 58.8 45.8H49.9" fill="none" stroke="#000" stroke-width="4.6"/>' +
  '<g fill="#7357FF"><circle cx="40.7" cy="73" r="3.3"/><circle cx="49.9" cy="73" r="3.3"/><circle cx="59" cy="73" r="3.3"/></g>';
const BLACK = '#000';

/* the page alone, scaled about the middle (s = 1: as on the icon) */
const page = (s) => `<g transform="translate(50 50.5) scale(${s}) translate(-50 -50.5)">${LOGO}</g>`;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

/* the shapes an icon comes in, each on a 100-unit square */
const rounded = svg(100, 100, `<rect width="100" height="100" rx="20" fill="${BLACK}"/>${page(1)}`);
const square = (s) => svg(100, 100, `<rect width="100" height="100" fill="${BLACK}"/>${page(s)}`);
const round = svg(100, 100, `<circle cx="50" cy="50" r="50" fill="${BLACK}"/>${page(0.86)}`);
/* Android's adaptive icon: the page alone, inside the circle every launcher keeps */
const bare = svg(100, 100, page(0.74));
/* a tile or a splash screen: the rounded icon, `size` across, in the middle of `bg` */
const centred = (w, h, size, bg) =>
  svg(
    w,
    h,
    (bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '') +
      `<svg x="${(w - size) / 2}" y="${(h - size) / 2}" width="${size}" height="${size}" viewBox="0 0 100 100">` +
      `<rect width="100" height="100" rx="20" fill="${BLACK}"/>${page(1)}</svg>`,
  );
/* a Store tile: the page on black, as the tiles were */
const tile = (w, h) =>
  svg(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="${BLACK}"/>` +
      `<svg x="${(w - h * 0.8) / 2}" y="${h * 0.1}" width="${h * 0.8}" height="${h * 0.8}" viewBox="0 0 100 100">${page(1)}</svg>`,
  );

const SPLASH = '#F4F5F7'; /* the splash screens' grey, as before */

/* [file, width, height, svg, alpha] */
const W = 'apps/web/public/assets/icons/',
  D = 'apps/desktop/',
  A = 'apps/mobile/android/app/src/main/res/';
const I = 'apps/mobile/ios/App/App/Assets.xcassets/';
const jobs = [
  [W + 'icon-192.png', 192, 192, rounded, true],
  [W + 'icon-512.png', 512, 512, rounded, true],
  [W + 'icon-maskable-192.png', 192, 192, square(0.84), false],
  [W + 'icon-maskable-512.png', 512, 512, square(0.84), false],
  [W + 'apple-touch-icon-180.png', 180, 180, square(1), false],
  [D + 'src-tauri/icons/32x32.png', 32, 32, rounded, true],
  [D + 'src-tauri/icons/128x128.png', 128, 128, rounded, true],
  [D + 'src-tauri/icons/128x128@2x.png', 256, 256, rounded, true],
  [D + 'src-tauri/icons/icon.png', 512, 512, rounded, true],
  [D + 'msix/Assets/StoreLogo.png', 50, 50, rounded, true],
  [D + 'msix/Assets/Square44x44Logo.png', 44, 44, rounded, true],
  ...[16, 24, 32, 48, 256].map((n) => [
    D + `msix/Assets/Square44x44Logo.targetsize-${n}_altform-unplated.png`,
    n,
    n,
    rounded,
    true,
  ]),
  [D + 'msix/Assets/Square150x150Logo.png', 150, 150, tile(150, 150), true],
  [D + 'msix/Assets/Wide310x150Logo.png', 310, 150, tile(310, 150), true],
  [I + 'AppIcon.appiconset/AppIcon-512@2x.png', 1024, 1024, square(1), false],
  ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((f) => [
    I + 'Splash.imageset/' + f,
    2732,
    2732,
    centred(2732, 2732, 600, SPLASH),
    false,
  ]),
];
for (const [dpi, n] of [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]) {
  jobs.push([A + `mipmap-${dpi}/ic_launcher.png`, n, n, rounded, true]);
  jobs.push([A + `mipmap-${dpi}/ic_launcher_round.png`, n, n, round, true]);
  jobs.push([A + `mipmap-${dpi}/ic_launcher_foreground.png`, n * 2.25, n * 2.25, bare, true]);
}
for (const [dpi, w, h] of [
  ['mdpi', 320, 480],
  ['hdpi', 480, 800],
  ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600],
  ['xxxhdpi', 1280, 1920],
]) {
  jobs.push([
    A + `drawable-port-${dpi}/splash.png`,
    w,
    h,
    centred(w, h, Math.round(w * 0.28), SPLASH),
    false,
  ]);
  jobs.push([
    A + `drawable-land-${dpi}/splash.png`,
    h,
    w,
    centred(h, w, Math.round(w * 0.28), SPLASH),
    false,
  ]);
}
jobs.push([A + 'drawable/splash.png', 480, 320, centred(480, 320, 90, SPLASH), false]);

/* ---------------- PNG, ICO and ICNS, by hand ---------------- */

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/* rgba: w*h*4 bytes; alpha false writes RGB (colour type 2) */
function png(w, h, rgba, alpha) {
  const bpp = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * bpp + 1);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < bpp; c++) raw[row + 1 + x * bpp + c] = rgba[(y * w + x) * 4 + c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/* an .ico of PNGs, as Windows has read since Vista */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let at = head.length;
  images.forEach(([n, data], i) => {
    const e = 6 + i * 16;
    head[e] = n >= 256 ? 0 : n;
    head[e + 1] = n >= 256 ? 0 : n;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x[1])]);
}
/* an .icns of PNGs: 32 (ic11), 64 (ic12), 128 (ic07), 256 (ic08), 512 (ic09), 1024 (ic10) */
function icns(images) {
  const parts = images.map(([type, data]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'latin1');
    h.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([h, data]);
  });
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'latin1');
  h.writeUInt32BE(8 + parts.reduce((s, p) => s + p.length, 0), 4);
  return Buffer.concat([h, ...parts]);
}

/* ---------------- drawing ---------------- */

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage();
await tab.setContent('<body></body>');
/* Chromium draws the SVG on a canvas at the size asked, and hands back its pixels */
async function draw(w, h, text) {
  const b64 = await tab.evaluate(
    async ([w, h, text]) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let s = '';
      for (let i = 0; i < d.length; i += 0x8000)
        s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [w, h, text],
  );
  return Buffer.from(b64, 'base64');
}
const pngOf = async (w, h, text, alpha) => png(w, h, await draw(w, h, text), alpha);

for (const [file, w, h, text, alpha] of jobs) {
  writeFileSync(join(root, file), await pngOf(w, h, text, alpha));
  console.log(`${w}x${h}`.padEnd(11), file);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoFile = ico(await Promise.all(icoSizes.map(async (n) => [n, await pngOf(n, n, rounded, true)])));
writeFileSync(join(root, D + 'src-tauri/icons/icon.ico'), icoFile);
const icnsTypes = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];
writeFileSync(
  join(root, D + 'src-tauri/icons/icon.icns'),
  icns(await Promise.all(icnsTypes.map(async ([t, n]) => [t, await pngOf(n, n, rounded, true)]))),
);
console.log('ico, icns  ', D + 'src-tauri/icons/');

/* the website's own source icon and the tab icon */
writeFileSync(
  join(root, W + 'icon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">\n' +
    '  <!-- The Add Dots PDF logo. Drawn by scripts/icons.mjs, with every PNG in the apps. -->\n' +
    `  <rect width="100" height="100" rx="20" fill="${BLACK}"/>\n  ${page(1)}\n</svg>\n`,
);
const tabIco = ico(await Promise.all([16, 32, 48].map(async (n) => [n, await pngOf(n, n, rounded, true)])));
const html = join(root, 'apps/web/index.html');
const before = readFileSync(html, 'utf8');
const after = before
  .replace(
    /(<link rel="icon" href=")data:image\/x-icon;base64,[^"]*(")/,
    `$1data:image/x-icon;base64,${tabIco.toString('base64')}$2`,
  )
  .replace(
    /(<link rel="icon" href=")data:image\/svg\+xml,[^"]*(")/,
    `$1data:image/svg+xml,${encodeURIComponent(rounded).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%2F/g, '/').replace(/%3A/g, ':')}$2`,
  );
if ((before.match(/<link rel="icon" href="data:image\/(?:x-icon|svg\+xml)/g) || []).length !== 2)
  throw new Error('index.html: the tab icons were not found');
writeFileSync(html, after);
console.log('tab icons  ', 'apps/web/index.html');

await browser.close();
