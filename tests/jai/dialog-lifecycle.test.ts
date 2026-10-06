import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSE_FALLBACK_MS,
  closeAnimated,
  onDialogClosed,
  openDialog,
} from '../../src/lib/dialog-lifecycle.ts';

/**
 * Enough of `<dialog>` for the lifecycle helpers: like the browser, `close()`
 * clears `open` at once and fires `close` as a later task.
 */
class FakeDialog extends EventTarget {
  open = false;
  dataset: Record<string, string | undefined> = {};
  showModal() {
    if (this.open) throw new Error('already open');
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    setTimeout(() => this.dispatchEvent(new Event('close')));
  }
  animationEnd() {
    const event = new Event('animationend');
    this.dispatchEvent(event);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const animated = () => false;

function setup() {
  const fake = new FakeDialog();
  const dialog = fake as unknown as HTMLDialogElement;
  const controller = new AbortController();
  let teardowns = 0;
  onDialogClosed(dialog, () => ++teardowns, controller.signal);
  openDialog(dialog);
  return { fake, dialog, controller, teardowns: () => teardowns };
}

test('a close runs the teardown once, after the exit animation', async () => {
  const { fake, dialog, controller, teardowns } = setup();
  closeAnimated(dialog, animated);
  assert.equal(fake.dataset.closing, 'true');
  assert.equal(fake.open, true);
  closeAnimated(dialog, animated); // a second click while closing is ignored
  fake.animationEnd();
  assert.equal(fake.open, false);
  assert.equal(fake.dataset.closing, undefined);
  await sleep(CLOSE_FALLBACK_MS + 20);
  assert.equal(teardowns(), 1);
  controller.abort();
});

test('reopening during the exit animation cancels the close', async () => {
  const { fake, dialog, controller, teardowns } = setup();
  closeAnimated(dialog, animated);
  await sleep(50);
  openDialog(dialog);
  assert.equal(fake.open, true);
  assert.equal(fake.dataset.closing, undefined);
  // Neither the animation end nor the fallback timer closes it any more.
  fake.animationEnd();
  await sleep(CLOSE_FALLBACK_MS + 20);
  assert.equal(fake.open, true);
  assert.equal(teardowns(), 0);
  // And it can still be closed normally afterwards.
  closeAnimated(dialog, animated);
  fake.animationEnd();
  await sleep(10);
  assert.equal(teardowns(), 1);
  controller.abort();
});

test('a close event that arrives after a reopen is stale', async () => {
  const { fake, dialog, controller, teardowns } = setup();
  closeAnimated(dialog, () => true); // reduced motion: closes at once
  assert.equal(fake.open, false);
  // Reopened before the queued `close` event runs.
  openDialog(dialog);
  await sleep(10);
  assert.equal(fake.open, true);
  assert.equal(teardowns(), 0);
  controller.abort();
});

test('the fallback timer closes when animationend never comes', async () => {
  const { fake, dialog, controller, teardowns } = setup();
  closeAnimated(dialog, animated);
  await sleep(CLOSE_FALLBACK_MS + 20);
  assert.equal(fake.open, false);
  assert.equal(teardowns(), 1);
  controller.abort();
});
