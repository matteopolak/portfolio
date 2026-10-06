import test from 'node:test';
import assert from 'node:assert/strict';
import {
  navigationButton,
  navigationKey,
} from '../../src/lib/jai/nav-input.ts';

const key = (code: string, key: string, modifiers: string[] = []) => ({
  code,
  key,
  ctrlKey: modifiers.includes('ctrl'),
  shiftKey: modifiers.includes('shift'),
  altKey: modifiers.includes('alt'),
  metaKey: modifiers.includes('meta'),
});

test('Ctrl+- goes back and Ctrl+Shift+- forward on every platform', () => {
  for (const apple of [true, false]) {
    assert.equal(navigationKey(key('Minus', '-', ['ctrl']), apple), 'back');
    assert.equal(
      navigationKey(key('Minus', '_', ['ctrl', 'shift']), apple),
      'forward'
    );
    assert.equal(navigationKey(key('Minus', '-', ['meta']), apple), undefined);
    assert.equal(navigationKey(key('Minus', '-'), apple), undefined);
  }
});

test('Alt+Left/Right navigate except on Apple platforms', () => {
  const left = key('ArrowLeft', 'ArrowLeft', ['alt']);
  const right = key('ArrowRight', 'ArrowRight', ['alt']);
  assert.equal(navigationKey(left, false), 'back');
  assert.equal(navigationKey(right, false), 'forward');
  // macOS: Alt+Left moves by word in the editor.
  assert.equal(navigationKey(left, true), undefined);
  // Shift+Alt+Left still selects.
  assert.equal(
    navigationKey(key('ArrowLeft', 'ArrowLeft', ['alt', 'shift']), false),
    undefined
  );
});

test('side mouse buttons map to back and forward', () => {
  assert.equal(navigationButton(3), 'back');
  assert.equal(navigationButton(4), 'forward');
  assert.equal(navigationButton(0), undefined);
  assert.equal(navigationButton(1), undefined);
});
