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
release in `jai-web-release.json` predates most of them (it has hover,
completion, definition, document symbols and semantic tokens), and the editor
simply shows less with it. Never assume a provider exists.

## How it works

### Modules

| File | Role |
| --- | --- |
| `src/lib/jai/lsp-features.ts` | Pure logic: `provides`, the semantic-token legend (`tokenLegend`, `tokenClass`, `decodeSemanticTokens`), `inlayLabel`, `signatureParts`. Tested directly. |
| `src/lib/jai/lsp-extensions.ts` | CodeMirror side of everything that decorates text: one `ViewPlugin` schedules requests, and `StateField`s hold the results (tokens, inlays, highlights, lenses, the lightbulb, links, folds, the signature tooltip). |
| `src/lib/jai/language-client.ts` | `resourceFromUri` / `pathFromUri`, and `openReadonly`/`closeReadonly` for library previews. |
| `src/lib/jai/language-actions.ts` | Requests that touch the workspace: `positionRequest`, `definitionTarget`, `resolveLocation`, `prepareRename`, `renameSymbol`, `planWorkspaceEdit`, `applyWorkspaceEdit`. |
| `src/lib/jai/picker.ts` | The small list used for code actions, references, polymorph instances and symbol search. |
| `src/lib/jai/workspace-ui.ts` | Wires it together: what the current language document is, key bindings, navigation into tabs, applying edits. |
| `src/lib/code-editor.ts` | Theme classes (`cm-sem-*`, `cm-inlay-hint`, `cm-lsp-*`, `jai-picker*`), hover rendering, F2/F12/Cmd-click. |

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

**Hover dividers.** A hover line `─── label ───` from the server (a macro's
expansion, `#run` output) is drawn as a rule with the label set into it
(`dividedHover` in `code-editor.ts`); the sections around it render as ordinary
hovers.

### Feature notes

- **Semantic tokens.** The legend comes from `semanticTokensProvider.legend` and
  tokens are indexed by *name*, so the append-only legend works with old and new
  servers. Keywords, strings, numbers, operators and plain variables keep the
  tokenizer's colours; the server adds `type`, `function`, `namespace`,
  `typeParameter` (italic), `enumMember` and `readonly` variables (constant
  colour), `decorator`/`macro` (directive colour), `formatSpecifier`, and
  `function`+`macro` (an `#expand` call: directive colour, italic).
- **Inlay hints.** Kind 1 (type) widgets sit after the position, kind 2
  (parameter) before it; `paddingLeft`/`paddingRight` become half-character
  margins. They are faint, small and not selectable.
- **Code actions.** `Cmd/Ctrl+.` or the lightbulb at the end of the cursor's line
  lists actions. `edit.changes` (inline `#insert`, replace `#run`) goes through
  `applyWorkspaceEdit`; a `jai.showExpansion` command runs through
  `workspace/executeCommand` and opens the returned text in the preview tab.
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
  stdlib preview); Cmd/Ctrl-click elsewhere is still go to definition.
- **Navigation keys.** `F12` definition, `Mod-F12` type definition, `Shift-F12`
  references (a list; picking one opens it), `F2` rename, `Mod-p` workspace symbol
  search. Browsers reserve `Cmd-T`, so it is not used.
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

Tests: `tests/jai/language-features.test.ts` (URI mapping, WorkspaceEdit
planning, location normalization, legend mapping and token decoding, inlay
labels, signature splitting, capability checks).

To try a compiler that has these features before the pin moves, build it with
`python3 tools/build_scripting_wasm.py --release --output <dir>` in the compiler
repository and stage it with `JAI_WEB_LOCAL=<dir> node scripts/sync-jai-web.ts`
(see [Jai integration](jai-integration.md#configuration)).

## Configuration

No flags. The debounce delays are constants in `lsp-extensions.ts`; colours use
the `--ide-*` tokens from `CodeWorkspace.astro`.

## Dependencies

- `@codemirror/view` (decorations, widgets, tooltips, keymaps),
  `@codemirror/state`, `@codemirror/language` (`foldService`).
- The compiler's language server via the worker (`engine.lsp`), including the
  non-standard `jai/source` and `jai/expansion` requests.
