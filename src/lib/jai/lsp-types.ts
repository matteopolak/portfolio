// The subset of the Language Server Protocol the owned editor speaks.
import type { RunOutput } from './engine.ts';

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LocationLink {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange?: Range;
}

export type MarkupText = string | { value?: unknown } | MarkupText[];

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: MarkupText;
  insertText?: string;
  insertTextFormat?: number;
}

export interface CompletionList {
  items?: CompletionItem[];
}

export interface Hover {
  contents: MarkupText;
  range?: Range;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  message: unknown;
  source?: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

export interface TextEdit {
  range?: Range;
  newText?: unknown;
}

export interface TextDocumentEdit {
  kind?: string;
  textDocument?: { uri: string; version?: number | null };
  edits?: TextEdit[];
}

export interface WorkspaceEdit {
  documentChanges?: TextDocumentEdit[];
  changes?: unknown;
  changeAnnotations?: unknown;
}

export interface ServerCapabilities {
  definitionProvider?: unknown;
  renameProvider?: unknown;
}

export interface InitializeResult {
  capabilities?: ServerCapabilities;
}

export interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

/** Messages exchanged with the compiler worker. */
export type WorkerRequest =
  | { type: 'init'; id?: undefined; url: string }
  | { type: 'lsp'; id: number; message: JsonRpcMessage }
  | {
      type: 'run';
      id: number;
      source: string;
      options: { files: Record<string, string>; budget: number };
    }
  | {
      /** Runs `main` from a whole `/workspace` file map (the formatter driver). */
      type: 'play';
      id: number;
      files: Record<string, string>;
      main: string;
      budget: number;
    };

export type WorkerResponse =
  | {
      type: 'init';
      capabilities: { languageServer: boolean };
      error?: undefined;
    }
  | { type: 'lsp'; id: number; messages: JsonRpcMessage[]; error?: undefined }
  | { type: 'run'; id: number; result: RunOutput; error?: undefined }
  | { type: 'play'; id: number; result: RunOutput; error?: undefined }
  | { type: WorkerRequest['type']; id?: number; error: string };
