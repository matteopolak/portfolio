import {
  documentUri,
  pathFromUri,
  positionAt,
  offsetAt,
} from './language-client.js';

function admittedDocument(documents, uri) {
  const path = pathFromUri(uri);
  if (documentUri(path) !== uri)
    throw new Error('Language edit uses a noncanonical workspace URI.');
  const document = documents.find((document) => document.path === path);
  if (!document)
    throw new Error('Language edit targets a file outside the workspace.');
  return document;
}
function sameWorkspace(before, after) {
  return (
    before.length === after.length &&
    before.every((document) =>
      after.some(
        (current) =>
          current.path === document.path &&
          current.version === document.version &&
          current.text === document.text
      )
    )
  );
}
export function planWorkspaceEdit(documents, edit) {
  if (
    !edit ||
    !Array.isArray(edit.documentChanges) ||
    edit.changes ||
    edit.changeAnnotations
  )
    throw new Error('Rename requires versioned document edits.');
  const seen = new Set();
  return edit.documentChanges.map((change) => {
    if (change.kind || !change.textDocument || !Array.isArray(change.edits))
      throw new Error('Unsupported language edit.');
    const document = admittedDocument(documents, change.textDocument.uri);
    if (seen.has(document.path)) throw new Error('Duplicate document edit.');
    seen.add(document.path);
    if (
      !Number.isInteger(change.textDocument.version) ||
      document.version !== change.textDocument.version
    )
      throw new Error('Rename is stale; no files were changed.');
    const edits = change.edits
      .map((edit) => {
        if (typeof edit.newText !== 'string' || !edit.range)
          throw new Error('Invalid language text edit.');
        const from = offsetAt(document.text, edit.range.start),
          to = offsetAt(document.text, edit.range.end);
        if (to < from) throw new Error('Invalid language edit range.');
        return { from, to, text: edit.newText };
      })
      .sort((a, b) => a.from - b.from || a.to - b.to);
    for (let index = 1; index < edits.length; index++)
      if (
        edits[index].from < edits[index - 1].to ||
        edits[index].from === edits[index - 1].from
      )
        throw new Error('Overlapping language edits.');
    let text = document.text;
    for (const edit of [...edits].reverse())
      text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
    return {
      path: document.path,
      version: document.version,
      text,
      changes: edits.map((edit) => ({
        from: edit.from,
        to: edit.to,
        insert: edit.text,
      })),
    };
  });
}
export async function definitionTarget(
  client,
  workspace,
  path,
  offset,
  signal
) {
  const before = workspace.documents,
    document = before.find((item) => item.path === path);
  if (!document) throw new Error('Select a source file.');
  client.sync(before);
  const result = await client.request(
    'textDocument/definition',
    {
      textDocument: { uri: documentUri(path) },
      position: positionAt(document.text, offset),
    },
    signal
  );
  if (signal?.aborted) throw new DOMException('Closed', 'AbortError');
  if (!sameWorkspace(before, workspace.documents))
    throw new Error('Workspace changed; retry definition.');
  if (result == null) return undefined;
  const location = Array.isArray(result) ? result[0] : result;
  if (!location) return undefined;
  const target = admittedDocument(before, location.targetUri ?? location.uri);
  const range = location.targetSelectionRange ?? location.range;
  if (!range) throw new Error('Invalid definition location.');
  const from = offsetAt(target.text, range.start),
    to = offsetAt(target.text, range.end);
  if (to < from) throw new Error('Invalid definition range.');
  return { path: target.path, from, to };
}
export async function renameSymbol(
  client,
  workspace,
  path,
  offset,
  newName,
  signal
) {
  if (!/^[_\p{L}][_\p{L}\p{N}]*$/u.test(newName))
    throw new Error('Enter a valid identifier.');
  const before = workspace.documents,
    document = before.find((item) => item.path === path);
  if (!document) throw new Error('Select a source file.');
  client.sync(before);
  const result = await client.request(
    'textDocument/rename',
    {
      textDocument: { uri: documentUri(path) },
      position: positionAt(document.text, offset),
      newName,
    },
    signal
  );
  if (signal?.aborted) throw new DOMException('Closed', 'AbortError');
  if (!sameWorkspace(before, workspace.documents))
    throw new Error('Rename is stale; no files were changed.');
  if (result == null) return [];
  const updates = planWorkspaceEdit(before, result);
  workspace.applyDocumentEdits(updates);
  return updates;
}
