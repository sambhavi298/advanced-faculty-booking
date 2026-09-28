// Root ESLint flat config shared by every workspace.
// Type-aware rules (strictTypeChecked) run against each workspace's own tsconfig via the project service.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Conflicts with no-non-null-assertion (strict): we prefer an explicit `as T` over `!`.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // Tests assert on untyped runtime JSON (e.g. Supertest's `res.body: any`) and use Jest mocks,
    // so the "unsafe any" family and unbound-method checks are relaxed here only — never in src/.
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Plain JavaScript config files are not part of any tsconfig, so type-aware linting is disabled for them.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
