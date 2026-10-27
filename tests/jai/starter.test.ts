import test from 'node:test';
import assert from 'node:assert/strict';
import { projectConfigStarter } from '../../src/lib/jai/project-config.ts';
import {
  examplesIndex,
  loadExample,
  loadExamples,
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
    'jacket.toml': projectConfigStarter,
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

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  title: `Title ${name}`,
  summary: `About ${name}`,
  main: 'main.jai',
  files: ['main.jai', 'jacket.toml'],
  assets: [],
  ...extra,
});
const catalog = (...examples: unknown[]) =>
  JSON.stringify({ schema_version: 2, examples });

test('examples.json keeps usable entries in order and drops the rest', () => {
  const parsed = examplesIndex(
    JSON.parse(
      catalog(
        entry('basics'),
        entry('../up'),
        entry('basics'),
        entry('no-main', { files: ['other.jai'] }),
        entry('bad-asset', { assets: ['../x.png'] }),
        entry('no-assets', { assets: undefined }),
        entry('textured-cube', { assets: ['assets/jacket.png'] })
      )
    )
  );
  assert.deepEqual(
    parsed?.map(({ name }) => name),
    ['basics', 'textured-cube']
  );
  assert.deepEqual(parsed?.[1].assets, ['assets/jacket.png']);
  assert.equal(examplesIndex({ schema_version: 1, examples: [] }), undefined);
  assert.equal(examplesIndex(JSON.parse(catalog(entry('../up')))), undefined);
});

test('a session opens the first example from examples.json', async () => {
  const starter = await loadStarter(
    revision,
    new AbortController().signal,
    server({
      'examples.json': catalog(entry('basics'), entry('memory')),
      'basics/main.jai': 'basics\n',
      'basics/jacket.toml': '[format]\n',
      // The tour of older releases is not used when the catalog loads.
      'tour.json': index(['main.jai']),
      'tour/main.jai': 'tour\n',
    })
  );
  assert.deepEqual(starter, {
    files: { 'main.jai': 'basics\n', 'jacket.toml': '[format]\n' },
    open: ['main.jai'],
    example: 'basics',
  });
});

test('a broken examples.json falls back to the tour, then the built-in starter', async () => {
  const signal = new AbortController().signal;
  const tour = await loadStarter(
    revision,
    signal,
    server({
      'examples.json': '{"schema_version": 3}',
      'tour.json': index(['main.jai']),
      'tour/main.jai': 'tour\n',
    })
  );
  assert.equal(tour.files['main.jai'], 'tour\n');
  const builtin = await loadStarter(
    revision,
    signal,
    server({ 'examples.json': catalog(entry('basics')) })
  );
  assert.deepEqual(builtin.files, starterFiles);
});

test('an example with assets points load_asset at its folder', async () => {
  const requests: string[] = [];
  const fetcher = server(
    {
      'examples.json': catalog(
        entry('textured-cube', {
          files: ['main.jai'],
          assets: ['assets/jacket.png'],
        })
      ),
      'textured-cube/main.jai': 'main :: () {}\n',
    },
    requests
  );
  const signal = new AbortController().signal;
  const [example] = await loadExamples(revision, signal, fetcher);
  assert.equal(example.summary, 'About textured-cube');
  const starter = await loadExample(revision, example, signal, fetcher);
  assert.deepEqual(starter, {
    files: {
      'main.jai': 'main :: () {}\n',
      'jacket.toml': projectConfigStarter,
    },
    open: ['main.jai'],
    example: 'textured-cube',
    assets: `/jai/${revision}/textured-cube/`,
  });
  // Assets are fetched by the program, not copied into the workspace.
  assert.ok(!requests.some((url) => url.endsWith('.png')));
});

test('a release without examples.json lists no examples', async () => {
  assert.deepEqual(
    await loadExamples(revision, new AbortController().signal, server({})),
    []
  );
});
