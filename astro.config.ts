import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import { transformerMetaHighlight } from '@shikijs/transformers';
import { satteri } from '@astrojs/markdown-satteri';
import { jaiHastPlugin } from './src/lib/jai-hast-plugin.ts';
import { headingAnchorPlugin } from './src/lib/heading-anchor-plugin.ts';

export default defineConfig({
  site: 'https://matteopolak.com',
  output: 'static',
  integrations: [svelte(), mdx()],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Every browser-side dependency, including the ones only reached through
      // dynamic imports (playground embeds, Markdown preview, Vim mode). Vite
      // would otherwise find them mid-session, re-optimize, and fail modules
      // already loaded with "504 Outdated Optimize Dep" (charts stop hydrating,
      // embeds fail to start) until a hard reload.
      include: [
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/commands',
        '@codemirror/autocomplete',
        '@codemirror/lint',
        '@codemirror/search',
        '@lezer/highlight',
        '@codemirror/lang-markdown',
        '@replit/codemirror-vim',
        '@xterm/xterm',
        '@xterm/addon-fit',
        'd3-array',
        'd3-scale',
        'd3-shape',
        'd3-time-format',
        'dompurify',
        'marked',
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
    // `jai` fences are highlighted by our own Lezer parser (lib/jai-hast-plugin.ts), not Shiki.
    syntaxHighlight: { type: 'shiki', excludeLangs: ['jai'] },
    processor: satteri({
      hastPlugins: [jaiHastPlugin as never, headingAnchorPlugin as never],
    }),
    shikiConfig: {
      // Both palettes are emitted as CSS variables; global.css and themeCss() pick one per site theme.
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      transformers: [transformerMetaHighlight()],
    },
  },
});
