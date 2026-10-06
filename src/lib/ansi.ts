/*
 * ANSI SGR colour codes (`ESC [ ... m`) in program and compiler output, as a
 * terminal would draw them. `parseAnsi` is pure (tests cover it); `ansiNodes`
 * turns its segments into spans for the output pane. Other escape sequences
 * are dropped.
 */

export interface AnsiStyle {
  /** A palette name (`red`, `bright-blue`, ...) or a CSS colour (256/true colour). */
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

const NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];
const ESC = '\u001b';
const BEL = '\u0007';
// CSI sequences (SGR among them), OSC strings and two-byte escapes.
const ESCAPE = new RegExp(
  `${ESC}\\[([0-9;:?]*)([A-Za-z])|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`,
  'gu'
);

/** xterm's 256-colour palette entry `n` (16-255) as CSS. */
function color256(n: number): string | undefined {
  if (n < 16) return n < 8 ? NAMES[n] : `bright-${NAMES[n - 8]}`;
  if (n < 232) {
    const i = n - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${level(Math.floor(i / 36))} ${level(Math.floor(i / 6) % 6)} ${level(i % 6)})`;
  }
  if (n < 256) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v} ${v} ${v})`;
  }
  return undefined;
}

function apply(style: AnsiStyle, codes: number[]): AnsiStyle {
  const next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0)
      for (const key of Object.keys(next)) delete next[key as keyof AnsiStyle];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code >= 30 && code <= 37) next.fg = NAMES[code - 30];
    else if (code >= 90 && code <= 97) next.fg = `bright-${NAMES[code - 90]}`;
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = NAMES[code - 40];
    else if (code >= 100 && code <= 107)
      next.bg = `bright-${NAMES[code - 100]}`;
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5) {
        const value = color256(codes[i + 2] ?? -1);
        if (value) next[key] = value;
        i += 2;
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        if ([r, g, b].every((v) => v !== undefined && v >= 0 && v <= 255))
          next[key] = `rgb(${r} ${g} ${b})`;
        i += 4;
      }
    }
  }
  return next;
}

/** Splits text at SGR codes into runs of one style; other escapes are removed. */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let at = 0;
  const push = (part: string) => {
    if (!part) return;
    const last = segments.at(-1);
    if (last && JSON.stringify(last.style) === JSON.stringify(style))
      last.text += part;
    else segments.push({ text: part, style });
  };
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[2] === 'm') {
      const codes = (match[1] || '0')
        .split(/[;:]/u)
        .map((part) => (part === '' ? 0 : Number(part)));
      style = apply(style, codes);
    }
  }
  push(text.slice(at));
  return segments;
}

export function hasAnsi(text: string): boolean {
  return text.includes(`${ESC}[`);
}

const isName = (value: string) => /^(bright-)?[a-z]+$/u.test(value);

/** Spans for the segments: palette colours as classes, others inline. */
export function ansiNodes(text: string): Node[] {
  return parseAnsi(text).map(({ text: part, style }) => {
    if (!Object.keys(style).length) return document.createTextNode(part);
    const span = document.createElement('span');
    span.textContent = part;
    const classes: string[] = [];
    if (style.fg) {
      if (isName(style.fg)) classes.push(`ansi-fg-${style.fg}`);
      else span.style.color = style.fg;
    }
    if (style.bg) {
      if (isName(style.bg)) classes.push(`ansi-bg-${style.bg}`);
      else span.style.backgroundColor = style.bg;
    }
    if (style.bold) classes.push('ansi-bold');
    if (style.dim) classes.push('ansi-dim');
    if (style.italic) classes.push('ansi-italic');
    if (style.underline) classes.push('ansi-underline');
    span.className = classes.join(' ');
    return span;
  });
}
