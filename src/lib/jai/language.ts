// Stateful lexical coloring. Source always stays in CodeMirror text nodes.
import {
  StreamLanguage,
  type StreamParser,
  type StringStream,
} from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';
import { formatCallees } from './format-string.ts';
import { embeddedLanguageFor } from './embedded-languages.ts';
import { wgslTokenizer, type WgslState } from './wgsl.ts';

/** `%`, `%N` and `%00` in a print-family format string. */
export const formatSpecifierTag = Tag.define(tags.string);
/** `\%`, the escaped (literal) percent sign in a format string. */
export const formatPercentTag = Tag.define(tags.string);
const keywords = new Set(
  'if else ifx for while break continue return defer using struct union enum operator cast remove inline no_inline interface push_context pop_context null true false new delete case switch then it_index it'.split(
    ' '
  )
);
const types = new Set(
  'void bool int s8 s16 s32 s64 u8 u16 u32 u64 float float32 float64 string Type Any Code Context'.split(
    ' '
  )
);
/** The tokenizer of a language-tagged here-string's body (`#string WGSL`) and its state. */
type Embedded =
  | { language: 'wgsl'; state: WgslState }
  | { language: 'jai'; state: JaiState };
/** An open print-family call: its bracket depth and arguments left before the format string. */
interface FormatCall {
  depth: number;
  argument: number;
}
export interface JaiState {
  commentDepth: number;
  string: boolean;
  /** The open string is a format string, so `%` sequences are tokens. */
  format: boolean;
  hereTag: string | null;
  /** The open here-string's body is in another language (see embedded-languages.ts). */
  embedded: Embedded | null;
  depth: number;
  /** Format-argument index of a print-family name awaiting its `(`. */
  callee: number | null;
  calls: FormatCall[];
}
const identifier = /^[_\p{L}][_\p{L}\p{N}]*/u;
function comment(stream: StringStream, state: JaiState) {
  while (!stream.eol()) {
    if (stream.match('/*')) state.commentDepth++;
    else if (stream.match('*/')) {
      if (--state.commentDepth === 0) break;
    } else stream.next();
  }
  return 'comment';
}
function string(stream: StringStream, state: JaiState) {
  // Format-string text is its own token so the hover can find the literal.
  const style = state.format ? 'formatString' : 'string';
  // Format sequences are tokens of their own, never merged with the quote.
  if (state.format && stream.pos === stream.start) {
    if (stream.match('\\%')) return 'formatPercent';
    if (stream.eat('%')) {
      stream.match(/^(?:00|0|[1-9]\d*)/u);
      return 'formatSpecifier';
    }
  }
  while (!stream.eol()) {
    if (
      state.format &&
      stream.pos > stream.start &&
      (stream.peek() === '%' || stream.match('\\%', false))
    )
      return style;
    const ch = stream.next();
    if (ch === '\\') stream.next();
    else if (ch === '"') {
      state.string = false;
      state.format = false;
      break;
    }
  }
  return style;
}
export const jaiTokenizer: StreamParser<JaiState> = {
  startState: () => ({
    commentDepth: 0,
    string: false,
    format: false,
    hereTag: null,
    embedded: null,
    depth: 0,
    callee: null,
    calls: [],
  }),
  copyState: (state) => ({
    ...state,
    embedded: state.embedded && copyEmbedded(state.embedded),
    calls: state.calls.map((call) => ({ ...call })),
  }),
  token(stream, state) {
    // Comments and whitespace may sit between a print-family name and its `(`.
    const callee = state.callee;
    const style = token(stream, state);
    if (style !== null && style !== 'comment' && state.callee === callee)
      state.callee = null;
    return style;
  },
  indent(state, textAfter, context) {
    if (state.commentDepth || state.string || state.hereTag) return null;
    return (
      Math.max(0, state.depth - (/^\s*[}\])]/u.test(textAfter) ? 1 : 0)) *
      context.unit
    );
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
  tokenTable: {
    procedureName: tags.function(tags.variableName),
    typeName: tags.typeName,
    directive: tags.processingInstruction,
    note: tags.annotation,
    formatString: tags.string,
    formatSpecifier: formatSpecifierTag,
    formatPercent: formatPercentTag,
  },
};
function token(stream: StringStream, state: JaiState): string | null {
  if (state.hereTag) {
    if (stream.sol()) {
      const text = stream.string.trimStart();
      if (
        text.startsWith(state.hereTag) &&
        !/[_\p{L}\p{N}]/u.test(text[state.hereTag.length] ?? '')
      ) {
        stream.pos = stream.string.length - text.length + state.hereTag.length;
        state.hereTag = null;
        state.embedded = null;
        // The closing tag matches the opening `#string TAG`.
        return 'directive';
      }
    }
    if (state.embedded) return embeddedToken(stream, state.embedded);
    stream.skipToEnd();
    return 'string';
  }
  if (state.commentDepth) return comment(stream, state);
  if (state.string) return string(stream, state);
  if (stream.eatSpace()) return null;
  if (stream.match('//')) {
    stream.skipToEnd();
    return 'comment';
  }
  if (stream.match('/*')) {
    state.commentDepth = 1;
    return comment(stream, state);
  }
  if (stream.match('"')) {
    state.string = true;
    const call = state.calls.at(-1);
    if (call?.depth === state.depth && call.argument === 0) {
      state.format = true;
      // Only the first string in that argument slot is the format.
      call.argument = -1;
    }
    return string(stream, state);
  }
  if (stream.match(/^#string\b/u)) {
    // Original lexer permits comma modifiers, including escaped characters.
    const header = stream.match(
      /^(?:\s*,\s*(?:\\\S|[_\p{L}][_\p{L}\p{N}]*))*\s+([_\p{L}][_\p{L}\p{N}]*)/u
    ) as RegExpMatchArray | null;
    if (header) {
      state.hereTag = header[1] ?? null;
      state.embedded = startEmbedded(header[1] ?? '');
      stream.skipToEnd();
    }
    return 'directive';
  }
  if (stream.match(/^#[_\p{L}][_\p{L}\p{N}]*/u)) return 'directive';
  if (stream.match(/^@[_\p{L}][_\p{L}\p{N}]*/u)) return 'note';
  // `..` is one operator, so `1..12` is not `1.` then `.12`.
  if (stream.match('..')) return 'operator';
  if (
    stream.match(
      /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[hH][\da-fA-F_]+|\d[\d_]*(?:\.(?!\.)[\d_]*)?(?:[eE][+-]?[\d_]+)?)/u
    ) ||
    (!continuesOperand(stream) &&
      stream.match(/^\.\d[\d_]*(?:[eE][+-]?[\d_]+)?/u))
  )
    return 'number';
  const name = stream.match(identifier) as RegExpMatchArray | null;
  if (name) {
    // A print-family name opens a format call if `(` comes next.
    state.callee = formatCallees.get(name[0]) ?? null;
    if (types.has(name[0])) return 'typeName';
    if (keywords.has(name[0])) return 'keyword';
    if (/^\s*::\s*(?:#type\s*)?\(/u.test(stream.string.slice(stream.pos)))
      return 'procedureName';
    if (
      /^\s*::\s*(?:struct|union|enum|#type)\b/u.test(
        stream.string.slice(stream.pos)
      )
    )
      return 'typeName';
    return 'variableName';
  }
  const ch = stream.next();
  if (!ch) return null;
  if ('({['.includes(ch)) {
    state.depth++;
    if (ch === '(' && state.callee !== null) {
      state.calls.push({ depth: state.depth, argument: state.callee });
      state.callee = null;
    }
  }
  if (')}]'.includes(ch)) {
    state.depth = Math.max(0, state.depth - 1);
    // Also drops calls left open by unbalanced brackets.
    while ((state.calls.at(-1)?.depth ?? 0) > state.depth) state.calls.pop();
  }
  const call = state.calls.at(-1);
  if (ch === ',' && call?.depth === state.depth) call.argument--;
  return '{}()[],;'.includes(ch) ? 'punctuation' : 'operator';
}
function startEmbedded(tag: string): Embedded | null {
  switch (embeddedLanguageFor(tag)) {
    case 'wgsl':
      return { language: 'wgsl', state: wgslTokenizer.startState!(4) };
    case 'jai':
      return { language: 'jai', state: jaiTokenizer.startState!(4) };
    default:
      return null;
  }
}
function copyEmbedded(embedded: Embedded): Embedded {
  return embedded.language === 'wgsl'
    ? { language: 'wgsl', state: wgslTokenizer.copyState!(embedded.state) }
    : { language: 'jai', state: jaiTokenizer.copyState!(embedded.state) };
}
/** A token of the body, up to the end of the line at most (the terminator starts a line). */
function embeddedToken(
  stream: StringStream,
  embedded: Embedded
): string | null {
  return embedded.language === 'wgsl'
    ? wgslTokenizer.token(stream, embedded.state)
    : jaiTokenizer.token(stream, embedded.state);
}
/** Whether a `.` here continues an expression (`x.5`, `a[0].1`), as in jaic's lexer. */
function continuesOperand(stream: StringStream): boolean {
  const prev = stream.string[stream.pos - 1];
  return prev !== undefined && /[_\p{L}\p{N})\]."]/u.test(prev);
}
export const jaiLanguage = StreamLanguage.define(jaiTokenizer);
