# Shared code workspace

## What it is

The jai, Quasi, and BaerScript project cards open the same in-browser editor. It is a dark IDE surface with these parts:

- a header bar with the editor tools (Format for jai, Vim) on the left, aligned with the editor column, then status, Run/Stop, full screen, and close plus "Open in playground" (modal) or a back arrow (page) on the right;
- an optional file tree and open-file tabs (jai only);
- a CodeMirror editor;
- an output pane.

It is mounted in a modal on the Projects page and as a full page at `/playground/<language>` ([Full-page playgrounds](playground-pages.md)). On phones it becomes a full-screen sheet with a bottom tab bar.

## How it works

Highlighting is chosen per file: in the Jai workspace, `.jai` files use the Jai tokenizer, `.toml` files (`jaifmt.toml`) use `src/lib/toml-language.ts`, `.md` files use `src/lib/markdown-language.ts` and get a rendered preview ([Markdown preview](markdown-preview.md)), and anything else is plain text (`syntaxFor` in `src/lib/code-editor.ts`). Renaming a file to a different extension drops its saved editor state so it is re-highlighted.

`CodeDemoModal.astro` wraps `CodeWorkspace.astro` in the shared `DemoModal.astro` dialog. Every project demo, including Minecraft, therefore opens and closes with the same animation. `CodeDemoModal` takes:

