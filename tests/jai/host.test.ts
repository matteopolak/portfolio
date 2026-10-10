import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeJaiPlayground } from '../../src/lib/jai-playground.ts';

const revision = 'a'.repeat(40);
/** The session starts once the (faked) island has mounted: a few microtasks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Session {
  root: HTMLElement;
  sha: string;
  signal: AbortSignal;
  resolve(): void;
  reject(reason: Error): void;
}

function harness(enabled = true) {
  const controller = new AbortController();
  const state = { status: '', retryVisible: false };
  const chrome = {
    setStatus: (text: string) => (state.status = text),
    getStatus: () => state.status,
    setRetryVisible: (visible: boolean) => (state.retryVisible = visible),
    isRetryVisible: () => state.retryVisible,
    setRun() {},
    getRun: () => ({ disabled: true, running: false }),
    setPane() {},
    getPane: () => 'code' as const,
    setOutputUnread() {},
    setHandlers() {},
    triggerRun() {},
  };
  const sessions: Session[] = [];
  const panel = Object.assign(new EventTarget(), {
    dataset: { jaiEnabled: String(enabled), jaiRevision: revision },
    matches: () => true,
    querySelectorAll: () => [],
    querySelector: () => null,
    classList: { remove() {} },
  });
  const loader = (root: HTMLElement, sha: string, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const session = { root, sha, signal, resolve, reject };
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Closed', 'AbortError')),
        { once: true }
      );
      sessions.push(session);
    });
  // A minimal stand-in for the workspace element; only the touched members exist.
  const host = initializeJaiPlayground(
    panel as unknown as HTMLElement,
    controller.signal,
    loader,
    async () => chrome
  );
  return { host, controller, sessions, state, panel };
}

test('unpublished compiler never creates a session', async () => {
  const game = harness(false);
  await assert.rejects(game.host.prepare(), /unavailable/);
  assert.equal(game.sessions.length, 0);
  game.controller.abort();
});

test('readiness waits for the portfolio editor and actual compiler session', async () => {
  const game = harness();
  const first = game.host.prepare();
  await settle();
  assert.equal(game.host.prepare(), first);
  assert.equal(game.sessions[0]!.sha, revision);
  assert.equal(game.host.isReady(), false);
  game.sessions[0]!.resolve();
  await first;
  assert.equal(game.host.isReady(), true);
  assert.equal(game.state.status, '');
  game.controller.abort();
  assert.equal(game.sessions[0]!.signal.aborted, true);
});

test('close cancels initialization and reopening uses a fresh session', async () => {
  const game = harness();
  const first = game.host.prepare();
  await settle();
  const rejection = assert.rejects(first, { name: 'AbortError' });
  game.host.destroy();
  await rejection;
  const second = game.host.prepare();
  await settle();
  assert.equal(game.sessions.length, 2);
  game.sessions[1]!.resolve();
  await second;
  assert.equal(game.host.isReady(), true);
  game.controller.abort();
});

test('failed initialization disposes its workers and allows retry', async () => {
  const game = harness();
  const first = game.host.prepare();
  await settle();
  const rejection = assert.rejects(first, /Compiler unavailable/);
  game.sessions[0]!.reject(new Error('Compiler unavailable'));
  await rejection;
  assert.equal(game.sessions[0]!.signal.aborted, true);
  assert.equal(game.state.retryVisible, true);
  const second = game.host.prepare();
  await settle();
  game.sessions[1]!.resolve();
  await second;
  game.controller.abort();
});
