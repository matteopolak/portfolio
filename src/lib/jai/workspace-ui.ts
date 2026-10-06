import {
  EditorSelection,
  type EditorState,
  type StateEffect,
} from '@codemirror/state';
import { createAutoRunner, type AutoRunner } from '../code-auto-run.ts';
import { createEditor } from '../code-editor.ts';
import { createCodeOutput } from '../code-output.ts';
import { showPane } from '../code-workspace-layout.ts';
import { Workspace, type WorkspaceDocument } from './workspace.ts';
import { loadStarter } from './starter.ts';
import { initializeFileTree } from './file-tree.ts';
import {
  LanguageClient,
  documentUri,
  pathFromUri,
  positionAt,
  resourceFromUri,
} from './language-client.ts';
import {
  applyWorkspaceEdit,
  definitionTarget,
  normalizeLocations,
  planWorkspaceEdit,
  positionRequest,
  prepareRename,
  renameSymbol,
  resolveLocation,
  sameWorkspace,
  type NavigationTarget,
  type PlannedEdit,
} from './language-actions.ts';
import {
  languageFeatures,
  prefetchDecorations,
  refreshLanguage,
  type LanguageDocument,
} from './lsp-extensions.ts';
import { locationLabel, provides, supportsCommand } from './lsp-features.ts';
import { closePicker, showPicker, type PickerItem } from './picker.ts';
import { closeHoverTooltips, EditorView } from '@codemirror/view';
import { OpenTabs, tabLabel, type OpenTab } from './open-tabs.ts';
import { fileIcon, fileIconKind } from './file-icons.ts';
import { createMarkdownPreview } from '../markdown-preview.ts';
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
import {
  QUICKFIX,
  combineFixes,
  diagnosticsAt,
  fixLabel,
  fixesFor,
  lintRule,
} from './lint-fixes.ts';
import type { Action as LintAction } from '@codemirror/lint';
import type {
  CodeAction,
  Command,
  Diagnostic,
  Expansion,
  Range,
  ServerCapabilities,
  SymbolInformation,
  WorkspaceEdit,
  WorkerRequest,
  WorkerResponse,
} from './lsp-types.ts';

/** Interpreter budget in basic blocks; runaway programs fail instead of hanging. */
const BUDGET = 200_000_000;
/** Lints per file whose quick fixes are looked up for the tooltip's Fix buttons. */
const MAX_LINT_FIXES = 50;

/** A document's last published diagnostics, and the quick fixes of its lints once known. */
interface Published {
  version: number;
  diagnostics: Diagnostic[];
  fixes?: Map<Diagnostic, CodeAction[]>;
}

interface CompilerWorker {
  worker: Worker;
  capabilities: { languageServer: boolean };
}

const abortError = () => new DOMException('Closed', 'AbortError');
const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1);

const mac = () => /Mac|iPhone|iPad/u.test(navigator.platform);

/** LSP SymbolKind numbers the server uses, for the symbol search list. */
const symbolKinds: Record<number, string> = {
  2: 'module',
  5: 'type',
  7: 'field',
  10: 'enum',
  12: 'procedure',
  13: 'variable',
  14: 'constant',
  22: 'enum member',
  23: 'struct',
};

/**
 * The read-only file in the preview tab: a module or stdlib file (opened in
 * the language server too, for highlighting and links), or generated code.
 */
