import {
  Annotation,
  EditorSelection,
  Transaction,
  type ChangeSpec,
  type EditorState,
  type StateEffect,
} from '@codemirror/state';
import { createAutoRunner, type AutoRunner } from '../code-auto-run.ts';
import { createEditor, type Editor } from '../code-editor.ts';
import { createRunSummary } from './run-summary.ts';
import { Shell } from './terminal-shell.ts';
import { createTerminal, type JaiTerminal } from './terminal.ts';
import {
  isNarrow,
  NARROW_QUERY,
  showPane,
  trackDrag,
  workspaceLayout,
  type DropTarget,
} from '../code-workspace-layout.ts';
import { workspaceChromeFor } from '../workspace-chrome.ts';
import {
  emptyGroup,
  groupDropZone,
  groupsOf,
  insertionIndex,
  MAX_GROUPS,
  neighbourGroup,
  nextGroupId,
  removeGroup,
  splitGroup,
  updateGroup,
  viewGroup,
  viewPlacement,
  SPLIT_MIN_WIDTH,
  type TabPlace,
  type DropZone,
  type EditorNode,
  type SplitSide,
} from '../workspace-layout-model.ts';
import { Workspace, type WorkspaceDocument } from './workspace.ts';
import { defaultStarter, loadStarter, type Starter } from './starter.ts';
import { confirmDialog, pickFolder, readFolder } from '../workspace-actions.ts';
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
import {
  closeHoverTooltips,
  EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import {
  OpenTabs,
  sameTab,
  tabLabel,
  VIEW_LABELS,
  type OpenTab,
} from './open-tabs.ts';
import { NavHistory, type NavLocation, type NavOp } from './nav-history.ts';
import { watchNavigationInput, type NavDirection } from './nav-input.ts';
import { fileIcon, fileIconKind } from './file-icons.ts';
import { createRenderPane } from './render-pane.ts';
import {
  createMarkdownPreview,
  type MarkdownPreview,
} from '../markdown-preview.ts';
import {
  isMarkdownPath,
  markdownView,
  parseViewChoice,
  type MarkdownView,
} from '../markdown-render.ts';
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
import { BUILD_METADATA_ASSET, JAIFMT_WASM_ASSET } from './jaifmt-wasm.ts';
import {
  FIX_ALL,
  QUICKFIX,
  combineFixes,
  diagnosticsAt,
  fixAllAction,
  fixLabel,
  fixesFor,
  lintRule,
  offersFixAll,
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

/**
 * Interpreter budget in basic blocks; runaway programs fail instead of
 * hanging. The interpreter refills it whenever a program waits for the page
 * (a WebGPU frame, `webgpu_present`), so it bounds a whole run for ordinary
 * programs and one frame for drawing ones. The same figure suits both: at
 * the interpreter's speed it is several seconds of work, far beyond any
 * frame worth drawing, so a frame loop that never yields still fails in
 * seconds, while ordinary programs keep the room they always had.
 */
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
  capabilities: Extract<
    WorkerResponse,
    { type: 'init'; error?: undefined }
  >['capabilities'];
}

const abortError = () => new DOMException('Closed', 'AbortError');
const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1);

const mac = () => /Mac|iPhone|iPad/u.test(navigator.platform);

/** A cursor move by pointer or search this many lines away is a navigation. */
const JUMP_LINES = 10;

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
  /** The group whose editor made `state` (a state carries its editor's extensions). */
  stateGroup?: string;
}

/** A place in the navigation history (Go Back / Go Forward). */
interface Place extends NavLocation {
  /** The editor group it was in; restoring focuses it again while it exists. */
  group?: string;
  anchor: number;
  head: number;
  /** The document position at the top of the editor's viewport. */
  top: number;
  /** The exact scroll position, valid while the document keeps `length`. */
  scroll?: StateEffect<unknown>;
  length?: number;
  /** For a read-only entry: the preview to show again. */
  view?: Preview;
}

/** The browser history state of the full-page playground's entries. */
interface NavState {
  session: string;
  id: number;
}
const navState = (state: unknown): NavState | undefined => {
  const value = (state as { jaiNav?: NavState } | null)?.jaiNav;
  return typeof value?.session === 'string' && Number.isInteger(value.id)
    ? value
    : undefined;
};
/** Marks the copies of an edit that keep other groups' editors in step. */
const mirrored = Annotation.define<boolean>();
/** Annotations for such a copy: no undo step of its own in the receiving editor. */
const mirroredEdit = [mirrored.of(true), Transaction.addToHistory.of(false)];

