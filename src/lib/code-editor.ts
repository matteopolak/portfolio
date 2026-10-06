import { EditorState, Compartment } from '@codemirror/state';
import { vim } from '@replit/codemirror-vim';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  hoverTooltip,
  type Tooltip,
} from '@codemirror/view';
import {
  defaultKeymap,
  historyKeymap,
  history,
  indentWithTab,
} from '@codemirror/commands';
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  HighlightStyle,
  indentUnit,
  StreamLanguage,
  syntaxTree,
} from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from '@codemirror/search';
import {
  lintGutter,
  setDiagnostics,
  type Diagnostic as EditorDiagnostic,
} from '@codemirror/lint';
import { tags, highlightTree } from '@lezer/highlight';
import {
  jaiTokenizer,
  jaiLanguage,
  formatSpecifierTag,
  formatPercentTag,
} from './jai/language.ts';
import { formatStringAt } from './jai/format-string.ts';
import { tomlLanguage } from './toml-language.ts';
import {
  documentUri,
  positionAt,
  offsetAt,
  type LanguageClient,
} from './jai/language-client.ts';
import type {
  CompletionItem,
  CompletionList,
  Diagnostic,
  Hover,
  MarkupText,
} from './jai/lsp-types.ts';

export type EditorLanguage = 'jai' | 'quasi' | 'baerscript';

const languageNames: Record<EditorLanguage, string> = {
  jai: 'Jai',
  quasi: 'Quasi',
  baerscript: 'BaerScript',
};

const baerscriptLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    stream.next();
    return 'operator';
  },
});
const quasiLanguage = StreamLanguage.define({
  ...jaiTokenizer,
  token(stream, state) {
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    return jaiTokenizer.token(stream, state);
  },
});

