# Project demo modals

## What it is

Minecraft, Quasi, and BaerScript share one modal loading surface instead of implementing
their own spinners or staged loaders. The surface shows a short status and one
aggregate progress bar until the imported demo reports that it is ready.

## How it works

`ProjectDemoLoading.astro` is composed into each 16:9 modal. The small state
helper in `src/lib/project-actions.ts` listens on every `[data-project-demo]`
dialog for three bubbling events: `project-demo-progress`,
`project-demo-ready`, and `project-demo-error`. This keeps the modal agnostic to
whether the underlying demo is a WebAssembly compiler, a renderer worker, or a
future project runtime.

Lodestone emits aggregate progress while its existing SDK worker mounts and
hides the shared loader only after the first rendered frame. The two code
playgrounds create and compile their workers when a modal opens, emit coarse
total progress from the worker bootstrap, and reveal the editor only after
wasm-bindgen is ready. Each worker remains warm for runs during that modal
session and is terminated when the modal closes.

## How to change it

Edit `ProjectDemoLoading.astro` for shared visuals. New demos should compose
that component into their modal and emit the same three events from their
runtime boundary; avoid adding demo-specific loading markup. Keep progress
monotonic and normalized to `0..1`. Readiness must mean the demo can accept its
first interaction, not merely that a script downloaded.

## Configuration

There are no global flags. Each demo chooses how to map its own coarse phases
onto the aggregate progress value. Code execution timeouts remain separate from
modal loading and are configured by `EXECUTION_TIMEOUT_MS`.

## Dependencies

The shared surface uses Astro markup, CSS custom properties, bubbling DOM
events, native `<dialog>`, Web Workers, and the existing demo-specific Wasm
runtimes.
