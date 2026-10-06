import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileIconKind,
  fileIconShapes,
  type FileIconKind,
} from '../../src/lib/jai/file-icons.ts';

test('file icons follow the extension', () => {
  assert.equal(fileIconKind('main.jai'), 'jai');
  assert.equal(fileIconKind('modules/Basic/Print.JAI'), 'jai');
  assert.equal(fileIconKind('jaifmt.toml'), 'config');
  assert.equal(fileIconKind('notes.md'), 'markdown');
  assert.equal(fileIconKind('todo.txt'), 'text');
  assert.equal(fileIconKind('Makefile'), 'file');
  assert.equal(fileIconKind('.jai/readme'), 'file');
});

test('every glyph has its own shapes', () => {
  const kinds: FileIconKind[] = [
    'jai',
    'config',
    'markdown',
    'text',
    'file',
    'folder',
    'folder-open',
    'lock',
  ];
  const drawn = kinds.map((kind) =>
    fileIconShapes(kind)
      .map((shape) => shape.d)
      .join('|')
  );
  assert.equal(new Set(drawn).size, kinds.length);
  // No glyph is built on another's outline (the old page-with-badge style).
  for (const [i, a] of drawn.entries())
    for (const [j, b] of drawn.entries())
      if (i !== j)
        assert.ok(!b.startsWith(a), `${kinds[j]} extends ${kinds[i]}`);
});
