import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'desktop-app-vue/node_modules/**',
      'packages/*/node_modules/**',
      'backend/**',
      'android-app/**',
      'dist/**',
      '*.config.js',
      '.chainlesschain/**',
    ],
  },
];
