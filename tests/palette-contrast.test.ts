/*
 * WCAG contrast of every text/background pair in every curated theme
 * (src/lib/themes.ts), including the dark editor theme built from each theme's
 * accents. Fails below AA (4.5:1 text, 3:1 large text and UI boundaries); pairs
 * below AAA (7:1 text, 4.5:1 large) only warn. Prints a per-pair table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contrastBetween,
  formatOklch,
  toOklch,
} from '../src/lib/color-contrast.ts';
import {
  themeProperties,
  themes,
  themeById,
  nextTheme,
  defaultTheme,
  themeCss,
} from '../src/lib/themes.ts';

const workspace = readFileSync(
  resolve(import.meta.dirname, '../src/components/svelte/CodeWorkspace.svelte'),
  'utf8'
);

/** Resolves hex, `oklch()`, `white`, `var(--x)` and `color-mix(in oklch, A p%, B)` to an oklch string. */
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
    const first = toOklch(resolveColor(mix[1], vars));
    const second = toOklch(resolveColor(mix[3], vars));
    const share = Number(mix[2]) / 100;
    // An achromatic colour has no hue: CSS takes the other colour's hue.
    const hue =
      first.chroma < 1e-4
        ? second.hue
        : second.chroma < 1e-4
          ? first.hue
          : first.hue * share + second.hue * (1 - share);
    return formatOklch({
      lightness: first.lightness * share + second.lightness * (1 - share),
      chroma: first.chroma * share + second.chroma * (1 - share),
      hue,
    });
  }
  return text.startsWith('#') ? text : formatOklch(toOklch(text));
}

/** The editor theme's own variables (the `.ide { ... }` block). */
function editorVariables() {
  const vars = new Map<string, string>();
  const body = /\.ide \{[^}]*\}/u.exec(workspace)?.[0] ?? '';
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu))
    vars.set(
      match[1],
      match[2]
        .replace(/\s+/gu, ' ')
        .replace(/\( /gu, '(')
        .replace(/ \)/gu, ')')
        .trim()
    );
  return vars;
}

interface Pair {
  theme: string;
  name: string;
  foreground: string;
  background: string;
  /** 'text' needs 4.5 (AAA 7); 'large' needs 3 (AAA 4.5). */
  kind: 'text' | 'large';
}

function pairsFor(themeId: string): Pair[] {
  const theme = themeById(themeId)!;
  const site = new Map(themeProperties(theme));
  const pairs: Pair[] = [];
  const add = (
    name: string,
    fg: string,
    bg: string,
    kind: Pair['kind'] = 'text'
  ) =>
    pairs.push({
      theme: theme.name,
      name,
      foreground: resolveColor(fg, site),
      background: resolveColor(bg, site),
      kind,
    });
  add('ink on paper', 'var(--ink)', 'var(--paper)');
  add('ink on paper-bright', 'var(--ink)', 'var(--paper-bright)');
  add('paper on ink', 'var(--paper)', 'var(--ink)');
  add('muted on paper', 'var(--muted)', 'var(--paper)');
  add('muted on paper-bright', 'var(--muted)', 'var(--paper-bright)');
  for (const n of [1, 2, 3]) {
    add(
      `accent-${n}-on on accent-${n}`,
      `var(--accent-${n}-on)`,
      `var(--accent-${n})`
    );
    add(`accent-${n}-text on paper`, `var(--accent-${n}-text)`, 'var(--paper)');
    add(
      `accent-${n}-text on paper-bright`,
      `var(--accent-${n}-text)`,
      'var(--paper-bright)'
    );
  }
  add(
    'focus ring (accent-2-text) on paper',
    'var(--accent-2-text)',
    'var(--paper)',
    'large'
  );
  // The dark editor is built from the theme's accents (mixed with white).
  const editor = editorVariables();
  for (const [name, value] of site) editor.set(name, value);
  const names = [...editor.keys()].filter((name) =>
    /^--ide-(fg|fg-strong|muted|faint|syntax-[\w-]+|error)$/u.test(name)
  );
  for (const name of names)
    for (const surface of ['--ide-bg', '--ide-raised'])
      pairs.push({
        theme: theme.name,
        name: `editor ${name} on ${surface}`,
        foreground: resolveColor(`var(${name})`, editor),
        background: resolveColor(`var(${surface})`, editor),
        kind: 'text',
      });
  return pairs;
}

test('every theme meets WCAG AA and reports AAA for each pair', () => {
  const rows: Record<string, string>[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const theme of themes) {
    for (const pair of pairsFor(theme.id)) {
      const ratio = contrastBetween(pair.foreground, pair.background);
      const aa = pair.kind === 'text' ? 4.5 : 3;
      const aaa = pair.kind === 'text' ? 7 : 4.5;
      const level = ratio >= aaa ? 'AAA' : ratio >= aa ? 'AA' : 'FAIL';
      rows.push({
        theme: pair.theme,
        pair: pair.name,
        ratio: ratio.toFixed(2),
        level,
      });
      const label = `${pair.theme}: ${pair.name} ${ratio.toFixed(2)}`;
      if (level === 'FAIL') failures.push(`${label} < ${aa}`);
      else if (level === 'AA') warnings.push(`${label} < ${aaa}`);
    }
  }
  // Only the non-passing rows, plus a summary: the full table is hundreds of lines.
  console.table(rows.filter((row) => row.level !== 'AAA'));
  console.log(`${rows.length} pairs over ${themes.length} themes`);
  if (warnings.length)
    console.warn(`Below AAA (warning only):\n  ${warnings.join('\n  ')}`);
  assert.deepEqual(failures, []);
});

test('every pair is AAA for the site tokens (editor greys may stay at AA)', () => {
  const below: string[] = [];
  for (const theme of themes)
    for (const pair of pairsFor(theme.id)) {
      if (pair.name.startsWith('editor')) continue;
      const need = pair.kind === 'text' ? 7 : 4.5;
      const ratio = contrastBetween(pair.foreground, pair.background);
      if (ratio < need)
        below.push(`${theme.name}: ${pair.name} ${ratio.toFixed(2)}`);
    }
  assert.deepEqual(below, []);
});

test('themes are cycled in order and the default is first and served on :root', () => {
  assert.equal(themes[0], defaultTheme);
  assert.equal(nextTheme(themes[themes.length - 1].id), themes[0]);
  assert.equal(nextTheme(undefined), themes[0]);
  assert.equal(nextTheme(themes[0].id), themes[1]);
  assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length);
  const css = themeCss();
  assert.ok(css.includes(`:root{--paper:${defaultTheme.paper}`));
  for (const theme of themes.slice(1))
    assert.ok(css.includes(`:root[data-site-theme='${theme.id}']`));
  assert.ok(themes.some((theme) => theme.dark));
});