// Colors resolve from the `--ide-*` tokens declared by CodeWorkspace.astro.
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--ide-syntax-keyword)', fontWeight: '600' },
  { tag: [tags.typeName, tags.className], color: 'var(--ide-syntax-type)' },
  {
    tag: tags.function(tags.variableName),
    color: 'var(--ide-syntax-function)',
  },
  { tag: tags.variableName, color: 'var(--ide-fg)' },
  { tag: [tags.string, tags.character], color: 'var(--ide-syntax-string)' },
  {
    tag: formatSpecifierTag,
    color: 'var(--ide-syntax-format)',
    fontWeight: '650',
  },
  { tag: formatPercentTag, color: 'var(--ide-syntax-format-percent)' },
  {
    tag: tags.comment,
    color: 'var(--ide-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: tags.number, color: 'var(--ide-syntax-number)' },
  {
    tag: [tags.processingInstruction, tags.annotation],
    color: 'var(--ide-syntax-directive)',
  },
  { tag: [tags.operator, tags.punctuation], color: 'var(--ide-syntax-punct)' },
]);

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: 'var(--ide-code-size, 14px)',
      color: 'var(--ide-fg)',
      backgroundColor: 'var(--ide-bg)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      overflow: 'auto',
      overscrollBehavior: 'contain',
      fontFamily: 'var(--ide-mono)',
      lineHeight: '1.6',
    },
    '.cm-content': {
      padding: '14px 0 40px',
      caretColor: 'var(--yellow)',
    },
    '.cm-line': { padding: '0 16px 0 4px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--yellow)',
      borderLeftWidth: '2px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--ide-bg)',
      color: 'var(--ide-faint)',
      border: 'none',
      paddingLeft: '6px',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '2.5ch' },
    '.cm-gutter-lint': { width: '14px' },
    '.cm-activeLine': { backgroundColor: 'var(--ide-active-line)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--ide-active-line)',
      color: 'var(--ide-fg)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: 'var(--ide-selection)' },
    // The site-wide ::selection sets ink-coloured text; code keeps its syntax colours.
    '::selection': { color: 'currentColor' },
    '.cm-selectionMatch': { backgroundColor: 'var(--ide-selection-match)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'transparent',
      color: 'var(--ide-fg-strong)',
      outline: '1px solid var(--ide-muted)',
    },
    '.cm-foldGutter .cm-gutterElement': {
      width: '10px',
      padding: '0',
      color: 'var(--ide-faint)',
      cursor: 'pointer',
      textAlign: 'center',
    },
    '.cm-fold-marker': { opacity: '0', transition: 'opacity 120ms ease' },
    '.cm-fold-marker--closed': { opacity: '1' },
    '.cm-gutters:hover .cm-fold-marker, .cm-foldGutter .cm-gutterElement:focus-within .cm-fold-marker':
      { opacity: '1' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--ide-raised)',
      border: 'none',
      color: 'var(--ide-muted)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--ide-raised)',
      color: 'var(--ide-fg)',
      border: '1px solid var(--ide-rule)',
      borderRadius: '6px',
      boxShadow: '0 10px 30px oklch(0% 0 0 / 0.45)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--ide-mono)',
      fontSize: '13px',
      maxHeight: '16rem',
    },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px 3px 6px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--ide-selection)',
      color: 'var(--ide-fg-strong)',
    },
    '.cm-completionDetail': {
      color: 'var(--ide-muted)',
      fontStyle: 'normal',
      marginLeft: '1em',
    },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--yellow)',
    },
    '.cm-completionInfo': { padding: '8px 10px', maxWidth: '28rem' },
    '.cm-tooltip-lint, .cm-diagnostic': { fontFamily: 'var(--ide-mono)' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--red)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--yellow)' },
    '.cm-diagnostic-info': { borderLeftColor: 'var(--blue)' },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--red)',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--yellow)',
      textUnderlineOffset: '3px',
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--ide-search)',
      outline: '1px solid var(--ide-search-outline)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--ide-selection)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--ide-raised)',
      color: 'var(--ide-fg)',
    },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--ide-rule)' },
    '.cm-panel input, .cm-panel button, .cm-textfield': {
      color: 'var(--ide-fg)',
      backgroundColor: 'var(--ide-sunken)',
      border: '1px solid var(--ide-rule)',
      borderRadius: '4px',
    },
    '.cm-button': { backgroundImage: 'none' },
    '.jai-hover': {
      padding: '8px 10px',
      maxWidth: '32rem',
      whiteSpace: 'pre-wrap',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
    },
    '.jai-hover--overloads': { padding: '4px 0' },
    '.jai-hover__format-head': { padding: '2px 10px 6px' },
    '.jai-hover__format-row': { padding: '4px 10px', textIndent: '0' },
    '.jai-hover__format-row[data-current]': {
      backgroundColor: 'var(--ide-selection)',
      boxShadow: 'inset 2px 0 var(--ide-syntax-format)',
    },
    '.jai-hover__format-spec': {
      color: 'var(--ide-syntax-format)',
      fontWeight: '650',
    },
    '.jai-hover__format-label': {
      color: 'var(--ide-muted)',
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
    },
    '.jai-hover__format-missing': {
      color: 'var(--ide-error)',
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
    },
    '.jai-hover__count': {
      padding: '2px 10px 4px',
      color: 'var(--ide-muted)',
      fontFamily: 'inherit',
      fontSize: '11px',
    },
    // Wrapped continuation lines hang under the name.
    '.jai-hover__overload': {
      padding: '5px 10px 5px calc(10px + 2ch)',
      textIndent: '-2ch',
      borderTop: '1px solid var(--ide-rule)',
    },
    '.cm-vim-panel': {
      padding: '2px 10px',
      minHeight: '1.5em',
      color: 'var(--ide-muted)',
      backgroundColor: 'var(--ide-sunken)',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12px',
    },
    '.cm-vim-panel input': {
      color: 'var(--ide-fg)',
      backgroundColor: 'transparent',
      border: 'none',
      outline: 'none',
      font: 'inherit',
    },
    '.cm-fat-cursor': {
      background: 'var(--blue) !important',
      color: 'var(--ide-sunken) !important',
      opacity: '0.75',
    },
    '.cm-definition-link': { cursor: 'pointer' },
    '.cm-rename-input': {
      position: 'absolute',
      top: '10px',
      right: '16px',
      zIndex: '12',
      width: 'min(16rem, 80%)',
      padding: '6px 10px',
      color: 'var(--ide-fg-strong)',
      backgroundColor: 'var(--ide-raised)',
      border: '1px solid var(--blue)',
      borderRadius: '6px',
      outline: 'none',
      font: '13px var(--ide-mono)',
      boxShadow: '0 10px 30px oklch(0% 0 0 / 0.45)',
    },
  },
  { dark: true }
);

