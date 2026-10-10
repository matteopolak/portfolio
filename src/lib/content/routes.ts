import { SITE_ORIGIN } from '../../data/pages.ts';

/** Canonical site route list (the sitemap, the WebMCP `navigate` allow-list). Pure. */
export interface SiteRoute {
  path: string;
  title?: string;
  lastModified?: string;
}

export interface RouteInput {
  posts: { path: string; title: string; date: string }[];
  playgrounds: { path: string; title: string }[];
}

export function buildRoutes({ posts, playgrounds }: RouteInput): SiteRoute[] {
  return [
    { path: '/', title: 'Home' },
    { path: '/projects', title: 'Projects' },
    { path: '/blog', title: 'Blog' },
    { path: '/playground', title: 'Playgrounds' },
    ...playgrounds.map(({ path, title }) => ({ path, title })),
    ...posts.map(({ path, title, date }) => ({
      path,
      title,
      lastModified: date,
    })),
  ];
}

/** Normalizes `/blog/`, `/blog.html` and `https://matteopolak.com/blog?x#y` to `/blog`; undefined for other origins. */
export function normalizeRoutePath(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input, SITE_ORIGIN + '/');
  } catch {
    return undefined;
  }
  if (url.origin !== SITE_ORIGIN) return undefined;
  let path = url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

/** The route's path if it is one of the site's own pages, otherwise undefined. */
export function allowedRoute(
  input: unknown,
  routes: readonly { path: string }[]
): string | undefined {
  if (typeof input !== 'string' || input.length > 200) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const path = normalizeRoutePath(trimmed);
  return path !== undefined && routes.some((route) => route.path === path)
    ? path
    : undefined;
}

/** Pages with a markdown variant: everything but the playgrounds. */
export function markdownPathFor(path: string): string | undefined {
  if (path === '/' || path === '/index') return '/index.md';
  if (path === '/playground' || path.startsWith('/playground/'))
    return undefined;
  const clean = path.replace(/\/+$/, '');
  return `${clean}.md`;
}
