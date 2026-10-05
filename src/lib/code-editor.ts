import { EditorState, Compartment } from '@codemirror/state';
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
import { tags } from '@lezer/highlight';
import { jaiTokenizer, jaiLanguage } from './jai/language.ts';
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
      fontFamily: 'var(--ide-mono)',
      lineHeight: '1.6',
    },
    '.cm-content': {
      padding: '14px 0 40px',
      caretColor: 'var(--yellow)',
    },
    '.cm-line': { padding: '0 16px 0 12px' },
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
    '.cm-activeLine': { backgroundColor: 'var(--ide-active-line)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--ide-fg)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: 'var(--ide-selection)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--ide-selection-match)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'transparent',
      color: 'var(--ide-fg-strong)',
      outline: '1px solid var(--ide-muted)',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--ide-faint)',
      cursor: 'pointer',
    },
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

const completionType = (kind: number | undefined) =>
  kind === 3
    ? 'function'
    : kind === 7
      ? 'class'
      : kind === 14
        ? 'keyword'
        : 'variable';

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
  const hover = hoverTooltip(async (view, position) => {
    const client = service();
    if (!client) return null;
    const current = currentDocument();
    const version = current.version;
    try {
      const result = await client.request<Hover | null>('textDocument/hover', {
        textDocument: { uri: documentUri(current.path) },
        position: positionAt(view.state.doc.toString(), position),
      });
      if (
        !result ||
        currentDocument().path !== current.path ||
        currentDocument().version !== version
      )
        return null;
      const text = textContent(result.contents);
      if (!text) return null;
      return {
        pos: result.range
          ? offsetAt(current.text, result.range.start)
          : position,
        end: result.range
          ? offsetAt(current.text, result.range.end)
          : undefined,
        create() {
          const dom = document.createElement('div');
          dom.className = 'jai-hover';
          dom.textContent = text;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });
  function state(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        EditorState.lineSeparator.of('\n'),
        language === 'baerscript'
          ? baerscriptLanguage
          : language === 'quasi'
            ? quasiLanguage
            : jaiLanguage,
        syntaxHighlighting(colors),
        theme,
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
            marker.className = 'cm-fold-marker';
            marker.textContent = open ? '⌄' : '›';
            return marker;
          },
        }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        autocompletion({ override: [completions], icons: false }),
        hover,
        editable.of(EditorView.editable.of(true)),
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
  return {
    view,
    createState: state,
    setState: (value: EditorState) => {
      view.setState(value);
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
      closeRename();
      view.destroy();
    },
  };
}
