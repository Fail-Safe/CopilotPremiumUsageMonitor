/**
 * ESLint flat config for the extension (ESLint v9+).
 * Uses @typescript-eslint with type-aware rules for the src tree.
 */

// CommonJS form so we don't need to switch the package to type:module.
// eslint.config.js is automatically picked up by ESLint >=9.

const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: [
      'out/**',
      'out-instrumented/**',
      'coverage/**',
      '.nyc_output/**',
      'node_modules/**',
      'scripts/coverage-badge.mjs' // generated badge helper not needed for lint
    ]
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
        ecmaVersion: 2022
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      // Start with the recommended type-checked rules if available.
      ...(tsPlugin.configs && tsPlugin.configs['recommended-type-checked']
        ? tsPlugin.configs['recommended-type-checked'].rules
        : {}),
      // Project-specific tweaks / additions:
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/explicit-function-return-type': 'off',
  // Temporarily relax strict unsafe/any rules (will re‑enable selectively later for non-test code)
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-redundant-type-constituents': 'off',
  // Allow console for extension diagnostics; VS Code extensions often log.
  'no-console': 'off'
    }
  },
  {
    // Test overrides (loosen a couple of rules that are noisy in tests)
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  }
];
