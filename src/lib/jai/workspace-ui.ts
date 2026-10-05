import type { EditorState } from '@codemirror/state';
import { createAutoRunner, type AutoRunner } from '../code-auto-run.ts';
import { createEditor } from '../code-editor.ts';
import { createCodeOutput } from '../code-output.ts';
import { showPane } from '../code-workspace-layout.ts';
import { Workspace } from './workspace.ts';
import { initializeFileTree } from './file-tree.ts';
import { LanguageClient, pathFromUri } from './language-client.ts';
import { definitionTarget, renameSymbol } from './language-actions.ts';
import type { RunOutput } from './engine.ts';
import type {
  ServerCapabilities,
  WorkerRequest,
  WorkerResponse,
} from './lsp-types.ts';

/** Interpreter budget in basic blocks; runaway programs fail instead of hanging. */
const BUDGET = 200_000_000;

export const starterFiles: Record<string, string> = {
  'main.jai': `#import "Basic";
#load "lib/math.jai";

main :: () {
    total := 0;
    for i: 1..10 {
        total += square(i);
        print("% squared is %\\n", i, square(i));
    }
    print("Sum of squares: %\\n", total);
}
`,
  'lib/math.jai': `square :: (x: int) -> int {
    return x * x;
}
`,
};

interface CompilerWorker {
  worker: Worker;
  capabilities: { languageServer: boolean };
}

