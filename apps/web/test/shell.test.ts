import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(app, 'index.html'), 'utf8');
const sw = readFileSync(join(app, 'public', 'sw.js'), 'utf8');

/* Every file the page itself loads: local <script src> and <link href>
   (data: and http(s): URLs are skipped). */
const localRefs = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1]!)
  .filter((u) => !/^(?:data:|https?:|\/\/)/.test(u));

/* The list the service worker caches for offline launches. */
const shellMatch = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
const shell = shellMatch ? [...shellMatch[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!) : [];

describe('web app shell', () => {
  it('finds the files index.html loads', () => {
    expect(localRefs).toContain('js/core.js');
    expect(localRefs.length).toBeGreaterThan(15);
  });

  it.each(localRefs)('%s exists under public/', (ref) => {
    expect(existsSync(join(app, 'public', ref))).toBe(true);
  });

  it('service worker SHELL lists files that exist', () => {
    expect(shell.length).toBeGreaterThan(0);
    for (const f of shell.filter((u) => u !== './')) {
      expect(existsSync(join(app, 'public', f)), f).toBe(true);
    }
  });

  /* A script the page needs but the worker doesn't cache is missing when the
     installed app opens offline. */
  it.each(localRefs.filter((u) => u.startsWith('js/')))('%s is cached for offline use', (ref) => {
    expect(shell).toContain(ref);
  });
});

/* PDFium draws the zoomed-in parts of heavy pages (js/render-worker.js). The
   render worker loads it the first time a page proves heavy, so it is not in
   the offline cache: without it, pdf.js draws those parts. */
describe('vendored PDFium', () => {
  /* the package's exports map hides dist/: found beside its main entry */
  const dist = dirname(createRequire(join(app, 'package.json')).resolve('@embedpdf/pdfium'));
  it.each([
    ['js/vendor/pdfium/pdfium.esm.js', 'index.browser.js'],
    ['js/vendor/pdfium/pdfium.wasm', 'pdfium.wasm'],
  ])('%s is identical to @embedpdf/pdfium/dist/%s', (file, name) => {
    const ours = readFileSync(join(app, 'public', file));
    expect(ours.equals(readFileSync(join(dist, name)))).toBe(true);
  });
  it('ships its licences', () => {
    const dir = join(app, 'public', 'js', 'vendor', 'pdfium');
    expect(readFileSync(join(dir, 'LICENSE'), 'utf8')).toContain('MIT');
    expect(readFileSync(join(dir, 'LICENSE.pdfium'), 'utf8')).toContain('Apache License');
  });
  it('is loaded by the render worker from where it is vendored', () => {
    const worker = readFileSync(join(app, 'public', 'js', 'render-worker.js'), 'utf8');
    expect(worker).toContain("import('./vendor/pdfium/pdfium.esm.js')");
    expect(worker).toContain("fetch('vendor/pdfium/pdfium.wasm')");
  });
});

/* Loaded by core.js the first time a save needs a character the standard PDF
   fonts lack. Both are copies of the versions pinned in packages/engine, where
   the tests use them, so the app saves what the tests check. */
describe('vendored Unicode font support', () => {
  const engine = createRequire(join(app, '../../packages/engine/package.json'));
  it.each([
    ['js/vendor/fontkit.umd.min.js', '@pdf-lib/fontkit/dist/fontkit.umd.min.js'],
    ['assets/fonts/DejaVuSans.ttf', 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf'],
  ])('%s is identical to %s', (file, pkg) => {
    const ours = readFileSync(join(app, 'public', file));
    expect(ours.equals(readFileSync(engine.resolve(pkg)))).toBe(true);
    expect(shell).toContain(file);
  });

  /* Noto Emoji has no npm package. The app's copy is built by
     scripts/fonts/build-noto-emoji.py (fontTools 4.60.1, deterministic) from
     google/fonts' ofl/notoemoji/NotoEmoji[wght].ttf at commit
     23e54b51ddffbc7713c583748e3bd86f62b1fa4a; see assets/fonts/README.md */
  it('assets/fonts/NotoEmoji.ttf is the build of the pinned google/fonts file', () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(app, 'public/assets/fonts/NotoEmoji.ttf')))
      .digest('hex');
    expect(sha).toBe('ac16e452857b827d5d331f90b12cd39fa2b5284d6ec816a5f1618d580dfcf089');
  });

  /* fontkit writes a subset's glyph offsets halved (the short loca format)
     but copies glyphs unpadded, so one odd-length glyph shifts every glyph
     after it and they print blank. Every font the app embeds must have even
     glyph lengths. */
  it.each(['DejaVuSans.ttf', 'NotoEmoji.ttf'])('%s: every glyph has an even length', (name) => {
    const b = readFileSync(join(app, 'public/assets/fonts', name));
    const tables: Record<string, number> = {};
    for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
      const at = 12 + i * 16;
      tables[b.toString('latin1', at, at + 4)] = b.readUInt32BE(at + 8);
    }
    const longLoca = b.readInt16BE(tables['head']! + 50) === 1;
    const numGlyphs = b.readUInt16BE(tables['maxp']! + 4);
    const at = (i: number) =>
      longLoca ? b.readUInt32BE(tables['loca']! + i * 4) : b.readUInt16BE(tables['loca']! + i * 2) * 2;
    let odd = 0;
    for (let i = 0; i < numGlyphs; i++) odd += (at(i + 1) - at(i)) % 2;
    expect(numGlyphs).toBeGreaterThan(1000);
    expect(odd).toBe(0);
  });

  it('ships the font licences', () => {
    expect(readFileSync(join(app, 'public/assets/fonts/DejaVuSans-LICENSE.txt'), 'utf8')).toMatch(
      /Bitstream Vera/,
    );
    expect(readFileSync(join(app, 'public/assets/fonts/NotoEmoji-LICENSE.txt'), 'utf8')).toMatch(
      /SIL Open Font License/,
    );
  });

  it('core.js loads them from those paths', () => {
    const core = readFileSync(join(app, 'public/js/core.js'), 'utf8');
    expect(core).toContain("'js/vendor/fontkit.umd.min.js'");
    expect(core).toContain("'assets/fonts/DejaVuSans.ttf'");
    expect(core).toContain("'assets/fonts/NotoEmoji.ttf'");
  });
});

