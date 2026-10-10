import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import type { Config } from '../src/types/config.ts';
import { buildProfile } from '../src/lib/content/profile.ts';
import { buildPosts } from '../src/lib/content/posts.ts';
import { buildProjects } from '../src/lib/content/projects.ts';
import {
  allowedRoute,
  buildRoutes,
  markdownPathFor,
  normalizeRoutePath,
} from '../src/lib/content/routes.ts';
import { validateInput } from '../src/lib/webmcp/schema.ts';
import {
  listProjects,
  profileResult,
  searchPosts,
  stripAnsi,
  truncate,
} from '../src/lib/webmcp/logic.ts';
import { createToolRegistry } from '../src/lib/webmcp/registry.ts';
import {
  createRunCodeTool,
  resolveTheme,
  createSiteTools,
  toolsForPage,
  type AgentData,
  type ToolDeps,
} from '../src/lib/webmcp/tools.ts';
import { findModelContext } from '../src/lib/webmcp/types.ts';
import { defaultTheme, themes } from '../src/lib/themes.ts';
import type { RunTarget } from '../src/lib/run-target.ts';

const config = parse(
  readFileSync(new URL('../portfolio.toml', import.meta.url), 'utf8')
) as unknown as Config;

const posts = buildPosts([
  {
    id: 'axum-extract.md',
    body: '# Hi\n',
    data: {
      title: 'Axum extract',
      date: new Date('2023-11-22'),
      description: 'A deep dive',
      tags: ['rust', 'axum'],
    },
  },
  {
    id: 'draft.md',
    data: { title: 'Draft', date: new Date('2024-01-01'), published: false },
  },
  {
    id: 'newer.md',
    data: { title: 'Newer post', date: new Date('2024-05-01') },
  },
]);
const projects = buildProjects([
  {
    id: 'quasi',
    body: 'An interpreter.\n',
    data: {
      title: 'quasi',
      date: new Date('2023-11-01'),
      tags: ['Rust', 'wasm'],
      repository: 'https://github.com/matteopolak/quasi',
    },
  },
  {
    id: 'jai',
    body: 'A toolchain.',
    data: {
      title: 'jai',
      date: new Date('2026-10-01'),
      tags: ['rust'],
      repository: 'https://github.com/matteopolak/jai',
      ai: { usage: 'agent-orchestrated', summary: 's', models: ['m'] },
    },
  },
]);
const routes = buildRoutes({
  posts,
  playgrounds: [{ path: '/playground/quasi', title: 'Quasi' }],
});

test('validateInput accepts valid input and rejects the rest', () => {
  const schema = createSiteTools({} as ToolDeps).find(
    (t) => t.name === 'get_project'
  )!.inputSchema;
  assert.deepEqual(validateInput(schema, { slug: 'quasi' }), {
    ok: true,
    value: { slug: 'quasi' },
  });
  for (const bad of [
    undefined,
    null,
    [],
    {},
    { slug: 1 },
    { slug: '' },
    { slug: 'x'.repeat(81) },
    { slug: 'ok', extra: 'x' },
  ])
    assert.equal(validateInput(schema, bad).ok, false, JSON.stringify(bad));
  const enumSchema = createSiteTools({} as ToolDeps).find(
    (t) => t.name === 'get_profile'
  )!.inputSchema;
  assert.equal(validateInput(enumSchema, { section: 'nope' }).ok, false);
  assert.equal(validateInput(enumSchema, {}).ok, true);
});

test('profile builder keeps only enabled jobs and active bullets', () => {
  const profile = buildProfile(config);
  const ids = profile.experience.map((job) => job.id);
  assert.ok(ids.includes('mai-swe'));
  assert.ok(!ids.includes('ignite-freelance'), 'disabled job is excluded');
  assert.ok(!ids.includes('roboedu-instructor'));
  const mai = profile.experience.find((job) => job.id === 'mai-swe')!;
  // Commented-out bullets never reach the parsed config.
  assert.equal(mai.bullets.length, 4);
  assert.ok(mai.bullets.every((bullet) => !bullet.startsWith('#')));
  assert.equal(
    profile.links
      .find((l) => l.label === 'GitHub')
      ?.url.startsWith('https://github.com/'),
    true
  );
  assert.equal(profile.skills.length, 4);
});

