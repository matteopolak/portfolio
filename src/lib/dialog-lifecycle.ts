/*
 * Open/close helpers for the project demo dialogs (DemoModal.astro).
 *
 * Closing is two-step: `closeAnimated` plays the exit animation and only then
 * calls `dialog.close()`, and the browser fires `close` as a separate task
 * after that. A demo reopened inside either gap must win:
 *
 * - during the exit animation, `openDialog` cancels the pending close, so the
 *   dialog simply stays open with its session intact;
 * - between `close()` and its `close` event, the dialog is already open again
 *   when the event runs, so `onDialogClosed` drops it as stale instead of
 *   tearing down the session the reopen just showed.
 */

const pendingCloses = new WeakMap<HTMLDialogElement, () => void>();

/** Fallback for a missed `animationend` (hidden tab, no animation). */
export const CLOSE_FALLBACK_MS = 300;

/** Plays DemoModal's exit animation (`data-closing`), then closes. */
export function closeAnimated(
  dialog: HTMLDialogElement | null | undefined,
  reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  if (!dialog?.open || pendingCloses.has(dialog)) return;
  if (reducedMotion()) {
    dialog.close();
    return;
  }
  dialog.dataset.closing = 'true';
  const stop = () => {
    clearTimeout(fallback);
    dialog.removeEventListener('animationend', ended);
    pendingCloses.delete(dialog);
    delete dialog.dataset.closing;
  };
  const finish = () => {
    stop();
    if (dialog.open) dialog.close();
  };
  const ended = (event: Event) => {
    if (event.target === dialog) finish();
  };
  const fallback = setTimeout(finish, CLOSE_FALLBACK_MS);
  dialog.addEventListener('animationend', ended);
  pendingCloses.set(dialog, stop);
}

/**
 * Shows a demo dialog. If it is still playing its exit animation, the close
 * is cancelled instead (dropping `data-closing` restarts the enter animation).
 */
export function openDialog(dialog: HTMLDialogElement) {
  const cancel = pendingCloses.get(dialog);
  if (cancel) cancel();
  if (!dialog.open) dialog.showModal();
}

/**
 * Runs `callback` when the dialog really closed: a `close` event that arrives
 * after the dialog was reopened is ignored.
 */
export function onDialogClosed(
  dialog: HTMLDialogElement,
  callback: () => void,
  signal: AbortSignal
) {
  dialog.addEventListener(
    'close',
    () => {
      if (!dialog.open) callback();
    },
    { signal }
  );
}
