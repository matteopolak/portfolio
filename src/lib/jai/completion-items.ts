/*
 * Language-server completion items as CodeMirror completions. An item may
 * carry `additionalTextEdits`: jailsp's auto-import completions do (`print`
 * in a file without `#import "Basic";` adds that line, and a name from
 * another project file adds its `#load`). Accepting such an item, by Tab,
 * Enter or a click, inserts the name and applies those edits in the same
 * transaction, so one undo takes both back. Pure helpers; `code-editor.ts`
 * asks the server and shows the list.
 */
import {
  insertCompletionText,
  pickedCompletion,
  type Completion,
} from '@codemirror/autocomplete';
import type { ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { offsetAt } from './language-client.ts';
import type { CompletionItem, TextEdit } from './lsp-types.ts';

/**
 * How far an item with additional edits sorts below the names already in
 * scope (CodeMirror adds it to the match score; the server ranks them last
 * with `sortText` the same way).
 */
export const AUTO_IMPORT_BOOST = -50;

/** The edits as CodeMirror changes in `text`; ones that do not fit are left out. */
export function editChanges(
  text: string,
  edits: readonly TextEdit[] | undefined
): { from: number; to: number; insert: string }[] {
  const changes = [];
  for (const edit of edits ?? []) {
    if (!edit.range || typeof edit.newText !== 'string') continue;
    try {
      const from = offsetAt(text, edit.range.start);
      const to = offsetAt(text, edit.range.end);
      if (from <= to) changes.push({ from, to, insert: edit.newText });
    } catch {
      // A position past the end of the text: the document changed under it.
    }
  }
  return changes;
}

/**
 * Accepting `completion`: its text over `from..to`, and `edits` elsewhere.
 * The edits' positions are in the document as it was when the list was
 * asked for; they lie outside the typed word (an import above it), which is
 * all that changes while the list is open.
 */
export function applyWithEdits(
  insert: string,
  edits: readonly TextEdit[]
): (
  view: EditorView,
  completion: Completion,
  from: number,
  to: number
) => void {
  return (view, completion, from, to) => {
    const extra: ChangeSpec[] = editChanges(
      view.state.doc.toString(),
      edits
    ).filter((c) => c.to <= from || c.from >= to);
    // Both specs start from the current document: the cursor placed after
    // the inserted name is mapped through the import added above it.
    view.dispatch(
      {
        ...insertCompletionText(view.state, insert, from, to),
        annotations: pickedCompletion.of(completion),
      },
      { changes: extra }
    );
  };
}

/** CodeMirror's completion type by LSP CompletionItemKind (Function, Class, Keyword). */
const completionTypes: Record<number, string> = {
  3: 'function',
  7: 'class',
  14: 'keyword',
};

/** The CodeMirror completion for one server item (plain-text `info` from `infoText`). */
export function completionOption(
  item: CompletionItem,
  infoText: (documentation: CompletionItem['documentation']) => string
): Completion {
  const insert = item.insertText ?? item.label;
  const edits = item.additionalTextEdits ?? [];
  const autoImport = edits.length > 0;
  return {
    label: item.label,
    // An auto-import shows where the name comes from (`Basic`, `util/strings.jai`).
    detail: item.labelDetails?.description ?? item.detail,
    info: infoText(item.documentation) || undefined,
    type: completionTypes[item.kind ?? 0] ?? 'variable',
    ...(autoImport
      ? { boost: AUTO_IMPORT_BOOST, apply: applyWithEdits(insert, edits) }
      : { apply: insert }),
  };
}
