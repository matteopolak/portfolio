import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
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
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const pointerPath = join(root, 'quasi-web-release.json');
const outputPath = join(root, 'public', 'quasi');
const stampPath = join(outputPath, '.quasi-bundle.json');
const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));

if (!pointer.enabled) {
  console.log('Quasi web bundle is not published yet; skipping sync.');
  process.exit(0);
}

for (const [name, value] of Object.entries({
  repository: pointer.repository,
  tag: pointer.tag,
  bundleAsset: pointer.bundleAsset,
  sha256: pointer.sha256,
})) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`quasi-web-release.json has no valid ${name}`);
  }
}
if (!/^[\w.-]+\/[\w.-]+$/.test(pointer.repository)) {
  throw new Error('invalid GitHub repository in quasi-web-release.json');
}
if (
  !/^[\w.-]+$/.test(pointer.tag) ||
  !/^[\w.-]+\.tar\.gz$/.test(pointer.bundleAsset)
) {
  throw new Error('invalid Quasi release tag or bundle asset name');
}
if (!/^[a-f0-9]{64}$/.test(pointer.sha256)) {
  throw new Error('invalid Quasi bundle SHA-256');
}

try {
  const stamp = JSON.parse(await readFile(stampPath, 'utf8'));
  if (stamp.sha256 === pointer.sha256) {
    console.log(
      `Quasi web assets are current (${pointer.sha256.slice(0, 12)}).`
    );
    process.exit(0);
  }
} catch {
  // A missing or malformed stamp means the generated directory needs a refresh.
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'quasi-web-'));
const archivePath = join(temporaryRoot, 'bundle.tar.gz');
const unpackPath = join(temporaryRoot, 'unpacked');
const url = `https://github.com/${pointer.repository}/releases/download/${pointer.tag}/${pointer.bundleAsset}`;

try {
  console.log(`Downloading Quasi ${pointer.quasiRevision ?? 'web bundle'}…`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok)
    throw new Error(`download failed with HTTP ${response.status}: ${url}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pointer.sha256) {
    throw new Error(
      `bundle checksum mismatch: expected ${pointer.sha256}, got ${digest}`
    );
  }
  await writeFile(archivePath, bytes);

  const entries = (await run('tar', ['-tzf', archivePath]))
    .split('\n')
    .filter(Boolean);
  if (entries.length === 0) throw new Error('Quasi bundle is empty');
  for (const entry of entries) {
    const normalized = normalize(entry);
    if (
      normalized.startsWith(`..${sep}`) ||
      normalized === '..' ||
      normalized.startsWith(sep)
    ) {
      throw new Error(`unsafe path in Quasi bundle: ${entry}`);
    }
  }

  await mkdir(unpackPath);
  await run('tar', ['-xzf', archivePath, '-C', unpackPath, '--no-same-owner']);
  await stat(join(unpackPath, 'quasi.js'));
  await stat(join(unpackPath, 'quasi_bg.wasm'));
  await writeFile(
    join(unpackPath, '.quasi-bundle.json'),
    `${JSON.stringify(pointer, null, 2)}\n`
  );

  await rm(outputPath, { recursive: true, force: true });
  await mkdir(join(root, 'public'), { recursive: true });
  await rename(unpackPath, outputPath);
  console.log(`Staged Quasi at ${outputPath}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
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
