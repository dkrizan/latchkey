import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('./src/ui', import.meta.url));

// Builds only the extension pages (options + popup). Background, content script,
// core and icons are plain files copied by scripts/build.mjs.
export default defineConfig({
  root: ui,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': ui } },
  build: {
    outDir: fileURLToPath(new URL('./build/ui', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: { input: { options: `${ui}/options.html`, popup: `${ui}/popup.html` } },
  },
});
