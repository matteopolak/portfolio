import { createAutoRunner, type AutoRunner } from './code-auto-run.ts';
import { createCodeOutput, type CodeOutput } from './code-output.ts';
import {
  whenWorkspaceMounted,
  type WorkspaceChrome,
} from './workspace-chrome.ts';
import type { Editor, EditorLanguage } from './code-editor.ts';
import { confirmDialog } from './workspace-actions.ts';
import type { RunFinished, RunRequest } from './run-target.ts';
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
  options: CodePlaygroundOptions,
  getChrome = whenWorkspaceMounted
) {
  const panel = root.querySelector<HTMLElement>('[data-code-workspace]')!;
  const container = panel.querySelector<HTMLElement>('[data-code-editor]')!;
  // The workspace is a Svelte island. Its dock layout moves server-rendered
  // nodes, so it (and everything else that touches the DOM) waits for the
  // island to hydrate; the header state is driven through `chrome`.
  let chrome: WorkspaceChrome | undefined;
  let output: CodeOutput | undefined;
  let mounting: Promise<void> | undefined;
  function mount() {
    mounting ??= getChrome(panel, signal).then((mounted) => {
      chrome = mounted;
      initializeWorkspaceLayout(panel, signal);
      output = createCodeOutput(panel);
      mounted.setHandlers({
        run: () => {
          showPane(panel, 'output');
          void autoRun?.play();
        },
        cancel: () => autoRun?.pause(),
        retry: () => {
          void prepare().catch(() => {});
        },
      });
      mounted.setRun({ disabled: !ready, running: false });
      // Single-file workspace: Reset puts the starter code back.
      panel.querySelector('[data-code-reset]')?.addEventListener(
        'click',
        async () => {
          const starter = panel.dataset.codeStarter ?? '';
          if (!editor || editor.view.state.doc.toString() === starter) return;
          const reset = await confirmDialog(panel, {
            title: 'Reset to starter code?',
            message:
              'This replaces the editor contents with the starter program. Your changes are lost.',
            confirmLabel: 'Reset code',
          });
          if (!reset || !editor || signal.aborted) return;
          editor.view.dispatch({
            changes: {
              from: 0,
              to: editor.view.state.doc.length,
              insert: starter,
            },
          });
          output?.clear();
        },
        { signal }
      );
    });
    return mounting;
  }
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
  // `runCode` waits here for the next finished run (see run-target.ts).
  let waiter: ((result: RunFinished) => void) | undefined;
  /** Shows a finished run and hands it to a waiting `runCode`. */
  function finish(text: string, kind: 'stdout' | 'error') {
    output!.write(text, kind);
    const resolve = waiter;
    waiter = undefined;
    resolve?.(
      kind === 'error'
        ? { stdout: '', stderr: text, exitCode: 1 }
        : { stdout: text, stderr: '', exitCode: 0 }
    );
  }

  function emit(type: string, message?: string) {
    root.dispatchEvent(
      new CustomEvent(type, { detail: { message }, bubbles: true })
    );
  }
  function idle() {
    running = false;
    chrome?.setRun({ disabled: !ready, running: false });
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
    output?.clear();
    showPane(panel, 'code');
    chrome?.setStatus('');
    chrome?.setRetryVisible(false);
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
            if (data.error !== undefined) finish(data.error, 'error');
            else finish(data.output ?? '', 'stdout');
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
          finish(error.message, 'error');
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
    pending = (async () => {
      await mount();
      if (sessionSignal.aborted) throw new DOMException('Closed', 'AbortError');
      chrome!.setStatus('Loading…');
      chrome!.setRetryVisible(false);
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
      chrome!.setStatus('');
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
        chrome?.setStatus(error.message);
        chrome?.setRetryVisible(true);
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
    chrome!.setRun({ disabled: true, running: true });
    output!.start();
    const current = generation;
    const currentJob = ++runJob;
    try {
      if (!ready) await bootWorker();
      if (current !== generation || currentJob !== runJob || signal.aborted)
        return;
      worker?.postMessage({ source });
      timeout = setTimeout(() => {
        stopWorker();
        finish(`Stopped after ${EXECUTION_TIMEOUT_MS} ms`, 'error');
        idle();
        chrome!.setRun({ disabled: false, running: false });
      }, EXECUTION_TIMEOUT_MS);
    } catch (error) {
      if (current === generation && currentJob === runJob) {
        finish(error instanceof Error ? error.message : String(error), 'error');
        idle();
        chrome!.setRun({ disabled: false, running: false });
      }
    }
  }
  function cancelExecution() {
    ++runJob;
    if (!running) return;
    stopWorker();
    output!.write('Stopped', 'error');
    idle();
    chrome!.setRun({ disabled: false, running: false });
  }
  /** Replaces the editor's text with `request.code` and runs it (WebMCP `run_code`). */
  async function runCode(
    request: RunRequest,
    runSignal: AbortSignal
  ): Promise<RunFinished> {
    await prepare();
    if (!editor || signal.aborted)
      throw new Error('The editor is not available');
    const finished = new Promise<RunFinished>((resolve, reject) => {
      waiter = resolve;
      runSignal.addEventListener('abort', () => reject(runSignal.reason), {
        once: true,
      });
    });
    showPane(panel, 'output');
    editor.view.dispatch({
      changes: {
        from: 0,
        to: editor.view.state.doc.length,
        insert: request.code,
      },
    });
    // `play` supersedes the debounced run the edit scheduled.
    void autoRun?.play();
    try {
      return await finished;
    } finally {
      waiter = undefined;
    }
  }
  panel.addEventListener(
    'keydown',
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!chrome) return;
        showPane(panel, 'output');
        void autoRun?.play();
      }
    },
    { signal }
  );
  signal.addEventListener(
    'abort',
    () => {
      chrome?.setHandlers({
        run: undefined,
        cancel: undefined,
        retry: undefined,
      });
      destroy();
    },
    { once: true }
  );
  return { prepare, isReady: () => ready, destroy, runCode };
}