/* The interface's type (css/brand.css): Figtree and JetBrains Mono, from
   @fontsource-variable/figtree@5.3.0 (files/figtree-latin-wght-normal.woff2)
   and @fontsource/jetbrains-mono@5.3.0 (files/jetbrains-mono-latin-500-normal.woff2),
   copied unchanged. */
describe('interface fonts', () => {
  it.each([
    ['Figtree-latin-wght.woff2', '4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd'],
    ['JetBrainsMono-latin-500.woff2', 'cb182feeed4d798ff6961d3c79f7026279448fca0676438aaecb21f3fc39553a'],
  ])('%s is the pinned file', (name, sha) => {
    const b = readFileSync(join(app, 'public/assets/fonts', name));
    expect(createHash('sha256').update(b).digest('hex')).toBe(sha);
    expect(shell).toContain('assets/fonts/' + name);
  });
  it('ships their licences', () => {
    for (const f of ['OFL-Figtree.txt', 'OFL-JetBrainsMono.txt']) {
      expect(readFileSync(join(app, 'public/assets/fonts', f), 'utf8')).toMatch(/SIL Open Font License/);
    }
  });
  it('css/brand.css loads them from those paths', () => {
    const css = readFileSync(join(app, 'public/css/brand.css'), 'utf8');
    expect(css).toContain('../assets/fonts/Figtree-latin-wght.woff2');
    expect(css).toContain('../assets/fonts/JetBrainsMono-latin-500.woff2');
  });
  it.each(localRefs.filter((u) => u.startsWith('css/')))('%s is cached for offline use', (ref) => {
    expect(shell).toContain(ref);
  });
});
