import { SourcePath, type WorkspaceDocument } from './workspace.ts';
import type {
  JsonRpcMessage,
  Position,
  PublishDiagnosticsParams,
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
export function pathFromUri(uri: string): string {
  const url = new URL(uri);
  if (
    url.protocol !== 'file:' ||
    url.host ||
    !url.pathname.startsWith('/jai-script/')
  )
    throw new TypeError('Language server returned a non-workspace URI.');
  return SourcePath.parse(
    decodeURIComponent(url.pathname.slice('/jai-script/'.length))
  ).name;
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

export class LanguageClient {
  #worker: Worker;
  #next = 0;
  #pending = new Map<number | string | null | undefined, PendingRequest>();
  #opened = new Map<string, number>();
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
            rename: { prepareSupport: false },
            hover: { contentFormat: ['plaintext'] },
            completion: {
              completionItem: {
                snippetSupport: false,
                documentationFormat: ['plaintext'],
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
      const uri = documentUri(path);
      current.add(uri);
      const previous = this.#opened.get(uri);
      if (previous === version) continue;
      this.#opened.set(uri, version);
      if (previous === undefined)
        this.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: 'jai', version, text },
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
  dispose(error = new Error('Language service stopped.')) {
    this.#stopped = true;
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
    this.#opened.clear();
  }
}
