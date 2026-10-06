// Format strings of Jai's print family, shared by the tokenizer and the hover.

/**
 * Procedures whose argument at this index is a format string. The tokenizer
 * highlights `%` only inside that argument when it is a string literal.
 */
export const formatCallees: ReadonlyMap<string, number> = new Map([
  ['print', 0],
  ['tprint', 0],
  ['sprint', 0],
  ['log', 0],
  ['log_error', 0],
  ['log_warning', 0],
  ['print_to_builder', 1],
  ['assert', 1],
]);

/** One format sequence inside a format string, as offsets into the literal. */
export interface FormatSpec {
  from: number;
  to: number;
  /**
   * `argument` formats an argument; `percent` is the `\%` escape, a literal
   * percent sign; `empty` is `%00`, which prints nothing.
   */
  kind: 'argument' | 'percent' | 'empty';
  /** Zero-based index into the arguments after the format string. */
  argument?: number;
}

/**
 * The specifiers of a string literal's text (the part after the opening
 * quote), following the compiler's `Basic` print:
 *
 * - `%` (or `%0`) takes the next argument;
 * - `%N` takes the Nth (1-based), and a following `%` continues after it;
 * - `%%` is simply two `%`, so two arguments;
 * - `%00` prints nothing;
 * - `\%` is a literal percent sign.
 *
 * Scanning stops at the closing quote.
 */
export function formatSpecs(body: string): FormatSpec[] {
  const specs: FormatSpec[] = [];
  let next = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      if (body[i + 1] === '%')
        specs.push({ from: i, to: i + 2, kind: 'percent' });
      i++;
    } else if (ch === '"') break;
    else if (ch === '%') {
      const from = i;
      const digits = /^(?:00|0|[1-9]\d*)/u.exec(body.slice(i + 1))?.[0] ?? '';
      i += digits.length;
      if (digits === '00') {
        specs.push({ from, to: i + 1, kind: 'empty' });
        continue;
      }
      const argument = digits && digits !== '0' ? Number(digits) - 1 : next;
      next = argument + 1;
      specs.push({ from, to: i + 1, kind: 'argument', argument });
    }
  }
  return specs;
}

/** `text` with comments blanked out, leaving strings intact. */
function withoutComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++)
        if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (text.startsWith('//', i)) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
      out += ' ';
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 1;
      out += ' ';
    } else out += ch;
  }
  return out;
}

/**
 * The comma-separated arguments that follow a format string, as trimmed
 * source text. `text` starts just after the closing quote. Nested brackets,
 * strings and comments are skipped; parsing stops at the call's `)`.
 */
export function trailingArguments(source: string): string[] {
  const text = withoutComments(source);
  const args: string[] = [];
  let depth = 0;
  let start = -1;
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++)
        if (text[i] === '\\') i++;
    } else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      if (start >= 0) args.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (ch === ';' && depth === 0) {
      end = i;
      break;
    } else if (depth === 0 && start < 0 && !/\s/u.test(ch)) return args;
  }
  if (start >= 0) args.push(text.slice(start, end).trim());
  return args;
}

/** One specifier of a format string, with the argument it formats. */
export interface FormatEntry {
  /** The specifier's source, e.g. `%`, `%2` or `\%`. */
  text: string;
  spec: FormatSpec;
  /** Source text of the argument, when the call passes one. */
  argumentText?: string;
}

export interface FormatString {
  /** Document offsets of the whole literal, quotes included. */
  from: number;
  to: number;
  literal: string;
  entries: FormatEntry[];
}

/**
 * The format string literal around `offset` and what each of its specifiers
 * formats. The caller must already know the literal is a format string (the
 * tokenizer decides that). Jai string literals do not span lines, so the
 * literal is found on `offset`'s line.
 */
export function formatStringAt(
  text: string,
  offset: number
): FormatString | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let lineEnd = text.indexOf('\n', offset);
  if (lineEnd < 0) lineEnd = text.length;
  for (let i = lineStart; i < lineEnd; i++) {
    if (text.startsWith('//', i)) return null;
    if (text[i] !== '"') continue;
    const open = i;
    for (i++; i < lineEnd && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    const to = Math.min(i + 1, lineEnd);
    if (offset < open || offset >= to) continue;
    const body = text.slice(open + 1, to);
    const args = trailingArguments(text.slice(to));
    return {
      from: open,
      to,
      literal: text.slice(open, to),
      entries: formatSpecs(body).map((spec) => ({
        text: body.slice(spec.from, spec.to),
        spec,
        argumentText:
          spec.argument === undefined ? undefined : args[spec.argument],
      })),
    };
  }
  return null;
}

/** One entry as plain text, e.g. `%2 → player.name`. */
export function describeFormatEntry(entry: FormatEntry): string {
  const { spec } = entry;
  if (spec.kind === 'percent') return `${entry.text} → a literal %`;
  if (spec.kind === 'empty') return `${entry.text} → nothing`;
  return entry.argumentText === undefined
    ? `${entry.text} → argument ${(spec.argument ?? 0) + 1}, not passed`
    : `${entry.text} → ${entry.argumentText}`;
}
