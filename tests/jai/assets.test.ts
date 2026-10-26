import test from 'node:test';
import assert from 'node:assert/strict';
import { assetFunctions } from '../../src/lib/jai/engine.ts';

const memory = new Uint8Array(256);
const view = (pointer: number, length: number) =>
  memory.subarray(pointer, pointer + length);
const put = (pointer: number, text: string) => {
  const bytes = new TextEncoder().encode(text);
  memory.set(bytes, pointer);
  return [BigInt(pointer), BigInt(bytes.length)];
};
const HostMemory = { buffer: memory.buffer, alloc: () => 0, free: () => {} };

function withFetch(
  files: Record<string, Uint8Array<ArrayBuffer>>,
  requests: string[] = []
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    const body = files[url.pathname];
    return body
      ? new Response(body, { status: 200 })
      : new Response('missing', { status: 404 });
  }) as typeof fetch;
  return () => void (globalThis.fetch = original);
}

test('load_asset fetches inside the base and hands the bytes over once', async () => {
  const restore = withFetch({
    '/jai/rev/cube/assets/a.png': new Uint8Array([1, 2, 3]),
  });
  try {
    const host = assetFunctions(
      { base: 'https://example.test/jai/rev/cube' },
      view
    );
    const handle = await host.jai_asset_fetch(
      put(0, 'assets/a.png'),
      HostMemory
    );
    assert.equal(handle, 1);
    assert.equal(host.jai_asset_size([1n], HostMemory), 3);
    assert.equal(host.jai_asset_take([1n, 100n, 3n], HostMemory), 1);
    assert.deepEqual([...memory.subarray(100, 103)], [1, 2, 3]);
    // Taken: the handle is gone.
    assert.equal(host.jai_asset_size([1n], HostMemory), 0);
    assert.equal(host.jai_asset_take([1n, 100n, 3n], HostMemory), 0);
  } finally {
    restore();
  }
});

test('load_asset refuses paths that leave the base, missing files and oversize responses', async () => {
  const requests: string[] = [];
  const restore = withFetch({ '/base/big.bin': new Uint8Array(10) }, requests);
  try {
    const host = assetFunctions(
      { base: 'https://example.test/base/', limit: 4 },
      view
    );
    for (const path of [
      '../secret',
      'a/../../secret',
      '/root',
      'a//b',
      'c:\\x',
      'https://evil.test/x',
      '',
      'missing.png',
      'big.bin',
    ])
      assert.equal(
        await host.jai_asset_fetch(put(0, path), HostMemory),
        0,
        path
      );
    assert.deepEqual(requests, ['/base/missing.png', '/base/big.bin']);
  } finally {
    restore();
  }
});