test('profileResult strips bold markers and can return one section', () => {
  const result = profileResult(buildProfile(config)) as {
    experience: { highlights: string[] }[];
  };
  const text = JSON.stringify(result);
  assert.ok(!text.includes('*Cowork*'));
  assert.ok(text.includes('Cowork'));
  assert.ok(
    result.experience.every((job) =>
      job.highlights.every((h) => !h.includes('*'))
    )
  );
  const only = profileResult(buildProfile(config), 'education') as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(only), ['name', 'education']);
  const contact = profileResult(buildProfile(config), 'contact') as Record<
    string,
    unknown
  >;
  assert.ok('contact' in contact);
  assert.ok(
    JSON.stringify(
      profileResult(buildProfile(config), 'achievements')
    ).includes('Svelte')
  );
});

test('posts: unpublished are dropped and newest come first', () => {
  assert.deepEqual(
    posts.map((p) => p.slug),
    ['newer', 'axum-extract']
  );
  assert.equal(posts[1].url, 'https://matteopolak.com/blog/axum-extract');
  assert.equal(posts[1].markdownPath, '/blog/axum-extract.md');
});

test('searchPosts matches words in title, description and tags', () => {
  assert.deepEqual(
    searchPosts(posts, 'AXUM extract').map((p) => p.slug),
    ['axum-extract']
  );
  assert.deepEqual(
    searchPosts(posts, 'deep dive').map((p) => p.slug),
    ['axum-extract']
  );
  assert.deepEqual(
    searchPosts(posts, 'rust').map((p) => p.slug),
    ['axum-extract']
  );
  assert.deepEqual(searchPosts(posts, 'axum missing'), []);
  assert.deepEqual(searchPosts(posts, '   '), []);
});

test('listProjects filters by tag case-insensitively, newest first', () => {
  assert.deepEqual(
    listProjects(projects).map((p) => p.slug),
    ['jai', 'quasi']
  );
  assert.deepEqual(
    listProjects(projects, 'RUST').map((p) => p.slug),
    ['jai', 'quasi']
  );
  assert.deepEqual(
    listProjects(projects, 'wasm').map((p) => p.slug),
    ['quasi']
  );
  assert.deepEqual(listProjects(projects, 'go'), []);
});

test('navigate allow-list accepts only the site routes', () => {
  assert.equal(allowedRoute('/projects', routes), '/projects');
  assert.equal(allowedRoute('/projects/', routes), '/projects');
  assert.equal(allowedRoute('/projects.html', routes), '/projects');
  assert.equal(allowedRoute('/', routes), '/');
  assert.equal(
    allowedRoute('https://matteopolak.com/blog?x=1#y', routes),
    '/blog'
  );
  assert.equal(allowedRoute('/playground/quasi', routes), '/playground/quasi');
  assert.equal(
    allowedRoute('/blog/axum-extract', routes),
    '/blog/axum-extract'
  );
  for (const bad of [
    'https://evil.example/projects',
    '//evil.example/projects',
    'javascript:alert(1)',
    '/admin',
    '/blog/missing',
    '/_astro/x.js',
    '',
    42,
    undefined,
    '/' + 'a'.repeat(300),
  ])
    assert.equal(allowedRoute(bad, routes), undefined, String(bad));
  assert.equal(normalizeRoutePath('http://[bad'), undefined);
});

test('markdownPathFor skips the playgrounds', () => {
  assert.equal(markdownPathFor('/'), '/index.md');
  assert.equal(markdownPathFor('/blog'), '/blog.md');
  assert.equal(markdownPathFor('/blog/x'), '/blog/x.md');
  assert.equal(markdownPathFor('/playground'), undefined);
  assert.equal(markdownPathFor('/playground/jai'), undefined);
});

