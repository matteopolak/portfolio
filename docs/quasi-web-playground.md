# Quasi web playground

## What it is

The Projects page includes a lazy, in-browser Quasi interpreter with a source
editor and output panel. It uses the same floating 16:9 dialog treatment as the
Minecraft demo while keeping arbitrary programs off the page's main thread.

## How it works

`CodeDemoModal.astro` composes the shared `CodeWorkspace.astro` and
`CodeTerminal.astro` without a filesystem. All three language demos use the same
CodeMirror editor, with Run/output beneath it. Quasi chooses its tokenizer and
worker via `quasi-playground.ts`; the shared lifecycle is `code-playground.ts`.
See [Shared code workspace](code-workspace.md) for UI ownership and extension points.

`quasi-worker.ts` fetches `/quasi/quasi.js` and `/quasi/quasi_bg.wasm` as opaque
assets, initializes the generated module inside its worker and calls `execute`.
The wrapper is imported through a temporary blob URL because Vite does not
transform ESM files in `public/`. Vite's `?worker` loader emits the owned worker
for production. Execution has a one-second wall-clock limit; cancellation, close,
and navigation terminate it. Reopening creates a fresh editor and runtime.

`.github/workflows/quasi-web.yml` checks out a requested revision of
`matteopolak/quasi`, compiles the `wasm` library for `wasm32-unknown-unknown`
and runs its locked `wasm-bindgen` CLI,
smoke-tests `execute`, and publishes a versioned tarball on the
`quasi-web-latest` prerelease. It commits only `quasi-web-release.json` by
default. The portfolio's `predev` and `prebuild` hooks run
`scripts/sync-quasi-web.mjs`. Once the release pointer is enabled, it verifies
the release checksum and archive paths, then stages the bundle under
`public/quasi/` before Vite serves the dev site or Astro creates the static site.
Both hooks share the
`pnpm sync:web-assets` command.

The Quasi release pointer is currently disabled because no `quasi-web-latest`
release exists. The small, checked-in `public/quasi/quasi.js` and
`public/quasi/quasi_bg.wasm` bundle keeps the browser demo available in a clean
clone. The sync script requires both files when the pointer is disabled so a
build fails instead of shipping a broken button. Once a release is published,
enable its pointer and remove the checked-in fallback in the same change; the
sync script will then verify and stage the release bundle.

The upstream wrapper currently implements its timeout with `std::thread`, which
traps on `wasm32-unknown-unknown`. The workflow applies the small, checked patch
in `scripts/quasi-browser-worker.patch` to keep `execute` synchronous; the outer
Web Worker supplies the enforceable browser timeout. `git apply --check` makes a
future upstream API change fail visibly instead of silently producing an unsafe
runner.

## How to change it

Edit the visual layout in `CodeWorkspace.astro` and `CodeTerminal.astro` and the starter program in
`src/pages/projects.astro`. Change shared execution lifecycle, timeout
messaging, or shortcuts in `src/lib/code-playground.ts`; change only Quasi's
worker selection in `src/lib/quasi-playground.ts` and tokenizer in `src/lib/code-editor.js`, and the generated-module bridge in
`src/lib/quasi-worker.ts`. Keep untrusted execution inside the disposable worker
and never move `execute` onto the main thread.

If Quasi removes its internal thread or exposes a browser-specific synchronous
entry point, remove `scripts/quasi-browser-worker.patch` and the corresponding
workflow step together. Run the `Publish Quasi web build` action after changing
the desired Quasi revision. `pointer` is the normal update mode; `assets` also
commits generated files and should be used sparingly.

## Configuration

- `EXECUTION_TIMEOUT_MS` in `src/lib/code-playground.ts` controls the hard
  per-program limit.
- `quasi_ref` selects the Quasi branch, tag, or commit built by the workflow.
- `update_repository` selects `pointer`, `assets`, or `none` publication mode.
- `quasi-web-release.json` is generated deployment state. It remains disabled
  until the first workflow publication; disabled mode uses the checked-in
  `public/quasi/` files.
- `pnpm sync:web-assets` hydrates all release-backed browser demos manually;
  normal `pnpm dev` and `pnpm build` runs invoke it automatically.

## Dependencies

The playground depends on Web Workers, WebAssembly, `wasm-bindgen`, and the
Quasi `wasm` crate. Publication additionally uses GitHub Actions, GitHub
Releases, a nightly Rust toolchain, the `wasm-bindgen` CLI, and the portfolio's static
prebuild sync.
