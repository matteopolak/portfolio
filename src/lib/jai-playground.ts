import {
  initializeWorkspaceLayout,
  showPane,
} from './code-workspace-layout.ts';
type SessionLoader = (
  panel: HTMLElement,
  revision: string,
  signal: AbortSignal
) => Promise<void>;
const loadSession: SessionLoader = async (panel, revision, signal) => {
  const { createSession } = await import('./jai/workspace-ui.ts');
  if (signal.aborted) throw new DOMException('Closed', 'AbortError');
  await createSession(panel, revision, signal);
};

export function initializeJaiPlayground(
  root: HTMLElement,
  signal: AbortSignal,
  createSession = loadSession
) {
  const panel = root.matches('[data-code-workspace]')
    ? root
    : root.querySelector<HTMLElement>('[data-code-workspace]')!;
  const status = panel.querySelector<HTMLElement>('[data-code-status]')!;
  const retry = panel.querySelector<HTMLButtonElement>('[data-code-retry]')!;
  const revision = panel.dataset.jaiRevision ?? '';
  initializeWorkspaceLayout(panel, signal);
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let ready = false;
  let generation = 0;
  function destroy() {
    ++generation;
    controller?.abort();
    controller = undefined;
    pending = undefined;
    ready = false;
    status.textContent = '';
    retry.hidden = true;
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
    status.textContent = 'Loading…';
    retry.hidden = true;
    pending = createSession(panel, revision, sessionSignal)
      .then(() => {
        if (current !== generation || sessionSignal.aborted)
          throw new DOMException('Closed', 'AbortError');
        ready = true;
        status.textContent = '';
        root.dispatchEvent(new CustomEvent('project-demo-ready'));
      })
      .catch((error: Error) => {
        if (current === generation) {
          controller?.abort();
          controller = undefined;
          pending = undefined;
          ready = false;
          if (error.name !== 'AbortError') {
            status.textContent = String(error.message).slice(0, 500);
            retry.hidden = false;
            root.dispatchEvent(
              new CustomEvent('project-demo-error', {
                detail: { message: status.textContent },
              })
            );
          }
        }
        throw error;
      });
    return pending;
  }
  retry.addEventListener(
    'click',
    () => {
      void prepare().catch(() => {});
    },
    { signal }
  );
  signal.addEventListener('abort', destroy, { once: true });
  return { prepare, destroy, isReady: () => ready };
}
