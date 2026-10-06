// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-nocheck -- hand-rolled DOM and client mocks; the code under test is typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../../src/lib/jai/workspace.ts';
import { documentUri } from '../../src/lib/jai/language-client.ts';
import {
  planWorkspaceEdit,
  renameSymbol,
  definitionTarget,
} from '../../src/lib/jai/language-actions.ts';

const range = (from, to) => ({
  start: { line: 0, character: from },
  end: { line: 0, character: to },
});
function setup() {
  const workspace = new Workspace('foo foo');
  workspace.add('lib/é.jai', 'foo');
  workspace.select('main.jai');
  const edit = () => ({
    documentChanges: workspace.documents.map((document) => ({
      textDocument: {
        uri: documentUri(document.path),
        version: document.version,
      },
      edits:
        document.path === 'main.jai'
          ? [
              { range: range(0, 3), newText: 'bar' },
              { range: range(4, 7), newText: 'bar' },
            ]
          : [{ range: range(0, 3), newText: 'bar' }],
    })),
  });
  const client = (result) => ({
    sync() {},
    async request() {
      return result;
    },
  });
  return { workspace, edit, client };
}

test('versioned multi-file rename applies every text edit atomically', async () => {
  const { workspace, edit, client } = setup();
  const before = workspace.documents;
  const updates = await renameSymbol(
    client(edit()),
    workspace,
    'main.jai',
    1,
    'bar'
  );
  assert.equal(updates.length, 2);
  assert.equal(workspace.snapshot().source, 'bar bar');
  assert.equal(workspace.snapshot().files['lib/é.jai'], 'bar');
  assert.ok(
    workspace.documents.every(
      (document) =>
        document.version >
        before.find((old) => old.path === document.path).version
    )
  );
  assert.equal(workspace.selected.path.name, 'main.jai');
});

test('a stale target in a multi-file edit preserves every document', async () => {
  const { workspace, edit, client } = setup();
  const before = workspace.documents,
    response = edit();
  response.documentChanges[1].textDocument.version--;
  await assert.rejects(
    renameSymbol(client(response), workspace, 'main.jai', 1, 'bar'),
    /stale/
  );
  assert.deepEqual(workspace.documents, before);
});

test('document changes during the request are preserved and reject the rename', async () => {
  const { workspace, edit } = setup();
  const response = edit();
  const client = {
    sync() {},
    async request() {
      workspace.select('lib/é.jai');
      workspace.edit('new text');
      return response;
    },
  };
  await assert.rejects(
    renameSymbol(client, workspace, 'main.jai', 1, 'bar'),
    /stale/
  );
  assert.equal(workspace.snapshot().source, 'foo foo');
  assert.equal(workspace.snapshot().files['lib/é.jai'], 'new text');
});

test('rename rejects external/noncanonical URIs and malformed or overlapping edits', () => {
  const { workspace, edit } = setup();
  for (const uri of [
    'file:///outside.jai',
    documentUri('main.jai') + '?query',
    documentUri('missing.jai'),
  ]) {
    const response = edit();
    response.documentChanges[0].textDocument.uri = uri;
    assert.throws(() => planWorkspaceEdit(workspace.documents, response));
  }
  const overlapping = edit();
  overlapping.documentChanges[0].edits.push({
    range: range(1, 4),
    newText: 'bad',
  });
  assert.throws(
    () => planWorkspaceEdit(workspace.documents, overlapping),
    /Overlapping/
  );
  const invalid = edit();
  invalid.documentChanges[0].edits[0].range = range(0, 99);
  assert.throws(
    () => planWorkspaceEdit(workspace.documents, invalid),
    /outside/
  );
  const unversioned = edit();
  unversioned.documentChanges[0].textDocument.version = null;
  assert.throws(
    () => planWorkspaceEdit(workspace.documents, unversioned),
    /stale/
  );
});

test('definition admits encoded workspace paths and UTF-16 target ranges', async () => {
  const workspace = new Workspace('call');
  workspace.add('lib/é.jai', '😀 foo');
  const client = {
    sync() {},
    async request() {
      return [
        {
          targetUri: documentUri('lib/é.jai'),
          targetSelectionRange: range(3, 6),
        },
      ];
    },
  };
  assert.deepEqual(await definitionTarget(client, workspace, 'main.jai', 1), {
    resource: {
      kind: 'workspace',
      path: 'lib/é.jai',
      uri: documentUri('lib/é.jai'),
    },
    path: 'lib/é.jai',
    from: 3,
    to: 6,
  });
  client.request = async () => ({
    uri: documentUri('lib/é.jai'),
    range: range(1, 2),
  });
  await assert.rejects(
    definitionTarget(client, workspace, 'main.jai', 1),
    /surrogate/
  );
});

test('a closed session cannot apply a resolved rename', async () => {
  const { workspace, edit } = setup();
  const before = workspace.documents,
    response = edit(),
    controller = new AbortController();
  const client = {
    sync() {},
    async request() {
      controller.abort();
      return response;
    },
  };
  await assert.rejects(
    renameSymbol(client, workspace, 'main.jai', 1, 'bar', controller.signal),
    { name: 'AbortError' }
  );
  assert.deepEqual(workspace.documents, before);
});
