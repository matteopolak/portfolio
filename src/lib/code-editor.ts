import { EditorState, Compartment, type Extension } from '@codemirror/state';
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
  closeHoverTooltips,
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
  type Action as LintAction,
  type Diagnostic as EditorDiagnostic,
} from '@codemirror/lint';
import { tags, highlightTree } from '@lezer/highlight';
import DOMPurify from 'dompurify';
import { markdownHover, renderHoverMarkdown } from './hover-markdown.ts';
import {
  jaiTokenizer,
  jaiLanguage,
  formatSpecifierTag,
  formatPercentTag,
} from './jai/language.ts';
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
    '.cm-diagnostic': { display: 'flex', flexWrap: 'wrap', gap: '4px 8px' },
    '.cm-diagnosticText': { flex: '1 1 100%', whiteSpace: 'pre-wrap' },
    '.cm-diagnosticAction': {
      backgroundColor: 'var(--ide-selection)',
      color: 'var(--ide-fg-strong)',
      borderRadius: '3px',
      padding: '1px 8px',
      margin: '0',
      cursor: 'pointer',
    },
    '.cm-diagnosticAction:hover, .cm-diagnosticAction:focus-visible': {
      backgroundColor: 'var(--blue)',
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
      color: 'var(--blue)',
      textDecoration: 'underline',
    },
    '.cm-lint-unused': { opacity: '0.6' },
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
    // A list is a format-string hover: rows like the client-side one.
    '.jai-hover--markdown ul, .jai-hover--markdown ol': {
      listStyle: 'none',
      padding: '0',
    },
    '.jai-hover--markdown li': {
      borderTop: '1px solid var(--ide-rule)',
      fontFamily: 'var(--ide-mono)',
      fontSize: '12.5px',
    },
    '.jai-hover--markdown li strong': { fontWeight: 'inherit' },
    // Semantic tokens refine the tokenizer's colours; `span` covers either nesting.
    '.cm-sem-type, .cm-sem-type span': { color: 'var(--ide-syntax-type)' },
    '.cm-sem-namespace, .cm-sem-namespace span': {
      color: 'color-mix(in oklch, var(--ide-syntax-type) 70%, var(--ide-fg))',
    },
    '.cm-sem-type-parameter, .cm-sem-type-parameter span': {
      color: 'var(--ide-syntax-type)',
      fontStyle: 'italic',
    },
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
      borderRadius: '3px',
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
      color: 'var(--yellow)',
      background: 'none',
      border: 'none',
      borderRadius: '3px',
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
      padding: '5px 10px',
      maxWidth: 'min(36rem, calc(100vw - 32px))',
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
      textDecorationColor: 'var(--yellow)',
    },
    '.cm-lsp-signature__count': {
      marginRight: '1ch',
      color: 'var(--ide-faint)',
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
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
      borderRadius: '6px',
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
      borderRadius: '4px',
      outline: 'none',
      font: '13px var(--ide-mono)',
    },
    '.jai-picker__input:focus': { borderColor: 'var(--blue)' },
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
  if (path.endsWith('.toml')) return tomlLanguage;
  return /\.(md|markdown)$/iu.test(path) ? markdownSyntax : [];
};

export interface EditorOptions {
  text: string;
  onChange: (text: string) => void;
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

/**
 * A Markdown hover (see `hover-markdown.ts`), sanitized, with its code in the
 * editor's colours. Fenced blocks in the editor's language (or untagged) and
 * inline code are highlighted; other fences (`text`: what `#run` printed)
 * stay plain. A list is a format-string hover: one row per `%`, the leading
 * code of each row is the specifier, and a bold one is the hovered row.
 */
function markdownHoverContent(
  markdown: string,
  language: EditorLanguage
): HTMLElement {
  const syntax = languageFor(language);
  const dom = document.createElement('div');
  dom.className = 'jai-hover jai-hover--markdown';
  dom.innerHTML = DOMPurify.sanitize(renderHoverMarkdown(markdown));
  for (const code of dom.querySelectorAll<HTMLElement>('pre > code')) {
    const fence = code.parentElement?.dataset.lang ?? '';
    if (fence !== '' && fence !== language) continue;
    const source = code.textContent ?? '';
    // A string literal on its own is a format string: colour it as the
    // argument of a `print` call so its `%` specifiers stand out.
    code.replaceChildren(
      language === 'jai' && /^"(?:[^"\\\n]|\\.)*"$/u.test(source)
        ? highlighted(`print(${source})`, jaiLanguage, 6, source.length)
        : highlighted(source, syntax)
    );
  }
  for (const code of dom.querySelectorAll<HTMLElement>(':not(pre) > code')) {
    const row = code.closest('li');
    const leading =
      row &&
      (row.firstElementChild === code ||
        (row.firstElementChild?.tagName === 'STRONG' &&
          code.parentElement === row.firstElementChild));
    if (leading) code.classList.add('jai-hover__format-spec');
    else code.replaceChildren(highlighted(code.textContent ?? '', syntax));
  }
  for (const row of dom.querySelectorAll<HTMLElement>('li')) {
    row.classList.add('jai-hover__format-row');
    if (row.firstElementChild?.tagName === 'STRONG')
      row.dataset.current = 'true';
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

/** Text with `code` spans highlighted as Jai, as jailint writes names and snippets. */
function withCode(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  text.split(/(`[^`\n]+`)/u).forEach((part, index) => {
    if (index % 2 === 0) {
      if (part) fragment.append(part);
      return;
    }
    const code = document.createElement('code');
    code.append(highlighted(part.slice(1, -1), jaiLanguage));
    fragment.append(code);
  });
  return fragment;
}

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
    return view.state.wordAt(pos) || documentLinkAt(view.state, pos)
      ? pos
      : undefined;
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
      const markdown = result ? markdownHover(result.contents) : undefined;
      const contents = result ? (markdown ?? textContent(result.contents)) : '';
      if (!result || !contents.trim()) return local;
      return {
        pos: result.range ? offsetAt(text, result.range.start) : position,
        end: result.range ? offsetAt(text, result.range.end) : undefined,
        create() {
          return {
            dom:
              markdown === undefined
                ? hoverContent(contents, languageFor(language))
                : markdownHoverContent(markdown, language),
          };
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
