/*
 * Language-server completion items as CodeMirror completions. An item may
 * carry `additionalTextEdits`: jailsp's auto-import completions do (`print`
 * in a file without `#import "Basic";` adds that line, and a name from
 * another project file adds its `#load`). Accepting such an item, by Tab,
 * Enter or a click, inserts the name and applies those edits in the same
 * transaction, so one undo takes both back.
 *
 * Documentation is Markdown (jailsp always sends MarkupContent of kind
 * `markdown`); it is rendered only when the item is selected. Long lists come
 * without it, and `completionItem/resolve` fills it in then. Pure helpers;
 * `code-editor.ts` asks the server, renders and shows the list.
 */
import {
  insertCompletionText,
  pickedCompletion,
  type Completion,
} from '@codemirror/autocomplete';
import type { ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { offsetAt } from './language-client.ts';
import { documentation, type Documentation } from './lsp-features.ts';
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

/** Builds the info panel's DOM for documentation (see `documentationContent`). */
export type RenderDocumentation = (doc: Documentation) => Node;
/** `completionItem/resolve`: the item with its documentation, or null. */
export type ResolveCompletion = (
  item: CompletionItem
) => Promise<CompletionItem | null | undefined>;

/**
 * The info panel of an item. Plain text stays a string, which CodeMirror
 * shows as text; Markdown is rendered when the item is selected. An item
 * without documentation is resolved then, if the server can.
 */
export function completionInfo(
  item: CompletionItem,
  render: RenderDocumentation,
  resolve?: ResolveCompletion
): Completion['info'] {
  const doc = documentation(item.documentation);
  if (doc) return doc.kind === 'plaintext' ? doc.value : () => render(doc);
  if (!resolve) return undefined;
  return async () => {
    const resolved = documentation((await resolve(item))?.documentation);
    return resolved ? render(resolved) : null;
  };
}

/** The CodeMirror completion for one server item. */
export function completionOption(
  item: CompletionItem,
  render: RenderDocumentation,
  resolve?: ResolveCompletion
): Completion {
  const insert = item.insertText ?? item.label;
  const edits = item.additionalTextEdits ?? [];
  const autoImport = edits.length > 0;
  return {
    label: item.label,
    // An auto-import shows where the name comes from (`Basic`, `util/strings.jai`).
    detail: item.labelDetails?.description ?? item.detail,
    info: completionInfo(item, render, resolve),
    type: completionTypes[item.kind ?? 0] ?? 'variable',
    ...(autoImport
      ? { boost: AUTO_IMPORT_BOOST, apply: applyWithEdits(insert, edits) }
      : { apply: insert }),
  };
}
