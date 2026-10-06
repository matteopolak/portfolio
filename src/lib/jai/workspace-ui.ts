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
import { OpenTabs, tabLabel, type OpenTab } from './open-tabs.ts';
import { fileIcon, fileIconKind } from './file-icons.ts';
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

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1);

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
    tabStrip = panel.querySelector<HTMLElement>('[data-code-tabs]'),
    empty = panel.querySelector<HTMLElement>('[data-code-empty]'),
    editorHost = find('editor');
  const workspace = new Workspace(starterFiles);
  const states = new Map<string, EditorState>();
  // Open-file tabs; `preview` holds the read-only file in the preview tab.
  const tabs = new OpenTabs();
  let preview: { path: string; text: string; state?: EditorState } | undefined;
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
          preview = { path: target.path, text: target.text };
          tabs.preview(target.path);
        } else tabs.open(target.path);
        show();
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
            : editor.createState(update.text, update.path);
          states.set(update.path, state);
        }
        show();
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
    if (viewing) {
      if (preview?.path === viewing) preview.state = editor.view.state;
    } else if (workspace.selected)
      states.set(workspace.selected.path.name, editor.view.state);
  }
  /*
   * Shows the active tab. The workspace selection always names the active
   * file tab, and is empty while the preview tab is active or no tab is open,
   * so edits, formatting and diagnostics only ever target an open file.
   */
  function show() {
    const tab = tabs.active;
    if (tab?.preview && preview?.path === tab.path) {
      workspace.deselect();
      viewing = tab.path;
      editor.setState(
        preview.state ?? editor.createState(preview.text, tab.path)
      );
      editor.setEditable(false);
      editor.diagnostics([], preview.text);
    } else {
      viewing = undefined;
      if (tab && !tab.preview) workspace.select(tab.path);
      else workspace.deselect();
      const selected = workspace.selected;
      editor.setState(
        selected
          ? (states.get(selected.path.name) ??
              editor.createState(selected.text, selected.path.name))
          : editor.createState('')
      );
      editor.setEditable(Boolean(selected));
      editor.diagnostics([], selected?.text ?? '');
    }
    const open = Boolean(workspace.selected || viewing);
    editorHost.hidden = !open;
    if (empty) empty.hidden = open;
    renderTabs();
    updateFormat();
    tree.render();
  }
  function renderTabs() {
    if (!tabStrip) return;
    const all = tabs.tabs;
    tabStrip.replaceChildren(
      ...all.map((tab, index) => {
        const { name, folder } = tabLabel(tab, all);
        const active = tab === tabs.active;
        const item = document.createElement('div');
        item.className = 'ide-filetab';
        item.dataset.tabIndex = String(index);
        if (active) item.dataset.active = 'true';
        if (tab.preview) item.dataset.preview = 'true';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ide-filetab-open';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        button.title = tab.preview ? `${tab.path} (read-only)` : tab.path;
        // The visible spans run together in the computed name; spell it out.
        button.setAttribute(
          'aria-label',
          [name, folder && `in ${folder}`, tab.preview && 'read-only']
            .filter(Boolean)
            .join(', ')
        );
        const label = document.createElement('span');
        label.className = 'ide-filetab-name';
        label.textContent = name;
        button.append(
          fileIcon(fileIconKind(tab.path), 'ide-filetab-icon'),
          label
        );
        if (folder) {
          const hint = document.createElement('span');
          hint.className = 'ide-filetab-folder';
          hint.textContent = folder;
          button.append(hint);
        }
        if (tab.preview) {
          button.append(fileIcon('lock', 'ide-filetab-readonly'));
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'ide-filetab-close';
        close.tabIndex = -1;
        close.dataset.tabClose = '';
        close.title = 'Close (Delete)';
        close.setAttribute('aria-label', `Close ${name}`);
        close.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"></path></svg>';
        item.append(button, close);
        return item;
      })
    );
    revealActiveTab();
  }
  // Keeps the active tab in view without scrolling the page around it.
  function revealActiveTab() {
    const current = tabStrip?.querySelector<HTMLElement>('[data-active]');
    if (!tabStrip || !current) return;
    const left = current.offsetLeft,
      right = left + current.offsetWidth;
    if (left < tabStrip.scrollLeft) tabStrip.scrollLeft = left;
    else if (right > tabStrip.scrollLeft + tabStrip.clientWidth)
      tabStrip.scrollLeft = right - tabStrip.clientWidth;
  }
  function tabAt(target: EventTarget | null) {
    const item = (target as Element | null)?.closest<HTMLElement>(
      '.ide-filetab'
    );
    return item ? tabs.tabs[Number(item.dataset.tabIndex)] : undefined;
  }
  function focusActiveTab() {
    tabStrip?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }
  function activateTab(tab: OpenTab) {
    if (tab === tabs.active) return;
    saveState();
    tabs.activate(tab);
    show();
  }
  function closeTab(tab: OpenTab) {
    const hadFocus = tabStrip?.contains(document.activeElement) ?? false;
    if (tab !== tabs.active) {
      tabs.close(tab);
      if (tab.preview) preview = undefined;
      renderTabs();
    } else {
      saveState();
      tabs.close(tab);
      if (tab.preview) preview = undefined;
      show();
    }
    if (hadFocus) focusActiveTab();
  }
  if (tabStrip) {
    // Phones hide the strip with the Files pane; reveal again once it is shown.
    const resized = new ResizeObserver(revealActiveTab);
    resized.observe(tabStrip);
    signal.addEventListener('abort', () => resized.disconnect(), {
      once: true,
    });
    tabStrip.addEventListener(
      'click',
      (event) => {
        const tab = tabAt(event.target);
        if (!tab) return;
        if ((event.target as Element).closest('[data-tab-close]')) {
          closeTab(tab);
          return;
        }
        activateTab(tab);
        showPane(panel, 'code');
        editor.focus();
      },
      { signal }
    );
    // Middle-click closes; preventing mousedown stops the autoscroll cursor.
    tabStrip.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 1 && tabAt(event.target)) event.preventDefault();
      },
      { signal }
    );
    tabStrip.addEventListener(
      'auxclick',
      (event) => {
        const tab = event.button === 1 ? tabAt(event.target) : undefined;
        if (!tab) return;
        event.preventDefault();
        closeTab(tab);
      },
      { signal }
    );
    tabStrip.addEventListener(
      'keydown',
      (event) => {
        const tab = tabAt(event.target);
        if (!tab || event.altKey || event.ctrlKey || event.metaKey) return;
        const all = tabs.tabs,
          index = all.indexOf(tab);
        const next =
          event.key === 'ArrowRight'
            ? all[(index + 1) % all.length]
            : event.key === 'ArrowLeft'
              ? all[(index - 1 + all.length) % all.length]
              : event.key === 'Home'
                ? all[0]
                : event.key === 'End'
                  ? all.at(-1)
                  : undefined;
        if (next) {
          event.preventDefault();
          activateTab(next);
          focusActiveTab();
        } else if (event.key === 'Delete') {
          event.preventDefault();
          closeTab(tab);
        }
      },
      { signal }
    );
    // A vertical wheel scrolls overflowing tabs sideways, as in VS Code.
    tabStrip.addEventListener(
      'wheel',
      (event) => {
        if (
          event.deltaX ||
          !event.deltaY ||
          tabStrip.scrollWidth <= tabStrip.clientWidth
        )
          return;
        event.preventDefault();
        tabStrip.scrollLeft += event.deltaY;
      },
      { signal, passive: false }
    );
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
        tabs.open(path);
        show();
        showPane(panel, 'code');
        editor.focus();
      },
      changed: (moves) => {
        if (moves) {
          const saved = [...states];
          for (const [from, to] of moves) {
            const state = saved.find(([path]) => path === from)?.[1];
            states.delete(from);
            // A new extension needs new highlighting, which a saved state can't change.
            if (state && extension(from) === extension(to))
              states.set(to, state);
          }
          tabs.move(moves);
        }
        const names = new Set(workspace.names);
        for (const path of states.keys())
          if (!names.has(path)) states.delete(path);
        // Deleted files lose their tabs; a newly created file opens in one.
        tabs.retain(names);
        const selected = workspace.selected?.path.name;
        const created = !moves && selected && !filesBefore.has(selected);
        if (created) tabs.open(selected);
        show();
        language?.sync(workspace.documents);
        runner.changed();
        if (created) {
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
      tabs.clear();
      preview = undefined;
      tabStrip?.replaceChildren();
      editorHost.hidden = false;
      if (empty) empty.hidden = true;
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
  const initial = workspace.selected?.path.name;
  if (initial) tabs.open(initial);
  if (requested && workspace.names.includes(requested)) tabs.open(requested);
  show();
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
