import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeJaiPlayground } from '../../src/lib/jai-playground.ts';

const revision = 'a'.repeat(40);
function harness(enabled = true) {
  const controller = new AbortController();
  const retry = new EventTarget();
  const label = { textContent: '' };
  const status = { hidden: false, querySelector: () => label };
  const frames = [];
  const container = { replaceChildren: (frame) => frames.push(frame) };
  const panel = Object.assign(new EventTarget(), {
    dataset: { jaiEnabled: String(enabled), jaiRevision: revision },
    matches: () => true,
    querySelector: (selector) => ({ '[data-jai-frame]': container, '[data-jai-status]': status, '[data-jai-retry]': retry })[selector],
  });
  globalThis.window = new EventTarget();
  globalThis.location = { origin: 'https://portfolio.test' };
  globalThis.document = { createElement: () => ({ contentWindow: {}, setAttribute() {}, focus() {}, remove() { this.removed = true; } }) };
  const host = initializeJaiPlayground(panel, controller.signal);
  function message(overrides = {}) {
    const event = new Event('message');
    Object.assign(event, { origin: location.origin, source: frames.at(-1)?.contentWindow,
      data: { type: 'jai-playground', revision, state: 'ready' }, ...overrides });
    window.dispatchEvent(event);
  }
  return { host, controller, frames, status, label, message };
}

test('unpublished compiler never mounts an iframe', async () => {
  const game = harness(false);
  await assert.rejects(game.host.prepare(), /first verified release/);
  assert.equal(game.frames.length, 0);
  game.controller.abort();
});

test('readiness requires the exact origin, frame and pinned revision', async () => {
  const game = harness();
  const pending = game.host.prepare();
  assert.equal(game.frames[0].src, `/jai/${revision}/index.html?embed=1`);
  game.message({ origin: 'https://other.test' });
  game.message({ source: {} });
  game.message({ data: { type: 'jai-playground', state: 'ready', revision: 'b'.repeat(40) } });
  assert.equal(game.host.isReady(), false);
  assert.equal(game.status.hidden, false);
  game.message();
  await pending;
  assert.equal(game.host.isReady(), true);
  assert.equal(game.status.hidden, true);
  game.controller.abort();
  assert.equal(game.frames[0].removed, true);
});

test('closing before initialization cancels the waiter and reopening mounts a fresh frame', async () => {
  const game = harness();
  const first = game.host.prepare();
  const rejection = assert.rejects(first, { name: 'AbortError' });
  game.host.destroy();
  await rejection;
  assert.equal(game.frames[0].removed, true);
  const second = game.host.prepare();
  assert.equal(game.frames.length, 2);
  game.message({ source: game.frames[0].contentWindow });
  assert.equal(game.host.isReady(), false);
  game.message();
  await second;
  game.controller.abort();
});

test('a producer initialization error removes the failed frame and permits retry', async () => {
  const game = harness();
  const first = game.host.prepare();
  const rejection = assert.rejects(first, /Compiler unavailable/);
  game.message({ data: { type: 'jai-playground', revision, state: 'error', message: 'Compiler unavailable' } });
  await rejection;
  assert.equal(game.frames[0].removed, true);
  assert.equal(game.label.textContent, 'Compiler unavailable');
  const second = game.host.prepare();
  game.message();
  await second;
  game.controller.abort();
});
