import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markdownHover,
  renderHoverMarkdown,
} from '../../src/lib/hover-markdown.ts';

test('only MarkupContent of kind markdown is read as Markdown', () => {
  assert.equal(markdownHover({ kind: 'markdown', value: '`x`' } as never), '`x`');
  assert.equal(markdownHover({ kind: 'plaintext', value: 'x' } as never), undefined);
  assert.equal(markdownHover('x'), undefined);
  assert.equal(markdownHover(['x']), undefined);
});

test('a break followed by an emphasized paragraph is a section divider', () => {
  const html = renderHoverMarkdown(
    '```jai\n#insert\n```\n\n---\n\n*expands to (1 of 2)*\n\n```jai\nx := 1;\n```'
  );
  assert.equal(
    html,
    '<pre data-lang="jai"><code>#insert</code></pre>\n' +
      '<div class="jai-hover__divider" role="separator">expands to (1 of 2)</div>\n' +
      '<pre data-lang="jai"><code>x := 1;</code></pre>\n'
  );
  // A break with anything else after it stays a rule.
  assert.match(renderHoverMarkdown('a\n\n---\n\n*b* c'), /<hr>/u);
});

test('an overload set gets a count and one row per declaration', () => {
  const html = renderHoverMarkdown(
    '```jai\nprint :: (a: int)\nprint :: (b: string) -> bool\n```'
  );
  assert.equal(
    html,
    '<div class="jai-hover__count">2 overloads</div>\n' +
      '<pre class="jai-hover__overload" data-lang="jai"><code>print :: (a: int)</code></pre>\n' +
      '<pre class="jai-hover__overload" data-lang="jai"><code>print :: (b: string) -&gt; bool</code></pre>\n'
  );
});

test('format-string rows are a plain list; the hovered one is bold', () => {
  const html = renderHoverMarkdown(
    '```jai\n"% %\\n"\n```\n\n- **`%`** → `count: s64`\n- `%` → missing argument 2'
  );
  assert.match(
    html,
    /<li><strong><code>%<\/code><\/strong> → <code>count: s64<\/code><\/li>/u
  );
  assert.match(html, /<li><code>%<\/code> → missing argument 2<\/li>/u);
});

test('raw HTML and links are shown as text', () => {
  const html = renderHoverMarkdown('<b>x</b> [y](https://example.com)');
  assert.equal(html, '<p>&lt;b&gt;x&lt;/b&gt; y</p>\n');
  assert.equal(
    renderHoverMarkdown('a \\*b\\* \\<c\\>'),
    '<p>a *b* &lt;c&gt;</p>\n'
  );
});
