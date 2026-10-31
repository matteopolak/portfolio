# Jai browser compiler

## What it is

jai is a Rust compiler for Jai, Jonathan Blow's systems language, with an interactive
browser workspace. The portfolio presents its project card and opens the workspace
from it in the shared code editor modal.

## How it works

The portfolio's `jacket-web.yml` workflow ("Publish Jacket web") builds one full, immutable compiler commit and pins the release's API docs with it.
The portfolio owns the entire interface: `CodeWorkspace.astro` renders the shared
header, file tree, CodeMirror editor and output pane described in
[Shared code workspace](code-workspace.md). There is no embedded release page,
editor footer, or Website action.
`src/lib/code-editor.ts` and `src/lib/jai/` contain the shared editor, Jai tokenizer, workspace, language
client, worker and Wasm bridge. The release files used at runtime are
`/jai/<full-commit>/jai_wasm.wasm` and, for the Format button,
`/jai/<full-commit>/jaifmt.wasm` (with `build-metadata.json` for its digest), falling back to
`/jai/<full-commit>/jaifmt-playground.jai` (see [Jai formatter](jai-formatter.md); releases
without either simply hide the button).

Opening the modal initializes separate execution and language-service workers.
The language client preserves completion, hover and inline diagnostics without
adding a diagnostics panel. Hover text is syntax-highlighted with the editor's own
grammar (`plainHoverContent` and `markdownContent` in `src/lib/code-highlight.ts`),
using the same colors as the source. File switches retain editor state. Closing aborts
initialization, terminates both workers and destroys CodeMirror; reopening starts
fresh. Astro navigation also disposes the session. Run uses a fixed
200-million-block budget, so a runaway program fails with a runtime error instead of
hanging; Stop also terminates the execution worker. The `jai_play_*` bridge returns
program stdout/stderr in write order, rendered diagnostics, and `main`'s exit code;
the output pane is a terminal ([Jai terminal](jai-terminal.md)): it shows writes (stderr in red), diagnostics, and `[exited with code N]` for a non-zero exit, and gives programs `argv` and standard input.
The session opens with the release's first preset workspace and runs it once when ready.
`loadStarter` (`src/lib/jai/starter.ts`) fetches `/jai/<full-commit>/examples.json`:

```json
{ "schema_version": 2, "examples": [
  { "name": "basics", "title": "Basics", "summary": "…", "main": "main.jai",
    "files": ["main.jai", "jacket.toml"], "assets": [] }, …] }
```

Each workspace lives in `/jai/<full-commit>/<name>/`. `examplesIndex` drops unusable entries (a name that isn't a plain lowercase segment, a duplicate, no `main.jai`, more than 64 files, a path that isn't plain and relative, or a non-array `assets`) and keeps the rest in order. The first one is the default. `loadExample` fetches the listed files (1 MiB in total) and adds the default `jacket.toml` unless the workspace has its own root config. A saved layout reopens its own tabs; a `/playground/jacket#path` link also opens and activates that file.

Fallbacks: releases before `examples.json` (Jacket 0.29) shipped the language tour instead, `tour.json` (`{ schema_version: 1, main: "main.jai", files }`) with files under `tour/`, and that opens with `main.jai` plus a preview of `tour.md`. If neither loads, the session opens the built-in two-file starter (`main.jai` loading `lib/math.jai`). Only an abort propagates. Tests: `tests/jai/starter.test.ts`.

### Program links

`/playground/jacket#code=<base64url>` opens the playground with that program as `main.jai` (plus the default `jacket.toml`) instead of the first example. The Jacket API docs' "Open in playground" button builds these links. The fragment is the program's UTF-8 bytes in unpadded base64url:

```js
location.href =
  '/playground/jacket#code=' +
  btoa(String.fromCharCode(...new TextEncoder().encode(code)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
```

`playground-page.ts` hands the fragment to the panel (`data-code-program`), and `initializeJaiPlayground` turns it into the first session's starter with `programFromHash` and `programStarter` (`src/lib/jai/program-link.ts`, kept out of `starter.ts` so the page script stays small). A fragment that is not valid base64url, not valid UTF-8 or over 1 MiB is ignored, and the session opens as usual. Later sessions (Reset, an example) don't reuse it. Tests: `tests/jai/program-link.test.ts`.

### Examples and assets

The Examples list under the file tree shows every usable `examples.json` entry by title and summary, and marks the one the session opened (`Starter.example`); a release without the index hides it. `loadExample` loads only the entry's `files` into the workspace. Asset files stay in the bundle, and when `assets` is non-empty the `Starter` gets `assets: "/jai/<full-commit>/<name>/"`.

