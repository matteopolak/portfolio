export const AUTO_RUN_DELAY_MS = 600;
export function createAutoRunner(
  run,
  cancel,
  {
    delay = AUTO_RUN_DELAY_MS,
    schedule = setTimeout,
    clear = clearTimeout,
  } = {}
) {
  let timer;
  let disposed = false;
  let composing = false;
  const pause = () => {
    clear(timer);
    timer = undefined;
    cancel();
  };
  const play = () => {
    if (disposed) return;
    pause();
    return run();
  };
  const changed = () => {
    if (disposed) return;
    pause();
    if (!composing)
      timer = schedule(() => {
        timer = undefined;
        if (!disposed) void run();
      }, delay);
  };
  return {
    changed,
    play,
    pause,
    compositionStart: () => {
      composing = true;
      pause();
    },
    compositionEnd: () => {
      composing = false;
      changed();
    },
    destroy: () => {
      disposed = true;
      pause();
    },
  };
}
