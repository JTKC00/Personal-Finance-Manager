import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';

const browserGlobals = {
  Blob: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  window: 'readonly',
};

const nodeGlobals = {
  Buffer: 'readonly',
  URL: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  __dirname: 'readonly',
};

export default [
  {
    ignores: [
      'dist/',
      'functions/lib/',
      'node_modules/',
      'personal_finance_manager.html'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {jsx: true},
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: browserGlobals,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['functions/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        Buffer: 'readonly',
      },
    },
  },
  {
    files: ['server.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
  },
];
