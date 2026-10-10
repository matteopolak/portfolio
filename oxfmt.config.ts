import { defineConfig } from 'oxfmt';

export default defineConfig({
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  printWidth: 80,
  sortPackageJson: false,
  // Formats .svelte files (needs the `svelte` package, a dependency).
  svelte: true,
  ignorePatterns: [
    'dist/',
    '.astro/',
    '*.toml',
    'resume/',
    'website/',
    'public/quasi/',
  ],
});
