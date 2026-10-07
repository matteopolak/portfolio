import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  jaiKeyCode,
  jaiModifiers,
  jaiMouseButton,
  jaiWheelDelta,
  KEY,
  keepsBrowserDefault,
  typedText,
} from '../../src/lib/jai/canvas-input.ts';
import { importsWebGPU, renderSupport } from '../../src/lib/jai/render-pane.ts';

const key = (key: string, code = '') => jaiKeyCode({ key, code });

test('Key_Code values match stdlib/Input', async (t) => {
  // The enum itself, when a Jai checkout is at hand (JAI_REPO).
  const repo = process.env.JAI_REPO;
  if (!repo) return t.skip('JAI_REPO is not set');
  const source = await readFile(`${repo}/stdlib/Input/module.jai`, 'utf8');
  const body = /Key_Code :: enum \{([\s\S]*?)\n\}/u.exec(source)?.[1];
  assert.ok(body, 'Key_Code enum not found');
  const values = new Map<string, number>();
  let next = 0;
  for (const line of body.split('\n')) {
    const match = /^\s*(\w+)(?:\s*::\s*(\w+))?;/u.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    const number =
      value === undefined
        ? next
        : /^\d+$/u.test(value)
          ? Number(value)
          : values.get(value)!;
    values.set(name, number);
    next = number + 1;
  }
  for (const [name, value] of Object.entries(KEY))
    assert.equal(values.get(name), value, name);
  assert.equal(values.get('F24'), KEY.F1 + 23);
});

test('named keys', () => {
  assert.equal(key('Escape'), KEY.ESCAPE);
  assert.equal(key('ArrowUp'), 2);
  assert.equal(key('ArrowDown'), 3);
  assert.equal(key('ArrowLeft'), 4);
  assert.equal(key('ArrowRight'), 5);
  assert.equal(key('Backspace'), 8);
  assert.equal(key('Tab'), 9);
  assert.equal(key('Enter'), 13);
  assert.equal(key(' ', 'Space'), 32);
  assert.equal(key('Delete'), 127);
  assert.equal(key('PageUp'), 132);
  assert.equal(key('End'), 135);
  assert.equal(key('Insert'), 136);
  assert.equal(key('Alt'), 139);
  assert.equal(key('Control'), 140);
  assert.equal(key('Shift'), 141);
  assert.equal(key('Meta'), 142);
  assert.equal(key('PrintScreen'), 167);
});

test('function keys follow CMD', () => {
  assert.equal(key('F1'), 143);
  assert.equal(key('F12'), 154);
  assert.equal(key('F24'), 166);
  assert.equal(key('F25'), KEY.UNKNOWN);
});

test('printable keys are their character, letters upper-case', () => {
  assert.equal(key('a', 'KeyA'), 65);
  assert.equal(key('A', 'KeyA'), 65);
  assert.equal(key('7', 'Digit7'), 55);
  assert.equal(key('/', 'Slash'), 47);
  assert.equal(key('!', 'Digit1'), 33);
  // Composed with Alt (macOS): the physical key instead.
  assert.equal(key('å', 'KeyA'), 65);
  assert.equal(key('¡', 'Digit1'), 49);
  assert.equal(key('3', 'Numpad3'), 51);
  assert.equal(key('Dead', 'Quote'), KEY.UNKNOWN);
  assert.equal(key('AudioVolumeUp'), KEY.UNKNOWN);
});

test('mouse buttons, modifiers and wheel', () => {
  assert.equal(jaiMouseButton(0), KEY.MOUSE_BUTTON_LEFT);
  assert.equal(jaiMouseButton(1), 169);
  assert.equal(jaiMouseButton(2), 170);
  assert.equal(jaiMouseButton(3), undefined);
  const modifiers = (
    shiftKey = false,
    ctrlKey = false,
    altKey = false,
    metaKey = false
  ) => jaiModifiers({ shiftKey, ctrlKey, altKey, metaKey });
  assert.equal(modifiers(true), 1);
  assert.equal(modifiers(false, true), 2);
  assert.equal(modifiers(false, false, true), 4);
  assert.equal(modifiers(false, false, false, true), 8);
  assert.equal(modifiers(true, true, true, true), 15);
  // One notch up is +WHEEL_DELTA (120), as on Windows.
  assert.equal(jaiWheelDelta({ deltaY: -100, deltaMode: 0 }), 120);
  assert.equal(jaiWheelDelta({ deltaY: 3, deltaMode: 1 }), -120);
  assert.equal(jaiWheelDelta({ deltaY: 0, deltaMode: 0 }), 0);
});

test('browser shortcuts keep their default; program keys do not', () => {
  const keeps = (key: string, ctrlKey = false, metaKey = false) =>
    keepsBrowserDefault({ key, ctrlKey, metaKey });
  assert.equal(keeps('ArrowDown'), false);
  assert.equal(keeps(' '), false);
  assert.equal(keeps('w'), false);
  assert.equal(keeps('r', false, true), true);
  assert.equal(keeps('Enter', true), true);
  assert.equal(keeps('Tab'), true);
  assert.equal(keeps('F5'), true);
});

test('typed text', () => {
  const typed = (key: string, ctrlKey = false, metaKey = false) =>
    typedText({ key, ctrlKey, metaKey });
  assert.equal(typed('a'), 97);
  assert.equal(typed(' '), 32);
  assert.equal(typed('é'), 0xe9);
  assert.equal(typed('😀'), 0x1f600);
  assert.equal(typed('Enter'), undefined);
  assert.equal(typed('c', true), undefined);
});

test('render support and WebGPU imports', () => {
  const canvas = { prototype: { transferControlToOffscreen() {} } };
  const jspi = { Suspending() {}, promising() {} };
  assert.deepEqual(
    renderSupport({
      navigator: { gpu: {} },
      WebAssembly: jspi,
      HTMLCanvasElement: canvas,
    }),
    { ok: true }
  );
  const noGpu = renderSupport({
    navigator: {},
    WebAssembly: jspi,
    HTMLCanvasElement: canvas,
  });
  assert.ok(!noGpu.ok && /no WebGPU/u.test(noGpu.title));
  const noJspi = renderSupport({
    navigator: { gpu: {} },
    WebAssembly: {},
    HTMLCanvasElement: canvas,
  });
  assert.ok(!noJspi.ok && /Promise Integration/u.test(noJspi.title));
  assert.ok(importsWebGPU(['#import "Basic";\n#import "WebGPU";\n']));
  assert.ok(importsWebGPU(['#import "Extensions/WebGPU";']));
  assert.ok(!importsWebGPU(['// #import "WebGPU";\n', '#import "Basic";']));
});
