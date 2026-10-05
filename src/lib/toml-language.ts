import { StreamLanguage, type StreamParser } from '@codemirror/language';

interface TomlState {
  /** Inside a multi-line string, its closing delimiter. */
  closing?: string;
  /** Left of `=` on the current line, so a bare word is a key. */
  key: boolean;
}

function finishString(
  stream: Parameters<StreamParser<TomlState>['token']>[0],
  state: TomlState
) {
  const closing = state.closing!;
  while (!stream.eol()) {
    if (stream.match(closing)) {
      state.closing = undefined;
      return 'string';
    }
    // Basic strings take escapes; literal (') ones don't.
    if (closing.startsWith('"') && stream.next() === '\\') stream.next();
    else if (!closing.startsWith('"')) stream.next();
  }
  // A one-line string left open ends at the line; a triple-quoted one carries over.
  if (closing.length === 1) state.closing = undefined;
  return 'string';
}

/** Highlighting for `jaifmt.toml` and other TOML files in a workspace. */
const tomlParser: StreamParser<TomlState> = {
  name: 'toml',
  startState: () => ({ key: true }),
  token(stream, state) {
    if (state.closing) return finishString(stream, state);
    if (stream.sol()) state.key = true;
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.sol() && stream.match(/^\[\[?[^\]]*\]\]?/u)) return 'heading';
    const quote = stream.match(/^("""|'''|"|')/u) as RegExpMatchArray | null;
    if (quote) {
      state.closing = quote[0];
      return finishString(stream, state);
    }
    if (stream.eat('=')) {
      state.key = false;
      return 'operator';
    }
    if (state.key && stream.match(/^[\w.-]+/u)) return 'propertyName';
    if (stream.match(/^(true|false)\b/u)) return 'bool';
    if (
      stream.match(
        /^[+-]?(inf|nan|0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|[\d_]+(\.[\d_]+)?([eE][+-]?\d+)?)/u
      )
    )
      return 'number';
    if (stream.match(/^[[\]{},]/u)) return 'punctuation';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

export const tomlLanguage = StreamLanguage.define(tomlParser);
