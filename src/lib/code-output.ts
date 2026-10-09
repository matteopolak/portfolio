export type OutputKind = 'stdout' | 'error';

export interface CodeOutput {
  /** Empties the output and its summary. */
  clear(): void;
  /** Marks a run as in progress and starts its timer. */
  start(): void;
  /**
   * Shows what a still-running program has written so far (one that waits
   * for the page, like an animation); the run and its timer go on.
   */
  progress(content: (string | Node)[]): void;
  /** Replaces the output with a finished result. */
  write(
    content: string | (string | Node)[],
    kind?: OutputKind,
    details?: string[]
  ): void;
}

const formatDuration = (milliseconds: number) =>
  milliseconds < 1000
    ? `${Math.max(1, Math.round(milliseconds))} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;

/** Empties a workspace's output pane and its run summary. */
export function clearOutput(panel: HTMLElement) {
  // A workspace with its own output view (the Jai terminal) clears that instead.
  if (
    !panel.dispatchEvent(
      new CustomEvent('code-output-clear', { cancelable: true })
    )
  )
    return;
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
  // Most runs finish in a few milliseconds. Until this long has passed the
  // previous output stays, dimmed, so a fast re-run fades from old to new
  // instead of flashing an empty "Running…" pane in between.
  const PLACEHOLDER_DELAY_MS = 300;
  let placeholder: ReturnType<typeof setTimeout> | undefined;
  const cancelPlaceholder = () => {
    clearTimeout(placeholder);
    placeholder = undefined;
  };

  const markUnread = () => {
    if (panel.dataset.pane !== 'output') panel.dataset.outputUnread = 'true';
  };

  return {
    clear() {
      startedAt = undefined;
      cancelPlaceholder();
      delete output.dataset.state;
      clearOutput(panel);
    },
    start() {
      startedAt = performance.now();
      output.setAttribute('aria-busy', 'true');
      cancelPlaceholder();
      if (!output.hasChildNodes()) {
        if (summary) summary.textContent = 'Running…';
        return;
      }
      output.dataset.state = 'stale';
      placeholder = setTimeout(() => {
        placeholder = undefined;
        output.textContent = '';
        delete output.dataset.kind;
        delete output.dataset.state;
        if (summary) summary.textContent = 'Running…';
      }, PLACEHOLDER_DELAY_MS);
    },
    progress(content) {
      cancelPlaceholder();
      delete output.dataset.state;
      // Follow new lines unless the reader scrolled up.
      const following =
        output.scrollHeight - output.scrollTop - output.clientHeight < 24;
      output.replaceChildren(...content);
      output.dataset.kind = 'stdout';
      if (following) output.scrollTop = output.scrollHeight;
      if (summary) summary.textContent = 'Running…';
      markUnread();
    },
    write(content, kind = 'stdout', details = []) {
      const elapsed =
        startedAt === undefined ? undefined : performance.now() - startedAt;
      startedAt = undefined;
      cancelPlaceholder();
      delete output.dataset.state;
      if (typeof content === 'string') output.textContent = content;
      else output.replaceChildren(...content);
      output.dataset.kind = kind;
      output.removeAttribute('aria-busy');
      // Restart the fade-in for this result.
      output.classList.remove('is-fresh');
      void output.offsetWidth;
      output.classList.add('is-fresh');
      // Long output opens at its end, where the latest lines and the exit code are.
      output.scrollTop = output.scrollHeight;
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