test('stripAnsi removes colour codes', () => {
  assert.equal(stripAnsi('\u001b[1;31merror\u001b[0m: x'), 'error: x');
});

test('truncate flags cut text', () => {
  assert.deepEqual(truncate('abc', 5), { text: 'abc', truncated: false });
  assert.deepEqual(truncate('abcdef', 3), { text: 'abc', truncated: true });
});

test('resolveTheme finds by id, name or next', () => {
  assert.equal(resolveTheme('Midnight', defaultTheme)?.id, 'midnight');
  assert.equal(resolveTheme(' moss ', defaultTheme)?.id, 'moss');
  assert.equal(resolveTheme('next', defaultTheme), themes[1]);
  assert.equal(resolveTheme('next', themes.at(-1)!), themes[0]);
  assert.equal(resolveTheme('nope', defaultTheme), undefined);
});

test('findModelContext prefers document and falls back to navigator', () => {
  const doc = { modelContext: { registerTool() {} } };
  const nav = { modelContext: { registerTool() {} } };
  assert.equal(findModelContext(doc, nav), doc.modelContext);
  assert.equal(findModelContext({}, nav), nav.modelContext);
  assert.equal(findModelContext({}, {}), undefined);
  assert.equal(findModelContext({ modelContext: {} }, {}), undefined);
});

function fakeDeps(target?: RunTarget) {
  const calls = { navigated: [] as string[], chosen: [] as string[] };
  let theme = defaultTheme;
  const data: AgentData = {
    profile: buildProfile(config),
    projects,
    blog: posts,
    routes,
  };
  const deps: ToolDeps = {
    load: async (name) => data[name],
    navigate: (path) => calls.navigated.push(path),
    theme: {
      current: () => theme,
      choose: (next) => {
        theme = next;
        calls.chosen.push(next.id);
      },
    },
    runTarget: () => target,
  };
  return { deps, calls };
}

const tool = (tools: ReturnType<typeof toolsForPage>, name: string) =>
  tools.find((t) => t.name === name)!;

