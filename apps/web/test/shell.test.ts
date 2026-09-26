import { existsSync, readFileSync } from 'node:fs';
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
