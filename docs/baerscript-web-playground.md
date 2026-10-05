# BaerScript web playground

## What it is

The BaerScript project card opens a lazy, in-browser interpreter with the same source-and-output workspace used by Quasi. Programs run in a disposable Web Worker so an infinite two-dimensional execution path cannot freeze the portfolio page.

## How it works

`CodeDemoModal.astro` composes the shared `CodeWorkspace.astro` and `CodeOutput.astro` without a filesystem. `code-editor.ts` provides CodeMirror with BaerScript tokenization; Run sits in the header and output below the editor. `baerscript-playground.ts` chooses the runtime worker and delegates lifecycle to `code-playground.ts`. See [Shared code workspace](code-workspace.md).

`src/lib/baerscript-worker.ts` fetches `/baerscript/baerscript_wasm.js` and `/baerscript/baerscript_wasm_bg.wasm`, initializes the wasm-bindgen module inside the worker, and calls `execute(source, input, ascii, maxSteps)`. `baerscript-playground.ts` imports that entrypoint with Vite's `?worker` loader so production emits executable JavaScript instead of an unprocessed TypeScript data URL. The portfolio currently supplies empty input, numeric mode, and a 250,000-step instruction budget. The shared controller also terminates the worker after one second, on modal close, or during Astro navigation.

`.github/workflows/baerscript-web.yml` checks out a selected `matteopolak/baerscript` revision, runs the upstream `wasm-pack` release recipe with size-oriented Cargo settings, smoke-tests the structured execution result, and publishes a versioned tarball to the `baerscript-web-latest` prerelease. It normally commits only `baerscript-web-release.json` back to the portfolio.

Before development and production builds, `scripts/sync-baerscript-web.ts` downloads that release asset, verifies its SHA-256 digest and archive paths, and stages the ignored files under `public/baerscript/`. The static site therefore serves the module itself without depending on GitHub at runtime.

## How to change it

Edit the starter program in `src/data/code-demos.ts` (shared by the modal and `/playground/baerscript`). Change BaerScript highlighting in `src/lib/code-editor.ts` or worker selection in `src/lib/baerscript-playground.ts`; change module filenames, input mode, or the instruction budget in `src/lib/baerscript-worker.ts`. Shared editor, timeout, and modal behavior belongs in `CodeDemoModal.astro`, `src/lib/code-playground.ts`, and `src/lib/project-actions.ts` rather than in BaerScript-specific wrappers.

Keep the starter's first line executable. BaerScript begins on row one, so a leading comment exits successfully without running the example; the current starter prints `2`.

Run the `Publish BaerScript web build` action when the upstream Wasm API changes. `pointer` is the normal publication mode; `assets` additionally commits the hydrated bundle and should be used only when deliberately vendoring generated files.

## Configuration

- `baerscript_ref` selects the branch, tag, or commit built by the workflow.
- `update_repository` selects `pointer`, `assets`, or `none` publication mode.
- `baerscript-web-release.json` records the release asset name, digest, and upstream revision.
- `EXECUTION_TIMEOUT_MS` in `src/lib/code-playground.ts` controls the wall-clock limit shared by code playgrounds.
- `pnpm sync:web-assets` hydrates every release-backed browser demo and runs automatically before `pnpm dev` and `pnpm build`.

## Dependencies

The playground depends on Web Workers, WebAssembly, CodeMirror, the upstream `baerscript-wasm` crate, and its wasm-bindgen output. Publication uses GitHub Actions, GitHub Releases, stable Rust, `wasm-pack`, and the portfolio's static prebuild sync.