That base travels as `assets` in the worker's `init` message to `createEngine(wasm, { host, assets: { base } })` (`src/lib/jai/engine.ts`), which answers stdlib `Extensions/Assets`:

- `jai_asset_fetch(path)` fetches `path` against the base and returns a handle, or 0. Paths must be plain relative paths (no `..`, empty parts, `\`, `:` or NUL) and must stay under the base. Fetches send no credentials, follow no redirects, and responses over 16 MiB are refused.
- `jai_asset_size(handle)` and `jai_asset_take(handle, buffer, count)` then hand the bytes over once.

`load_asset` checks `jai_host_provides` first. The engine answers that itself for its functions and the host's combined, because the WebGPU host's own answer only knows its own functions. Without a base, `load_asset` reports the file missing, and the textured cube draws plain faces.

Examples are defined in the compiler repo; the playground has no list of its own. Tests: `tests/jai/starter.test.ts` (loading) and `tests/jai/assets.test.ts` (path rules, limit, hand-over).

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

| Source      | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `%` or `%0` | the next argument                                        |
| `%N`        | argument N (1-based); a following `%` continues with N+1 |
| `%%`        | two specifiers, so two arguments (not a literal percent) |
| `%00`       | prints nothing                                           |
| `\%`        | a literal `%` (the lexer turns it into byte 31)          |

**Hover.** Format-string text itself is emitted as a `formatString` token (same `tags.string` colour), so the whole literal, quotes included, is findable in the syntax tree. `formatStringHover` in `code-editor.ts` (Jai editor only) fires when the node under the pointer is `formatString`, `formatSpecifier` or `formatPercent`. `formatStringAt(text, offset)` in `format-string.ts` finds the literal on that line, numbers its specifiers with `formatSpecs`, and splits the remaining call arguments at top-level commas with `trailingArguments` (skipping nested brackets, strings and comments). The tooltip reuses the overload-list layout (`.jai-hover--overloads` rows): the highlighted literal on top, then one row per specifier, `%2 → Argument 2 hp`, with "(not passed)" in the error colour for a short call, and `\%` / `%00` rows explained as "a literal %" / "prints nothing". The row of the specifier under the pointer is emphasised (`data-current`). A literal with no specifiers gets no hover.

**Language server first.** The client-side hover is a fallback inside the single LSP `hover` source. When the server advertises `inlayHintProvider` (the compiler release that also explains format strings), the client-side hover is skipped entirely and the server's hover is shown. Servers that send Markdown hovers write the literal as a `jai` fence and one list item per specifier (`` `%2` → `arg: Type` ``, the hovered one bold); the client draws that list in the same row layout (see [Markdown hovers](jai-language-features.md)). An older server's plain-text hover is shown as text. With an older server it is computed up front and shown when the server returns nothing for that position; a stale reply (the document changed meanwhile) shows nothing. The tokenizer's specifier colouring stays either way; newer servers also send `formatSpecifier` semantic tokens in the same colour, and `jai-format` diagnostics (unused arguments, missing ones) appear as ordinary lint marks labelled with their code.

**Changing it.** Add procedures to `formatCallees`. Keep `formatSpecs` and the tokenizer's specifier regex (`/^(?:00|0|[1-9]\d*)/`) in step with the compiler's print rules. Colours are `--ide-syntax-format` and `--ide-syntax-format-percent` in `CodeWorkspace.astro`; the workspace is dark-only, so there is no separate light value. Tests: `tests/jai/format-string.test.ts` (tokens, specifier numbering, argument splitting, `formatStringAt` and the row text from `describeFormatEntry`).

## Configuration

`releases/jai-web-release.json` records the repository, immutable tag, revision, manifest and
archive digests, and from Jacket 0.31.0 the API docs (`docsAsset`, `docsSha256`). A disabled pointer keeps the project visible with an honest
unavailable-playground message until its first verified release exists.

### Bumping the compiler

```bash
pnpm bump:jacket          # latest Jacket release
pnpm bump:jacket v0.19.2  # a specific tag (or a full commit SHA)
```

This dispatches `.github/workflows/jacket-web.yml`. It resolves the tag (or `latest`) to a commit
in matteopolak/jacket, builds and checks the browser bundle with the release's own
`package_browser_release.py`, publishes it as the `jai-web-<sha>` release and commits the new
pin, which deploys. Nothing is vendored, so there is no file to edit by hand. Releases from 0.19
keep their build scripts in `tools/<subsystem>/`; the workflow looks in both places.

The workspace header shows the pinned build as `jacket <version> · <short sha>`, linked to the
commit in matteopolak/jacket. `jacket-web.yml` records `version` from the compiler's
`[workspace.package]` in `Cargo.toml`. Pins written before that have no `version`, so the
label shows just the hash.

Run `pnpm sync:web-assets` to stage the pinned release. To try an unreleased compiler,
build it with `python3 tools/build_scripting_wasm.py --release --output <dir>` in the compiler
repo and run `JAI_WEB_LOCAL=<dir> node scripts/sync-jai-web.ts`: it copies that build's
`jai_wasm.wasm`, `jaifmt-playground.jai`, `jaifmt.wasm` (built with `--jaic`) and, when present, `examples.json` with every
workspace's files and assets (or, for older builds, `tour.json` with its `tour/` files) into `public/jai/<pinned revision>/` without verification (public/jai is
ignored). `JAI_WASM_DIR=<dir> pnpm test:jai` also checks that build's workspaces (`tests/jai/local-workspaces.ts`): the first runs with exit code 0, and every one is lint-free and already formatted. `pnpm dev`'s `predev` re-syncs the pinned release, so start
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

Dispatch `jacket-web.yml` with `jai_ref` set to a full tested commit SHA. The workflow
retains immutable release assets and, by default, updates the consumer pointer
after its build passes. Reusing a tag requires byte-identical assets; it never
overwrites an existing release. A pointer commit created by `GITHUB_TOKEN` needs
a separate portfolio CI dispatch. Check Cloudflare and anonymous live assets
against that pointer before claiming deployment.

### API docs (`/docs/jacket`)

Each Jacket release from 0.31.0 attaches `jacket-docs-<version>.tar.gz`: the standard library's API reference as a static site (about 7.4k files), built by `jacket doc --base-url /docs/jacket/` with the browser compiler for its Run buttons. The portfolio serves it at `/docs/jacket/`. Nothing generated is committed.

- **Publish (`jacket-web.yml`).** After building the playground bundle, "Fetch and check the API docs" reads the version from the compiler's `Cargo.toml` and looks for the asset on release `v<version>`. That tag must resolve to the pinned commit, and the download must match GitHub's `sha256` digest for the asset. `scripts/stage-jacket-docs.py` then checks the inventory. The tarball is re-published as `jacket-docs.tar.gz` on the immutable `jai-web-<sha>` release, and its digest goes into the pin. A release without the asset (before 0.31.0) publishes without docs. Re-running for a release published before docs existed uploads the docs to it once; otherwise the existing bytes must match.
- **Build (`sync-jai-web.ts`, in `prebuild`).** When the pin has `docsAsset`, it downloads the tarball from the `jai-web-<sha>` release (64 MiB cap), checks the pinned digest, and runs `stage-jacket-docs.py --out public/docs/jacket`. That script rejects anything but regular files and directories with plain relative paths, more than 12,000 files, any file over 25 MiB (the Cloudflare Pages limit) or 256 MiB in total, and a site without `index.html`. It drops the tarball's `runtime/` copy of the compiler and rewrites `runtime.json` to `{"engine": "/jai/<sha>/engine.mjs", "wasm": "/jai/<sha>/jai_wasm.wasm"}`, the playground's copy, which the docs' run worker loads. A pin without docs removes `public/docs/jacket`. `public/docs/` is gitignored, and `check:seo` skips `dist/docs`, because the generated pages carry their own metadata.
- The docs' "Open in playground" button links to `/playground/jacket#code=…` (see [Program links](#program-links)). Their header links back to the playground.
- Cloudflare Pages serves `/docs/jacket/` from `index.html` (and redirects `/docs/jacket` there). The site headers (COOP/COEP) apply to it too, so it must load only same-origin assets, as it does.
- Tests: `tests/jai/test_jacket_docs.py` (staging, `runtime.json`, refusals).

## Dependencies

Astro provides the portfolio pages and client navigation. CodeMirror supplies
editing primitives; the portfolio owns their configuration and UI. Browser
execution uses the owned module worker and pinned Rust-generated WebAssembly. Publishing uses
GitHub Actions and Releases; deployment uses the existing Cloudflare Pages build.

Note: `initializeJaiPlayground` waits for the `CodeWorkspace` island to mount (`whenWorkspaceMounted`) before creating the layout and session, and drives the status/Retry/Run state through `WorkspaceChrome` (`src/lib/workspace-chrome.ts`). `tests/jai/host.test.ts` injects a fake chrome. The `AbortSignal` teardown is unchanged.

## Replacing the workspace

`createSession` takes an optional `Starter` (files plus the tabs to open) in place of the compiler release's tour. Import folder and Reset workspace restart the session with one (see [code-workspace.md](./code-workspace.md#import-folder-and-reset-workspace)); a new session also means a new language server, so diagnostics reflect the new files.
