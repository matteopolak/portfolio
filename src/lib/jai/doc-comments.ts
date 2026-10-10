/*
 * Markdown inside Jai comments, for highlighting only. Comments directly
 * above a declaration are its documentation (the compiler's
 * `docs/compiler/doc-comments.md`), and the language server renders them as
 * Markdown in hover, completion and signature help. In the source they keep
 * their markers, so text width never changes; only the styling does.
 *
 * This mirrors the VS Code extension's injection grammar
 * (`editors/vscode/syntaxes/jai-doc-comments.tmLanguage.json` in the jai
 * repository): the same regular expressions, scanned the way TextMate does
 * (earliest match first, ties to the earlier pattern, no nesting). Code
 * fences inside comments are not highlighted as code.
 *
 * Pure, so the tokenizer (`language.ts`), the blog highlighter and tests
 * share it.
 */

export type DocStyle =
  | 'heading'
  | 'list'
  | 'strong'
  | 'emphasis'
  | 'code'
  | 'link';

/** A run of comment text and the Markdown styles on it (none: plain comment). */
export interface DocSegment {
  from: number;
  to: number;
  styles: DocStyle[];
}

/** Where a comment sits on one line. */
export interface CommentExtent {
  /** The comment's first character on this line (its `//` or `/*`, or 0 when continued). */
  from: number;
  /** Its end on this line (after `*\/`, or the end of the line). */
  to: number;
  /** The text between the markers. */
  contentFrom: number;
  contentTo: number;
  /**
   * `line`: a `//` comment; `block`: a line of a `/* *\/` comment that began
   * on an earlier line; `block-start`: the line a block comment opens on.
   */
  kind: 'line' | 'block' | 'block-start';
}

/** Inline patterns in the grammar's order; `groups` are the styled capture groups (0: all). */
const inline: { pattern: RegExp; style: DocStyle; groups: number[] }[] = [
  {
    pattern: /(?<!`)(`+)(?!`)(.+?)(?<!`)(\1)(?!`)/dgu,
    style: 'code',
    groups: [0],
  },
  {
    pattern: /(?<![\w\\])(\*\*)(?=\S)(.+?)(?<=\S)(\*\*)(?!\w)/dgu,
    style: 'strong',
    groups: [0],
  },
  {
    pattern: /(?<![\w*\\])(\*)(?![\s*])([^*]+?)(?<![\s\\])(\*)(?![\w*])/dgu,
    style: 'emphasis',
    groups: [0],
  },
  {
    pattern: /(?<![\w\\])(_)(?![\s_])([^_]+?)(?<![\s\\])(_)(?!\w)/dgu,
    style: 'emphasis',
    groups: [0],
  },
  // `[text](target)`: the text and the target.
  {
    pattern: /(?<![\w\])])(\[)([^[\]]+)(\])(\()([^)\s]*)(\))/dgu,
    style: 'link',
    groups: [2, 5],
  },
  // `[name]`, `[Type.member]`, ``[`name`]``, `[name()]`: the name.
  {
    pattern: /(?<![\w\])])(\[)(`?[A-Za-z_][\w.]*(?:\(\))?`?)(\])(?![[(])/dgu,
    style: 'link',
    groups: [2],
  },
];

/** `# Heading` and list markers at the start of a whole-line `//` comment. */
const lineHeading = /^(\s*)(\/\/[/!]?)(\s{0,3})(#{1,6})(?= )/du;
const lineBullet = /^(\s*)(\/\/[/!]?)(\s{0,8})([-*+]|\d+[.)])(?= )/du;
/** The same on a continuation line of a block comment (after an optional `*`). */
const blockHeading = /^(\s*\*?[ ]?)((#{1,6})[ ].*)$/du;
const blockBullet = /^(\s*\*?[ ]?)([-*+]|\d+[.)])(?=[ ])/du;

interface Span {
  from: number;
  to: number;
  style: DocStyle;
}

/** Inline Markdown spans in `line` between `from` and `to`. */
function inlineSpans(line: string, from: number, to: number): Span[] {
  const text = line.slice(0, to);
  const spans: Span[] = [];
  let pos = from;
  while (pos < to) {
    let best: { match: RegExpExecArray; rule: (typeof inline)[number] } | null =
      null;
    for (const rule of inline) {
      rule.pattern.lastIndex = pos;
      const match = rule.pattern.exec(text);
      if (match && (!best || match.index < best.match.index))
        best = { match, rule };
    }
    if (!best) break;
    const { match, rule } = best;
    for (const group of rule.groups) {
      const range = match.indices?.[group];
      if (range && range[1] > range[0])
        spans.push({ from: range[0], to: range[1], style: rule.style });
    }
    pos = Math.max(match.index + match[0].length, pos + 1);
  }
  return spans;
}

/**
 * The comment on this line split into segments that cover `extent.from` to
 * `extent.to`, each with the Markdown styles that apply to it.
 */
export function docCommentSegments(
  line: string,
  extent: CommentExtent
): DocSegment[] {
  const { from, to, contentFrom, contentTo, kind } = extent;
  const spans: Span[] = [];
  let inlineFrom = contentFrom;
  const ownLine = kind === 'line' && line.slice(0, from).trim() === '';
  if (ownLine || kind === 'block') {
    const tail = line.slice(0, contentTo);
    const heading = (kind === 'line' ? lineHeading : blockHeading).exec(tail);
    const bullet = heading
      ? null
      : (kind === 'line' ? lineBullet : blockBullet).exec(tail);
    // The heading runs from its `#` to the end of the line.
    const headingAt = heading?.indices?.[kind === 'line' ? 4 : 2];
    if (headingAt)
      spans.push({ from: headingAt[0], to: contentTo, style: 'heading' });
    const marker = bullet?.indices?.[kind === 'line' ? 4 : 2];
    if (marker && marker[0] >= contentFrom) {
      spans.push({ from: marker[0], to: marker[1], style: 'list' });
      // The marker is not the start of `*emphasis*`.
      inlineFrom = marker[1];
    }
  }
  spans.push(...inlineSpans(line, inlineFrom, contentTo));

  const cuts = new Set([from, to]);
  for (const span of spans) cuts.add(span.from).add(span.to);
  const points = [...cuts]
    .filter((at) => at >= from && at <= to)
    .sort((a, b) => a - b);
  const segments: DocSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i],
      end = points[i + 1];
    const styles = [
      ...new Set(
        spans
          .filter((span) => span.from <= start && span.to >= end)
          .map((span) => span.style)
      ),
    ];
    const previous = segments.at(-1);
    if (previous && previous.styles.join() === styles.join()) previous.to = end;
    else segments.push({ from: start, to: end, styles });
  }
  return segments;
}
