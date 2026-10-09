/*
 * The pure parts of the playground's terminal: splitting a command line like
 * a shell does, the history of lines typed, and the line editor that turns
 * keystrokes into a line plus the screen updates that show it. Nothing here
 * touches the DOM or xterm, so tests drive it with plain strings.
 */

export type ParsedCommand =
  | { ok: true; name: string; args: string[] }
  | { ok: false; error: string };

/**
 * Splits `line` into a command name and arguments. Whitespace separates
 * words; `'single quotes'` keep everything literal; `"double quotes"` keep
 * spaces and honour `\"`, `\\`, `\$` and `` \` ``; outside quotes a backslash
 * escapes the next character. Adjacent quoted and bare parts form one word
 * (`a"b c"d` is `ab cd`), and `""` is an empty argument. No expansion is done.
 */
export function parseCommandLine(line: string): ParsedCommand {
  const words: string[] = [];
  let word: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return { ok: false, error: "unterminated quote '" };
      word = (word ?? '') + line.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let text = '';
      let closed = false;
      for (i++; i < line.length; i++) {
        const d = line[i];
        if (d === '"') {
          closed = true;
          break;
        }
        if (d === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1]))
          text += line[++i];
        else text += d;
      }
      if (!closed) return { ok: false, error: 'unterminated quote "' };
      word = (word ?? '') + text;
    } else if (c === '\\') {
      if (i + 1 >= line.length)
        return { ok: false, error: 'trailing backslash' };
      word = (word ?? '') + line[++i];
    } else word = (word ?? '') + c;
  }
  if (word !== undefined) words.push(word);
  if (!words.length) return { ok: false, error: '' };
  return { ok: true, name: words[0], args: words.slice(1) };
}

