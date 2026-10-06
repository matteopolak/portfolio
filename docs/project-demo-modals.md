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
`closeAnimated` in `src/lib/dialog-lifecycle.ts` sets `data-closing`, waits for
the exit animation's `animationend` (with a 300 ms fallback), then closes the
dialog. Teardown runs from the dialog's `close` event, registered through
`onDialogClosed`.

Reopening a demo while it closes is safe. There are two windows, and the
second is easy to miss: the browser fires `close` as a separate task after
`dialog.close()`, and a hidden tab throttles the fallback timer to about a
second. So:

- `openDialog` (used instead of `showModal()`) cancels a pending animated
  close. The dialog stays open with its session, and dropping `data-closing`
  replays the enter animation.
- `onDialogClosed` ignores a `close` event if the dialog is open again by the
  time it runs. Before this, a reopen in that gap saw the old session as
  ready, then the late event tore it down under the open modal (Run disabled,
  empty status, `#<project>/try` reset to `#<project>`).

Page-wide state (the `has-project-demo` class and the `#<project>/try` hash)
is only cleared when no demo dialog is open (`releasePage` in
`project-actions.ts`). Hidden tabs can hold a `close` event until the next
rendering, so a late event from one dialog must not clear state that another
open demo owns.

`tests/jai/dialog-lifecycle.test.ts` covers both windows with a fake dialog
that, like the browser, fires `close` asynchronously.

Only the close button and a backdrop click close a demo. Escape never does: the
editors (Vim mode, completion, search) and the game need the key. The dialog
has `closedby="none"` and every `cancel` event is prevented; both are needed,
because Chrome lets a repeated Escape close a dialog whose `cancel` was
prevented unless `closedby` says otherwise.

`ProjectDemoLoading.astro` is composed into each modal: over the whole 16:9 stage
for Minecraft, and over the workspace body (below its header) for the editors. The small state
helper (`setDemoLoading`/`watchDemoLoading` in `src/lib/code-demos.ts`, used by
`src/lib/project-actions.ts`) listens on every `dialog[data-project-demo]` for three bubbling events: `project-demo-progress`,
`project-demo-ready`, and `project-demo-error`. This keeps the modal agnostic to
whether the underlying demo is a WebAssembly compiler, a renderer worker, or a
future project runtime. The full-page playgrounds reuse the same helpers on
their `[data-playground-page]` element (see [Full-page playgrounds](playground-pages.md)).

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

Open and close demo dialogs only through `openDialog`, `closeAnimated` and
`onDialogClosed`; a bare `showModal()` or `close` listener reintroduces the
reopen race. Edit `DemoModal.astro` for the dialog frame and animation, and
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
