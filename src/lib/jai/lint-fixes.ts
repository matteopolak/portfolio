/*
 * jailint findings and their quick fixes, as the language server sends them:
 * a diagnostic with `source: 'jailint'` and the rule as `code`, and a
 * `quickfix` code action titled `<fix description> (<rule>)` whose edit is an
 * unversioned `changes` map. Pure helpers; the editor wiring is in
 * `workspace-ui.ts` and `code-editor.ts`.
 */
import type {
  CodeAction,
  Diagnostic,
  Position,
  Range,
  TextEdit,
  WorkspaceEdit,
} from './lsp-types.ts';

export const LINT_SOURCE = 'jailint';
export const QUICKFIX = 'quickfix';

/**
 * Where a rule is documented. The rules share one section of jailint's docs
 * (each is a bold paragraph, not a heading), so every rule links to `#rules`.
 */
export const LINT_DOCS =
  'https://github.com/matteopolak/jai/blob/main/docs/tools/jailint.md#rules';

/** Rules about something unused; their ranges are drawn faded, like VS Code's "unnecessary" tag. */
const unusedRules = new Set([
  'unused_variable',
  'unused_import',
  'unused_parameter',
]);

/** The rule of a jailint diagnostic, or undefined for any other diagnostic. */
export function lintRule(diagnostic: Diagnostic): string | undefined {
  return diagnostic.source === LINT_SOURCE &&
    typeof diagnostic.code === 'string' &&
    /^[a-z][a-z0-9_]*$/u.test(diagnostic.code)
    ? diagnostic.code
    : undefined;
}

export const isUnusedRule = (rule: string) => unusedRules.has(rule);

/** A lint message is the finding, then its help line: `unused variable \`x\`\nremove it`. */
export function lintMessage(message: string): { text: string; help?: string } {
  const newline = message.indexOf('\n');
  if (newline < 0) return { text: message };
  const help = message.slice(newline + 1).trim();
  return { text: message.slice(0, newline), help: help || undefined };
}

const before = (a: Position, b: Position) =>
  a.line < b.line || (a.line === b.line && a.character < b.character);

/** Whether two ranges touch (an empty range at either end counts), as the server matches lints. */
export function rangesTouch(a: Range, b: Range): boolean {
  return !before(a.end, b.start) && !before(b.end, a.start);
}

/** The published diagnostics that touch `range`: the `context.diagnostics` of a codeAction request. */
export function diagnosticsAt(
  diagnostics: readonly Diagnostic[],
  range: Range
): Diagnostic[] {
  return diagnostics.filter((diagnostic) =>
    rangesTouch(diagnostic.range, range)
  );
}

export const isQuickFix = (action: CodeAction) =>
  action.kind === QUICKFIX && !!action.edit && !action.command;

/** The fixes among `actions` that belong to `rule` (titled `... (<rule>)`). */
export function fixesFor(
  actions: readonly CodeAction[] | null | undefined,
  rule: string
): CodeAction[] {
  return (actions ?? []).filter(
    (action) => isQuickFix(action) && action.title.endsWith(` (${rule})`)
  );
}

/** A fix's title without its rule: `remove it (unused_variable)` → `remove it`. */
export function fixLabel(action: CodeAction): string {
  return action.title.replace(/ \([a-z][a-z0-9_]*\)$/u, '');
}

const editsOf = (edit: WorkspaceEdit): [string, TextEdit[]][] | undefined => {
  if (edit.documentChanges || edit.changeAnnotations || !edit.changes)
    return undefined;
  return Object.entries(edit.changes);
};

const order = (a: Range, b: Range) =>
  before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : 0;

/** Whether `a` and `b` share text or insert at the same point (either makes the order ambiguous). */
function editsConflict(a: Range, b: Range): boolean {
  const [first, second] = order(a, b) <= 0 ? [a, b] : [b, a];
  return (
    before(second.start, first.end) ||
    (!before(first.start, second.start) && !before(second.start, first.start))
  );
}

/**
 * Every quick fix in `actions` merged into one edit, for "Fix all". Fixes are
 * taken in order; one whose edits overlap an earlier fix's is left out
 * (`skipped`), so the result never has overlapping edits. Only `changes`
 * edits are merged; anything else counts as skipped.
 */
export function combineFixes(
  actions: readonly CodeAction[] | null | undefined
): {
  edit: WorkspaceEdit;
  applied: number;
  skipped: number;
} {
  const changes: Record<string, TextEdit[]> = {};
  let applied = 0,
    skipped = 0;
  for (const action of actions ?? []) {
    if (!isQuickFix(action)) continue;
    const entries = editsOf(action.edit!);
    const fits =
      entries?.every(([uri, edits]) =>
        edits.every(
          (edit) =>
            !!edit?.range &&
            typeof edit.newText === 'string' &&
            !(changes[uri] ?? []).some((taken) =>
              editsConflict(taken.range!, edit.range!)
            )
        )
      ) ?? false;
    if (!fits) {
      skipped++;
      continue;
    }
    for (const [uri, edits] of entries!) (changes[uri] ??= []).push(...edits);
    applied++;
  }
  for (const edits of Object.values(changes))
    edits.sort((a, b) => order(a.range!, b.range!));
  return { edit: { changes }, applied, skipped };
}
