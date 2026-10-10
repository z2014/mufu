import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Node can't import the package's TS entry at config load, so this path is the @mufu/schema source.
import { DEV_PORT } from '../schema/src/index.ts';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mufu/core/view': fileURLToPath(new URL('../core/src/view.ts', import.meta.url)),
      '@mufu/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
  },
});
