import { createAutoRunner, type AutoRunner } from './code-auto-run.ts';
import { createCodeOutput } from './code-output.ts';
import type { Editor, EditorLanguage } from './code-editor.ts';
import {
  initializeWorkspaceLayout,
  showPane,
} from './code-workspace-layout.ts';
const EXECUTION_TIMEOUT_MS = 1000;
interface CodePlaygroundOptions {
  createWorker(): Worker;
  language: EditorLanguage;
}

type InterpreterMessage =
  | { type: 'ready' }
  | { type: 'boot-error'; error: string }
  | { type: 'result'; output?: string; error?: string };

export function initializeCodePlayground(
  root: HTMLElement,
  signal: AbortSignal,
  options: CodePlaygroundOptions
) {
  const panel = root.querySelector<HTMLElement>('[data-code-workspace]')!;
  const container = panel.querySelector<HTMLElement>('[data-code-editor]')!;
  initializeWorkspaceLayout(panel, signal);
  const output = createCodeOutput(panel);
  const status = panel.querySelector<HTMLElement>('[data-code-status]')!;
  const runButton = panel.querySelector<HTMLButtonElement>('[data-code-run]')!;
  const cancelButton =
    panel.querySelector<HTMLButtonElement>('[data-code-cancel]')!;
  const retry = panel.querySelector<HTMLButtonElement>('[data-code-retry]')!;
  let session: AbortController | undefined;
  let editor: Editor | undefined;
  let worker: Worker | undefined;
  let pending: Promise<void> | undefined;
  let rejectBoot: ((reason: Error) => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let ready = false;
  let source = panel.dataset.codeStarter ?? '';
  let generation = 0;
  let running = false;
  let runJob = 0;
  let prepared = false;
  let editedDuringBoot = false;
  let cleanupBoot: (() => void) | undefined;
  let autoRun: AutoRunner | undefined;

  function emit(type: string, message?: string) {
    root.dispatchEvent(
      new CustomEvent(type, { detail: { message }, bubbles: true })
    );
  }
  function idle() {
    running = false;
    runButton.disabled = !ready;
    runButton.hidden = false;
    cancelButton.hidden = true;
  }
  function stopWorker() {
    clearTimeout(timeout);
    cleanupBoot?.();
    worker?.terminate();
    worker = undefined;
    ready = false;
    rejectBoot?.(new DOMException('Closed', 'AbortError'));
    rejectBoot = undefined;
  }
  function destroy() {
    ++generation;
    prepared = false;
    editedDuringBoot = false;
    autoRun?.destroy();
    autoRun = undefined;
    session?.abort();
    session = undefined;
    stopWorker();
    editor?.destroy();
    editor = undefined;
    container.replaceChildren();
    pending = undefined;
    source = panel.dataset.codeStarter ?? '';
    output.clear();
    showPane(panel, 'code');
    status.textContent = '';
    retry.hidden = true;
    idle();
  }
  function bootWorker() {
    if (ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const current = options.createWorker();
      worker = current;
      rejectBoot = reject;
      const timer = setTimeout(() => {
        if (current !== worker) return;
        current.terminate();
        worker = undefined;
        rejectBoot = undefined;
        reject(new Error('Interpreter timed out'));
      }, 20000);
      const cleanup = () => {
        clearTimeout(timer);
        if (cleanupBoot === cleanup) cleanupBoot = undefined;
        session?.signal.removeEventListener('abort', abort);
      };
      cleanupBoot = cleanup;
      const abort = () => {
        cleanup();
        current.terminate();
        reject(new DOMException('Closed', 'AbortError'));
      };
      session?.signal.addEventListener('abort', abort, { once: true });
      current.addEventListener(
        'message',
        ({ data }: MessageEvent<InterpreterMessage>) => {
          if (current !== worker) return;
          if (data.type === 'ready') {
            cleanup();
            ready = true;
            rejectBoot = undefined;
            resolve();
          } else if (data.type === 'boot-error') {
            cleanup();
            rejectBoot = undefined;
            reject(new Error(data.error));
          } else if (data.type === 'result') {
            clearTimeout(timeout);
            if (data.error !== undefined) output.write(data.error, 'error');
            else output.write(data.output ?? '');
            idle();
          }
        }
      );
      current.addEventListener('error', () => {
        if (current !== worker) return;
        cleanup();
        const error = new Error('Interpreter failed');
        if (!ready) {
          rejectBoot = undefined;
          reject(error);
        } else {
          output.write(error.message, 'error');
          stopWorker();
          idle();
        }
      });
    });
  }
  function prepare() {
    if (pending) return pending;
    if (signal.aborted)
      return Promise.reject(new DOMException('Closed', 'AbortError'));
    const current = ++generation;
    session = new AbortController();
    const sessionSignal = session.signal;
    status.textContent = 'Loading…';
    retry.hidden = true;
    pending = (async () => {
      const { createEditor } = await import('./code-editor.ts');
      if (sessionSignal.aborted) throw new DOMException('Closed', 'AbortError');
      autoRun = createAutoRunner(run, cancelExecution);
      container.addEventListener('compositionstart', autoRun.compositionStart, {
        signal: sessionSignal,
      });
      container.addEventListener('compositionend', autoRun.compositionEnd, {
        signal: sessionSignal,
      });
      editor = createEditor(container, {
        text: source,
        language: options.language,
        onChange: (text: string) => {
          source = text;
          if (prepared) autoRun?.changed();
          else editedDuringBoot = true;
        },
      });
      await bootWorker();
      if (current !== generation)
        throw new DOMException('Closed', 'AbortError');
      status.textContent = '';
      idle();
      editor.focus();
      prepared = true;
      emit('project-demo-ready');
      if (editedDuringBoot) {
        editedDuringBoot = false;
        autoRun?.changed();
      } else void autoRun?.play();
    })().catch((error: Error) => {
      if (current === generation && error.name !== 'AbortError') {
        destroy();
        status.textContent = error.message;
        retry.hidden = false;
        emit('project-demo-error', error.message);
      }
      throw error;
    });
    return pending;
  }
  async function run() {
    if (!prepared) {
      editedDuringBoot = true;
      return;
    }
    if (running) return;
    running = true;
    runButton.disabled = true;
    runButton.hidden = true;
    cancelButton.hidden = false;
    output.start();
    const current = generation;
    const currentJob = ++runJob;
    try {
      if (!ready) await bootWorker();
      if (current !== generation || currentJob !== runJob || signal.aborted)
        return;
      worker?.postMessage({ source });
      timeout = setTimeout(() => {
        stopWorker();
        output.write(`Stopped after ${EXECUTION_TIMEOUT_MS} ms`, 'error');
        idle();
        runButton.disabled = false;
      }, EXECUTION_TIMEOUT_MS);
    } catch (error) {
      if (current === generation && currentJob === runJob) {
        output.write(
          error instanceof Error ? error.message : String(error),
          'error'
        );
        idle();
        runButton.disabled = false;
      }
    }
  }
  function cancelExecution() {
    ++runJob;
    if (!running) return;
    stopWorker();
    output.write('Stopped', 'error');
    idle();
    runButton.disabled = false;
  }
  runButton.addEventListener(
    'click',
    () => {
      showPane(panel, 'output');
      void autoRun?.play();
    },
    { signal }
  );
  cancelButton.addEventListener('click', () => autoRun?.pause(), { signal });
  retry.addEventListener(
    'click',
    () => {
      void prepare().catch(() => {});
    },
    { signal }
  );
  panel.addEventListener(
    'keydown',
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        showPane(panel, 'output');
        void autoRun?.play();
      }
    },
    { signal }
  );
  signal.addEventListener('abort', destroy, { once: true });
  return { prepare, isReady: () => ready, destroy };
}
