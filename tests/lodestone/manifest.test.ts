import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { normalize, sep } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Execute the actual validators without running downloads or mounting a DOM element.
const syncSource = await readFile(new URL('../../scripts/sync-lodestone-web.ts', import.meta.url), 'utf8');
const browserSource = await readFile(new URL('../../src/lib/lodestone-game.ts', import.meta.url), 'utf8');
const parseSource = syncSource.slice(syncSource.indexOf('function parseManifest('), syncSource.indexOf('function verifyDigest('));
const parseManifest: (bytes: Buffer) => unknown = runInNewContext(`${stripTypeScriptTypes(parseSource)}\nparseManifest`, {
  pointer: { lodestoneRevision: 'a'.repeat(40) }, normalize, sep,
});
const loadSource = stripTypeScriptTypes(
  browserSource.slice(browserSource.indexOf('  async #loadManifest('), browserSource.indexOf('  #launchWorker('))
    .replace('async #loadManifest(', 'async function loadManifest(')
);

interface Manifest {
  schema: string;
  schema_version: number;
  dirty_checkout: boolean;
  commit: string;
  entrypoint: string;
  worker_entrypoint: string;
  archive: { path: string; format: string; size: number; sha256: string };
  files: { path: string; size: number; sha256: string }[];
}
type Mutation = [label: string, mutate: (manifest: Manifest) => void];

function fixture(): Manifest {
  const entrypoint = 'lodestone-web-0123456789abcdef.js';
  const worker = 'lodestone-render-worker-0123456789abcdef.js';
  return {
    schema: 'lodestone-web-sdk', schema_version: 2,
    dirty_checkout: false, commit: 'a'.repeat(40),
    entrypoint, worker_entrypoint: worker,
    archive: { path: 'lodestone-web-sdk.tar.gz', format: 'tar.gz', size: 123, sha256: 'b'.repeat(64) },
    files: [entrypoint, entrypoint.replace('.js', '_bg.wasm'), worker, 'lodestone-resources.zip', 'blocks.json']
      .map((path) => ({ path, size: 123, sha256: 'c'.repeat(64) })),
  };
}

async function validateBrowser(manifest: Manifest): Promise<unknown> {
  const loadManifest: (signal: AbortSignal) => Promise<unknown> = runInNewContext(`${loadSource}\nloadManifest`, {
    SDK_MANIFEST_URL: '/lodestone/lodestone-web-sdk.manifest.json',
    fetch: async () => ({ ok: true, json: async () => manifest }),
  });
  return loadManifest(new AbortController().signal);
}

function validateSync(manifest: Manifest): unknown {
  return parseManifest(Buffer.from(JSON.stringify(manifest)));
}

const validators: [string, (manifest: Manifest) => unknown][] = [['sync', validateSync], ['browser', validateBrowser]];
for (const [name, validate] of validators) {
  test(`${name}: accepts merged resource archive without legacy assets`, async () => {
    await validate(fixture());
  });
  for (const required of ['lodestone-resources.zip', 'blocks.json', 'lodestone-render-worker-0123456789abcdef.js', 'lodestone-web-0123456789abcdef_bg.wasm']) {
    test(`${name}: rejects missing ${required}`, async () => {
      const manifest = fixture();
      manifest.files = manifest.files.filter((entry) => entry.path !== required);
      await assert.rejects(async () => validate(manifest));
    });
  }
  for (const forbidden of ['client.jar', 'panorama_0.png', 'lodestone-render-worker.js']) {
    test(`${name}: rejects obsolete ${forbidden}`, async () => {
      const manifest = fixture();
      manifest.files.push({ path: forbidden, size: 1, sha256: 'd'.repeat(64) });
      await assert.rejects(async () => validate(manifest));
    });
  }
  const mutations: Mutation[] = [
    ['schema', (m) => { m.schema_version = 1; }],
    ['worker path', (m) => { m.worker_entrypoint = '../worker.js'; }],
    ['digest', (m) => { m.files[0]!.sha256 = 'invalid'; }],
    ['size', (m) => { m.files[0]!.size = -1; }],
    ['unsafe path', (m) => { m.files[0]!.path = '../entry.js'; }],
    ['duplicate', (m) => { m.files.push(m.files[0]!); }],
  ];
  for (const [label, mutate] of mutations) {
    test(`${name}: rejects invalid ${label}`, async () => {
      const manifest = fixture();
      mutate(manifest);
      await assert.rejects(async () => validate(manifest));
    });
  }
}

const syncMutations: Mutation[] = [
  ['dirty checkout', (m) => { m.dirty_checkout = true; }],
  ['revision mismatch', (m) => { m.commit = 'd'.repeat(40); }],
  ['archive digest', (m) => { m.archive.sha256 = 'invalid'; }],
];
for (const [label, mutate] of syncMutations) {
  test(`sync: rejects ${label}`, async () => {
    const manifest = fixture();
    mutate(manifest);
    await assert.rejects(async () => validateSync(manifest));
  });
}
