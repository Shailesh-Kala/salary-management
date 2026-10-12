import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/coverage'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  { languageOptions: { globals: globals.node } },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    rules: {
      // `_`-prefixed names are deliberately unused: Express's 4-arg error handler, and
      // fields dropped by destructuring.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
