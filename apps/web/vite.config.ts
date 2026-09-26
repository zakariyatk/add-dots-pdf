import { defineConfig } from 'vite';

/* Phase 0: the v1 app is served as-is. Its scripts are classic (non-module)
   files under public/, so Vite copies them untouched; nothing is bundled yet.
   base './' keeps every URL relative, so the build still works from a subfolder
   such as adddots.com/pdfreader/, the same as the service worker expects. */
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