function textContent(value: MarkupText | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textContent).join('\n\n');
  return typeof value?.value === 'string' ? value.value : '';
}

/**
 * Hover text is plain, but it is code: type signatures and declarations. Color
 * it with the editor's own grammar. Markdown fences, when present, mark the
 * code regions and everything outside them stays plain.
 */
function highlightedHover(
  text: string,
  { parser }: StreamLanguage<unknown>
): (Node | string)[] {
  const nodes: (Node | string)[] = [];
  const code = (source: string) => {
    const fragment = document.createDocumentFragment();
    let at = 0;
    const plain = (to: number) => {
      if (to > at) fragment.append(source.slice(at, to));
      at = to;
    };
    highlightTree(parser.parse(source), colors, (from, to, cls) => {
      plain(from);
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = source.slice(from, to);
      fragment.append(span);
      at = to;
    });
    plain(source.length);
    return fragment;
  };
  if (!/```/u.test(text)) return [code(text)];
  let last = 0;
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(code(match[1].replace(/\n$/u, '')));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const completionType = (kind: number | undefined) =>
  kind === 3
    ? 'function'
    : kind === 7
      ? 'class'
      : kind === 14
        ? 'keyword'
        : 'variable';

const languageFor = (language: EditorLanguage) =>
  language === 'baerscript'
    ? baerscriptLanguage
    : language === 'quasi'
      ? quasiLanguage
      : jaiLanguage;

/**
 * Highlighting for one file. A Jai workspace also holds other files
 * (`jaifmt.toml`, notes), which must not be read as Jai.
 */
const syntaxFor = (language: EditorLanguage, path: string | undefined) => {
  if (language !== 'jai' || !path || path.endsWith('.jai'))
    return languageFor(language);
  return path.endsWith('.toml') ? tomlLanguage : [];
};

export interface EditorDocument {
  path: string;
  text: string;
  version: number;
}

export interface EditorOptions {
  text: string;
  onChange: (text: string) => void;
  onCursor?: (line: number, column: number) => void;
  currentDocument?: () => EditorDocument;
  service?: () => LanguageClient | undefined;
  language?: EditorLanguage;
  onDefinition?: (offset: number) => Promise<void>;
  onRename?: (offset: number, name: string) => Promise<void>;
  canDefine?: () => boolean;
  canRename?: () => boolean;
}

export type Editor = ReturnType<typeof createEditor>;

/*
 * Vim keybindings are one preference for every editor on the page, kept in
 * localStorage. Toggling it reconfigures each live editor.
 */
const VIM_STORAGE_KEY = 'code-editor-vim';
const vimEditors = new Set<(enabled: boolean) => void>();
let vimEnabled = (() => {
  try {
    return localStorage.getItem(VIM_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
})();

function setVimEnabled(enabled: boolean) {
  vimEnabled = enabled;
  try {
    localStorage.setItem(VIM_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* Without storage the choice lasts for this page. */
  }
  for (const apply of vimEditors) apply(enabled);
}

const vimExtension = (enabled: boolean) =>
  enabled ? vim({ status: true }) : [];

/*
 * Overload sets come back as one `name :: header` line per procedure. Long
 * headers wrap, so each gets its own row, a rule between rows and a count.
 */
function hoverContent(
  text: string,
  language: StreamLanguage<unknown>
): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'jai-hover';
  const lines = text.split('\n');
  const overloads =
    lines.length > 1 && lines.every((line) => /^[^\s:]+ :: \(/u.test(line));
  if (!overloads) {
    dom.append(...highlightedHover(text, language));
    return dom;
  }
  dom.classList.add('jai-hover--overloads');
  const count = document.createElement('div');
  count.className = 'jai-hover__count';
  count.textContent = `${lines.length} overloads`;
  dom.append(count);
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'jai-hover__overload';
    row.append(...highlightedHover(line, language));
    dom.append(row);
  }
  return dom;
}

/** Syntax highlighting for `source` as a fragment, using the editor's colours. */
function highlighted(
  source: string,
  { parser }: StreamLanguage<unknown>,
  skip = 0,
  length = source.length - skip
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const end = skip + length;
  let at = skip;
  const plain = (to: number) => {
    if (to > at) fragment.append(source.slice(at, to));
    at = Math.max(at, to);
  };
  highlightTree(parser.parse(source), colors, (from, to, cls) => {
    from = Math.max(from, skip);
    to = Math.min(to, end);
    if (to <= from) return;
    plain(from);
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = source.slice(from, to);
    fragment.append(span);
    at = to;
  });
  plain(end);
  return fragment;
}

const formatNodes = new Set([
  'formatString',
  'formatSpecifier',
  'formatPercent',
]);

/**
 * Client-side hover for a print-family format string: the literal, then one
 * row per specifier with the argument it formats. Only the tokenizer knows
 * which strings are format strings, so this keys off its token names. The
 * language server's hover wins when it has one (see `hover`).
 */
function formatStringHover(
  view: EditorView,
  position: number,
  side: -1 | 1
): Tooltip | null {
  const node = syntaxTree(view.state).resolveInner(position, side);
  if (!formatNodes.has(node.name)) return null;
  const at = Math.min(
    Math.max(side < 0 ? position - 1 : position, node.from),
    node.to - 1
  );
  const info = formatStringAt(view.state.doc.toString(), at);
  if (!info || info.entries.length === 0) return null;
  return {
    pos: info.from,
    end: info.to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'jai-hover jai-hover--overloads jai-hover--format';
      // Highlight the literal as the first argument of a `print` call.
      const head = document.createElement('div');
      head.className = 'jai-hover__format-head';
      head.append(
        highlighted(
          `print(${info.literal})`,
          jaiLanguage,
          6,
          info.literal.length
        )
      );
      dom.append(head);
      for (const entry of info.entries) {
        const { spec } = entry;
        const row = document.createElement('div');
        row.className = 'jai-hover__overload jai-hover__format-row';
        const from = info.from + 1 + spec.from;
        if (at >= from && at < info.from + 1 + spec.to)
          row.dataset.current = 'true';
        const mark = document.createElement('span');
        mark.className = 'jai-hover__format-spec';
        mark.textContent = entry.text;
        const label = document.createElement('span');
        label.className = 'jai-hover__format-label';
        row.append(mark, ' → ', label);
        if (spec.kind === 'percent') label.textContent = 'a literal %';
        else if (spec.kind === 'empty') label.textContent = 'prints nothing';
        else {
          label.textContent = `Argument ${(spec.argument ?? 0) + 1}`;
          if (entry.argumentText === undefined) {
            const missing = document.createElement('span');
            missing.className = 'jai-hover__format-missing';
            missing.textContent = '(not passed)';
            row.append(' ', missing);
          } else {
            const code = document.createElement('code');
            code.className = 'jai-hover__format-argument';
            code.append(highlighted(entry.argumentText, jaiLanguage));
            row.append(' ', code);
          }
        }
        dom.append(row);
      }
      return { dom };
    },
  };
}

export function createEditor(
  parent: HTMLElement,
  {
    text,
    onChange,
    onCursor = () => {},
    currentDocument = () => ({ path: 'main', text: '', version: 0 }),
    service = () => undefined,
    language = 'jai',
    onDefinition,
    onRename,
    canDefine = () => true,
    canRename = () => true,
  }: EditorOptions
) {
  const editable = new Compartment();
  const vimMode = new Compartment();
  // Cmd-click (macOS) or Ctrl-click on a name goes to its definition, like F12. The
  // pointer turns into a hand while the modifier is held over a name.
  const mac = /Mac|iPhone|iPad/u.test(navigator.platform);
  const modifier = (event: MouseEvent | KeyboardEvent) =>
    mac ? event.metaKey : event.ctrlKey;
  const linkAt = (view: EditorView, event: MouseEvent) => {
    if (!modifier(event) || !onDefinition || !canDefine()) return undefined;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    return view.state.wordAt(pos) ? pos : undefined;
  };
  const showLink = (view: EditorView, on: boolean) =>
    view.contentDOM.classList.toggle('cm-definition-link', on);
  const definitionClick = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const pos = linkAt(view, event);
      if (pos === undefined) return false;
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      void onDefinition?.(pos);
      return true;
    },
    mousemove(event, view) {
      showLink(view, linkAt(view, event) !== undefined);
      return false;
    },
    mouseleave(_event, view) {
      showLink(view, false);
      return false;
    },
    keyup(event, view) {
      if (!modifier(event)) showLink(view, false);
      return false;
    },
  });
  let renameInput: HTMLInputElement | undefined;
  function closeRename() {
    renameInput?.remove();
    renameInput = undefined;
  }
  function renameAtCursor(view: EditorView) {
    if (!onRename || !canRename()) return false;
    const rename = onRename;
    closeRename();
    const offset = view.state.selection.main.head;
    const word = view.state.wordAt(offset);
    const input = document.createElement('input');
    renameInput = input;
    input.className = 'cm-rename-input';
    input.setAttribute('aria-label', 'Rename symbol');
    input.value = word ? view.state.doc.sliceString(word.from, word.to) : '';
    view.dom.append(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRename();
        view.focus();
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.disabled = true;
      try {
        await rename(offset, input.value);
        closeRename();
        view.focus();
      } catch {
        input.disabled = false;
        if (input.isConnected) input.focus();
      }
    });
    input.addEventListener('blur', () => {
      if (!input.disabled) closeRename();
    });
    return true;
  }

  const completions = async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    const client = service();
    if (!client) return null;
    const current = currentDocument();
    const version = current.version;
    const controller = new AbortController();
    context.addEventListener('abort', () => controller.abort(), {
      onDocChange: true,
    });
    const word = context.matchBefore(/[_\p{L}\p{N}#]*/u);
    if (!context.explicit && !word?.text) return null;
    try {
      const response = await client.request<
        CompletionItem[] | CompletionList | null
      >(
        'textDocument/completion',
        {
          textDocument: { uri: documentUri(current.path) },
          position: positionAt(context.state.doc.toString(), context.pos),
        },
        controller.signal
      );
      if (
        currentDocument().path !== current.path ||
        currentDocument().version !== version
      )
        return null;
      const items = Array.isArray(response)
        ? response
        : (response?.items ?? []);
      return {
        from: word?.from ?? context.pos,
        options: items
          .filter((item) => item.insertTextFormat !== 2)
          .map((item) => ({
            label: item.label,
            detail: item.detail,
            info: textContent(item.documentation) || undefined,
            type: completionType(item.kind),
            apply: item.insertText ?? item.label,
          })),
      };
    } catch {
      return null;
    }
  };
  const hover = hoverTooltip(async (view, position, side) => {
    // The client-side format-string hover is the fallback: a hover from the
    // language server for the same position replaces it, so only one shows.
    const local =
      language === 'jai' ? formatStringHover(view, position, side) : null;
    const client = service();
    if (!client) return local;
    const current = currentDocument();
    const version = current.version;
    try {
      const result = await client.request<Hover | null>('textDocument/hover', {
        textDocument: { uri: documentUri(current.path) },
        position: positionAt(view.state.doc.toString(), position),
      });
      if (
        currentDocument().path !== current.path ||
        currentDocument().version !== version
      )
        return null;
      const text = result ? textContent(result.contents) : '';
      if (!result || !text) return local;
      return {
        pos: result.range
          ? offsetAt(current.text, result.range.start)
          : position,
        end: result.range
          ? offsetAt(current.text, result.range.end)
          : undefined,
        create() {
          return { dom: hoverContent(text, languageFor(language)) };
        },
      };
    } catch {
      return local;
    }
  });
  /** `path` picks the highlighting; without it the editor's language is used. */
  function state(doc: string, path?: string) {
    return EditorState.create({
      doc,
      extensions: [
        // First, so Vim sees keys before the default keymaps.
        vimMode.of(vimExtension(vimEnabled)),
        EditorState.lineSeparator.of('\n'),
        syntaxFor(language, path),
        syntaxHighlighting(colors),
        theme,
        lintGutter(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of('    '),
        bracketMatching(),
        closeBrackets(),
        foldGutter({
          markerDOM: (open) => {
            const marker = document.createElement('span');
            marker.className = open
              ? 'cm-fold-marker'
              : 'cm-fold-marker cm-fold-marker--closed';
            marker.textContent = open ? '⌄' : '›';
            return marker;
          },
        }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        autocompletion({ override: [completions], icons: false }),
        hover,
        editable.of(EditorView.editable.of(true)),
        definitionClick,
        keymap.of([
          {
            key: 'F12',
            run: (view) => {
              if (!onDefinition || !canDefine()) return false;
              void onDefinition(view.state.selection.main.head);
              return true;
            },
          },
          { key: 'F2', run: renameAtCursor },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({
          'aria-label': `${languageNames[language]} source editor`,
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const cursor = update.state.selection.main.head;
            const line = update.state.doc.lineAt(cursor);
            onCursor(line.number, cursor - line.from + 1);
          }
        }),
      ],
    });
  }
  const view = new EditorView({ state: state(text), parent });
  const vimButton = parent
    .closest('[data-code-workspace]')
    ?.querySelector<HTMLButtonElement>('[data-code-vim]');
  const applyVim = (enabled: boolean) => {
    view.dispatch({ effects: vimMode.reconfigure(vimExtension(enabled)) });
    vimButton?.setAttribute('aria-pressed', String(enabled));
  };
  const toggleVim = () => {
    setVimEnabled(!vimEnabled);
    view.focus();
  };
  vimButton?.setAttribute('aria-pressed', String(vimEnabled));
  vimButton?.addEventListener('click', toggleVim);
  vimEditors.add(applyVim);
  return {
    view,
    createState: state,
    setState: (value: EditorState) => {
      view.setState(value);
      // States made for other files may predate a Vim toggle.
      view.dispatch({ effects: vimMode.reconfigure(vimExtension(vimEnabled)) });
      const cursor = view.state.selection.main.head;
      const line = view.state.doc.lineAt(cursor);
      onCursor(line.number, cursor - line.from + 1);
    },
    diagnostics(values: readonly Diagnostic[], documentText: string) {
      const checked: EditorDiagnostic[] = [];
      for (const value of values) {
        try {
          checked.push({
            from: offsetAt(documentText, value.range.start),
            to: offsetAt(documentText, value.range.end),
            severity:
              value.severity === 2
                ? 'warning'
                : value.severity === 3 || value.severity === 4
                  ? 'info'
                  : 'error',
            message: String(value.message),
            source: value.source,
          });
        } catch {
          /* Invalid server ranges never become guessed editor positions. */
        }
      }
      view.dispatch(setDiagnostics(view.state, checked));
    },
    find: () => openSearchPanel(view),
    setEditable: (value: boolean) =>
      view.dispatch({
        effects: editable.reconfigure(EditorView.editable.of(value)),
      }),
    focus: () => view.focus(),
    destroy: () => {
      vimEditors.delete(applyVim);
      vimButton?.removeEventListener('click', toggleVim);
      closeRename();
      view.destroy();
    },
  };
}
