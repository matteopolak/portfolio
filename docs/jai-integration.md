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
The session opens with a two-file starter (`main.jai` loading `lib/math.jai` and
printing through `Basic`) and runs it once when ready.

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
- The producer's `tools/package_browser_release.py --output <directory>` builds a
  release Wasm module and produces the two assets above. CI supplies fetched,
  locked Cargo dependencies and a `wasm32-unknown-unknown` target.
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

### Definition and symbol rename

The owned editor has local adapters for F12 (definition) and F2 (symbol rename).
They activate only when the connected server advertises `definitionProvider` or
`renameProvider`; preparing these adapters does not establish that a replacement
semantic compiler has shipped. The published release pointer stays unchanged.

`jai/language-actions.ts` accepts canonical, percent-encoded
`file:///jai-script/` URIs and UTF-16 ranges. Definition accepts `Location` or
`LocationLink` targets only inside the current virtual filesystem. Rename requires
versioned `documentChanges` containing text edits, rejecting unversioned edits,
resource operations, external targets, invalid ranges and overlaps. The entire
workspace is checked again after the request; all target versions are validated
before any text is changed. Stale edits and closed sessions preserve every file.
Editor states apply the same edits to retain selection/history, then the language
client resynchronizes the changed document versions. File-tree rename remains a
separate operation and does not rename symbols or rewrite imports.

## Configuration

`jai-web-release.json` records the repository, immutable tag, revision, manifest and
archive digests. A disabled pointer keeps the project visible with an honest
unavailable-playground message until its first verified release exists.

Run `pnpm sync:web-assets` to stage the pinned release. To try an unreleased compiler,
build it with `python3 tools/build_scripting_wasm.py --release --output <dir>` in the compiler
repo and run `JAI_WEB_LOCAL=<dir> node scripts/sync-jai-web.ts`: it copies that build's
`jai_wasm.wasm` and `jaifmt-playground.jai` into `public/jai/<pinned revision>/` without
verification (public/jai is ignored). `pnpm dev`'s `predev` re-syncs the pinned release, so start
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
