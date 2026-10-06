/*
 * CodeMirror side of the language server features that decorate the text:
 * semantic tokens, inlay hints, document highlights, document links, code
 * lenses, folding ranges, the code-action lightbulb and signature help.
 *
 * Every feature is gated on the capability the server advertised in
 * `initialize`, so an older compiler bundle simply shows less. Results are
 * requested for the document's current version and dropped if it changed
 * meanwhile; between requests the last results are mapped through edits.
 */
import {
  StateEffect,
  StateField,
  RangeSetBuilder,
  type EditorState,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import { foldService } from '@codemirror/language';
import {
  positionAt,
  offsetAt,
  type LanguageClient,
} from './language-client.ts';
import {
  decodeSemanticTokens,
  inlayLabel,
  provides,
  signatureParts,
  tokenLegend,
  type TokenLegend,
} from './lsp-features.ts';
import type {
  CodeAction,
  CodeLens,
  DocumentHighlight,
  DocumentLink,
  FoldingRange,
  InlayHint,
  ServerCapabilities,
  SignatureHelp,
} from './lsp-types.ts';

/** The language document an editor state shows. */
export interface LanguageDocument {
  uri: string;
  version: number;
  /** Stdlib/module previews: no hints, lenses, actions or signature help. */
  readonly?: boolean;
}

export interface LanguageHost {
  /** The document in the view, or undefined when it isn't a language document. */
  document(): LanguageDocument | undefined;
  /** The synced client, or undefined while there is none. */
  client(): LanguageClient | undefined;
  capabilities(): ServerCapabilities | undefined;
  /** Follows a document link target (`file:///jai-script/...` or `file:///stdlib/...`). */
  openLink(target: string): void;
  /** A code lens was clicked. */
  runLens(view: EditorView, lens: CodeLens, pos: number): void;
  /** The lightbulb was clicked. */
  codeActions(view: EditorView, pos: number): void;
  /** Mac uses Cmd for link clicks, others Ctrl. */
  modifier(event: MouseEvent | KeyboardEvent): boolean;
}

/** Dispatch with this effect after the server (re)initializes to fetch everything. */
export const refreshLanguage = StateEffect.define<null>();

const setTokens = StateEffect.define<DecorationSet>();
const setInlays = StateEffect.define<DecorationSet>();
const setHighlights = StateEffect.define<DecorationSet>();
const setLenses = StateEffect.define<DecorationSet>();
const setBulb = StateEffect.define<DecorationSet>();
const setLinks = StateEffect.define<LinkRange[]>();
const setHoveredLink = StateEffect.define<LinkRange | null>();
const setFolds = StateEffect.define<FoldingRange[]>();
const setSignature = StateEffect.define<Tooltip | null>();

interface LinkRange {
  from: number;
  to: number;
  target: string;
}

function decorationField(effect: typeof setTokens) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) return e.value;
      return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
const tokenField = decorationField(setTokens);
const inlayField = decorationField(setInlays);
const highlightField = decorationField(setHighlights);
const lensField = decorationField(setLenses);
const bulbField = decorationField(setBulb);

const mapLinks = (links: LinkRange[], tr: Transaction) =>
  links
    .map((link) => ({
      ...link,
      from: tr.changes.mapPos(link.from, 1),
      to: tr.changes.mapPos(link.to, -1),
    }))
    .filter((link) => link.to > link.from);
const linkField = StateField.define<LinkRange[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinks)) return e.value;
    return tr.docChanged ? mapLinks(value, tr) : value;
  },
});
const hoveredLinkField = StateField.define<LinkRange | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHoveredLink)) return e.value;
    return tr.docChanged ? null : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (link) =>
      link
        ? Decoration.set(
            Decoration.mark({ class: 'cm-lsp-link' }).range(link.from, link.to)
          )
        : Decoration.none
    ),
});
const foldField = StateField.define<FoldingRange[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFolds)) return e.value;
    return value;
  },
});
const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSignature)) return e.value;
    if (!value || !tr.docChanged) return value;
    return { ...value, pos: tr.changes.mapPos(value.pos) };
  },
  provide: (field) => showTooltip.from(field),
});

/** For `foldGutter({ foldingChanged })`: redraw markers when server ranges arrive. */
export const foldingChanged = (update: ViewUpdate) =>
  update.transactions.some((tr) => tr.effects.some((e) => e.is(setFolds)));

/** The document link at `pos`, if any. */
export const linkAt = (state: EditorState, pos: number) =>
  state
    .field(linkField, false)
    ?.find((link) => pos >= link.from && pos <= link.to);

