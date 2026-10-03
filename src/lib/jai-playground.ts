export function initializeJaiPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  const panel = root.matches('[data-jai-playground]')
    ? root
    : root.querySelector<HTMLElement>('[data-jai-playground]')!;
  const container = panel.querySelector<HTMLElement>('[data-jai-frame]')!;
  const status = panel.querySelector<HTMLElement>('[data-jai-status]')!;
  const label = status.querySelector('p')!;
  const retry = panel.querySelector<HTMLButtonElement>('[data-jai-retry]')!;
  const revision = panel.dataset.jaiRevision ?? '';
  let frame: HTMLIFrameElement | undefined;
  let pending: Promise<void> | undefined;
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: ((error?: Error) => void) | undefined;

  function destroy() {
    clearTimeout(timer);
    finish?.(new DOMException('Workspace closed.', 'AbortError'));
    finish = undefined;
    frame?.remove();
    frame = undefined;
    pending = undefined;
    ready = false;
  }

  function fail(message: string) {
    ready = false;
    label.textContent = message;
    status.hidden = false;
    retry.hidden = false;
    finish?.(new Error(message));
    finish = undefined;
    clearTimeout(timer);
    frame?.remove();
    frame = undefined;
    pending = undefined;
    root.dispatchEvent(
      new CustomEvent('project-demo-error', { detail: { message } })
    );
  }

  async function prepare() {
    if (ready) return;
    if (pending) return pending;
    if (signal.aborted)
      throw new DOMException('Workspace disconnected.', 'AbortError');
    if (
      panel.dataset.jaiEnabled !== 'true' ||
      !/^[a-f0-9]{40}$/.test(revision)
    ) {
      throw new Error(
        'The browser compiler is awaiting its first verified release.'
      );
    }
    status.hidden = false;
    retry.hidden = true;
    label.textContent = 'Loading the compiler workspace…';
    frame = document.createElement('iframe');
    frame.title = 'Jai file tree, source editor and program output';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.src = `/jai/${revision}/index.html?embed=1`;
    pending = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve());
    });
    timer = setTimeout(
      () =>
        fail(
          'The compiler workspace did not initialize. Retry to load it again.'
        ),
      60000
    );
    container.replaceChildren(frame);
    return pending;
  }

  window.addEventListener(
    'message',
    (event) => {
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== location.origin
      )
        return;
      const data = event.data;
      if (!data || data.type !== 'jai-playground' || data.revision !== revision)
        return;
      if (data.state === 'error') {
        fail(
          typeof data.message === 'string'
            ? data.message.slice(0, 500)
            : 'Compiler initialization failed.'
        );
      } else if (data.state === 'ready') {
        clearTimeout(timer);
        ready = true;
        status.hidden = true;
        frame.focus();
        finish?.();
        finish = undefined;
        root.dispatchEvent(new CustomEvent('project-demo-ready'));
      }
    },
    { signal }
  );
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
