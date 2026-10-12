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
      'packages/app/resources/**',
      'release/**',
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
  {
    files: ['packages/app/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: '颜色只用主题变量，不要在组件里写十六进制。',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message: '颜色只用主题变量，不要在组件里写十六进制。',
        },
        {
          selector:
            'Literal[value=/(?:bg|text|border|ring|fill|stroke|outline|from|via|to|divide|decoration|caret|accent|shadow)-\\[[^\\]]*#/]',
          message: '不要用 Tailwind 任意颜色值，改用主题变量。',
        },
        {
          selector:
            'TemplateElement[value.raw=/(?:bg|text|border|ring|fill|stroke|outline|from|via|to|divide|decoration|caret|accent|shadow)-\\[[^\\]]*#/]',
          message: '不要用 Tailwind 任意颜色值，改用主题变量。',
        },
      ],
    },
  },
];
