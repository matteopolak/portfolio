import test from 'node:test';
import assert from 'node:assert/strict';
import { StringStream } from '@codemirror/language';
import {
  describeFormatEntry,
  formatStringAt,
  formatSpecs,
  trailingArguments,
} from '../../src/lib/jai/format-string.ts';
import { jaiTokenizer } from '../../src/lib/jai/language.ts';

/** Runs the tokenizer and returns `[text, style]` pairs, without whitespace. */
function tokens(source: string) {
  const state = jaiTokenizer.startState!(4);
  const out: [string, string | null][] = [];
  for (const line of source.split('\n')) {
    const stream = new StringStream(line, 4, 4);
    while (!stream.eol()) {
      const style = jaiTokenizer.token(stream, state);
      const text = stream.current();
      if (text.trim()) out.push([text, style]);
      stream.start = stream.pos;
    }
  }
  return out;
}
const specifiers = (source: string) =>
  tokens(source)
    .filter(([, style]) => style === 'formatSpecifier' || style === 'formatPercent')
    .map(([text, style]) => `${text}:${style}`);

test('print-family format strings split out their specifiers', () => {
  assert.deepEqual(tokens('print("a % b \\% %%\\n", x);').slice(0, 8), [
    ['print', 'variableName'],
    ['(', 'punctuation'],
    ['"a ', 'formatString'],
    ['%', 'formatSpecifier'],
    [' b ', 'formatString'],
    ['\\%', 'formatPercent'],
    ['%', 'formatSpecifier'],
    ['%', 'formatSpecifier'],
  ]);
  assert.deepEqual(specifiers('s := tprint("%1-%2 %0%00", a, b);'), [
    '%1:formatSpecifier',
    '%2:formatSpecifier',
    '%0:formatSpecifier',
    '%00:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('log_error("bad %", x);'), [
    '%:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('print("\\%%");'), [
    '\\%:formatPercent',
    '%:formatSpecifier',
  ]);
});

test('only the format argument is a format string', () => {
  assert.deepEqual(
    tokens('print("%", "100%");').map(([, style]) => style),
    [
      'variableName',
      'punctuation',
      'formatString',
      'formatSpecifier',
      'formatString',
      'punctuation',
      'string',
      'punctuation',
      'punctuation',
    ],
    'the whole literal, quotes included, is marked for the hover'
  );
  assert.deepEqual(specifiers('print("%", "100%");'), ['%:formatSpecifier']);
  assert.deepEqual(specifiers('assert(x > 0, "x is %", x);'), [
    '%:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('assert(f("50%"), "%");'), [
    '%:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('print_to_builder(*b, "% items", n);'), [
    '%:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('print_to_builder("%", n);'), []);
});

test('other strings and print without a call are left alone', () => {
  assert.deepEqual(specifiers('s := "100%";'), []);
  assert.deepEqual(specifiers('write_string("50%");'), []);
  assert.deepEqual(specifiers('p := print; x := ("%");'), []);
  assert.deepEqual(
    tokens('print :: (format: string) {}')[0],
    ['print', 'procedureName'],
    'declarations keep their own colour'
  );
});

test('nested calls and comments between name and bracket', () => {
  assert.deepEqual(specifiers('print("%\\n", tprint("%", 1));'), [
    '%:formatSpecifier',
    '%:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('print /* why */ ("%", 1);'), [
    '%:formatSpecifier',
  ]);
  assert.deepEqual(specifiers('print(\n  "%",\n  1\n);\nx := "%";'), [
    '%:formatSpecifier',
  ]);
  // An unclosed call does not leak into the next statement block.
  assert.deepEqual(specifiers('f :: () { print( }\ng :: () { "%"; }'), []);
});

test('formatSpecs follows the compiler print rules', () => {
  const argumentsOf = (body: string) =>
    formatSpecs(body).map((spec) =>
      spec.kind === 'argument' ? spec.argument : spec.kind
    );
  // `%N` resets the order: a following `%` continues after N.
  assert.deepEqual(argumentsOf('% %3 % %1 %'), [0, 2, 3, 0, 1]);
  // `%%` is two arguments; `\%` is a literal; `%00` prints nothing.
  assert.deepEqual(argumentsOf('%% \\% %00 %0'), [0, 1, 'percent', 'empty', 2]);
  assert.deepEqual(formatSpecs('%12x"; %'), [
    { from: 0, to: 3, kind: 'argument', argument: 11 },
  ]);
  assert.deepEqual(formatSpecs('\\"%'), [
    { from: 2, to: 3, kind: 'argument', argument: 0 },
  ]);
});

test('trailingArguments splits at top-level commas', () => {
  assert.deepEqual(
    trailingArguments(', a, f(b, c), "x,)", arr[1]) + 2;'),
    ['a', 'f(b, c)', '"x,)"', 'arr[1]']
  );
  assert.deepEqual(trailingArguments(');'), []);
  assert.deepEqual(trailingArguments(',\n  a, // first\n  b\n);'), [
    'a',
    'b',
  ]);
});

test('formatStringAt lists what each specifier formats', () => {
  const text =
    'main :: () {\n  print("% has %2 \\% %00 %", player.name, hp(3));\n}';
  const literal = '"% has %2 \\% %00 %"';
  // Anywhere on the literal, quotes included, finds the whole string.
  for (const offset of [
    text.indexOf(literal),
    text.indexOf('has'),
    text.indexOf(literal) + literal.length - 1,
  ]) {
    const info = formatStringAt(text, offset)!;
    assert.equal(info.literal, literal);
    assert.equal(text.slice(info.from, info.to), literal);
  }
  const info = formatStringAt(text, text.indexOf('has'))!;
  assert.deepEqual(info.entries.map(describeFormatEntry), [
    '% → player.name',
    '%2 → hp(3)',
    '\\% → a literal %',
    '%00 → nothing',
    '% → argument 3, not passed',
  ]);
  assert.equal(formatStringAt(text, text.indexOf('player')), null);
  assert.equal(formatStringAt('x := 1; // "%"', 13), null);
});

test('ranges and leading-dot floats lex like jaic', () => {
  assert.deepEqual(tokens('for 1..12 {}').slice(1, 4), [
    ['1', 'number'],
    ['..', 'operator'],
    ['12', 'number'],
  ]);
  assert.ok(tokens('x := .5;').some(([t, s]) => t === '.5' && s === 'number'));
  assert.deepEqual(tokens('a.5').map(([t]) => t), ['a', '.', '5']);
  assert.deepEqual(tokens('1.5..2')[0], ['1.5', 'number']);
});
