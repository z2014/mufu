import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./packages/app/src', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20000,
  },
});
