/*
 * Downloads the compiled resume from the `resume` GitHub release (published by
 * .github/workflows/resume.yml) to public/resume.pdf, so the site serves it at
 * /resume.pdf. Runs in `prebuild` and `predev`.
 *
 * On Cloudflare Pages (CF_PAGES=1) it always downloads and a failure fails the
 * build, so Pages keeps the last good deployment instead of shipping a broken
 * link. Locally an existing file (e.g. from `pnpm resume`) is kept and a failed
 * download only warns.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const url =
  'https://github.com/matteopolak/portfolio/releases/download/resume/resume.pdf';
const target = resolve(import.meta.dirname, '..', 'public', 'resume.pdf');
const required = process.env.CF_PAGES === '1';

const exists = await access(target).then(
  () => true,
  () => false
);
if (exists && !required) process.exit(0);

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new Error('response is not a PDF');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, pdf);
  console.log(`resume: ${pdf.length} bytes -> public/resume.pdf`);
} catch (error) {
  const message = `resume: could not download ${url}: ${(error as Error).message}`;
  if (required) throw new Error(message);
  console.warn(`${message} (skipped; run \`pnpm resume\` to build it locally)`);
}
