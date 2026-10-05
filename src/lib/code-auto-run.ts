export const AUTO_RUN_DELAY_MS = 600;

type Timer = ReturnType<typeof setTimeout>;

interface AutoRunOptions {
  delay?: number;
  schedule?: (callback: () => void, delay: number) => Timer;
  clear?: (timer: Timer | undefined) => void;
}

export interface AutoRunner {
  changed(): void;
  play(): void | Promise<void>;
  pause(): void;
  compositionStart(): void;
  compositionEnd(): void;
  destroy(): void;
}

export function createAutoRunner(
  run: () => void | Promise<void>,
  cancel: () => void,
  {
    delay = AUTO_RUN_DELAY_MS,
    schedule = setTimeout,
    clear = clearTimeout,
  }: AutoRunOptions = {}
): AutoRunner {
  let timer: Timer | undefined;
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
