import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import type { Config } from '../src/types/config.ts';
import { boldHtml, boldMarkdown, boldPlain } from '../src/lib/bold.ts';
import { pageMeta } from '../src/lib/content/page-meta.ts';
import { buildPosts } from '../src/lib/content/posts.ts';
import { buildProfile } from '../src/lib/content/profile.ts';
import { buildProjects } from '../src/lib/content/projects.ts';
import { buildSiteMarkdown } from '../src/lib/content/site-markdown.ts';
import { buildTimeline } from '../src/lib/content/timeline.ts';
import {
  absolutizeLinks,
  renderLlmsFull,
  renderLlmsTxt,
  toMarkdown,
} from '../src/lib/markdown-export.ts';

const config = parse(
  readFileSync(new URL('../portfolio.toml', import.meta.url), 'utf8')
) as unknown as Config;
const profile = buildProfile(config);
const posts = buildPosts([
  {
    id: 'hello.md',
    body: 'See [home](/) and ![pic](./pic.png).\n',
    data: {
      title: 'Hello "world"',
      date: new Date('2024-02-03'),
      description: 'A post',
      tags: ['a'],
    },
  },
  {
    id: 'draft.mdx',
    data: { title: 'Draft', date: new Date('2024-03-01'), published: false },
  },
]);
const projects = buildProjects([
  {
    id: 'p1',
    body: 'Body [x](/projects)',
    data: {
      title: 'P1',
      date: new Date('2025-01-01'),
      tags: ['rust'],
      repository: 'https://github.com/x/p1',
      ai: { usage: 'paired', summary: 'Pair-programmed.', models: ['m1'] },
    },
  },
]);
const timeline = buildTimeline({
  projects,
  jobs: [{ id: 'j', company: 'Acme', start: '2024-05-01' }],
  milestones: [
    {
      id: 'm',
      date: '2024-06-01',
      title: 'Milestone',
      detail: 'D',
      category: 'ai',
      sourceUrl: 'https://example.com/m',
    },
  ],
  hackathons: [],
});
const site = buildSiteMarkdown({
  profile,
  posts,
  projects,
  timeline,
  meta: {
    home: pageMeta('/', config.description),
    blog: pageMeta('/blog', config.description),
    projects: pageMeta('/projects', config.description),
  },
});

test('bold has one parser with three renderers', () => {
  const text = 'Fixed *2* crashes in *Cowork* <b> & more';
  assert.equal(
    boldMarkdown(text),
    'Fixed **2** crashes in **Cowork** <b> & more'
  );
  assert.equal(boldPlain(text), 'Fixed 2 crashes in Cowork <b> & more');
  assert.equal(
    boldHtml(text),
    'Fixed <strong>2</strong> crashes in <strong>Cowork</strong> &lt;b&gt; &amp; more'
  );
});

test('home markdown converts bold and leaves out disabled items', () => {
  const { body } = site.home.doc;
  assert.ok(body.startsWith('# Matthew Polak'));
  assert.ok(body.includes('**Cowork**'));
  assert.ok(!body.includes('*Cowork*') || body.includes('**Cowork**'));
  assert.ok(
    !/(^|[^*])\*(Cowork|React)\*([^*]|$)/.test(body),
    'no single-star markers remain'
  );
  assert.ok(!body.includes('Ignite'), 'disabled job');
  assert.ok(!body.includes('RoboEDU'), 'disabled job');
  for (const heading of [
    '## Experience',
    '## Selected work',
    '## Education',
    '## Skills',
    '## Achievements',
  ])
    assert.ok(body.includes(heading), heading);
  // Commented-out bullets stay out.
  assert.ok(!body.includes('Re-architected an 8,000-line'));
});

