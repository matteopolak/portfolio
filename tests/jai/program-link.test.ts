import test from 'node:test';
import assert from 'node:assert/strict';
import {
  programFromHash,
  programFromSearch,
  programStarter,
} from '../../src/lib/jai/program-link.ts';

const link = (code: string) =>
  '#code=' + Buffer.from(code, 'utf8').toString('base64url');

test('a #code= link decodes base64url UTF-8 without padding', () => {
  for (const code of [
    'main :: () { print("hi\\n"); }\n',
    'greet :: "héllo, wörld ✓";\n',
    'a',
    'ab',
  ])
    assert.equal(programFromHash(link(code)), code);
  // Characters that differ from plain base64 (`-` and `_`).
  assert.equal(programFromHash(link('>>>???')), '>>>???');
});

test('a bad or missing #code= link is ignored', () => {
  for (const hash of [
    '',
    '#',
    '#main.jai',
    '#code=',
    '#code=a',
    '#code=ab+c',
    '#code=abc=',
    '#code=' + Buffer.from([0xff, 0xfe]).toString('base64url'),
  ])
    assert.equal(programFromHash(hash), undefined, hash);
});

test('a linked program opens as main.jai with the default jacket.toml', () => {
  const starter = programStarter('x :: 1;\n');
  assert.deepEqual(starter.open, ['main.jai']);
  assert.equal(starter.files['main.jai'], 'x :: 1;\n');
  assert.ok('jacket.toml' in starter.files);
});

test('a ?code= query carries the raw program, URL-encoded', () => {
  const code = 'main :: () { print("hi & bye\n"); } // ✓ 100%\n';
  assert.equal(programFromSearch('?code=' + encodeURIComponent(code)), code);
  assert.equal(programFromSearch('?x=1&code=a%2Bb'), 'a+b');
});

test('a missing or empty ?code= query is ignored', () => {
  for (const search of ['', '?', '?code=', '?other=1'])
    assert.equal(programFromSearch(search), undefined, search);
});
