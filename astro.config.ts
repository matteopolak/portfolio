import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { transformerMetaHighlight } from '@shikijs/transformers';

export default defineConfig({
  site: 'https://matteopolak.com',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  markdown: {
    shikiConfig: {
      theme: 'tokyo-night',
      transformers: [transformerMetaHighlight()],
    },
  },
});
