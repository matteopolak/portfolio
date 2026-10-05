import { createAutoRunner } from '../code-auto-run.js';
import { Workspace } from './workspace.js';
import { initializeFileTree } from './file-tree.js';
import { createEditor } from '../code-editor.js';
import { LanguageClient, pathFromUri } from './language-client.js';
import { definitionTarget, renameSymbol } from './language-actions.js';

export async function createSession(panel, revision, signal) {
  const find = (name) => panel.querySelector(`[data-code-${name}]`);
  const output = find('output'),
    run = find('run'),
    cancel = find('cancel');
  const workspace = new Workspace('main :: () -> int {\n    return 42;\n}\n');
  const states = new Map();
  const workers = new Set();
  let autoRun;
  let running = false;
  let pendingExecution;
  let editedDuringBoot = false;
  let languageCapabilities;
  let language,
    execution,
    ready = false,
    job = 0,
    syncTimer;
  const editor = createEditor(find('editor'), {
    text: workspace.selected.text,
    onCursor: () => {},
    canDefine: () =>
      Boolean(language && languageCapabilities?.definitionProvider),
    canRename: () => Boolean(language && languageCapabilities?.renameProvider),
    onDefinition: async (offset) => {
      const selected = workspace.selected;
      if (!selected || !language || signal.aborted) return;
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
          workspace.selected?.path.name !== selected.path.name
        )
          return;
        saveState();
        workspace.select(target.path);
        showSelected();
        tree.render();
        editor.view.dispatch({
          selection: { anchor: target.from, head: target.to },
          scrollIntoView: true,
        });
        editor.focus();
      } catch (error) {
        if (!signal.aborted) output.textContent = error.message;
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
            ? previous.update({
                changes: update.changes,
              }).state
            : editor.createState(update.text);
          states.set(update.path, state);
        }
        showSelected();
        language.sync(workspace.documents);
        autoRun?.changed();
      } catch (error) {
        if (!signal.aborted) output.textContent = error.message;
        throw error;
      }
    },
    currentDocument: () => ({
      path: workspace.selected?.path.name ?? 'main.jai',
      text: workspace.selected?.text ?? '',
      version: workspace.selected?.version ?? 0,
    }),
    service: () => {
      clearTimeout(syncTimer);
      language?.sync(workspace.documents);
      return language;
    },
    onChange: (text) => {
      if (workspace.selected) workspace.edit(text);
      if (ready) autoRun?.changed();
      else editedDuringBoot = true;
      editor.diagnostics([], text);
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => language?.sync(workspace.documents), 120);
    },
  });

  function saveState() {
    if (workspace.selected)
      states.set(workspace.selected.path.name, editor.view.state);
  }
  function showSelected() {
    const selected = workspace.selected;
    editor.setState(
      selected
        ? (states.get(selected.path.name) ?? editor.createState(selected.text))
        : editor.createState('')
    );
    editor.setEditable(Boolean(selected));
    editor.diagnostics([], selected?.text ?? '');
  }
  const tree = initializeFileTree(
    panel,
    workspace,
    {
      beforeChange: saveState,
      select: (path) => {
        saveState();
        workspace.select(path);
        showSelected();
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
        autoRun?.changed();
      },
      error: (message) => {
        output.textContent = message;
      },
    },
    signal
  );

  function terminate(worker) {
    worker?.terminate();
    workers.delete(worker);
  }
  function initializeWorker(workerSignal = signal) {
    if (workerSignal.aborted)
      return Promise.reject(new DOMException('Closed', 'AbortError'));
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
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
      const fail = (reason) => {
        cleanup();
        terminate(worker);
        reject(reason);
      };
      const aborted = () => fail(new DOMException('Closed', 'AbortError'));
      const error = (event) =>
        fail(new Error(event.message || 'Compiler failed'));
      const message = ({ data }) => {
        if (data.type !== 'init') return;
        if (data.error) fail(new Error(data.error));
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
      worker.postMessage({
        type: 'init',
        url: `/jai/${revision}/jai_wasm.wasm`,
      });
    });
  }
  function idle() {
    running = false;
    run.disabled = !ready;
    cancel.hidden = true;
  }
  function connect(worker) {
    execution = worker;
    worker.addEventListener('message', ({ data }) => {
      if (
        signal.aborted ||
        worker !== execution ||
        data.type !== 'run' ||
        data.id !== job
      )
        return;
      output.textContent = data.error ?? `Exit code: ${data.result.exitCode}`;
      idle();
    });
    worker.addEventListener('error', (event) => {
      if (worker !== execution || signal.aborted) return;
      output.textContent = event.message || 'Execution failed';
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
    cancel.hidden = false;
    output.textContent = '';
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
      execution.postMessage({
        type: 'run',
        id,
        source: snapshot.source,
        options: { files: snapshot.files, fuel: 1000000 },
      });
    } catch (error) {
      if (id !== job || signal.aborted) return;
      output.textContent = error.message;
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
    idle();
  }
  autoRun = createAutoRunner(execute, cancelExecution);
  find('editor').addEventListener(
    'compositionstart',
    autoRun.compositionStart,
    { signal }
  );
  find('editor').addEventListener('compositionend', autoRun.compositionEnd, {
    signal,
  });
  run.addEventListener(
    'click',
    () => {
      void autoRun.play();
    },
    { signal }
  );
  cancel.addEventListener('click', () => autoRun.pause(), { signal });
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
      autoRun.destroy();
      ++job;
      clearTimeout(syncTimer);
      language?.dispose();
      for (const worker of workers) worker.terminate();
      workers.clear();
      editor.destroy();
      find('files').replaceChildren();
      output.textContent = '';
      run.disabled = true;
      cancel.hidden = true;
    },
    { once: true }
  );
  if (signal.aborted) {
    editor.destroy();
    throw new DOMException('Closed', 'AbortError');
  }
  tree.render();
  const runtime = await initializeWorker();
  connect(runtime.worker);
  if (runtime.capabilities.languageServer) {
    const server = await initializeWorker();
    language = new LanguageClient(server.worker, {
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
    const initialized = await language.initialize();
    languageCapabilities = initialized?.capabilities;
    language.sync(workspace.documents);
  }
  if (signal.aborted) throw new DOMException('Closed', 'AbortError');
  ready = true;
  idle();
  if (editedDuringBoot) autoRun.changed();
  editor.focus();
}
