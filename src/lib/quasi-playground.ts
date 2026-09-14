import Prism from 'prismjs';
import 'prismjs/components/prism-rust';

const EXECUTION_TIMEOUT_MS = 1_000;

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'boot-error'; error: string }
  | { type: 'result'; output?: string; error?: string };

export function initializeQuasiPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  const source = root.querySelector<HTMLTextAreaElement>('[data-quasi-source]');
  const output = root.querySelector<HTMLElement>('[data-quasi-output]');
  const highlight = root.querySelector<HTMLElement>('[data-quasi-highlight]');
  const lines = root.querySelector<HTMLElement>('[data-quasi-lines]');
  const runButton = root.querySelector<HTMLButtonElement>('[data-quasi-run]');
  let worker: Worker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const renderEditor = () => {
    if (!source || !highlight || !lines) return;
    highlight.innerHTML = `${Prism.highlight(source.value, Prism.languages.rust, 'rust')}\n`;
    lines.textContent = Array.from(
      { length: source.value.split('\n').length },
      (_, index) => String(index + 1)
    ).join('\n');
  };

  const syncEditorScroll = () => {
    if (!source || !highlight || !lines) return;
    highlight.scrollTop = source.scrollTop;
    highlight.scrollLeft = source.scrollLeft;
    lines.scrollTop = source.scrollTop;
  };

  const setRunning = (running: boolean) => {
    if (!runButton) return;
    runButton.disabled = running;
    runButton.toggleAttribute('data-running', running);
    runButton.setAttribute(
      'aria-label',
      running ? 'Running program' : 'Run program'
    );
  };

  const finish = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    worker?.terminate();
    worker = undefined;
    if (output)
      output.textContent = message || '(program completed without output)';
    if (output) output.dataset.stream = stream;
    output?.removeAttribute('aria-busy');
    setRunning(false);
  };

  const run = () => {
    if (!source || !output || !runButton || worker) return;

    output.setAttribute('aria-busy', 'true');
    setRunning(true);
    worker = new Worker(new URL('./quasi-worker.ts', import.meta.url), {
      type: 'module',
      name: 'quasi-interpreter',
    });

    worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          worker?.postMessage({ source: source.value });
          timeout = setTimeout(() => {
            finish(
              `Execution stopped after ${EXECUTION_TIMEOUT_MS.toLocaleString()} ms.`,
              'stderr'
            );
          }, EXECUTION_TIMEOUT_MS);
        } else if (event.data.type === 'boot-error') {
          finish(
            `The Quasi browser build is unavailable.\n\n${event.data.error}`,
            'stderr'
          );
        } else if (event.data.error) {
          finish(event.data.error, 'stderr');
        } else {
          finish(event.data.output ?? '');
        }
      }
    );
    worker.addEventListener('error', () => {
      finish('The interpreter worker stopped unexpectedly.', 'stderr');
    });
  };

  runButton?.addEventListener('click', run, { signal });
  source?.addEventListener('input', renderEditor, { signal });
  source?.addEventListener('scroll', syncEditorScroll, { signal });
  source?.addEventListener(
    'keydown',
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        run();
      }
    },
    { signal }
  );

  renderEditor();

  return () => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    worker?.terminate();
    worker = undefined;
    output?.removeAttribute('aria-busy');
    setRunning(false);
  };
}
