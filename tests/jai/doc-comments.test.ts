import test from 'node:test';
import assert from 'node:assert/strict';
import {
  docCommentSegments,
  type CommentExtent,
  type DocStyle,
} from '../../src/lib/jai/doc-comments.ts';
import {
  highlightJai,
  jaiSpanStyle,
  jaiTokenStyles,
} from '../../src/lib/highlight-jai.ts';

/** A `//` comment from its marker to the end of the line. */
const lineComment = (line: string): CommentExtent => {
  const from = line.indexOf('//');
  return {
    from,
    to: line.length,
    contentFrom: from + 2,
    contentTo: line.length,
    kind: 'line',
  };
};

/** The styled pieces of a line as `[text, styles]`, plain runs left out. */
function styled(line: string, extent = lineComment(line)) {
  const segments = docCommentSegments(line, extent);
  // The segments tile the comment exactly.
  assert.equal(segments[0].from, extent.from);
  assert.equal(segments.at(-1)?.to, extent.to);
  for (let i = 1; i < segments.length; i++)
    assert.equal(segments[i].from, segments[i - 1].to);
  return segments
    .filter((segment) => segment.styles.length)
    .map(({ from, to, styles }) => [line.slice(from, to), styles.join(' ')]);
}

test('inline Markdown keeps its markers inside the styled range', () => {
  assert.deepEqual(
    styled('// Scales a [Point] by `factor`, **fast** and *exact* or _not_.'),
    [
      ['Point', 'link'],
      ['`factor`', 'code'],
      ['**fast**', 'strong'],
      ['*exact*', 'emphasis'],
      ['_not_', 'emphasis'],
    ]
  );
});

test('links name the label and the target, not the brackets', () => {
  assert.deepEqual(styled('// See [the text](print) and [Point.x].'), [
    ['the text', 'link'],
    ['print', 'link'],
    ['Point.x', 'link'],
  ]);
  // Indexing, numbers and double brackets are not links.
  assert.deepEqual(styled('// a[i] and [0] and [x][y]'), []);
});

test('code wins over what it contains; earliest match first', () => {
  assert.deepEqual(styled('// `[print]` and `**x**`'), [
    ['`[print]`', 'code'],
    ['`**x**`', 'code'],
  ]);
  assert.deepEqual(styled('// snake_case_name stays plain'), []);
});

test('headings and list markers only on whole-line comments', () => {
  assert.deepEqual(styled('// # Scaling `p`'), [
    ['# Scaling ', 'heading'],
    ['`p`', 'heading code'],
  ]);
  assert.deepEqual(styled('    // - p: the point'), [['-', 'list']]);
  assert.deepEqual(styled('// * item *not emphasis'), [['*', 'list']]);
  assert.deepEqual(styled('//   1. first'), [['1.', 'list']]);
  // After code on the same line they are plain text.
  assert.deepEqual(styled('x := 1; // # not a heading'), []);
  assert.deepEqual(styled('x := 1; // - not a list'), []);
});

test('block comment continuation lines get headings and bullets', () => {
  const line = ' * - `count`: how many';
  const extent: CommentExtent = {
    from: 0,
    to: line.length,
    contentFrom: 0,
    contentTo: line.length,
    kind: 'block',
  };
  assert.deepEqual(styled(line, extent), [
    ['-', 'list'],
    ['`count`', 'code'],
  ]);
  const heading = ' ## Notes */';
  assert.deepEqual(
    styled(heading, {
      from: 0,
      to: heading.length,
      contentFrom: 0,
      contentTo: heading.length - 2,
      kind: 'block',
    }),
    [['## Notes ', 'heading']]
  );
});

test('the tokenizer tags comment Markdown across lines and blocks', () => {
  const source = [
    '// # Divide',
    '// Returns [a] / `b`.',
    'divide :: (a: int, b: int) -> int { return a / b; } // **fast**',
    '/* Ring of',
    ' * - _items_',
    ' */',
    's := "// [not] a comment";',
  ].join('\n');
  const lines = highlightJai(source);
  assert.equal(
    lines.map((line) => line.map(({ text }) => text).join('')).join('\n'),
    source
  );
  const docs = lines
    .flat()
    .filter((span) => span.doc)
    .map(({ text, token, doc }) => [text, token, doc?.join(' ')]);
  assert.deepEqual(docs, [
    ['# Divide', 'comment', 'heading'],
    ['a', 'comment', 'link'],
    ['`b`', 'comment', 'code'],
    ['**fast**', 'comment', 'strong'],
    ['-', 'comment', 'list'],
    ['_items_', 'comment', 'emphasis'],
  ]);
});

test('blog spans style comment Markdown like the editor', () => {
  const style = (doc: DocStyle[]) => jaiSpanStyle('comment', doc);
  assert.match(style(['strong']), /font-weight:600/u);
  assert.match(style(['heading']), /font-weight:600/u);
  assert.doesNotMatch(style(['code']), /font-style:italic/u);
  assert.ok(
    style(['link']).includes(`--shiki-light:${jaiTokenStyles.type.light}`)
  );
  assert.equal(style([]), jaiSpanStyle('comment'));
});
