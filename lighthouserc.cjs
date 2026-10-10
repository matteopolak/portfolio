/*
 * Lighthouse CI configuration (see docs/performance.md).
 * `LHCI_FORM_FACTOR=mobile|desktop` picks the preset; `pnpm lighthouse` runs both.
 * Scores are asserted per category: accessibility, SEO and best practices are
 * errors, performance is a warning at the measured level minus a margin.
 */
const desktop = process.env.LHCI_FORM_FACTOR === 'desktop';
const port = 4400;
const paths = [
  '/',
  '/projects',
  '/blog',
  '/blog/axum-extract',
  '/playground',
  '/playground/quasi',
  '/playground/jai',
];

// oxlint-disable-next-line no-undef
module.exports = {
  ci: {
    collect: {
      startServerCommand: `node scripts/serve-dist.ts ${port}`,
      startServerReadyPattern: 'serving dist',
      url: paths.map((path) => `http://localhost:${port}${path}`),
      numberOfRuns: 1,
      settings: {
        preset: desktop ? 'desktop' : undefined,
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:performance': ['warn', { minScore: 0.8 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