test('registry registers once per tool and unregisters removed ones', () => {
  const registrations: { name: string; signal: AbortSignal }[] = [];
  const registry = createToolRegistry({
    registerTool: async (t, options) => {
      registrations.push({ name: t.name, signal: options!.signal! });
    },
  });
  const { deps } = fakeDeps();
  const site = toolsForPage(deps);
  registry.sync(site);
  registry.sync(site);
  registry.sync(toolsForPage(deps));
  assert.equal(registrations.length, site.length, 'no duplicates across syncs');
  const target: RunTarget = {
    language: 'quasi',
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
  const withRun = toolsForPage(fakeDeps(target).deps);
  registry.sync(withRun);
  assert.equal(registrations.length, site.length + 1);
  const run = registrations.find((r) => r.name === 'run_code')!;
  assert.equal(run.signal.aborted, false);
  registry.sync(site);
  assert.equal(
    run.signal.aborted,
    true,
    'run_code unregistered when the target goes away'
  );
  registry.sync(withRun);
  assert.equal(registrations.filter((r) => r.name === 'run_code').length, 2);
  registry.clear();
  assert.ok(registrations.every((r) => r.signal.aborted));
});

test('registry survives a registerTool that throws or rejects', async () => {
  const registry = createToolRegistry({
    registerTool: () => {
      throw new Error('nope');
    },
  });
  registry.sync(toolsForPage(fakeDeps().deps));
  assert.deepEqual(registry.names(), []);
  const rejecting = createToolRegistry({
    registerTool: () => Promise.reject(new Error('dup')),
  });
  rejecting.sync(toolsForPage(fakeDeps().deps));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(rejecting.names(), []);
});

test('site tools run against the data', async () => {
  const { deps, calls } = fakeDeps();
  const tools = toolsForPage(deps);
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      'get_profile',
      'list_projects',
      'get_project',
      'search_blog',
      'get_post',
      'navigate',
      'set_theme',
    ]
  );
  for (const name of [
    'get_profile',
    'list_projects',
    'get_project',
    'search_blog',
    'get_post',
  ])
    assert.equal(tool(tools, name).annotations?.readOnlyHint, true, name);
  assert.notEqual(tool(tools, 'navigate').annotations?.readOnlyHint, true);

  const profile = (await tool(tools, 'get_profile').execute({})) as {
    name: string;
  };
  assert.equal(profile.name, 'Matthew Polak');
  assert.deepEqual(
    await tool(tools, 'list_projects').execute({ tag: 'wasm' }),
    {
      count: 1,
      projects: listProjects(projects, 'wasm'),
    }
  );
  const project = (await tool(tools, 'get_project').execute({
    slug: 'quasi',
  })) as { slug: string };
  assert.equal(project.slug, 'quasi');
  assert.deepEqual(await tool(tools, 'get_project').execute({ slug: 'none' }), {
    error: 'No project "none". Use list_projects.',
  });
  const found = (await tool(tools, 'search_blog').execute({
    query: 'axum',
  })) as { count: number };
  assert.equal(found.count, 1);
  const post = (await tool(tools, 'get_post').execute({
    slug: 'axum-extract',
  })) as { body: string; title: string };
  assert.equal(post.title, 'Axum extract');
  assert.equal(post.body, '# Hi\n');
  assert.ok('error' in ((await tool(tools, 'get_post').execute({})) as object));

  const refused = (await tool(tools, 'navigate').execute({
    path: 'https://evil.example/',
  })) as { error: string };
  assert.match(refused.error, /not a page on this site/);
  assert.deepEqual(await tool(tools, 'navigate').execute({ path: '/blog/' }), {
    navigating: '/blog',
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(calls.navigated, ['/blog']);

  const listing = (await tool(tools, 'set_theme').execute({})) as {
    available: { id: string }[];
    current: { id: string };
  };
  assert.equal(listing.current.id, 'ember');
  assert.deepEqual(
    listing.available.map((t) => t.id),
    themes.map((t) => t.id)
  );
  const changed = (await tool(tools, 'set_theme').execute({
    theme: 'next',
  })) as { current: { id: string } };
  assert.equal(changed.current.id, themes[1].id);
  assert.deepEqual(calls.chosen, [themes[1].id]);
  assert.ok(
    'error' in
      ((await tool(tools, 'set_theme').execute({ theme: 'zzz' })) as object)
  );
});

test('run_code is only present with a target and truncates output', async () => {
  assert.ok(!toolsForPage(fakeDeps().deps).some((t) => t.name === 'run_code'));
  const big = 'x'.repeat(30_000);
  const requests: unknown[] = [];
  const target: RunTarget = {
    language: 'quasi',
    run: async (request) => {
      requests.push(request);
      return { stdout: big, stderr: '', exitCode: 0 };
    },
  };
  const { deps } = fakeDeps(target);
  const run = createRunCodeTool(deps);
  const result = (await run.execute({ code: 'print 1;' })) as {
    status: string;
    stdout: string;
    truncated: boolean;
  };
  assert.equal(result.status, 'ok');
  assert.equal(result.stdout.length, 20 * 1024);
  assert.equal(result.truncated, true);
  assert.deepEqual(requests, [{ code: 'print 1;', filename: undefined }]);
  assert.ok('error' in ((await run.execute({ code: '' })) as object));
  const failing = createRunCodeTool(
    fakeDeps({
      language: 'quasi',
      run: async () => ({ stdout: '', stderr: 'boom', exitCode: 1 }),
    }).deps
  );
  const failed = (await failing.execute({ code: 'x' })) as {
    status: string;
    stderr: string;
  };
  assert.deepEqual([failed.status, failed.stderr], ['failed', 'boom']);
});
