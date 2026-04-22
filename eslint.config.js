const {FlatCompat} = require('@eslint/eslintrc');
const js = require('@eslint/js');
const path = require('node:path');

const expoConfigDirectory = path.dirname(require.resolve('eslint-config-expo/package.json'));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: expoConfigDirectory,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

module.exports = [
  {
    ignores: [
      'dist/',
      'web-build/',
      'node_modules/',
      'personal_finance_manager.html'
    ]
  },
  ...compat.extends('expo'),
  {
    files: ['eslint.config.js', 'server.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        URL: 'readonly'
      }
    }
  }
];
