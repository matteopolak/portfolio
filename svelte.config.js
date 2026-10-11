import { vitePreprocess } from '@astrojs/svelte';

export default {
  preprocess: vitePreprocess(),
  // Production client bundles carry their component CSS in the JS. Pages link
  // the same CSS from Astro's server build, and Astro deletes client CSS files
  // the server build already covers, so a lazily imported island (the blog
  // Playground embed) would otherwise preload CSS files that aren't in dist.
  vitePlugin: {
    dynamicCompileOptions: ({ compileOptions, environment }) =>
      compileOptions.generate === 'client' &&
      environment?.config?.command === 'build'
        ? { css: 'injected' }
        : undefined,
  },
};
