import {
  EditorState,
  EditorSelection,
  Compartment,
  countColumn,
  type Extension,
} from '@codemirror/state';
import { vim } from '@replit/codemirror-vim';
import {
  EditorView,
  keymap,
  type KeyBinding,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  hoverTooltip,
  closeHoverTooltips,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import {
  defaultKeymap,
  historyKeymap,
  history,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  getIndentUnit,
  indentUnit,
  StreamLanguage,
  syntaxTree,
} from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  acceptCompletion,
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';
import { findExtensions, openFind } from './editor-find-panel.ts';
import {
  lintGutter,
  setDiagnostics,
  type Action as LintAction,
  type Diagnostic as EditorDiagnostic,
} from '@codemirror/lint';
import { linkModifier } from './platform.ts';
import {
  documentationContent,
  formatLiteral,
  highlighted,
  highlightStyle,
  markdownContent,
  plainHoverContent,
  withCode,
} from './code-highlight.ts';
import { completionOption } from './jai/completion-items.ts';
import { jaiTokenizer, jaiLanguage } from './jai/language.ts';
import { documentation } from './jai/lsp-features.ts';
import { formatStringAt } from './jai/format-string.ts';
import {
  lintDocs,
  isUnusedRule,
  lintMessage,
  lintRule,
} from './jai/lint-fixes.ts';
import { tomlLanguage } from './toml-language.ts';
import { markdownSyntax } from './markdown-language.ts';
import {
  positionAt,
  offsetAt,
  type LanguageClient,
} from './jai/language-client.ts';
import {
  foldingChanged,
  linkAt as documentLinkAt,
  type LanguageDocument,
} from './jai/lsp-extensions.ts';
import type {
  CompletionItem,
  CompletionList,
  Diagnostic,
  Hover,
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
      caretColor: 'var(--accent-3)',
    },
    '.cm-line': { padding: '0 16px 0 4px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-3)',
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
      // Radius tokens live on :root in global.css.
      borderRadius: 'var(--radius)',
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
      color: 'var(--accent-3-light)',
    },
    '.cm-completionInfo': { padding: '8px 10px', maxWidth: '28rem' },
    // Rendered documentation brings its own insets.
    '.cm-completionInfo:has(> .jai-hover)': { padding: '0' },
    '.cm-tooltip-lint, .cm-diagnostic': { fontFamily: 'var(--ide-mono)' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--accent-1)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--accent-3)' },
    '.cm-diagnostic-info': { borderLeftColor: 'var(--accent-2)' },
    '.cm-diagnostic': { display: 'flex', flexWrap: 'wrap', gap: '4px 8px' },
    '.cm-diagnosticText': { flex: '1 1 100%', whiteSpace: 'pre-wrap' },
    '.cm-diagnosticAction': {
      backgroundColor: 'var(--ide-selection)',
      color: 'var(--ide-fg-strong)',
      borderRadius: 'var(--radius-xs)',
      padding: '1px 8px',
      margin: '0',
      cursor: 'pointer',
    },
    '.cm-diagnosticAction:hover, .cm-diagnosticAction:focus-visible': {
      backgroundColor: 'var(--accent-2)',
      color: 'var(--ide-bg)',
    },
    '.jai-lint': { display: 'grid', gap: '2px' },
    '.jai-lint code': { fontFamily: 'inherit' },
    '.jai-lint__help': { color: 'var(--ide-muted)' },
    '.jai-lint__rule': {
      justifySelf: 'start',
      color: 'var(--ide-muted)',
      fontSize: '85%',
      textDecoration: 'none',
    },
    '.jai-lint__rule:hover': {
      color: 'var(--accent-2-light)',
      textDecoration: 'underline',
    },
    '.cm-lint-unused': { opacity: '0.6' },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--accent-1)',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--accent-3)',
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
      borderRadius: 'var(--radius-sm)',
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
    // A rule with the label set into it: `──── expands to ────`. It runs to the
    // tooltip's edges like the rules between overloads.
    '.jai-hover__divider': {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: 'var(--ide-muted)',
      fontFamily: 'var(--font-sans)',
      fontSize: '10.5px',
      lineHeight: '1',
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    },
    '.jai-hover__divider::before, .jai-hover__divider::after': {
      content: '""',
      flex: '1',
      borderTop: '1px solid var(--ide-rule)',
    },
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
    // Markdown hovers: code in the mono face, prose in the UI face, every
    // block on the same 10px inset so sections line up.
    '.jai-hover--markdown': {
      padding: '4px 0',
      whiteSpace: 'normal',
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.45',
    },
    '.jai-hover--markdown > *': { margin: '0' },
    '.jai-hover--markdown pre, .jai-hover--markdown code': {
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
    },
    '.jai-hover--markdown pre': {
      padding: '4px 10px',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    },
    '.jai-hover--markdown pre.jai-hover__overload': {
      padding: '5px 10px 5px calc(10px + 2ch)',
    },
    '.jai-hover--markdown p': { padding: '4px 10px' },
    '.jai-hover--markdown .jai-hover__divider': { margin: '6px 0 2px' },
    '.jai-hover--markdown hr': {
      border: 'none',
      borderTop: '1px solid var(--ide-rule)',
      margin: '6px 0',
    },
    '.jai-hover--markdown :is(h1, h2, h3, h4, h5, h6)': {
      padding: '6px 10px 0',
      color: 'var(--ide-fg-strong)',
      fontSize: '1em',
      fontWeight: '650',
    },
    // Lists in documentation (parameters): ordinary bullets on the same inset.
    '.jai-hover--markdown :is(ul, ol)': {
      padding: '2px 10px 4px calc(10px + 1.25em)',
    },
    '.jai-hover--markdown li + li': { marginTop: '2px' },
    // A format-string list: rows like the client-side format hover.
    '.jai-hover--markdown .jai-hover__format': {
      listStyle: 'none',
      padding: '0',
    },
    '.jai-hover--markdown .jai-hover__format > li': {
      margin: '0',
      borderTop: '1px solid var(--ide-rule)',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
    },
    '.jai-hover--markdown .jai-hover__format strong': {
      fontWeight: 'inherit',
    },
    // Plain-text documentation from older servers.
    '.jai-hover--text': {
      padding: '6px 10px',
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.45',
    },
    // Semantic tokens refine the tokenizer's colours; `span` covers either nesting.
    '.cm-sem-type, .cm-sem-type span': { color: 'var(--ide-syntax-type)' },
    '.cm-sem-namespace, .cm-sem-namespace span': {
      color: 'color-mix(in oklch, var(--ide-syntax-type) 70%, var(--ide-fg))',
    },
    '.cm-sem-type-parameter, .cm-sem-type-parameter span': {
      color: 'var(--ide-syntax-type)',
      fontStyle: 'italic',
    },
    '.cm-sem-property, .cm-sem-property span': { color: 'var(--ide-fg)' },
    '.cm-sem-function, .cm-sem-function span': {
      color: 'var(--ide-syntax-function)',
    },
    '.cm-sem-expand, .cm-sem-expand span, .cm-sem-macro, .cm-sem-macro span, .cm-sem-decorator, .cm-sem-decorator span':
      { color: 'var(--ide-syntax-directive)' },
    '.cm-sem-expand, .cm-sem-expand span': { fontStyle: 'italic' },
    '.cm-sem-enum-member, .cm-sem-enum-member span, .cm-sem-constant, .cm-sem-constant span':
      { color: 'var(--ide-syntax-number)' },
    '.cm-sem-format, .cm-sem-format span': {
      color: 'var(--ide-syntax-format)',
      fontWeight: '650',
    },
    '.cm-inlay-hint': {
      padding: '0 3px',
      borderRadius: 'var(--radius-xs)',
      color: 'var(--ide-faint)',
      backgroundColor: 'oklch(100% 0 0 / 0.04)',
      fontSize: '0.86em',
      fontStyle: 'normal',
      fontWeight: '400',
      verticalAlign: '0.04em',
      userSelect: 'none',
      pointerEvents: 'auto',
    },
    '.cm-inlay-hint[data-pad-left]': { marginLeft: '0.5ch' },
    '.cm-inlay-hint[data-pad-right]': { marginRight: '0.5ch' },
    '.cm-lsp-highlight': { backgroundColor: 'var(--ide-selection-match)' },
    '.cm-lsp-highlight--write': {
      boxShadow: 'inset 0 -1px var(--ide-muted)',
    },
    '.cm-lsp-link, .cm-lsp-link span': {
      textDecoration: 'underline',
      textUnderlineOffset: '3px',
      cursor: 'pointer',
    },
    '.cm-lsp-lens': {
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
      lineHeight: '1.5',
      padding: '2px 0 0',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '.cm-lsp-lens__button': {
      padding: '0',
      borderRadius: 'var(--radius-xs)',
      color: 'var(--ide-faint)',
      background: 'none',
      border: 'none',
      font: 'inherit',
      cursor: 'pointer',
    },
    '.cm-lsp-lens__button:hover, .cm-lsp-lens__button:focus-visible': {
      color: 'var(--ide-muted)',
      textDecoration: 'underline',
    },
    '.cm-lsp-bulb': {
      display: 'inline-flex',
      verticalAlign: '-0.15em',
      marginLeft: '1.5ch',
      padding: '1px',
      width: '1.2em',
      height: '1.2em',
      color: 'var(--accent-3-light)',
      background: 'none',
      border: 'none',
      borderRadius: 'var(--radius-xs)',
      cursor: 'pointer',
      opacity: '0.8',
    },
    '.cm-lsp-bulb:hover': { opacity: '1', backgroundColor: 'var(--ide-hover)' },
    '.cm-lsp-bulb svg': {
      width: '100%',
      height: '100%',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.3',
      strokeLinecap: 'round',
    },
    '.cm-lsp-signature': {
      maxWidth: 'min(36rem, calc(100vw - 32px))',
      maxHeight: '16rem',
      overflowY: 'auto',
    },
    '.cm-lsp-signature__label': {
      padding: '5px 10px',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
      color: 'var(--ide-muted)',
      whiteSpace: 'pre-wrap',
    },
    '.cm-lsp-signature__active': {
      color: 'var(--ide-fg-strong)',
      fontWeight: '650',
      textDecoration: 'underline',
      textUnderlineOffset: '3px',
      textDecorationColor: 'var(--accent-3)',
    },
    '.cm-lsp-signature__count': {
      marginRight: '1ch',
      color: 'var(--ide-faint)',
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
    },
    // The active parameter's doc, then the procedure's, each under a rule.
    '.cm-lsp-signature .jai-hover': {
      maxWidth: 'none',
      borderTop: '1px solid var(--ide-rule)',
    },
    '.cm-lsp-signature__parameter': {
      display: 'flex',
      alignItems: 'baseline',
      gap: '1ch',
      paddingLeft: '10px',
      borderTop: '1px solid var(--ide-rule)',
    },
    '.cm-lsp-signature__parameter > code': {
      flex: 'none',
      color: 'var(--ide-fg-strong)',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
    },
    '.cm-lsp-signature__parameter > .jai-hover': {
      flex: '1',
      minWidth: '0',
      borderTop: 'none',
    },
    '.jai-picker': {
      position: 'absolute',
      zIndex: '12',
      display: 'flex',
      flexDirection: 'column',
      width: 'min(30rem, calc(100% - 16px))',
      maxHeight: 'min(20rem, 70%)',
      overflow: 'hidden',
      color: 'var(--ide-fg)',
      backgroundColor: 'var(--ide-raised)',
      border: '1px solid var(--ide-rule)',
      borderRadius: 'var(--radius)',
      boxShadow: '0 10px 30px oklch(0% 0 0 / 0.45)',
      outline: 'none',
    },
    '.jai-picker[data-centered]': {
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
    },
    '.jai-picker__title': {
      padding: '6px 10px',
      color: 'var(--ide-muted)',
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
      borderBottom: '1px solid var(--ide-rule)',
    },
    '.jai-picker__input': {
      margin: '6px',
      padding: '5px 8px',
      color: 'var(--ide-fg-strong)',
      backgroundColor: 'var(--ide-sunken)',
      border: '1px solid var(--ide-rule)',
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      font: '13px var(--ide-mono)',
    },
    '.jai-picker__input:focus': { borderColor: 'var(--accent-2)' },
    '.jai-picker__list': {
      margin: '0',
      padding: '3px 0',
      overflowY: 'auto',
      listStyle: 'none',
    },
    '.jai-picker__item': {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
      columnGap: '1.5ch',
      alignItems: 'baseline',
      padding: '4px 10px',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
      cursor: 'pointer',
    },
    '.jai-picker__item[data-static]': { cursor: 'default' },
    '.jai-picker__item[aria-selected="true"]': {
      color: 'var(--ide-fg-strong)',
      backgroundColor: 'var(--ide-selection)',
    },
    '.jai-picker__label': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    '.jai-picker__detail': {
      color: 'var(--ide-muted)',
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      textAlign: 'right',
    },
    '.jai-picker__preview': {
      gridColumn: '1 / -1',
      color: 'var(--ide-muted)',
      font: '12px var(--ide-mono)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'pre',
    },
    '.jai-picker__empty': {
      padding: '6px 10px',
      color: 'var(--ide-faint)',
      fontFamily: 'var(--font-sans)',
      fontSize: '12px',
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
      background: 'var(--accent-2) !important',
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
      border: '1px solid var(--accent-2)',
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      font: '13px var(--ide-mono)',
      boxShadow: '0 10px 30px oklch(0% 0 0 / 0.45)',
    },
  },
  { dark: true }
);

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
  if (path.endsWith('.toml')) return tomlLanguage;
  return /\.(md|markdown)$/iu.test(path) ? markdownSyntax : [];
};

