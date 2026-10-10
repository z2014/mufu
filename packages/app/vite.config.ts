import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mufu/core/view': fileURLToPath(new URL('../core/src/view.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 43123,
    strictPort: true,
  },
});