interface Preview {
  path: string;
  uri: string;
  text: string;
  kind: 'library' | 'expansion';
  /** For expansions: what generated it, for the tab's tooltip. */
  title?: string;
  state?: EditorState;
}

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
  // The compiler release's tour (or the built-in starter for older releases).
  const starter = await loadStarter(revision, signal);
  if (signal.aborted) throw abortError();
  const workspace = new Workspace(starter.files);
  const states = new Map<string, EditorState>();
  // Open-file tabs; `preview` holds the read-only file in the preview tab.
  const tabs = new OpenTabs();
  let preview: Preview | undefined;
  // Scroll position of each open tab; a tab opened afresh starts at the top.
  const scrolls = new Map<string, StateEffect<unknown>>();
  const tabKey = (tab: OpenTab) => (tab.preview ? '~' : '') + tab.path;
  // The tab the reader has scrolled since it was shown. Only scrolling they
  // started is recorded, never the jumps from switching or restoring a file.
  let scrollOwner: OpenTab | undefined;
  function forgetClosedScrolls() {
    const open = new Set(tabs.tabs.map(tabKey));
    for (const key of scrolls.keys()) if (!open.has(key)) scrolls.delete(key);
  }
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

  /** Path of the read-only file in the preview tab while it is shown, if any. */
  let viewing: string | undefined;
  /** The language document in the editor: a workspace `.jai` file or an opened library preview. */
  function languageDocument(): LanguageDocument | undefined {
    if (viewing)
      return preview?.kind === 'library' && preview.path === viewing
        ? { uri: preview.uri, version: 1, readonly: true }
        : undefined;
    const selected = workspace.selected;
    if (!selected || !isFormattable(selected.path.name)) return undefined;
    return {
      uri: documentUri(selected.path.name),
      version: selected.version,
    };
  }
  function syncedClient() {
    if (!languageDocument()) return undefined;
    clearTimeout(syncTimer);
    language?.sync(workspace.documents);
    return language;
  }
  /*
   * A `.jai` file the pointer rests on in the tree gets its semantic tokens
   * and inlay hints ahead of time, stored as its editor state, so they don't
   * pop in after the click. Files with a state (opened before) keep theirs.
   */
  const prefetching = new Set<string>();
  async function prefetch(path: string) {
    const file = workspace.documents.find((d) => d.path === path);
    if (
      !file ||
      !language ||
      !isFormattable(path) ||
      states.has(path) ||
      prefetching.has(path)
    )
      return;
    prefetching.add(path);
    try {
      language.sync(workspace.documents);
      const state = await prefetchDecorations(
        editor.createState(file.text, path),
        language,
        languageCapabilities,
        documentUri(path),
        signal
      );
      const now = workspace.documents.find((d) => d.path === path);
      if (!signal.aborted && now?.version === file.version && !states.has(path))
        states.set(path, state);
    } catch {
      /* Unsupported or cancelled: the file decorates itself once shown. */
    } finally {
      prefetching.delete(path);
    }
  }
  const can = (name: keyof ServerCapabilities) =>
    Boolean(language && provides(languageCapabilities, name));
  /** A key binding that only applies when the server has `name`. */
  const when =
    (name: keyof ServerCapabilities, action: (view: EditorView) => unknown) =>
    (view: EditorView) => {
      if (!can(name)) return false;
      void action(view);
      return true;
    };
  /** The workspace file under the cursor, for requests that need one. */
  const selectedPath = () =>
    !viewing && language ? workspace.selected?.path.name : undefined;

  /*
   * Diagnostics by URI, kept so a tab shows its squiggles again when it is
   * reopened, and so code action requests can send the ones they touch.
   */
  const published = new Map<string, Published>();
  /** The selected file's diagnostics, if they are for its current text. */
  function currentDiagnostics(): Published | undefined {
    const selected = workspace.selected;
    if (viewing || !selected) return undefined;
    const entry = published.get(documentUri(selected.path.name));
    return entry?.version === selected.version ? entry : undefined;
  }
  /** `context.diagnostics` for a code action request over `range` of the selected file. */
  const diagnosticsFor = (range: Range) =>
    diagnosticsAt(currentDiagnostics()?.diagnostics ?? [], range);
  /** How many lints in `entry` have a quick fix. */
  const fixableCount = (entry: Published | undefined) =>
    entry?.fixes
      ? [...entry.fixes.values()].filter((fixes) => fixes.length).length
      : 0;
  function showDiagnostics() {
    const selected = workspace.selected;
    const entry = currentDiagnostics();
    if (!selected || !entry) {
      editor.diagnostics([], selected?.text ?? '');
      return;
    }
    const fixable = fixableCount(entry);
    editor.diagnostics(entry.diagnostics, selected.text, (diagnostic) => {
      const rule = lintRule(diagnostic);
      const fixes = entry.fixes?.get(diagnostic);
      if (!rule || !fixes?.length) return undefined;
      const actions: LintAction[] = fixes.map((fix) => ({
        name: fixes.length === 1 ? 'Fix' : `Fix: ${fixLabel(fix)}`,
        apply: (_view, from, to) =>
          void applyLintFix(rule, fix.title, from, to),
      }));
      if (fixable > 1)
        actions.push({
          name: `Fix all (${fixable})`,
          apply: () => void fixAllLints(),
        });
      return actions;
    });
  }
  /** Finds which lints of `entry` have quick fixes, then shows their Fix buttons. */
  async function loadFixes(uri: string, entry: Published) {
    const client = language;
    if (!client || !can('codeActionProvider')) return;
    const lints = entry.diagnostics
      .filter((diagnostic) => lintRule(diagnostic))
      .slice(0, MAX_LINT_FIXES);
    if (!lints.length) return;
    const fixes = new Map<Diagnostic, CodeAction[]>();
    try {
      await Promise.all(
        lints.map(async (diagnostic) => {
          const actions = await client.request<CodeAction[] | null>(
            'textDocument/codeAction',
            {
              textDocument: { uri },
              range: diagnostic.range,
              context: { diagnostics: [diagnostic], only: [QUICKFIX] },
            },
            signal
          );
          fixes.set(diagnostic, fixesFor(actions, lintRule(diagnostic)!));
        })
      );
    } catch {
      return;
    }
    // A newer publish (an edit) replaced this entry: its own lookup follows.
    if (signal.aborted || published.get(uri) !== entry) return;
    entry.fixes = fixes;
    if (currentDiagnostics() === entry) showDiagnostics();
  }
  /**
   * Applies a code action's edit computed against `documents`. An edit of
   * only the file on screen goes through the editor, as one undo step that
   * keeps the scroll position; anything else updates the workspace.
   */
  function applyEdit(
    documents: readonly WorkspaceDocument[],
    edit: WorkspaceEdit
  ) {
    if (!sameWorkspace(documents, workspace.documents))
      throw new Error('Edit is stale; no files were changed.');
    const updates = planWorkspaceEdit(documents, edit);
    const [only] = updates;
    if (
      updates.length === 1 &&
      !viewing &&
      only.path === workspace.selected?.path.name &&
      editor.view.state.doc.toString() === workspace.selected.text
    ) {
      editor.view.dispatch({ changes: only.changes, userEvent: 'input.fix' });
      return;
    }
    saveState();
    applied(applyWorkspaceEdit(workspace, documents, edit));
  }
  /**
   * A lint's Fix button. The fix is asked for again at the lint's current
   * range, so it always applies to the text on screen; `title` picks the
   * same fix when a range has several.
   */
  async function applyLintFix(
    rule: string,
    title: string,
    from: number,
    to: number
  ) {
    const path = selectedPath();
    if (!path || !language) return;
    const documents = workspace.documents;
    const document = documents.find((item) => item.path === path);
    if (!document) return;
    language.sync(documents);
    try {
      const range = {
        start: positionAt(document.text, from),
        end: positionAt(document.text, to),
      };
      const actions = await language.request<CodeAction[] | null>(
        'textDocument/codeAction',
        {
          textDocument: { uri: documentUri(path) },
          range,
          context: { diagnostics: diagnosticsFor(range), only: [QUICKFIX] },
        },
        signal
      );
      if (signal.aborted) return;
      const fixes = fixesFor(actions, rule);
      const fix = fixes.find((item) => item.title === title) ?? fixes[0];
      if (!fix?.edit) {
        announce('This lint has no automatic fix now');
        return;
      }
      applyEdit(documents, fix.edit);
      editor.focus();
      announce(`Fixed ${rule}`);
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }
  /**
   * Applies every lint fix in the selected file as one edit (one undo).
   * jailint has no `source.fixAll` action, so this asks for the code actions
   * of the whole file and merges its quick fixes; fixes that overlap an
   * earlier one wait for the next run.
   */
  async function fixAllLints() {
    const path = selectedPath();
    if (!path || !language) return;
    const documents = workspace.documents;
    const document = documents.find((item) => item.path === path);
    if (!document) return;
    language.sync(documents);
    try {
      const range = {
        start: { line: 0, character: 0 },
        end: positionAt(document.text, document.text.length),
      };
      const actions = await language.request<CodeAction[] | null>(
        'textDocument/codeAction',
        {
          textDocument: { uri: documentUri(path) },
          range,
          context: { diagnostics: diagnosticsFor(range), only: [QUICKFIX] },
        },
        signal
      );
      if (signal.aborted) return;
      const { edit, applied: count, skipped } = combineFixes(actions);
      if (!count) {
        announce('No lints to fix in this file');
        return;
      }
      applyEdit(documents, edit);
      editor.focus();
      announce(
        `Fixed ${count} lint${count === 1 ? '' : 's'}` +
          (skipped ? `; ${skipped} overlapping, run Fix all again` : '')
      );
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }

  const editor = createEditor(find('editor'), {
    text: workspace.selected?.text ?? '',
    language: 'jai',
    canDefine: () => can('definitionProvider'),
    canRename: () => can('renameProvider') && !viewing,
    onDefinition: (offset) => goTo(offset, 'textDocument/definition'),
    onPrepareRename: async (offset) => {
      const path = selectedPath();
      const provider = languageCapabilities?.renameProvider;
      if (!path || !language) return undefined;
      const word = editor.view.state.wordAt(offset);
      // Without prepareProvider the word under the cursor is the name.
      if (
        typeof provider !== 'object' ||
        !provider ||
        !('prepareProvider' in provider)
      )
        return word ?? undefined;
      try {
        const range = await prepareRename(
          language,
          workspace,
          path,
          offset,
          signal
        );
        if (!range) announce("This name can't be renamed");
        return range;
      } catch (error) {
        if (!signal.aborted) announce(errorMessage(error));
        return undefined;
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
        applied(updates);
        if (updates.length)
          announce(
            `Renamed in ${updates.length} file${updates.length === 1 ? '' : 's'}`
          );
      } catch (error) {
        if (!signal.aborted) showError(errorMessage(error));
        throw error;
      }
    },
    currentDocument: languageDocument,
    service: syncedClient,
    serverFormatHover: () => can('inlayHintProvider'),
    extensions: languageFeatures({
      document: languageDocument,
      client: syncedClient,
      capabilities: () => (language ? languageCapabilities : undefined),
      modifier: (event) => (mac() ? event.metaKey : event.ctrlKey),
      openLink: (target) => void openUri(target),
      runLens: (view, lens, pos) => void runCommand(view, lens.command, pos),
      codeActions: (view) => void codeActions(view),
      diagnosticsAt: diagnosticsFor,
    }),
    keys: [
      { key: 'Shift-F12', run: when('referencesProvider', references) },
      {
        key: 'Mod-F12',
        run: when('typeDefinitionProvider', (view) =>
          goTo(view.state.selection.main.head, 'textDocument/typeDefinition')
        ),
      },
      { key: 'Mod-.', run: when('codeActionProvider', codeActions) },
      { key: 'Mod-p', run: when('workspaceSymbolProvider', symbolSearch) },
    ],
    onChange: (text) => {
      if (workspace.selected) workspace.edit(text);
      markdown.changed();
      if (ready) runner.changed();
      else editedDuringBoot = true;
      editor.diagnostics([], text);
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => language?.sync(workspace.documents), 120);
    },
  });

  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
    editor.view.scrollDOM.addEventListener(
      type,
      () => (scrollOwner = tabs.active),
      { passive: true, signal }
    );
  // Hidden panes (phone layouts) report no size and are left alone.
  editor.view.scrollDOM.addEventListener(
    'scroll',
    () => {
      const tab = tabs.active;
      if (tab && tab === scrollOwner && editor.view.scrollDOM.clientHeight)
        scrolls.set(tabKey(tab), editor.view.scrollSnapshot());
    },
    { passive: true, signal }
  );
  /** Updates editor states after workspace edits (rename, code actions). */
  function applied(updates: PlannedEdit[]) {
    for (const update of updates) {
      const previous = states.get(update.path);
      const state = previous
        ? previous.update({ changes: update.changes }).state
        : editor.createState(update.text, update.path);
      states.set(update.path, state);
    }
    show();
    language?.sync(workspace.documents);
    runner.changed();
  }

  /** Shows a navigation target: a workspace file's tab or the read-only preview tab. */
  function reveal(target: NavigationTarget, title?: string) {
    saveState();
    if (target.text === undefined) tabs.open(target.path);
    else
      openPreview({
        path: target.path,
        uri: target.resource.uri,
        text: target.text,
        kind: target.resource.kind === 'expansion' ? 'expansion' : 'library',
        title,
      });
    show();
    // Centre the target, as editors do for go to definition, rather than scrolling it just into view.
    editor.view.dispatch({
      selection: { anchor: target.from, head: target.to },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
    showPane(panel, 'code');
    editor.focus();
  }
  function openPreview(next: Preview) {
    if (preview && preview.uri !== next.uri && preview.kind === 'library')
      language?.closeReadonly(preview.uri);
    preview = next;
    if (next.kind === 'library') language?.openReadonly(next.uri, next.text);
    tabs.preview(next.path);
  }
  function closePreview() {
    if (preview?.kind === 'library') language?.closeReadonly(preview.uri);
    preview = undefined;
  }

  /** The request position: the cursor in a workspace file or the library preview. */
  function requestOrigin(offset: number) {
    const document = languageDocument();
    if (!document || !language) return undefined;
    return {
      document,
      params: {
        textDocument: { uri: document.uri },
        position: positionAt(editor.view.state.doc.toString(), offset),
      },
    };
  }

  /** Definition or type definition, from a workspace file or a library preview. */
  async function goTo(offset: number, method: string) {
    if (!language || signal.aborted) return;
    const path = selectedPath();
    try {
      let target: NavigationTarget | undefined;
      if (path)
        target = await definitionTarget(
          language,
          workspace,
          path,
          offset,
          signal,
          method
        );
      else {
        const origin = requestOrigin(offset);
        if (!origin) return;
        const result = await language.request<unknown>(
          method,
          origin.params,
          signal
        );
        const [location] = normalizeLocations(result);
        if (location && languageDocument()?.uri === origin.document.uri)
          target = await resolveLocation(
            language,
            workspace.documents,
            location.uri,
            location.range,
            signal
          );
      }
      if (signal.aborted) return;
      if (!target) {
        announce(
          method === 'textDocument/typeDefinition'
            ? 'No type definition found'
            : 'No definition found'
        );
        return;
      }
      reveal(target);
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }

  /** Opens a link or symbol URI at `range` (the start of the file without one). */
  async function openUri(uri: string, range?: Range, title?: string) {
    if (!language || signal.aborted) return;
    try {
      const target = await resolveLocation(
        language,
        workspace.documents,
        uri,
        range,
        signal
      );
      if (signal.aborted) return;
      if (target) reveal(target, title);
      else announce('That file is not available here');
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }

  const pickerAt = (view: EditorView, pos: number) => {
    const coords = view.coordsAtPos(pos);
    return coords
      ? { left: coords.left, top: coords.top, bottom: coords.bottom }
      : undefined;
  };
  const picker = (
    view: EditorView,
    options: Parameters<typeof showPicker>[1]
  ) => {
    // A hover left open would sit on top of the list.
    view.dispatch({ effects: closeHoverTooltips });
    return showPicker(view.dom, { closed: () => view.focus(), ...options });
  };
  /** A location's file for lists: the workspace path, or `stdlib/...` for library files. */
  const displayPath = (uri: string) => resourceFromUri(uri)?.path ?? uri;

  /** Lists locations; picking one opens it. */
  function locationItems(
    locations: { uri: string; range: Range }[],
    documents: readonly { path: string; text: string }[]
  ): PickerItem[] {
    return locations.map(({ uri, range }) => {
      const path = pathFromUri(uri);
      const text = documents.find((item) => item.path === path)?.text;
      const line = text?.split('\n')[range.start.line]?.trim();
      return {
        label: locationLabel(displayPath(uri), range.start.line),
        preview: line,
        run: () => void openUri(uri, range),
      };
    });
  }

  async function references(view: EditorView) {
    const path = selectedPath();
    if (!path || !language) return;
    const offset = view.state.selection.main.head;
    try {
      const { result, documents } = await positionRequest<unknown>(
        language,
        workspace,
        'textDocument/references',
        path,
        offset,
        { context: { includeDeclaration: true } },
        signal
      );
      const locations = normalizeLocations(result);
      const word = view.state.wordAt(offset);
      const name = word ? view.state.sliceDoc(word.from, word.to) : 'symbol';
      if (!locations.length) {
        announce(`No references to ${name}`);
        return;
      }
      picker(view, {
        title: `${locations.length} reference${locations.length === 1 ? '' : 's'} to ${name}`,
        items: locationItems(locations, documents),
        at: pickerAt(view, offset),
      });
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }

  /** Runs a server command; lists string results, opens an expansion. */
  async function runCommand(
    view: EditorView,
    command: Command | undefined,
    pos: number
  ) {
    if (!command || !language) return;
    if (!supportsCommand(languageCapabilities, command.command)) return;
    try {
      const result = await language.request<unknown>(
        'workspace/executeCommand',
        { command: command.command, arguments: command.arguments ?? [] },
        signal
      );
      if (signal.aborted) return;
      if (Array.isArray(result)) {
        picker(view, {
          title: command.title,
          items: result.map((item) => ({ label: String(item) })),
          at: pickerAt(view, pos),
          empty: 'No instances yet',
        });
      } else if (result && typeof result === 'object' && 'uri' in result)
        void showExpansion(result as Expansion);
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }

  async function showExpansion(expansion: Expansion) {
    if (!language) return;
    let text = typeof expansion.text === 'string' ? expansion.text : undefined;
    text ??=
      (await language.request<string | null>(
        'jai/source',
        { uri: expansion.uri },
        signal
      )) ?? undefined;
    if (signal.aborted || text === undefined) return;
    const target = await resolveLocation(
      language,
      workspace.documents,
      expansion.uri,
      undefined,
      signal
    ).catch(() => undefined);
    const path = target?.path ?? 'expansion';
    reveal(
      {
        resource: target?.resource ?? {
          kind: 'expansion',
          path,
          source: '',
          uri: expansion.uri,
        },
        path,
        from: 0,
        to: 0,
        text,
      },
      `Expansion of ${expansion.kind === 'macro' ? 'a macro call' : `#${expansion.kind ?? 'code'}`} at ${path}`
    );
  }

  async function codeActions(view: EditorView) {
    const path = selectedPath();
    if (!path || !language) return;
    const documents = workspace.documents;
    const document = documents.find((item) => item.path === path);
    if (!document) return;
    const { from, to, head } = view.state.selection.main;
    language.sync(documents);
    try {
      const range = {
        start: positionAt(document.text, from),
        end: positionAt(document.text, to),
      };
      const actions = await language.request<CodeAction[] | null>(
        'textDocument/codeAction',
        {
          textDocument: { uri: documentUri(path) },
          range,
          context: { diagnostics: diagnosticsFor(range) },
        },
        signal
      );
      if (signal.aborted) return;
      const fixable = fixableCount(currentDiagnostics());
      if (!actions?.length && !fixable) {
        announce('No code actions here');
        return;
      }
      const items: PickerItem[] = (actions ?? []).map((action) => ({
        label: action.title,
        detail:
          action.kind === QUICKFIX
            ? 'quick fix'
            : action.kind === 'refactor.inline'
              ? 'inline'
              : undefined,
        run: () => {
          try {
            if (action.edit) applyEdit(documents, action.edit);
            if (action.command) void runCommand(view, action.command, head);
          } catch (error) {
            showError(errorMessage(error));
          }
        },
      }));
      if (fixable > 1)
        items.push({
          label: `Fix all lints in this file`,
          detail: `${fixable} fixable`,
          run: () => void fixAllLints(),
        });
      picker(view, {
        title: 'Code actions',
        at: pickerAt(view, head),
        items,
      });
    } catch (error) {
      if (!signal.aborted) showError(errorMessage(error));
    }
  }

  function symbolSearch(view: EditorView) {
    if (!language) return;
    const client = language;
    picker(view, {
      title: 'Go to symbol in workspace',
      placeholder: 'Symbol name',
      empty: 'No matching symbols',
      search: async (query) => {
        client.sync(workspace.documents);
        const symbols = await client.request<SymbolInformation[] | null>(
          'workspace/symbol',
          { query },
          signal
        );
        return (symbols ?? []).slice(0, 200).map((symbol) => {
          const path = displayPath(symbol.location.uri);
          return {
            label: symbol.name,
            detail: [
              symbolKinds[symbol.kind],
              locationLabel(path, symbol.location.range.start.line),
            ]
              .filter(Boolean)
              .join(' · '),
            run: () => void openUri(symbol.location.uri, symbol.location.range),
          };
        });
      },
    });
  }

  // Rendered view of `.md` files beside (or instead of) the source.
  const markdown = createMarkdownPreview(
    panel,
    editor.view,
    {
      files: () => workspace.names,
      open: (path) => {
        saveState();
        tabs.open(path);
        show();
      },
    },
    signal
  );

  let filesBefore = new Set<string>();
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
        preview.state ??
          editor.createState(
            preview.text,
            // Expansions are Jai, though their tab names a source position.
            preview.kind === 'expansion' ? 'expansion.jai' : tab.path
          )
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
      showDiagnostics();
    }
    const open = Boolean(workspace.selected || viewing);
    editorHost.hidden = !open;
    if (empty) empty.hidden = open;
    forgetClosedScrolls();
    scrollOwner = undefined;
    const scroll = tab && scrolls.get(tabKey(tab));
    if (scroll) editor.view.dispatch({ effects: scroll });
    else editor.view.scrollDOM.scrollTo(0, 0);
    markdown.show(viewing ?? workspace.selected?.path.name);
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
        const expansion =
          tab.preview &&
          preview?.path === tab.path &&
          preview.kind === 'expansion'
            ? preview
            : undefined;
        button.title = expansion
          ? `${expansion.title ?? tab.path} (read-only)`
          : tab.preview
            ? `${tab.path} (read-only)`
            : tab.path;
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
          fileIcon(
            fileIconKind(expansion ? 'expansion.jai' : tab.path),
            'ide-filetab-icon'
          ),
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
    closePicker();
    saveState();
    tabs.activate(tab);
    show();
  }
  function closeTab(tab: OpenTab) {
    const hadFocus = tabStrip?.contains(document.activeElement) ?? false;
    closePicker();
    if (tab !== tabs.active) {
      tabs.close(tab);
      if (tab.preview) closePreview();
      forgetClosedScrolls();
      renderTabs();
    } else {
      saveState();
      tabs.close(tab);
      if (tab.preview) closePreview();
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
      intent: (path) => void prefetch(path),
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
  const names = new Set(workspace.names);
  const opening = starter.open.filter((path) => names.has(path));
  for (const path of opening) tabs.open(path);
  // The first starter tab (main.jai) is active unless a link asks for another file.
  if (requested && names.has(requested)) tabs.open(requested);
  else if (opening[0]) tabs.open(opening[0]);
  show();
  const driverLoaded = loadDriver();
  const runtime = await initializeWorker();
  connect(runtime.worker);
  if (runtime.capabilities.languageServer) {
    const server = await initializeWorker();
    const client = new LanguageClient(server.worker, {
      diagnostics: (params) => {
        if (
          pathFromUri(params.uri) === undefined ||
          !Number.isInteger(params.version) ||
          !Array.isArray(params.diagnostics)
        )
          return;
        const entry: Published = {
          version: params.version!,
          diagnostics: params.diagnostics,
        };
        published.set(params.uri, entry);
        if (currentDiagnostics() === entry) showDiagnostics();
        void loadFixes(params.uri, entry);
      },
      failure: () => {
        language = undefined;
      },
    });
    language = client;
    const initialized = await client.initialize();
    languageCapabilities = initialized?.capabilities;
    client.sync(workspace.documents);
    // Decorations (tokens, hints, links, ...) start once the server is up.
    if (!signal.aborted)
      editor.view.dispatch({ effects: refreshLanguage.of(null) });
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
