import test from 'node:test';
import assert from 'node:assert/strict';
import { StringStream } from '@codemirror/language';
import { jaiTokenizer } from '../../src/lib/jai/language.ts';
import {
  EMBEDDED_LANGUAGES,
  embeddedLanguageFor,
} from '../../src/lib/jai/embedded-languages.ts';

/** Runs the tokenizer and returns `[text, style]` pairs, without whitespace. */
function tokens(source: string) {
  let state = jaiTokenizer.startState!(4);
  const out: [string, string | null][] = [];
  for (const line of source.split('\n')) {
    // Lines resume from a copy, as CodeMirror does after an edit.
    state = jaiTokenizer.copyState!(state);
    const stream = new StringStream(line, 4, 4);
    while (!stream.eol()) {
      const style = jaiTokenizer.token(stream, state);
      const text = stream.current();
      if (text.trim()) out.push([text.trim(), style]);
      stream.start = stream.pos;
    }
  }
  return out;
}
const styleOf = (source: string, text: string) =>
  tokens(source).find(([t]) => t === text)?.[1];

test('terminators name languages ignoring case; other words do not', () => {
  assert.equal(embeddedLanguageFor('WGSL'), 'wgsl');
  assert.equal(embeddedLanguageFor('wgsl'), 'wgsl');
  assert.equal(embeddedLanguageFor('Jai'), 'jai');
  for (const tag of ['END', 'DONE', 'WGSL_SOURCE', 'GLSL'])
    assert.equal(embeddedLanguageFor(tag), null, tag);
  // Tags are written in upper case, as in the VS Code extension's table.
  for (const { tags } of EMBEDDED_LANGUAGES)
    for (const tag of tags) assert.equal(tag, tag.toUpperCase());
});

const shader = `SHADER :: #string,cr WGSL
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var<storage, read_write> data: array<f32>; /* left open
    return vec4f(1.0, 0.5h, 2u, 0x1F);
    WGSL;
after := 1;`;

test('a #string WGSL body is tokenized as WGSL', () => {
  const out = tokens(shader);
  assert.deepEqual(out.slice(0, 13), [
    ['SHADER', 'variableName'],
    [':', 'operator'],
    [':', 'operator'],
    ['#string,cr WGSL', 'directive'],
    ['@vertex', 'note'],
    ['fn', 'keyword'],
    ['vs', 'procedureName'],
    ['(', 'punctuation'],
    ['@builtin', 'note'],
    ['(', 'punctuation'],
    ['vertex_index', 'variableName'],
    [')', 'punctuation'],
    ['i', 'variableName'],
  ]);
  assert.equal(styleOf(shader, 'u32'), 'typeName');
  assert.equal(styleOf(shader, 'vec4f'), 'typeName');
  assert.equal(styleOf(shader, 'storage'), 'keyword');
  assert.equal(styleOf(shader, 'read_write'), 'keyword');
  // Inside the block comment the header line left open.
  assert.equal(
    styleOf(shader, 'return vec4f(1.0, 0.5h, 2u, 0x1F);'),
    'comment'
  );
  const numbers = tokens(
    'S :: #string WGSL\nf(1.0, 0.5h, 2u, 0x1F, .5, 1e3f);\nWGSL'
  );
  assert.deepEqual(
    numbers.filter(([, style]) => style === 'number').map(([text]) => text),
    ['1.0', '0.5h', '2u', '0x1F', '.5', '1e3f']
  );
});

test('the terminator ends the body even inside an open WGSL comment', () => {
  const out = tokens(shader);
  const at = out.findIndex(([text]) => text === 'WGSL');
  assert.deepEqual(out.slice(at), [
    ['WGSL', 'directive'],
    [';', 'punctuation'],
    ['after', 'variableName'],
    [':', 'operator'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation'],
  ]);
  // The rest of the header line and the unclosed comment's line.
  assert.equal(
    out.find(([text]) => text.includes('left open'))?.[1],
    'comment'
  );
});

test('a #string JAI body is tokenized as Jai, nested here-strings included', () => {
  const source = `PROGRAM :: #string jai
main :: () { s := #string END
not code
END; }
jai
x := 2;`;
  assert.deepEqual(tokens(source), [
    ['PROGRAM', 'variableName'],
    [':', 'operator'],
    [':', 'operator'],
    ['#string jai', 'directive'],
    ['main', 'procedureName'],
    [':', 'operator'],
    [':', 'operator'],
    ['(', 'punctuation'],
    [')', 'punctuation'],
    ['{', 'punctuation'],
    ['s', 'variableName'],
    [':', 'operator'],
    ['=', 'operator'],
    ['#string END', 'directive'],
    ['not code', 'string'],
    ['END', 'directive'],
    [';', 'punctuation'],
    ['}', 'punctuation'],
    ['jai', 'directive'],
    ['x', 'variableName'],
    [':', 'operator'],
    ['=', 'operator'],
    ['2', 'number'],
    [';', 'punctuation'],
  ]);
});

test('other terminators leave a plain string body', () => {
  assert.deepEqual(tokens('t := #string END\nfn f() {}\nEND;'), [
    ['t', 'variableName'],
    [':', 'operator'],
    ['=', 'operator'],
    ['#string END', 'directive'],
    ['fn f() {}', 'string'],
    ['END', 'directive'],
    [';', 'punctuation'],
  ]);
});
