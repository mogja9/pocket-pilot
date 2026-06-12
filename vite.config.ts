import { defineConfig } from 'vite';

// The web app lives in web/ but imports the engine from ../src and the card data
// from ../data, so allow serving files from the project root.
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist-web', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
