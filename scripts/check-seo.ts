/*
 * Static SEO check, run after `pnpm build` (`pnpm check:seo`, and in CI).
 * It reads dist/**\/*.html as a crawler without JavaScript would and fails on
 * a missing title, description, canonical, Open Graph / Twitter tags, `lang`,
 * viewport, theme-color, a single <h1> or JSON-LD that does not parse. It also
 * checks that titles and descriptions are unique and that every page is in
 * sitemap.xml, with robots.txt pointing at it and the RSS feed present.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const origin = 'https://matteopolak.com';
const dist = resolve(import.meta.dirname, '..', 'dist');
// Vendored runtime assets, not pages.
const skipped = new Set(['_astro', 'jai', 'quasi', 'baerscript', 'lodestone']);

async function htmlFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name)) files.push(...(await htmlFiles(path)));
    } else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

const decode = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

function meta(html: string, attribute: 'name' | 'property', key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gu) ?? []) {
    if (!new RegExp(`\\b${attribute}="${key}"`, 'u').test(tag)) continue;
    const content = /\bcontent="([^"]*)"/u.exec(tag)?.[1];
    if (content !== undefined) return decode(content);
  }
  return undefined;
}

/** `dist/blog/post.html` -> `/blog/post`, `dist/index.html` -> `/`. */
function route(file: string) {
  const path =
    '/' +
    relative(dist, file)
      .replaceAll('\\', '/')
      .replace(/\.html$/u, '');
  return path === '/index' ? '/' : path;
}

const errors: string[] = [];
const titles = new Map<string, string>();
const descriptions = new Map<string, string>();
const canonicals: string[] = [];

const files = await htmlFiles(dist);
if (files.length === 0)
  throw new Error('dist/ has no pages: run `pnpm build` first.');

for (const file of files) {
  const path = route(file);
  const fail = (message: string) => errors.push(`${path}: ${message}`);
  const html = await readFile(file, 'utf8');

  const title = /<title>([^<]*)<\/title>/u.exec(html)?.[1];
  if (!title?.trim()) fail('missing <title>');
  else {
    const previous = titles.get(title);
    if (previous) fail(`duplicate <title> with ${previous}`);
    titles.set(title, path);
  }

  const description = meta(html, 'name', 'description');
  if (!description?.trim()) fail('missing meta description');
  else {
    const previous = descriptions.get(description);
    if (previous) fail(`duplicate meta description with ${previous}`);
    descriptions.set(description, path);
  }

  const canonical = /<link\b[^>]*rel="canonical"[^>]*href="([^"]*)"/u.exec(
    html
  )?.[1];
  const expected = origin + path;
  if (!canonical) fail('missing canonical');
  else {
    canonicals.push(canonical);
    if (canonical !== expected)
      fail(`canonical ${canonical} should be ${expected}`);
    if (canonical !== origin + '/' && canonical.endsWith('/'))
      fail('canonical has a trailing slash');
  }

  const required: ['name' | 'property', string][] = [
    ['property', 'og:title'],
    ['property', 'og:description'],
    ['property', 'og:url'],
    ['property', 'og:type'],
    ['property', 'og:image'],
    ['property', 'og:site_name'],
    ['name', 'twitter:card'],
    ['name', 'twitter:title'],
    ['name', 'twitter:image'],
    ['name', 'viewport'],
    ['name', 'theme-color'],
  ];
  for (const [attribute, key] of required)
    if (!meta(html, attribute, key)?.trim()) fail(`missing ${key}`);
  if (!meta(html, 'property', 'og:image')?.startsWith(origin + '/'))
    fail('og:image is not an absolute URL on the site origin');
  if (meta(html, 'property', 'og:url') !== canonical)
    fail('og:url does not match canonical');

  if (!/<html\b[^>]*\blang="[^"]+"/u.test(html)) fail('missing <html lang>');
  if (!/<link\b[^>]*rel="icon"/u.test(html)) fail('missing favicon link');
  if (!/<link\b[^>]*rel="manifest"/u.test(html)) fail('missing manifest link');

  const h1 = (html.match(/<h1\b/gu) ?? []).length;
  if (h1 !== 1) fail(`expected one <h1>, found ${h1}`);

  const blocks = [
    ...html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gu
    ),
  ];
  if (blocks.length === 0) fail('missing JSON-LD');
  for (const [, body] of blocks) {
    try {
      const data = JSON.parse(body) as { '@context'?: string };
      if (!data['@context']) fail('JSON-LD has no @context');
    } catch (error) {
      fail(`JSON-LD does not parse: ${(error as Error).message}`);
    }
  }
}

const read = (name: string) =>
  readFile(join(dist, name), 'utf8').catch(() => '');
const sitemap = await read('sitemap.xml');
for (const canonical of canonicals)
  if (!sitemap.includes(`<loc>${canonical}</loc>`))
    errors.push(`sitemap.xml: missing ${canonical}`);

if (!(await read('robots.txt')).includes(`Sitemap: ${origin}/sitemap.xml`))
  errors.push('robots.txt: does not reference the sitemap');

const feed = await read('rss.xml');
if (!feed.includes('<rss')) errors.push('rss.xml: missing');
if (/<link>https:[^<]*\/blog\/[^<]*\/<\/link>/u.test(feed))
  errors.push('rss.xml: item links have trailing slashes');

if (errors.length) {
  console.error(
    `SEO check failed (${errors.length}):\n- ${errors.join('\n- ')}`
  );
  process.exit(1);
}
console.log(`SEO check passed for ${files.length} pages.`);
