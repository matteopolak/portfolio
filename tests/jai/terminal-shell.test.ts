import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceColumn } from '../../src/lib/jai/shell.ts';
import { Shell } from '../../src/lib/jai/terminal-shell.ts';

const strip = (text: string) =>
  // eslint-disable-next-line no-control-regex
  text.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g'),
    ''
  );

function setup(options: ConstructorParameters<typeof Shell>[2] = {}) {
  const writes: string[] = [];
  let column = 0;
  let clears = 0;
  const calls: unknown[][] = [];
  const shell = new Shell(
    {
      write(text) {
        writes.push(text);
        column = advanceColumn(column, text, 80);
      },
      clear() {
        clears++;
        column = 0;
        writes.length = 0;
      },
      column: () => column,
      columns: () => 80,
    },
    {
      run: (args) => calls.push(['run', args]),
      interrupt: () => calls.push(['interrupt']),
      input: (text) => calls.push(['input', text]),
    },
    options
  );
  return {
    shell,
    calls,
    clears: () => clears,
    screen: () => strip(writes.join('')),
  };
}

const memory = (initial?: string) => {
  const items = new Map<string, string>();
  if (initial) items.set('history', initial);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

test('the prompt reads a run command with shell-like quoting', () => {
  const { shell, calls } = setup();
  shell.prompt();
  shell.data(`run --name "Ada Lovelace" 'x y' z\\ w\r`);
  assert.deepEqual(calls, [['run', ['--name', 'Ada Lovelace', 'x y', 'z w']]]);
  assert.deepEqual(shell.lastArgs, ['--name', 'Ada Lovelace', 'x y', 'z w']);
  assert.equal(shell.mode, 'running');
});

test('a typed run keeps the screen; Run and edits clear it and name the command', () => {
  const { shell, clears, screen } = setup();
  shell.prompt();
  shell.data('run a\r');
  shell.beginRun(shell.lastArgs);
  assert.equal(clears(), 0);
  assert(screen().includes('run a'));
  shell.output('stdout', 'hi\n');
  shell.finish(0);
  // The Run button or an edit: the same arguments again, on a fresh screen.
  shell.beginRun(shell.lastArgs);
  assert.equal(clears(), 1);
  assert.equal(screen(), 'jai$ run a\r\n');
});

test('help, clear, unknown commands and parse errors return to the prompt', () => {
  const { shell, calls, clears, screen } = setup();
  shell.prompt();
  shell.data('help\r');
  assert(screen().includes('run [args...]'));
  shell.data('frobnicate\r');
  assert(screen().includes('jai: command not found: frobnicate'));
  shell.data('run "oops\r');
  assert(screen().includes('unterminated quote'));
  shell.data('clear\r');
  assert.equal(clears(), 1);
  assert.equal(screen(), 'jai$ ');
  shell.data('\r');
  assert.deepEqual(calls, []);
  assert.equal(shell.mode, 'prompt');
});

test('history is recalled with the arrows and saved per workspace', () => {
  const storage = memory();
  const first = setup({ storage, key: 'history' });
  first.shell.prompt();
  first.shell.data('run one\r');
  first.shell.finish(0);
  first.shell.data('run two\r');
  assert.deepEqual(JSON.parse(storage.items.get('history')!), [
    'run one',
    'run two',
  ]);
  const second = setup({ storage, key: 'history' });
  second.shell.prompt();
  second.shell.data('\x1b[A\x1b[A\r');
  assert.deepEqual(second.calls, [['run', ['one']]]);
});

test('broken storage does not break the shell', () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  const { shell, calls } = setup({ storage });
  shell.prompt();
  shell.data('run x\r');
  assert.deepEqual(calls, [['run', ['x']]]);
});

test('a program reads lines from the terminal, with local echo and editing', () => {
  const { shell, calls, screen } = setup();
  shell.beginRun([]);
  shell.output('stdout', 'Name: ');
  shell.requestInput();
  assert.equal(shell.mode, 'stdin');
  shell.data('Adq');
  shell.data('\x7f');
  shell.data('a\r');
  assert.deepEqual(calls, [['input', 'Ada\n']]);
  assert(screen().startsWith('jai$ run\r\nName: '));
  assert(screen().includes('Ada'));
  assert.equal(shell.mode, 'running');
  // Keys typed before the program asks again wait for it.
  shell.data('Grax\x7fce\r');
  assert.equal(calls.length, 1);
  shell.requestInput();
  assert.deepEqual(calls.at(-1), ['input', 'Grace\n']);
  assert.equal(shell.mode, 'running');
});

