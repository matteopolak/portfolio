import { SourcePath, type WorkspaceDocument } from './workspace.ts';
import type {
  JsonRpcMessage,
  Position,
  PublishDiagnosticsParams,
  Range,
  InitializeResult,
  WorkerResponse,
} from './lsp-types.ts';
export function documentUri(path: string): string {
  return `file:///jai-script/${SourcePath.parse(path)
    .name.split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/gu,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/')}`;
}
/**
 * What a server URI names:
 * - `workspace`: an editable file, `file:///jai-script/<path>`;
 * - `library`: a read-only module or stdlib file the server can serve with
 *   `jai/source`, `file:///stdlib/Basic/module.jai` (path `stdlib/Basic/module.jai`);
 * - `expansion`: generated code, `jai-expansion:///jai-script/<path>?<line>:<character>`,
 *   named after its source position (1-based) for the read-only tab.
 */
export type UriResource =
  | { kind: 'workspace'; path: string; uri: string }
  | { kind: 'library'; path: string; uri: string }
  | { kind: 'expansion'; path: string; source: string; uri: string };

export function resourceFromUri(uri: string): UriResource | undefined {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return undefined;
  }
  if (url.host) return undefined;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  const inWorkspace = (value: string) => {
    if (!value.startsWith('/jai-script/')) return undefined;
    try {
      return SourcePath.parse(value.slice('/jai-script/'.length)).name;
    } catch {
      return undefined;
    }
  };
  if (url.protocol === 'jai-expansion:') {
    const source = inWorkspace(pathname);
    const at = /^\?(\d+):(\d+)$/u.exec(url.search);
    if (!source || !at) return undefined;
    return {
      kind: 'expansion',
      path: `${source}:${Number(at[1]) + 1}:${Number(at[2]) + 1}`,
      source,
      uri,
    };
  }
  if (url.protocol !== 'file:' || url.search || url.hash) return undefined;
  const path = inWorkspace(pathname);
  if (path) return { kind: 'workspace', path, uri };
  const library = pathname.replace(/^\/+/u, '');
  if (
    !library ||
    library.startsWith('jai-script/') ||
    library.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return undefined;
  return { kind: 'library', path: library, uri };
}

/**
 * A document link's target split into a URI and the line it points at. Doc
 * comment links (`[print]`) target `file:///stdlib/Basic/Print.jai#L1213`,
 * a 1-based line; `#import` links have no fragment.
 */
