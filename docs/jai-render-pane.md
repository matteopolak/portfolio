# Jai Render pane (WebGPU programs)

## What it is

Jai programs that draw with WebGPU (`#import "WebGPU"`, or `"Extensions/WebGPU"`) show their frames in the **Render** pane, a dockable panel like Files and Output. It starts closed (on the right), opens when a program configures its drawing surface, forwards keyboard, mouse and size changes to the program, and explains itself when the browser cannot draw.

## How it works

| File | Role |
| --- | --- |
| `src/lib/jai/render-pane.ts` | Pane contents: canvas per execution worker, idle/drawing/unsupported states, resize observer, reveal and focus |
| `src/lib/jai/canvas-input.ts` | DOM events to `Canvas_Event` records (`stdlib/Input/wasm.jai`): Key_Code mapping, buttons, wheel, focus |
| `src/lib/jai/worker.ts` | Loads the bundle's `webgpu_host.mjs`, passes it to `createEngine`, forwards `output` and `surface` messages |
| `src/lib/jai/engine.ts` | `jai_host` imports (`call`, `wait` via JSPI, `output`, `error`, `now_ms`) and `playAsync` |
| `src/lib/workspace-layout-model.ts` | `render` panel id, `closed` panels, per-dock `shares`, migration of old layouts |

**Canvas per worker.** The drawing surface is transferred to the execution worker (`transferControlToOffscreen`), so `render.canvas()` builds a new `<canvas>` inside the stable `[data-code-render]` stage for every new execution worker (boot, and after Stop or an edit terminated the previous one) and hands back the `OffscreenCanvas` for the `init` message. `render.attach(worker, capabilities)` wires input listeners with an `AbortController`; `render.stopped()` aborts them and removes the canvas. One `ResizeObserver` on the stage (device-pixel box) posts `resize` to whichever worker is current.

**Gating.** The page sends a canvas only where `navigator.gpu`, JSPI (`WebAssembly.Suspending` + `WebAssembly.promising`) and `transferControlToOffscreen` all exist; the worker checks again before creating the host. Without a host, `createEngine` gets none, `jai_webgpu_available` answers no and programs print a skip message. The pane then shows why (`renderSupport()`), and opens once per session when the user explicitly runs a program that imports WebGPU.

**Showing the pane.** The host's `onSurface({ width, height })` (on `wgpuSurfaceConfigure`) becomes a `surface` worker message; the first one of a run opens the pane (`layout.open('render')`) and focuses the canvas, unless the run came from an edit while the user is typing (then focus and the phone pane stay put). `onSurface(null)` or the end of the run returns to idle. Hosts from before `onSurface` (detected by its name in the host source) fall back to a regex on the sources' `#import`.

**Input.** Keys map to stdlib/Input `Key_Code` (named keys, `F1`=143.., printable keys as their upper-case character, Alt-composed characters by physical key); buttons 0/1/2 map to 1/169/170; wheel is in `WHEEL_DELTA` (120) units, positive up. While the canvas has focus, keys are `preventDefault`ed except Ctrl/Cmd shortcuts, function keys and Tab, so the page does not scroll but browser shortcuts and Run (Ctrl+Enter) still work.

**Output and budget.** Programs that wait stream output after every wait (`output` messages, stderr kept marked) through `CodeOutput.progress`; the final result replaces it. Stop keeps the streamed text. The interpreter budget (`BUDGET` in `workspace-ui.ts`) refills on every wait, so for drawing programs it is a per-frame budget.

## How to change it

- New Key_Code: extend `KEY`/`NAMED_KEYS` in `canvas-input.ts`; `tests/jai/canvas-input.test.ts` checks `KEY` against `stdlib/Input/module.jai` when `JAI_REPO` points at a Jai checkout.
- Host API changes: `HostModule` in `worker.ts` and the `init`/`surface` messages in `lsp-types.ts`.
- Pane placement: `DEFAULT_DOCKS` in the layout model; old saved layouts get new panels through `ADDED_PANELS`.
- Gotcha: a closed panel is detached from the document; find it through `layout.element(id)`, not `querySelector`.

## Configuration

- `BUDGET` (200M basic blocks) in `workspace-ui.ts`.
- `DOCK_SIZES.right` (400px), the default width of the pane.
- Bundle files: `webgpu_host.mjs`, `webgpu_bindings.generated.mjs` (optional in `scripts/sync-jai-web.ts`).

## Dependencies

- The bundle's `webgpu_host.mjs` (`createWebGPUHost({ canvas, output, onSurface })`, `host.input`, `host.resize`).
- WebGPU in workers, `OffscreenCanvas`, JSPI (Chrome/Edge 137+), `ResizeObserver` with `device-pixel-content-box`.
- `code-workspace-layout.ts` (`open`, `close`, `element`).
