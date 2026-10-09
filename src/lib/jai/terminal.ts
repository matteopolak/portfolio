/*
 * The xterm.js terminal behind the playground's output pane. xterm is loaded
 * on first use (`createTerminal`), so pages that never open the pane do not
 * pay for it. Colours come from the playground's own `--ide-*` tokens and are
 * read again when the colour scheme changes.
 */
import type { ITheme, Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { advanceColumn, type EditorHost } from './shell.ts';
import type { ShellIO } from './terminal-shell.ts';

export interface JaiTerminal extends ShellIO, EditorHost {
  /** Keys and pastes. */
  onData(listener: (data: string) => void): void;
  focus(): void;
  /** Resizes to the container; the container may have changed size or moved. */
  fit(): void;
  dispose(): void;
}

/** An `rgba()` or `#rrggbb` string for any CSS colour, resolved against `host`. */
function resolveColor(host: HTMLElement, value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.hidden = true;
  host.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return resolved;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return a === 255
    ? `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** xterm's theme from the playground's tokens. */
export function readTheme(host: HTMLElement): ITheme {
  const color = (token: string) => resolveColor(host, `var(${token})`);
  const fg = color('--ide-fg');
  const cyan = resolveColor(host, 'oklch(82% 0.1 210)');
  return {
    background: color('--ide-sunken'),
    foreground: fg,
    cursor: color('--ide-fg-strong'),
    cursorAccent: color('--ide-sunken'),
    selectionBackground: color('--ide-selection'),
    black: color('--ide-sunken'),
    brightBlack: color('--ide-faint'),
    red: color('--ide-error'),
    brightRed: color('--ide-error'),
    green: color('--ide-syntax-string'),
    brightGreen: color('--ide-syntax-string'),
    yellow: color('--ide-syntax-keyword'),
    brightYellow: color('--ide-syntax-keyword'),
    blue: color('--ide-syntax-type'),
    brightBlue: color('--ide-syntax-type'),
    magenta: color('--ide-syntax-format'),
    brightMagenta: color('--ide-syntax-format'),
    cyan,
    brightCyan: cyan,
    white: fg,
    brightWhite: color('--ide-fg-strong'),
  };
}

/** Loads xterm and opens a terminal in `host`; `signal` aborting disposes it. */
export async function createTerminal(
  host: HTMLElement,
  signal: AbortSignal
): Promise<JaiTerminal> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/xterm/css/xterm.css'),
  ]);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const term: Terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    scrollback: 5000,
    fontSize: 13,
    lineHeight: 1.3,
    fontFamily:
      getComputedStyle(host).getPropertyValue('--ide-mono').trim() ||
      'ui-monospace, monospace',
    theme: readTheme(host),
  });
  const fit: FitAddon = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.textarea?.setAttribute('aria-label', 'Program terminal');

  /*
   * Copy with a selection, interrupt without; Ctrl/Cmd+Enter belongs to the
   * workspace (Run), and paste is left to the browser.
   */
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === 'Enter') return false;
    if (modifier && event.key.toLowerCase() === 'c' && term.hasSelection()) {
      void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    return true;
  });

  let column = 0;
  const refit = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    try {
      fit.fit();
    } catch {
      /* The renderer is not ready for measuring yet. */
    }
  };
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refit);
  });
  observer.observe(host);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const rethink = () => {
    term.options.theme = readTheme(host);
  };
  scheme.addEventListener('change', rethink);
  refit();

  const listeners: (() => void)[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    scheme.removeEventListener('change', rethink);
    for (const stop of listeners) stop();
    term.dispose();
  };
  signal.addEventListener('abort', dispose, { once: true });

  return {
    write(text) {
      column = advanceColumn(column, text, term.cols);
      term.write(text);
    },
    clear() {
      column = 0;
      term.write('\x1b[H\x1b[2J\x1b[3J');
    },
    column: () => column,
    columns: () => term.cols,
    onData(listener) {
      const subscription = term.onData(listener);
      listeners.push(() => subscription.dispose());
    },
    focus: () => term.focus(),
    fit: refit,
    dispose,
  };
}
