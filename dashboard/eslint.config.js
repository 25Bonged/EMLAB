import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'build-electron', 'release']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The backend (electron/) and Electron shell (electron-main/) pass around
    // dynamic JSON records -- parsed test reports, IPC payloads, SQLite rows --
    // whose shape is genuinely variable, mirroring the original Python's
    // dict-based data model. Typing every field would be a large rewrite for
    // little real safety, so `any` is allowed here specifically; the rest of
    // the app (src/**) keeps the strict default.
    files: ['electron/**/*.{ts,tsx}', 'electron-main/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