/**
 * Tab accepts the open completion (as Enter does); otherwise it inserts spaces up to the next
 * indent stop at each cursor, or indents the lines of a selection. Shift-Tab dedents.
 */
const tabKey: KeyBinding = {
  key: 'Tab',
  run: (view) => acceptCompletion(view) || insertIndent(view),
  shift: indentLess,
};

function insertIndent(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.some((range) => !range.empty))
    return indentMore(view);
  const unit = getIndentUnit(state);
  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head);
      const column = countColumn(
        line.text.slice(0, range.head - line.from),
        state.tabSize
      );
      const spaces = ' '.repeat(unit - (column % unit));
      return {
        changes: { from: range.head, insert: spaces },
        range: EditorSelection.cursor(range.head + spaces.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input.indent' }
  );
  return true;
}

export interface EditorOptions {
  text: string;
  /** `update` is the change's ViewUpdate (its transactions say who made it). */
  onChange: (text: string, update: ViewUpdate) => void;
  onCursor?: (line: number, column: number) => void;
  /** The language document shown (a workspace file or a read-only preview). */
  currentDocument?: () => LanguageDocument | undefined;
  service?: () => LanguageClient | undefined;
  language?: EditorLanguage;
  onDefinition?: (offset: number) => Promise<void>;
  onRename?: (offset: number, name: string) => Promise<void>;
  /** With prepareRename: the range that will be renamed, or undefined (with a message shown). */
  onPrepareRename?: (
    offset: number
  ) => Promise<{ from: number; to: number } | undefined>;
  canDefine?: () => boolean;
  canRename?: () => boolean;
  /** Extra keys (references, code actions, symbol search), before the defaults. */
  keys?: { key: string; run: (view: EditorView) => boolean }[];
  /** Language-server decorations, included in every state. */
  extensions?: Extension;
  /** When true the server explains format strings; the client-side hover stays off. */
  serverFormatHover?: () => boolean;
  /** When true the server fills in a completion's documentation on `completionItem/resolve`. */
  resolvesCompletions?: () => boolean;
}

