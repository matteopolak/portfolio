import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const prerender = true;

interface SitemapEntry {
  pathname: string;
  lastModified?: Date;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function slug(id: string): string {
  return id.replace(/\.md$/, '');
}

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error(
      'Astro `site` must be configured to generate canonical sitemap URLs.'
    );
  }

  const posts = (await getCollection('blog'))
    .filter((post) => post.data.published !== false)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  const entries: SitemapEntry[] = [
    { pathname: '/' },
    { pathname: '/projects' },
    { pathname: '/blog' },
    ...posts.map((post) => ({
      pathname: `/blog/${slug(post.id)}`,
      lastModified: post.data.date,
    })),
  ];

  const urls = entries
    .map(({ pathname, lastModified }) => {
      const location = escapeXml(new URL(pathname, site).href);
      const lastmod = lastModified
        ? `\n    <lastmod>${lastModified.toISOString().slice(0, 10)}</lastmod>`
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
