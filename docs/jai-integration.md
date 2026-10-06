# Jai browser compiler

## What it is

jai is a Rust compiler for Jai, Jonathan Blow's systems language, with an interactive
browser workspace. The portfolio presents its project card and opens the workspace
from it in the shared code editor modal.

## How it works

The portfolio's `jai-web.yml` workflow builds one full, immutable compiler commit.
The portfolio owns the entire interface: `CodeWorkspace.astro` renders the shared
header, file tree, CodeMirror editor and output pane described in
[Shared code workspace](code-workspace.md). There is no embedded release page,
editor footer, or Website action.
`src/lib/code-editor.ts` and `src/lib/jai/` contain the shared editor, Jai tokenizer, workspace, language
client, worker and Wasm bridge. The release files used at runtime are
`/jai/<full-commit>/jai_wasm.wasm` and, for the Format button,
`/jai/<full-commit>/jaifmt-playground.jai` (see [Jai formatter](jai-formatter.md); releases
without it simply hide the button).

Opening the modal initializes separate execution and language-service workers.
The language client preserves completion, hover and inline diagnostics without Hover text is syntax-highlighted with the editor's own grammar (`highlightedHover` in `src/lib/code-editor.ts`), using the same colors as the source.
adding a diagnostics panel. File switches retain editor state. Closing aborts
initialization, terminates both workers and destroys CodeMirror; reopening starts
fresh. Astro navigation also disposes the session. Run uses a fixed
200-million-block budget, so a runaway program fails with a runtime error instead of
hanging; Stop also terminates the execution worker. The `jai_play_*` bridge returns
program stdout/stderr in write order, rendered diagnostics, and `main`'s exit code;
the output pane shows writes (stderr tinted), then diagnostics or `Exit code: N`.
The session opens with the compiler's language tour and runs it once when ready.
`loadStarter` (`src/lib/jai/starter.ts`) fetches `/jai/<full-commit>/tour.json`
(`{ schema_version: 1, main: "main.jai", files: [...] }`), then every listed file from
`/jai/<full-commit>/tour/`, and adds the default `jaifmt.toml`. The tour is a
multi-folder workspace (`basics/`, `types/`, `data/`, `memory/`, `generics/`, `meta/`,
`finale/`, about 14 files) written and tested in the compiler repo (`examples/tour`,
its `docs/browser/tour.md`). `main.jai` and `tour.md` open in tabs, `main.jai` active;
a `/playground/jai#meta/macros.jai` link opens and activates that file as well.
The index is validated (schema, `main.jai`, at most 64 plain relative paths, 1 MiB
in total). A release without `tour.json` (every release before the tour shipped),
or any fetch or validation failure, falls back to the built-in two-file starter
(`main.jai` loading `lib/math.jai`); only an abort propagates. Tests:
`tests/jai/starter.test.ts`.

### Producer contract

- Release repository: `matteopolak/portfolio`; tag: `jai-web-<full-40-character-sha>`.
- Assets: `jai-playground.zip` and `jai-playground.manifest.json`.
- Manifest: `schema_version: 1`, `commit` (full SHA), `dirty_checkout: false`,
  `entrypoint: "index.html"`, and `files` containing every archive member as
  `{ "path": "worker.mjs", "size": 123, "sha256": "<64 hex characters>" }`.
- Archive contains only regular files with normalized relative POSIX paths. No
  symlinks, duplicate names, absolute paths, traversal, `reference/`, native executables,
  or build receipts containing host paths. The manifest is a separate release asset.
- Include `index.html`, all JS/CSS dependencies, `worker.mjs`, `jai_wasm.wasm`, and
  independently authored prelude/modules needed by the compiler. Runtime module
  paths are relative to the entrypoint, with no third-party CDN dependencies.
- The producer's `tools/package_browser_release.py --output <directory> --jaic <native jaic>`
  builds a release Wasm module and `jaifmt.wasm` and produces the two assets above. CI
  supplies fetched, locked Cargo dependencies, a `wasm32-unknown-unknown` target, LLVM 23
  with lld (installed by the compiler repo's `tools/install_ci_llvm_linux.sh`, which also
  provides `wasm-ld`) and a debug `jaic-cli` built from the same checkout.
- Schema 2 bundles that ship `jaifmt.wasm` record its SHA-256 as `jaifmt_wasm_sha256` in
  `build-metadata.json`; `verify-jai-bundle.py` refuses the bundle if either is missing
  without the other or the digest or Wasm header does not match.
