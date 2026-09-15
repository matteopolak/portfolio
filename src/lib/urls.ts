export function canonicalPathname(pathname: string): string {
  if (pathname === '/index.html') return '/';

  if (pathname.endsWith('/index.html')) {
    return pathname.slice(0, -'/index.html'.length) || '/';
  }

  if (pathname.endsWith('.html')) {
    return pathname.slice(0, -'.html'.length) || '/';
  }

  return pathname;
}
