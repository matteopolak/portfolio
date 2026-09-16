import Prism from 'prismjs';
import 'prismjs/components/prism-rust';

const EXECUTION_TIMEOUT_MS = 1_000;

type WorkerResponse =
  | { type: 'progress'; progress: number }
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
  let bootPromise: Promise<void> | undefined;
  let resolveBoot: (() => void) | undefined;
  let rejectBoot: ((error: Error) => void) | undefined;
  let ready = false;
  let running = false;

  const emit = (
    type: 'project-demo-progress' | 'project-demo-ready' | 'project-demo-error',
    detail?: object
  ) => root.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));

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

  const setRunning = (nextRunning: boolean) => {
    running = nextRunning;
    if (!runButton) return;
    runButton.disabled = nextRunning;
    runButton.toggleAttribute('data-running', nextRunning);
    runButton.setAttribute(
      'aria-label',
      nextRunning ? 'Running program' : 'Run program'
    );
  };

  const finish = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    if (output)
      output.textContent = message || '(program completed without output)';
    if (output) output.dataset.stream = stream;
    output?.removeAttribute('aria-busy');
    setRunning(false);
  };

  const stopWorker = (reason?: Error) => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    if (reason) rejectBoot?.(reason);
    worker?.terminate();
    worker = undefined;
    bootPromise = undefined;
    resolveBoot = undefined;
    rejectBoot = undefined;
    ready = false;
  };

  const prepare = () => {
    if (ready) return Promise.resolve();
    if (bootPromise) return bootPromise;

    const current = new Worker(new URL('./quasi-worker.ts', import.meta.url), {
      type: 'module',
      name: 'quasi-interpreter',
    });
    worker = current;
    bootPromise = new Promise<void>((resolve, reject) => {
      resolveBoot = resolve;
      rejectBoot = reject;
    });

    current.addEventListener(
      'message',
      (event: MessageEvent<WorkerResponse>) => {
        if (worker !== current) return;
        if (event.data.type === 'progress') {
          emit('project-demo-progress', {
            progress: event.data.progress,
            message: 'Loading demo…',
          });
        } else if (event.data.type === 'ready') {
          ready = true;
          resolveBoot?.();
          resolveBoot = undefined;
          rejectBoot = undefined;
          emit('project-demo-ready');
        } else if (event.data.type === 'boot-error') {
          emit('project-demo-error', { message: event.data.error });
          stopWorker(new Error(event.data.error));
        } else if (event.data.error) {
          finish(event.data.error, 'stderr');
        } else {
          finish(event.data.output ?? '');
        }
      }
    );
    current.addEventListener('error', () => {
      const error = new Error('The interpreter worker stopped unexpectedly.');
      emit('project-demo-error', { message: error.message });
      if (ready) finish(error.message, 'stderr');
      stopWorker(error);
    });
    return bootPromise;
  };

  const run = async () => {
    if (!source || !output || !runButton || running) return;

    output.setAttribute('aria-busy', 'true');
    setRunning(true);
    try {
      await prepare();
      worker?.postMessage({ source: source.value });
      timeout = setTimeout(() => {
        stopWorker();
        finish(
          `Execution stopped after ${EXECUTION_TIMEOUT_MS.toLocaleString()} ms.`,
          'stderr'
        );
      }, EXECUTION_TIMEOUT_MS);
    } catch (error) {
      finish(
        `The Quasi browser build is unavailable.\n\n${error instanceof Error ? error.message : String(error)}`,
        'stderr'
      );
    }
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

  return {
    prepare,
    destroy() {
      stopWorker(new Error('The playground was closed.'));
      output?.removeAttribute('aria-busy');
      setRunning(false);
    },
  };
}
