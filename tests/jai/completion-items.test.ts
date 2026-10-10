import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Completion } from '@codemirror/autocomplete';
import {
  AUTO_IMPORT_BOOST,
  completionInfo,
  completionOption,
  editChanges,
} from '../../src/lib/jai/completion-items.ts';
import type { CompletionItem } from '../../src/lib/jai/lsp-types.ts';
import type { Documentation } from '../../src/lib/jai/lsp-features.ts';

/** Stands in for the DOM renderer: Markdown docs become a tagged object. */
const render = (doc: Documentation) =>
  ({ rendered: doc.value }) as unknown as Node;

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
  const option = completionOption(autoImport, render);
  assert.equal(option.label, 'print');
  assert.equal(option.detail, 'Basic');
  assert.equal(option.boost, AUTO_IMPORT_BOOST);
  assert.equal(option.info, 'Adds `#import "Basic";`');
  assert.equal(typeof option.apply, 'function');
});

test('accepting it inserts the name and the import, cursor after the name', () => {
  const doc = 'main :: () {\n    prin\n}\n';
  const view = fakeView(doc);
  const option = completionOption(autoImport, render);
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
    render
  );
  assert.equal(option.apply, 'value');
  assert.equal(option.detail, 'value: int');
  assert.equal(option.boost, undefined);
});

test('plain-text docs are shown as text, Markdown docs are rendered', () => {
  assert.equal(
    completionInfo({ label: 'a', documentation: 'plain' }, render),
    'plain'
  );
  const info = completionInfo(
    {
      label: 'divide',
      documentation: { kind: 'markdown', value: 'Divides `a` by [b].' },
    },
    render
  );
  assert.equal(typeof info, 'function');
  assert.deepEqual((info as () => unknown)(), {
    rendered: 'Divides `a` by [b].',
  });
});

test('items without docs resolve them lazily when the server can', async () => {
  const item: CompletionItem = { label: 'hail', data: { offset: 3 } };
  assert.equal(completionInfo(item, render), undefined);
  const asked: CompletionItem[] = [];
  const info = completionInfo(item, render, async (sent) => {
    asked.push(sent);
    return {
      ...sent,
      documentation: { kind: 'markdown', value: '# Hail' },
    };
  });
  const node = await (info as () => Promise<unknown>)();
  assert.deepEqual(node, { rendered: '# Hail' });
  assert.deepEqual(asked, [item]);
  // A failed or empty resolve shows no panel.
  const empty = completionInfo(item, render, async () => null);
  assert.equal(await (empty as () => Promise<unknown>)(), null);
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
