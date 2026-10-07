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
  code?: string | number;
  /** A link to the rule's documentation (jailint: its section of jailint.md). */
  codeDescription?: { href: string };
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
  /** Unversioned edits by URI; checked against an unchanged workspace instead. */
  changes?: Record<string, TextEdit[]>;
  changeAnnotations?: unknown;
}

export interface Command {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface CodeAction {
  title: string;
  kind?: string;
  /** The diagnostics this action resolves (jailint: the lint it fixes). */
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: Command;
  /** Server data; jailint's fixes carry `{ rule }`. */
  data?: unknown;
}

export interface CodeLens {
  range: Range;
  command?: Command;
}

export interface InlayHintLabelPart {
  value: string;
  tooltip?: MarkupText;
}

export interface InlayHint {
  position: Position;
  label: string | InlayHintLabelPart[];
  /** 1 type, 2 parameter. */
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: MarkupText;
}

export interface SignatureInformation {
  label: string;
  documentation?: MarkupText;
  parameters?: { label: string | [number, number] }[];
  activeParameter?: number;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface DocumentLink {
  range: Range;
  target?: string;
}

export interface DocumentHighlight {
  range: Range;
  kind?: number;
}

export interface FoldingRange {
  startLine: number;
  endLine: number;
  startCharacter?: number;
  endCharacter?: number;
  kind?: string;
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

export interface SemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

/** The `jai/expansion` result (also `jai.showExpansion`). */
export interface Expansion {
  uri: string;
  kind?: string;
  text: string;
  source?: Location;
}

/** Providers are `true`, an options object, or absent; anything else is treated as present. */
export interface ServerCapabilities {
  hoverProvider?: unknown;
  definitionProvider?: unknown;
  typeDefinitionProvider?: unknown;
  referencesProvider?: unknown;
  renameProvider?: unknown;
  documentHighlightProvider?: unknown;
  workspaceSymbolProvider?: unknown;
  foldingRangeProvider?: unknown;
  documentLinkProvider?: unknown;
  inlayHintProvider?: unknown;
  signatureHelpProvider?: {
    triggerCharacters?: string[];
    retriggerCharacters?: string[];
  };
  codeActionProvider?: unknown;
  codeLensProvider?: unknown;
  executeCommandProvider?: { commands?: string[] };
  semanticTokensProvider?: {
    legend?: SemanticTokensLegend;
    full?: unknown;
  };
  experimental?: { jai?: { expansions?: boolean } };
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
  error?: { code?: number; message: string };
}

/** A Render tab event for a running program (stdlib/Input/wasm.jai's Canvas_Event). */
export interface CanvasInputEvent {
  type: number;
  key?: number;
  pressed?: boolean;
  modifiers?: number;
  x?: number;
  y?: number;
  utf32?: number;
  repeat?: boolean;
}

/** Messages exchanged with the compiler worker. */
export type WorkerRequest =
  | {
      type: 'init';
      id?: undefined;
      url: string;
      /**
       * The canvas WebGPU programs draw into, and the bundle's host for it.
       * The page sends them only where WebGPU and JSPI both exist.
       */
      canvas?: OffscreenCanvas;
      hostUrl?: string;
    }
  /** Canvas events for a running program (stdlib/Input/wasm.jai's Canvas_Event). */
  | { type: 'input'; id?: undefined; event: CanvasInputEvent }
  | { type: 'resize'; id?: undefined; width: number; height: number }
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
    }
  | {
      /**
       * Fetches and compiles `jaifmt.wasm` (checked against the release
       * metadata). `unsupported` simulates an engine without Memory64.
       */
      type: 'jaifmt-load';
      id: number;
      url: string;
      metadataUrl: string;
      unsupported?: boolean;
    }
  | {
      /** Formats `target` from the workspace with the loaded `jaifmt.wasm`. */
      type: 'jaifmt';
      id: number;
      documents: { path: string; text: string }[];
      target: string;
    };

export type WorkerResponse =
  | {
      type: 'init';
      capabilities: {
        languageServer: boolean;
        /**
         * Present when the page sent a canvas: whether programs can draw on
         * it (the bundle has a WebGPU host), and whether that host reports
         * surface changes (`surface` messages).
         */
        canvas?: { drawing: boolean; surfaceEvents: boolean };
      };
      error?: undefined;
    }
  /**
   * The running program configured its drawing surface at `size` (canvas
   * pixels), or unconfigured it (null).
   */
  | {
      type: 'surface';
      id?: undefined;
      size: { width: number; height: number } | null;
      error?: undefined;
    }
  | { type: 'lsp'; id: number; messages: JsonRpcMessage[]; error?: undefined }
  | { type: 'run'; id: number; result: RunOutput; error?: undefined }
  /** Output a running program wrote so far (it waited for the page). */
  | {
      type: 'output';
      id?: undefined;
      stream: 'stdout' | 'stderr';
      text: string;
      error?: undefined;
    }
  | { type: 'play'; id: number; result: RunOutput; error?: undefined }
  | { type: 'jaifmt-load'; id: number; available: boolean; error?: undefined }
  | {
      type: 'jaifmt';
      id: number;
      result: RunOutput;
      /** Milliseconds spent in jaifmt.wasm. */
      ms: number;
      error?: undefined;
    }
  | { type: WorkerRequest['type']; id?: number; error: string };
