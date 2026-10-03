# Jai browser compiler

## What it is

Jai is an experimental Rust compiler project with an interactive browser workspace.
The portfolio presents its project card and embeds the compiler-owned editor. It
does not claim full Jai compatibility.

## How it works

The portfolio's `jai-web.yml` workflow builds one full, immutable compiler commit.
The producer owns the compiler, editor, file tree, worker, syntax/bracket highlighting,
indentation and LSP. The consumer stages a verified release under
`/jai/<full-commit>/` and embeds `index.html` only in the Try it out dialog.
The project card retains its GitHub source link and has no Website action or
dedicated `/projects/jai` route.
Closing the dialog removes the iframe and its workers; Astro navigation cleans up
the host listeners. No supplied reference binaries or sources may enter the bundle.

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
resume's selected projects in `portfolio.toml`. `JaiPlayground.astro` supplies the
host chrome, `JaiDemoModal.astro` the dialog, and `jai-playground.ts` readiness,
retry and destruction. `project-actions.ts` initializes the project dialog on
`astro:page-load`. Removing the frame on close intentionally starts a fresh
workspace on reopening. Do not replace the readiness message with an iframe
`load` event: a loaded document can still have an uninitialized compiler.

Coordinate producer changes in `~/projects/jai/web/scripting-runtime` with the
manifest contract above. Pin a new exact SHA and its manifest/archive digests; never
resolve a branch or mutable latest tag during site builds. Verify actual editing,
multi-file execution, cancellation, modal reopening and Astro client navigation
separately from artifact publication and CI.

## Configuration

`jai-web-release.json` records the repository, immutable tag, revision, manifest and
archive digests. A disabled pointer keeps the project visible with an honest
unavailable-playground message until its first verified release exists.

Run `pnpm sync:web-assets` to stage the pinned release. `sync-jai-web.mjs` validates
the pointer and release digests; `verify-jai-bundle.py` validates the exact archive
inventory, paths, regular-file modes, sizes, digests and Wasm header before writing
anything. `pnpm test:jai` covers identity mismatch, tampering, traversal, extra
members, symlinks and native binaries. Archive limits are 64 MiB compressed and
128 MiB expanded; manifests allow up to 4,096 members. Host initialization times
out after 60 seconds and supports retry. Node 22.12+ and Python 3 are required.

The host tests also cover foreign origins, stale frames, mismatched revisions,
initialization cancellation, reopening, and error retry. These tests verify host
behavior; only a real published compiler bundle can establish editing and
execution acceptance. With Playwright installed and `pnpm preview` running,
`python3 tests/jai/modal_browser.py` verifies the rendered card, modal reopening,
client navigation and removed route. Set `PORTFOLIO_URL` for another preview URL
and `WEBKIT_EXECUTABLE` for an existing WebKit runtime.

Dispatch `jai-web.yml` with `jai_ref` set to a full tested commit SHA. The workflow
retains immutable release assets and, by default, updates the consumer pointer
after its build passes. Reusing a tag requires byte-identical assets; it never
overwrites an existing release. A pointer commit created by `GITHUB_TOKEN` needs
a separate portfolio CI dispatch. Check Cloudflare and anonymous live assets
against that pointer before claiming deployment.

## Dependencies

Astro provides the portfolio pages and client navigation. Browser execution uses
the compiler-owned worker and actual Rust-generated WebAssembly. Publishing uses
GitHub Actions and Releases; deployment uses the existing Cloudflare Pages build.