/** Quotes `arg` so `parseCommandLine` reads it back unchanged. */
export function quoteArgument(arg: string): string {
  if (arg !== '' && /^[\w@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export const HISTORY_LIMIT = 200;

/** Lines typed at the prompt, newest last, walked with up and down. */
export class History {
  #entries: string[];
  #at: number;
  #draft = '';

  constructor(entries: readonly string[] = []) {
    this.#entries = entries.slice(-HISTORY_LIMIT);
    this.#at = this.#entries.length;
  }

  get entries(): readonly string[] {
    return this.#entries;
  }

  /** Remembers a submitted line (blank lines and immediate repeats are not kept). */
  add(line: string) {
    if (line.trim() && this.#entries.at(-1) !== line) {
      this.#entries.push(line);
      if (this.#entries.length > HISTORY_LIMIT) this.#entries.shift();
    }
    this.reset();
  }

  /** Back to the end, forgetting the draft. */
  reset() {
    this.#at = this.#entries.length;
    this.#draft = '';
  }

  /** The older line, keeping `current` as the draft when leaving the end. */
  previous(current: string): string | undefined {
    if (this.#at === 0) return undefined;
    if (this.#at === this.#entries.length) this.#draft = current;
    return this.#entries[--this.#at];
  }

  /** The newer line, or the draft after the newest. */
  next(): string | undefined {
    if (this.#at >= this.#entries.length) return undefined;
    this.#at++;
    return this.#at === this.#entries.length
      ? this.#draft
      : this.#entries[this.#at];
  }
}

export function parseHistory(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((line): line is string => typeof line === 'string')
      : [];
  } catch {
    return [];
  }
}

export interface EditorHost {
  /** Writes to the screen. */
  write(text: string): void;
  /** The screen's width in columns. */
  columns(): number;
}

export type EditorResult =
  | { type: 'submit'; line: string }
  | { type: 'interrupt' }
  /** Ctrl+D: `line` is what was typed when it came (empty means end of input). */
  | { type: 'eof'; line: string }
  | { type: 'clear' };

/**
 * One line being typed. `prefix` is the text already on the screen before the
 * line starts (a prompt, or whatever a program printed before it read), `width`
 * its length in columns; the line is redrawn from there whenever it changes.
 * Characters are assumed to be one column wide.
 */
export class LineEditor {
  text = '';
  cursor = 0;
  readonly #host: EditorHost;
  readonly #origin: number;
  readonly #history: History | undefined;
  /** Rows the cursor sits below the line's first row. */
  #row = 0;

  constructor(host: EditorHost, origin: number, history?: History) {
    this.#host = host;
    this.#origin = origin;
    this.#history = history;
  }

  /**
   * Feeds what the terminal sent for one or more keys. Stops at the first key
   * that finishes the line (or asks to clear the screen) and returns it with
   * the data after it, for whatever reads next.
   */
  input(data: string): { result?: EditorResult; rest: string } {
    for (let i = 0; i < data.length;) {
      const [key, length] = nextKey(data, i);
      i += length;
      const result = this.#key(key);
      if (result) return { result, rest: data.slice(i) };
    }
    return { rest: '' };
  }

  /** Replaces the whole line, as history recall does. */
  set(text: string) {
    this.#edit(0, this.text.length, text);
  }

  #key(key: string): EditorResult | undefined {
    switch (key) {
      case '\r':
      case '\n':
        this.#move(this.text.length);
        this.#host.write('\r\n');
        this.#history?.add(this.text);
        return { type: 'submit', line: this.text };
      case '\x03':
        this.#move(this.text.length);
        this.#host.write('^C\r\n');
        return { type: 'interrupt' };
      case '\x04':
        if (this.text) return this.#eofWithText();
        return { type: 'eof', line: '' };
      case '\x0c':
        return { type: 'clear' };
      case '\x7f':
      case '\b':
        if (this.cursor > 0) this.#edit(this.cursor - 1, this.cursor, '');
        return;
      case '\x1b[3~':
        if (this.cursor < this.text.length)
          this.#edit(this.cursor, this.cursor + 1, '');
        return;
      case '\x1b[D':
      case '\x1bOD':
      case '\x02':
        return this.#move(this.cursor - 1);
      case '\x1b[C':
      case '\x1bOC':
      case '\x06':
        return this.#move(this.cursor + 1);
      case '\x1b[H':
      case '\x1bOH':
      case '\x1b[1~':
      case '\x01':
        return this.#move(0);
      case '\x1b[F':
      case '\x1bOF':
      case '\x1b[4~':
      case '\x05':
        return this.#move(this.text.length);
      case '\x0b':
        return this.#edit(this.cursor, this.text.length, '');
      case '\x15':
        return this.#edit(0, this.cursor, '');
      case '\x17':
        return this.#edit(this.#wordStart(), this.cursor, '');
      case '\x1b[A':
      case '\x1bOA':
        return this.#recall(this.#history?.previous(this.text));
      case '\x1b[B':
      case '\x1bOB':
        return this.#recall(this.#history?.next());
      default:
        // Printable text (a paste arrives as one key); other controls are ignored.
        if (key.length && !hasControl(key))
          this.#edit(this.cursor, this.cursor, key);
    }
  }

  /** What Ctrl+D does on a line with text: hands the text over without a newline. */
  #eofWithText(): EditorResult {
    this.#move(this.text.length);
    return { type: 'eof', line: this.text };
  }

  #wordStart() {
    let i = this.cursor;
    while (i > 0 && this.text[i - 1] === ' ') i--;
    while (i > 0 && this.text[i - 1] !== ' ') i--;
    return i;
  }

  #recall(line: string | undefined): undefined {
    if (line === undefined) return;
    this.#edit(0, this.text.length, line);
  }

  /** Replaces `text[from, to)`, leaving the cursor after the new text. */
  #edit(from: number, to: number, insert: string): undefined {
    if (from === to && !insert) return;
    this.text = this.text.slice(0, from) + insert + this.text.slice(to);
    this.cursor = from + insert.length;
    this.#redraw();
  }

  #move(to: number): undefined {
    const target = Math.max(0, Math.min(this.text.length, to));
    if (target === this.cursor) return;
    this.cursor = target;
    this.#placeCursor(this.#row);
  }

  /** Redraws the line from its first row and puts the cursor at `cursor`. */
  #redraw() {
    const columns = Math.max(1, this.#host.columns());
    let out = '';
    if (this.#row > 0) out += `\x1b[${this.#row}A`;
    // The line starts `origin` columns in; clear from there.
    out += `\r${this.#origin ? `\x1b[${this.#origin}C` : ''}\x1b[J${this.text}`;
    const end = this.#origin + this.text.length;
    // A line that exactly fills a row leaves the cursor waiting to wrap: wrap it.
    if (this.text && end % columns === 0) out += '\r\n';
    this.#host.write(out);
    this.#row = Math.floor(end / columns);
    this.#placeCursor(this.#row);
  }

  /** Moves the cursor from row `from` (below the first) to where `cursor` falls. */
  #placeCursor(from: number) {
    const columns = Math.max(1, this.#host.columns());
    const at = this.#origin + this.cursor;
    const row = Math.floor(at / columns);
    const column = at % columns;
    let out = '';
    if (row < from) out += `\x1b[${from - row}A`;
    else if (row > from) out += `\x1b[${row - from}B`;
    out += `\r${column ? `\x1b[${column}C` : ''}`;
    this.#host.write(out);
    this.#row = row;
  }
}

const ESC = '\u001b';
const KEY_SEQUENCE = new RegExp(`^${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|O[@-~])`);
const CSI = new RegExp(`^${ESC}\\[([0-9;?]*)([ -/]*[@-~])`);

const hasControl = (text: string) =>
  [...text].some((c) => c < ' ' || c === '\x7f');

/** The next key in `data` from `at`: an escape sequence, one character or a pasted run. */
function nextKey(data: string, at: number): [string, number] {
  if (data[at] === '\x1b') {
    // CSI (`ESC [ params final`) and SS3 (`ESC O final`) sequences.
    const match = KEY_SEQUENCE.exec(data.slice(at));
    if (match) return [match[0], match[0].length];
    return [data.slice(at, at + 2), Math.min(2, data.length - at)];
  }
  if (data[at] < ' ' || data[at] === '\x7f') return [data[at], 1];
  let end = at;
  while (end < data.length && data[end] >= ' ' && data[end] !== '\x7f') end++;
  return [data.slice(at, end), end - at];
}

/**
 * The cursor column after `text` is written from column `column` on a screen
 * `columns` wide. Follows what a program or the line editor writes: carriage
 * returns and line feeds (the terminal turns `\n` into `\r\n`), tabs, backspace,
 * relative horizontal moves and plain characters that wrap at the right edge.
 * Other escape sequences (colours, erasing, vertical moves) leave the column
 * alone. Characters count as one column wide.
 */
export function advanceColumn(
  column: number,
  text: string,
  columns: number
): number {
  const width = Math.max(1, columns);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\x1b') {
      const match = CSI.exec(text.slice(i));
      if (!match) {
        i += 1;
        continue;
      }
      const count = Number.parseInt(match[1], 10) || 1;
      if (match[2] === 'C') column = Math.min(width - 1, column + count);
      else if (match[2] === 'D') column = Math.max(0, column - count);
      else if (match[2] === 'G') column = Math.min(width - 1, count - 1);
      i += match[0].length - 1;
    } else if (c === '\r' || c === '\n') column = 0;
    else if (c === '\b') column = Math.max(0, column - 1);
    else if (c === '\t') column = Math.min(width - 1, (column & ~7) + 8);
    else if (c >= ' ' && c !== '\x7f') {
      if (column >= width) column = 0;
      column++;
    }
  }
  return column;
}
