import {
  readFile,
  mkdir,
  mkdtemp,
  writeFile,
  rm,
  rename,
  copyFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
interface ReleasePointer {
  enabled: boolean;
  repository: string;
  revision: string;
  tag: string;
  manifestAsset: string;
  manifestSha256: string;
  bundleAsset: string;
  sha256: string;
}

const pointer: ReleasePointer = JSON.parse(
  await readFile(join(root, 'releases', 'jai-web-release.json'), 'utf8')
);
if (!pointer.enabled) {
  console.log('Jai playground is awaiting its first verified release.');
  process.exit(0);
}
if (
  !/^[a-f0-9]{40}$/.test(pointer.revision) ||
  pointer.tag !== `jai-web-${pointer.revision}` ||
  !/^[\w.-]+\/[\w.-]+$/.test(pointer.repository) ||
  pointer.manifestAsset !== 'jai-playground.manifest.json' ||
  pointer.bundleAsset !== 'jai-playground.zip' ||
  !/^[a-f0-9]{64}$/.test(pointer.manifestSha256) ||
  !/^[a-f0-9]{64}$/.test(pointer.sha256)
) {
  throw new Error('Invalid immutable Jai release pointer.');
}
const destination = join(root, 'public/jai', pointer.revision);

/*
 * JAI_WEB_LOCAL=<dir> stages a local `tools/build_scripting_wasm.py --output <dir>`
 * build under the pinned revision instead of the release, for testing compiler
 * changes before a pin bump. Unverified and never committed (public/jai is
 * ignored); the next sync without it restores the pinned release.
 */
const local = process.env.JAI_WEB_LOCAL;
if (local) {
  const source = resolve(local);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const optional: Record<string, string> = {
    'jaifmt-playground.jai': 'Format stays hidden',
    'jaifmt.wasm': 'Format runs the slower engine driver (build with --jaic)',
    'webgpu_host.mjs': 'WebGPU programs cannot draw',
    'webgpu_bindings.generated.mjs': 'WebGPU programs cannot draw',
  };
  for (const name of ['jai_wasm.wasm', ...Object.keys(optional)]) {
    try {
      await copyFile(join(source, name), join(destination, name));
    } catch (error) {
      if (!(name in optional)) throw error;
      console.warn(`Local Jai build has no ${name}; ${optional[name]}.`);
    }
  }
  // The language tour: tour.json lists the files under tour/ (src/lib/jai/starter.ts).
  try {
    const index = await readFile(join(source, 'tour.json'), 'utf8');
    const files: unknown = JSON.parse(index).files;
    if (!Array.isArray(files)) throw new Error('tour.json has no file list');
    for (const name of files) {
      if (
        typeof name !== 'string' ||
        name
          .split('/')
          .some((part) => part === '' || part === '.' || part === '..')
      )
        throw new Error(`Unsafe tour path ${JSON.stringify(name)}`);
      const target = join(destination, 'tour', name);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(source, 'tour', name), target);
    }
    await writeFile(join(destination, 'tour.json'), index);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.warn(
      'Local Jai build has no tour; the playground uses the built-in starter.'
    );
  }
  console.log(`Staged local Jai build from ${source} as ${pointer.revision}.`);
  process.exit(0);
}
const temp = await mkdtemp(join(tmpdir(), 'jai-web-'));
try {
  const base = `https://github.com/${pointer.repository}/releases/download/${pointer.tag}`;
  const assets: [string, string, number][] = [
    [pointer.manifestAsset, pointer.manifestSha256, 2 * 1024 * 1024],
    [pointer.bundleAsset, pointer.sha256, 64 * 1024 * 1024],
  ];
  for (const [name, digest, limit] of assets) {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok || !response.body)
      throw new Error(`Jai ${name}: HTTP ${response.status}`);
    const chunks: Uint8Array[] = [];
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
  await new Promise<void>((accept, reject) => {
    const child = spawn(
      'python3',
      [join(root, 'scripts/verify-jai-bundle.py'), temp, pointer.revision],
      { stdio: 'inherit' }
    );
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? accept()
        : reject(new Error(`Jai bundle validation failed (${code}).`))
    );
  });
  await mkdir(join(root, 'public/jai'), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(join(temp, 'verified'), destination);
  console.log(`Staged verified Jai ${pointer.revision}.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
