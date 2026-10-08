import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Completion } from '@codemirror/autocomplete';
import {
  AUTO_IMPORT_BOOST,
  completionOption,
  editChanges,
} from '../../src/lib/jai/completion-items.ts';
import type { CompletionItem } from '../../src/lib/jai/lsp-types.ts';

const text = (value: unknown) =>
  typeof value === 'object' && value && 'value' in value
    ? String(value.value)
    : '';

/** Just enough of an EditorView for `apply`: its state and dispatch. */
function fakeView(doc: string) {
  const view = {
    state: EditorState.create({ doc }),
    dispatch(...specs: TransactionSpec[]) {
      view.state = view.state.update(...specs).state;
    },
  };
  return view;
}

const autoImport: CompletionItem = {
  label: 'print',
  kind: 3,
  detail: 'auto-import from Basic',
  labelDetails: { description: 'Basic' },
  documentation: { value: 'Adds `#import "Basic";`' },
  sortText: '~print\u00010010',
  additionalTextEdits: [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      newText: '#import "Basic";\n\n',
    },
  ],
};

test('an auto-import shows its module and sorts below names in scope', () => {
  const option = completionOption(autoImport, text);
  assert.equal(option.label, 'print');
  assert.equal(option.detail, 'Basic');
  assert.equal(option.boost, AUTO_IMPORT_BOOST);
  assert.equal(option.info, 'Adds `#import "Basic";`');
  assert.equal(typeof option.apply, 'function');
});

test('accepting it inserts the name and the import, cursor after the name', () => {
  const doc = 'main :: () {\n    prin\n}\n';
  const view = fakeView(doc);
  const option = completionOption(autoImport, text);
  const from = doc.indexOf('prin');
  const apply = option.apply as (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number
  ) => void;
  apply(view as unknown as EditorView, option, from, from + 4);
  const result = view.state.doc.toString();
  assert.equal(result, '#import "Basic";\n\nmain :: () {\n    print\n}\n');
  assert.equal(
    view.state.selection.main.head,
    result.indexOf('print') + 'print'.length
  );
});

test('items without additional edits insert their text as before', () => {
  const option = completionOption(
    { label: 'value', kind: 6, detail: 'value: int' },
    text
  );
  assert.equal(option.apply, 'value');
  assert.equal(option.detail, 'value: int');
  assert.equal(option.boost, undefined);
});

test('edits that do not fit the text are left out', () => {
  assert.deepEqual(
    editChanges('a\nb', [
      {
        range: {
          start: { line: 9, character: 0 },
          end: { line: 9, character: 0 },
        },
        newText: 'x',
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'y',
      },
      { newText: 'no range' },
    ]),
    [{ from: 2, to: 2, insert: 'y' }]
  );
});