- `id`: `jai`, `quasi` or `baerscript`;
- a display `label`;
- either a `starter` program or `files` (with jai's `enabled`/`revision` release pointer).

`CodeWorkspace.astro` owns the markup and styling:

- **Header bar.** Left to right (which is also the focus order): the editor tools, the status, Retry, Run/Stop, then the window buttons. See [Editor tools](#editor-tools) below for the left group; Reset layout (`data-code-reset-layout`) sits at its end. `.ide-tools` has `margin-right: auto`, so Run and the window buttons stay right-aligned when the status is hidden on phones. There is no language name or mark in it: the section's `aria-label` (`"<label> code editor"`), the modal's label and the page `<h1>` name the language instead. Quasi and BaerScript have no file names, so their editors show no file label at all. The status text (`data-code-status`) and Retry (`data-code-retry`) appear while loading or after a failure. Run (`data-code-run`) is swapped for Stop (`data-code-cancel`) while a program runs. Format (`data-code-format`, jai only) is described in [Jai formatter](jai-formatter.md). `mode="modal"` adds an "Open in playground" link (`data-code-open-page`) before Close (`data-code-close`); `mode="page"` replaces Close with a back link to `/projects#<id>` (`data-code-back`).
- **File tree** (`data-code-files-pane`). The pane header has visible New file / New folder buttons. Each row has a `⋯` menu button, so nothing depends on right-click. Right-click, arrow keys, F2 (rename) and Shift+F10 (menu) still work. The new-item input appears inline at the end of the target folder's children (like VS Code), pushing later rows down.
- **Open-file tabs** (`data-code-tabs`, jai only). A VS Code-style strip above the editor, the same 2.25rem height as the file tree's pane head. See [Open-file tabs](#open-file-tabs) below.
- **File icons** (jai only). Tree rows and tabs show a small type icon; see [File icons](#file-icons) below.
- **Editor groups** (`data-code-editors`, jai only). The editor area holds one or more editor groups (`section[data-code-group]`), each with its own tab strip, actions (`data-code-group-actions`) and editor host (`data-code-editor`). Quasi and BaerScript have a single editor host.
- **Output pane** (`CodeOutput.astro`, `data-code-output-pane`).
- **Docks.** The file tree and output pane live in docks around the editor area and can be dragged by their headers to another side; the editor area can be split into groups by dragging tabs. Every boundary has a resize handle that works with the pointer and keyboard. See [Workspace layout](workspace-layout.md).
- **Loader.** `ProjectDemoLoading` covers only the body, so close and Retry stay usable while it is shown.
- **Tab bar** (`data-pane-tab`). It is shown only at phone widths.

All colors come from `--ide-*` custom properties declared on `.ide`. Accents are derived from the site's `--red`, `--blue` and `--yellow`, so the palette generator recolors the editor as well. `src/lib/code-editor.ts` builds the CodeMirror theme and syntax highlighting from the same variables.

`src/lib/code-workspace-layout.ts` wires the shared chrome:

- the docks, editor split tree, resize handles, panel drag and drop, layout persistence and Reset layout ([Workspace layout](workspace-layout.md));
- the output collapse toggle and Clear button;
- the platform shortcut hint (⌘↵ or Ctrl↵);
- `showPane()`, which sets `data-pane` for the narrow layout.

Pressing Run switches to Output, and choosing or creating a file switches to Code. Auto-run results that arrive while another pane is visible set `data-output-unread`, which shows a dot on the Output tab.

`src/lib/code-output.ts` is the output writer used by the Quasi and BaerScript runtimes (the Jai workspace shows a terminal instead, see [Jai terminal](jai-terminal.md); its Clear button reaches it through the cancelable `code-output-clear` event). `start()` marks a run in progress and starts its timer. `write(content, kind, details)` accepts text or nodes (jai passes stderr spans), records the result and builds a summary line such as `9 ms` or `Failed · 2 ms`. Errors are tinted through `data-kind="error"` and `data-stream="stderr"`. Text with ANSI colour codes (`\x1b[...m`) is drawn as a terminal would: `src/lib/ansi.ts` parses SGR codes (`parseAnsi`, pure and tested in `tests/jai/ansi.test.ts`) into spans with `ansi-*` classes mapped to the `--ide-*` palette in `CodeOutput.astro`; such spans carry `data-ansi` and keep the default text colour where no code is set, so coloured compiler errors are not tinted red as a whole. The jai engine asks the compiler for coloured, box-drawn errors with `jai_play_set_styled(1)` when the bundle has it; older bundles give plain text, which stays tinted.

Two lifecycles plug into the same markup:

- Quasi and BaerScript use `src/lib/code-playground.ts` with a language-specific `?worker`.
- jai uses `src/lib/jai-playground.ts` and `src/lib/jai/workspace-ui.ts`. These add the virtual filesystem, the compiler worker and the language client.

Both run the starter once as soon as the runtime is ready, then auto-run 600 ms after each edit. See [Quasi](quasi-web-playground.md), [BaerScript](baerscript-web-playground.md) and [jai](jai-integration.md) for the runtime specifics.

### Editor tools

The left group in the header (`.ide-tools`, `role="group"`, "Editor tools") holds icon buttons that act on the editor, styled as `.ide-icon .ide-tool`:

- **Format** (`data-code-format`, multi-file jai only): an indent glyph (lines with a `>` marker). Its tooltip names the shortcut, rewritten per platform by `code-workspace-layout.ts` (`Format file (⇧⌥F)` on Apple platforms, `Format file (Shift+Alt+F)` elsewhere); `aria-keyshortcuts="Shift+Alt+F"`. It is shown but disabled while the formatter (`jaifmt.wasm` or the driver) loads, so the group never shifts, and is hidden only once neither turns out to be usable (`driverMissing` in `workspace-ui.ts`) or the release is disabled.
- **Reset layout** (`data-code-reset-layout`, every language, hidden on phones): a layout glyph; puts the tree back on the left and the output at the bottom, and merges editor groups into one.
- **Vim mode** (`data-code-vim`, every language): the Vim mark drawn inline as one filled path, a diamond with the slab V cut out (`fill-rule="evenodd"`, `currentColor`). `aria-pressed` carries the state; pressed adds the raised background, a 1px blue inset ring and a blue-tinted mark. `aria-label` and `title` are "Vim mode".

**Alignment.** The group starts where the editor column starts, not above the file tree. The bar's left padding is `--ide-editor-start` + `0.4rem`; while the tree is in the left dock (`data-left-dock`) that is the dock's width plus the divider (`--ide-editor-offset`, kept current by a `ResizeObserver`), so dragging the tree divider moves the tools with it. With the tree docked elsewhere the start is `0`. It is capped at `100% - 19rem`, so a very wide tree never pushes Run and the window buttons out of the bar. A `::before` rule continues the tree divider through the bar. Quasi and BaerScript (`.ide--single`) have no tree, so the start is `0`; on phones (below `42rem`) the tree is its own pane, so the start is `0` there too and the rule is hidden.

There is no overflow menu: the header has only two tools and a few window buttons, which fit at every width down to phones. Add one if more tools arrive.

**Adding a tool.** Add an `ide-icon ide-tool` button inside `.ide-tools` with an inline 20×20 SVG (stroked by default via `.ide :global(svg)`; set `fill`/`stroke` for filled marks as `.ide-tool--vim svg` does), an `aria-label`, a `title` that names any shortcut, and a `data-code-*` hook for the script.

### Open-file tabs

The Jai workspace keeps a strip of tabs for open files above each editor group. The model is `OpenTabs` in `src/lib/jai/open-tabs.ts` (no DOM, unit-tested in `tests/jai/open-tabs.test.ts`), one per group; `workspace-ui.ts` renders it (`renderTabs`) and shows the active tab (`show`). Opening, closing and the preview tab act on the active group (the one last focused).

- **Dragging.** Drag a tab along its strip to reorder it, onto another group's strip or centre to move it there, or to a group's side to split ([Workspace layout](workspace-layout.md)). Files can be dragged from the tree the same way. Escape cancels a drag.
- **Markdown preview tabs.** A `.md` file can also be open as a "Preview <name>" tab (`markdown: true` in `OpenTab`), separate from its source tab; see [Markdown preview](markdown-preview.md).

- **Opening.** Choosing a file in the tree, creating one, or going to a definition in another workspace file opens its tab after the active one, or focuses it if it is already open. The session starts with the saved layout's groups and tabs if there is one, else the starter's tabs (`main.jai`, plus a preview of `tour.md` when the release ships the language tour; see [jai](jai-integration.md)), and a deep-linked file, if any.
- **Closing.** Each tab has a × button; middle-click and Delete (on a focused tab) also close it. Closing the active tab activates its right neighbour, else its left. Closing the last tab of a group removes the group; closing the last tab of the only group hides the editor and shows an empty state (`data-code-empty`).
- **Preview tab.** A module or stdlib file reached by go to definition opens in the single preview tab: italic, with a lock icon after the name (`.ide-filetab-readonly`; the tab's `aria-label` and `title` say "read-only"). The next stdlib definition replaces it in place. Its text and editor state live in `preview` in `workspace-ui.ts`, not in the workspace.
- **Tree changes.** `changed(moves)` from the file tree renames tabs through `OpenTabs.move` and closes the tabs of deleted files with `OpenTabs.retain`.
- **Selection invariant.** `workspace.selected` is always the active file tab. While the preview tab is active, or no tab is open, it is cleared with `Workspace.deselect()`, so edits, Format, rename and diagnostics never target a file that is not on screen.
- **Editor state.** Switching tabs saves the outgoing `EditorState` in the group's `states` (keyed by path), so undo history, cursor and selection survive. A file open in two groups has a state in each; edits are mirrored between them, but undo history stays with the editor that made the edit, and a tab moved to another group keeps its cursor but not its undo history. A closed file keeps its saved state until it is deleted, so reopening it restores the cursor.
- **Keyboard and accessibility.** The strip is a `tablist`; each tab is a `role="tab"` button with `aria-selected` and a roving `tabindex`. Left/Right/Home/End move between tabs and activate them. Close buttons are `tabindex="-1"` (use Delete). Ctrl+Tab is not bound, because browsers reserve it.
- **Overflow.** The strip scrolls horizontally with a hidden scrollbar; a vertical wheel scrolls it sideways, and the active tab is kept in view, including after the strip reappears on phones (a `ResizeObserver`). On phones the tabs are taller and always show their close buttons.
- **Reset.** Closing the modal aborts the session. The saved layout keeps the groups and tabs, so the next session reopens them (minus files that no longer exist).

### Navigation history

Go Back / Go Forward over editor places, like VS Code's. The model is `NavHistory` in `src/lib/jai/nav-history.ts` (no DOM, unit-tested in `tests/jai/nav-history.test.ts`); the input mapping is `src/lib/jai/nav-input.ts` (`tests/jai/nav-input.test.ts`); `workspace-ui.ts` records and restores places. Jai workspace only: Quasi and BaerScript have one file and no go to definition, so they have no history and the side buttons keep their browser meaning there.

- **Entries.** A place is a workspace path, or a read-only preview's URI (the entry keeps the `Preview`, so its text is not fetched again), plus the editor group it was in, the selection, the line, and the scroll (`scrollSnapshot()`, with the top line as a fallback once the file has been edited). At most 50 are kept.
- **What records.** Choosing a file in the tree or a tab, creating a file, a Markdown link to a workspace file, and everything that goes through `reveal`: go to definition / type definition (F12, Cmd/Ctrl-click, also within one file), a reference, a workspace symbol, a document link, an expansion or stdlib preview. `navigation(action)` reads the place before and after `action` and calls `nav.navigate(from, to)`, which first saves `from` into the current entry (so Back returns to where the cursor last was, not where it arrived), drops forward entries, and pushes `to`. A pointer click or search match at least `JUMP_LINES` (10) lines away is recorded too (an `updateListener`; the place it left is read before the event, `settled`). Typing, arrow keys, closing a tab and small moves record nothing.
- **Coalescing.** A navigation within 400 ms of the one that reached the current entry replaces that entry, so flicking through tabs leaves one step. Navigating to the line already current adds nothing.
- **Restoring** (`restore`) focuses the entry's editor group (or the active group if that group has since closed), reopens the tab (or the preview tab) there, restores selection and scroll, and records nothing (`restoring`). Markdown preview tabs are not recorded.
- **Renames and deletes.** `changed(moves)` calls `nav.move(moves)` and `nav.retain(names)`: entries follow renamed files, entries of deleted files go and equal neighbours merge. If the current file was deleted, Back returns to the nearest earlier entry.

**Triggers.**

| Input                               | Back       | Forward        | Notes                                                                                                                                                                        |
| ----------------------------------- | ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mouse side buttons (`button` 3 / 4) | button 3   | button 4       | Anywhere in the workspace. `mousedown`, `mouseup` and `auxclick` are cancelled so the browser does not also go back; `mouseup` navigates.                                    |
| `Ctrl+-` / `Ctrl+Shift+-`           | `Ctrl+-`   | `Ctrl+Shift+-` | Every platform (VS Code's macOS binding). Matched by `event.code === 'Minus'`. On Windows/Linux this replaces the browser's zoom out while focus is in the workspace.        |
| `Alt+Left` / `Alt+Right`            | `Alt+Left` | `Alt+Right`    | Windows/Linux only (VS Code's binding there). It overrides CodeMirror's `cursorSyntaxLeft/Right`; `Shift+Alt+Arrow` still selects. On macOS `Alt+Arrow` stays word movement. |
| Browser Back / Forward              | page only  | page only      | See below.                                                                                                                                                                   |

The keys are caught in a capture listener on the workspace, ahead of CodeMirror and Vim.

**Browser history.** On the full-page playground (`/playground/jai`, no `ClientRouter`) the history is mirrored into the browser's: the session tags its starting entry with `history.replaceState({ jaiNav: { session, id } })`, each recorded navigation is a `pushState` (or `replaceState` when it coalesced) with the URL hash set to the file (`#finale/raymarch.jai`, the same form as the deep link; previews keep the previous hash), and `popstate` restores the entry with that id. So the toolbar Back button, the side buttons and the keys all walk the same list. The side buttons and keys call `history.back()`/`forward()` only while the editor history has a step that way, so they never leave the page; the toolbar Back past the first entry leaves it as usual. Entry ids only grow, so a `popstate` to an id the model dropped (deleted file, over the limit) keeps going the same way. Entries from an earlier visit (another `session`) or a hand-edited hash open the file named in the hash without recording.

The modal on the Projects page does not touch the browser history: the site's `ClientRouter` owns it there, opening the demo already replaces the URL with `#<project>/try` (no entry of its own), and entries left behind after closing would reopen the demo. Its history lives in the model only, and the side buttons and keys use it directly; at the first entry they do nothing. The toolbar Back keeps its existing meaning (the previous page). Closing the modal clears the history.

**Changing it.** Record a new kind of navigation by wrapping the code that shows the new place in `navigation(() => …)`; anything that shows a place without being a navigation must not. Limits and the coalescing window are `NavHistory` options; the jump threshold is `JUMP_LINES` in `workspace-ui.ts`. Shortcuts are `navigationKey` in `nav-input.ts`. Keep the browser-history mirror on the page only unless the Projects page router learns to ignore `jaiNav` states.

### File icons

`src/lib/jai/file-icons.ts` holds the icons as inline SVG path data (no icon library). Each type has its own glyph in the spirit of VS Code's Seti/Material themes, not a shared page outline with a badge. Glyphs sit on a 16×16 grid and render at 16px (`1rem`), so one unit is one pixel; shapes are filled where a 1.5-unit stroke would read as hairlines. `fileIconKind(name)` picks one by extension; `fileIcon(kind, className)` builds an `aria-hidden` `<svg>` with `data-icon="<kind>"`. Filled shapes set `fill="currentColor"`/`stroke="none"` on the path, which overrides the workspace's stroked-svg defaults (`.ide :global(svg)`).

| Kind                     | Used for                                         | Glyph                                                                       |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `jai`                    | `.jai`                                           | filled rounded tile with a `J` cut out (even-odd), red                      |
| `config`                 | `.toml`, `.json`, `.ini`, `.cfg`, `.yaml`/`.yml` | two slider rails with filled knobs, blue                                    |
| `markdown`               | `.md`, `.markdown`                               | the Markdown "M↓" mark in a frame                                           |
| `text`                   | `.txt`                                           | four lines, muted                                                           |
| `file`                   | anything else                                    | plain sheet with a folded corner, muted                                     |
| `folder` / `folder-open` | directories in the tree, by collapsed state      | filled folder; the open one has a dim back panel and a tilted front, yellow |
| `lock`                   | the read-only preview tab, after the name        | filled body with a stroked shackle, faint                                   |

`file-tree.ts` uses them for rows (the chevron and `⋯` icons stay local to it); `renderTabs` in `workspace-ui.ts` puts one before each tab name. The tints are `.ide :global(svg[data-icon=…])` rules in `CodeWorkspace.astro`, shared by tree and tabs; inactive tabs dim their icon. **Indentation.** File and folder icons at the same depth start in the same column, `--tree-gutter` + depth × `--tree-indent` (1.75rem + depth × 1.15rem), so a folder's children always sit a full step right of the folder's own icon; a folder's chevron hangs in the gutter to the left of its icon, and the guide line for an open folder runs under that chevron. Tree rows are `1.875rem` high with a `0.875rem` (14px) mono label (phones: `2.5rem` rows). To add a type, add a glyph and a case in `fileIconKind`, a tint rule if it needs one, and a line in `tests/jai/file-icons.test.ts` (which also checks that no glyph is drawn on top of another's outline).

### Editor extras

- **Vim mode**: the Vim button (the Vim mark) in the editor tools toggles `@replit/codemirror-vim` for every editor on the page. The choice is stored in `localStorage` (`code-editor-vim`). `code-editor.ts` keeps it in a compartment that is placed first in each state, so Vim sees keys before the default keymaps. `setState` re-applies it, because states made for other files may predate a toggle.
- **Hovers**: the Jai client asks for Markdown hovers and renders them with `marked` + DOMPurify, colouring `jai` code with the editor's highlighter (`markdownHoverContent` in `code-editor.ts`, `hover-markdown.ts`); see [Markdown hovers](jai-language-features.md). Plain-text hovers (older servers, other languages) render as highlighted code.
- **Overload hovers**: when a hover's code is several `name :: (...)` lines (a Markdown `jai` fence, or plain text), it shows an "N overloads" count and one row per overload, with a rule between rows and a hanging indent for wrapped headers.
- **Go Back / Go Forward**: the mouse side buttons, `Ctrl+-` / `Ctrl+Shift+-`, and `Alt+Left` / `Alt+Right` on Windows/Linux return through files and definition jumps; see [Navigation history](#navigation-history).
- **Go to definition**: F12, or Cmd-click (macOS) / Ctrl-click on a name; the pointer becomes a hand while the modifier is held over a name (`definitionClick` in `code-editor.ts`). A target in another workspace file opens (or focuses) that file's tab. A target in a module or the stdlib (any URI outside `file:///jai-script/`) is fetched with the compiler's non-standard `jai/source` request and shown read-only in the preview tab; hover, completion and further definitions are off there (`viewing` in `workspace-ui.ts`). Choosing a file tab or a file in the tree returns to the workspace. Stdlib targets need a compiler build with semantic definitions (jaic after 2026-10-05).
- **Format strings**: `%` specifiers in the format argument of `print`, `tprint`, `log` and the rest of that family get their own colour (`--ide-syntax-format`, violet; `\%` uses `--ide-syntax-format-percent`). Hovering anywhere on the literal lists each specifier with the argument it formats (`formatStringHover` in `code-editor.ts`), unless the language server has its own hover there. See [Format-string highlighting](jai-integration.md#format-string-highlighting).
- **Here-strings**: `#string TAG` and the closing `TAG` are both styled as directives and the body as a string (`hereTag` in `jai/language.ts`). When the terminator names a language (ignoring case), the body is highlighted as that language instead: `#string WGSL` with the small WGSL tokenizer in `jai/wgsl.ts` (comments, attributes as notes, keywords, types, numbers, declared and called functions), `#string JAI` with the Jai tokenizer itself (nested here-strings work). The tags live in `EMBEDDED_LANGUAGES` in `jai/embedded-languages.ts`; the Jai tokenizer keeps the body tokenizer's state in `JaiState.embedded` and checks each body line for the terminator before handing it over, so a WGSL comment left open cannot run past the terminator. This is the playground's subset of the convention of the compiler's VS Code extension (`EMBEDDED_LANGUAGES` in the jai repository's `editors/vscode/scripts/build-grammar.mjs`, documented in its `docs/tools/vscode-extension.md`). To add a language, write a `StreamParser` that uses the editor's style names (`keyword`, `typeName`, `number`, `comment`, `note`, `procedureName`, `variableName`, `operator`, `punctuation`), add its tags there with the same spelling as the extension's table, and add a case to `startEmbedded`, `copyEmbedded` and `embeddedToken` in `jai/language.ts`. Tests: `tests/jai/embedded-languages.test.ts`. No CodeMirror language packages are involved, so this adds nothing to load.
- **Selection**: a light blue tint (`--ide-selection`); selected code keeps its syntax colours, overriding the site-wide `::selection` ink colour in the editor theme.
- **Output transitions**: `code-output.ts` keeps the previous output dimmed for up to 300 ms after a run starts. A fast re-run fades from old to new output; a slow one switches to "Running…". Each result fades in and is scrolled to its end.

## How to change it

- **Visual design:** the `--ide-*` tokens and layout rules in `CodeWorkspace.astro`, and the output-pane styles in `CodeOutput.astro`. The tab elements are created in script, so their rules use `:global(...)` inside `.ide-filetabs`.
- **Tab behaviour:** neighbour choice, preview replacement, reordering (`place`) and rename/delete handling are in `open-tabs.ts`; extend its tests when changing them. Only the multi-file workspace renders the group head with the strip, so Quasi and BaerScript keep their layout.
- **Docking, splits and drag and drop:** see [Workspace layout](workspace-layout.md).
- **Editor appearance and behavior:** `code-editor.ts`. Keep colors as `var(--ide-…)` references so they stay in sync with the chrome.
- **Modal size, entrance/exit animation and the phone sheet:** `DemoModal.astro`. `closeAnimated` in `project-actions.ts` waits for that exit animation's `animationend`.
- **Adding a language:**
  1. Add a tokenizer and name in `code-editor.ts`.
  2. Add a worker wrapper modeled on `quasi-playground.ts`.
  3. Register it in `src/lib/code-demos.ts` (used by both the modals and the playground pages).
  4. Add its page copy, starter and workspace props to `src/data/code-demos.ts`; `projects.astro` mounts a `<CodeDemoModal>` per entry and `/playground/<id>` is generated from it.

Keep the `data-code-*` hooks stable. The jai host tests and `tests/jai/modal_browser.py` select on them.

## Configuration

There are no runtime flags. The narrow layout starts at `42rem`. Default dock sizes are `DOCK_SIZES` in `workspace-layout-model.ts` (tree 240px, output 176px); the arrangement is saved in `localStorage["code-workspace-layout:<language>"]`. `prefers-reduced-motion` removes the modal animation.

## Dependencies

CodeMirror 6 (with `@replit/codemirror-vim`), native `<dialog>`, CSS custom properties with `color-mix()`, Web Workers and WebAssembly.

## Svelte component

The workspace is `src/components/svelte/CodeWorkspace.svelte` (it replaced `CodeWorkspace.astro` and `CodeOutput.astro`). It renders the same server-side markup and `data-*` attributes (`data-code-workspace`, `data-code-language`, `data-jai-revision`, `data-pane`, ...) and owns the reactive chrome: status line, Retry, Run/Stop, the narrow-screen pane tabs and the output-unread dot. The runtimes drive that state through the `WorkspaceChrome` interface in `src/lib/workspace-chrome.ts` (`setStatus`, `setRetryVisible`, `setRun`, `setPane`, `setHandlers`, ...) instead of editing the DOM; `showPane()` and `code-output.ts` use it too. Runtimes call `whenWorkspaceMounted(panel)` first, because the dock layout moves server-rendered nodes and must not run before hydration. The platform shortcut hint and Format tooltip are set in the component. See [svelte-islands.md](./svelte-islands.md).
