import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { transformerMetaHighlight } from '@shikijs/transformers';

export default defineConfig({
  site: 'https://matteopolak.com',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/commands',
        '@codemirror/autocomplete',
        '@codemirror/lint',
        '@codemirror/search',
        '@lezer/highlight',
      ],
    },
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    },
  },
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
      transformers: [transformerMetaHighlight()],
    },
  },
});