- In embedded mode (`?embed=1`), the editor reports
  `{ type: "jai-playground", state: "ready" | "error", revision: "<full sha>", message?: "..." }`
  through `parent.postMessage(payload, location.origin)`. `ready` means the editor
  and compiler worker have initialized. The host validates origin, frame identity,
  and revision before dismissing the loading surface. Standalone mode also works.

The producer should render a real nested file tree, keep editable sources separate
from read-only independent library modules, retain edits across file switches, and
support Run, Cancel, output and diagnostics. Diagnostics and filenames must render
as text.

## How to change it

The project description is `src/content/projects/jai.md`; it does not change the
resume's selected projects in `portfolio.toml`. Edit `CodeWorkspace.astro` and `CodeOutput.astro` for the
shared layout and styling, `src/lib/jai/workspace-ui.ts` for file selection and execution,
`code-editor.ts` and `jai/language.ts` for CodeMirror behavior, and `engine.ts`/`worker.ts`
for the Wasm ABI bridge. These are owned source modules built by Astro, not files
loaded from the compiler package. Do not import its HTML, editor bundle, CSS or
worker to alter the portfolio interface.

`jai-playground.ts` lazily imports the session, controls readiness and retry, and
cancels stale sessions. Keep its close/reopen and Astro navigation cleanup when
changing the editor. Compiler publication remains an exact-ref workflow; validate
ABI changes against the owned bridge before updating the pointer.

### Language features

Inlay hints, semantic tokens, code actions and expansions, read-only stdlib
tabs, links, signature help, references, rename, code lenses, folding and
symbol search are described in [Jai editor language features](jai-language-features.md).
Each one is enabled only when the server advertises it, so the pinned release
keeps working with fewer features.

### Format-string highlighting

The Jai tokenizer (`jai/language.ts`) colours `%` sequences inside the format string of print-family calls, and the editor explains them on hover. Only the real format argument is treated this way: `"50%"` in an ordinary string, or as a later argument, stays a plain string.

**Which strings.** `formatCallees` in `jai/format-string.ts` maps each procedure to the index of its format argument: `print`, `tprint`, `sprint`, `log`, `log_error`, `log_warning` (0), `print_to_builder` and `assert` (1). The tokenizer is a `StreamLanguage`, so it tracks calls in its state:

1. An identifier in `formatCallees` sets `state.callee` (comments and whitespace may follow it).
2. The next `(` pushes `{ depth, argument }` onto `state.calls`; any other token clears `callee`, so `print :: (...)` and `p := print;` are not calls.
3. A `,` at the call's own depth counts down `argument`; nested calls push their own entry.
4. A `"` opening at the call's depth while `argument` is 0 starts a format string (`state.format`). Only that first string counts.
5. Closing brackets pop calls at deeper depths, so an unbalanced call cannot leak into later code.

Inside a format string, `%`, `%0`, `%N` and `%00` are `formatSpecifier` tokens and `\%` is a `formatPercent` token. They map to `formatSpecifierTag` and `formatPercentTag` (both children of `tags.string`, so other highlight styles still colour them as strings). Here-strings (`#string`) and a `log(section, "…")` call with the section first are not detected.

**Semantics.** These follow the compiler's `Basic` print (`__format_to_builder` in the compiler repo's `stdlib/Basic/Print.jai`), not older Jai:

| Source | Meaning |
| --- | --- |
| `%` or `%0` | the next argument |
| `%N` | argument N (1-based); a following `%` continues with N+1 |
| `%%` | two specifiers, so two arguments (not a literal percent) |
| `%00` | prints nothing |
| `\%` | a literal `%` (the lexer turns it into byte 31) |

**Hover.** Format-string text itself is emitted as a `formatString` token (same `tags.string` colour), so the whole literal, quotes included, is findable in the syntax tree. `formatStringHover` in `code-editor.ts` (Jai editor only) fires when the node under the pointer is `formatString`, `formatSpecifier` or `formatPercent`. `formatStringAt(text, offset)` in `format-string.ts` finds the literal on that line, numbers its specifiers with `formatSpecs`, and splits the remaining call arguments at top-level commas with `trailingArguments` (skipping nested brackets, strings and comments). The tooltip reuses the overload-list layout (`.jai-hover--overloads` rows): the highlighted literal on top, then one row per specifier, `%2 → Argument 2 hp`, with "(not passed)" in the error colour for a short call, and `\%` / `%00` rows explained as "a literal %" / "prints nothing". The row of the specifier under the pointer is emphasised (`data-current`). A literal with no specifiers gets no hover.

