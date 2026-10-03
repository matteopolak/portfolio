import { readFile, mkdir, mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const pointer = JSON.parse(await readFile(join(root, 'jai-web-release.json'), 'utf8'));
if (!pointer.enabled) {
  console.log('Jai playground is awaiting its first verified release.');
  process.exit(0);
}
if (!/^[a-f0-9]{40}$/.test(pointer.revision) ||
    pointer.tag !== `jai-web-${pointer.revision}` ||
    !/^[\w.-]+\/[\w.-]+$/.test(pointer.repository) ||
    pointer.manifestAsset !== 'jai-playground.manifest.json' ||
    pointer.bundleAsset !== 'jai-playground.zip' ||
    !/^[a-f0-9]{64}$/.test(pointer.manifestSha256) ||
    !/^[a-f0-9]{64}$/.test(pointer.sha256)) {
  throw new Error('Invalid immutable Jai release pointer.');
}
const destination = join(root, 'public/jai', pointer.revision);
const temp = await mkdtemp(join(tmpdir(), 'jai-web-'));
try {
  const base = `https://github.com/${pointer.repository}/releases/download/${pointer.tag}`;
  for (const [name, digest, limit] of [
    [pointer.manifestAsset, pointer.manifestSha256, 2 * 1024 * 1024],
    [pointer.bundleAsset, pointer.sha256, 64 * 1024 * 1024],
  ]) {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`Jai ${name}: HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error(`Jai ${name} exceeds its size limit.`);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== digest) {
      throw new Error(`Jai ${name} checksum mismatch.`);
    }
    await writeFile(join(temp, name), bytes);
  }
  await new Promise((accept, reject) => {
    const child = spawn('python3', [join(root, 'scripts/verify-jai-bundle.py'), temp, pointer.revision], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? accept() : reject(new Error(`Jai bundle validation failed (${code}).`)));
  });
  await mkdir(join(root, 'public/jai'), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(join(temp, 'verified'), destination);
  console.log(`Staged verified Jai ${pointer.revision}.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
