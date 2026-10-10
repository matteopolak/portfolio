/*
 * The reactive chrome of a code workspace: the header's status line, Run /
 * Stop / Retry buttons, and the narrow-screen pane tabs. CodeWorkspace.svelte
 * owns that state and registers a `WorkspaceChrome` for its root element; the
 * imperative runtimes (code-playground.ts, jai-playground.ts, jai/workspace-ui
 * .ts, code-output.ts, code-workspace-layout.ts) drive it through this
 * interface instead of poking the Svelte-rendered DOM.
 *
 * This file is plain TypeScript so `node --test` can import it; tests pass a
 * fake chrome.
 */
export type WorkspacePane = 'files' | 'code' | 'output';

export interface RunState {
  /** The Run button cannot be used (the runtime is not ready or is busy). */
  disabled: boolean;
  /** A program is running: Stop replaces Run. */
  running: boolean;
}

export interface WorkspaceChromeHandlers {
  run?: () => void;
  cancel?: () => void;
  retry?: () => void;
}

export interface WorkspaceChrome {
  setStatus(text: string): void;
  getStatus(): string;
  setRetryVisible(visible: boolean): void;
  isRetryVisible(): boolean;
  setRun(state: RunState): void;
  getRun(): RunState;
  setPane(pane: WorkspacePane): void;
  getPane(): WorkspacePane;
  setOutputUnread(unread: boolean): void;
  /** Replaces the button handlers (pass `{}` to detach). */
  setHandlers(handlers: WorkspaceChromeHandlers): void;
  /** Clicks Run as the user would (a no-op while it is disabled). */
  triggerRun(): void;
}

const chromes = new WeakMap<HTMLElement, WorkspaceChrome>();
const waiting = new WeakMap<
  HTMLElement,
  ((chrome: WorkspaceChrome) => void)[]
>();

/** Called by CodeWorkspace.svelte once it has mounted; returns the unregister function. */
export function registerWorkspaceChrome(
  panel: HTMLElement,
  chrome: WorkspaceChrome
) {
  chromes.set(panel, chrome);
  for (const resolve of waiting.get(panel) ?? []) resolve(chrome);
  waiting.delete(panel);
  return () => {
    if (chromes.get(panel) === chrome) chromes.delete(panel);
  };
}

/** The chrome of a mounted workspace, if there is one. */
export const workspaceChromeFor = (panel: HTMLElement) => chromes.get(panel);

/**
 * Resolves when the workspace's Svelte island has hydrated. Runtimes wait for
 * this before touching the workspace DOM: moving server-rendered nodes around
 * (the dock layout does) before hydration would break Svelte's hydration.
 */
export function whenWorkspaceMounted(
  panel: HTMLElement,
  signal?: AbortSignal
): Promise<WorkspaceChrome> {
  const existing = chromes.get(panel);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const queue = waiting.get(panel) ?? [];
    queue.push(resolve);
    waiting.set(panel, queue);
    signal?.addEventListener(
      'abort',
      () => reject(new DOMException('Closed', 'AbortError')),
      { once: true }
    );
  });
}
