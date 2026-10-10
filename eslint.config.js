import tencent from 'eslint-config-tencent/flat';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['dist', 'dist-electron', 'dist-types', 'node_modules', 'uploads', 'fixtures', 'docs'],
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
  { files: ['packages/app/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: globals.node } },
  reactHooks.configs.flat.recommended,
  prettier,
];
