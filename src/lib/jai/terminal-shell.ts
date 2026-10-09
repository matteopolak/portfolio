/*
 * The playground's mini shell. It owns what the terminal shows between and
 * around runs: the `jai$ ` prompt and its commands, the history, the line a
 * program reads from standard input, and the notes a run leaves behind. It
 * talks to the screen through `ShellIO` and to the workspace through the
 * callbacks in `ShellHooks`, so tests drive it with a fake screen.
 */
import {
  History,
  LineEditor,
  parseCommandLine,
  parseHistory,
  quoteArgument,
  type EditorResult,
} from './shell.ts';

export interface ShellIO {
  write(text: string): void;
  /** Empties the screen and the scrollback. */
  clear(): void;
  /** The cursor's column (0 at the start of a line). */
  column(): number;
  columns(): number;
}

export interface ShellHooks {
  /** A `run` command: start the program with these arguments. */
  run(args: string[]): void;
  /** Ctrl+C while a program runs. */
  interrupt(): void;
  /** A line (or `null`, the end of input) for the program waiting on stdin. */
  input(text: string | null): void;
}

export type ShellMode = 'prompt' | 'running' | 'stdin';

export const PROMPT = 'jai$ ';
/** The most typed-ahead input kept for a running program. */
const MAX_AHEAD = 4096;
const PROMPT_STYLED = `\x1b[1;33mjai\x1b[0m$ `;

export const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const red = (text: string) => `\x1b[31m${text}\x1b[39m`;

export const HELP = [
  'run [args...]   compile and run main.jai, passing it the arguments',
  '                (quote with \' or " to keep spaces in one)',
  'clear           clear the screen',
  'help            show this list',
  '',
  'Ctrl+C stops the program and Ctrl+D ends its input.',
  'The Run button and Ctrl+Enter repeat the last run command.',
].join('\n');

export class Shell {
  mode: ShellMode = 'prompt';
  /** The arguments of the last `run` command: what Run and an edit repeat. */
  lastArgs: string[] = [];
  readonly history: History;
  readonly #io: ShellIO;
  readonly #hooks: ShellHooks;
  readonly #save: ((entries: readonly string[]) => void) | undefined;
  #editor: LineEditor | undefined;
  /** A `run` command was typed: the screen keeps the typed line. */
  #typed = false;
  /** Keys typed while a program runs, for it to read when it asks for input. */
  #ahead = '';

  constructor(
    io: ShellIO,
    hooks: ShellHooks,
    options: {
      storage?: Pick<Storage, 'getItem' | 'setItem'>;
      key?: string;
    } = {}
  ) {
    this.#io = io;
    this.#hooks = hooks;
    const { storage, key = 'jai-terminal-history' } = options;
    let saved: string | null = null;
    try {
      saved = storage?.getItem(key) ?? null;
    } catch {
      /* Without storage the history lasts for this page. */
    }
    this.history = new History(parseHistory(saved));
    this.#save = storage
      ? (entries) => {
          try {
            storage.setItem(key, JSON.stringify(entries));
          } catch {
            /* Full or blocked storage: keep going without it. */
          }
        }
      : undefined;
  }

