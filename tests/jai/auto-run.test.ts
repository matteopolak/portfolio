// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-nocheck -- hand-rolled DOM and client mocks; the code under test is typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoRunner } from '../../src/lib/code-auto-run.ts';
function harness() {
  let calls = 0,
    cancellations = 0,
    next = 0;
  const timers = new Map();
  const runner = createAutoRunner(
    () => calls++,
    () => cancellations++,
    {
      schedule: (callback, delay) => {
        assert.equal(delay, 600);
        timers.set(++next, callback);
        return next;
      },
      clear: (id) => timers.delete(id),
    }
  );
  return {
    runner,
    timers,
    calls: () => calls,
    cancellations: () => cancellations,
    fire: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
test('typing resets the delay and cancels stale execution', () => {
  const h = harness();
  h.runner.changed();
  h.runner.changed();
  assert.equal(h.timers.size, 1);
  assert.equal(h.calls(), 0);
  assert.equal(h.cancellations(), 2);
  h.fire();
  assert.equal(h.calls(), 1);
});
test('play bypasses the pending delay without running twice', () => {
  const h = harness();
  h.runner.changed();
  h.runner.play();
  h.fire();
  assert.equal(h.calls(), 1);
  assert.equal(h.timers.size, 0);
});
test('cancel and close suppress pending auto-runs', () => {
  const h = harness();
  h.runner.changed();
  h.runner.pause();
  h.fire();
  assert.equal(h.calls(), 0);
  h.runner.changed();
  h.runner.destroy();
  h.runner.changed();
  h.runner.play();
  h.fire();
  assert.equal(h.calls(), 0);
});
test('IME composition defers execution until composition ends', () => {
  const h = harness();
  h.runner.compositionStart();
  h.runner.changed();
  h.fire();
  assert.equal(h.calls(), 0);
  h.runner.compositionEnd();
  h.fire();
  assert.equal(h.calls(), 1);
});
