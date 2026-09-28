/* Benchmark PDFs, generated on demand into bench/.corpus/ (gitignored).

   Synthetic but shaped like real work: text reports of three lengths, CAD
   sheets dense with vector lines, and image-only scans. Generated with pdf-lib
   from fixed seeds, so every run measures the same files.

     node bench/corpus.mjs          writes any file that is missing
     node bench/corpus.mjs --force  rewrites them all */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, closePath, lineTo, moveTo, rgb, setLineWidth, stroke } from 'pdf-lib';

export const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), '.corpus');

const A4 = [595.28, 841.89];
const A1 = [2383.94, 1683.78]; /* landscape */

/* a small deterministic PRNG (mulberry32), so every run draws the same file */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'door frame schedule level stair core window roof hatch concrete steel beam column slab ' +
  'drawing revision approved engineer site inspection north south east west finish ceiling ' +
  'partition fire rated opening lintel threshold hardware closer hinge lock handle glazing'
).split(' ');

function sentence(r, n) {
  const w = [];
  for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]);
  return w.join(' ');
}

async function textReport(pages, seed, withFigures) {
  const r = rng(seed);
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const bold = await d.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < pages; p++) {
    const page = d.addPage(A4);
    page.drawText('Section ' + (p + 1) + ' — ' + sentence(r, 3), { x: 56, y: 790, size: 15, font: bold });
    let y = 760;
    const figure = withFigures && p % 5 === 2;
    const lines = figure ? 22 : 52;
    for (let i = 0; i < lines; i++, y -= 13.5) {
      page.drawText(sentence(r, 11 + Math.floor(r() * 4)), { x: 56, y, size: 10, font });
    }
    if (figure) {
      /* a small plan: 600 segments */
      const ops = [setLineWidth(0.6)];
      for (let i = 0; i < 600; i++) {
        const x = 70 + r() * 450,
          yy = 120 + r() * 300;
        ops.push(moveTo(x, yy), lineTo(x + (r() - 0.5) * 80, yy + (r() - 0.5) * 80));
      }
      ops.push(stroke());
      page.pushOperators(...ops);
    }
    page.drawText(String(p + 1), { x: 290, y: 30, size: 9, font });
  }
  return d.save();
}

async function cadSheets(pages, segments, seed) {
  const r = rng(seed);
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = d.addPage(A1);
    const [W, H] = A1;
    const ops = [setLineWidth(0.35)];
    /* a grid of walls, then a scatter of short strokes: hatching, fixtures */
    for (let i = 0; i < segments; i++) {
      const x = 40 + r() * (W - 80),
        y = 40 + r() * (H - 80);
      if (i % 4 === 0) {
        ops.push(moveTo(x, y), lineTo(x + 20 * r(), y), lineTo(x + 20 * r(), y + 20 * r()), closePath());
      } else {
        const len = i % 50 === 0 ? 400 : 12;
        ops.push(moveTo(x, y), lineTo(x + (r() - 0.5) * len, y + (r() - 0.5) * len));
      }
    }
    ops.push(stroke());
    for (let i = 0; i < ops.length; i += 5000) page.pushOperators(...ops.slice(i, i + 5000));
    for (let i = 0; i < 400; i++) {
      page.drawText('D' + Math.floor(r() * 900 + 100), {
        x: 40 + r() * (W - 120),
        y: 40 + r() * (H - 80),
        size: 6,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
    page.drawText('SHEET A-' + (100 + p) + '  GROUND FLOOR PLAN', { x: W - 700, y: 60, size: 28, font });
  }
  return d.save();
}

/* a grayscale PNG shaped like a scanned page: paper noise and dark text-like bars */
function scanPng(w, h, r) {
  const raw = Buffer.alloc((w + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    const inLine = y % 38 > 8 && y % 38 < 22 && y > 150 && y < h - 150;
    for (let x = 0; x < w; x++) {
      let v = 235 + Math.floor(r() * 20);
      if (inLine && x > 140 && x < w - 140 && r() < 0.55) v = 20 + Math.floor(r() * 60);
      raw[o++] = v;
    }
  }
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; /* bit depth */
  ihdr[9] = 0; /* grayscale */
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function scans(pages, seed) {
  const r = rng(seed);
  const d = await PDFDocument.create();
  for (let p = 0; p < pages; p++) {
    /* 150 dpi A4 */
    const img = await d.embedPng(scanPng(1240, 1754, r));
    d.addPage(A4).drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  return d.save();
}

export const CORPUS = [
  { name: 'small-text-12p.pdf', kind: 'small', make: () => textReport(12, 1, false) },
  { name: 'medium-report-300p.pdf', kind: 'medium', make: () => textReport(300, 2, true) },
  { name: 'large-text-2000p.pdf', kind: 'large', make: () => textReport(2000, 3, false) },
  { name: 'cad-a1-8sheets.pdf', kind: 'heavy', make: () => cadSheets(8, 40000, 4) },
  { name: 'scans-40p.pdf', kind: 'scans', make: () => scans(40, 5) },
];

/* Files well past the everyday ones, for finding the app's limits (bench/limits.mjs):
   not part of the regular corpus, so the benchmark and CI never build them. */
export const LIMITS = [
  { name: 'limit-text-10000p.pdf', kind: 'pages', make: () => textReport(10000, 6, false) },
  { name: 'limit-scans-160p.pdf', kind: 'size', make: () => scans(160, 7) },
  { name: 'limit-cad-400k.pdf', kind: 'weight', make: () => cadSheets(1, 400000, 8) },
];

export async function ensureLimits() {
  mkdirSync(CORPUS_DIR, { recursive: true });
  const out = [];
  for (const f of LIMITS) {
    const path = join(CORPUS_DIR, f.name);
    if (!existsSync(path)) {
      const t = Date.now();
      writeFileSync(path, await f.make());
      console.log('made', f.name, Math.round(statSync(path).size / 1048576) + ' MB', Date.now() - t + ' ms');
    }
    out.push({ ...f, path, bytes: statSync(path).size });
  }
  return out;
}

export async function ensureCorpus(force = false) {
  mkdirSync(CORPUS_DIR, { recursive: true });
  const out = [];
  for (const f of CORPUS) {
    const path = join(CORPUS_DIR, f.name);
    if (force || !existsSync(path)) {
      const t = Date.now();
      writeFileSync(path, await f.make());
      console.log('made', f.name, Math.round(statSync(path).size / 1024) + ' KB', Date.now() - t + ' ms');
    }
    out.push({ ...f, path, bytes: statSync(path).size });
  }
  return out;
}

if (import.meta.url === 'file://' + process.argv[1]) await ensureCorpus(process.argv.includes('--force'));