const abortError = () => new DOMException('Closed', 'AbortError');
const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export async function createSession(
  panel: HTMLElement,
  revision: string,
  signal: AbortSignal
) {
  const find = <T extends HTMLElement = HTMLElement>(name: string) =>
    panel.querySelector<T>(`[data-code-${name}]`)!;
  const output = createCodeOutput(panel);
  const run = find<HTMLButtonElement>('run'),
    cancel = find<HTMLButtonElement>('cancel'),
    crumb = panel.querySelector<HTMLElement>('[data-code-crumb]');
  const workspace = new Workspace(starterFiles);
  const states = new Map<string, EditorState>();
  const workers = new Set<Worker>();
  let running = false;
  let pendingExecution: AbortController | undefined;
  let editedDuringBoot = false;
  let languageCapabilities: ServerCapabilities | undefined;
  let language: LanguageClient | undefined;
  let execution: Worker | undefined;
  let ready = false;
  let job = 0;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;

  const showError = (message: string) => output.write(message, 'error');
  // Function declarations below are hoisted; the runner only calls them later.
  const runner: AutoRunner = createAutoRunner(execute, cancelExecution);

  const editor = createEditor(find('editor'), {
    text: workspace.selected?.text ?? '',
    language: 'jai',
    canDefine: () =>
      Boolean(language && languageCapabilities?.definitionProvider),
    canRename: () => Boolean(language && languageCapabilities?.renameProvider),
    onDefinition: async (offset) => {
      const selected = workspace.selected;
      if (!selected || !language || signal.aborted || viewing) return;
      try {
        const target = await definitionTarget(
          language,
          workspace,
          selected.path.name,
          offset,
          signal
        );
        if (
          !target ||
          signal.aborted ||
          workspace.selected?.path.name !== selected.path.name ||
          viewing
        )
          return;
        saveState();
        if (target.text !== undefined) {
          showReadOnly(target.path, target.text);
        } else {
          workspace.select(target.path);
          showSelected();
          tree.render();
        }
        editor.view.dispatch({
          selection: { anchor: target.from, head: target.to },
          scrollIntoView: true,
        });
        editor.focus();
      } catch (error) {
        if (!signal.aborted) showError(errorMessage(error));
      }
    },
    onRename: async (offset, newName) => {
      const selected = workspace.selected;
      if (!selected || !language || signal.aborted) return;
      try {
        saveState();
        const updates = await renameSymbol(
          language,
          workspace,
          selected.path.name,
          offset,
          newName,
          signal
        );
        if (signal.aborted) return;
        for (const update of updates) {
          const previous = states.get(update.path);
          const state = previous
            ? previous.update({ changes: update.changes }).state
            : editor.createState(update.text);
          states.set(update.path, state);
        }
        showSelected();
        language.sync(workspace.documents);
        runner.changed();
      } catch (error) {
        if (!signal.aborted) showError(errorMessage(error));
        throw error;
      }
    },
    currentDocument: () => ({
      path: workspace.selected?.path.name ?? 'main.jai',
      text: workspace.selected?.text ?? '',
      version: workspace.selected?.version ?? 0,
    }),
    service: () => {
      // A read-only stdlib view is not a workspace document: no hover or completion.
      if (viewing) return undefined;
      clearTimeout(syncTimer);
      language?.sync(workspace.documents);
      return language;
    },
    onChange: (text) => {
      if (workspace.selected) workspace.edit(text);
      if (ready) runner.changed();
      else editedDuringBoot = true;
      editor.diagnostics([], text);
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => language?.sync(workspace.documents), 120);
    },
  });

  let filesBefore = new Set<string>();
  /** Path of the module or stdlib file shown read-only (after go to definition), if any. */
  let viewing: string | undefined;
  function saveState() {
    if (workspace.selected && !viewing)
      states.set(workspace.selected.path.name, editor.view.state);
  }
  function showReadOnly(path: string, text: string) {
    viewing = path;
    editor.setState(editor.createState(text));
    editor.setEditable(false);
    editor.diagnostics([], text);
    if (crumb) crumb.textContent = `${path} (read-only)`;
  }
  function showSelected() {
    viewing = undefined;
    const selected = workspace.selected;
    editor.setState(
      selected
        ? (states.get(selected.path.name) ?? editor.createState(selected.text))
        : editor.createState('')
    );
    editor.setEditable(Boolean(selected));
    editor.diagnostics([], selected?.text ?? '');
    if (crumb) crumb.textContent = selected?.path.name ?? 'No file open';
  }
  const tree = initializeFileTree(
    panel,
    workspace,
    {
      beforeChange: () => {
        filesBefore = new Set(workspace.names);
        saveState();
      },
      select: (path) => {
        saveState();
        workspace.select(path);
        showSelected();
        showPane(panel, 'code');
        editor.focus();
      },
      changed: (moves) => {
        if (moves) {
          const saved = [...states];
          for (const [from, to] of moves) {
            const state = saved.find(([path]) => path === from)?.[1];
            states.delete(from);
            if (state) states.set(to, state);
          }
        }
        const names = new Set(workspace.names);
        for (const path of states.keys())
          if (!names.has(path)) states.delete(path);
        showSelected();
        language?.sync(workspace.documents);
        runner.changed();
        // A newly created file opens straight into the editor.
        const selected = workspace.selected?.path.name;
        if (!moves && selected && !filesBefore.has(selected)) {
          showPane(panel, 'code');
          editor.focus();
        }
      },
      error: showError,
    },
    signal
  );

  function terminate(worker: Worker | undefined) {
    if (!worker) return;
    worker.terminate();
    workers.delete(worker);
  }
  const post = (worker: Worker, message: WorkerRequest) =>
    worker.postMessage(message);
  function initializeWorker(workerSignal = signal): Promise<CompilerWorker> {
    if (workerSignal.aborted) return Promise.reject(abortError());
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    workers.add(worker);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        workerSignal.removeEventListener('abort', aborted);
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', error);
      };
      const fail = (reason: unknown) => {
        cleanup();
        terminate(worker);
        reject(reason);
      };
      const aborted = () => fail(abortError());
      const error = (event: ErrorEvent) =>
        fail(new Error(event.message || 'Compiler failed'));
      const message = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== 'init') return;
        if (data.error !== undefined) fail(new Error(data.error));
        else {
          cleanup();
          resolve({ worker, capabilities: data.capabilities });
        }
      };
      const timer = setTimeout(
        () => fail(new Error('Compiler timed out')),
        20000
      );
      worker.addEventListener('message', message);
      worker.addEventListener('error', error);
      workerSignal.addEventListener('abort', aborted, { once: true });
      post(worker, { type: 'init', url: `/jai/${revision}/jai_wasm.wasm` });
    });
  }
  // Program output in write order (stderr marked), then diagnostics or the exit code.
  function showResult(result: RunOutput) {
    const nodes: (string | Node)[] = (result.output ?? [])
      .filter((chunk) => chunk.text)
      .map((chunk) => {
        const span = document.createElement('span');
        span.textContent = chunk.text;
        if (chunk.stream === 'stderr') span.dataset.stream = 'stderr';
        return span;
      });
    const written = nodes.map((node) => (node as Node).textContent).join('');
    const failed = result.exitCode === null;
    const errors: string[] = [];
    if (result.rendered) errors.push(result.rendered.trimEnd());
    else
      for (const d of result.diagnostics ?? [])
        errors.push(
          d.file
            ? `${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`
            : `${d.severity}: ${d.message}`
        );
    if (written && !written.endsWith('\n')) nodes.push('\n');
    if (errors.length) nodes.push(errors.join('\n') + '\n');
    // Compile and runtime failures carry no exit code; the summary says Failed.
    if (!failed) {
      const exit = document.createElement('span');
      exit.className = 'ide-output__exit';
      exit.textContent = `Exit code: ${result.exitCode}`;
      nodes.push(exit);
    } else if (!errors.length)
      nodes.push('The program failed without diagnostics.');
    output.write(nodes, failed ? 'error' : 'stdout');
  }
  function idle() {
    running = false;
    run.disabled = !ready;
    run.hidden = false;
    cancel.hidden = true;
  }
  function connect(worker: Worker) {
    execution = worker;
    worker.addEventListener(
      'message',
      ({ data }: MessageEvent<WorkerResponse>) => {
        if (
          signal.aborted ||
          worker !== execution ||
          data.type !== 'run' ||
          data.id !== job
        )
          return;
        if (data.error !== undefined) output.write(data.error, 'error');
        else showResult(data.result);
        idle();
      }
    );
    worker.addEventListener('error', (event) => {
      if (worker !== execution || signal.aborted) return;
      showError(event.message || 'Execution failed');
      terminate(worker);
      execution = undefined;
      idle();
    });
  }
  async function execute() {
    if (!ready) {
      editedDuringBoot = true;
      return;
    }
    if (signal.aborted) return;
    const id = ++job;
    running = true;
    run.disabled = true;
    run.hidden = true;
    cancel.hidden = false;
    output.start();
    try {
      const snapshot = workspace.snapshot();
      if (!execution) {
        const controller = new AbortController();
        pendingExecution = controller;
        const { worker } = await initializeWorker(controller.signal);
        if (pendingExecution === controller) pendingExecution = undefined;
        if (id !== job || signal.aborted) {
          terminate(worker);
          return;
        }
        connect(worker);
      }
      if (!execution) return;
      post(execution, {
        type: 'run',
        id,
        source: snapshot.source,
        options: { files: snapshot.files, budget: BUDGET },
      });
    } catch (error) {
      if (id !== job || signal.aborted) return;
      showError(errorMessage(error));
      idle();
    }
  }
  function cancelExecution() {
    ++job;
    pendingExecution?.abort();
    pendingExecution = undefined;
    if (!running) return;
    terminate(execution);
    execution = undefined;
    output.write('Stopped', 'error');
    idle();
  }
  const editorHost = find('editor');
  editorHost.addEventListener('compositionstart', runner.compositionStart, {
    signal,
  });
  editorHost.addEventListener('compositionend', runner.compositionEnd, {
    signal,
  });
  run.addEventListener(
    'click',
    () => {
      showPane(panel, 'output');
      void runner.play();
    },
    { signal }
  );
  cancel.addEventListener('click', () => runner.pause(), { signal });
  panel.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === 'Enter' &&
        !run.disabled
      ) {
        event.preventDefault();
        run.click();
      }
    },
    { signal }
  );
  signal.addEventListener(
    'abort',
    () => {
      ready = false;
      runner.destroy();
      ++job;
      clearTimeout(syncTimer);
      language?.dispose();
      for (const worker of workers) worker.terminate();
      workers.clear();
      editor.destroy();
      find('files').replaceChildren();
      output.clear();
      if (crumb) crumb.textContent = '';
      run.disabled = true;
      run.hidden = false;
      cancel.hidden = true;
    },
    { once: true }
  );
  if (signal.aborted) {
    editor.destroy();
    throw abortError();
  }
  showSelected();
  tree.render();
  const runtime = await initializeWorker();
  connect(runtime.worker);
  if (runtime.capabilities.languageServer) {
    const server = await initializeWorker();
    const client = new LanguageClient(server.worker, {
      diagnostics: (params) => {
        try {
          const path = pathFromUri(params.uri);
          const selected = workspace.selected;
          if (
            selected &&
            path === selected.path.name &&
            params.version === selected.version
          )
            editor.diagnostics(params.diagnostics, selected.text);
        } catch {
          /* Ignore diagnostics outside the current document. */
        }
      },
      failure: () => {
        language = undefined;
      },
    });
    language = client;
    const initialized = await client.initialize();
    languageCapabilities = initialized?.capabilities;
    client.sync(workspace.documents);
  }
  if (signal.aborted) throw abortError();
  ready = true;
  idle();
  if (editedDuringBoot) runner.changed();
  else void runner.play();
  editor.focus();
}
