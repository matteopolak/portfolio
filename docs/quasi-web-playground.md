# Quasi web playground

## What it is

The Projects page includes a lazy, in-browser Quasi interpreter with a source
editor and output panel. It uses the same floating 16:9 dialog treatment as the
Minecraft demo while keeping arbitrary programs off the page's main thread.

## How it works

`CodeDemoModal.astro` owns the unlabelled editor and console panes, the Run
control anchored at the source pane's lower-right, responsive layout, and
floating fullscreen/close controls. It composes the same aggregate loading
surface as the Minecraft modal. `src/lib/quasi-playground.ts` configures the
shared controller in `src/lib/code-playground.ts` and prewarms a module Web
Worker when the modal opens. The worker in
`src/lib/quasi-worker.ts` fetches `/quasi/quasi.js` and
`/quasi/quasi_bg.wasm` as opaque static assets, initializes the generated module
inside the worker, and calls Quasi's exported `execute` function. The wrapper is
loaded through a temporary blob URL because Vite intentionally does not
transform ESM files under `public/`.

The source textarea fills its pane and receives focus when the dialog opens.
Its native scrollbar and focus ring are visually suppressed to keep the editor
surface uninterrupted; scrolling, selection, caret visibility, and keyboard
focus continue to work normally.

An inert Prism layer behind the transparent textarea uses the Rust grammar for
close-enough live highlighting, while a synchronized, low-contrast gutter
renders compact line numbers without a separate background block. Source edits
and scrolling update both layers without replacing the
native textarea editing model. Successful output uses the console foreground;
parser, runtime, worker, and timeout errors are marked as stderr and rendered in
red.

The editor is revealed only after the worker has downloaded and compiled the
Wasm module. The one-second execution timer begins only when a program is sent
to that ready worker. While a program runs, the existing console output remains
visible and the disabled Run control shows a spinner; the output is replaced
only when execution succeeds, fails, or times out. Successful executions reuse
the warm worker. If a program does not finish, the page terminates the worker,
so an infinite Quasi loop cannot stall navigation or rendering. Closing the
dialog or navigating away also terminates it.

`.github/workflows/quasi-web.yml` checks out a requested revision of
`matteopolak/quasi`, compiles the `wasm` library for `wasm32-unknown-unknown`
and runs its locked `wasm-bindgen` CLI,
smoke-tests `execute`, and publishes a versioned tarball on the
`quasi-web-latest` prerelease. It commits only `quasi-web-release.json` by
default. The portfolio's `predev` and `prebuild` hooks run
`scripts/sync-quasi-web.mjs`, verify the release checksum and archive paths, and
materialize the ignored bundle under `public/quasi/` before Vite serves the dev
site or Astro creates the static site. Both hooks share the
`pnpm sync:web-assets` command.

The release remains the source of the compiled bundle. `public/quasi/` is an
ignored build-stage cache populated from that release, not checked-in source.
Serving the synchronized files from the final site avoids a runtime dependency
on GitHub availability and cross-origin headers while retaining release-backed
integrity verification.

The upstream wrapper currently implements its timeout with `std::thread`, which
traps on `wasm32-unknown-unknown`. The workflow applies the small, checked patch
in `scripts/quasi-browser-worker.patch` to keep `execute` synchronous; the outer
Web Worker supplies the enforceable browser timeout. `git apply --check` makes a
future upstream API change fail visibly instead of silently producing an unsafe
runner.

## How to change it

Edit the visual layout in `CodeDemoModal.astro` and the starter program in
`src/pages/projects.astro`. Change shared execution lifecycle, timeout
messaging, or shortcuts in `src/lib/code-playground.ts`; change only Quasi's
highlighting and worker selection in `src/lib/quasi-playground.ts`, and the generated-module bridge in
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
  until the first workflow publication.
- `pnpm sync:web-assets` hydrates all release-backed browser demos manually;
  normal `pnpm dev` and `pnpm build` runs invoke it automatically.

## Dependencies

The playground depends on Web Workers, WebAssembly, `wasm-bindgen`, and the
Quasi `wasm` crate. Publication additionally uses GitHub Actions, GitHub
Releases, a nightly Rust toolchain, the `wasm-bindgen` CLI, and the portfolio's static
prebuild sync.
