/*
 * The run summary in the output pane's header ("Running…", "Failed · 12 ms"),
 * and the unread dot on the narrow layout's Output tab.
 */
const formatDuration = (milliseconds: number) =>
  milliseconds < 1000
    ? `${Math.max(1, Math.round(milliseconds))} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;

export interface RunSummary {
  /** A run began: "Running…" and the clock. */
  start(): void;
  /** The run ended; `details` come before the time it took. */
  finish(details?: string[]): void;
  /** Output arrived while another pane was showing. */
  unread(): void;
  clear(): void;
}

export function createRunSummary(panel: HTMLElement): RunSummary {
  const summary = panel.querySelector<HTMLElement>('[data-code-summary]');
  let startedAt: number | undefined;
  const set = (text: string) => {
    if (summary) summary.textContent = text;
  };
  return {
    start() {
      startedAt = performance.now();
      set('Running…');
    },
    finish(details = []) {
      const elapsed =
        startedAt === undefined ? undefined : performance.now() - startedAt;
      startedAt = undefined;
      set(
        [...details, elapsed === undefined ? '' : formatDuration(elapsed)]
          .filter(Boolean)
          .join(' · ')
      );
    },
    unread() {
      if (panel.dataset.pane !== 'output') panel.dataset.outputUnread = 'true';
    },
    clear() {
      startedAt = undefined;
      set('');
      delete panel.dataset.outputUnread;
    },
  };
}
