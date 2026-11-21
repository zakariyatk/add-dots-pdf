import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* The Windows app (Electron) has no window.prompt, alert or confirm: prompt
   shows nothing and answers null, so anything asked that way silently does
   nothing there. The app asks in its own dialog instead (X.ask, js/core.js). */
const js = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');
const code = (f: string) =>
  readFileSync(join(js, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('nothing is asked with window.prompt', () => {
  const files = readdirSync(js).filter((f) => f.endsWith('.js') && f !== 'engine.js');
  it.each(files)('%s', (f) => {
    expect(code(f)).not.toMatch(/\bwindow\.prompt\s*\(/);
  });
});
