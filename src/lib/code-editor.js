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
} from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from '@codemirror/search';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { jaiTokenizer, jaiLanguage } from './jai/language.js';
import { StreamLanguage } from '@codemirror/language';
import { documentUri, positionAt, offsetAt } from './jai/language-client.js';
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
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: '#7928a1' },
  { tag: [tags.typeName, tags.className], color: '#21665f' },
  { tag: tags.function(tags.variableName), color: '#383838' },
  { tag: tags.variableName, color: '#252525' },
  { tag: [tags.string, tags.character], color: '#42752a' },
  { tag: tags.comment, color: '#888888', fontStyle: 'italic' },
  { tag: tags.number, color: '#965900' },
  { tag: [tags.processingInstruction, tags.annotation], color: '#815f15' },
  { tag: [tags.operator, tags.punctuation], color: '#555555' },
]);
const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '14px',
      color: '#252525',
      backgroundColor: '#ffffff',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      lineHeight: '1.65',
    },
    '.cm-content': { padding: '16px 0', caretColor: '#383838' },
    '.cm-gutters': {
      backgroundColor: '#ffffff',
      color: '#aaaaaa',
      border: 'none',
      paddingRight: '10px',
    },
    '.cm-activeLine,.cm-activeLineGutter': { backgroundColor: '#f5f5f5' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#dedede',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#e6e6e6',
      color: '#111',
      outline: '1px solid #999999',
    },
    '.cm-tooltip': {
      backgroundColor: '#ffffff',
      color: '#222222',
      border: '1px solid #dddddd',
    },
    '.cm-searchMatch': { backgroundColor: '#f2df9d' },
    '.cm-panels': { backgroundColor: '#ffffff', color: '#222222' },
  },
  { dark: false }
);
function textContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textContent).join('\n\n');
  return typeof value?.value === 'string' ? value.value : '';
}
export function createEditor(
  parent,
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
  }
) {
  const editable = new Compartment();
  let renameInput;
  function closeRename() {
    renameInput?.remove();
    renameInput = undefined;
  }
  function renameAtCursor(view) {
    if (!onRename || !canRename()) return false;
    closeRename();
    const offset = view.state.selection.main.head;
    const word = view.state.wordAt(offset);
    const input = documentNode('input');
    renameInput = input;
    input.setAttribute('aria-label', 'Rename symbol');
    input.value = word ? view.state.doc.sliceString(word.from, word.to) : '';
    Object.assign(input.style, {
      position: 'absolute',
      top: '2.7rem',
      right: '1rem',
      zIndex: '12',
      background: '#fff',
      color: '#222',
      border: '1px solid #999',
      padding: '.4rem .6rem',
      font: '13px monospace',
      width: 'min(16rem, 80%)',
    });
    parent.style.position = 'relative';
    parent.append(input);
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
        await onRename(offset, input.value);
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

  const completions = async (context) => {
    const client = service();
    if (!client) return null;
    const document = currentDocument();
    const version = document.version;
    const controller = new AbortController();
    context.addEventListener('abort', () => controller.abort(), {
      onDocChange: true,
    });
    const word = context.matchBefore(/[_\p{L}\p{N}#]*/u);
    if (!context.explicit && !word?.text) return null;
    try {
      const response = await client.request(
        'textDocument/completion',
        {
          textDocument: { uri: documentUri(document.path) },
          position: positionAt(context.state.doc.toString(), context.pos),
        },
        controller.signal
      );
      if (
        currentDocument().path !== document.path ||
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
            info: textContent(item.documentation),
            type:
              item.kind === 3
                ? 'function'
                : item.kind === 7
                  ? 'class'
                  : item.kind === 14
                    ? 'keyword'
                    : 'variable',
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
    const document = currentDocument();
    const version = document.version;
    try {
      const result = await client.request('textDocument/hover', {
        textDocument: { uri: documentUri(document.path) },
        position: positionAt(view.state.doc.toString(), position),
      });
      if (
        !result ||
        currentDocument().path !== document.path ||
        currentDocument().version !== version
      )
        return null;
      const text = textContent(result.contents);
      if (!text) return null;
      return {
        pos: result.range
          ? offsetAt(document.text, result.range.start)
          : position,
        end: result.range
          ? offsetAt(document.text, result.range.end)
          : undefined,
        create() {
          const dom = documentNode('div');
          dom.className = 'jai-hover';
          dom.textContent = text;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });
  function state(doc) {
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
        foldGutter(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        autocompletion({ override: [completions] }),
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
          'aria-label': 'Jai source editor',
          spellcheck: 'false',
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
    setState: (value) => {
      view.setState(value);
      const cursor = view.state.selection.main.head;
      const line = view.state.doc.lineAt(cursor);
      onCursor(line.number, cursor - line.from + 1);
    },
    diagnostics(values, documentText) {
      const checked = [];
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
    setEditable: (value) =>
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
function documentNode(tag) {
  return globalThis.document.createElement(tag);
}
