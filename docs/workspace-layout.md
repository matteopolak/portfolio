# Workspace layout (docks and editor groups)

## What it is

The code workspace arranges its panels like VS Code. The file tree, the output pane and (Jai only) the Render pane are dockable panels: drag one by its header to the left, right, top or bottom of the editor area. In the Jai workspace the editor area can also be split into editor groups: drag a tab (or a file from the tree) to one side of a group to open it beside that group, or onto a tab strip to move it there. The arrangement is saved per language and survives reloads; the Reset layout button in the header restores the default.

Phones (below `42rem`) keep the one-pane-at-a-time layout with the Files / Code / Output tab bar; docks and splits are ignored there and only the active group is shown.

## How it works

| File | Role |
| --- | --- |
| `src/lib/workspace-layout-model.ts` | Pure model (no DOM, unit-tested in `tests/jai/workspace-layout.test.ts`): layout types, immutable operations, drop-zone geometry (`dropZone`, `groupDropZone`, `dockZone`, `insertionIndex`), JSON validation |
| `src/lib/code-workspace-layout.ts` | DOM controller: renders docks and the split tree, dividers, panel drag, `trackDrag`, persistence, Reset layout |
| `src/lib/jai/workspace-ui.ts` | Editor groups: one CodeMirror editor and tab strip per group, tab/tree drag and drop, keeping groups in sync |
| `src/components/CodeWorkspace.astro` | Markup (`[data-code-layout]`, docks, `[data-code-editors]`, the template group) and the global layout styles |

**Model.** A `WorkspaceLayout` is `{ version: 1, docks, closed, editors }`.

- `docks.left|right|top|bottom` is `{ size, panels, shares }`: its size in px, the panels it holds in order (`files`, `output`, `render`), and each panel's share (parallel to `panels`). Open panels split the dock in proportion to their shares; `resizeDockPanels` moves the split between two neighbours.
- `closed` lists closable panels (`CLOSABLE_PANELS`: `render`) that keep their dock but are not shown. `openPanel`/`closePanel` toggle it; `openPanels(layout, dock)` gives what to render. The Render pane starts closed on the right and opens when a program draws ([jai-render-pane.md](./jai-render-pane.md)); its head has a close button (`[data-panel-close]`).
- `editors` is a tree: a `GroupNode` (`{ type: 'group', id: 'g1', tabs, active }`, each tab `{ path, kind: 'file' | 'markdown' }`) or a `SplitNode` (`{ type: 'split', direction: 'row' | 'column', children, sizes }`, sizes summing to 1).

Operations return new objects: `movePanel`, `resizeDock`, `splitGroup` (a split in the parent's direction adds a sibling and halves the target's share; the other direction nests), `removeGroup` (siblings take its share in proportion; one-child splits collapse and same-direction splits flatten), `resizeSplit`, `neighbourGroup`. `dropZone` picks `left/right/top/bottom` in a group's outer thirds (the nearer edge wins in corners), else `center`; `dockZone` picks left/right in the body's outer quarters, else top or bottom.

**DOM.** `.ide-layout` is a row: `[left dock, divider] .ide-center [divider, right dock]`; `.ide-center` is a column with the top dock, `.ide-editors` and the bottom dock. The controller moves the existing panel elements (`[data-code-files-pane]`, `[data-code-output-pane]`) into dock elements, so their listeners and state survive. Empty docks are not rendered. The split tree becomes nested `.ide-split[data-direction]` flex containers with a `.ide-divider` between children, whose children are the group elements `workspace-ui.ts` hands over through `controller.setEditors(tree, elements)`.

