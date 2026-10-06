import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMarkdownPath,
  joinPath,
  markdownView,
  parseViewChoice,
  renderMarkdown,
  resolveLink,
  slug,
} from '../../src/lib/markdown-render.ts';

const files = ['main.jai', 'lib/math.jai', 'docs/README.md', 'notes.md'];
const render = (source: string, path = 'notes.md') =>
  renderMarkdown(source, { path, files });

test('markdown paths', () => {
  assert.ok(isMarkdownPath('README.md'));
  assert.ok(isMarkdownPath('docs/Guide.MARKDOWN'));
  assert.ok(!isMarkdownPath('main.jai'));
  assert.ok(!isMarkdownPath('md'));
  assert.ok(!isMarkdownPath(undefined));
});

test('phone view: preview by default, the saved choice otherwise', () => {
  assert.equal(markdownView(undefined), 'preview');
  assert.equal(markdownView('source'), 'source');
  assert.equal(markdownView('preview'), 'preview');
  // A new, empty file opens where it can be typed into.
  assert.equal(markdownView('preview', true), 'source');
  assert.equal(markdownView(undefined, true), 'source');
});

test('stored view choices are validated', () => {
  assert.equal(parseViewChoice(null), undefined);
  assert.equal(parseViewChoice('not json'), undefined);
  assert.equal(parseViewChoice('source'), 'source');
  assert.equal(parseViewChoice('preview'), 'preview');
  // The record older versions stored keeps its phone choice.
  assert.equal(
    parseViewChoice('{"wide":"preview","narrow":"source"}'),
    'source'
  );
  assert.equal(parseViewChoice('{"wide":"split","narrow":"split"}'), undefined);
  assert.equal(parseViewChoice('split'), undefined);
});

test('relative paths resolve against the file folder', () => {
  assert.equal(joinPath('docs/README.md', '../main.jai'), 'main.jai');
  assert.equal(joinPath('docs/README.md', './a/b.md'), 'docs/a/b.md');
  assert.equal(joinPath('docs/README.md', '/lib/math.jai'), 'lib/math.jai');
  assert.equal(joinPath('README.md', '../../etc'), undefined);
});

test('links: workspace files, anchors, external and blocked', () => {
  assert.deepEqual(resolveLink('main.jai', 'notes.md', files), {
    kind: 'file',
    path: 'main.jai',
    anchor: undefined,
  });
  assert.deepEqual(
    resolveLink('../lib/math.jai#square', 'docs/README.md', files),
    {
      kind: 'file',
      path: 'lib/math.jai',
      anchor: 'square',
    }
  );
  assert.deepEqual(resolveLink('lib%2Fmath.jai?x=1', 'notes.md', files), {
    kind: 'file',
    path: 'lib/math.jai',
    anchor: undefined,
  });
  assert.deepEqual(resolveLink('#Getting%20started', 'notes.md', files), {
    kind: 'anchor',
    anchor: 'Getting started',
  });
  assert.deepEqual(resolveLink('missing.jai', 'notes.md', files), {
    kind: 'missing',
    path: 'missing.jai',
  });
  assert.deepEqual(resolveLink('https://example.com/a', 'notes.md', files), {
    kind: 'external',
    href: 'https://example.com/a',
  });
  assert.deepEqual(resolveLink('//example.com', 'notes.md', files), {
    kind: 'external',
    href: 'https://example.com',
  });
  assert.equal(resolveLink('mailto:a@b.c', 'notes.md', files).kind, 'external');
  for (const href of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
  ])
    assert.equal(resolveLink(href, 'notes.md', files).kind, 'blocked', href);
});

test('slugs follow GitHub', () => {
  assert.equal(slug('Getting Started!'), 'getting-started');
  assert.equal(slug('  `code` & more '), 'code--more');
  assert.equal(slug('Überblick 2'), 'überblick-2');
});

test('rendered links carry their kind', () => {
  const html = render(
    '[m](main.jai) [x](https://example.com) [s](#intro) [n](nope.md) [j](javascript:alert(1))'
  );
  assert.match(
    html,
    /<a href="#main.jai" title="Open main.jai" data-md-file="main.jai">m<\/a>/u
  );
  assert.match(
    html,
    /<a href="https:\/\/example.com" data-md-external="">x<\/a>/u
  );
  assert.match(html, /data-md-anchor="intro">s<\/a>/u);
  assert.match(html, /<span class="md-missing"[^>]*>n<\/span>/u);
  assert.match(html, /<span>j<\/span>/u);
  assert.doesNotMatch(html, /javascript:/u);
});

