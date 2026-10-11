# Jai editor language features

## What it is

The Jai workspace's editor talks to the compiler's language server (linked into
`jai_wasm.wasm`, running in its own worker) for more than hover and completion:
inlay hints, semantic highlighting, code actions and macro expansions, read-only
stdlib tabs, `#import`/`#load` links, signature help, references, document
highlights, rename, code lenses, folding and workspace symbol search. The
protocol side is documented in the compiler repository
(`docs/compiler/language-server.md`).

Every feature is **feature-detected** from the `initialize` result. The pinned
release in `releases/jai-web-release.json` predates most of them (it has hover,
completion, definition, document symbols and semantic tokens), and the editor
simply shows less with it. Never assume a provider exists.

## How it works

### Modules

| File | Role |
| --- | --- |
| `src/lib/jai/lsp-features.ts` | Pure logic: `provides`, the semantic-token legend (`tokenLegend`, `tokenClass`, `decodeSemanticTokens`), `inlayLabel`, `signatureParts`/`signatureView`, `documentation` (Markdown vs plain text). Tested directly. |
| `src/lib/jai/lsp-extensions.ts` | CodeMirror side of everything that decorates text: one `ViewPlugin` schedules requests, and `StateField`s hold the results (tokens, inlays, highlights, lenses, the lightbulb, links, folds, the signature tooltip). |
| `src/lib/jai/language-client.ts` | `initialize` capabilities, `resourceFromUri` / `pathFromUri`, `linkTarget` (`#L<line>` fragments), `rangeOffsets`, and `openReadonly`/`closeReadonly` for library previews. |
| `src/lib/jai/completion-items.ts` | Server completion items to CodeMirror options; `completionInfo` picks text, rendered Markdown or a lazy `completionItem/resolve`. |
| `src/lib/jai/doc-comments.ts` | Markdown inside comments for highlighting (`docCommentSegments`); pure, used by the tokenizer and the blog highlighter. |
| `src/lib/jai/language-actions.ts` | Requests that touch the workspace: `positionRequest`, `definitionTarget`, `resolveLocation`, `prepareRename`, `renameSymbol`, `planWorkspaceEdit`, `applyWorkspaceEdit`. |
| `src/lib/jai/lint-fixes.ts` | Pure logic for jailint findings: `lintRule`, `lintMessage`, `diagnosticsAt` (a code action's `context.diagnostics`), `fixesFor`, `combineFixes` (Fix all). Tested directly. |
| `src/lib/jai/nav-history.ts` | Go Back / Go Forward model (`NavHistory`): entries, coalescing, rename/delete remapping. Tested directly; wiring in [Navigation history](code-workspace.md#navigation-history). |
| `src/lib/jai/picker.ts` | The small list used for code actions, references, polymorph instances and symbol search. |
| `src/lib/jai/workspace-ui.ts` | Wires it together: what the current language document is, key bindings, navigation into tabs, applying edits. |
| `src/lib/code-editor.ts` | Theme classes (`cm-sem-*`, `cm-inlay-hint`, `cm-lsp-*`, `jai-picker*`), hover and completion wiring, F2/F12/Cmd-click. |
| `src/lib/code-highlight.ts` | The editor's `HighlightStyle` (including comment Markdown) and DOM rendering of server text: `markdownContent`, `plainHoverContent`, `documentationContent`, `highlighted`. |
| `src/lib/hover-markdown.ts` | Markdown to sanitized-ready HTML (section dividers, overload rows, format rows); pure, unit-tested. |
| `src/lib/platform.ts` | `isApple` and `linkModifier` (Cmd on Apple, Ctrl elsewhere) for every Cmd/Ctrl gesture. |

### Requests and staleness

The plugin asks for the **current language document** (`LanguageHost.document()`:
a workspace `.jai` file, or a library preview), syncs the workspace first, and
drops a reply if the URI, version or text changed meanwhile. Between replies the
previous decorations are mapped through edits. Delays:

| Feature | Trigger | Delay |
| --- | --- | --- |
| Semantic tokens | edit | 350 ms |
| Inlay hints (visible range only) | edit / scroll | 400 / 200 ms |
| Links, folding ranges, code lenses | edit | 700 ms |
| Document highlights | cursor move | 250 ms |
| Lightbulb (`codeAction` at the cursor) | cursor move | 450 ms |
| Signature help | typing a trigger character; re-asked on cursor move while open | 60 / 150 ms |

Everything is fetched immediately when a state is created (a tab switch) and when
the server finishes initializing (`refreshLanguage` effect).

**Prefetch on hover.** When the pointer rests 80 ms on a `.jai` file in the tree
(`intent` in `file-tree.ts`) and the file has no saved editor state yet,
`prefetch` in `workspace-ui.ts` creates its state and fills in semantic tokens and
inlay hints for the whole document (`prefetchDecorations` in `lsp-extensions.ts`).
That state is stored like a visited tab's state, so the click shows the decorations
on its first frame instead of a moment later. The reply is dropped if the file
changed meanwhile, and the plugin still refetches as usual once the file is shown.

**Markdown hovers.** The client lists `markdown` (then `plaintext`) in
`textDocument.hover.contentFormat` (`initialize` in `language-client.ts`).
Servers that support it answer `{ kind: 'markdown' }`; `documentation` in
`lsp-features.ts` sorts a reply into Markdown or plain text, and plain text
(older bundles, plain strings) takes `plainHoverContent` in `code-highlight.ts`,
which still splits `name :: (` overload lines into rows. The Markdown is
rendered by `renderHoverMarkdown` (`marked`; raw HTML is escaped, images and
most links show their text), sanitized with DOMPurify, then coloured in
`markdownContent` (`code-highlight.ts`):

- Fenced blocks tagged `jai` (or untagged) and inline code use the editor's
  highlighter (`highlighted`). A block that is only a string literal is coloured
  as a `print` argument, so a format string's `%` specifiers stand out. Other
  fences (`text`: what `#run` printed) stay plain.
- A `---` break followed by a paragraph that is only emphasis
  (`*expands to*`, `*prints*`) becomes a `.jai-hover__divider`: a rule with the
  label set into it. A break followed by anything else stays a rule.
- A fenced block whose every line is `name :: (...` is an overload set: an
  "N overloads" count and one `.jai-hover__overload` row per line.
- A list whose every item starts with a code span and ` → `
  (`` `%2` → `arg: Type` ``) is a format-string hover: the renderer marks it
  `.jai-hover__format`, each item is a `.jai-hover__format-row`, its leading
  code span is the specifier (`.jai-hover__format-spec`), and an item that
  starts with bold is the hovered one (`data-current`). Any other list (a doc
  comment's parameters) keeps ordinary bullets, and headings render bold.

Only standard Markdown is read, so the same hovers render in VS Code and any
other editor. The server's side is in the compiler's
`docs/compiler/language-server.md`.

### Doc comments

Comments directly above a declaration are its documentation (Markdown, with
`[name]` links); the convention and the server side are in the compiler's
`docs/compiler/doc-comments.md`. The editor shows them in four places:

- **Hover**: the server's Markdown hover already contains the docs.
- **Completion info.** The client asks for `documentationFormat: ['markdown',
  'plaintext']`. `completionInfo` (`completion-items.ts`) shows plain text as
  text and renders Markdown with `documentationContent` (the hover renderer in
  a `.jai-hover` panel). Long lists (over 24 items) come without docs; when the
  server sets `completionProvider.resolveProvider`, the info panel calls
  `completionItem/resolve` for the selected item (`resolvesCompletions` in
  `code-editor.ts`), and a failed resolve shows no panel.
- **Signature help.** The client lists `markdown` in
  `signatureHelp.signatureInformation.documentationFormat`. `signatureView`
  picks the active signature and parameter; `signatureTooltip`
  (`lsp-extensions.ts`) shows the label with the active parameter marked, a row
  with that parameter's doc, then the procedure's doc, scrolling past 16rem.
  Since jai-web `728d0d5f` the server attaches docs to unclosed calls too
  (`hail("x", `).
- **Links in the source.** The server reports each resolved `[name]` in a doc
  comment as a `documentLink` targeting `file:///<path>#L<line>` (1-based).
  `linkTarget` (`language-client.ts`) splits off the fragment so Cmd/Ctrl-click
  opens the file at that line; hover and go to definition on a label are
  answered by the server like any name, and the label's semantic token
  (`function`, `type`, `property`, `enumMember`, `namespace`, `readonly`
  variable) colours it on top of the comment colour.
- **Links in popups.** Hover, completion docs (eager and `completionItem/resolve`)
  and signature help send resolved doc links as Markdown links to the same
  `file:///<path>#L<line>` target. `renderHoverMarkdown` turns only `file:///`
  links into `<a class="jai-hover__link" data-doc-link="…">` with no `href`
  (DOMPurify would drop the `file:` scheme; `data-*` survives). Any other link
  is its text, and unresolved `[name]` stays as written. The `popupLinks`
  plugin (`lsp-extensions.ts`) listens on `view.dom`, where CodeMirror mounts
  the tooltips, and sends a click or Enter to `host.openLink`, the same path
  as Cmd/Ctrl-click in the source. `mousedown` is prevented so the editor
  keeps focus while the popup is clicked.

**Comment Markdown highlighting.** Inside `//` and `/* */` comments the
tokenizer (`comment` in `language.ts`) asks `docCommentSegments`
(`doc-comments.ts`) for styled runs and emits them as multi-style tokens
(`comment docStrong`), so each run gets the comment tag plus one of
`docCommentTags`. Markers stay visible; only the styling changes:

| Markdown | Style (`highlightStyle` in `code-highlight.ts`) |
| --- | --- |
| `**bold**` | bold |
| `*italic*`, `_italic_` | brighter comment colour |
| `` `code` `` | upright, faint background |
| `# Heading` (rest of the line) | bold, brighter |
| `-`, `*`, `+`, `1.` list markers | dimmed, upright |
| `[name]`, `[text](target)` label and target | tinted toward the type colour |

The rules are the VS Code extension's injection grammar
(`editors/vscode/syntaxes/jai-doc-comments.tmLanguage.json` in the compiler
repository): the same regular expressions, earliest match first, ties to the
earlier rule, no nesting. Headings and list markers count only on a whole-line
`//` comment or a block comment's continuation line, never after code. Code
fences inside comments are not highlighted as Jai (the grammar's
`meta.comment-run` trick needs multi-line state the stream tokenizer does not
keep).

### Feature notes

- **Semantic tokens.** The legend comes from `semanticTokensProvider.legend` and
  tokens are indexed by *name*, so the append-only legend works with old and new
  servers. Keywords, strings, numbers, operators and plain variables keep the
  tokenizer's colours; the server adds `type`, `function`, `namespace`,
  `typeParameter` (italic), `enumMember` and `readonly` variables (constant
  colour), `property` (struct fields and doc links to them: plain foreground),
  `decorator`/`macro` (directive colour), `formatSpecifier`, and
  `function`+`macro` (an `#expand` call: directive colour, italic).
- **Inlay hints.** Kind 1 (type) widgets sit after the position, kind 2
  (parameter) before it; `paddingLeft`/`paddingRight` become half-character
  margins. They are faint, small and not selectable.
- **Code actions.** `Cmd/Ctrl+.` or the lightbulb at the end of the cursor's line
  lists actions. `edit.changes` (inline `#insert`, replace `#run`, lint fixes)
  goes through `applyEdit` in `workspace-ui.ts`: an edit of only the file on
  screen is dispatched to the editor (one undo step, scroll kept), anything else
  through `applyWorkspaceEdit`. A `jai.showExpansion` command runs through
  `workspace/executeCommand` and opens the returned text in the preview tab.
  Requests send the published diagnostics they touch as `context.diagnostics`.
- **Missing imports.** On a compile error for an unknown name that a module
  declares (`print` without `#import "Basic";`), the server sends one plain
  `quickfix` per module, titled ``Add `#import "Basic";` ``, carrying the
  `jai-check` diagnostic (`source: "jai"`). They need no client code of their
  own: the lightbulb and the `Cmd/Ctrl+.` list show them like any action, and
  applying one inserts the line after the file's imports. They have no lint
  rule, so they get no Fix button and `combineFixes` leaves them out of Fix
  all (choosing a module is not a lint fix).
- **Lints.** See [Lints and quick fixes](#lints-and-quick-fixes) below.
- **Read-only previews.** Definition targets, links and symbols outside
  `file:///jai-script/` map via `resourceFromUri`:
  `file:///stdlib/Basic/module.jai` → `library` `stdlib/Basic/module.jai`;
  `jai-expansion:///jai-script/main.jai?14:4` → `expansion` `main.jai:15:5`.
  Text comes from `jai/source` (or the expansion response). A library preview is
  also `didOpen`ed in the server (and closed when replaced), so it gets semantic
  tokens, links, folding, highlights, hover and definition where the server can
  answer; expansions are only highlighted. One preview tab exists at a time.
- **Links.** `documentLink` ranges are kept per state. With Cmd (macOS) or Ctrl
  held, hovering underlines one and clicking opens its target (a workspace tab or a
  stdlib preview), at the target's line when it has a `#L<line>` fragment (doc
  comment links); Cmd/Ctrl-click elsewhere is still go to definition.
- **Navigation keys.** `F12` definition, `Mod-F12` type definition, `Shift-F12`
  references (a list; picking one opens it), `F2` rename, `Mod-p` workspace symbol
  search. Browsers reserve `Cmd-T`, so it is not used.
- **Go Back / Go Forward.** Every jump above (definition, type definition, a
  reference or symbol, a link, a stdlib or expansion preview, also within one
  file) is recorded in the navigation history; the mouse side buttons,
  `Ctrl+-` / `Ctrl+Shift+-` and (Windows/Linux) `Alt+Left` / `Alt+Right` walk
  it. See [Navigation history](code-workspace.md#navigation-history).
- **Rename.** With `renameProvider.prepareProvider`, `F2` first asks
  `prepareRename`; a `null` says "This name can't be renamed" in the status line.
  The result is an unversioned `changes` map over several files.
  `planWorkspaceEdit` accepts it only because the caller checks the whole
  workspace is unchanged since the request; versioned `documentChanges` are still
  accepted and checked per file.
- **Code lenses.** Block widgets above each polymorphic procedure
  (`2 polymorphs: T = float32; T = s64`); clicking runs `jai.showPolymorphs` and
  lists the bindings.
- **Folding.** A `foldService` reads the server's line ranges; `endLine` is the
  last folded line. `foldGutter({ foldingChanged })` redraws markers when they
  arrive. Without the provider there is no folding, as before.
- **Format-string hover.** See [Jai integration](jai-integration.md#format-string-highlighting).

### Lints and quick fixes

New workspaces start with a root `jailint.toml` (`lintConfigStarter` in
`language-client.ts`, added by `starter.ts`) that turns on the rules jailint
leaves off by default (`float_equality`, `lossy_xx`), so the playground shows
everything it can find. Edit that file to change levels; the server reads it as
an open document.

Servers with jailint publish its findings as ordinary diagnostics with
`source: "jailint"`, the rule as `code` and `codeDescription.href` linking to
that rule's section of the compiler's `docs/tools/jailint.md`. Each fix is a
`quickfix` code action titled in sentence case (`Remove the unused variable`),
with the rule as `data.rule`, the lint in `diagnostics` and `isPreferred` when
it is machine-applicable; one `source.fixAll.jailint` action (`Fix 2 lint
problems`) applies every safe fix in the file. The client advertises
`quickfix`, `refactor`, `refactor.inline`, `source` and `source.fixAll` in
`codeActionLiteralSupport`. See the compiler's
`docs/compiler/language-server.md` (lints and quick fixes).

- **Squiggles and tooltip.** `editor.diagnostics` in `code-editor.ts` renders a
  lint's message as the finding, a `help:` line (the server sends them joined
  by `\n`) with `` `code` `` spans highlighted as Jai, and a
  `jailint(<rule>)` link to the rule's own section (`lintDocs`: the
  diagnostic's `codeDescription.href` when it is `https://`, else the rules
  section, `LINT_DOCS`). `unused_*` rules also get `cm-lint-unused`, which
  fades the range.
- **Kept per file.** `workspace-ui.ts` stores the last publish per URI
  (`published`), so a tab shows its squiggles again when reopened, and code
  action requests (lightbulb, `Cmd/Ctrl+.`, fixes) send the diagnostics they
  touch.
- **Fix buttons.** After each publish, `loadFixes` asks for the `quickfix`
  actions of each lint's range (up to 50 per file) and keeps those `fixesFor`
  its rule. `fixRule` reads the rule from `data.rule`, else from the lint in
  the action's `diagnostics`; titles are only labels (older servers' `<fix>
  (<rule>)` titles still work as a last resort, and `fixLabel` drops that
  suffix). Lints with a fix get a **Fix** button in the tooltip (one per fix
  when there are several), and **Fix all (N)** when two or more lints in the
  file are fixable. Clicking Fix asks again at the lint's current (mapped)
  range, so it never applies an edit computed for older text.
- **Fix all.** When the server advertises `source.fixAll.jailint` in
  `codeActionKinds` (`offersFixAll`), `fixAllLints` asks for that kind over
  the whole file and applies its one edit; the server leaves out fixes that
  overlap an earlier one, as `jailint --fix` does, and the status line says to
  run it again when fewer lints were fixed than were fixable. Older servers
  fall back to `combineFixes`, which merges the file's lint quick fixes (those
  with a rule) the same way on the client. In the `Cmd/Ctrl+.` list the server's action shows as
  "Fix N lint problems"; the client adds its own "Fix all lints in this
  file" only when the server sent none.
- **Settings.** The browser server has no disk, so `LanguageClient.sync`
  sends every workspace file named `jailint.toml` (at the root or in a folder)
  as an open `toml` document, with `didChange`/`didClose` as it is edited,
  renamed or deleted. The server applies the nearest one above each `.jai`
  file and publishes no diagnostics for the settings file itself; one that
  does not parse yet means the defaults. For example:

  ```toml
  [rules]
  unused_parameter = "allow"
  float_equality = "deny"    # an error instead of a warning
  ```

  `jaifmt.toml` and other non-Jai files are never sent.

## How to change it

- **A new decorating feature:** add an effect and field in `lsp-extensions.ts`,
  a method on the plugin using `this.ask(...)`, and schedule it in `update`.
  Gate it with `provides(capabilities, '...Provider')` and add the provider to
  `ServerCapabilities` in `lsp-types.ts`.
- **A new semantic token type:** add it to `typeClasses` in `lsp-features.ts`
  and a `.cm-sem-*` rule in the editor theme. Never index the legend by position.
- **A new command or request needing the workspace:** add it in
  `workspace-ui.ts` (see `codeActions`, `references`, `runCommand`). Use
  `positionRequest` so a request from a changed workspace is rejected.
- **New URI schemes:** extend `resourceFromUri` and its tests.
- Gotcha: `Mod-*` bindings must not collide with Run (`Mod-Enter`) or browser
  shortcuts that cannot be prevented (`Mod-t`, `Mod-w`, `Mod-n`).
- Gotcha: library previews count toward the server's open-document limit (32);
  only one is open at a time.

- **Lint UI:** tooltip markup is `lintContent` in `code-editor.ts`
  (`.jai-lint*` and `.cm-diagnosticAction` theme rules); buttons come from the
  `actions` callback `showDiagnostics` passes. Match fixes by `data.rule` or
  the lint's `code` (`fixRule`), never by title wording.
- **A new hover layout:** key it off standard Markdown structure in
  `renderHoverMarkdown` (pure, testable) or `markdownContent` (DOM), never
  off private text conventions, so editors without this client still render it.
- **Comment Markdown:** change the patterns in `doc-comments.ts` together with
  the compiler repository's injection grammar, add a case to
  `tests/jai/doc-comments.test.ts`, and style a new `DocStyle` in
  `docCommentTags`/`docTokenNames` (`language.ts`), `highlightStyle`
  (`code-highlight.ts`) and `withDoc` (`highlight-jai.ts`, blog code blocks).
- Gotcha: a CodeMirror tooltip with `overflow: hidden` clips the completion
  info panel, which is its child; the autocomplete tooltip is `overflow:
  visible` and its list clips itself.

Tests: `tests/jai/language-features.test.ts` (URI mapping, WorkspaceEdit
planning, location normalization, legend mapping and token decoding, inlay
labels, signature splitting and docs, `#L` link targets, capability checks),
`tests/jai/hover-markdown.test.ts` (Markdown detection, section dividers,
overload rows, format rows versus doc lists, escaping),
`tests/jai/completion-items.test.ts` (info text, rendered Markdown, lazy
resolve), `tests/jai/doc-comments.test.ts` (comment Markdown segments, the
tokenizer's tags, blog span styles) and `tests/jai/lint-fixes.test.ts`
(rule detection, message split, range matching, fix selection by `data.rule`
or lint, the fix-all action and per-rule links, `jailint.toml` syncing, Fix
all merging; with `JAI_WASM_DIR` set, a real lint, its fix and the server's
fix-all, a `jailint.toml` changing levels, and that the starter and the tour
have no lints under the default rules).

To try a compiler that has these features before the pin moves, build it with
`python3 tools/build_scripting_wasm.py --release --output <dir>` in the compiler
repository and stage it with `JAI_WEB_LOCAL=<dir> node scripts/sync-jai-web.ts`
(see [Jai integration](jai-integration.md#configuration)).

## Configuration

No flags. The debounce delays are constants in `lsp-extensions.ts`; colours use
the `--ide-*` tokens from `CodeWorkspace.astro`.

## Dependencies

- `marked` and `dompurify` (Markdown hovers).
- `@codemirror/view` (decorations, widgets, tooltips, keymaps),
  `@codemirror/state`, `@codemirror/language` (`foldService`).
- The compiler's language server via the worker (`engine.lsp`), including the
  non-standard `jai/source` and `jai/expansion` requests.
