import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite 加载这份配置时直接读 @mufu/schema 的源文件。
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
