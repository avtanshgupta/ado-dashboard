// Flat ESLint config (ESLint 9). `no-undef` is an error (an undefined reference
// is always a real runtime crash — e.g. a component/icon used in JSX but not
// imported); most stylistic rules stay warnings.
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

const timers = {
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const nodeGlobals = {
  ...timers,
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortSignal: 'readonly',
  __dirname: 'readonly',
};

const browserGlobals = {
  ...timers,
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  fetch: 'readonly',
  CustomEvent: 'readonly',
  console: 'readonly',
  XMLHttpRequest: 'readonly',
  EventSource: 'readonly',
  Notification: 'readonly',
  URLSearchParams: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
};

const baseRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // An undefined reference is always a real runtime crash (e.g. a component/icon
  // used in JSX but not imported), so fail the lint instead of just warning.
  'no-undef': 'error',
  'no-var': 'warn',
  'prefer-const': 'warn',
};

export default [
  { ignores: ['**/node_modules/**', 'web/dist/**', '**/*.min.js'] },
  {
    files: ['server/**/*.js', '*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals },
    rules: baseRules,
  },
  {
    files: ['web/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...baseRules,
      // Mark JSX-referenced identifiers as used so no-unused-vars doesn't produce
      // false positives for components used only in markup.
      'react/jsx-uses-vars': 'warn',
      'react/jsx-uses-react': 'off',
      'react/no-danger': 'off',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