**Dividers.** One `divider()` for docks, the two-panel ratio and splits: pointer drag with pointer capture, arrow keys (16px a step), `role="separator"` with `aria-valuenow/min/max`. Dock dividers carry `data-code-resize="<dock>"`. Minimums: 72px (120px for a group's width in a row split, 140px for a side dock).

**Dragging.** `trackDrag(event, { label, resolve, drop })` is shared by panels, tabs and tree files. It starts after the pointer travels 5px (`DRAG_THRESHOLD`), so clicks stay clicks; shows a label under the pointer and the `.ide-drop` overlay at the rectangle `resolve` returns (with `data-insert` for a tab-strip insertion bar); Escape cancels (captured before CodeMirror and Vim), as does the window losing focus or a `pointercancel`; the click after a drag is swallowed. While a press is tracked, native `dragstart` and `selectstart` are prevented so the browser cannot take the pointer over. Gotcha: `blur` does not bubble, but a capturing listener on `window` still receives every element's blur, so the cancel checks `event.target === window`; otherwise pressing a focusable row (a tree file, which takes focus from the editor on mousedown) cancelled the drag before it began. Panels drag by `[data-panel-handle]` (the pane heads); buttons inside the head still click.

**Editor groups** (Jai only). Each group is a clone of the server-rendered template `section[data-code-group]` (so Astro's scoped styles still match) with its own `OpenTabs`, CodeMirror editor, saved `EditorState`s and Markdown preview element (the read-only stdlib preview tab is shared and shown in one group at a time). The active group is the one last focused or clicked; `activateGroup` re-points `group`, `editor` and `tabs`, so the rest of `workspace-ui.ts` (navigation history, Format, diagnostics, Run) works on whatever group is active. Rules worth knowing:

- **One file, many groups.** The workspace text is the source of truth. An edit in one editor is mirrored to every other editor and saved state showing that file as a minimal change, annotated `mirrored` and kept out of their undo history. Editors never share `EditorState` objects (a state carries its editor's extensions), so moving or copying a tab builds a fresh state with the same selection (`adopt`).
- **Drops.** On a group's side: split it and open the tab in the new group (moved; copied when it is the source group's only tab and dropped on its own side). In the centre or on a strip: move the tab there (insertion point from `insertionIndex`). A group with no tabs, or a workspace already at `MAX_GROUPS`, only takes centre drops (`groupDropZone`). A tree file row (`[data-tree-kind="file"]` in `[data-code-files]`) drags the same way: on a strip it opens at the insertion point, in the centre or an empty group it opens there, on a side it opens in a new split. A plain click still opens it, and the tree's own menu and rename keys are untouched. The listener is on the tree element, which the layout moves between docks without recreating, so dragging works wherever the Files panel is docked. Closing a group's last tab removes the group.
- **Language features** (diagnostics, hover, completion, lint, format, go to definition) run in every group's editor; published diagnostics are applied to every group that shows the file.
- **Reset layout** merges every group's tabs into one group.

**Persistence.** `localStorage["code-workspace-layout:<language>"]` holds `serializeLayout(layout)`, written 250ms after a change and when the session ends. `parseLayout(text, panels)` reads older layouts too: a two-panel `ratio` becomes `shares`, and a panel of `ADDED_PANELS` (`render`) missing from a saved layout is added at its default dock, closed. It rejects anything else malformed (wrong version, missing or duplicate panels, bad sizes, unknown node types, duplicate group ids, more than 16 groups or 8 levels) so a bad value falls back to the default; duplicate tabs and an out-of-range active index are repaired. Storage errors are caught. On startup the Jai workspace reopens the saved groups and tabs, dropping tabs of files that no longer exist and groups left empty.

**Header alignment.** The editor tools align with the editor column: the controller writes the left dock's width to `--ide-editor-offset` (a `ResizeObserver`) and sets `data-left-dock` on the section only while the left dock is shown.

**Output collapse.** The output's collapse toggle is shown only while the output is alone in the top or bottom dock; collapsed, that dock shrinks to the pane head.

**Phones.** Under `NARROW_QUERY` the layout, dock, editors and split containers are `display: contents`, every pane sits in grid area 1/1, and `data-pane` (Files / Code / Output / Render, the last shown only while the Render pane is open) picks one; only `.ide-group[data-active]` is shown. Panel and tab dragging is off.

## How to change it

- **New layout operation:** add it to `workspace-layout-model.ts` with a test; keep it immutable and call `normalize` on trees you build.
- **Stored shape changes:** bump `version` (old values then fall back to the default) or extend `parseLayout` to accept both.
- **A new dockable panel:** add its id to `PanelId`, `PANELS` and `DEFAULT_DOCKS` (and to `ADDED_PANELS` so saved layouts keep loading, `CLOSABLE_PANELS` if it can close), give its head `data-panel-handle`, and register its element in `initializeWorkspaceLayout`.
- **Drop behaviour:** zone geometry is in the model (`dropZone`, `dockZone`); what a drop does is `dropTab` in `workspace-ui.ts` and the panel `drop` in `code-workspace-layout.ts`.
- **Styles:** layout, dock, split, divider and drop-overlay rules are in the `<style is:global>` block at the end of `CodeWorkspace.astro`, anchored at `.ide`, because those elements are created in script. Use `--ide-*` tokens; the drop highlight uses `--blue`.
- Code that needs the current editor should go through `editor`/`group` after `activateGroup`, not cache a view.

## Configuration

- `localStorage["code-workspace-layout:jai" | ":quasi" | ":baerscript"]`: the saved layout.
- `DOCK_SIZES` (default dock sizes), `MAX_GROUPS` (16), `MAX_DEPTH` (8), `MAX_TABS` (64) in the model; `DRAG_THRESHOLD` (5px), `SAVE_DELAY` (250ms) and `NARROW_QUERY` in the controller.

## Dependencies

- Internal: `OpenTabs` (`jai/open-tabs.ts`), `createCodeEditor` (`code-editor.ts`), `createMarkdownPreview` (`markdown-preview.ts`), the file tree (`jai/file-tree.ts`).
- CodeMirror 6 (`Annotation`, `Transaction.addToHistory`), Pointer Events with pointer capture, `ResizeObserver`, `matchMedia`.