test('keys typed ahead are dropped when the run is killed', () => {
  const { shell, calls } = setup();
  shell.beginRun([]);
  shell.data('early\r');
  shell.stopped('edit');
  shell.beginRun([]);
  shell.requestInput();
  assert.deepEqual(calls, []);
  assert.equal(shell.mode, 'stdin');
});

test('backspace stops at the start of the input, after the program prompt', () => {
  const { shell, calls } = setup();
  shell.beginRun([]);
  shell.output('stdout', 'Name: ');
  shell.requestInput();
  shell.data('\x7f\x7f\x7f');
  shell.data('x\r');
  assert.deepEqual(calls, [['input', 'x\n']]);
});

test('Ctrl+D sends the end of input, or the text typed so far', () => {
  const { shell, calls } = setup();
  shell.beginRun([]);
  shell.requestInput();
  shell.data('\x04');
  shell.requestInput();
  shell.data('par\x04');
  assert.deepEqual(calls, [
    ['input', null],
    ['input', 'par'],
  ]);
});

test('Ctrl+C stops a running program and one waiting for input', () => {
  const { shell, calls } = setup();
  shell.beginRun([]);
  shell.data('\x03');
  shell.requestInput();
  shell.data('abc\x03');
  assert.deepEqual(calls, [['interrupt'], ['interrupt']]);
});

test('Ctrl+C at the prompt abandons the line', () => {
  const { shell, calls, screen } = setup();
  shell.prompt();
  shell.data('run x\x03');
  assert(screen().endsWith('^C\r\njai$ '));
  assert.deepEqual(calls, []);
  assert.equal(shell.mode, 'prompt');
});

test('an edit kills the run and the re-run uses the last arguments', () => {
  const { shell, calls, clears, screen } = setup();
  shell.prompt();
  shell.data('run --stop meta\r');
  shell.beginRun(shell.lastArgs);
  shell.requestInput();
  shell.data('half');
  // Edit: the pending read is abandoned and nothing is said before the next run.
  shell.abandonInput();
  shell.stopped('edit');
  assert.equal(shell.mode, 'running');
  shell.data('late\r');
  assert.deepEqual(calls, [['run', ['--stop', 'meta']]]);
  // The re-run starts from a clean screen with the same command.
  shell.beginRun(shell.lastArgs);
  assert.equal(clears(), 1);
  assert.equal(screen(), 'jai$ run --stop meta\r\n');
  shell.requestInput();
  shell.data('again\r');
  assert.deepEqual(calls.at(-1), ['input', 'again\n']);
});

test('stopping by hand ends on a prompt', () => {
  const { shell, screen } = setup();
  shell.beginRun([]);
  shell.output('stdout', 'working');
  shell.stopped('stop');
  assert(screen().includes('working\r\n[stopped]\r\njai$ '));
  assert.equal(shell.mode, 'prompt');
});

test('a non-zero exit is noted and the prompt returns on its own line', () => {
  const { shell, screen } = setup();
  shell.beginRun([]);
  shell.output('stdout', 'no newline');
  shell.finish(3);
  assert.equal(
    screen(),
    'jai$ run\r\nno newline\r\n[exited with code 3]\r\njai$ '
  );
  shell.beginRun([]);
  shell.finish(0);
  assert.equal(screen(), 'jai$ run\r\njai$ ');
  shell.beginRun([]);
  shell.finish(null);
  assert.equal(screen(), 'jai$ run\r\njai$ ');
});

test('standard error is drawn in red', () => {
  const writes: string[] = [];
  const shell = new Shell(
    {
      write: (text) => void writes.push(text),
      clear() {},
      column: () => 0,
      columns: () => 80,
    },
    { run() {}, interrupt() {}, input() {} }
  );
  shell.output('stderr', 'bad\n');
  assert.equal(writes[0], '\x1b[31mbad\n\x1b[39m');
});