export type Editor = ReturnType<typeof createEditor>;

/*
 * Vim keybindings are one preference for every editor on the page, kept in
 * localStorage. Toggling it reconfigures each live editor.
 */
const VIM_STORAGE_KEY = 'code-editor-vim';
const vimEditors = new Set<(enabled: boolean) => void>();
const vimClicks = new WeakSet<Event>();
const lastFocused = new WeakMap<HTMLElement, EditorView>();
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

/** A jailint finding in the diagnostic tooltip: the finding, its help line and the rule's docs. */
function lintContent(message: string, rule: string, docs: string): HTMLElement {
  const { text, help } = lintMessage(message);
  const root = document.createElement('span');
  root.className = 'jai-lint';
  const finding = document.createElement('span');
  finding.className = 'jai-lint__message';
  finding.append(withCode(text));
  root.append(finding);
  if (help) {
    const line = document.createElement('span');
    line.className = 'jai-lint__help';
    line.append('help: ', withCode(help));
    root.append(line);
  }
  const link = document.createElement('a');
  link.className = 'jai-lint__rule';
  link.href = docs;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = `What jailint's ${rule} rule finds, and how to silence it`;
  link.textContent = `jailint(${rule})`;
  root.append(link);
  return root;
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
      head.append(formatLiteral(info.literal));
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
            code.append(highlighted(entry.argumentText));
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
    currentDocument = () => undefined,
    service = () => undefined,
    language = 'jai',
    onDefinition,
    onRename,
    onPrepareRename,
    canDefine = () => true,
    canRename = () => true,
    keys = [],
    extensions = [],
    serverFormatHover = () => false,
    resolvesCompletions = () => false,
  }: EditorOptions
) {
  const editable = new Compartment();
  const vimMode = new Compartment();
  // Cmd-click (macOS) or Ctrl-click on a name goes to its definition, like F12. The
  // pointer turns into a hand while the modifier is held over a name.
  const definitionPosAt = (view: EditorView, event: MouseEvent) => {
    if (!linkModifier(event) || !onDefinition || !canDefine()) return undefined;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    return view.state.wordAt(pos) || documentLinkAt(view.state, pos)
      ? pos
      : undefined;
  };
  const showLink = (view: EditorView, on: boolean) =>
    view.contentDOM.classList.toggle('cm-definition-link', on);
  const definitionClick = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const pos = definitionPosAt(view, event);
      if (pos === undefined) return false;
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      void onDefinition?.(pos);
      return true;
    },
    mousemove(event, view) {
      showLink(view, definitionPosAt(view, event) !== undefined);
      return false;
    },
    mouseleave(_event, view) {
      showLink(view, false);
      return false;
    },
    keyup(event, view) {
      if (!linkModifier(event)) showLink(view, false);
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
    closeRename();
    const offset = view.state.selection.main.head;
    if (!onPrepareRename) {
      const word = view.state.wordAt(offset);
      openRename(
        view,
        offset,
        word ? view.state.sliceDoc(word.from, word.to) : ''
      );
      return true;
    }
    const doc = view.state.doc;
    void onPrepareRename(offset).then((range) => {
      // The text moved on, or the name can't be renamed (the caller says why).
      if (!range || view.state.doc !== doc) return;
      openRename(view, offset, doc.sliceString(range.from, range.to));
    });
    return true;
  }
  function openRename(view: EditorView, offset: number, value: string) {
    if (!onRename) return;
    const rename = onRename;
    const input = document.createElement('input');
    renameInput = input;
    input.className = 'cm-rename-input';
    input.setAttribute('aria-label', 'Rename symbol');
    input.value = value;
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
  }

  const completions = async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    const current = currentDocument();
    const client = current && !current.readonly ? service() : undefined;
    if (!current || !client) return null;
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
          textDocument: { uri: current.uri },
          position: positionAt(context.state.doc.toString(), context.pos),
        },
        controller.signal
      );
      if (
        currentDocument()?.uri !== current.uri ||
        currentDocument()?.version !== version
      )
        return null;
      const items = Array.isArray(response)
        ? response
        : (response?.items ?? []);
      // Documentation of long lists comes on selection; only while the
      // document is the one the list was made for.
      const resolve = resolvesCompletions()
        ? (item: CompletionItem) =>
            currentDocument()?.uri === current.uri
              ? client
                  .request<CompletionItem | null>(
                    'completionItem/resolve',
                    item
                  )
                  .catch(() => null)
              : Promise.resolve(null)
        : undefined;
      return {
        from: word?.from ?? context.pos,
        options: items
          .filter((item) => item.insertTextFormat !== 2)
          .map((item) => completionOption(item, documentationContent, resolve)),
      };
    } catch {
      return null;
    }
  };
  const hover = hoverTooltip(async (view, position, side) => {
    // The client-side format-string hover is the fallback: a hover from the
    // language server for the same position replaces it, so only one shows.
    // Newer servers explain format strings themselves (with argument types).
    const local =
      language === 'jai' && !serverFormatHover()
        ? formatStringHover(view, position, side)
        : null;
    const current = currentDocument();
    const client = current ? service() : undefined;
    if (!current || !client) return local;
    const version = current.version;
    const text = view.state.doc.toString();
    try {
      const result = await client.request<Hover | null>('textDocument/hover', {
        textDocument: { uri: current.uri },
        position: positionAt(text, position),
      });
      if (
        currentDocument()?.uri !== current.uri ||
        currentDocument()?.version !== version ||
        view.state.doc.toString() !== text
      )
        return null;
      // Markdown from servers that support it; older bundles send plain text.
      const doc = result ? documentation(result.contents) : undefined;
      if (!result || !doc) return local;
      const syntax = languageFor(language);
      return {
        pos: result.range ? offsetAt(text, result.range.start) : position,
        end: result.range ? offsetAt(text, result.range.end) : undefined,
        create: () => ({
          dom:
            doc.kind === 'markdown'
              ? markdownContent(doc.value, syntax, language)
              : plainHoverContent(doc.value, syntax),
        }),
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
        syntaxHighlighting(highlightStyle),
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
          foldingChanged,
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
        // Before the keymap above is consulted: Mod-f, Mod-h, F3, Escape.
        findExtensions,
        autocompletion({ override: [completions], icons: false }),
        hover,
        editable.of(EditorView.editable.of(true)),
        // Before definitionClick, so a Cmd/Ctrl-click on a link follows it.
        extensions,
        definitionClick,
        keymap.of([
          ...keys,
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
          ...foldKeymap,
          ...completionKeymap,
          tabKey,
        ]),
        EditorView.contentAttributes.of({
          'aria-label': `${languageNames[language]} source editor`,
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString(), update);
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
  // A workspace with several editor groups has one editor per group, all
  // listening to the same button: the first listener toggles, and focus
  // returns to whichever of them was focused last.
  const toggleVim = (event: Event) => {
    if (vimClicks.has(event)) return;
    vimClicks.add(event);
    setVimEnabled(!vimEnabled);
    const last = lastFocused.get(vimButton!);
    (last && !last.dom.isConnected ? view : (last ?? view)).focus();
  };
  view.contentDOM.addEventListener('focus', () => {
    if (vimButton) lastFocused.set(vimButton, view);
  });
  vimButton?.setAttribute('aria-pressed', String(vimEnabled));
  vimButton?.addEventListener('click', toggleVim);
  vimEditors.add(applyVim);
  return {
    view,
    createState: state,
    setState: (value: EditorState) => {
      view.setState(value);
      // States made for other files may predate a Vim toggle, and a saved
      // state may still hold the hover that was open when it was left.
      view.dispatch({
        effects: [
          vimMode.reconfigure(vimExtension(vimEnabled)),
          closeHoverTooltips,
        ],
      });
      const cursor = view.state.selection.main.head;
      const line = view.state.doc.lineAt(cursor);
      onCursor(line.number, cursor - line.from + 1);
    },
    /**
     * Shows a document's published diagnostics. `actions` gives a diagnostic
     * its tooltip buttons (a lint's quick fixes); jailint findings also get
     * their help line, a link to the rule's docs and, for `unused_*` rules,
     * a faded range.
     */
    diagnostics(
      values: readonly Diagnostic[],
      documentText: string,
      actions?: (value: Diagnostic) => readonly LintAction[] | undefined
    ) {
      const checked: EditorDiagnostic[] = [];
      for (const value of values) {
        try {
          const rule = lintRule(value);
          const message = String(value.message);
          checked.push({
            from: offsetAt(documentText, value.range.start),
            to: offsetAt(documentText, value.range.end),
            severity:
              value.severity === 2
                ? 'warning'
                : value.severity === 3 || value.severity === 4
                  ? 'info'
                  : 'error',
            message,
            // `jai-format`, `jai-parser`, ... say which check reported it;
            // a lint names its rule in its own footer instead.
            source: rule
              ? undefined
              : typeof value.code === 'string'
                ? value.code
                : value.source,
            ...(rule && {
              renderMessage: () => lintContent(message, rule, lintDocs(value)),
              markClass: isUnusedRule(rule) ? 'cm-lint-unused' : undefined,
            }),
            actions: actions?.(value),
          });
        } catch {
          /* Invalid server ranges never become guessed editor positions. */
        }
      }
      view.dispatch(setDiagnostics(view.state, checked));
    },
    find: () => openFind(view),
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
