/*
 * Pure pieces of the editor's language features: capability checks, the
 * semantic-token legend, inlay-hint labels and signature-help splitting. The
 * CodeMirror side lives in `lsp-extensions.ts`; keeping this DOM-free lets
 * tests cover it directly.
 */
import type {
  InlayHint,
  MarkupText,
  SemanticTokensLegend,
  ServerCapabilities,
  SignatureHelp,
  SignatureInformation,
} from './lsp-types.ts';

/** A provider counts when it is advertised as anything but `false`/absent. */
export function provides(
  capabilities: ServerCapabilities | undefined,
  name: keyof ServerCapabilities
): boolean {
  const value = capabilities?.[name];
  return value !== undefined && value !== null && value !== false;
}

export function supportsCommand(
  capabilities: ServerCapabilities | undefined,
  command: string
): boolean {
  return Boolean(
    capabilities?.executeCommandProvider?.commands?.includes(command)
  );
}

/**
 * Class for a token type. Keywords, strings, numbers, operators and plain
 * variables are left to the tokenizer, which already colours them; semantic
 * tokens only add what it can't know (a name's kind).
 */
const typeClasses: Record<string, string> = {
  function: 'cm-sem-function',
  type: 'cm-sem-type',
  macro: 'cm-sem-macro',
  namespace: 'cm-sem-namespace',
  // Fields: the tokenizer's colour in code, but a doc-comment link to a
  // field (`[Point.x]`) must stand out from the comment.
  property: 'cm-sem-property',
  typeParameter: 'cm-sem-type-parameter',
  enumMember: 'cm-sem-enum-member',
  decorator: 'cm-sem-decorator',
  formatSpecifier: 'cm-sem-format',
};

/**
 * The server's legend decides what each index means. It is append-only, so an
 * older server simply has fewer entries; unknown names get no class.
 */
export interface TokenLegend {
  types: readonly (string | undefined)[];
  modifiers: readonly string[];
}

export function tokenLegend(
  legend: SemanticTokensLegend | undefined
): TokenLegend | undefined {
  if (!legend || !Array.isArray(legend.tokenTypes)) return undefined;
  return {
    types: legend.tokenTypes.map((name) =>
      typeof name === 'string' ? name : undefined
    ),
    modifiers: Array.isArray(legend.tokenModifiers)
      ? legend.tokenModifiers.map(String)
      : [],
  };
}

/** The CSS classes of one token, or undefined when the tokenizer's colour stands. */
export function tokenClass(
  legend: TokenLegend,
  type: number,
  modifierBits: number
): string | undefined {
  const name = legend.types[type];
  if (name === undefined) return undefined;
  const modifiers = legend.modifiers.filter(
    (_, index) => index < 31 && modifierBits & (1 << index)
  );
  let base = typeClasses[name];
  // A use of a constant or enum value (`N`, `.RED`) reads as a constant.
  if (!base && name === 'variable' && modifiers.includes('readonly'))
    base = 'cm-sem-constant';
  if (!base) return undefined;
  // `#expand` procedures are `function` + `macro`.
  return modifiers.includes('macro') && name === 'function'
    ? `${base} cm-sem-expand`
    : base;
}

export interface TokenSpan {
  from: number;
  to: number;
  className: string;
}

/**
 * Decodes relative `semanticTokens/full` data against `text` (UTF-16 offsets,
 * like CodeMirror). Tokens that leave their line are dropped, not guessed.
 */
export function decodeSemanticTokens(
  data: readonly number[],
  legend: TokenLegend,
  text: string
): TokenSpan[] {
  const starts = [0];
  for (
    let index = text.indexOf('\n');
    index >= 0;
    index = text.indexOf('\n', index + 1)
  )
    starts.push(index + 1);
  const lineEnd = (line: number) =>
    line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
  const spans: TokenSpan[] = [];
  let line = 0,
    character = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const [deltaLine, deltaStart, length, type, modifiers] = data.slice(
      index,
      index + 5
    );
    if (deltaLine) {
      line += deltaLine;
      character = deltaStart;
    } else character += deltaStart;
    if (line >= starts.length) break;
    const from = starts[line] + character,
      to = from + length;
    if (length <= 0 || to > lineEnd(line)) continue;
    const className = tokenClass(legend, type, modifiers);
    if (className) spans.push({ from, to, className });
  }
  return spans;
}