  /** Writes the prompt and starts reading a command. */
  prompt() {
    this.#ensureLineStart();
    this.#io.write(PROMPT_STYLED);
    this.mode = 'prompt';
    this.#editor = new LineEditor(
      this.#editorHost(),
      PROMPT.length,
      this.history
    );
  }

  /**
   * A run begins. Runs started by the Run button or an edit clear the screen
   * and show the command that ran; a typed `run` goes on below the typed line.
   */
  beginRun(args: string[]) {
    this.#editor = undefined;
    this.#ahead = '';
    this.mode = 'running';
    if (this.#typed) {
      this.#typed = false;
      return;
    }
    this.#io.clear();
    this.#io.write(dim(`${PROMPT}${runCommand(args)}`) + '\r\n');
  }

  /** The command line `args` stand for. */
  get command() {
    return runCommand(this.lastArgs);
  }

  /** What a program wrote. Standard error is drawn in red. */
  output(stream: 'stdout' | 'stderr', text: string) {
    if (!text) return;
    this.#io.write(stream === 'stderr' ? red(text) : text);
  }

  /** Moves to the start of a line, if the cursor is not on one. */
  endLine() {
    this.#ensureLineStart();
  }

  /** Something went wrong outside the program (in red, on a line of its own). */
  error(text: string) {
    this.#ensureLineStart();
    this.#fail(text);
    if (this.mode === 'prompt') this.prompt();
  }

  /** The Clear button: empties the screen, keeping the prompt if one is showing. */
  clearScreen() {
    const text = this.#editor?.text;
    this.#io.clear();
    if (this.mode !== 'prompt') return;
    this.prompt();
    if (text) this.#editor!.set(text);
  }

  /** A note of the shell's own, on a line of its own. */
  note(text: string) {
    this.#ensureLineStart();
    this.#io.write(dim(text) + '\r\n');
  }

  /** The program ended: a note for a non-zero exit, then the prompt. */
  finish(exitCode: number | null) {
    this.#ensureLineStart();
    if (exitCode !== null && exitCode !== 0)
      this.#io.write(dim(`[exited with code ${exitCode}]`) + '\r\n');
    this.prompt();
  }

  /**
   * The run was killed. `edit` means another run follows at once, so nothing is
   * said and no prompt shown (the next run clears the screen).
   */
  stopped(cause: 'interrupt' | 'stop' | 'edit') {
    this.#editor = undefined;
    this.#ahead = '';
    if (cause === 'edit') {
      this.mode = 'running';
      return;
    }
    this.#ensureLineStart();
    if (cause === 'stop') this.#io.write(dim('[stopped]') + '\r\n');
    this.prompt();
  }

  /** The program waits for a line of standard input. */
  requestInput() {
    if (this.mode === 'prompt') return;
    this.mode = 'stdin';
    this.#editor = new LineEditor(this.#editorHost(), this.#io.column());
    const ahead = this.#ahead;
    this.#ahead = '';
    if (ahead) this.data(ahead);
  }

  /** Whatever the user types goes nowhere now (the run was killed or ended). */
  abandonInput() {
    if (this.mode === 'stdin') {
      this.#editor = undefined;
      this.mode = 'running';
    }
  }

  /** Keys and pastes from the terminal. */
  data(data: string) {
    while (data) {
      if (this.mode === 'running' || !this.#editor) {
        if (this.mode !== 'running') return;
        if (data.includes('\x03')) {
          this.#ahead = '';
          this.#interrupt();
        } else this.#ahead = (this.#ahead + data).slice(-MAX_AHEAD);
        return;
      }
      const { result, rest } = this.#editor.input(data);
      data = rest;
      if (!result) return;
      this.#handle(result);
    }
  }

  #interrupt() {
    this.#io.write('^C');
    this.#hooks.interrupt();
  }

  #handle(result: EditorResult) {
    const editor = this.#editor!;
    if (this.mode === 'stdin') {
      switch (result.type) {
        case 'submit':
          this.#editor = undefined;
          this.mode = 'running';
          this.#hooks.input(result.line + '\n');
          break;
        case 'eof':
          this.#editor = undefined;
          this.mode = 'running';
          this.#hooks.input(result.line || null);
          break;
        case 'interrupt':
          this.#hooks.interrupt();
          break;
        // The screen holds the program's output; it cannot be redrawn.
        case 'clear':
          break;
      }
      return;
    }
    switch (result.type) {
      case 'submit':
        this.#save?.(this.history.entries);
        this.#execute(result.line);
        break;
      case 'interrupt':
        this.prompt();
        break;
      case 'clear': {
        const text = editor.text;
        this.#io.clear();
        this.prompt();
        this.#editor!.set(text);
        break;
      }
      case 'eof':
        break;
    }
  }

  #execute(line: string) {
    const command = parseCommandLine(line);
    if (!command.ok) {
      if (command.error) this.#fail(`jai: ${command.error}`);
      return this.prompt();
    }
    switch (command.name) {
      case 'run':
        this.lastArgs = command.args;
        this.#typed = true;
        this.mode = 'running';
        this.#editor = undefined;
        this.#hooks.run(command.args);
        return;
      case 'clear':
        this.#io.clear();
        return this.prompt();
      case 'help':
        this.#io.write(HELP.replaceAll('\n', '\r\n') + '\r\n');
        return this.prompt();
      default:
        this.#fail(`jai: command not found: ${command.name} (try help)`);
        return this.prompt();
    }
  }

  #fail(message: string) {
    this.#io.write(red(message) + '\r\n');
  }

  #ensureLineStart() {
    if (this.#io.column() !== 0) this.#io.write('\r\n');
  }

  #editorHost() {
    return {
      write: (text: string) => this.#io.write(text),
      columns: () => this.#io.columns(),
    };
  }
}

/** `run` followed by the arguments, quoted so the shell would read them back. */
export function runCommand(args: readonly string[]) {
  return ['run', ...args.map(quoteArgument)].join(' ');
}
