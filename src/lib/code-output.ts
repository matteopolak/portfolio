export type OutputKind = 'stdout' | 'error';

export interface CodeOutput {
  /** Empties the output and its summary. */
  clear(): void;
  /** Marks a run as in progress and starts its timer. */
  start(): void;
  /** Replaces the output with a finished result. */
  write(text: string, kind?: OutputKind, details?: string[]): void;
}

const formatDuration = (milliseconds: number) =>
  milliseconds < 1000
    ? `${Math.max(1, Math.round(milliseconds))} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;

/** Empties a workspace's output pane and its run summary. */
export function clearOutput(panel: HTMLElement) {
  const output = panel.querySelector<HTMLElement>('[data-code-output]');
  if (output) {
    output.textContent = '';
    delete output.dataset.kind;
    output.removeAttribute('aria-busy');
  }
  const summary = panel.querySelector<HTMLElement>('[data-code-summary]');
  if (summary) summary.textContent = '';
  delete panel.dataset.outputUnread;
}

/**
 * Shared writer for the workspace output pane, so every language reports
 * results, errors, and run summaries the same way.
 */
export function createCodeOutput(panel: HTMLElement): CodeOutput {
  const output = panel.querySelector<HTMLElement>('[data-code-output]')!;
  const summary = panel.querySelector<HTMLElement>('[data-code-summary]');
  let startedAt: number | undefined;

  const markUnread = () => {
    if (panel.dataset.pane !== 'output') panel.dataset.outputUnread = 'true';
  };

  return {
    clear() {
      startedAt = undefined;
      clearOutput(panel);
    },
    start() {
      startedAt = performance.now();
      output.textContent = '';
      delete output.dataset.kind;
      output.setAttribute('aria-busy', 'true');
      if (summary) summary.textContent = 'Running…';
    },
    write(text, kind = 'stdout', details = []) {
      const elapsed =
        startedAt === undefined ? undefined : performance.now() - startedAt;
      startedAt = undefined;
      output.textContent = text;
      output.dataset.kind = kind;
      output.removeAttribute('aria-busy');
      if (summary)
        summary.textContent = [
          kind === 'error' ? 'Failed' : undefined,
          ...details,
          elapsed === undefined ? undefined : formatDuration(elapsed),
        ]
          .filter(Boolean)
          .join(' · ');
      markUnread();
    },
  };
}