/** The text of a string, MarkupContent or MarkedString list (joined as paragraphs). */
export const markupText = (value: MarkupText | undefined): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(markupText).join('\n\n');
  return typeof value?.value === 'string' ? value.value : '';
};

/** Documentation from the server: Markdown, or plain text from older servers. */
export interface Documentation {
  kind: 'markdown' | 'plaintext';
  value: string;
}

/**
 * Reads a `documentation` or `contents` field: MarkupContent of kind
 * `markdown` is Markdown; strings, plain text and MarkedString lists are
 * plain text. Undefined when there is nothing to show.
 */
export function documentation(
  value: MarkupText | undefined
): Documentation | undefined {
  const markdown =
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.kind === 'markdown';
  const text = markupText(value);
  if (!text.trim()) return undefined;
  return { kind: markdown ? 'markdown' : 'plaintext', value: text };
}

export interface InlayLabel {
  text: string;
  kind: 'type' | 'parameter' | 'other';
  paddingLeft: boolean;
  paddingRight: boolean;
  tooltip: string;
}

/** What one inlay hint shows; label parts are joined. */
export function inlayLabel(hint: InlayHint): InlayLabel | undefined {
  const text =
    typeof hint.label === 'string'
      ? hint.label
      : Array.isArray(hint.label)
        ? hint.label.map((part) => String(part?.value ?? '')).join('')
        : '';
  if (!text.trim()) return undefined;
  return {
    text,
    kind: hint.kind === 1 ? 'type' : hint.kind === 2 ? 'parameter' : 'other',
    paddingLeft: hint.paddingLeft === true,
    paddingRight: hint.paddingRight === true,
    tooltip: markupText(hint.tooltip),
  };
}

/**
 * Splits a signature's label around its active parameter, whose label is
 * either a substring of the signature or a `[start, end)` offset pair.
 */
export function signatureParts(
  signature: SignatureInformation,
  activeParameter: number | undefined
): { before: string; active: string; after: string } {
  const label = signature.label;
  const parameter =
    activeParameter === undefined
      ? undefined
      : signature.parameters?.[activeParameter];
  let range: [number, number] | undefined;
  if (Array.isArray(parameter?.label)) {
    const [start, end] = parameter.label;
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      0 <= start &&
      start <= end &&
      end <= label.length
    )
      range = [start, end];
  } else if (typeof parameter?.label === 'string' && parameter.label) {
    // Search after the opening bracket so `x` doesn't match inside the name.
    const open = Math.max(0, label.indexOf('('));
    const start = label.indexOf(parameter.label, open);
    if (start >= 0) range = [start, start + parameter.label.length];
  }
  if (!range) return { before: label, active: '', after: '' };
  return {
    before: label.slice(0, range[0]),
    active: label.slice(range[0], range[1]),
    after: label.slice(range[1]),
  };
}

/** What the signature-help tooltip shows. */
export interface SignatureView {
  /** 0-based index and count, for the `1/2` counter. */
  index: number;
  count: number;
  parts: { before: string; active: string; after: string };
  /** The active parameter's own documentation. */
  parameter?: Documentation;
  /** The procedure's documentation. */
  documentation?: Documentation;
}

/** The active signature of a reply, or undefined when it has none. */
export function signatureView(help: SignatureHelp): SignatureView | undefined {
  const signatures = help.signatures ?? [];
  if (!signatures.length) return undefined;
  const index = Math.min(
    Math.max(help.activeSignature ?? 0, 0),
    signatures.length - 1
  );
  const signature = signatures[index];
  const active = signature.activeParameter ?? help.activeParameter;
  return {
    index,
    count: signatures.length,
    parts: signatureParts(signature, active),
    parameter:
      active === undefined
        ? undefined
        : documentation(signature.parameters?.[active]?.documentation),
    documentation: documentation(signature.documentation),
  };
}

/** `"main.jai"` + 0-based line → `main.jai:3`, for result lists. */
export const locationLabel = (path: string, line: number) =>
  `${path}:${line + 1}`;
