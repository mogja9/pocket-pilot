import { defineConfig } from 'vite';

// The web app lives in web/ but imports the engine from ../src and the card data
// from ../data, so allow serving files from the project root.
export default defineConfig({
  root: 'web',
  // The card dataset (~1 MB raw / ~120 KB gzipped, now with attack + ability
  // effect text) is bundled by design; it is not splittable into smaller
  // meaningful chunks, so lift the size warning.
  build: { outDir: '../dist-web', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { fs: { allow: ['..'] } },
});