test('raw HTML is shown as text, never interpreted', () => {
  const html = render(
    '<script>alert(1)</script>\n\nInline <img src=x onerror=alert(1)> and <b>bold</b>.\n\n<div onclick="x">block</div>\n'
  );
  assert.doesNotMatch(html, /<script|<img|<b>|<div/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(
    html,
    /<p data-line="5" class="md-raw">&lt;div onclick=&quot;x&quot;&gt;block&lt;\/div&gt;<\/p>/u
  );
});

test('only https images load; titles and alt text are escaped', () => {
  const html = render(
    '![local](pic.png) ![web](https://e.com/a.png "t\\"x") ![bad](javascript:alert(1))'
  );
  assert.match(html, /<span class="md-image-alt">local<\/span>/u);
  assert.match(
    html,
    /<img src="https:\/\/e.com\/a.png" alt="web" title="t&quot;x"/u
  );
  assert.match(html, /<span class="md-image-alt">bad<\/span>/u);
});

test('GFM: tables, task lists, strikethrough and fenced code', () => {
  const html = render(
    '| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~\n\n```jai\nx := 1;\n```\n'
  );
  assert.match(html, /<div data-line="1" class="md-table"><table>/u);
  assert.match(html, /<td align="right">2<\/td>/u);
  assert.match(html, /<input checked="" disabled="" type="checkbox"> done/u);
  assert.match(html, /<del>old<\/del>/u);
  assert.match(
    html,
    /<pre data-line="10" class="md-code" data-lang="jai"><code>x := 1;<\/code><\/pre>/u
  );
});

test('fenced code uses the highlighter and escapes otherwise', () => {
  const highlight = (code: string, language: string) =>
    language === 'jai' ? `<span class="k">${code.length}</span>` : undefined;
  const html = renderMarkdown('```jai\nabc\n```\n\n```c\na<b\n```\n', {
    path: 'notes.md',
    files,
    highlight,
  });
  assert.match(html, /<code><span class="k">3<\/span><\/code>/u);
  assert.match(html, /<code>a&lt;b<\/code>/u);
});

test('blocks carry their first source line; headings get unique anchors', () => {
  const html = render('# Intro\n\ntext\nmore\n\n## Intro\r\n\r\n- a\n- b\n');
  assert.match(html, /<h1 data-line="1" data-anchor="intro">/u);
  assert.match(html, /<p data-line="3">text\nmore<\/p>/u);
  assert.match(html, /<h2 data-line="6" data-anchor="intro-1">/u);
  assert.match(html, /<ul data-line="8">/u);
  assert.doesNotMatch(html, /\sid=/u);
});

test('reference links resolve per block', () => {
  const html = render('See [math][m].\n\n[m]: lib/math.jai\n');
  assert.match(html, /data-md-file="lib\/math.jai">math<\/a>/u);
});

test('source highlighting: markup is not coloured as a Jai directive', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { ensureSyntaxTree } = await import('@codemirror/language');
  const { highlightTree, tagHighlighter, tags } =
    await import('@lezer/highlight');
  const { markdownSyntax } = await import('../../src/lib/markdown-language.ts');
  const doc =
    '# Title\n\n**b** *i* `c` > q\n\n- item\n\n```jai\nx :: 1;\n```\n';
  const state = EditorState.create({ doc, extensions: markdownSyntax });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const ranges: [number, number, string][] = [];
  highlightTree(
    tree,
    tagHighlighter([
      { tag: tags.processingInstruction, class: 'directive' },
      { tag: tags.heading, class: 'heading' },
      { tag: tags.strong, class: 'strong' },
      { tag: tags.keyword, class: 'keyword' },
      { tag: tags.number, class: 'number' },
    ]),
    (from, to, cls) => ranges.push([from, to, cls])
  );
  const classAt = (text: string) =>
    ranges.find(
      ([from, to]) => from <= doc.indexOf(text) && doc.indexOf(text) < to
    )?.[2];
  assert.equal(classAt('#'), 'heading');
  assert.equal(classAt('**'), 'strong');
  assert.ok(!ranges.some(([, , cls]) => cls.includes('directive')));
  // The fenced block is parsed as Jai.
  assert.equal(classAt('1;'), 'number');
});
