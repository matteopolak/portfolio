import test from 'node:test';
import assert from 'node:assert/strict';
import { formatConfigStarter } from '../../src/lib/jai/format.ts';
import {
  loadStarter,
  starterFiles,
  tourPaths,
} from '../../src/lib/jai/starter.ts';

const revision = 'a'.repeat(40);

/** A fetch stand-in serving `assets` (paths under /jai/<revision>/). */
function server(assets: Record<string, string>, requests: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    const prefix = `/jai/${revision}/`;
    const body = url.startsWith(prefix)
      ? assets[decodeURIComponent(url.slice(prefix.length))]
      : undefined;
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;
}

const index = (files: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schema_version: 1, main: 'main.jai', files, ...extra });

test('the tour loads as a multi-folder workspace with jaifmt.toml and its guide open', async () => {
  const requests: string[] = [];
  const fetcher = server(
    {
      'tour.json': index(['main.jai', 'meta/macros.jai', 'tour.md']),
      'tour/main.jai': 'main :: () {}\n',
      'tour/meta/macros.jai': 'm :: () #expand {}\n',
      'tour/tour.md': '# Tour\n',
    },
    requests
  );
  const starter = await loadStarter(
    revision,
    new AbortController().signal,
    fetcher
  );
  assert.deepEqual(starter.files, {
    'main.jai': 'main :: () {}\n',
    'meta/macros.jai': 'm :: () #expand {}\n',
    'tour.md': '# Tour\n',
    'jaifmt.toml': formatConfigStarter,
  });
  assert.deepEqual(starter.open, ['main.jai', 'tour.md']);
  assert.ok(requests.includes(`/jai/${revision}/tour/meta/macros.jai`));
});

test('a release without a tour, or with a broken one, opens the built-in starter', async () => {
  const signal = new AbortController().signal;
  const cases: Record<string, string>[] = [
    {},
    { 'tour.json': 'not json' },
    {
      'tour.json': index(['main.jai', 'lib/missing.jai']),
      'tour/main.jai': 'x',
    },
  ];
  for (const assets of cases) {
    const starter = await loadStarter(revision, signal, server(assets));
    assert.deepEqual(starter, { files: starterFiles, open: ['main.jai'] });
  }
});

test('an aborted load throws instead of falling back', async () => {
  const controller = new AbortController();
  const fetcher = (async () => {
    controller.abort();
    throw new DOMException('Closed', 'AbortError');
  }) as typeof fetch;
  await assert.rejects(
    loadStarter(revision, controller.signal, fetcher),
    /Closed/
  );
});

test('tour indexes must name main.jai and only plain relative paths', () => {
  assert.deepEqual(tourPaths(JSON.parse(index(['main.jai', 'a/b.jai']))), [
    'main.jai',
    'a/b.jai',
  ]);
  for (const files of [
    ['lib.jai'],
    ['main.jai', '../escape.jai'],
    ['main.jai', 'a/../b.jai'],
    ['main.jai', '/root.jai'],
    ['main.jai', './main.jai'],
    ['main.jai', 'main.jai'],
    ['main.jai', 7],
    [],
  ])
    assert.equal(
      tourPaths(JSON.parse(index(files))),
      undefined,
      JSON.stringify(files)
    );
  assert.equal(
    tourPaths(JSON.parse(index(['main.jai'], { schema_version: 2 }))),
    undefined
  );
  assert.equal(
    tourPaths(JSON.parse(index(['main.jai'], { main: 'x.jai' }))),
    undefined
  );
  assert.equal(tourPaths(null), undefined);
});
