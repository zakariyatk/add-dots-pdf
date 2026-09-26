import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      'apps/web/public/js/vendor/**',
      'design/**',
      'legacy/**',
    ],
  },

  /* New code: TypeScript, strict. */
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  /* The v1 app: classic browser scripts sharing globals through window.ADDPDF.
     Linted for real mistakes only; style is left as it is until each file moves
     into packages/engine. */
  {
    files: ['apps/web/public/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        pdfjsLib: 'readonly',
        PDFLib: 'readonly',
        ADDPDF: 'writable',
      },
    },
    /* no-undef stays on: it is what catches a stray name that only fails at
       runtime. The rest are deliberate in v1 (control-character and BOM
       regexes, error messages that replace the raw cause) or style. */
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-cond-assign': 'off',
      'no-inner-declarations': 'off',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
);
