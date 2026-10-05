import { EditorSelection, type EditorState } from '@codemirror/state';
import { createAutoRunner, type AutoRunner } from '../code-auto-run.ts';
import { createEditor } from '../code-editor.ts';
import { createCodeOutput } from '../code-output.ts';
import { showPane } from '../code-workspace-layout.ts';
import { Workspace } from './workspace.ts';
import { starterFiles } from './starter.ts';
import { initializeFileTree } from './file-tree.ts';
import { LanguageClient, pathFromUri } from './language-client.ts';
import { definitionTarget, renameSymbol } from './language-actions.ts';
import type { RunOutput } from './engine.ts';
import {
  FORMAT_DRIVER_ASSET,
  FORMAT_DRIVER_PATH,
  formatChange,
  formatFiles,
  formatOutcome,
  isFormattable,
  mapOffset,
} from './format.ts';
import type {
  ServerCapabilities,
  WorkerRequest,
  WorkerResponse,
} from './lsp-types.ts';

/** Interpreter budget in basic blocks; runaway programs fail instead of hanging. */
const BUDGET = 200_000_000;

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
    formatButton = panel.querySelector<HTMLButtonElement>('[data-code-format]'),
    status = panel.querySelector<HTMLElement>('[data-code-status]'),
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
  // Format button state; see formatSelected().
  let driver: string | undefined;
  let formatter: Promise<Worker> | undefined;
  let formatting = false;
  let formatJob = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

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
      // A read-only stdlib view or a non-Jai file (jaifmt.toml) is not a
      // language document: no hover or completion.
      if (viewing || !isFormattable(workspace.selected?.path.name ?? ''))
        return undefined;
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
    updateFormat();
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
    updateFormat();
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
  /*
   * Format runs jaifmt's browser driver (`jaifmt-playground.jai` from the
   * release) in its own worker, so it never waits on or cancels a program run.
   */
  function updateFormat() {
    if (!formatButton) return;
    formatButton.hidden = driver === undefined;
    formatButton.disabled =
      !ready ||
      formatting ||
      viewing !== undefined ||
      !isFormattable(workspace.selected?.path.name ?? '');
  }
  function announce(message: string) {
    if (!status) return;
    clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = setTimeout(() => {
      if (status.textContent === message) status.textContent = '';
    }, 3000);
  }
  async function loadDriver() {
    try {
      const response = await fetch(`/jai/${revision}/${FORMAT_DRIVER_ASSET}`, {
        signal,
      });
      // Releases built before jaifmt shipped have no driver: no Format button.
      if (!response.ok) return;
      const text = await response.text();
      if (!/^TARGET :: ".*";$/m.test(text)) return;
      driver = text;
    } catch {
      /* Without the driver the button stays hidden. */
    }
    updateFormat();
  }
  function formatWorker() {
    formatter ??= initializeWorker().then(({ worker }) => {
      worker.addEventListener('error', () => {
        terminate(worker);
        formatter = undefined;
      });
      return worker;
    });
    formatter.catch(() => (formatter = undefined));
    return formatter;
  }
  function play(worker: Worker, files: Record<string, string>, main: string) {
    const id = ++formatJob;
    return new Promise<RunOutput>((resolve, reject) => {
      const done = () => {
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', failed);
        signal.removeEventListener('abort', failed);
      };
      const message = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== 'play' || data.id !== id) return;
        done();
        if (data.error !== undefined) reject(new Error(data.error));
        else resolve(data.result);
      };
      const failed = () => {
        done();
        reject(signal.aborted ? abortError() : new Error('Formatter failed'));
      };
      worker.addEventListener('message', message);
      worker.addEventListener('error', failed);
      signal.addEventListener('abort', failed, { once: true });
      post(worker, { type: 'play', id, files, main, budget: BUDGET });
    });
  }
  async function formatSelected() {
    const selected = workspace.selected;
    if (!formatButton || formatButton.disabled || !driver || !selected) return;
    const path = selected.path.name;
    formatting = true;
    updateFormat();
    formatButton.setAttribute('aria-busy', 'true');
    try {
      saveState();
      const files = formatFiles(workspace.documents, path, driver);
      const result = await play(
        await formatWorker(),
        files,
        FORMAT_DRIVER_PATH
      );
      if (signal.aborted) return;
      const outcome = formatOutcome(result);
      if ('error' in outcome) {
        // The file is left as it was.
        showError(outcome.error);
        return;
      }
      const current = workspace.selected;
      if (
        viewing ||
        current?.path.name !== path ||
        current.version !== selected.version
      ) {
        showError(
          `jaifmt: ${path} changed while formatting; it was not modified.`
        );
        return;
      }
      const before = editor.view.state.doc.toString();
      const change = formatChange(before, outcome.text);
      if (!change) {
        announce(`${path} is already formatted`);
        return;
      }
      const cursor = editor.view.state.selection;
      const selection = EditorSelection.create(
        cursor.ranges.map((range) =>
          EditorSelection.range(
            mapOffset(before, change, range.anchor),
            mapOffset(before, change, range.head)
          )
        ),
        cursor.mainIndex
      );
      // One transaction: a single undo step restores the original text.
      editor.view.dispatch({
        changes: change,
        selection,
        scrollIntoView: true,
        userEvent: 'input.format',
      });
      announce(`Formatted ${path}`);
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    } finally {
      formatting = false;
      formatButton.removeAttribute('aria-busy');
      updateFormat();
    }
  }
  formatButton?.addEventListener(
    'click',
    () => {
      void formatSelected();
      editor.focus();
    },
    { signal }
  );

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
      } else if (
        event.shiftKey &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.code === 'KeyF' &&
        formatButton &&
        !formatButton.hidden
      ) {
        event.preventDefault();
        void formatSelected();
      }
    },
    { signal }
  );
  signal.addEventListener(
    'abort',
    () => {
      ready = false;
      clearTimeout(statusTimer);
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
      if (formatButton) {
        formatButton.hidden = true;
        formatButton.disabled = true;
      }
    },
    { once: true }
  );
  if (signal.aborted) {
    editor.destroy();
    throw abortError();
  }
  // A playground deep link (`/playground/jai#lib/math.jai`) opens that file.
  const requested = panel.dataset.codeOpen;
  if (requested && workspace.names.includes(requested))
    workspace.select(requested);
  showSelected();
  tree.render();
  const driverLoaded = loadDriver();
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
  await driverLoaded;
  if (signal.aborted) throw abortError();
  ready = true;
  idle();
  updateFormat();
  if (editedDuringBoot) runner.changed();
  else void runner.play();
  editor.focus();
}
