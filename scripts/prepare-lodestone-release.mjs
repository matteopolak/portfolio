import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const CLOUDFLARE_FILE_LIMIT = 25 * 1024 * 1024;
const CLIENT_JAR_PART_LIMIT = 20 * 1024 * 1024;
const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  throw new Error('usage: node scripts/prepare-lodestone-release.mjs <dist>');
}

const manifestPath = join(directory, 'client.jar.parts.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.parts) || manifest.parts.length < 2) {
  throw new Error('client.jar.parts.json is not a version 1 multipart manifest');
}

const names = new Set();
for (const [index, part] of manifest.parts.entries()) {
  const digestIsValid =
    typeof part.sha256 === 'string' && /^[a-f0-9]{64}$/.test(part.sha256);
  const expectedName = digestIsValid
    ? `client.jar.part-${String(index).padStart(3, '0')}-${part.sha256}`
    : undefined;
  if (
    typeof part.name !== 'string' ||
    basename(part.name) !== part.name ||
    part.name !== expectedName ||
    names.has(part.name) ||
    !Number.isSafeInteger(part.bytes) ||
    part.bytes < 1 ||
    part.bytes > CLIENT_JAR_PART_LIMIT
  ) {
    throw new Error(`invalid client.jar part: ${JSON.stringify(part)}`);
  }
  names.add(part.name);
  const bytes = await readFile(join(directory, part.name));
  if (bytes.length !== part.bytes) {
    throw new Error(`${part.name} has ${bytes.length} bytes; manifest declares ${part.bytes}`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== part.sha256) throw new Error(`${part.name} checksum mismatch`);
}

// The direct file remains useful to ordinary static servers, but Cloudflare
// Pages rejects any individual asset over 25 MiB. The browser loader uses the
// checked multipart manifest when this file is absent.
await rm(join(directory, 'client.jar'), { force: true });

for (const file of await walk(directory)) {
  const size = (await stat(file)).size;
  if (size > CLOUDFLARE_FILE_LIMIT) {
    throw new Error(
      `${file} is ${(size / 1024 / 1024).toFixed(1)} MiB; Cloudflare Pages permits at most 25 MiB per asset`
    );
  }
}
console.log(`Cloudflare asset check passed (${manifest.parts.length} client.jar parts).`);

async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`release output contains a non-file entry: ${child}`);
  }
  return files;
}
