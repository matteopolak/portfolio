import type { APIRoute } from 'astro';
import { getRoutes } from '../lib/content';

export const prerender = true;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error(
      'Astro `site` must be configured to generate canonical sitemap URLs.'
    );
  }

  // Same route list as the WebMCP `navigate` allow-list; markdown variants are alternates, not listed.
  const entries = await getRoutes();

  const urls = entries
    .map(({ path, lastModified }) => {
      const location = escapeXml(new URL(path, site).href);
      const lastmod = lastModified
        ? `\n    <lastmod>${lastModified}</lastmod>`
        : '';

      return `  <url>\n    <loc>${location}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