test('toMarkdown writes quoted YAML frontmatter and skips empty fields', () => {
  const text = toMarkdown(site.posts[0].doc);
  assert.ok(
    text.startsWith(
      '---\ntitle: "Hello \\"world\\""\ndate: "2024-02-03"\ndescription: "A post"\nurl: "https://matteopolak.com/blog/hello"\ntags:\n  - "a"\n---\n\n# Hello "world"\n'
    )
  );
  const none = toMarkdown({
    meta: { title: 'T', description: undefined, tags: [] },
    body: 'x',
  });
  assert.equal(none, '---\ntitle: "T"\n---\n\nx\n');
});

test('only published posts get a markdown variant', () => {
  assert.deepEqual(
    site.posts.map((p) => p.post.slug),
    ['hello']
  );
});

test('absolutizeLinks rewrites relative links and images only', () => {
  const base = 'https://matteopolak.com/blog/hello';
  const input = [
    '[a](/projects) [b](./pic.png) [c](../x) [d](#frag) ![i](img.png "t")',
    '[abs](https://example.com/a) [mail](mailto:me@x.com) [proto](//cdn.example/x)',
    'inline `[no](/code)` then [yes](/yes)',
    '[ref]: /docs',
    '```md',
    '[fenced](/not-rewritten)',
    '```',
    '[after](/after)',
  ].join('\n');
  assert.equal(
    absolutizeLinks(input, base),
    [
      '[a](https://matteopolak.com/projects) [b](https://matteopolak.com/blog/pic.png) [c](https://matteopolak.com/x) [d](https://matteopolak.com/blog/hello#frag) ![i](https://matteopolak.com/blog/img.png "t")',
      '[abs](https://example.com/a) [mail](mailto:me@x.com) [proto](//cdn.example/x)',
      'inline `[no](/code)` then [yes](https://matteopolak.com/yes)',
      '[ref]: https://matteopolak.com/docs',
      '```md',
      '[fenced](/not-rewritten)',
      '```',
      '[after](https://matteopolak.com/after)',
    ].join('\n')
  );
});

test('post markdown has absolute links', () => {
  const { body } = site.posts[0].doc;
  assert.ok(body.includes('[home](https://matteopolak.com/)'));
  assert.ok(body.includes('![pic](https://matteopolak.com/blog/pic.png)'));
});

test('projects markdown keeps page order and renders the timeline', () => {
  const { body } = site.projects.doc;
  assert.ok(body.includes('### P1'));
  assert.ok(body.includes('AI-assisted: Pair-programmed.'));
  assert.ok(body.includes('Body [x](https://matteopolak.com/projects)'));
  const events = body.slice(body.indexOf('## Timeline'));
  const order = ['P1', 'Milestone', 'Started at Acme'].map((t) =>
    events.indexOf(t)
  );
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'newest first'
  );
});

test('markdown frontmatter titles and descriptions come from the page meta', () => {
  const routes = [
    ['/', site.home],
    ['/blog', site.blog],
    ['/projects', site.projects],
  ] as const;
  for (const [route, page] of routes) {
    const meta = pageMeta(route, config.description);
    assert.equal(page.doc.meta.title, meta.title, route);
    assert.equal(page.doc.meta.description, meta.description, route);
    if (meta.heading)
      assert.ok(page.doc.body.startsWith(`# ${meta.heading}`), route);
  }
});

test('llms.txt follows the convention and links each markdown page', () => {
  const text = renderLlmsTxt(site);
  const lines = text.split('\n');
  assert.equal(lines[0], '# Matthew Polak');
  assert.ok(lines[2].startsWith('> '));
  for (const heading of [
    '## Pages',
    '## Blog posts',
    '## Projects',
    '## Optional',
  ])
    assert.ok(text.includes(heading), heading);
  for (const url of ['/index.md', '/projects.md', '/blog.md', '/blog/hello.md'])
    assert.ok(text.includes(`https://matteopolak.com${url}`), url);
  assert.ok(!text.includes('draft'));
  const full = renderLlmsFull(site);
  assert.ok(full.includes('Source: https://matteopolak.com/blog/hello'));
  assert.ok(
    !full.includes('\n---\ntitle:'),
    'no per-page frontmatter in the full file'
  );
});
