import test from 'node:test';
import assert from 'node:assert/strict';
import { StdinChannel } from '../../src/lib/jai/stdin-channel.ts';

const text = new TextDecoder();

function channel() {
  let requests = 0;
  const stdin = new StdinChannel({ request: () => requests++ });
  return { stdin, requests: () => requests };
}

test('a read waits for the terminal and asks for a line once', async () => {
  const { stdin, requests } = channel();
  const read = stdin.read(4096);
  assert(read instanceof Promise);
  assert.equal(requests(), 1);
  assert(stdin.waiting);
  stdin.push('Ada\n');
  assert.equal(text.decode(await read), 'Ada\n');
  assert(!stdin.waiting);
});

test('input that is already buffered is read without asking', () => {
  const { stdin, requests } = channel();
  stdin.push('one\ntwo\n');
  const first = stdin.read(4);
  assert(first instanceof Uint8Array);
  assert.equal(text.decode(first), 'one\n');
  assert.equal(text.decode(stdin.read(4096) as Uint8Array), 'two\n');
  assert.equal(requests(), 0);
});

test('a line longer than the buffer comes in pieces', async () => {
  const { stdin } = channel();
  const read = stdin.read(3);
  stdin.push('abcdefg\n');
  assert.equal(text.decode(await read), 'abc');
  assert.equal(text.decode(stdin.read(3) as Uint8Array), 'def');
  assert.equal(text.decode(stdin.read(3) as Uint8Array), 'g\n');
});

test('the end of input is an empty read, once', async () => {
  const { stdin, requests } = channel();
  const read = stdin.read(16);
  stdin.push(null);
  assert.equal((await read).length, 0);
  // Like a terminal after Ctrl+D: the next read waits again.
  const next = stdin.read(16);
  assert(next instanceof Promise);
  assert.equal(requests(), 2);
});

test('multibyte text is encoded as UTF-8', async () => {
  const { stdin } = channel();
  const read = stdin.read(64);
  stdin.push('héllo\n');
  assert.deepEqual([...(await read)].slice(0, 3), [0x68, 0xc3, 0xa9]);
});

test('resetting abandons a pending read and drops buffered input', async () => {
  const { stdin } = channel();
  const read = stdin.read(16);
  stdin.reset();
  assert.equal((await read).length, 0);
  assert(!stdin.waiting);
  stdin.push('stale\n');
  stdin.reset();
  assert(stdin.read(16) instanceof Promise);
});
