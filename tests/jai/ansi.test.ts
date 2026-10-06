import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAnsi, parseAnsi } from '../../src/lib/ansi.ts';

test('splits text at SGR codes into styled runs', () => {
  const text = '\x1b[1;31merror\x1b[0m\x1b[1m: bad\x1b[0m\n \x1b[34m│\x1b[0m x';
  assert.deepEqual(parseAnsi(text), [
    { text: 'error', style: { bold: true, fg: 'red' } },
    { text: ': bad', style: { bold: true } },
    { text: '\n ', style: {} },
    { text: '│', style: { fg: 'blue' } },
    { text: ' x', style: {} },
  ]);
});

test('reads bright, 256 and true colours, and partial resets', () => {
  assert.deepEqual(
    parseAnsi('\x1b[92ma\x1b[38;5;196mb\x1b[38;2;1;2;3mc\x1b[39md'),
    [
      { text: 'a', style: { fg: 'bright-green' } },
      { text: 'b', style: { fg: 'rgb(255 0 0)' } },
      { text: 'c', style: { fg: 'rgb(1 2 3)' } },
      { text: 'd', style: {} },
    ]
  );
  assert.deepEqual(parseAnsi('\x1b[1;2mx\x1b[22my'), [
    { text: 'x', style: { bold: true, dim: true } },
    { text: 'y', style: {} },
  ]);
});

test('drops other escape sequences and treats ESC[m as a reset', () => {
  assert.deepEqual(parseAnsi('\x1b[2K\x1b[31mx\x1b[my\x1b]0;title\x07z'), [
    { text: 'x', style: { fg: 'red' } },
    { text: 'yz', style: {} },
  ]);
  assert.equal(hasAnsi('plain'), false);
  assert.equal(hasAnsi('\x1b[0m'), true);
});
