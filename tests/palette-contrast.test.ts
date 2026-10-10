/*
 * WCAG contrast of every text/background token pair the site actually uses.
 * Fails below AA (4.5:1 text, 3:1 large text and UI boundaries); pairs below
 * AAA (7:1 text, 4.5:1 large) only warn. Prints a per-pair table. Also checks
 * that the palette generator's output reaches AAA with ink text over many seeds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contrastBetween,
  generatePalette,
  INK,
  PAPER,
  parseOklch,
} from '../src/lib/palette.ts';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const css = read('src/styles/global.css');
const workspace = read('src/components/svelte/CodeWorkspace.svelte');

interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}

const format = (c: Oklch) =>
  `oklch(${(c.lightness * 100).toFixed(3)}% ${c.chroma.toFixed(5)} ${c.hue.toFixed(3)})`;

/** Resolves `oklch()`, `white`, `var(--x)` and `color-mix(in oklch, A p%, B)` to an oklch string. */
function resolveColor(value: string, vars: Map<string, string>): string {
  const text = value.trim();
  const reference = /^var\((--[\w-]+)\)$/u.exec(text);
  if (reference) {
    const next = vars.get(reference[1]);
    assert.ok(next, `unknown variable ${reference[1]}`);
    return resolveColor(next, vars);
  }
  if (text === 'white') return 'oklch(100% 0 0)';
  const mix =
    /^color-mix\(in oklch,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/u.exec(text);
  if (mix) {
    const first = parseOklch(resolveColor(mix[1], vars));
    const second = parseOklch(resolveColor(mix[3], vars));
    const share = Number(mix[2]) / 100;
    // An achromatic colour has no hue: CSS takes the other colour's hue.
    const hue =
      first.chroma < 1e-4
        ? second.hue
        : second.chroma < 1e-4
          ? first.hue
          : first.hue * share + second.hue * (1 - share);
    return format({
      lightness: first.lightness * share + second.lightness * (1 - share),
      chroma: first.chroma * share + second.chroma * (1 - share),
      hue,
    });
  }
  return format(parseOklch(text));
}

function declarations(source: string, block: RegExp) {
  const vars = new Map<string, string>();
  const body = block.exec(source)?.[0] ?? '';
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
    vars.set(match[1], match[2].replace(/\s+/gu, ' ').trim());
  }
  return vars;
}

const site = declarations(css, /:root \{[^}]*\}/u);
const editor = declarations(workspace, /\.ide \{[^}]*\}/u);
for (const [name, value] of site)
  if (!editor.has(name)) editor.set(name, value);

interface Pair {
  name: string;
  foreground: string;
  background: string;
  /** 'text' needs 4.5 (AAA 7); 'large' (UI boundaries, large text) needs 3 (AAA 4.5). */
  kind: 'text' | 'large';
  /** Secondary greys that may stay at AA. */
  secondary?: boolean;
}

const light = (
  name: string,
  fg: string,
  bg: string,
  kind: Pair['kind'] = 'text',
  secondary = false
): Pair => ({
  name,
  foreground: resolveColor(fg, site),
  background: resolveColor(bg, site),
  kind,
  secondary,
});

const pairs: Pair[] = [
  light('ink on paper', 'var(--ink)', 'var(--paper)'),
  light('ink on paper-bright', 'var(--ink)', 'var(--paper-bright)'),
  light('paper on ink', 'var(--paper)', 'var(--ink)'),
  light('muted on paper', 'var(--muted)', 'var(--paper)', 'text', true),
  light(
    'muted on paper-bright',
    'var(--muted)',
    'var(--paper-bright)',
    'text',
    true
  ),
  light('ink on red', 'var(--ink)', 'var(--red)'),
  light('ink on blue', 'var(--ink)', 'var(--blue)'),
  light('ink on yellow', 'var(--ink)', 'var(--yellow)'),
  light('red-text on paper', 'var(--red-text)', 'var(--paper)'),
  light('blue-text on paper', 'var(--blue-text)', 'var(--paper)'),
  light('yellow-text on paper', 'var(--yellow-text)', 'var(--paper)'),
  light(
    'focus ring (blue-text) on paper',
    'var(--blue-text)',
    'var(--paper)',
    'large'
  ),
];

// Editor theme: every text colour against the editor background and raised surface.
const editorText = [...editor.keys()].filter((name) =>
  /^--ide-(fg|fg-strong|muted|faint|syntax-[\w-]+|error)$/u.test(name)
);
for (const name of editorText) {
  const secondary = /muted|faint|comment|punct/u.test(name);
  for (const surface of ['--ide-bg', '--ide-raised']) {
    pairs.push({
      name: `${name} on ${surface}`,
      foreground: resolveColor(`var(${name})`, editor),
      background: resolveColor(`var(${surface})`, editor),
      kind: 'text',
      secondary,
    });
  }
}

test('site and editor colour pairs meet WCAG AA and report AAA', () => {
  const rows: Record<string, string>[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const pair of pairs) {
    const ratio = contrastBetween(pair.foreground, pair.background);
    const aa = pair.kind === 'text' ? 4.5 : 3;
    const aaa = pair.kind === 'text' ? 7 : 4.5;
    const level = ratio >= aaa ? 'AAA' : ratio >= aa ? 'AA' : 'FAIL';
    rows.push({
      pair: pair.name,
      ratio: ratio.toFixed(2),
      level,
      note: pair.secondary ? 'secondary' : '',
    });
    if (level === 'FAIL')
      failures.push(`${pair.name}: ${ratio.toFixed(2)} < ${aa}`);
    else if (level === 'AA')
      warnings.push(
        `${pair.name}${pair.secondary ? ' (secondary)' : ''}: ${ratio.toFixed(2)} < ${aaa}`
      );
  }
  console.table(rows);
  if (warnings.length)
    console.warn(`Below AAA (warning only):\n  ${warnings.join('\n  ')}`);
  assert.deepEqual(failures, []);
});

test('generated palettes reach AAA with ink text over many seeds', () => {
  const originalRandom = Math.random;
  let state = 123456789;
  // Deterministic xorshift so a failure is reproducible.
  Math.random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
  try {
    let worst = Infinity;
    for (let seed = 0; seed < 500; seed += 1) {
      const palette = generatePalette();
      for (const [slot, fill] of Object.entries(palette)) {
        const ratio = contrastBetween(INK, fill);
        worst = Math.min(worst, ratio);
        assert.ok(
          ratio >= 7,
          `seed ${seed} ${slot} ${fill}: ${ratio.toFixed(2)}`
        );
        // Derived text accents (30% fill + 70% ink) must also be AAA on paper.
        const accent = resolveColor(
          `color-mix(in oklch, ${fill} 30%, ${INK})`,
          new Map()
        );
        const accentRatio = contrastBetween(accent, PAPER);
        assert.ok(
          accentRatio >= 7,
          `seed ${seed} ${slot} accent ${accent}: ${accentRatio.toFixed(2)}`
        );
      }
    }
    console.log(
      `generator worst ink contrast over 500 palettes: ${worst.toFixed(2)}`
    );
  } finally {
    Math.random = originalRandom;
  }
});
