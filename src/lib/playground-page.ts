import {
  codeDemos,
  setDemoLoading,
  watchDemoLoading,
  wireFullscreen,
} from './code-demos';

/**
 * Starts the full-page playground on `/playground/<id>`: the same workspace
 * and runtime as the Projects modal, mounted in `[data-playground-page]`
 * and loaded immediately. There is no dialog, so Escape has no effect here
 * either; it stays with the editor (Vim, completion, search).
 */
export function initializePlaygroundPage() {
  const root = document.querySelector<HTMLElement>('[data-playground-page]');
  const demo = codeDemos.find(({ id }) => id === root?.dataset.playgroundPage);
  if (!root || !demo) return;
  const controller = new AbortController();
  const { signal } = controller;
  const panel = root.querySelector<HTMLElement>('[data-code-workspace]');
  // `#lib/math.jai` opens that workspace file (jai only; other demos have one file).
  const file = decodeURIComponent(location.hash.slice(1));
  if (panel && file) panel.dataset.codeOpen = file;

  watchDemoLoading(root, signal);
  wireFullscreen(root, panel, signal);
  const playground = demo.initialize(root, signal);
  setDemoLoading(root, 0, 'Loading playground…');
  playground.prepare().then(
    () => {
      if (signal.aborted) return;
      setDemoLoading(root, 1, 'Ready', 'ready');
      root
        .querySelector<HTMLElement>('.cm-content')
        ?.focus({ preventScroll: true });
    },
    () => {
      // The loader shows the demo's own error event; Retry stays in the header.
    }
  );
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) return;
      controller.abort();
      playground.destroy();
    },
    { once: true }
  );
}
