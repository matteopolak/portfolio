import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../src/lib/lodestone-game.ts', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('  #handleProgress('), source.indexOf('  #revealCanvas('))
  .replace('event: LodestoneProgressEvent', 'event')
  .replace('new CustomEvent<LodestoneProgressEvent>', 'new CustomEvent')
  .replaceAll('querySelector<HTMLElement>', 'querySelector');

// Run the real progress handler with observable DOM/worker boundaries.
function harness() {
  return runInNewContext(`new (class {
    #workerReady = false;
    #firstFrameReady = false;
    #readyAssets = new Set();
    events = [];
    aggregate = [];
    reveals = 0;
    errors = [];
    shadowRoot = { querySelector: () => undefined };
    dispatchEvent(event) { this.events.push(event); }
    #setProgress(...args) { this.aggregate.push(args); }
    #currentAssetProgress() { return 0.12; }
    #revealCanvas() { this.reveals += 1; }
    #reportError(message) { this.errors.push(message); }
    workerReady(value) { this.#workerReady = value; }
    firstFrameReady() { return this.#firstFrameReady; }
    progress(event) { this.#handleProgress(event); }
    ${handler}
  })()`, {
    CustomEvent: class {
      type: string;
      constructor(type: string, options?: object) { this.type = type; Object.assign(this, options); }
    },
  });
}

for (const phase of ['full-view-presented', 'full-view-quiescent']) {
  test(`${phase}: forwards independent queue counts without revealing the canvas`, () => {
    const game = harness();
    game.workerReady(true);
    const payload = {
      type: phase, phase, fraction: 1, message: 'view progress', elapsedMs: 25000,
      loadedColumns: 289, expectedColumns: 289,
      settledColumns: phase === 'full-view-presented' ? 282 : 289,
      presentedColumns: 289, pendingColumns: phase === 'full-view-presented' ? 7 : 0,
      pendingRemovals: phase === 'full-view-presented' ? 2 : 0,
      pendingMeshes: 0, pendingLightRemeshes: phase === 'full-view-presented' ? 7 : 0,
    };
    game.progress(payload);
    const event = game.events[0];
    assert.equal(event.type, 'lodestone-progress');
    assert.equal(JSON.stringify(event.detail), JSON.stringify(payload));
    assert.notEqual(event.detail, payload);
    assert.equal(event.bubbles, true);
    assert.equal(event.composed, true);
    assert.equal(game.firstFrameReady(), false);
    assert.equal(game.reveals, 0);
    assert.equal(game.aggregate.length, 0);
    assert.equal(game.errors.length, 0);
  });
}

test('first-frame reveals a worker-ready canvas while light remesh work remains', () => {
  const game = harness();
  game.workerReady(true);
  game.progress({ type: 'first-frame', fraction: 1, message: 'frame', pendingMeshes: 0, pendingLightRemeshes: 12 });
  assert.equal(game.firstFrameReady(), true);
  assert.equal(game.reveals, 1);
  assert.equal(game.aggregate[0][0], 1);
});

test('first-frame still waits for the worker-ready handshake', () => {
  const game = harness();
  game.progress({ phase: 'first-frame', fraction: 1, message: 'frame' });
  assert.equal(game.firstFrameReady(), true);
  assert.equal(game.reveals, 0);
  assert.equal(game.aggregate[0][0], 0.98);
});

test('later quiescent milestones do not reset an interactive loader', () => {
  const game = harness();
  game.workerReady(true);
  game.progress({ type: 'first-frame', fraction: 1, message: 'frame' });
  game.progress({ phase: 'full-view-quiescent', fraction: 1, message: 'settled', pendingMeshes: 0, pendingLightRemeshes: 0 });
  assert.equal(game.firstFrameReady(), true);
  assert.equal(game.reveals, 1);
  assert.equal(game.aggregate.length, 1);
});

test('older SDK progress payloads remain observable without new counters', () => {
  const game = harness();
  game.progress({ type: 'started', fraction: 0.9, message: 'started' });
  assert.equal(game.events[0].detail.pendingLightRemeshes, undefined);
  assert.equal(game.aggregate[0][0], 0.9);
  assert.equal(game.reveals, 0);
});
