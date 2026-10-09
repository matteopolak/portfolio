# Jai Render tab (WebGPU programs)

## What it is

Jai programs that draw with WebGPU (`#import "WebGPU"`, or `"Extensions/WebGPU"`) show their frames in the **Render** tab, an editor tab like `main.jai`: it can be dragged between groups, split off, closed and reopened. The tab forwards keyboard, mouse and size changes to the program, and explains itself when the browser cannot draw.

## How it works

| File | Role |
| --- | --- |
| `src/lib/jai/render-pane.ts` | The tab's contents: canvas per execution worker, idle/drawing/unsupported states, resize observer, the size label |
| `src/lib/jai/workspace-ui.ts` | The tab: where it opens (`renderBeside`, `openRender`, `showRender`), moving the view into the group that shows it (`placeRenderView`) |
| `src/lib/jai/open-tabs.ts` | View tabs (`OpenTab.view`, `openView`, `viewTab`, `VIEW_LABELS`) |
| `src/lib/workspace-layout-model.ts` | `ViewId`, saved `{ path: 'render', kind: 'view' }` tabs, `viewGroup`, dropping the old Render pane from stored layouts |
| `src/lib/jai/canvas-input.ts` | DOM events to `Canvas_Event` records (`stdlib/Input/wasm.jai`): Key_Code mapping, buttons, wheel, focus |
| `src/lib/jai/worker.ts` | Loads the bundle's `webgpu_host.mjs`, passes it to `createEngine`, forwards `output` and `surface` messages |
| `src/lib/jai/engine.ts` | `jai_host` imports (`call`, `wait` via JSPI, `output`, `error`, `now_ms`) and `playAsync` |

