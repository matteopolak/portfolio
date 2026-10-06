import {
  documentUri,
  pathFromUri,
  positionAt,
  offsetAt,
  resourceFromUri,
  type LanguageClient,
  type UriResource,
} from './language-client.ts';
import type {
  DocumentUpdate,
  Workspace,
  WorkspaceDocument,
} from './workspace.ts';
import type {
  Location,
  LocationLink,
  Range,
  TextEdit,
  WorkspaceEdit,
} from './lsp-types.ts';

export interface PlannedEdit extends DocumentUpdate {
  changes: { from: number; to: number; insert: string }[];
}

function admittedDocument(
  documents: readonly WorkspaceDocument[],
  uri: string
): WorkspaceDocument {
  const path = pathFromUri(uri);
  if (path === undefined)
    throw new Error('Language edit targets a file outside the workspace.');
  if (documentUri(path) !== uri)
    throw new Error('Language edit uses a noncanonical workspace URI.');
  const document = documents.find((document) => document.path === path);
  if (!document)
    throw new Error('Language edit targets a file outside the workspace.');
  return document;
}
export function sameWorkspace(
  before: readonly WorkspaceDocument[],
  after: readonly WorkspaceDocument[]
) {
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
function planDocument(
  document: WorkspaceDocument,
  edits: unknown
): PlannedEdit {
  if (!Array.isArray(edits)) throw new Error('Unsupported language edit.');
  const ranges = (edits as TextEdit[])
    .map((edit) => {
      if (typeof edit?.newText !== 'string' || !edit.range)
        throw new Error('Invalid language text edit.');
      const from = offsetAt(document.text, edit.range.start),
        to = offsetAt(document.text, edit.range.end);
      if (to < from) throw new Error('Invalid language edit range.');
      return { from, to, text: edit.newText };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < ranges.length; index++)
    if (
      ranges[index].from < ranges[index - 1].to ||
      ranges[index].from === ranges[index - 1].from
    )
      throw new Error('Overlapping language edits.');
  let text = document.text;
  for (const edit of [...ranges].reverse())
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return {
    path: document.path,
    version: document.version,
    text,
    changes: ranges.map((edit) => ({
      from: edit.from,
      to: edit.to,
      insert: edit.text,
    })),
  };
}
/**
 * Turns a WorkspaceEdit into checked per-file edits without changing anything.
 * Versioned `documentChanges` must match each file's version. Unversioned
 * `changes` (what the server sends for rename and code actions) are accepted
 * because every caller also checks that the whole workspace is unchanged since
 * the request was sent. Targets must be open workspace files; resource
 * operations, external targets, invalid ranges and overlaps are rejected.
 */
export function planWorkspaceEdit(
  documents: readonly WorkspaceDocument[],
  edit: WorkspaceEdit | null | undefined
): PlannedEdit[] {
  if (!edit || edit.changeAnnotations)
    throw new Error('Unsupported language edit.');
  const seen = new Set<string>();
  const admit = (uri: string) => {
    const document = admittedDocument(documents, uri);
    if (seen.has(document.path)) throw new Error('Duplicate document edit.');
    seen.add(document.path);
    return document;
  };
  if (Array.isArray(edit.documentChanges)) {
    if (edit.changes) throw new Error('Unsupported language edit.');
    return edit.documentChanges.map((change) => {
      if (change.kind || !change.textDocument)
        throw new Error('Unsupported language edit.');
      const document = admit(change.textDocument.uri);
      if (
        !Number.isInteger(change.textDocument.version) ||
        document.version !== change.textDocument.version
      )
        throw new Error('Edit is stale; no files were changed.');
      return planDocument(document, change.edits);
    });
  }
  if (
    typeof edit.changes !== 'object' ||
    edit.changes === null ||
    Array.isArray(edit.changes)
  )
    throw new Error('Unsupported language edit.');
  return Object.entries(edit.changes).map(([uri, edits]) =>
    planDocument(admit(uri), edits)
  );
}

/**
 * Where a navigation lands: a workspace file, or (with `text`) a read-only
 * module, stdlib file or expansion fetched with `jai/source`.
 */
export interface NavigationTarget {
  resource: UriResource;
  path: string;
  from: number;
  to: number;
  text?: string;
}

/** Location, LocationLink, an array of either, or null → plain locations. */
export function normalizeLocations(result: unknown): Location[] {
  const items = Array.isArray(result) ? result : result ? [result] : [];
  const locations: Location[] = [];
  for (const item of items as (Location | LocationLink)[]) {
    if (!item || typeof item !== 'object') continue;
    if ('targetUri' in item && typeof item.targetUri === 'string') {
      const range = item.targetSelectionRange ?? item.targetRange;
      if (range) locations.push({ uri: item.targetUri, range });
    } else if ('uri' in item && typeof item.uri === 'string' && item.range)
      locations.push({ uri: item.uri, range: item.range });
  }
  return locations;
}

const closed = () => new DOMException('Closed', 'AbortError');

/** Resolves one server location to editor offsets, fetching read-only text if needed. */
export async function resolveLocation(
  client: LanguageClient,
  documents: readonly WorkspaceDocument[],
  uri: string,
  range: Range | undefined,
  signal?: AbortSignal
): Promise<NavigationTarget | undefined> {
  const resource = resourceFromUri(uri);
  if (!resource) return undefined;
  const span = (text: string) => {
    if (!range) return { from: 0, to: 0 };
    const from = offsetAt(text, range.start),
      to = offsetAt(text, range.end);
    if (to < from) throw new Error('Invalid location range.');
    return { from, to };
  };
  if (resource.kind === 'workspace') {
    const target = admittedDocument(documents, uri);
    return { resource, path: target.path, ...span(target.text) };
  }
  const text = await client.request<string | null>(
    'jai/source',
    { uri },
    signal
  );
  if (signal?.aborted) throw closed();
  if (typeof text !== 'string') return undefined;
  return { resource, path: resource.path, text, ...span(text) };
}

/** Sends a position request from a workspace file; fails if the workspace changed meanwhile. */
export async function positionRequest<T>(
  client: LanguageClient,
  workspace: Workspace,
  method: string,
  path: string,
  offset: number,
  extra: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<{ result: T; documents: readonly WorkspaceDocument[] }> {
  const before = workspace.documents,
    document = before.find((item) => item.path === path);
  if (!document) throw new Error('Select a source file.');
  client.sync(before);
  const result = await client.request<T>(
    method,
    {
      textDocument: { uri: documentUri(path) },
      position: positionAt(document.text, offset),
      ...extra,
    },
    signal
  );
  if (signal?.aborted) throw closed();
  if (!sameWorkspace(before, workspace.documents))
    throw new Error('Workspace changed; try again.');
  return { result, documents: before };
}

/** Definition (or, with `method`, type definition): the first target. */
export async function definitionTarget(
  client: LanguageClient,
  workspace: Workspace,
  path: string,
  offset: number,
  signal?: AbortSignal,
  method = 'textDocument/definition'
): Promise<NavigationTarget | undefined> {
  const { result, documents } = await positionRequest<unknown>(
    client,
    workspace,
    method,
    path,
    offset,
    {},
    signal
  );
  const [location] = normalizeLocations(result);
  if (!location) return undefined;
  return resolveLocation(
    client,
    documents,
    location.uri,
    location.range,
    signal
  );
}

/** `prepareRename`: the range to rename, or undefined when the name can't be renamed. */
export async function prepareRename(
  client: LanguageClient,
  workspace: Workspace,
  path: string,
  offset: number,
  signal?: AbortSignal
): Promise<{ from: number; to: number } | undefined> {
  const { result, documents } = await positionRequest<
    Range | { range: Range } | { defaultBehavior: boolean } | null
  >(client, workspace, 'textDocument/prepareRename', path, offset, {}, signal);
  if (!result || typeof result !== 'object') return undefined;
  const text = documents.find((item) => item.path === path)!.text;
  const range =
    'start' in result ? result : 'range' in result ? result.range : undefined;
  if (!range) return undefined;
  const from = offsetAt(text, range.start),
    to = offsetAt(text, range.end);
  return to > from ? { from, to } : undefined;
}

export async function renameSymbol(
  client: LanguageClient,
  workspace: Workspace,
  path: string,
  offset: number,
  newName: string,
  signal?: AbortSignal
): Promise<PlannedEdit[]> {
  if (!/^[_\p{L}][_\p{L}\p{N}]*$/u.test(newName))
    throw new Error('Enter a valid identifier.');
  const { result, documents } = await positionRequest<WorkspaceEdit | null>(
    client,
    workspace,
    'textDocument/rename',
    path,
    offset,
    { newName },
    signal
  ).catch((error: unknown) => {
    if (error instanceof Error && error.message.startsWith('Workspace changed'))
      throw new Error('Rename is stale; no files were changed.');
    throw error;
  });
  if (result == null) return [];
  const updates = planWorkspaceEdit(documents, result);
  workspace.applyDocumentEdits(updates);
  return updates;
}

/**
 * Applies a WorkspaceEdit computed against `documents` (a code action's edit)
 * if the workspace still holds exactly those documents.
 */
export function applyWorkspaceEdit(
  workspace: Workspace,
  documents: readonly WorkspaceDocument[],
  edit: WorkspaceEdit
): PlannedEdit[] {
  if (!sameWorkspace(documents, workspace.documents))
    throw new Error('Edit is stale; no files were changed.');
  const updates = planWorkspaceEdit(documents, edit);
  workspace.applyDocumentEdits(updates);
  return updates;
}
