import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pointerPath = join(root, 'lodestone-web-release.json');
const outputPath = join(root, 'public', 'lodestone');
const stampPath = join(outputPath, '.lodestone-bundle.json');
const downloadAttempts = 5;

const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
if (!pointer.enabled) {
  console.log('Lodestone web SDK is not published yet; skipping sync.');
  process.exit(0);
}

for (const [name, value] of Object.entries({
  repository: pointer.repository,
  tag: pointer.tag,
  manifestAsset: pointer.manifestAsset,
  manifestSha256: pointer.manifestSha256,
})) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`lodestone-web-release.json has no valid ${name}`);
  }
}
if (!/^[\w.-]+\/[\w.-]+$/.test(pointer.repository)) {
  throw new Error('invalid GitHub repository in lodestone-web-release.json');
}
if (
  !/^[\w.-]+$/.test(pointer.tag) ||
  pointer.manifestAsset !== 'lodestone-web-sdk.manifest.json'
) {
  throw new Error('invalid Lodestone release tag or manifest asset name');
}
if (!/^[a-f0-9]{64}$/.test(pointer.manifestSha256)) {
  throw new Error('invalid Lodestone manifest SHA-256');
}

try {
  const stamp = JSON.parse(await readFile(stampPath, 'utf8'));
  if (stamp.manifestSha256 === pointer.manifestSha256) {
    console.log(
      `Lodestone web SDK is current (${pointer.manifestSha256.slice(0, 12)}).`
    );
    process.exit(0);
  }
} catch {
  // A missing or malformed stamp means the generated directory needs a refresh.
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'lodestone-web-sdk-'));
const archivePath = join(temporaryRoot, 'lodestone-web-sdk.tar.gz');
const unpackPath = join(temporaryRoot, 'unpacked');
const releaseRoot = `https://github.com/${pointer.repository}/releases/download/${pointer.tag}`;

try {
  console.log(`Downloading Lodestone ${pointer.lodestoneRevision ?? 'web SDK'}…`);
  const manifestBytes = await download(
    `${releaseRoot}/${pointer.manifestAsset}`
  );
  verifyDigest(
    manifestBytes,
    pointer.manifestSha256,
    'Lodestone SDK manifest'
  );
  const manifest = parseManifest(manifestBytes);

  const archiveBytes = await download(`${releaseRoot}/${manifest.archive.path}`);
  verifyDigest(archiveBytes, manifest.archive.sha256, 'Lodestone SDK archive');
  if (archiveBytes.byteLength !== manifest.archive.size) {
    throw new Error(
      `Lodestone SDK archive has ${archiveBytes.byteLength} bytes, expected ${manifest.archive.size}`
    );
  }
  await writeFile(archivePath, archiveBytes);

  const entries = (await run('tar', ['-tzf', archivePath]))
    .split('\n')
    .filter(Boolean);
  const expectedEntries = manifest.files.map((entry) => entry.path);
  if (
    entries.length !== expectedEntries.length ||
    entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    throw new Error('Lodestone SDK archive inventory does not match its manifest');
  }
  expectedEntries.forEach(assertSafePath);

  await mkdir(unpackPath);
  await run('tar', ['-xzf', archivePath, '-C', unpackPath, '--no-same-owner']);
  for (const entry of manifest.files) {
    const path = join(unpackPath, entry.path);
    const file = await readFile(path);
    const details = await stat(path);
    if (details.size !== entry.size) {
      throw new Error(`${entry.path} has ${details.size} bytes, expected ${entry.size}`);
    }
    verifyDigest(file, entry.sha256, entry.path);
  }

  await writeFile(
    join(unpackPath, 'lodestone-web-sdk.manifest.json'),
    manifestBytes
  );
  await writeFile(
    join(unpackPath, '.lodestone-bundle.json'),
    `${JSON.stringify(pointer, null, 2)}\n`
  );
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(join(root, 'public'), { recursive: true });
  await rename(unpackPath, outputPath);
  console.log(`Staged Lodestone SDK at ${outputPath}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function download(url) {
  let lastError;

  for (let attempt = 1; attempt <= downloadAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (response.ok) return Buffer.from(await response.arrayBuffer());

      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      await response.body?.cancel();
      lastError = new Error(
        `download failed with HTTP ${response.status}: ${url}`
      );
      lastError.retryable = retryable;
      if (!retryable) throw lastError;
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
    }

    if (attempt < downloadAttempts) {
      const delayMilliseconds = 2 ** (attempt - 1) * 1_000;
      console.warn(
        `Download attempt ${attempt} failed; retrying in ${delayMilliseconds / 1_000}s…`
      );
      await delay(delayMilliseconds);
    }
  }

  throw lastError;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseManifest(bytes) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schema !== 'lodestone-web-sdk' || manifest.schema_version !== 1) {
    throw new Error('unsupported Lodestone SDK manifest schema');
  }
  if (
    manifest.dirty_checkout !== false ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    !/^[\w.-]+\.js$/.test(manifest.entrypoint) ||
    manifest.archive?.path !== 'lodestone-web-sdk.tar.gz' ||
    manifest.archive?.format !== 'tar.gz' ||
    !Number.isSafeInteger(manifest.archive?.size) ||
    !/^[a-f0-9]{64}$/.test(manifest.archive?.sha256) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error('malformed Lodestone SDK manifest');
  }
  if (pointer.lodestoneRevision && manifest.commit !== pointer.lodestoneRevision) {
    throw new Error(
      `Lodestone SDK commit ${manifest.commit} does not match pointer ${pointer.lodestoneRevision}`
    );
  }

  const seen = new Set();
  for (const entry of manifest.files) {
    if (
      typeof entry?.path !== 'string' ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error('malformed file entry in Lodestone SDK manifest');
    }
    assertSafePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`duplicate SDK path: ${entry.path}`);
    seen.add(entry.path);
  }
  for (const required of [manifest.entrypoint, 'client.jar', 'blocks.json']) {
    if (!seen.has(required)) throw new Error(`Lodestone SDK is missing ${required}`);
  }
  return manifest;
}

function assertSafePath(path) {
  const normalized = normalize(path);
  if (
    !path ||
    normalized.startsWith(`..${sep}`) ||
    normalized === '..' ||
    normalized.startsWith(sep) ||
    normalized !== path
  ) {
    throw new Error(`unsafe path in Lodestone SDK: ${path}`);
  }
}

function verifyDigest(bytes, expected, label) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}
