import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/* While the v1 scripts are still in use, the engine ships to them as one
   classic script, js/engine.js, exposing window.ADDPDFEngine. pdf-lib stays
   external and comes from the page's own PDFLib global, so there is exactly
   one copy of it. The file is generated, so it is gitignored. */
export default defineConfig({
  build: {
    outDir: join(here, '../../apps/web/public/js'),
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: join(here, 'src/index.ts'),
      name: 'ADDPDFEngine',
      formats: ['iife'],
      fileName: () => 'engine.js',
    },
    rollupOptions: {
      external: ['pdf-lib'],
      output: { globals: { 'pdf-lib': 'PDFLib' } },
    },
  },
});