**Language server first.** The client-side hover is a fallback inside the single LSP `hover` source. When the server advertises `inlayHintProvider` (the compiler release that also explains format strings), the client-side hover is skipped entirely and the server's hover is shown. Servers that send Markdown hovers write the literal as a `jai` fence and one list item per specifier (`` `%2` → `arg: Type` ``, the hovered one bold); the client draws that list in the same row layout (see [Markdown hovers](jai-language-features.md)). An older server's plain-text hover is shown as text. With an older server it is computed up front and shown when the server returns nothing for that position; a stale reply (the document changed meanwhile) shows nothing. The tokenizer's specifier colouring stays either way; newer servers also send `formatSpecifier` semantic tokens in the same colour, and `jai-format` diagnostics (unused arguments, missing ones) appear as ordinary lint marks labelled with their code.

**Changing it.** Add procedures to `formatCallees`. Keep `formatSpecs` and the tokenizer's specifier regex (`/^(?:00|0|[1-9]\d*)/`) in step with the compiler's print rules. Colours are `--ide-syntax-format` and `--ide-syntax-format-percent` in `CodeWorkspace.astro`; the workspace is dark-only, so there is no separate light value. Tests: `tests/jai/format-string.test.ts` (tokens, specifier numbering, argument splitting, `formatStringAt` and the row text from `describeFormatEntry`).

## Configuration

`jai-web-release.json` records the repository, immutable tag, revision, manifest and
archive digests. A disabled pointer keeps the project visible with an honest
unavailable-playground message until its first verified release exists.

Run `pnpm sync:web-assets` to stage the pinned release. To try an unreleased compiler,
build it with `python3 tools/build_scripting_wasm.py --release --output <dir>` in the compiler
repo and run `JAI_WEB_LOCAL=<dir> node scripts/sync-jai-web.ts`: it copies that build's
`jai_wasm.wasm`, `jaifmt-playground.jai`, `jaifmt.wasm` (built with `--jaic`) and, when present, `tour.json` with the `tour/`
files it lists into `public/jai/<pinned revision>/` without verification (public/jai is
ignored). `JAI_WASM_DIR=<dir> pnpm test:jai` also runs that build's tour and checks it is
already formatted under the default `jaifmt.toml`. `pnpm dev`'s `predev` re-syncs the pinned release, so start
the server with `pnpm exec astro dev` afterwards; the next normal sync restores the release. `sync-jai-web.ts` validates
the pointer and release digests; `verify-jai-bundle.py` validates the exact archive
inventory, paths, regular-file modes, sizes, digests and Wasm header before writing
anything. `pnpm test:jai` covers identity mismatch, tampering, traversal, extra
members, symlinks and native binaries. Archive limits are 64 MiB compressed and
128 MiB expanded; manifests allow up to 4,096 members. Worker initialization times
out after 20 seconds and supports retry. Node 22.12+ and Python 3 are required.

The host tests cover deferred readiness, initialization cancellation, session
reopening and disposal on failure. With Playwright installed and the dev server
running, use `PORTFOLIO_URL=http://127.0.0.1:4231 python3 tests/jai/modal_browser.py`.
It exercises actual single/multi-file execution, retained edits, modal reopening,
client navigation and the removed route. Set `VIEWPORT_WIDTH=390` for mobile and
`WEBKIT_EXECUTABLE` for an existing WebKit runtime, or `CHROMIUM_EXECUTABLE` to run in Chromium instead. Development and preview headers
include same-origin CORP alongside COEP/COOP so module workers can load under site
isolation. Browser/editor tests remain distinct from full language compatibility.

Dispatch `jai-web.yml` with `jai_ref` set to a full tested commit SHA. The workflow
retains immutable release assets and, by default, updates the consumer pointer
after its build passes. Reusing a tag requires byte-identical assets; it never
overwrites an existing release. A pointer commit created by `GITHUB_TOKEN` needs
a separate portfolio CI dispatch. Check Cloudflare and anonymous live assets
against that pointer before claiming deployment.

## Dependencies

Astro provides the portfolio pages and client navigation. CodeMirror supplies
editing primitives; the portfolio owns their configuration and UI. Browser
execution uses the owned module worker and pinned Rust-generated WebAssembly. Publishing uses
GitHub Actions and Releases; deployment uses the existing Cloudflare Pages build.
