// A small WGSL tokenizer for the bodies of `#string WGSL` here-strings: comments (block
// comments nest), attributes, keywords, types, numbers and declared or called names. It colours
// with the same style names as the Jai tokenizer, so the editor's theme covers both.
import type { StreamParser, StringStream } from '@codemirror/language';

export interface WgslState {
  commentDepth: number;
  /** The previous word was `fn`, so the next name is a declared function. */
  afterFn: boolean;
}

const keywords = new Set(
  'alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override requires return struct switch true var while'.split(
    ' '
  )
);
const types =
  /^(?:bool|i32|u32|f32|f16|vec[234][iufh]?|mat[234]x[234][fh]?|array|atomic|ptr|sampler|sampler_comparison|texture_(?:1d|2d|2d_array|3d|cube|cube_array|multisampled_2d|external|storage_(?:1d|2d|2d_array|3d)|depth_(?:2d|2d_array|cube|cube_array|multisampled_2d)))$/u;
/** Address spaces and access modes, as in `var<storage, read_write>`. */
const modifiers = new Set(
  'function private workgroup uniform storage handle read write read_write'.split(
    ' '
  )
);
const identifier = /^[_\p{L}][_\p{L}\p{N}]*/u;

function comment(stream: StringStream, state: WgslState) {
  while (!stream.eol()) {
    if (stream.match('/*')) state.commentDepth++;
    else if (stream.match('*/')) {
      if (--state.commentDepth === 0) break;
    } else stream.next();
  }
  return 'comment';
}

export const wgslTokenizer: StreamParser<WgslState> = {
  name: 'wgsl',
  startState: () => ({ commentDepth: 0, afterFn: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.commentDepth) return comment(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.commentDepth = 1;
      return comment(stream, state);
    }
    const afterFn = state.afterFn;
    state.afterFn = false;
    if (stream.match(/^@\s*[_\p{L}][_\p{L}\p{N}]*/u)) return 'note';
    if (
      stream.match(
        /^(?:0[xX][\da-fA-F]+[iu]?|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?[fh]?|\d+[eE][+-]?\d+[fh]?|\d+[iufh]?)/u
      )
    )
      return 'number';
    const name = stream.match(identifier) as RegExpMatchArray | null;
    if (name) {
      const word = name[0];
      if (afterFn) return 'procedureName';
      if (word === 'fn') state.afterFn = true;
      if (keywords.has(word)) return 'keyword';
      if (types.test(word)) return 'typeName';
      if (
        modifiers.has(word) &&
        /^\s*[,>]/u.test(stream.string.slice(stream.pos))
      )
        return 'keyword';
      if (/^\s*\(/u.test(stream.string.slice(stream.pos)))
        return 'procedureName';
      return 'variableName';
    }
    const ch = stream.next();
    if (!ch) return null;
    return '{}()[],;:.'.includes(ch) ? 'punctuation' : 'operator';
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
};