**A view tab.** The Render tab is an `OpenTab` with `view: 'render'` (its `path` is the view id, never a file path, so a file called `render` is a different tab). The workspace has at most one: `openView` focuses it where it is, drags move it (dropping a group's only tab on its own side does not copy it), and `parseLayout` drops later copies. File operations (`move`, `retain`, editor states, diagnostics, Format, navigation history) skip it.

**When it opens.** "Room for a split" means an editor area at least `SPLIT_MIN_WIDTH` (640px, two 320px groups) wide, outside the phone layout.

- **First visit** (no tabs restored): the starter's tabs in one group and, with room, the Render tab split off to the right (`renderBeside`); without room (and on phones) the Render tab sits behind `main.jai` in the one group. Reset layout rebuilds the same arrangement.
- **Open anywhere, it stays put.** If a Render tab is open, even behind another tab, a drawing program leaves it there: a run never rearranges the layout.
- **Closed, and the program draws** (its first `surface` of the run), `openRender` opens it where `viewPlacement` says and makes it its group's active tab, so it is visible and sized:
  - one group with room: a new group split off to the right;
  - one group without room, or 16 groups already: a tab of that group;
  - already split: a tab of the rightmost group (the topmost one at the right edge, `rightmostGroup`);
  - phones: a tab of the focused group.

  Other groups keep their active tabs, and keyboard focus stays where it was (an edit-triggered run keeps the cursor in the editor).
- **Programs that do not draw never open it**, nor does a browser that cannot draw.
- The toolbar's Render button (`[data-code-show-render]`) shows the tab where it is, or opens it in the focused group, and focuses the canvas while a program draws.

**Closing keeps the canvas.** The view element (`[data-code-render-view]`, server-rendered in `CodeWorkspace.astro`) is moved into the group whose active tab is Render, after the editor host, and back to its home in `.ide-body`, hidden, while no group shows it. The canvas inside stays with the running program, so closing the tab while a program draws neither stops the program nor takes its surface; opening the tab again (Render button, or the next run that draws) shows the same drawing. While hidden the view has no size, so the resize observer keeps the last one and the program keeps drawing at it.

**Canvas per worker.** The drawing surface is transferred to the execution worker (`transferControlToOffscreen`), so `render.canvas()` builds a new `<canvas>` inside the stable `[data-code-render]` stage for every new execution worker (boot, and after Stop or an edit terminated the previous one) and hands back the `OffscreenCanvas` for the `init` message. `render.attach(worker, capabilities)` wires input listeners with an `AbortController`; `render.stopped()` aborts them and removes the canvas. One `ResizeObserver` on the stage (device-pixel box) posts `resize` to whichever worker is current, so moving, splitting or resizing the tab reaches the program as window resizes.

**Gating.** The page sends a canvas only where `navigator.gpu`, JSPI (`WebAssembly.Suspending` + `WebAssembly.promising`) and `transferControlToOffscreen` all exist; the worker checks again before creating the host. Without a host, `createEngine` gets none, `jai_webgpu_available` answers no and programs print a skip message. The tab then says why (`renderSupport()`).

**Surface events.** The host's `onSurface({ width, height })` (on `wgpuSurfaceConfigure`) becomes a `surface` worker message; the first one of a run calls `open(explicit)` once. `onSurface(null)` or the end of the run returns to idle. Hosts from before `onSurface` (detected by its name in the host source) fall back to a regex on the sources' `#import`.

**Input.** Keys map to stdlib/Input `Key_Code` (named keys, `F1`=143.., printable keys as their upper-case character, Alt-composed characters by physical key); buttons 0/1/2 map to 1/169/170; wheel is in `WHEEL_DELTA` (120) units, positive up. While the canvas has focus, keys are `preventDefault`ed except Ctrl/Cmd shortcuts, function keys and Tab, so the page does not scroll but browser shortcuts and Run (Ctrl+Enter) still work. A run does not move focus to the canvas; clicking the canvas, the tab or the Render button does.

**Output and budget.** Programs that wait stream output after every wait (`output` messages, stderr kept marked) into the terminal ([Jai terminal](jai-terminal.md)); the final result adds only what was not streamed. Stop keeps the streamed text. The interpreter budget (`BUDGET` in `workspace-ui.ts`) refills on every wait, so for drawing programs it is a per-frame budget.

## How to change it

- Where the tab opens: `viewPlacement` and `SPLIT_MIN_WIDTH` in the layout model (unit-tested), applied by `renderBeside` (first visit, Reset layout) and `openRender` (a run draws) in `workspace-ui.ts`.
- Another non-file view: add its id to `ViewId`/`VIEWS` in the model and `VIEW_LABELS` in `open-tabs.ts`, give it an icon kind in `file-icons.ts`, and handle `tab.view === '<id>'` in `show` (what replaces the editor) and `renderActions`.
- New Key_Code: extend `KEY`/`NAMED_KEYS` in `canvas-input.ts`; `tests/jai/canvas-input.test.ts` checks `KEY` against `stdlib/Input/module.jai` when `JAI_REPO` points at a Jai checkout.
- Host API changes: `HostModule` in `worker.ts` and the `init`/`surface` messages in `lsp-types.ts`.
- Gotcha: the view element moves between groups; reach it through `renderView` in `workspace-ui.ts`, not by querying a group, and park it (`parkRenderView`) before removing a group element that may hold it.
- Gotcha: `render` (the `RenderPane`) is created after the group helpers that use it; they only run once the session is built.

## Configuration

- `BUDGET` (200M basic blocks) in `workspace-ui.ts`.
- `SPLIT_MIN_WIDTH` (640px) and `MAX_GROUPS` (16) in the layout model: a narrower editor area or a full workspace takes the Render tab as a tab instead of a split.
- Bundle files: `webgpu_host.mjs`, `webgpu_bindings.generated.mjs` (optional in `scripts/sync-jai-web.ts`).

## Dependencies

- The bundle's `webgpu_host.mjs` (`createWebGPUHost({ canvas, output, onSurface })`, `host.input`, `host.resize`).
- WebGPU in workers, `OffscreenCanvas`, JSPI (Chrome/Edge 137+), `ResizeObserver` with `device-pixel-content-box`.
- The editor groups of [workspace-layout.md](./workspace-layout.md).