export function linkTarget(target: string): { uri: string; range?: Range } {
  const match = /^([^#]*)#L(\d+)$/u.exec(target);
  if (!match || Number(match[2]) < 1) return { uri: target };
  const position = { line: Number(match[2]) - 1, character: 0 };
  return { uri: match[1], range: { start: position, end: position } };
}

/** The workspace path of a `file:///jai-script/` URI; undefined for any other URI. */
export function pathFromUri(uri: string): string | undefined {
  const resource = resourceFromUri(uri);
  return resource?.kind === 'workspace' ? resource.path : undefined;
}
export function positionAt(text: string, offset: number): Position {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    throw new RangeError('Invalid document offset.');
  const prefix = text.slice(0, offset);
  const line = prefix.lastIndexOf('\n');
  return { line: prefix.split('\n').length - 1, character: offset - line - 1 };
}
export function offsetAt(text: string, position: Position | undefined): number {
  if (
    !position ||
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.character) ||
    position.line < 0 ||
    position.character < 0
  )
    throw new RangeError('Invalid document position.');
  let from = 0;
  for (let i = 0; i < position.line; i++) {
    const next = text.indexOf('\n', from);
    if (next < 0) throw new RangeError('Position outside document.');
    from = next + 1;
  }
  let end = text.indexOf('\n', from);
  if (end < 0) end = text.length;
  if (position.character > end - from)
    throw new RangeError('Position outside line.');
  const offset = from + position.character;
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/u.test(text[offset])
  )
    throw new RangeError('Position splits a surrogate pair.');
  return offset;
}
/** `range` as offsets in `text`, or undefined when it does not fit (stale or reversed). */
export function rangeOffsets(
  text: string,
  range: Range | undefined
): { from: number; to: number } | undefined {
  if (!range) return undefined;
  try {
    const from = offsetAt(text, range.start);
    const to = offsetAt(text, range.end);
    return from <= to ? { from, to } : undefined;
  } catch {
    return undefined;
  }
}
interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface LanguageClientOptions {
  diagnostics?: (params: PublishDiagnosticsParams) => void;
  failure?: (message: string) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** jailint's settings file, which the server reads from any folder of the workspace. */
export const LINT_SETTINGS = 'jailint.toml';
/**
 * Default `jailint.toml` for new workspaces: every rule at its default level,
 * plus the opt-in ones turned on, so the playground shows everything jailint can find.
 */
export const lintConfigStarter = `# Settings for jailint, whose findings show in the editor.
# Levels: "allow" (off), "warn" or "deny". A jailint.toml in a subfolder
# overrides this one for the files under it.

[rules]
# Off by default outside the playground:
float_equality = "warn"  # \`==\` or \`!=\` between two computed floats
lossy_xx = "warn"        # \`xx\` that narrows a number to a smaller type
# Turn any rule off by name, e.g.:
# unused_parameter = "allow"
`;

export const isLintSettings = (path: string) =>
  path === LINT_SETTINGS || path.endsWith(`/${LINT_SETTINGS}`);

export class LanguageClient {
  #worker: Worker;
  #next = 0;
  #pending = new Map<number | string | null | undefined, PendingRequest>();
  #opened = new Map<string, number>();
  // Read-only documents (stdlib previews) opened for highlighting and links;
  // `sync` leaves them alone.
  #readonly = new Set<string>();
  #stopped = false;
  diagnostics: (params: PublishDiagnosticsParams) => void;
  failure: (message: string) => void;
  constructor(
    worker: Worker,
    { diagnostics = () => {}, failure = () => {} }: LanguageClientOptions = {}
  ) {
    this.#worker = worker;
    this.diagnostics = diagnostics;
    this.failure = failure;
    worker.addEventListener(
      'message',
      ({ data }: MessageEvent<WorkerResponse>) => {
        if (this.#stopped || data.type !== 'lsp') return;
        if (data.error !== undefined) {
          this.#fail(String(data.error));
          return;
        }
        const messages = 'messages' in data ? data.messages : [];
        const rejected = messages.find(
          (message) =>
            message.method === 'window/logMessage' &&
            isRecord(message.params) &&
            message.params.type === 1
        );
        if (rejected) {
          const params = isRecord(rejected.params) ? rejected.params : {};
          this.#fail(
            String(
              params.message ||
                'Language server rejected document synchronization.'
            )
          );
          return;
        }
        for (const message of messages) {
          if (message.method === 'textDocument/publishDiagnostics') {
            const params = message.params as
              | PublishDiagnosticsParams
              | undefined;
            const expected = params ? this.#opened.get(params.uri) : undefined;
            if (params && expected !== undefined && params.version === expected)
              this.diagnostics(params);
          } else if (Object.hasOwn(message, 'id')) {
            const entry = this.#pending.get(message.id);
            if (!entry) continue;
            this.#pending.delete(message.id);
            clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(message.error.message));
            else entry.resolve(message.result);
          }
        }
      }
    );
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.#fail(event.message || 'Language worker failed.');
    });
  }
  #fail(message: string) {
    if (this.#stopped) return;
    this.dispose(new Error(message));
    this.failure(message);
  }
  #send(message: JsonRpcMessage, id = message.id ?? ++this.#next) {
    if (this.#stopped) return;
    this.#worker.postMessage({
      type: 'lsp',
      id,
      message: { jsonrpc: '2.0', ...message },
    });
  }
  notify(method: string, params: unknown) {
    this.#send({ method, params });
  }
  request<T = unknown>(
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    if (this.#stopped)
      return Promise.reject(new Error('Language service stopped.'));
    const id = ++this.#next;
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        if (!this.#pending.has(id)) return;
        this.#pending.delete(id);
        clearTimeout(timer);
        this.notify('$/cancelRequest', { id });
        reject(new DOMException('Request cancelled', 'AbortError'));
      };
      const timer = setTimeout(cancel, 10000);
      this.#pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', cancel);
          resolve(value as T);
        },
        reject: (error: Error) => {
          signal?.removeEventListener('abort', cancel);
          reject(error);
        },
        timer,
      });
      if (signal?.aborted) {
        cancel();
        return;
      }
      signal?.addEventListener('abort', cancel, { once: true });
      this.#send({ id, method, params });
    });
  }
  async initialize(): Promise<InitializeResult | undefined> {
    const result = await this.request<InitializeResult | undefined>(
      'initialize',
      {
        processId: null,
        rootUri: 'file:///jai-script/',
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          workspace: { workspaceEdit: { documentChanges: true } },
          textDocument: {
            publishDiagnostics: { versionSupport: true },
            definition: { linkSupport: true },
            typeDefinition: { linkSupport: false },
            rename: { prepareSupport: true },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            // Doc comments: Markdown documentation with each signature and
            // parameter (jailsp sends plain text unless asked).
            signatureHelp: {
              signatureInformation: {
                documentationFormat: ['markdown', 'plaintext'],
                parameterInformation: { labelOffsetSupport: true },
              },
            },
            inlayHint: {},
            documentLink: { tooltipSupport: false },
            foldingRange: { lineFoldingOnly: true },
            codeAction: {
              // jailint's fixes are `quickfix` and its fix-all is
              // `source.fixAll.jailint`; expansions are `refactor.inline`.
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: [
                    'quickfix',
                    'refactor',
                    'refactor.inline',
                    'source',
                    'source.fixAll',
                  ],
                },
              },
            },
            codeLens: {},
            semanticTokens: {
              requests: { full: true },
              formats: ['relative'],
              tokenTypes: [],
              tokenModifiers: [],
            },
            completion: {
              completionItem: {
                snippetSupport: false,
                documentationFormat: ['markdown', 'plaintext'],
              },
            },
          },
        },
      }
    );
    this.notify('initialized', {});
    return result;
  }
  sync(documents: readonly WorkspaceDocument[]) {
    if (this.#stopped) return;
    const current = new Set<string>();
    for (const { path, text, version } of documents) {
      // Jai sources are language documents. So is each `jailint.toml`: the
      // browser server has no disk, so its lint settings come as an open
      // document (it publishes no diagnostics for it). jaifmt.toml is not.
      const languageId = path.endsWith('.jai')
        ? 'jai'
        : isLintSettings(path)
          ? 'toml'
          : undefined;
      if (!languageId) continue;
      const uri = documentUri(path);
      current.add(uri);
      const previous = this.#opened.get(uri);
      if (previous === version) continue;
      this.#opened.set(uri, version);
      if (previous === undefined)
        this.notify('textDocument/didOpen', {
          textDocument: { uri, languageId, version, text },
        });
      else
        this.notify('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
    }
    for (const uri of this.#opened.keys())
      if (!current.has(uri)) {
        this.#opened.delete(uri);
        this.notify('textDocument/didClose', { textDocument: { uri } });
      }
  }
  /** Opens a read-only document (a stdlib file) once; diagnostics for it are dropped. */
  openReadonly(uri: string, text: string) {
    if (this.#stopped || this.#readonly.has(uri) || this.#opened.has(uri))
      return;
    this.#readonly.add(uri);
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'jai', version: 1, text },
    });
  }
  closeReadonly(uri: string) {
    if (this.#stopped || !this.#readonly.delete(uri)) return;
    this.notify('textDocument/didClose', { textDocument: { uri } });
  }
  dispose(error = new Error('Language service stopped.')) {
    this.#stopped = true;
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
    this.#opened.clear();
    this.#readonly.clear();
  }
}
