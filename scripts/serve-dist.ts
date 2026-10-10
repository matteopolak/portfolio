/*
 * Static server for the built site (`dist/`) that sends the same COOP/COEP
 * headers as production, so cross-origin isolation (and everything that
 * depends on it) behaves as it will when deployed. Used by Lighthouse CI
 * (`pnpm lighthouse`); `/_astro/*` is served immutable like `public/_headers`.
 *
 * Usage: node scripts/serve-dist.ts [port]   (default 4400)
 */
import { createReadStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.argv[2] ?? 4400);

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveFile(pathname: string) {
  const clean = normalize(decodeURIComponent(pathname)).replace(
    /^(\.\.[/\\])+/u,
    ''
  );
  for (const candidate of [clean, `${clean}.html`, join(clean, 'index.html')]) {
    const file = join(root, candidate);
    if (!file.startsWith(root)) continue;
    const info = await stat(file).catch(() => undefined);
    if (info?.isFile()) return file;
  }
  return undefined;
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const file = await resolveFile(pathname);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  const headers = {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/_astro/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  };
  for (const [name, value] of Object.entries(headers))
    response.setHeader(name, value);
  response.statusCode = 200;
  const gzip =
    /\bgzip\b/u.test(String(request.headers['accept-encoding'])) &&
    /^(text|application\/(json|xml|manifest)|image\/svg|font\/)/u.test(
      types[extname(file)] ?? ''
    ) &&
    extname(file) !== '.woff2';
  if (gzip) response.setHeader('content-encoding', 'gzip');
  response.setHeader('vary', 'accept-encoding');
  const stream = createReadStream(file);
  (gzip ? stream.pipe(createGzip()) : stream).pipe(response);
}).listen(port, () => console.log(`serving dist on http://localhost:${port}`));
