/* Serves a build of the web app with `vite preview`, for the benchmark and the
   smoke test. Resolves to the server process once it answers; kill it when
   done. */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function serve(dist, port) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('No ' + dist + ': run `npm run build` first');
  const vite = join(app, '../../node_modules/vite/bin/vite.js');
  const proc = spawn(
    process.execPath,
    [vite, 'preview', '--port', String(port), '--strictPort', '--outDir', dist],
    {
      cwd: app,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://localhost:' + port + '/')).ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('vite preview did not start');
}
