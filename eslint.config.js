import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'ECULab.jsx', 'fingerprint.report.json'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Float32Array: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        AudioWorkletNode: 'readonly',
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Without these, `no-unused-vars` cannot see that a component referenced only
      // inside JSX is in fact used, and reports every one of them as dead.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Unused function arguments are how dead parameters accumulate — this rule is
      // what would have caught the ones removed during the module split.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': ['warn', { boolean: false }],
    },
  },
];
