/*
 * The code workspaces that can run code on request (the WebMCP `run_code`
 * tool). A playground page or an open demo modal registers a target while its
 * workspace is mounted; the tool registers itself only while one exists.
 * Plain TS with no DOM or Astro imports.
 */
export interface RunRequest {
  code: string;
  /** Jai only: the workspace file to write (default `main.jai`). */
  filename?: string;
}

/** What one run produced, before the tool truncates it. */
export interface RunFinished {
  stdout: string;
  stderr: string;
  /** `null`: compilation failed, the run crashed, or it was stopped. */
  exitCode: number | null;
  diagnostics?: string[];
}

export interface RunTarget {
  language: 'jai' | 'quasi' | 'baerscript';
  /** Loads the code into the editor, runs it and resolves with the result. */
  run(request: RunRequest, signal: AbortSignal): Promise<RunFinished>;
}

const targets = new Set<RunTarget>();
const listeners = new Set<() => void>();

/** Registers a target; returns the function that removes it. */
export function registerRunTarget(target: RunTarget): () => void {
  targets.add(target);
  for (const listener of listeners) listener();
  return () => {
    if (targets.delete(target)) for (const listener of listeners) listener();
  };
}

/** The most recently registered target (the open modal wins over the page). */
export const activeRunTarget = (): RunTarget | undefined => [...targets].at(-1);

/** Calls `listener` whenever the set of targets changes; returns the unsubscribe. */
export function onRunTargetsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
