import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(here, '../../packages/engine/test/golden');

/* Dev only. While code moves out of the v1 scripts into packages/engine, the
   v1 output is recorded in the browser and the engine is tested against it in
   Node. A page posts its JSON to /__golden/<name> and it lands in
   packages/engine/test/golden/<name>.json. */
function goldenRecorder(): Plugin {
  return {
    name: 'adddots-golden-recorder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__golden/', (req, res) => {
        const name = (req.url || '').replace(/^\//, '');
        if (req.method !== 'POST' || !/^[a-z0-9.-]+$/i.test(name)) {
          res.statusCode = 400;
          res.end('POST /__golden/<name>');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const data = JSON.parse(body);
          mkdirSync(GOLDEN_DIR, { recursive: true });
          writeFileSync(join(GOLDEN_DIR, name + '.json'), JSON.stringify(data, null, 1) + '\n');
          res.end('saved ' + name);
        });
      });
    },
  };
}

/* Build only. Which build this is, for the update notices (js/update.js):
   the commit and its time, and the notes in whatsnew.json. Written twice:
   js/build.js, which the app loads (the build it is), and latest.js at the
   top, which the Windows and phone apps load from the website to see the
   build it has now (a script, not JSON: a script from another site needs no
   CORS header on the server). */
function buildInfo(): Plugin {
  const git = (args: string) => {
    try {
      return execSync('git ' + args, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      return '';
    }
  };
  return {
    name: 'adddots-build-info',
    apply: 'build',
    closeBundle() {
      const id = git('rev-parse --short HEAD') || 'local';
      const time = (Number(git('log -1 --format=%ct')) || Math.floor(Date.now() / 1000)) * 1000;
      const notes = ((): string[] => {
        try {
          return JSON.parse(readFileSync(join(here, 'whatsnew.json'), 'utf8')).notes || [];
        } catch {
          return [];
        }
      })();
      const info = JSON.stringify({ id, time, notes });
      const out = join(here, 'dist');
      mkdirSync(join(out, 'js'), { recursive: true });
      writeFileSync(join(out, 'js', 'build.js'), 'window.ADDDOTS_BUILD = ' + info + ';\n');
      writeFileSync(join(out, 'latest.js'), 'window.ADDDOTS_LATEST = ' + info + ';\n');
    },
  };
}

/* The v1 app is served as-is. Its scripts are classic (non-module) files under
   public/, so Vite copies them untouched; nothing is bundled yet.
   base './' keeps every URL relative, so the build still works from a subfolder
   such as adddots.com/pdfreader/, the same as the service worker expects. */
export default defineConfig({
  base: './',
  plugins: [goldenRecorder(), buildInfo()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
