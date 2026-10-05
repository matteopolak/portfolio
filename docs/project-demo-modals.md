# Project demo modals

## What it is

Minecraft, jai, Quasi, and BaerScript share one dialog component and one loading
surface instead of implementing their own modals, animations, spinners or staged
loaders. The surface shows a short status and one aggregate progress bar until the
imported demo reports that it is ready.

## How it works

`DemoModal.astro` is the only `<dialog>` used by project demos. It owns centering,
the backdrop, the 210 ms entrance and 160 ms exit animations, and reduced-motion
handling. Its `media` variant is the 16:9 Minecraft stage with an external action
column. Its `workspace` variant is the code editor, which becomes a full-screen sheet
that slides up on phones (see [Shared code workspace](code-workspace.md)).
`closeAnimated` in `src/lib/project-actions.ts` sets `data-closing`, waits for
the exit animation's `animationend` (with a 300 ms fallback), then closes the
dialog. Teardown runs from the dialog's `close` event.

`ProjectDemoLoading.astro` is composed into each modal: over the whole 16:9 stage
for Minecraft, and over the workspace body (below its header) for the editors. The small state
helper in `src/lib/project-actions.ts` listens on every `[data-project-demo]`
dialog for three bubbling events: `project-demo-progress`,
`project-demo-ready`, and `project-demo-error`. This keeps the modal agnostic to
whether the underlying demo is a WebAssembly compiler, a renderer worker, or a
future project runtime.

`Layout.astro` loads the action controller on every route and initializes it
after each `astro:page-load`. This matters for Astro client navigation: the
Projects page buttons are ready after arriving from the homepage without a
full refresh. Initialization aborts the previous route's listeners and worker
sessions before attaching listeners to the current DOM.

The aggregate value drives both the horizontal progress bar and a clipped color
layer inside the black M mark. Its uneven edge resembles rising paint while a
slow background shift keeps the fill alive between progress updates. Reduced
motion keeps the same progress fill but disables the color movement.

Lodestone emits aggregate progress while its existing SDK worker mounts and
hides the shared loader only after the first rendered frame. The two code
playgrounds create and compile their workers when a modal opens, emit coarse
total progress from the worker bootstrap, and reveal the editor only after
wasm-bindgen is ready. Each worker remains warm for runs during that modal
session and is terminated when the modal closes.

## How to change it

Edit `DemoModal.astro` for the dialog frame and animation, and
`ProjectDemoLoading.astro` for shared loading visuals. New demos should wrap their
content in `DemoModal`, compose the loader into it, and emit the same three events from their
runtime boundary; avoid adding demo-specific loading markup. Keep progress
monotonic and normalized to `0..1`. Readiness must mean the demo can accept its
first interaction, not merely that a script downloaded.

Keep the route lifecycle hook in `Layout.astro` when changing project actions.
Attaching it only from `projects.astro` can miss the first client transition.

## Configuration

There are no global flags. Each demo chooses how to map its own coarse phases
onto the aggregate progress value. Code execution timeouts remain separate from
modal loading and are configured by `EXECUTION_TIMEOUT_MS`.

## Dependencies

The shared surface uses Astro markup, CSS custom properties, bubbling DOM
events, native `<dialog>`, Web Workers, and the existing demo-specific Wasm
runtimes.
