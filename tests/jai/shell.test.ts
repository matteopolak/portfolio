import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceColumn,
  History,
  LineEditor,
  parseCommandLine,
  parseHistory,
  quoteArgument,
} from '../../src/lib/jai/shell.ts';

const words = (line: string) => {
  const parsed = parseCommandLine(line);
  assert(parsed.ok, `${line}: ${parsed.ok ? '' : parsed.error}`);
  return [parsed.name, ...parsed.args];
};

test('words split on blanks and the first is the command', () => {
  assert.deepEqual(words('run  a\tb  c'), ['run', 'a', 'b', 'c']);
  assert.deepEqual(words('  help '), ['help']);
});

test('quotes keep blanks and empty arguments survive', () => {
  assert.deepEqual(words(`run "two words" 'it''s' ""`), [
    'run',
    'two words',
    'its',
    '',
  ]);
  assert.deepEqual(words(`run a"b c"d`), ['run', 'ab cd']);
  assert.deepEqual(words(`run 'a "b" \\n'`), ['run', 'a "b" \\n']);
});

test('backslashes escape outside quotes and inside double quotes', () => {
  assert.deepEqual(words('run a\\ b'), ['run', 'a b']);
  assert.deepEqual(words('run "say \\"hi\\" \\\\ \\n"'), [
    'run',
    'say "hi" \\ \\n',
  ]);
});

test('unterminated quotes and blank lines are not commands', () => {
  assert.deepEqual(parseCommandLine('run "oops'), {
    ok: false,
    error: 'unterminated quote "',
  });
  assert.deepEqual(parseCommandLine("run 'oops"), {
    ok: false,
    error: "unterminated quote '",
  });
  assert.deepEqual(parseCommandLine('run oops\\'), {
    ok: false,
    error: 'trailing backslash',
  });
  assert.deepEqual(parseCommandLine('   '), { ok: false, error: '' });
});

test('quoteArgument round-trips through the parser', () => {
  for (const arg of [
    'plain',
    '',
    'two words',
    "it's",
    '"q"',
    'a\\b',
    '--stop=x',
  ])
    assert.deepEqual(words(`run ${quoteArgument(arg)}`), ['run', arg]);
  assert.equal(quoteArgument('--stop'), '--stop');
});

test('history walks back and forth and keeps the draft', () => {
  const history = new History(['one', 'two']);
  assert.equal(history.previous('draft'), 'two');
  assert.equal(history.previous('ignored'), 'one');
  assert.equal(history.previous('ignored'), undefined);
  assert.equal(history.next(), 'two');
  assert.equal(history.next(), 'draft');
  assert.equal(history.next(), undefined);
});

test('history skips blanks and repeats and is bounded', () => {
  const history = new History();
  history.add('run');
  history.add('run');
  history.add('  ');
  assert.deepEqual(history.entries, ['run']);
  for (let i = 0; i < 300; i++) history.add(`run ${i}`);
  assert.equal(history.entries.length, 200);
  assert.equal(history.entries.at(-1), 'run 299');
});

test('stored history tolerates garbage', () => {
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory('{'), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
  assert.deepEqual(parseHistory('["a",1,"b"]'), ['a', 'b']);
});

function editor(origin = 0, history?: History, columns = 80) {
  const written: string[] = [];
  const line = new LineEditor(
    { write: (text) => written.push(text), columns: () => columns },
    origin,
    history
  );
  return { line, written, out: () => written.join('') };
}

test('typing, cursor keys and backspace edit within the line', () => {
  const { line } = editor();
  line.input('helo');
  line.input('\x1b[D');
  line.input('l');
  assert.equal(line.text, 'hello');
  assert.equal(line.cursor, 4);
  line.input('\x7f');
  assert.equal(line.text, 'helo');
  line.input('\x1b[H');
  line.input('\x1b[3~');
  assert.equal(line.text, 'elo');
  assert.equal(line.cursor, 0);
  line.input('\x1b[F');
  assert.equal(line.cursor, 3);
});

test('Ctrl+A, E, K, U and W', () => {
  const { line } = editor();
  line.input('one two three');
  line.input('\x17');
  assert.equal(line.text, 'one two ');
  line.input('\x01');
  line.input('\x1b[C\x1b[C\x1b[C');
  line.input('\x0b');
  assert.equal(line.text, 'one');
  line.input('\x15');
  assert.equal(line.text, '');
});

test('backspace never goes past the start of the line', () => {
  const { line, written } = editor(6);
  line.input('\x7f\x7f');
  assert.equal(line.text, '');
  assert.deepEqual(written, []);
});

test('enter submits, with the rest of the pasted data left over', () => {
  const { line, out } = editor();
  const { result, rest } = line.input('abc\rdef');
  assert.deepEqual(result, { type: 'submit', line: 'abc' });
  assert.equal(rest, 'def');
  assert(out().endsWith('\r\n'));
});

test('Ctrl+C interrupts and Ctrl+D ends input, with or without text', () => {
  assert.deepEqual(editor().line.input('\x03').result, { type: 'interrupt' });
  assert.deepEqual(editor().line.input('\x04').result, {
    type: 'eof',
    line: '',
  });
  const typed = editor().line;
  typed.input('abc');
  assert.deepEqual(typed.input('\x04').result, { type: 'eof', line: 'abc' });
  assert.deepEqual(editor().line.input('\x0c').result, { type: 'clear' });
});

test('up and down recall history and restore the draft', () => {
  const { line } = editor(0, new History(['run a', 'run b']));
  line.input('dr');
  line.input('\x1b[A');
  assert.equal(line.text, 'run b');
  line.input('\x1b[A');
  assert.equal(line.text, 'run a');
  line.input('\x1b[B\x1b[B');
  assert.equal(line.text, 'dr');
});

test('a submitted line enters the history', () => {
  const history = new History();
  const { line } = editor(0, history);
  line.input('run x\r');
  assert.deepEqual(history.entries, ['run x']);
});

test('lines longer than the screen redraw across rows', () => {
  const { line, out } = editor(5, undefined, 10);
  line.input('abcdefgh');
  // The cursor is on the second row now: a redraw starts by going back up.
  line.input('\x1b[D');
  assert(!out().includes('\x1b[1A'));
  line.input('X');
  assert.equal(line.text, 'abcdefgXh');
  assert(out().includes('\x1b[1A'), JSON.stringify(out()));
  // Moving back to the first row goes up, and the column is right.
  line.input('\x1b[H');
  assert(out().endsWith('\x1b[1A\r\x1b[5C'), JSON.stringify(out()));
});

test('advanceColumn follows what the screen would do', () => {
  assert.equal(advanceColumn(0, 'abc', 80), 3);
  assert.equal(advanceColumn(3, 'ab\n', 80), 0);
  assert.equal(advanceColumn(0, 'Name: ', 80), 6);
  assert.equal(advanceColumn(0, '\x1b[31mred\x1b[0m', 80), 3);
  assert.equal(advanceColumn(0, 'abcdefghij', 10), 10);
  assert.equal(advanceColumn(0, 'abcdefghijk', 10), 1);
  assert.equal(advanceColumn(4, '\b\b', 80), 2);
  assert.equal(advanceColumn(2, '\t', 80), 8);
  assert.equal(advanceColumn(0, 'abc\rxy', 80), 2);
  assert.equal(advanceColumn(2, '\r\x1b[5C', 80), 5);
});
