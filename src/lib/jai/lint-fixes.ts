/*
 * jailint findings and their quick fixes, as the language server sends them
 * (the compiler's own quick fixes, such as "Add `#import "Basic";`" on a
 * `jai-check` error, are plain `quickfix` actions that the code action menu
 * lists with the rest):
 * a diagnostic with `source: 'jailint'`, the rule as `code` and a link to it
 * as `codeDescription.href`; a `quickfix` code action per fix, titled in
 * sentence case (`Remove the unused variable`) with the rule as `data.rule`
 * and the lint in `diagnostics`, whose edit is an unversioned `changes` map;
 * and one `source.fixAll.jailint` action for the whole file. Pure helpers;
 * the editor wiring is in `workspace-ui.ts` and `code-editor.ts`.
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
/** The server's "fix every lint in the file" action kind. */
export const FIX_ALL = 'source.fixAll.jailint';

/** jailint's rules, for a server that sends no per-rule `codeDescription`. */
export const LINT_DOCS =
  'https://github.com/matteopolak/jai/blob/main/docs/tools/jailint.md#rules';

/** Where a lint's rule is documented: the server's per-rule link, else the rules section. */
export function lintDocs(diagnostic: Diagnostic): string {
  const href = diagnostic.codeDescription?.href;
  return typeof href === 'string' && /^https:\/\//u.test(href)
    ? href
    : LINT_DOCS;
}

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

/**
 * The rule a quick fix belongs to: its `data.rule`, else the rule of the lint
 * it carries. Servers before sentence-case titles only had the title,
 * `<fix> (<rule>)`, so that is the last resort.
 */
export function fixRule(action: CodeAction): string | undefined {
  const data = action.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'rule' in data &&
    typeof data.rule === 'string'
  )
    return data.rule;
  for (const diagnostic of action.diagnostics ?? []) {
    const rule = lintRule(diagnostic);
    if (rule) return rule;
  }
  return /\(([a-z][a-z0-9_]*)\)$/u.exec(action.title)?.[1];
}

/** The fixes among `actions` that belong to `rule`. */
export function fixesFor(
  actions: readonly CodeAction[] | null | undefined,
  rule: string
): CodeAction[] {
  return (actions ?? []).filter(
    (action) => isQuickFix(action) && fixRule(action) === rule
  );
}

/** A fix's button label: its title, without an older server's ` (<rule>)` suffix. */
export function fixLabel(action: CodeAction): string {
  return action.title.replace(/ \([a-z][a-z0-9_]*\)$/u, '');
}

/** The server's fix-all action among `actions`, if it sent one with an edit. */
export function fixAllAction(
  actions: readonly CodeAction[] | null | undefined
): CodeAction | undefined {
  return (actions ?? []).find(
    (action) => action.kind === FIX_ALL && !!action.edit && !action.command
  );
}

/** Whether the server offers `source.fixAll.jailint` (its advertised `codeActionKinds`). */
export function offersFixAll(provider: unknown): boolean {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'codeActionKinds' in provider &&
    Array.isArray(provider.codeActionKinds) &&
    provider.codeActionKinds.includes(FIX_ALL)
  );
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
 * Every lint quick fix in `actions` merged into one edit, for "Fix all" with a
 * server that has no `source.fixAll.jailint` action. Other quick fixes (the
 * compiler's "Add `#import`", which is a choice among modules) are not lint
 * fixes and are left out. Fixes are taken in order; one whose edits overlap an earlier fix's is left out
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
    if (!isQuickFix(action) || !fixRule(action)) continue;
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
