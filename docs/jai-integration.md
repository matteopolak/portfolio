# Jai browser compiler

## What it is

Jai is an experimental Rust compiler project with an interactive browser workspace.
The portfolio presents its project card and embeds the compiler-owned editor. It
does not claim full Jai compatibility.

## How it works

The portfolio's `jai-web.yml` workflow builds one full, immutable compiler commit.
The portfolio owns the entire interface: `CodeWorkspace.astro` renders a plain file
tree, CodeMirror editor, and Run/output area below the editor. There is no embedded
release page, branding header, status bar, editor footer, or Website action.
`src/lib/code-editor.js` and `src/lib/jai/` contain the shared editor, Jai tokenizer, workspace, language
client, worker and Wasm bridge. The only release file used at runtime is
`/jai/<full-commit>/jai_wasm.wasm`.

Opening the modal initializes separate execution and language-service workers.
The language client preserves completion, hover and inline diagnostics without
adding a diagnostics panel. File switches retain editor state. Closing aborts
initialization, terminates both workers and destroys CodeMirror; reopening starts
fresh. Astro navigation also disposes the session. Run uses a fixed one-million
step budget; cancellation terminates the execution worker so a stuck program
cannot block the UI. Output contains results or actual errors, with no idle text.

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
as text. An experimental-compatibility note remains visible in the editor.

## How to change it

The project description is `src/content/projects/jai.md`; it does not change the
resume's selected projects in `portfolio.toml`. Edit `CodeWorkspace.astro` and `CodeTerminal.astro` for the
shared layout and styling, `src/lib/jai/workspace-ui.js` for file selection and execution,
`code-editor.js` and `jai/language.js` for CodeMirror behavior, and `engine.js`/`worker.js`
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

`jai/language-actions.js` accepts canonical, percent-encoded
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

Run `pnpm sync:web-assets` to stage the pinned release. `sync-jai-web.mjs` validates
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
`WEBKIT_EXECUTABLE` for an existing WebKit runtime. Development and preview headers
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
