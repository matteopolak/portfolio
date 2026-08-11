import { defineConfig } from 'oxfmt';

export default defineConfig({
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  printWidth: 80,
  sortPackageJson: false,
  ignorePatterns: ['dist/', '.astro/', '*.toml', 'resume/', 'website/'],
});
