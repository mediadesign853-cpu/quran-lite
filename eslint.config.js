import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Keep this config compatible with the installed v8 typescript-eslint package
// and with older cached eslint-plugin-react-hooks installs. The dependency
// refresh script will install the versions declared in package.json, but lint
// should not crash merely because an old plugin is currently present.
const typescriptRecommended = Array.isArray(tseslint.configs.recommended)
  ? tseslint.configs.recommended
  : [tseslint.configs.recommended];

const reactHooksRecommended = reactHooks.configs?.flat?.recommended ?? {
  plugins: { 'react-hooks': reactHooks },
  rules: reactHooks.configs?.recommended?.rules ?? {},
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'dist',
      'release/**',
      'coverage/**',
      'electron/auto-updater.bundle.cjs',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    ...js.configs.recommended,
    files: ['**/*.cjs'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: globals.serviceworker,
    },
  },
  // Apply every part of the typescript-eslint recommended preset directly.
  // This avoids relying on the newer `tseslint.config({ extends: [...] })`
  // helper syntax when a user's node_modules still contains an older v8 copy.
  ...typescriptRecommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    ...reactHooksRecommended,
    files: ['src/**/*.{ts,tsx}'],
  },
];