/*
 * Server folding ranges are line based; `endLine` is the last line inside the
 * fold (the line before a closing brace), so the fold ends at its end.
 */
const serverFolds = foldService.of((state, lineStart) => {
  const ranges = state.field(foldField, false);
  if (!ranges?.length) return null;
  const line = state.doc.lineAt(lineStart);
  const range = ranges.find(
    (item) =>
      item.startLine === line.number - 1 && item.endLine > item.startLine
  );
  if (!range || range.endLine + 1 > state.doc.lines) return null;
  const end = state.doc.line(range.endLine + 1);
  return end.to > line.to ? { from: line.to, to: end.to } : null;
});

class InlayWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: string,
    readonly left: boolean,
    readonly right: boolean,
    readonly tooltip: string
  ) {
    super();
  }
  eq(other: InlayWidget) {
    return (
      other.text === this.text &&
      other.kind === this.kind &&
      other.left === this.left &&
      other.right === this.right &&
      other.tooltip === this.tooltip
    );
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-inlay-hint cm-inlay-hint--${this.kind}`;
    if (this.left) span.dataset.padLeft = '';
    if (this.right) span.dataset.padRight = '';
    span.textContent = this.text;
    if (this.tooltip) span.title = this.tooltip;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class LensWidget extends WidgetType {
  constructor(
    readonly lens: CodeLens,
    readonly indent: number,
    readonly run: (lens: CodeLens) => void
  ) {
    super();
  }
  eq(other: LensWidget) {
    return (
      other.indent === this.indent &&
      other.lens.command?.title === this.lens.command?.title &&
      other.lens.range.start.line === this.lens.range.start.line
    );
  }
  toDOM() {
    const row = document.createElement('div');
    row.className = 'cm-lsp-lens';
    row.style.paddingLeft = `${this.indent}ch`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-lsp-lens__button';
    button.textContent = this.lens.command?.title ?? '';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => this.run(this.lens));
    row.append(button);
    return row;
  }
  ignoreEvent() {
    return true;
  }
}

class BulbWidget extends WidgetType {
  constructor(readonly run: () => void) {
    super();
  }
  eq() {
    return true;
  }
  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-lsp-bulb';
    const mac = /Mac|iPhone|iPad/u.test(navigator.platform);
    button.title = `Show code actions (${mac ? '⌘' : 'Ctrl+'}.)`;
    button.setAttribute('aria-label', 'Show code actions');
    button.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75a4.25 4.25 0 0 0-2.5 7.69V11h5V9.44A4.25 4.25 0 0 0 8 1.75ZM6 12.75h4M6.75 14.5h2.5"/></svg>';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', this.run);
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

function signatureTooltip(help: SignatureHelp, pos: number): Tooltip | null {
  const signatures = help.signatures ?? [];
  if (!signatures.length) return null;
  const index = Math.min(
    Math.max(help.activeSignature ?? 0, 0),
    signatures.length - 1
  );
  const signature = signatures[index];
  const parts = signatureParts(
    signature,
    signature.activeParameter ?? help.activeParameter
  );
  return {
    pos,
    above: true,
    strictSide: false,
    arrow: false,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-lsp-signature';
      if (signatures.length > 1) {
        const count = document.createElement('span');
        count.className = 'cm-lsp-signature__count';
        count.textContent = `${index + 1}/${signatures.length}`;
        dom.append(count);
      }
      const active = document.createElement('span');
      active.className = 'cm-lsp-signature__active';
      active.textContent = parts.active;
      dom.append(parts.before, active, parts.after);
      return { dom };
    },
  };
}

const wordChar = /[_\p{L}\p{N}]/u;

/** All the decorating features, for one editor. */
/** Semantic tokens as decorations. */
function tokenEffect(
  result: { data?: number[] } | null,
  legend: TokenLegend,
  text: string
) {
  const builder = new RangeSetBuilder<Decoration>();
  const data = Array.isArray(result?.data) ? result.data : [];
  for (const span of decodeSemanticTokens(data, legend, text))
    builder.add(span.from, span.to, Decoration.mark({ class: span.className }));
  return setTokens.of(builder.finish());
}

/** Inlay hints as widget decorations. */
function inlayEffect(hints: InlayHint[] | null, text: string) {
  const widgets: { pos: number; side: number; widget: InlayWidget }[] = [];
  for (const hint of hints ?? []) {
    const label = inlayLabel(hint);
    if (!label) continue;
    let pos: number;
    try {
      pos = offsetAt(text, hint.position);
    } catch {
      continue;
    }
    widgets.push({
      pos,
      // Parameter names sit before the argument, types after the name.
      side: label.kind === 'parameter' ? -1 : 1,
      widget: new InlayWidget(
        label.text,
        label.kind,
        label.paddingLeft,
        label.paddingRight,
        label.tooltip
      ),
    });
  }
  widgets.sort((a, b) => a.pos - b.pos || a.side - b.side);
  return setInlays.of(
    Decoration.set(
      widgets.map(({ pos, side, widget }) =>
        Decoration.widget({ widget, side }).range(pos)
      ),
      true
    )
  );
}

/**
 * Semantic tokens and inlay hints for a document that is not shown yet (a
 * file hovered in the tree), applied to `state` so opening it shows them at
 * once. The view plugin refreshes them as usual when the file is shown.
 */
export async function prefetchDecorations(
  state: EditorState,
  client: LanguageClient,
  capabilities: ServerCapabilities | undefined,
  uri: string,
  signal?: AbortSignal
): Promise<EditorState> {
  const text = state.doc.toString();
  const effects: StateEffect<DecorationSet>[] = [];
  const legend = capabilities?.semanticTokensProvider?.full
    ? tokenLegend(capabilities.semanticTokensProvider.legend)
    : undefined;
  const [tokens, inlays] = await Promise.all([
    legend
      ? client.request<{ data?: number[] } | null>(
          'textDocument/semanticTokens/full',
          { textDocument: { uri } },
          signal
        )
      : undefined,
    provides(capabilities, 'inlayHintProvider')
      ? client.request<InlayHint[] | null>(
          'textDocument/inlayHint',
          {
            textDocument: { uri },
            range: {
              start: positionAt(text, 0),
              end: positionAt(text, text.length),
            },
          },
          signal
        )
      : undefined,
  ]);
  if (legend && tokens !== undefined)
    effects.push(tokenEffect(tokens, legend, text));
  if (inlays !== undefined) effects.push(inlayEffect(inlays, text));
  return state.update({ effects }).state;
}

export function languageFeatures(host: LanguageHost): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timers = new Map<string, ReturnType<typeof setTimeout>>();
      requests = new Map<string, AbortController>();
      legend: TokenLegend | undefined;
      constructor(readonly view: EditorView) {
        this.all(0);
      }
      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshLanguage))
        );
        if (refreshed) {
          this.legend = undefined;
          this.all(0);
          return;
        }
        if (update.docChanged) {
          this.schedule('tokens', 350, () => this.tokens());
          this.schedule('inlays', 400, () => this.inlays());
          this.schedule('outline', 700, () => this.outline());
        } else if (update.viewportChanged)
          this.schedule('inlays', 200, () => this.inlays());
        if (update.selectionSet || update.docChanged) {
          this.schedule('highlights', 250, () => this.highlights());
          this.schedule('bulb', 450, () => this.bulb());
          if (update.state.field(signatureField))
            this.schedule('signature', 150, () => this.signature(false));
        }
        for (const tr of update.transactions)
          if (tr.isUserEvent('input.type')) {
            const triggers =
              host.capabilities()?.signatureHelpProvider?.triggerCharacters ??
              [];
            let typed = '';
            tr.changes.iterChanges((_a, _b, _c, _d, text) => {
              typed = text.toString();
            });
            if (typed && triggers.includes(typed.slice(-1)))
              this.schedule('signature', 60, () => this.signature(true));
          }
      }
      destroy() {
        for (const timer of this.timers.values()) clearTimeout(timer);
        for (const request of this.requests.values()) request.abort();
      }
      all(delay: number) {
        this.schedule('tokens', delay, () => this.tokens());
        this.schedule('inlays', delay, () => this.inlays());
        this.schedule('outline', delay, () => this.outline());
        this.schedule('highlights', delay, () => this.highlights());
      }
      schedule(name: string, delay: number, run: () => Promise<void>) {
        clearTimeout(this.timers.get(name));
        this.timers.set(
          name,
          setTimeout(() => {
            this.requests.get(name)?.abort();
            void run().catch(() => {
              /* Stale, cancelled or unsupported: keep what is shown. */
            });
          }, delay)
        );
      }
      /** Runs `request` for the current document; undefined if it changed meanwhile. */
      async ask<T>(
        name: string,
        method: string,
        params: (uri: string, text: string) => object,
        options: { readonly?: boolean } = {}
      ): Promise<{ result: T; text: string } | undefined> {
        const document = host.document();
        const client = host.client();
        if (!document || !client) return undefined;
        if (document.readonly && !options.readonly) return undefined;
        const text = this.view.state.doc.toString();
        const controller = new AbortController();
        this.requests.set(name, controller);
        const result = await client.request<T>(
          method,
          params(document.uri, text),
          controller.signal
        );
        const now = host.document();
        if (
          controller.signal.aborted ||
          now?.uri !== document.uri ||
          now.version !== document.version ||
          this.view.state.doc.toString() !== text
        )
          return undefined;
        return { result, text };
      }
      dispatch(effect: StateEffect<unknown>) {
        this.view.dispatch({ effects: effect });
      }
      async tokens() {
        const capabilities = host.capabilities();
        const provider = capabilities?.semanticTokensProvider;
        if (!provider?.full) return;
        this.legend ??= tokenLegend(provider.legend);
        const legend = this.legend;
        if (!legend) return;
        const reply = await this.ask<{ data?: number[] } | null>(
          'tokens',
          'textDocument/semanticTokens/full',
          (uri) => ({ textDocument: { uri } }),
          { readonly: true }
        );
        if (!reply) return;
        this.dispatch(tokenEffect(reply.result, legend, reply.text));
      }
      async inlays() {
        if (!provides(host.capabilities(), 'inlayHintProvider')) return;
        const { from, to } = this.view.viewport;
        const reply = await this.ask<InlayHint[] | null>(
          'inlays',
          'textDocument/inlayHint',
          (uri, text) => ({
            textDocument: { uri },
            range: { start: positionAt(text, from), end: positionAt(text, to) },
          })
        );
        if (!reply) return;
        this.dispatch(inlayEffect(reply.result, reply.text));
      }
      async highlights() {
        if (!provides(host.capabilities(), 'documentHighlightProvider')) return;
        const { state } = this.view;
        const selection = state.selection.main;
        const head = selection.head;
        const near =
          wordChar.test(state.sliceDoc(head, head + 1)) ||
          wordChar.test(state.sliceDoc(head - 1, head));
        if (!selection.empty || !near) {
          if (state.field(highlightField).size)
            this.dispatch(setHighlights.of(Decoration.none));
          return;
        }
        const reply = await this.ask<DocumentHighlight[] | null>(
          'highlights',
          'textDocument/documentHighlight',
          (uri, text) => ({
            textDocument: { uri },
            position: positionAt(text, head),
          }),
          { readonly: true }
        );
        if (!reply) return;
        const marks = [];
        for (const item of reply.result ?? []) {
          try {
            const from = offsetAt(reply.text, item.range.start),
              to = offsetAt(reply.text, item.range.end);
            if (to > from)
              marks.push(
                Decoration.mark({
                  class:
                    item.kind === 3
                      ? 'cm-lsp-highlight cm-lsp-highlight--write'
                      : 'cm-lsp-highlight',
                }).range(from, to)
              );
          } catch {
            /* Out-of-range highlights are skipped. */
          }
        }
        // A lone occurrence is just the name under the cursor.
        this.dispatch(
          setHighlights.of(
            marks.length > 1 ? Decoration.set(marks, true) : Decoration.none
          )
        );
      }
      /** Links, folding ranges and code lenses: things that change with structure. */
      async outline() {
        const capabilities = host.capabilities();
        await Promise.all([
          provides(capabilities, 'documentLinkProvider') && this.links(),
          provides(capabilities, 'foldingRangeProvider') && this.folds(),
          provides(capabilities, 'codeLensProvider') && this.lenses(),
        ]);
      }
      async links() {
        const reply = await this.ask<DocumentLink[] | null>(
          'links',
          'textDocument/documentLink',
          (uri) => ({ textDocument: { uri } }),
          { readonly: true }
        );
        if (!reply) return;
        const links: LinkRange[] = [];
        for (const link of reply.result ?? []) {
          if (typeof link.target !== 'string') continue;
          try {
            const from = offsetAt(reply.text, link.range.start),
              to = offsetAt(reply.text, link.range.end);
            if (to > from) links.push({ from, to, target: link.target });
          } catch {
            /* Skipped. */
          }
        }
        this.dispatch(setLinks.of(links));
      }
      async folds() {
        const reply = await this.ask<FoldingRange[] | null>(
          'folds',
          'textDocument/foldingRange',
          (uri) => ({ textDocument: { uri } }),
          { readonly: true }
        );
        if (!reply) return;
        this.dispatch(
          setFolds.of(
            (reply.result ?? []).filter(
              (range) =>
                Number.isInteger(range.startLine) &&
                Number.isInteger(range.endLine)
            )
          )
        );
      }
      async lenses() {
        const reply = await this.ask<CodeLens[] | null>(
          'lenses',
          'textDocument/codeLens',
          (uri) => ({ textDocument: { uri } })
        );
        if (!reply) return;
        const { doc } = this.view.state;
        const widgets = [];
        for (const lens of reply.result ?? []) {
          if (!lens.command?.title || lens.range.start.line >= doc.lines)
            continue;
          const line = doc.line(lens.range.start.line + 1);
          const indent = /^[ \t]*/u
            .exec(line.text)![0]
            .replace(/\t/gu, '    ').length;
          widgets.push(
            Decoration.widget({
              widget: new LensWidget(lens, indent, (clicked) =>
                host.runLens(this.view, clicked, line.from)
              ),
              block: true,
              side: -1,
            }).range(line.from)
          );
        }
        this.dispatch(setLenses.of(Decoration.set(widgets, true)));
      }
      async bulb() {
        if (!provides(host.capabilities(), 'codeActionProvider')) return;
        const { state } = this.view;
        const selection = state.selection.main;
        const reply = await this.ask<CodeAction[] | null>(
          'bulb',
          'textDocument/codeAction',
          (uri, text) => ({
            textDocument: { uri },
            range: {
              start: positionAt(text, selection.from),
              end: positionAt(text, selection.to),
            },
            context: { diagnostics: [] },
          })
        );
        if (!reply) return;
        if (!reply.result?.length || !this.view.hasFocus) {
          if (this.view.state.field(bulbField).size)
            this.dispatch(setBulb.of(Decoration.none));
          return;
        }
        const head = this.view.state.selection.main.head;
        const line = this.view.state.doc.lineAt(head);
        this.dispatch(
          setBulb.of(
            Decoration.set(
              Decoration.widget({
                widget: new BulbWidget(() =>
                  host.codeActions(
                    this.view,
                    this.view.state.selection.main.head
                  )
                ),
                side: 2,
              }).range(line.to)
            )
          )
        );
      }
      async signature(triggered: boolean) {
        const provider = host.capabilities()?.signatureHelpProvider;
        if (!provider) return;
        const head = this.view.state.selection.main.head;
        const reply = await this.ask<SignatureHelp | null>(
          'signature',
          'textDocument/signatureHelp',
          (uri, text) => ({
            textDocument: { uri },
            position: positionAt(text, head),
            context: {
              triggerKind: triggered ? 2 : 3,
              isRetrigger: !triggered,
            },
          })
        );
        if (!reply) return;
        this.dispatch(
          setSignature.of(
            reply.result ? signatureTooltip(reply.result, head) : null
          )
        );
      }
    }
  );

  const links = EditorView.domEventHandlers({
    mousemove(event, view) {
      const link = host.modifier(event)
        ? linkAt(
            view.state,
            view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
          )
        : undefined;
      const current = view.state.field(hoveredLinkField);
      if ((link ?? null) !== current)
        view.dispatch({ effects: setHoveredLink.of(link ?? null) });
      return false;
    },
    mouseleave(_event, view) {
      if (view.state.field(hoveredLinkField))
        view.dispatch({ effects: setHoveredLink.of(null) });
      return false;
    },
    keyup(event, view) {
      if (!host.modifier(event) && view.state.field(hoveredLinkField))
        view.dispatch({ effects: setHoveredLink.of(null) });
      return false;
    },
    mousedown(event, view) {
      if (event.button !== 0 || !host.modifier(event)) return false;
      const link = linkAt(
        view.state,
        view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
      );
      if (!link) return false;
      event.preventDefault();
      host.openLink(link.target);
      return true;
    },
  });

  const signatureKeys = keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        if (!view.state.field(signatureField)) return false;
        view.dispatch({ effects: setSignature.of(null) });
        return true;
      },
    },
  ]);
  const closeSignatureOnBlur = EditorView.focusChangeEffect.of(
    (state, focus) =>
      !focus && state.field(signatureField) ? setSignature.of(null) : null
  );

  return [
    tokenField,
    inlayField,
    highlightField,
    lensField,
    bulbField,
    linkField,
    hoveredLinkField,
    foldField,
    signatureField,
    serverFolds,
    plugin,
    links,
    signatureKeys,
    closeSignatureOnBlur,
  ];
}
