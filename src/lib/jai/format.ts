import type { RunOutput } from './engine.ts';

/** Workspace name of the jaifmt browser driver (`jaifmt/playground.jai`). */
export const FORMAT_DRIVER_PATH = '__jaifmt__.jai';
/** Release asset that holds the driver, next to `jai_wasm.wasm`. */
export const FORMAT_DRIVER_ASSET = 'jaifmt-playground.jai';
/** Config file the driver looks for, from the target's directory up to the root. */
export const FORMAT_CONFIG_PATH = 'jaifmt.toml';

/** Default `jaifmt.toml` for new workspaces: the formatter's defaults, explained. */
export const formatConfigStarter = `# Settings for the Format button (Shift+Alt+F), read by jaifmt.
# The values below are the defaults. A jaifmt.toml in a subfolder
# overrides this one for the files under it.

indent_width = 4           # spaces per block level, 1-16
# case_indent = 4          # \`case\` lines inside \`if x == {\`, 0-16; default indent_width
# case_body_indent = 4     # statements under a \`case\`, 0-16; default indent_width
max_blank_lines = 2        # longest run of blank lines kept, 0-100
brace_style = "same_line"  # "same_line" joins a lone \`{\` or \`else\` to the line above; "preserve"
`;

export const isFormattable = (path: string) => path.endsWith('.jai');

/**
 * The file map for one format run: the whole workspace (so a nested
 * `jaifmt.toml` is found) plus the driver, pointed at `target`.
 */
export function formatFiles(
  documents: readonly { path: string; text: string }[],
  target: string,
  driver: string
): Record<string, string> {
  const pattern = /^TARGET :: ".*";$/m;
  if (!pattern.test(driver))
    throw new Error('The formatter driver has no TARGET line.');
  const files: Record<string, string> = {};
  for (const { path, text } of documents) files[path] = text;
  // JSON string escapes (\" and \\) are valid Jai string escapes.
  files[FORMAT_DRIVER_PATH] = driver.replace(
    pattern,
    () => `TARGET :: ${JSON.stringify(target)};`
  );
  return files;
}

/**
 * The driver prints the formatted file and exits 0, or prints one
 * `jaifmt: ...` line to stderr and exits 1. A null exit code means the driver
 * itself did not compile (a compiler build without `Jai_Format`).
 */
export function formatOutcome(
  result: RunOutput
): { text: string } | { error: string } {
  if (result.exitCode === 0) return { text: result.stdout };
  if (result.exitCode === null) {
    const details =
      result.rendered?.trimEnd() ||
      (result.diagnostics ?? []).map((d) => d.message).join('\n');
    return {
      error: `jaifmt: the formatter failed to run with this compiler build.${details ? `\n${details}` : ''}`,
    };
  }
  return {
    error:
      result.stderr.trimEnd() || `jaifmt: exited with code ${result.exitCode}.`,
  };
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** One minimal change (common prefix and suffix kept) from `before` to `after`. */
export function formatChange(
  before: string,
  after: string
): TextChange | undefined {
  if (before === after) return undefined;
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < shorter - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

const blank = (character: string | undefined) =>
  character !== undefined && /\s/u.test(character);

/**
 * Where `offset` lands after `change`. Formatting only moves whitespace, so a
 * position inside the change keeps its place among the non-whitespace
 * characters: a cursor before `x` stays before `x` after reindenting.
 */
export function mapOffset(
  before: string,
  change: TextChange,
  offset: number
): number {
  if (offset < change.from) return offset;
  if (offset >= change.to)
    return offset + change.insert.length - (change.to - change.from);
  let solid = 0;
  for (let i = change.from; i < offset; i++) if (!blank(before[i])) solid++;
  let position = 0;
  const text = change.insert;
  while (solid > 0 && position < text.length)
    if (!blank(text[position++])) solid--;
  // Directly before a token: skip the new whitespace so the cursor stays on it.
  if (!blank(before[offset]))
    while (position < text.length && blank(text[position])) position++;
  return change.from + position;
}
