import { mkdirSync, writeFileSync } from 'node:fs';
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

/* The v1 app is served as-is. Its scripts are classic (non-module) files under
   public/, so Vite copies them untouched; nothing is bundled yet.
   base './' keeps every URL relative, so the build still works from a subfolder
   such as adddots.com/pdfreader/, the same as the service worker expects. */
export default defineConfig({
  base: './',
  plugins: [goldenRecorder()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