/** The one change that turns `before` into `after` (common ends kept). */
function replacement(before: string, after: string): ChangeSpec {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < limit - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

/** Where the phone layout keeps its Source / Preview choice for `.md` tabs. */
const MARKDOWN_VIEW_KEY = 'code-editor-markdown-view';

/**
 * One editor group: a tab strip and an editor (plus a Markdown preview) in
 * the editor area. Every group has its own tabs, editor states and scroll
 * positions; the workspace text is shared, so two groups showing one file
 * stay in step (`edited`).
 */
interface Group {
  id: string;
  element: HTMLElement;
  strip: HTMLElement;
  actions: HTMLElement;
  host: HTMLElement;
  empty: HTMLElement;
  tabs: OpenTabs;
  editor: Editor;
  markdown: MarkdownPreview;
  /** Saved editor state of each file tab that is not on screen. */
  states: Map<string, EditorState>;
  /** Scroll position of each open tab; a tab opened afresh starts at the top. */
  scrolls: Map<string, StateEffect<unknown>>;
  /** The tab the reader has scrolled since it was shown (see `show`). */
  scrollOwner?: OpenTab;
  /** Path of the read-only file in the preview tab while it is shown. */
  viewing?: string;
  /** The workspace file in the editor, if a file tab is active. */
  file?: string;
  /** Ends the group's listeners when it closes. */
  life: AbortController;
}

/** Where a dragged tab or tree file lands. */
interface TabDrop {
  group: string;
  zone: DropZone;
  /** Position in the tab strip, for drops on the strip. */
  index?: number;
}

/** `#lib/math.jai`: the deep link the playground page reads on load. */
const fileHash = (path: string) =>
  '#' + path.split('/').map(encodeURIComponent).join('/');

export async function createSession(
  panel: HTMLElement,
  revision: string,
  signal: AbortSignal,
  /** The workspace to start with (Import folder and Reset restart the session with one). */
  initial?: Starter
) {
  const find = <T extends HTMLElement = HTMLElement>(name: string) =>
    panel.querySelector<T>(`[data-code-${name}]`)!;
  const summary = createRunSummary(panel);
  const formatButton =
    panel.querySelector<HTMLButtonElement>('[data-code-format]');
  // Run / Stop and the status line are Svelte state (CodeWorkspace.svelte).
  const chrome = workspaceChromeFor(panel);
  if (!chrome) throw new Error('The workspace has not mounted');
  // The server-rendered group is the first group; later ones are copies of it.
  const template = find('group');
  const blank = template.cloneNode(true) as HTMLElement;
  const layout = workspaceLayout(panel);
  // The compiler release's tour (or the built-in starter for older releases).
  const starter = initial ?? (await loadStarter(revision, signal));
  if (signal.aborted) throw abortError();
  const workspace = new Workspace(starter.files);
  /*
   * Editor groups by id. `group` is the focused one (the last clicked or
   * focused), and `editor` and `tabs` are its parts:
   * Format, Run, go to definition and the tree all act on it.
   */
  const groups = new Map<string, Group>();
  let group!: Group;
  let editor!: Editor;
  let tabs!: OpenTabs;
  /** Groups in the order they were focused, most recent last. */
  let focusOrder: Group[] = [];
  /** The split tree when no layout controller keeps it. */
  let ownTree: EditorNode = emptyGroup();
  const editorTree = () => layout?.layout.editors ?? ownTree;
  // `preview` holds the read-only file in the (single) preview tab.
  let preview: Preview | undefined;
  const tabKey = (tab: OpenTab) =>
    (tab.view ? '@' : tab.preview ? '~' : tab.markdown ? '#' : '') + tab.path;
  /** A file's text in the workspace (the truth every group's editor follows). */
  const fileText = (path: string) =>
    workspace.documents.find((document) => document.path === path)?.text;
  let phoneChoice: MarkdownView | undefined = (() => {
    try {
      return parseViewChoice(localStorage.getItem(MARKDOWN_VIEW_KEY));
    } catch {
      return undefined;
    }
  })();
  /** How a `.md` source tab shows on phones: its source, or rendered in place. */
  const phoneView = (path: string) =>
    markdownView(phoneChoice, !fileText(path)?.length);
  // Go Back / Go Forward; see nav-history.ts and docs/code-workspace.md.
  const nav = new NavHistory<Place>();
  // Set while an entry is being restored, so the restore records nothing.
  let restoring = false;
  /*
   * The scroll position as of the last scroll, click or search key: a jump
   * may scroll the view before the update listener sees it, so the place it
   * left is read from here.
   */
  let settled: ReturnType<typeof viewport> | undefined;
  function forgetClosedScrolls(g: Group = group) {
    const open = new Set(g.tabs.tabs.map(tabKey));
    for (const key of g.scrolls.keys())
      if (!open.has(key)) g.scrolls.delete(key);
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
  // jaifmt.wasm compiled in its own worker, when this browser can run it.
  let jaifmtWorker: Worker | undefined;
  let driver: string | undefined;
  // Settled without a usable driver: the button hides instead of staying disabled.
  let driverMissing = false;
  let formatter: Promise<Worker> | undefined;
  let formatting = false;
  let formatJob = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  /*
   * The output pane is a terminal (terminal.ts) with a mini shell on it
   * (terminal-shell.ts). xterm loads while the compiler boots; errors that
   * arrive before it is up wait in `early`.
   */
  const plainOutput = find('output');
  const terminalHost = find('terminal');
  plainOutput.hidden = true;
  terminalHost.hidden = false;
  let terminal: JaiTerminal | undefined;
  let shell: Shell | undefined;
  const early: string[] = [];
  // What stops the run being killed: an edit (another run follows), Stop, or Ctrl+C.
  let stopCause: 'edit' | 'stop' | 'interrupt' = 'edit';
  // The run was asked for (Run, Ctrl+Enter, a typed command), not started by an edit.
  let explicit = false;
  // The current run was asked for (see `explicit`).
  let runAsked = false;
  // Whether the compiler build passes arguments and standard input to programs.
  let programIo = true;
  const showError = (message: string) =>
    shell ? shell.error(message) : early.push(message);
  const terminalReady = createTerminal(terminalHost, signal).then((created) => {
    terminal = created;
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {
      /* Blocked storage: the history lasts for this page. */
    }
    const made = new Shell(
      created,
      {
        run: () => {
          explicit = true;
          showPane(panel, 'output');
          void runner.play();
        },
        interrupt: () => {
          stopCause = 'interrupt';
          runner.pause();
        },
        input: (text) => {
          if (execution) post(execution, { type: 'stdin', text });
        },
      },
      {
        storage,
        key: `jai-terminal-history:${panel.dataset.codeLanguage ?? 'jai'}`,
      }
    );
    shell = made;
    created.onData((data) => made.data(data));
    for (const message of early.splice(0)) made.error(message);
    made.prompt();
  });
  // Surfaces when the session awaits it; an aborted session needs no report.
  terminalReady.catch(() => {});
  panel.addEventListener(
    'code-output-clear',
    (event) => {
      event.preventDefault();
      shell?.clearScreen();
      summary.clear();
    },
    { signal }
  );
  // Function declarations below are hoisted; the runner only calls them later.
  const runner: AutoRunner = createAutoRunner(execute, cancelExecution);

  /** The language document in a group's editor: a workspace `.jai` file or an opened library preview. */
  function languageDocument(g: Group = group): LanguageDocument | undefined {
    if (g.viewing)
      return preview?.kind === 'library' && preview.path === g.viewing
        ? { uri: preview.uri, version: 1, readonly: true }
        : undefined;
    const path = g.file;
    if (!path || !isFormattable(path)) return undefined;
    const file = workspace.documents.find((item) => item.path === path);
    return file && { uri: documentUri(path), version: file.version };
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
    // The focused group's editor makes the state, and that group keeps it.
    const g = group;
    const file = workspace.documents.find((d) => d.path === path);
    if (
      !file ||
      !language ||
      !isFormattable(path) ||
      g.states.has(path) ||
      prefetching.has(path)
    )
      return;
    prefetching.add(path);
    try {
      language.sync(workspace.documents);
      const state = await prefetchDecorations(
        g.editor.createState(file.text, path),
        language,
        languageCapabilities,
        documentUri(path),
        signal
      );
      const now = workspace.documents.find((d) => d.path === path);
      if (
        !signal.aborted &&
        now?.version === file.version &&
        !g.states.has(path)
      )
        g.states.set(path, state);
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
    !group.viewing && language ? workspace.selected?.path.name : undefined;

  /*
   * Diagnostics by URI, kept so a tab shows its squiggles again when it is
   * reopened, and so code action requests can send the ones they touch.
   */
  const published = new Map<string, Published>();
  /** The diagnostics of a group's file, if they are for its current text. */
  function currentDiagnostics(g: Group = group): Published | undefined {
    if (g.viewing || !g.file) return undefined;
    const path = g.file;
    const file = workspace.documents.find((item) => item.path === path);
    const entry = published.get(documentUri(path));
    return file && entry?.version === file.version ? entry : undefined;
  }
  /** `context.diagnostics` for a code action request over `range` of a group's file. */
  const diagnosticsFor = (range: Range, g: Group = group) =>
    diagnosticsAt(currentDiagnostics(g)?.diagnostics ?? [], range);
  /** Shows `entry` in every group whose file it belongs to. */
  function showPublished(entry: Published) {
    for (const g of groups.values())
      if (currentDiagnostics(g) === entry) showDiagnostics(g);
  }
  /** How many lints in `entry` have a quick fix. */
  const fixableCount = (entry: Published | undefined) =>
    entry?.fixes
      ? [...entry.fixes.values()].filter((fixes) => fixes.length).length
      : 0;
  function showDiagnostics(g: Group = group) {
    const text = g.file === undefined ? undefined : fileText(g.file);
    const entry = currentDiagnostics(g);
    if (text === undefined || !entry) {
      g.editor.diagnostics([], text ?? '');
      return;
    }
    const fixable = fixableCount(entry);
    g.editor.diagnostics(entry.diagnostics, text, (diagnostic) => {
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
    showPublished(entry);
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
      !group.viewing &&
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
   * Applies every lint fix in the selected file as one edit (one undo): the
   * server's `source.fixAll.jailint` action, or, from a server without it,
   * the file's quick fixes merged by `combineFixes`. Fixes that overlap an
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
      // jailint's own fix-all when the server has it; else merge the quick fixes here.
      const serverFixAll = offersFixAll(
        languageCapabilities?.codeActionProvider
      );
      const actions = await language.request<CodeAction[] | null>(
        'textDocument/codeAction',
        {
          textDocument: { uri: documentUri(path) },
          range,
          context: {
            diagnostics: diagnosticsFor(range),
            only: [serverFixAll ? FIX_ALL : QUICKFIX],
          },
        },
        signal
      );
      if (signal.aborted) return;
      const fixable = fixableCount(currentDiagnostics());
      let edit: WorkspaceEdit, count: number, skipped: number;
      if (serverFixAll) {
        const action = fixAllAction(actions);
        // "Fix 3 lint problems": the server leaves out overlapping fixes, as `jailint --fix` does.
        count = action
          ? Number(/\d+/u.exec(action.title)?.[0] ?? fixable) || 1
          : 0;
        skipped = Math.max(0, fixable - count);
        edit = action?.edit ?? {};
      } else ({ edit, applied: count, skipped } = combineFixes(actions));
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

  /** The editor of group `g`; its language features follow that group's file. */
  function createGroupEditor(g: Group) {
    return createEditor(g.host, {
      text: '',
      language: 'jai',
      canDefine: () => can('definitionProvider'),
      canRename: () => can('renameProvider') && !g.viewing,
      onDefinition: (offset) => goTo(offset, 'textDocument/definition'),
      onPrepareRename: async (offset) => {
        const path = selectedPath();
        const provider = languageCapabilities?.renameProvider;
        if (!path || !language) return undefined;
        const word = g.editor.view.state.wordAt(offset);
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
      currentDocument: () => languageDocument(g),
      service: syncedClient,
      serverFormatHover: () => can('inlayHintProvider'),
      extensions: [
        languageFeatures({
          document: () => languageDocument(g),
          client: syncedClient,
          capabilities: () => (language ? languageCapabilities : undefined),
          modifier: (event) => (mac() ? event.metaKey : event.ctrlKey),
          openLink: (target) => void openUri(target),
          runLens: (view, lens, pos) =>
            void runCommand(view, lens.command, pos),
          codeActions: (view) => void codeActions(view),
          diagnosticsAt: (range) => diagnosticsFor(range, g),
        }),
        // A far click or search match is a step back to, as in VS Code.
        EditorView.updateListener.of((update) => {
          if (
            restoring ||
            g !== group ||
            !update.selectionSet ||
            !update.transactions.some(
              (tr) =>
                tr.isUserEvent('select.pointer') ||
                tr.isUserEvent('select.search')
            )
          )
            return;
          const to = here();
          if (!to) return;
          const { anchor, head } = update.startState.selection.main;
          const line = update.startState.doc.lineAt(head).number;
          if (Math.abs(to.line - line) < JUMP_LINES) return;
          // The view may already have scrolled to the new selection.
          const from = { ...to, ...settled, anchor, head, line };
          mirror(nav.navigate(from, to));
        }),
      ],
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
      onChange: (text, update) => edited(g, text, update),
    });
  }

  /**
   * Makes a group. The first uses the server-rendered element; later ones a
   * clean copy of it.
   */
  function createGroup(id: string): Group {
    const element = template.dataset.groupId
      ? (blank.cloneNode(true) as HTMLElement)
      : template;
    element.dataset.groupId = id;
    element.removeAttribute('data-active');
    const life = new AbortController();
    const groupSignal = AbortSignal.any([signal, life.signal]);
    const part = (name: string) =>
      element.querySelector<HTMLElement>(`[data-code-${name}]`)!;
    const g = {
      id,
      element,
      strip: part('tabs'),
      actions: part('group-actions'),
      host: part('editor'),
      empty: part('empty'),
      tabs: new OpenTabs(),
      states: new Map(),
      scrolls: new Map(),
      life,
    } as unknown as Group;
    g.editor = createGroupEditor(g);
    g.markdown = createMarkdownPreview(
      g.host,
      {
        files: () => workspace.names,
        text: fileText,
        open: (path, anchor) => followLink(g, path, anchor),
      },
      groupSignal
    );
    groups.set(id, g);
    const listen = { passive: true, signal: groupSignal };
    const { view } = g.editor;
    // Clicking or focusing anything in a group makes it the focused group.
    element.addEventListener('pointerdown', () => activateGroup(g), {
      capture: true,
      ...listen,
    });
    element.addEventListener('focusin', () => activateGroup(g), listen);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      view.scrollDOM.addEventListener(
        type,
        () => (g.scrollOwner = g.tabs.active),
        listen
      );
    // The place a click or a search key jumps from, read before the editor moves.
    view.dom.addEventListener(
      'pointerdown',
      () => {
        if (g === group) settled = viewport();
      },
      { capture: true, ...listen }
    );
    view.dom.addEventListener(
      'keydown',
      (event) => {
        if (g === group && ['Enter', 'F3', 'g', 'G'].includes(event.key))
          settled = viewport();
      },
      { capture: true, ...listen }
    );
    // Hidden panes (phone layouts) report no size and are left alone.
    view.scrollDOM.addEventListener(
      'scroll',
      () => {
        if (g === group) settled = viewport();
        const tab = g.tabs.active;
        if (tab && tab === g.scrollOwner && view.scrollDOM.clientHeight)
          g.scrolls.set(tabKey(tab), view.scrollSnapshot());
      },
      listen
    );
    g.host.addEventListener(
      'compositionstart',
      runner.compositionStart,
      listen
    );
    g.host.addEventListener('compositionend', runner.compositionEnd, listen);
    wireTabStrip(g, groupSignal);
    return g;
  }

  /** Makes `g` the focused group: the one Format, Run and the tree act on. */
  function activateGroup(g: Group) {
    if (g === group || !groups.has(g.id)) return;
    group?.element.removeAttribute('data-active');
    group = g;
    editor = g.editor;
    tabs = g.tabs;
    settled = undefined;
    focusOrder = [...focusOrder.filter((item) => item !== g), g];
    g.element.setAttribute('data-active', '');
    if (g.file) workspace.select(g.file);
    else workspace.deselect();
    updateFormat();
    tree.render();
  }

  /**
   * An edit in group `g`. The workspace takes the new text, and every other
   * editor on the same file gets the same change (marked `mirrored`, so it is
   * not taken for an edit of its own and adds no undo step there).
   */
  function edited(g: Group, text: string, update: ViewUpdate) {
    if (update.transactions.some((tr) => tr.annotation(mirrored))) return;
    const path = g.file;
    if (!path) return;
    if (g !== group) activateGroup(g);
    workspace.edit(text);
    for (const other of groups.values()) {
      if (other === g) continue;
      if (other.file === path) {
        const { view } = other.editor;
        view.dispatch({
          changes: view.state.doc.eq(update.startState.doc)
            ? update.changes
            : replacement(view.state.doc.toString(), text),
          annotations: mirroredEdit,
        });
        other.editor.diagnostics([], text);
        continue;
      }
      const saved = other.states.get(path);
      if (saved?.doc.eq(update.startState.doc))
        other.states.set(
          path,
          saved.update({ changes: update.changes, annotations: mirroredEdit })
            .state
        );
    }
    for (const other of groups.values())
      if (other.markdown.path === path) other.markdown.changed();
    if (ready) runner.changed();
    else editedDuringBoot = true;
    g.editor.diagnostics([], text);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => language?.sync(workspace.documents), 120);
  }
  /** `state` with its document brought up to the workspace's `text`. */
  function current(state: EditorState, text: string) {
    const doc = state.doc.toString();
    return doc === text
      ? state
      : state.update({
          changes: replacement(doc, text),
          annotations: mirroredEdit,
        }).state;
  }

  /**
   * Carries a tab's editor state (from another group) into group `g`. A
   * state holds its own editor's extensions, so `g` gets a fresh state with
   * the same text and selection; the undo history stays behind.
   */
  function adopt(g: Group, path: string, state: EditorState) {
    const fresh = g.editor.createState(state.doc.toString(), path);
    return fresh.update({ selection: state.selection }).state;
  }

  /** Updates editor states after workspace edits (rename, code actions). */
  function applied(updates: PlannedEdit[]) {
    for (const update of updates)
      for (const g of groups.values()) {
        // Another group showing the file follows on screen.
        if (g !== group && g.file === update.path) {
          const { view } = g.editor;
          view.dispatch({
            changes: replacement(view.state.doc.toString(), update.text),
            annotations: mirroredEdit,
          });
          continue;
        }
        const previous = g.states.get(update.path);
        if (previous)
          g.states.set(
            update.path,
            previous.update({ changes: update.changes }).state
          );
        else if (g === group)
          g.states.set(
            update.path,
            editor.createState(update.text, update.path)
          );
      }
    show();
    language?.sync(workspace.documents);
    runner.changed();
  }

  /** The editor's scroll position, as a history entry keeps it. */
  function viewport() {
    const { view } = editor;
    const height = Math.max(
      0,
      view.scrollDOM.getBoundingClientRect().top - view.documentTop
    );
    return {
      top: view.lineBlockAtHeight(height).from,
      scroll: view.scrollSnapshot(),
      length: view.state.doc.length,
    };
  }
  /** Where the editor is now, for the navigation history; undefined with no tab open. */
  function here(): Place | undefined {
    const tab = tabs.active;
    if (
      !tab ||
      tab.markdown ||
      tab.view ||
      (tab.preview && preview?.path !== tab.path)
    )
      return undefined;
    const { view } = editor;
    const { anchor, head } = view.state.selection.main;
    const place = {
      anchor,
      head,
      line: view.state.doc.lineAt(head).number,
      ...viewport(),
    };
    return tab.preview
      ? {
          ...place,
          file: preview!.uri,
          readonly: true,
          view: preview,
          group: group.id,
        }
      : { ...place, file: tab.path, group: group.id };
  }
  /*
   * The full-page playground mirrors the history into the browser's, so the
   * browser's Back and Forward (and the address bar's `#file`) agree with the
   * editor. The modal leaves the browser history alone: the Projects page's
   * router owns it, and entries left behind would reopen the demo.
   */
  const page = Boolean(panel.closest('[data-playground-page]'));
  const session = Math.random().toString(36).slice(2);
  function mirror(ops: NavOp[]) {
    if (!page) return;
    for (const { op, id } of ops) {
      const place = nav.find(id);
      const url = place && !place.readonly ? fileHash(place.file) : undefined;
      const state = { jaiNav: { session, id } satisfies NavState };
      if (op === 'push') history.pushState(state, '', url);
      else history.replaceState(state, '', url);
    }
  }
  /** Points the URL at the file on screen; a rename leaves older entries' URLs behind. */
  function addressBar() {
    const path =
      page && !group.viewing ? workspace.selected?.path.name : undefined;
    if (path && location.hash !== fileHash(path))
      history.replaceState(history.state, '', fileHash(path));
  }
  /** Runs `action` (which shows another place) and records the move. */
  function navigation(action: () => void) {
    const from = here();
    action();
    const to = here();
    if (to && !restoring) mirror(nav.navigate(from, to));
  }
  /** Shows a history entry again: its tab, selection and scroll. */
  function restore(place: Place) {
    restoring = true;
    try {
      closePicker();
      // Back in the group it was in, or the focused one if that has closed.
      const home = place.group ? groups.get(place.group) : undefined;
      if (home) activateGroup(home);
      if (place.readonly) {
        if (!place.view) return;
        saveState();
        const shown = tabs.tabs.find((tab) => tab.preview);
        if (shown && preview?.uri === place.view.uri) tabs.activate(shown);
        else openPreview(place.view);
      } else {
        if (!workspace.names.includes(place.file)) return;
        saveState();
        tabs.open(place.file);
      }
      show();
      const length = editor.view.state.doc.length;
      const clamp = (offset: number) => Math.min(offset, length);
      editor.view.dispatch({
        selection: { anchor: clamp(place.anchor), head: clamp(place.head) },
        // An edit since may have moved or removed the snapshot's anchor line.
        effects:
          place.scroll && place.length === length
            ? place.scroll
            : EditorView.scrollIntoView(clamp(place.top), { y: 'start' }),
      });
      showPane(panel, 'code');
      editor.focus();
    } finally {
      restoring = false;
    }
  }
  // A page traversal waits for `popstate`; presses meanwhile are dropped.
  let traversing: ReturnType<typeof setTimeout> | undefined;
  function travel(direction: NavDirection) {
    if (!page) {
      const place =
        direction === 'back' ? nav.back(here()) : nav.forward(here());
      if (place) restore(place);
      return;
    }
    // Never past the playground's own entries: that would leave the page.
    if (traversing || !(direction === 'back' ? nav.canBack : nav.canForward))
      return;
    traversing = setTimeout(() => (traversing = undefined), 1000);
    if (direction === 'back') history.back();
    else history.forward();
  }
  if (page)
    window.addEventListener(
      'popstate',
      (event) => {
        clearTimeout(traversing);
        traversing = undefined;
        const state = navState(event.state);
        if (state?.session !== session) {
          // An entry from before this session (or a hand-edited hash): open its file.
          const file = decodeURIComponent(location.hash.slice(1));
          if (workspace.names.includes(file) && file !== tabs.active?.path)
            restore({ file, line: 1, anchor: 0, head: 0, top: 0 });
          return;
        }
        const current = nav.currentId;
        const place = nav.go(state.id, here());
        if (place) {
          restore(place);
          addressBar();
        }
        // A pruned entry (deleted file, or past the limit): keep going.
        else if (current !== undefined && state.id < current) history.back();
        else if (current !== undefined) history.forward();
      },
      { signal }
    );
  watchNavigationInput(panel, travel, mac(), signal);

  /** Shows a navigation target: a workspace file's tab or the read-only preview tab. */
  function reveal(target: NavigationTarget, title?: string) {
    navigation(() => showTarget(target, title));
  }
  function showTarget(target: NavigationTarget, title?: string) {
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
    // There is one preview tab; another group's gives way.
    for (const other of [...groups.values()]) {
      const shown = other.tabs.tabs.find((tab) => tab.preview);
      if (other !== group && shown) detach(other, shown);
    }
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
            : action.kind === FIX_ALL
              ? 'fix all'
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
      // The server's own fix-all is already in the list.
      if (fixable > 1 && !fixAllAction(actions))
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

  let filesBefore = new Set<string>();
  function saveState(g: Group = group) {
    if (g.viewing) {
      if (preview?.path === g.viewing) {
        preview.state = g.editor.view.state;
        preview.stateGroup = g.id;
      }
    } else if (g.file) g.states.set(g.file, g.editor.view.state);
  }
  /*
   * Shows a group's active tab. The workspace selection always names the
   * focused group's file tab, and is empty while its preview or Markdown tab
   * is active or no tab is open, so edits, formatting and diagnostics only
   * ever target an open file.
   */
  function show(g: Group = group) {
    const tab = g.tabs.active;
    g.viewing = undefined;
    g.file = undefined;
    // The `.md` file rendered in this group, if any.
    let rendered: string | undefined;
    const text =
      tab && !tab.preview && !tab.view ? fileText(tab.path) : undefined;
    if (tab?.view) {
      // A view (the Render tab) shows its own element instead of the editor.
      g.editor.setState(g.editor.createState(''));
      g.editor.setEditable(false);
    } else if (tab?.preview && preview?.path === tab.path) {
      g.viewing = tab.path;
      const made = g.editor.createState(
        preview.text,
        // Expansions are Jai, though their tab names a source position.
        preview.kind === 'expansion' ? 'expansion.jai' : tab.path
      );
      g.editor.setState(
        preview.state && preview.stateGroup !== g.id
          ? made.update({ selection: preview.state.selection }).state
          : (preview.state ?? made)
      );
      g.editor.diagnostics([], preview.text);
    } else if (tab?.markdown && text !== undefined) {
      rendered = tab.path;
      g.editor.setState(g.editor.createState(''));
      g.editor.setEditable(false);
    } else if (tab && text !== undefined) {
      g.file = tab.path;
      g.editor.setState(
        current(
          g.states.get(tab.path) ?? g.editor.createState(text, tab.path),
          text
        )
      );
      g.editor.setEditable(true);
      // Phones swap a `.md` source tab for its rendered view in place.
      if (
        isMarkdownPath(tab.path) &&
        isNarrow() &&
        phoneView(tab.path) === 'preview'
      )
        rendered = tab.path;
      showDiagnostics(g);
    } else {
      g.editor.setState(g.editor.createState(''));
      g.editor.setEditable(false);
    }
    if (g === group) {
      if (g.file) workspace.select(g.file);
      else workspace.deselect();
    }
    const open = Boolean(g.file || g.viewing || rendered);
    g.host.hidden = !open;
    g.empty.hidden = open || Boolean(tab?.view);
    forgetClosedScrolls(g);
    g.scrollOwner = undefined;
    if (g === group) settled = undefined;
    const scroll = tab && g.scrolls.get(tabKey(tab));
    if (scroll) g.editor.view.dispatch({ effects: scroll });
    else g.editor.view.scrollDOM.scrollTo(0, 0);
    g.markdown.show(rendered);
    placeRenderView();
    renderTabs(g);
    renderActions(g);
    if (g === group) {
      updateFormat();
      tree.render();
    }
    linkPreviews();
    saveLayout();
  }
  /**
   * Pairs each Markdown preview tab on screen with an editor showing its
   * source in another group (the most recently focused), for scroll sync.
   */
  function linkPreviews() {
    for (const g of groups.values()) {
      const tab = g.tabs.active;
      const source = tab?.markdown
        ? [...focusOrder, ...groups.values()]
            .reverse()
            .find((other) => other !== g && other.file === tab.path)
        : undefined;
      g.markdown.link(source?.editor.view);
    }
  }
  /** A link in group `g`'s rendered Markdown to another workspace file. */
  function followLink(g: Group, path: string, anchor?: string) {
    const tab = g.tabs.active;
    navigation(() => {
      activateGroup(g);
      saveState(g);
      if (tab?.markdown && isMarkdownPath(path)) {
        // The preview follows the link, as VS Code's does.
        const index = g.tabs.tabs.indexOf(tab);
        g.tabs.close(tab);
        g.tabs.place(markdownTab(path), index);
      } else if (tab?.markdown) {
        openBeside(g, fileTab(path));
        return;
      } else g.tabs.open(path);
      if (anchor && isMarkdownPath(path)) g.markdown.reveal(anchor);
      show(g);
    });
  }
  const fileTab = (path: string): OpenTab =>
    Object.freeze({ path, preview: false });
  const markdownTab = (path: string): OpenTab =>
    Object.freeze({ path, preview: false, markdown: true });

  /*
   * The Render tab (render-pane.ts owns its contents). Its element moves into
   * the group whose active tab it is, and back to its place outside the
   * editor area, hidden, while no group shows it. The canvas inside stays
   * with the running program either way, so closing the tab never takes the
   * canvas from a program: showing the tab again shows the same drawing.
   */
  const renderView =
    panel.querySelector<HTMLElement>('[data-code-render-view]') ?? undefined;
  const renderHome = renderView?.parentElement ?? undefined;
  function parkRenderView() {
    if (!renderView || !renderHome) return;
    renderView.hidden = true;
    if (renderView.parentElement !== renderHome) renderHome.append(renderView);
  }
  function placeRenderView() {
    if (!renderView) return;
    const shown = [...groups.values()].find(
      (g) => g.tabs.active?.view === 'render'
    );
    if (!shown) {
      parkRenderView();
      return;
    }
    if (renderView.parentElement !== shown.element)
      shown.host.after(renderView);
    renderView.hidden = false;
  }
  /** The group holding the Render tab, if it is open. */
  const renderGroup = () =>
    [...groups.values()].find((g) =>
      g.tabs.tabs.some((tab) => tab.view === 'render')
    );
  /**
   * Where the closed Render tab opens now (`viewPlacement`): a split needs
   * an editor area of `SPLIT_MIN_WIDTH`, and phones take it as a tab.
   */
  function renderPlace(from: Group): TabPlace {
    const width = layout?.editors.getBoundingClientRect().width ?? 0;
    return viewPlacement(editorTree(), from.id, {
      narrow: isNarrow(),
      wide: width >= SPLIT_MIN_WIDTH,
      full: groups.size >= MAX_GROUPS,
    });
  }
  /**
   * Opens the closed Render tab at `place`. It becomes its group's active
   * tab, unless `behind` (a first visit's tab, behind `main.jai`); a new
   * split always shows it. Focus and the other groups' tabs stay as they are.
   */
  function openRenderAt(place: TabPlace, behind = false) {
    if ('split' in place) {
      const created = createGroup(nextGroupId(editorTree()));
      created.tabs.openView('render');
      saveLayout(
        splitGroup(
          editorTree(),
          place.split,
          place.side,
          emptyGroup(created.id)
        )
      );
      show(created);
      return;
    }
    const g = groups.get(place.group);
    if (!g) return;
    saveState(g);
    g.tabs.openView('render', { focus: !behind });
    show(g);
  }
  /**
   * The arrangement of a first visit and of Reset layout: the Render tab
   * split off beside the code where there is room, else behind its tab.
   */
  function renderBeside(g: Group) {
    if (!renderView || renderGroup()) return;
    const place = renderPlace(g);
    openRenderAt(place, !('split' in place));
  }
  /**
   * A program started drawing. An open Render tab stays where it is, even
   * behind another tab: a run never rearranges the layout. A closed one
   * opens and shows (`viewPlacement`): split off to the right of a single
   * group with room, in the rightmost group of a split, else (and on phones)
   * as a tab of the focused group.
   */
  function openRender() {
    if (signal.aborted || !groups.size || renderGroup()) return;
    openRenderAt(renderPlace(group));
  }
  /** The toolbar's Render button: shows the Render tab where it is, or opens it in the focused group. */
  function showRender() {
    const g = renderGroup() ?? group;
    activateGroup(g);
    saveState(g);
    g.tabs.openView('render');
    show(g);
    showPane(panel, 'code');
    focusGroup(g);
  }

  /** The split tree with each group's tabs filled in, as the layout saves it. */
  function treeWithTabs(node: EditorNode = editorTree()) {
    let filled = node;
    for (const g of groups.values()) {
      const saved = g.tabs.tabs.filter((tab) => !tab.preview);
      const active = g.tabs.active ? saved.indexOf(g.tabs.active) : -1;
      filled = updateGroup(filled, g.id, (item) => ({
        ...item,
        tabs: saved.map((tab) => ({
          path: tab.path,
          kind: tab.view ? 'view' : tab.markdown ? 'markdown' : 'file',
        })),
        active: Math.max(0, active),
      }));
    }
    return filled;
  }
  const groupElement = (id: string) => groups.get(id)?.element;
  /** Saves the open tabs with the layout (`render` also rebuilds the editor area). */
  function saveLayout(node?: EditorNode) {
    if (signal.aborted || !groups.size) return;
    const next = treeWithTabs(node);
    if (layout) layout.setEditors(next, node ? groupElement : undefined);
    else ownTree = next;
  }

  /**
   * Reset layout: every group's tabs move into the focused group, which is
   * left alone, and the Render tab goes back beside it.
   */
  function mergeGroups() {
    const keep = group;
    const active = keep.tabs.active?.view ? undefined : keep.tabs.active;
    saveState(keep);
    parkRenderView();
    const render = keep.tabs.tabs.find((tab) => tab.view);
    if (render) keep.tabs.close(render);
    for (const g of [...groups.values()]) {
      if (g === keep) continue;
      saveState(g);
      for (const tab of g.tabs.tabs) {
        if (tab.view) continue;
        if (keep.tabs.tabs.some((item) => sameTab(item, tab))) continue;
        const state = g.states.get(tab.path);
        if (state && !keep.states.has(tab.path))
          keep.states.set(tab.path, adopt(keep, tab.path, state));
        keep.tabs.place(tab, keep.tabs.tabs.length);
      }
      groups.delete(g.id);
      g.life.abort();
      g.editor.destroy();
      g.element.remove();
    }
    focusOrder = [keep];
    if (active) keep.tabs.activate(active);
    saveLayout(emptyGroup(keep.id));
    show(keep);
    renderBeside(keep);
    activateGroup(keep);
  }

  /** Closes an empty group; its space goes to its neighbours. */
  function dropGroup(g: Group) {
    const next = removeGroup(editorTree(), g.id);
    if (!next || !groups.has(g.id)) return;
    groups.delete(g.id);
    focusOrder = focusOrder.filter((item) => item !== g);
    if (renderView && g.element.contains(renderView)) parkRenderView();
    g.life.abort();
    g.editor.destroy();
    g.element.remove();
    if (group === g) {
      const fallback = focusOrder.at(-1) ?? groups.values().next().value!;
      activateGroup(fallback);
    }
    saveLayout(next);
    linkPreviews();
  }

  /**
   * Takes `tab` out of group `g` without closing what it shows (it moves to
   * another group); a group left empty closes, unless it is the last one.
   */
  function detach(g: Group, tab: OpenTab) {
    const active = tab === g.tabs.active;
    if (active) saveState(g);
    g.tabs.close(tab);
    if (!g.tabs.tabs.length && groups.size > 1) {
      dropGroup(g);
      return;
    }
    if (active) show(g);
    else {
      forgetClosedScrolls(g);
      renderTabs(g);
      saveLayout();
    }
  }

  /** Opens `tab` in a new group on `side` of group `target`. */
  function splitWith(
    target: Group,
    side: SplitSide,
    tab: OpenTab,
    state?: EditorState,
    scroll?: StateEffect<unknown>
  ) {
    const created = createGroup(nextGroupId(editorTree()));
    if (state) created.states.set(tab.path, adopt(created, tab.path, state));
    if (scroll) created.scrolls.set(tabKey(tab), scroll);
    created.tabs.place(tab);
    saveLayout(
      splitGroup(editorTree(), target.id, side, emptyGroup(created.id))
    );
    activateGroup(created);
    show(created);
    return created;
  }

  /**
   * Opens `tab` in the group beside `g` (right, else left), or in a new group
   * split off to its right: VS Code's "open to the side".
   */
  function openBeside(g: Group, tab: OpenTab) {
    const tree = editorTree();
    const id =
      neighbourGroup(tree, g.id, 'right') ?? neighbourGroup(tree, g.id, 'left');
    const target = id ? groups.get(id) : undefined;
    if (target) {
      activateGroup(target);
      saveState(target);
      target.tabs.place(tab);
      show(target);
    } else if (groups.size < MAX_GROUPS) splitWith(g, 'right', tab);
    else {
      saveState(g);
      g.tabs.place(tab);
      show(g);
    }
    focusGroup(group);
  }

  /** Focuses what a group shows: the drawing, its rendered Markdown, else its editor. */
  function focusGroup(g: Group) {
    if (g.tabs.active?.view) {
      if (!render?.focus()) focusActiveTab(g);
    } else if (g.markdown.path) g.markdown.focus();
    else g.editor.focus();
  }

  const actionIcons = {
    side: '<path d="M2.5 4h15v12h-15zM10 4v12M12.5 8.5h3M12.5 11.5h3"></path>',
    source: '<path d="m6 5.5-3.5 4.5L6 14.5M14 5.5l3.5 4.5-3.5 4.5"></path>',
    preview:
      '<path d="M1.75 10S4.75 4.5 10 4.5 18.25 10 18.25 10 15.25 15.5 10 15.5 1.75 10 1.75 10Z"></path><circle cx="10" cy="10" r="2.5"></circle>',
  };
  function actionButton(label: string, icon: string, run: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg>`;
    button.addEventListener('click', run);
    return button;
  }
  /**
   * The group's actions at the right of its tab strip: open the Markdown
   * preview (or the source) to the side, and on phones a Source / Preview
   * toggle for a `.md` source tab.
   */
  function renderActions(g: Group) {
    const tab = g.tabs.active;
    const items: HTMLElement[] = [];
    if (tab?.view === 'render' && render) {
      items.push(render.size);
    } else if (tab?.markdown) {
      const side = actionButton(
        'Open source to the side',
        actionIcons.source,
        () => openBeside(g, fileTab(tab.path))
      );
      side.classList.add('md-side');
      items.push(side);
    } else if (tab && !tab.preview && isMarkdownPath(tab.path)) {
      const side = actionButton(
        'Open preview to the side',
        actionIcons.side,
        () => openBeside(g, markdownTab(tab.path))
      );
      side.classList.add('md-side');
      side.dataset.codeOpenPreview = '';
      const toggle = document.createElement('span');
      toggle.className = 'md-toggle';
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'Markdown view');
      const view = phoneView(tab.path);
      for (const mode of ['source', 'preview'] as const) {
        const button = actionButton(
          mode === 'source' ? 'Source' : 'Preview',
          actionIcons[mode],
          () => {
            phoneChoice = mode;
            try {
              localStorage.setItem(MARKDOWN_VIEW_KEY, mode);
            } catch {
              /* Without storage the choice lasts for this page. */
            }
            saveState(g);
            show(g);
            focusGroup(g);
          }
        );
        button.dataset.mdView = mode;
        button.setAttribute('aria-pressed', String(mode === view));
        const label = document.createElement('span');
        label.textContent = mode === 'source' ? 'Source' : 'Preview';
        button.append(label);
        toggle.append(button);
      }
      items.push(side, toggle);
    }
    g.actions.replaceChildren(...items);
  }

  function renderTabs(g: Group = group) {
    const all = g.tabs.tabs;
    g.strip.replaceChildren(
      ...all.map((tab, index) => {
        const { name, folder } = tabLabel(tab, all);
        const active = tab === g.tabs.active;
        const item = document.createElement('div');
        item.className = 'ide-filetab';
        item.setAttribute('role', 'presentation');
        item.dataset.tabIndex = String(index);
        if (active) item.dataset.active = 'true';
        if (tab.preview) item.dataset.preview = 'true';
        if (tab.markdown) item.dataset.markdown = 'true';
        if (tab.view) item.dataset.view = tab.view;
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
        button.title = tab.view
          ? 'Where a program that draws with WebGPU shows its frames'
          : expansion
            ? `${expansion.title ?? tab.path} (read-only)`
            : tab.preview
              ? `${tab.path} (read-only)`
              : tab.markdown
                ? `Preview of ${tab.path}`
                : tab.path;
        // The visible spans run together in the computed name; spell it out.
        button.setAttribute(
          'aria-label',
          [
            tab.markdown ? `Preview ${name}` : name,
            folder && `in ${folder}`,
            tab.preview && 'read-only',
          ]
            .filter(Boolean)
            .join(', ')
        );
        const label = document.createElement('span');
        label.className = 'ide-filetab-name';
        label.textContent = tab.markdown ? `Preview ${name}` : name;
        button.append(
          fileIcon(
            tab.view
              ? 'render'
              : fileIconKind(expansion ? 'expansion.jai' : tab.path),
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
        // Keyboard and screen reader users close tabs with Delete on the tab.
        close.setAttribute('aria-hidden', 'true');
        close.dataset.tabClose = '';
        close.title = 'Close (Delete)';
        close.setAttribute(
          'aria-label',
          `Close ${tab.markdown ? `preview ${name}` : name}`
        );
        close.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"></path></svg>';
        item.append(button, close);
        return item;
      })
    );
    revealActiveTab(g);
  }
  // Keeps the active tab in view without scrolling the page around it.
  function revealActiveTab(g: Group) {
    const strip = g.strip;
    const current = strip.querySelector<HTMLElement>('[data-active]');
    if (!current) return;
    const left = current.offsetLeft,
      right = left + current.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = right - strip.clientWidth;
  }
  function tabAt(g: Group, target: EventTarget | null) {
    const item = (target as Element | null)?.closest<HTMLElement>(
      '.ide-filetab'
    );
    return item ? g.tabs.tabs[Number(item.dataset.tabIndex)] : undefined;
  }
  function focusActiveTab(g: Group = group) {
    g.strip.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }
  function activateTab(tab: OpenTab) {
    if (tab === tabs.active) return;
    closePicker();
    navigation(() => {
      saveState();
      tabs.activate(tab);
      show();
    });
  }
  function closeTab(tab: OpenTab, g: Group = group) {
    const hadFocus = g.strip.contains(document.activeElement);
    closePicker();
    if (tab !== g.tabs.active) {
      g.tabs.close(tab);
      if (tab.preview) closePreview();
      forgetClosedScrolls(g);
      renderTabs(g);
      saveLayout();
    } else {
      saveState(g);
      g.tabs.close(tab);
      if (tab.preview) closePreview();
      show(g);
    }
    // Closing a group's last tab closes the group, unless it is the only one.
    if (!g.tabs.tabs.length && groups.size > 1) {
      dropGroup(g);
      if (hadFocus) focusActiveTab();
      return;
    }
    if (hadFocus) focusActiveTab(g);
  }

  /* Drag and drop of tabs (and tree files) between and around groups. */
  const tabName = (tab: OpenTab) => {
    if (tab.view) return VIEW_LABELS[tab.view];
    const name = tab.path.slice(tab.path.lastIndexOf('/') + 1);
    return tab.markdown ? `Preview ${name}` : name;
  };
  function resolveTabDrop(
    x: number,
    y: number
  ): DropTarget<TabDrop> | undefined {
    for (const g of groups.values()) {
      const box = g.element.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom)
        continue;
      const head = g.strip.parentElement!.getBoundingClientRect();
      if (y <= head.bottom) {
        const items = [
          ...g.strip.querySelectorAll<HTMLElement>('.ide-filetab'),
        ];
        const spans = items.map((item) => {
          const rect = item.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        });
        const index = insertionIndex(spans, x);
        const last = spans.at(-1);
        const edge =
          index < spans.length
            ? spans[index].left
            : last
              ? last.left + last.width
              : head.left;
        return {
          rect: {
            left: Math.max(head.left, Math.min(edge - 1, head.right - 2)),
            top: head.top,
            width: 2,
            height: head.height,
          },
          insert: true,
          value: { group: g.id, zone: 'center', index },
        };
      }
      const content = {
        x: box.left,
        y: head.bottom,
        width: box.width,
        height: box.bottom - head.bottom,
      };
      const zone = groupDropZone(content, x, y, {
        empty: !g.tabs.tabs.length,
        full: groups.size >= MAX_GROUPS,
      });
      const half = (size: number) => size / 2;
      const rect =
        zone === 'left'
          ? {
              left: content.x,
              top: content.y,
              width: half(content.width),
              height: content.height,
            }
          : zone === 'right'
            ? {
                left: content.x + half(content.width),
                top: content.y,
                width: half(content.width),
                height: content.height,
              }
            : zone === 'top'
              ? {
                  left: content.x,
                  top: content.y,
                  width: content.width,
                  height: half(content.height),
                }
              : zone === 'bottom'
                ? {
                    left: content.x,
                    top: content.y + half(content.height),
                    width: content.width,
                    height: half(content.height),
                  }
                : {
                    left: content.x,
                    top: content.y,
                    width: content.width,
                    height: content.height,
                  };
      return { rect, value: { group: g.id, zone } };
    }
    return undefined;
  }
  /**
   * Drops `tab` (from group `from`, or from the tree) on a group: on its tab
   * strip or middle it opens there, on a side it splits a new group off. A
   * tab moves; dragging a group's only tab to its own side copies it, so the
   * file shows in both.
   */
  function dropTab(from: Group | undefined, tab: OpenTab, target: TabDrop) {
    const dest = groups.get(target.group);
    if (!dest || (from && !from.tabs.tabs.includes(tab))) return;
    closePicker();
    if (from) saveState(from);
    const state =
      from && !tab.preview && !tab.markdown && !tab.view
        ? from.states.get(tab.path)
        : undefined;
    if (tab.preview && !from) return;
    if (target.zone === 'center') {
      if (from === dest) {
        if (target.index !== undefined) dest.tabs.place(tab, target.index);
        else dest.tabs.activate(tab);
      } else {
        if (from) detach(from, tab);
        if (state && !dest.states.has(tab.path))
          dest.states.set(tab.path, adopt(dest, tab.path, state));
        const scroll = from?.scrolls.get(tabKey(tab));
        if (scroll && !dest.tabs.tabs.some((item) => sameTab(item, tab)))
          dest.scrolls.set(tabKey(tab), scroll);
        saveState(dest);
        dest.tabs.place(tab, target.index);
      }
      activateGroup(dest);
      show(dest);
    } else {
      const copy = from === dest && dest.tabs.tabs.length === 1;
      // The preview and the Render tab exist once: they move, never copy.
      if (copy && (tab.preview || tab.view)) return;
      if (from && !copy) detach(from, tab);
      splitWith(dest, target.zone, tab, state, from?.scrolls.get(tabKey(tab)));
    }
    showPane(panel, 'code');
    focusGroup(group);
  }

  function wireTabStrip(g: Group, groupSignal: AbortSignal) {
    const strip = g.strip;
    const listen = { signal: groupSignal };
    // Phones hide the strip with the Files pane; reveal again once it is shown.
    const resized = new ResizeObserver(() => revealActiveTab(g));
    resized.observe(strip);
    groupSignal.addEventListener('abort', () => resized.disconnect(), {
      once: true,
    });
    strip.addEventListener(
      'pointerdown',
      (event) => {
        const tab = tabAt(g, event.target);
        if (
          !tab ||
          isNarrow() ||
          (event.target as Element).closest('[data-tab-close]')
        )
          return;
        const item = (event.target as Element).closest<HTMLElement>(
          '.ide-filetab'
        );
        trackDrag<TabDrop>(event, {
          panel,
          label: tabName(tab),
          resolve: (x, y) => {
            item?.setAttribute('data-dragging', '');
            return resolveTabDrop(x, y);
          },
          drop: (target) => dropTab(g, tab, target),
        });
        window.addEventListener(
          'pointerup',
          () => item?.removeAttribute('data-dragging'),
          { once: true, capture: true }
        );
      },
      listen
    );
    strip.addEventListener(
      'click',
      (event) => {
        const tab = tabAt(g, event.target);
        if (!tab) return;
        activateGroup(g);
        if ((event.target as Element).closest('[data-tab-close]')) {
          closeTab(tab, g);
          return;
        }
        activateTab(tab);
        showPane(panel, 'code');
        focusGroup(g);
      },
      listen
    );
    // Middle-click closes; preventing mousedown stops the autoscroll cursor.
    strip.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 1 && tabAt(g, event.target))
          event.preventDefault();
      },
      listen
    );
    strip.addEventListener(
      'auxclick',
      (event) => {
        const tab = event.button === 1 ? tabAt(g, event.target) : undefined;
        if (!tab) return;
        event.preventDefault();
        closeTab(tab, g);
      },
      listen
    );
    strip.addEventListener(
      'keydown',
      (event) => {
        const tab = tabAt(g, event.target);
        if (!tab || event.altKey || event.ctrlKey || event.metaKey) return;
        activateGroup(g);
        const all = g.tabs.tabs,
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
          focusActiveTab(g);
        } else if (event.key === 'Delete') {
          event.preventDefault();
          closeTab(tab, g);
        }
      },
      listen
    );
    // A vertical wheel scrolls overflowing tabs sideways, as in VS Code.
    strip.addEventListener(
      'wheel',
      (event) => {
        if (
          event.deltaX ||
          !event.deltaY ||
          strip.scrollWidth <= strip.clientWidth
        )
          return;
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      },
      { signal: groupSignal, passive: false }
    );
  }
  const tree = initializeFileTree(
    panel,
    workspace,
    {
      beforeChange: () => {
        filesBefore = new Set(workspace.names);
        for (const g of groups.values()) saveState(g);
      },
      intent: (path) => void prefetch(path),
      select: (path) => {
        navigation(() => {
          saveState();
          tabs.open(path);
          show();
        });
        showPane(panel, 'code');
        focusGroup(group);
      },
      changed: (moves) => {
        // Where the editor was, in case a new file opens (a navigation).
        const from = here();
        let renamed = false;
        const names = new Set(workspace.names);
        for (const g of groups.values()) {
          if (moves) {
            const saved = [...g.states];
            for (const [from, to] of moves) {
              const state = saved.find(([path]) => path === from)?.[1];
              g.states.delete(from);
              // A new extension needs new highlighting, which a saved state can't change.
              if (state && extension(from) === extension(to))
                g.states.set(to, state);
            }
            g.tabs.move(moves);
          }
          for (const path of g.states.keys())
            if (!names.has(path)) g.states.delete(path);
          // Deleted files lose their tabs.
          g.tabs.retain(names);
        }
        if (moves) {
          nav.move(moves);
          renamed = true;
        }
        nav.retain(names);
        // A group whose files all went closes, unless it is the last.
        for (const g of [...groups.values()])
          if (!g.tabs.tabs.length && groups.size > 1) dropGroup(g);
        // A newly created file opens in the focused group.
        const selected = workspace.selected?.path.name;
        const created = !moves && selected && !filesBefore.has(selected);
        if (created) tabs.open(selected);
        for (const g of groups.values()) if (g !== group) show(g);
        show();
        const to = created ? here() : undefined;
        if (to) mirror(nav.navigate(from, to));
        if (renamed) addressBar();
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
  // A file dragged from the tree opens in, or splits off, an editor group.
  find('files').addEventListener(
    'pointerdown',
    (event) => {
      const row = (event.target as Element).closest<HTMLElement>(
        '[data-tree-kind="file"]'
      );
      const path = row?.dataset.treePath;
      if (!path || isNarrow()) return;
      trackDrag<TabDrop>(event, {
        panel,
        label: path.slice(path.lastIndexOf('/') + 1),
        resolve: resolveTabDrop,
        drop: (target) => dropTab(undefined, fileTab(path), target),
      });
    },
    { signal }
  );

  function terminate(worker: Worker | undefined) {
    if (!worker) return;
    worker.terminate();
    workers.delete(worker);
  }
  const post = (worker: Worker, message: WorkerRequest) =>
    worker.postMessage(message);
  // WebGPU programs draw in the Render tab (render-pane.ts).
  const render = createRenderPane({ view: renderView, open: openRender });
  panel
    .querySelector<HTMLButtonElement>('[data-code-show-render]')
    ?.addEventListener('click', showRender, { signal });
  function initializeWorker(
    workerSignal = signal,
    offscreen?: OffscreenCanvas
  ): Promise<CompilerWorker> {
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
      const init: WorkerRequest = {
        type: 'init',
        url: `/jai/${revision}/jai_wasm.wasm`,
        ...(offscreen
          ? { canvas: offscreen, hostUrl: `/jai/${revision}/webgpu_host.mjs` }
          : {}),
      };
      worker.postMessage(init, offscreen ? [offscreen] : []);
    });
  }
  /** Characters of each stream already on the screen (the worker streams output while it waits). */
  let shown = { stdout: 0, stderr: 0 };
  const showOutput = (stream: 'stdout' | 'stderr', text: string) => {
    shell?.output(stream, text);
    summary.unread();
  };
  // What the run wrote after it last waited, then diagnostics; the shell adds the exit note.
  function showResult(result: RunOutput) {
    const seen = { ...shown };
    for (const chunk of result.output ?? []) {
      const skip = Math.min(seen[chunk.stream], chunk.text.length);
      seen[chunk.stream] -= skip;
      showOutput(chunk.stream, chunk.text.slice(skip));
    }
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
    if (errors.length) {
      const text = errors.join('\n') + '\n';
      // The compiler colours its own errors (styled bundles); plain ones show in the error colour.
      shell?.endLine();
      showOutput(text.includes('\x1b[') ? 'stdout' : 'stderr', text);
    }
    // Compile and runtime failures carry no exit code; the summary says Failed.
    if (failed && !errors.length) {
      shell?.endLine();
      showOutput('stderr', 'The program failed without diagnostics.\n');
    }
    summary.finish(failed ? ['Failed'] : []);
    shell?.finish(result.exitCode);
  }
  function idle() {
    running = false;
    chrome!.setRun({ disabled: !ready, running: false });
  }
  function connect(worker: Worker) {
    execution = worker;
    worker.addEventListener(
      'message',
      ({ data }: MessageEvent<WorkerResponse>) => {
        if (signal.aborted || worker !== execution) return;
        // A program that waits (for input, the page, a frame) shows its output as it runs.
        if (data.type === 'output' && running) {
          shown[data.stream] += data.text.length;
          showOutput(data.stream, data.text);
          return;
        }
        if (data.type === 'stdin-request') {
          if (!running) return;
          shell?.requestInput();
          // Only a run asked for may take the keyboard; an edit's re-run leaves the cursor in the editor.
          if (runAsked) terminal?.focus();
          return;
        }
        if (data.type === 'surface') {
          if (running) render?.surface(data.size);
          return;
        }
        if (data.type !== 'run' || data.id !== job) return;
        if (data.error !== undefined) {
          showError(data.error);
          summary.finish(['Failed']);
          shell?.finish(null);
        } else showResult(data.result);
        render?.ended();
        idle();
      }
    );
    worker.addEventListener('error', (event) => {
      if (worker !== execution || signal.aborted) return;
      showError(event.message || 'Execution failed');
      summary.finish(['Failed']);
      shell?.finish(null);
      terminate(worker);
      execution = undefined;
      render?.stopped();
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
    shown = { stdout: 0, stderr: 0 };
    runAsked = explicit;
    explicit = false;
    shell?.beginRun(shell.lastArgs);
    summary.start();
    chrome!.setRun({ disabled: true, running: true });
    try {
      const snapshot = workspace.snapshot();
      if (!execution) {
        const controller = new AbortController();
        pendingExecution = controller;
        const offscreen = render?.canvas();
        const { worker, capabilities } = await initializeWorker(
          controller.signal,
          offscreen
        );
        if (pendingExecution === controller) pendingExecution = undefined;
        if (id !== job || signal.aborted) {
          terminate(worker);
          return;
        }
        render?.attach(worker, capabilities);
        programIo = capabilities.io;
        connect(worker);
      }
      if (!execution) return;
      const args = shell?.lastArgs ?? [];
      if (!programIo && args.length)
        shell?.note('This compiler build does not pass arguments to programs.');
      render?.started([snapshot.source, ...Object.values(snapshot.files)]);
      post(execution, {
        type: 'run',
        id,
        source: snapshot.source,
        options: {
          files: snapshot.files,
          budget: BUDGET,
          args: ['main', ...args],
        },
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
    const cause = stopCause;
    stopCause = 'edit';
    if (!running) return;
    terminate(execution);
    execution = undefined;
    render?.stopped();
    // A program stopped mid-run keeps what it printed. An edit starts the next run at once.
    shell?.abandonInput();
    shell?.stopped(cause);
    if (cause === 'edit') summary.clear();
    else summary.finish(['Stopped']);
    idle();
  }
  /*
   * Format runs `jaifmt.wasm` from the release in its own worker, or, where
   * that cannot run (no Memory64) or a release lacks it, jaifmt's engine driver
   * (`jaifmt-playground.jai`) in a compiler worker of its own. Either way it
   * never waits on or cancels a program run.
   */
  function updateFormat() {
    if (!formatButton) return;
    // Shown (disabled) while the driver loads, so the tools never shift.
    formatButton.hidden = driverMissing && !jaifmtWorker;
    formatButton.disabled =
      !ready ||
      formatting ||
      group?.viewing !== undefined ||
      !isFormattable(workspace.selected?.path.name ?? '');
  }
  function announce(message: string) {
    clearTimeout(statusTimer);
    chrome!.setStatus(message);
    statusTimer = setTimeout(() => {
      if (chrome!.getStatus() === message) chrome!.setStatus('');
    }, 3000);
  }
  async function loadFormatter() {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    workers.add(worker);
    try {
      const { available } = await request(worker, {
        type: 'jaifmt-load',
        id: ++formatJob,
        url: `/jai/${revision}/${JAIFMT_WASM_ASSET}`,
        metadataUrl: `/jai/${revision}/${BUILD_METADATA_ASSET}`,
        // `?jaifmt=engine` simulates a browser without Memory64.
        unsupported:
          new URLSearchParams(location.search).get('jaifmt') === 'engine',
      });
      if (available) {
        jaifmtWorker = worker;
        worker.addEventListener('error', () => {
          terminate(worker);
          if (jaifmtWorker === worker) jaifmtWorker = undefined;
          void loadDriver();
        });
        updateFormat();
        return;
      }
    } catch (error) {
      if (signal.aborted) return;
      // A release without jaifmt.wasm (404) or a digest mismatch: use the driver.
      console.warn('jaifmt.wasm is unavailable:', errorMessage(error));
    }
    terminate(worker);
    await loadDriver();
  }
  async function loadDriver() {
    if (driver !== undefined) return;
    try {
      const response = await fetch(`/jai/${revision}/${FORMAT_DRIVER_ASSET}`, {
        signal,
      });
      // Releases built before jaifmt shipped have no driver: no Format button.
      if (response.ok) {
        const text = await response.text();
        if (/^TARGET :: ".*";$/m.test(text)) driver = text;
      }
    } catch {
      /* Without the driver the button is hidden. */
    }
    driverMissing = driver === undefined;
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
  /** Posts one formatter request and waits for the reply with its id. */
  function request<
    Message extends Extract<
      WorkerRequest,
      { type: 'play' | 'jaifmt-load' | 'jaifmt' }
    >,
  >(worker: Worker, message: Message) {
    type Reply = Extract<
      WorkerResponse,
      { type: Message['type']; error?: undefined }
    >;
    return new Promise<Reply>((resolve, reject) => {
      const done = () => {
        worker.removeEventListener('message', received);
        worker.removeEventListener('error', failed);
        signal.removeEventListener('abort', failed);
      };
      const received = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== message.type || data.id !== message.id) return;
        done();
        if (data.error !== undefined) reject(new Error(data.error));
        else resolve(data as Reply);
      };
      const failed = () => {
        done();
        reject(signal.aborted ? abortError() : new Error('Formatter failed'));
      };
      worker.addEventListener('message', received);
      worker.addEventListener('error', failed);
      signal.addEventListener('abort', failed, { once: true });
      post(worker, message);
    });
  }
  /** One format run: `jaifmt.wasm` when loaded, else the engine driver. */
  async function runFormatter(path: string): Promise<RunOutput> {
    const started = performance.now();
    if (jaifmtWorker) {
      const { result, ms } = await request(jaifmtWorker, {
        type: 'jaifmt',
        id: ++formatJob,
        documents: workspace.documents.map(({ path, text }) => ({
          path,
          text,
        })),
        target: path,
      });
      console.info(
        `jaifmt.wasm: ${path} in ${ms.toFixed(1)} ms (${(performance.now() - started).toFixed(1)} ms with the worker round trip)`
      );
      return result;
    }
    if (!driver) throw new Error('The formatter is not available.');
    const { result } = await request(await formatWorker(), {
      type: 'play',
      id: ++formatJob,
      files: formatFiles(workspace.documents, path, driver),
      main: FORMAT_DRIVER_PATH,
      budget: BUDGET,
    });
    console.info(
      `jaifmt (engine driver): ${path} in ${(performance.now() - started).toFixed(1)} ms`
    );
    return result;
  }
  async function formatSelected() {
    const selected = workspace.selected;
    if (
      !formatButton ||
      formatButton.disabled ||
      !(jaifmtWorker || driver) ||
      !selected
    )
      return;
    const path = selected.path.name;
    formatting = true;
    updateFormat();
    formatButton.setAttribute('aria-busy', 'true');
    try {
      saveState();
      const result = await runFormatter(path);
      if (signal.aborted) return;
      const outcome = formatOutcome(result);
      if ('error' in outcome) {
        // The file is left as it was.
        showError(outcome.error);
        return;
      }
      const current = workspace.selected;
      if (
        group.viewing ||
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

  chrome.setHandlers({
    run: () => {
      explicit = true;
      showPane(panel, 'output');
      void runner.play();
    },
    cancel: () => {
      stopCause = 'stop';
      runner.pause();
    },
  });
  panel.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === 'Enter' &&
        !chrome!.getRun().disabled
      ) {
        event.preventDefault();
        chrome!.triggerRun();
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
  /*
   * Import folder / Reset workspace: both start a new session (new workspace,
   * tabs and language server) through the playground, which owns the session.
   */
  function restartWith(next: Starter, clearHistory: boolean) {
    if (clearHistory) {
      try {
        localStorage.removeItem(
          `jai-terminal-history:${panel.dataset.codeLanguage ?? 'jai'}`
        );
      } catch {
        /* Blocked storage: nothing was saved. */
      }
      panel
        .querySelector<HTMLButtonElement>('[data-code-reset-layout]')
        ?.click();
    }
    layout?.setEditors(emptyGroup());
    panel.dispatchEvent(
      new CustomEvent('code-workspace-restart', { detail: { starter: next } })
    );
  }
  const notify = (message: string) => {
    chrome.setStatus(message);
    showError(message);
    setTimeout(() => {
      if (!signal.aborted) chrome.setStatus('');
    }, 8000);
  };
  panel.querySelector('[data-code-import]')?.addEventListener(
    'click',
    async () => {
      const picked = await pickFolder();
      if (!picked || signal.aborted) return;
      const result = await readFolder(picked, 'main.jai');
      if (signal.aborted) return;
      if (!result.ok) return notify(result.message);
      const count = Object.keys(result.files).length;
      const replace = await confirmDialog(panel, {
        title: 'Import folder?',
        message: `This replaces all ${workspace.names.length} files in the workspace with the ${count} from the folder. ${result.summary}`,
        confirmLabel: 'Replace workspace',
      });
      if (!replace || signal.aborted) return;
      restartWith({ files: result.files, open: [result.entry] }, false);
    },
    { signal }
  );
  panel.querySelector('[data-code-reset]')?.addEventListener(
    'click',
    async () => {
      const reset = await confirmDialog(panel, {
        title: 'Reset workspace?',
        message:
          'This replaces every file with a hello-world main.jai and the default jaifmt.toml and jailint.toml, and closes all tabs. Your changes are lost.',
        confirmLabel: 'Reset workspace',
      });
      if (!reset || signal.aborted) return;
      restartWith(defaultStarter(), true);
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
      render?.dispose();
      parkRenderView();
      for (const worker of workers) worker.terminate();
      workers.clear();
      // Back to the server-rendered group; the saved layout is kept for the next session.
      for (const g of groups.values()) {
        g.life.abort();
        g.editor.destroy();
        g.tabs.clear();
        g.strip.replaceChildren();
        g.actions.replaceChildren();
        g.host.hidden = false;
        g.empty.hidden = true;
        if (g.element !== template) g.element.remove();
      }
      groups.clear();
      focusOrder = [];
      delete template.dataset.groupId;
      template.setAttribute('data-active', '');
      template.style.flex = '';
      layout?.editors.replaceChildren(template);
      find('files').replaceChildren();
      summary.clear();
      plainOutput.hidden = false;
      terminalHost.hidden = true;
      nav.clear();
      clearTimeout(traversing);
      preview = undefined;
      chrome!.setRun({ disabled: true, running: false });
      chrome!.setHandlers({ run: undefined, cancel: undefined });
      if (formatButton) formatButton.disabled = true;
    },
    { once: true }
  );
  if (signal.aborted) throw abortError();
  /*
   * The groups and tabs of the saved layout, keeping files that exist. A
   * group left without tabs goes, unless every group is empty.
   */
  const names = new Set(workspace.names);
  let restored = editorTree();
  for (const node of groupsOf(restored)) {
    const g = createGroup(node.id);
    for (const item of node.tabs) {
      if (item.kind === 'view') {
        if (renderView && item.path === 'render') g.tabs.openView('render');
        continue;
      }
      if (!names.has(item.path)) continue;
      if (item.kind === 'file') g.tabs.open(item.path);
      else if (isMarkdownPath(item.path)) g.tabs.openMarkdown(item.path);
    }
    const active = node.tabs[node.active];
    const tab =
      active &&
      g.tabs.tabs.find(
        (open) =>
          open.path === active.path &&
          Boolean(open.markdown) === (active.kind === 'markdown') &&
          Boolean(open.view) === (active.kind === 'view')
      );
    if (tab) g.tabs.activate(tab);
  }
  for (const g of [...groups.values()]) {
    if (g.tabs.tabs.length || groups.size === 1) continue;
    restored = removeGroup(restored, g.id) ?? restored;
    groups.delete(g.id);
    g.life.abort();
    g.editor.destroy();
    g.element.remove();
  }
  activateGroup(groups.get(groupsOf(restored)[0].id)!);
  // A first visit (nothing restored) starts with the code and the Render tab side by side.
  const fresh = ![...groups.values()].some((g) => g.tabs.tabs.length);
  if (fresh) {
    // The starter's tabs: main.jai, and the tour's guide rendered.
    const opening = starter.open.filter((path) => names.has(path));
    for (const path of opening)
      if (isMarkdownPath(path) && path !== opening[0]) tabs.openMarkdown(path);
      else tabs.open(path);
    if (opening[0]) tabs.open(opening[0]);
  }
  // A playground deep link (`/playground/jai#lib/math.jai`) opens that file.
  const requested = panel.dataset.codeOpen;
  if (requested && names.has(requested)) tabs.open(requested);
  saveLayout(restored);
  for (const g of groups.values()) if (g !== group) show(g);
  show();
  if (fresh && !viewGroup(restored, 'render')) {
    const code = group;
    renderBeside(code);
    activateGroup(code);
  }
  // Crossing into the phone layout swaps `.md` source tabs for their preview, and back.
  matchMedia(NARROW_QUERY).addEventListener(
    'change',
    () => {
      for (const g of groups.values()) {
        saveState(g);
        show(g);
      }
      show();
    },
    { signal }
  );
  layout?.onReset(mergeGroups, signal);
  const start = here();
  if (start) {
    const id = nav.reset(start);
    // Tag the page's own entry so Back can return to it; the URL stays as it is.
    if (page) history.replaceState({ jaiNav: { session, id } }, '');
  }
  const driverLoaded = loadFormatter();
  const runtime = await initializeWorker(signal, render?.canvas());
  render?.attach(runtime.worker, runtime.capabilities);
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
        showPublished(entry);
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
      for (const g of groups.values())
        g.editor.view.dispatch({ effects: refreshLanguage.of(null) });
  }
  await driverLoaded;
  await terminalReady;
  if (signal.aborted) throw abortError();
  ready = true;
  idle();
  updateFormat();
  if (editedDuringBoot) runner.changed();
  else void runner.play();
  editor.focus();
}
