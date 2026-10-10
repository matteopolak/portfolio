import {
  initializeWorkspaceLayout,
  showPane,
} from './code-workspace-layout.ts';
import type { Starter } from './jai/starter.ts';
import {
  whenWorkspaceMounted,
  type WorkspaceChrome,
} from './workspace-chrome.ts';
type SessionLoader = (
  panel: HTMLElement,
  revision: string,
  signal: AbortSignal,
  initial?: Starter
) => Promise<void>;
const loadSession: SessionLoader = async (panel, revision, signal, initial) => {
  const { createSession } = await import('./jai/workspace-ui.ts');
  if (signal.aborted) throw new DOMException('Closed', 'AbortError');
  await createSession(panel, revision, signal, initial);
};

export function initializeJaiPlayground(
  root: HTMLElement,
  signal: AbortSignal,
  createSession = loadSession,
  getChrome = whenWorkspaceMounted
) {
  const panel = root.matches('[data-code-workspace]')
    ? root
    : root.querySelector<HTMLElement>('[data-code-workspace]')!;
  const revision = panel.dataset.jaiRevision ?? '';
  let chrome: WorkspaceChrome | undefined;
  let mounting: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let ready = false;
  let generation = 0;
  // Set by Import folder / Reset: the next session starts from it, not the tour.
  let nextStarter: Starter | undefined;
  // The workspace is a Svelte island: its dock layout moves server-rendered
  // nodes, so nothing touches the DOM until the island has hydrated.
  function mount() {
    mounting ??= getChrome(panel, signal).then((mounted) => {
      chrome = mounted;
      initializeWorkspaceLayout(panel, signal);
      mounted.setHandlers({
        retry: () => {
          void prepare().catch(() => {});
        },
      });
    });
    return mounting;
  }
  function destroy() {
    ++generation;
    controller?.abort();
    controller = undefined;
    pending = undefined;
    ready = false;
    chrome?.setStatus('');
    chrome?.setRetryVisible(false);
    showPane(panel, 'code');
  }
  function prepare() {
    if (ready) return Promise.resolve();
    if (pending) return pending;
    if (signal.aborted)
      return Promise.reject(new DOMException('Closed', 'AbortError'));
    if (panel.dataset.jaiEnabled !== 'true' || !/^[a-f0-9]{40}$/.test(revision))
      return Promise.reject(new Error('Compiler unavailable'));
    const current = ++generation;
    controller = new AbortController();
    const sessionSignal = controller.signal;
    pending = mount()
      .then(() => {
        if (current !== generation || sessionSignal.aborted)
          throw new DOMException('Closed', 'AbortError');
        chrome!.setStatus('Loading…');
        chrome!.setRetryVisible(false);
        const initial = nextStarter;
        nextStarter = undefined;
        return createSession(panel, revision, sessionSignal, initial);
      })
      .then(() => {
        if (current !== generation || sessionSignal.aborted)
          throw new DOMException('Closed', 'AbortError');
        ready = true;
        chrome?.setStatus('');
        root.dispatchEvent(new CustomEvent('project-demo-ready'));
      })
      .catch((error: Error) => {
        if (current === generation) {
          controller?.abort();
          controller = undefined;
          pending = undefined;
          ready = false;
          if (error.name !== 'AbortError') {
            const message = String(error.message).slice(0, 500);
            chrome?.setStatus(message);
            chrome?.setRetryVisible(true);
            root.dispatchEvent(
              new CustomEvent('project-demo-error', { detail: { message } })
            );
          }
        }
        throw error;
      });
    return pending;
  }
  panel.addEventListener(
    'code-workspace-restart',
    (event) => {
      nextStarter = (event as CustomEvent<{ starter: Starter }>).detail.starter;
      destroy();
      void prepare().catch(() => {});
    },
    { signal }
  );
  signal.addEventListener(
    'abort',
    () => {
      chrome?.setHandlers({ retry: undefined });
      destroy();
    },
    { once: true }
  );
  return { prepare, destroy, isReady: () => ready };
}
