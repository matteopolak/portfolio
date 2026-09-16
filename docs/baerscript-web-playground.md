# BaerScript web playground

## What it is

The BaerScript project card opens a lazy, in-browser interpreter with the same source-and-output workspace used by Quasi. Programs run in a disposable Web Worker so an infinite two-dimensional execution path cannot freeze the portfolio page.

## How it works

`CodeDemoModal.astro` provides the shared 16:9 editor, output console, loading state, controls, and responsive layout. `src/lib/baerscript-playground.ts` supplies a small Prism grammar for BaerScript's movement and mutation symbols, then delegates the editor and execution lifecycle to `src/lib/code-playground.ts`.

`src/lib/baerscript-worker.ts` fetches `/baerscript/baerscript_wasm.js` and `/baerscript/baerscript_wasm_bg.wasm`, initializes the wasm-bindgen module inside the worker, and calls `execute(source, input, ascii, maxSteps)`. The portfolio currently supplies empty input, numeric mode, and a 250,000-step instruction budget. The shared controller also terminates the worker after one second, on modal close, or during Astro navigation.

`.github/workflows/baerscript-web.yml` checks out a selected `matteopolak/baerscript` revision, runs the upstream `wasm-pack` release recipe with size-oriented Cargo settings, smoke-tests the structured execution result, and publishes a versioned tarball to the `baerscript-web-latest` prerelease. It normally commits only `baerscript-web-release.json` back to the portfolio.

Before development and production builds, `scripts/sync-baerscript-web.mjs` downloads that release asset, verifies its SHA-256 digest and archive paths, and stages the ignored files under `public/baerscript/`. The static site therefore serves the module itself without depending on GitHub at runtime.

## How to change it

Edit the starter program in `src/pages/projects.astro`. Change BaerScript highlighting or the worker selection in `src/lib/baerscript-playground.ts`; change module filenames, input mode, or the instruction budget in `src/lib/baerscript-worker.ts`. Shared editor, timeout, and modal behavior belongs in `CodeDemoModal.astro`, `src/lib/code-playground.ts`, and `src/lib/project-actions.ts` rather than in BaerScript-specific wrappers.

Run the `Publish BaerScript web build` action when the upstream Wasm API changes. `pointer` is the normal publication mode; `assets` additionally commits the hydrated bundle and should be used only when deliberately vendoring generated files.

## Configuration

- `baerscript_ref` selects the branch, tag, or commit built by the workflow.
- `update_repository` selects `pointer`, `assets`, or `none` publication mode.
- `baerscript-web-release.json` records the release asset name, digest, and upstream revision.
- `EXECUTION_TIMEOUT_MS` in `src/lib/code-playground.ts` controls the wall-clock limit shared by code playgrounds.
- `pnpm sync:web-assets` hydrates every release-backed browser demo and runs automatically before `pnpm dev` and `pnpm build`.

## Dependencies

The playground depends on Web Workers, WebAssembly, Prism, the upstream `baerscript-wasm` crate, and its wasm-bindgen output. Publication uses GitHub Actions, GitHub Releases, stable Rust, `wasm-pack`, and the portfolio's static prebuild sync.
