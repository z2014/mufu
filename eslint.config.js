import tencent from 'eslint-config-tencent/flat';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/dist-types/**',
      '**/node_modules/**',
      'uploads/**',
      'fixtures/**',
      'docs/**',
      'agent-tools/**',
    ],
  },
  ...tencent({
    tsconfigRootDir: import.meta.dirname,
    project: [
      './tsconfig.scripts.json',
      './packages/schema/tsconfig.json',
      './packages/core/tsconfig.json',
      './packages/adapters/tsconfig.json',
      './packages/daemon/tsconfig.json',
      './packages/cli/tsconfig.json',
      './packages/app/tsconfig.app.json',
      './packages/app/tsconfig.node.json',
      './packages/app/tsconfig.electron.json',
    ],
  }),
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['packages/app/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: globals.node } },
  // 5.2 的 flat 预设叫 recommended-latest，还没有 configs.flat。
  reactHooks.configs['recommended-latest'],
  prettier,
];
