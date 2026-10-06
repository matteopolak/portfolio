# Shared code workspace

## What it is

The jai, Quasi, and BaerScript project cards open the same in-browser editor. It is a dark IDE surface with these parts:

- a header bar with status, Run/Stop, Format (jai), Vim, full screen, and close plus "Open in playground" (modal) or a back arrow (page);
- an optional file tree and open-file tabs (jai only);
- a CodeMirror editor;
- an output pane.

It is mounted in a modal on the Projects page and as a full page at `/playground/<language>` ([Full-page playgrounds](playground-pages.md)). On phones it becomes a full-screen sheet with a bottom tab bar.

## How it works

Highlighting is chosen per file: in the Jai workspace, `.jai` files use the Jai tokenizer, `.toml` files (`jaifmt.toml`) use `src/lib/toml-language.ts`, and anything else is plain text (`syntaxFor` in `src/lib/code-editor.ts`). Renaming a file to a different extension drops its saved editor state so it is re-highlighted.

`CodeDemoModal.astro` wraps `CodeWorkspace.astro` in the shared `DemoModal.astro` dialog. Every project demo, including Minecraft, therefore opens and closes with the same animation. `CodeDemoModal` takes:

- `id`: `jai`, `quasi` or `baerscript`;
- a display `label`;
- either a `starter` program or `files` (with jai's `enabled`/`revision` release pointer).

`CodeWorkspace.astro` owns the markup and styling:

- **Header bar.** It holds only actions, right-aligned (`justify-content: flex-end`), so it stays balanced when the status is hidden on phones. There is no language name or mark in it: the section's `aria-label` (`"<label> code editor"`), the modal's label and the page `<h1>` name the language instead. Quasi and BaerScript have no file names, so their editors show no file label at all. The status text (`data-code-status`) and Retry (`data-code-retry`) appear while loading or after a failure. Run (`data-code-run`) is swapped for Stop (`data-code-cancel`) while a program runs. Format (`data-code-format`, jai only) is described in [Jai formatter](jai-formatter.md). `mode="modal"` adds an "Open in playground" link (`data-code-open-page`) before Close (`data-code-close`); `mode="page"` replaces Close with a back link to `/projects#<id>` (`data-code-back`).
- **File tree** (`data-code-files-pane`). The pane header has visible New file / New folder buttons. Each row has a `⋯` menu button, so nothing depends on right-click. Right-click, arrow keys, F2 (rename) and Shift+F10 (menu) still work. The new-item input appears inline at the end of the target folder's children (like VS Code), pushing later rows down.
- **Open-file tabs** (`data-code-tabs`, jai only). A VS Code-style strip above the editor, the same 2.25rem height as the file tree's pane head. See [Open-file tabs](#open-file-tabs) below.
- **File icons** (jai only). Tree rows and tabs show a small type icon; see [File icons](#file-icons) below.
- **Editor host** (`data-code-editor`) and **output pane** (`CodeOutput.astro`, `data-code-output-pane`). They are separated by resize handles that work with the pointer and keyboard.
- **Loader.** `ProjectDemoLoading` covers only the body, so close and Retry stay usable while it is shown.
- **Tab bar** (`data-pane-tab`). It is shown only at phone widths.

All colors come from `--ide-*` custom properties declared on `.ide`. Accents are derived from the site's `--red`, `--blue` and `--yellow`, so the palette generator recolors the editor as well. `src/lib/code-editor.ts` builds the CodeMirror theme and syntax highlighting from the same variables.

`src/lib/code-workspace-layout.ts` wires the shared chrome:

- the resize handles (`--files-width`, `--output-height`);
- the output collapse toggle and Clear button;
- the platform shortcut hint (⌘↵ or Ctrl↵);
- `showPane()`, which sets `data-pane` for the narrow layout.

Pressing Run switches to Output, and choosing or creating a file switches to Code. Auto-run results that arrive while another pane is visible set `data-output-unread`, which shows a dot on the Output tab.

`src/lib/code-output.ts` is the single output writer used by both runtimes. `start()` marks a run in progress and starts its timer. `write(content, kind, details)` accepts text or nodes (jai passes stderr spans), records the result and builds a summary line such as `9 ms` or `Failed · 2 ms`. Errors are tinted through `data-kind="error"` and `data-stream="stderr"`.

Two lifecycles plug into the same markup:

- Quasi and BaerScript use `src/lib/code-playground.ts` with a language-specific `?worker`.
- jai uses `src/lib/jai-playground.ts` and `src/lib/jai/workspace-ui.ts`. These add the virtual filesystem, the compiler worker and the language client.

Both run the starter once as soon as the runtime is ready, then auto-run 600 ms after each edit. See [Quasi](quasi-web-playground.md), [BaerScript](baerscript-web-playground.md) and [jai](jai-integration.md) for the runtime specifics.

### Open-file tabs

The Jai workspace keeps a strip of tabs for open files above the editor. The model is `OpenTabs` in `src/lib/jai/open-tabs.ts` (no DOM, unit-tested in `tests/jai/open-tabs.test.ts`); `workspace-ui.ts` renders it (`renderTabs`) and shows the active tab (`show`).

- **Opening.** Choosing a file in the tree, creating one, or going to a definition in another workspace file opens its tab after the active one, or focuses it if it is already open. The session starts with the starter's `main.jai` (plus a deep-linked file, if any).
- **Closing.** Each tab has a × button; middle-click and Delete (on a focused tab) also close it. Closing the active tab activates its right neighbour, else its left. Closing the last tab hides the editor and shows an empty state (`data-code-empty`).
- **Preview tab.** A module or stdlib file reached by go to definition opens in the single preview tab: italic, with a lock icon after the name (`.ide-filetab-readonly`; the tab's `aria-label` and `title` say "read-only"). The next stdlib definition replaces it in place. Its text and editor state live in `preview` in `workspace-ui.ts`, not in the workspace.
- **Tree changes.** `changed(moves)` from the file tree renames tabs through `OpenTabs.move` and closes the tabs of deleted files with `OpenTabs.retain`.
- **Selection invariant.** `workspace.selected` is always the active file tab. While the preview tab is active, or no tab is open, it is cleared with `Workspace.deselect()`, so edits, Format, rename and diagnostics never target a file that is not on screen.
- **Editor state.** Switching tabs saves the outgoing `EditorState` in `states` (keyed by path), so undo history, cursor and selection survive. A closed file keeps its saved state until it is deleted, so reopening it restores the cursor.
- **Keyboard and accessibility.** The strip is a `tablist`; each tab is a `role="tab"` button with `aria-selected` and a roving `tabindex`. Left/Right/Home/End move between tabs and activate them. Close buttons are `tabindex="-1"` (use Delete). Ctrl+Tab is not bound, because browsers reserve it.
- **Overflow.** The strip scrolls horizontally with a hidden scrollbar; a vertical wheel scrolls it sideways, and the active tab is kept in view, including after the strip reappears on phones (a `ResizeObserver`). On phones the tabs are taller and always show their close buttons.
- **Reset.** Closing the modal aborts the session, which clears the tabs. The next session starts again from `main.jai`.

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

`file-tree.ts` uses them for rows (the chevron and `⋯` icons stay local to it); `renderTabs` in `workspace-ui.ts` puts one before each tab name. The tints are `.ide :global(svg[data-icon=…])` rules in `CodeWorkspace.astro`, shared by tree and tabs; inactive tabs dim their icon. Tree rows are `1.875rem` high with a `0.875rem` (14px) mono label (phones: `2.5rem` rows). To add a type, add a glyph and a case in `fileIconKind`, a tint rule if it needs one, and a line in `tests/jai/file-icons.test.ts` (which also checks that no glyph is drawn on top of another's outline).

### Editor extras

- **Vim mode**: the `Vim` button in the toolbar toggles `@replit/codemirror-vim` for every editor on the page. The choice is stored in `localStorage` (`code-editor-vim`). `code-editor.ts` keeps it in a compartment that is placed first in each state, so Vim sees keys before the default keymaps. `setState` re-applies it, because states made for other files may predate a toggle.
- **Overload hovers**: when the hover text is several `name :: (...)` lines, `hoverContent` shows an "N overloads" count and one row per overload, with a rule between rows and a hanging indent for wrapped headers.
- **Go to definition**: F12, or Cmd-click (macOS) / Ctrl-click on a name; the pointer becomes a hand while the modifier is held over a name (`definitionClick` in `code-editor.ts`). A target in another workspace file opens (or focuses) that file's tab. A target in a module or the stdlib (any URI outside `file:///jai-script/`) is fetched with the compiler's non-standard `jai/source` request and shown read-only in the preview tab; hover, completion and further definitions are off there (`viewing` in `workspace-ui.ts`). Choosing a file tab or a file in the tree returns to the workspace. Stdlib targets need a compiler build with semantic definitions (jaic after 2026-10-05).
- **Format strings**: `%` specifiers in the format argument of `print`, `tprint`, `log` and the rest of that family get their own colour (`--ide-syntax-format`, violet; `\%` uses `--ide-syntax-format-percent`). Hovering anywhere on the literal lists each specifier with the argument it formats (`formatStringHover` in `code-editor.ts`), unless the language server has its own hover there. See [Format-string highlighting](jai-integration.md#format-string-highlighting).
- **Here-strings**: `#string TAG` and the closing `TAG` are both styled as directives and the body as a string (`hereTag` in `jai/language.ts`).
- **Selection**: a light blue tint (`--ide-selection`); selected code keeps its syntax colours, overriding the site-wide `::selection` ink colour in the editor theme.
- **Output transitions**: `code-output.ts` keeps the previous output dimmed for up to 300 ms after a run starts. A fast re-run fades from old to new output; a slow one switches to "Running…". Each result fades in and is scrolled to its end.

## How to change it

- **Visual design:** the `--ide-*` tokens and layout rules in `CodeWorkspace.astro`, and the output-pane styles in `CodeOutput.astro`. The tab elements are created in script, so their rules use `:global(...)` inside `.ide-filetabs`.
- **Tab behaviour:** neighbour choice, preview replacement and rename/delete handling are in `open-tabs.ts`; extend its tests when changing them. The editor-column grid gains an `auto` row for the strip only when `files` is set (`.ide:not(.ide--single) .ide-main`), so Quasi and BaerScript keep their layout.
- **Editor appearance and behavior:** `code-editor.ts`. Keep colors as `var(--ide-…)` references so they stay in sync with the chrome.
- **Modal size, entrance/exit animation and the phone sheet:** `DemoModal.astro`. `closeAnimated` in `project-actions.ts` waits for that exit animation's `animationend`.
- **Adding a language:**
  1. Add a tokenizer and name in `code-editor.ts`.
  2. Add a worker wrapper modeled on `quasi-playground.ts`.
  3. Register it in `src/lib/code-demos.ts` (used by both the modals and the playground pages).
  4. Add its page copy, starter and workspace props to `src/data/code-demos.ts`; `projects.astro` mounts a `<CodeDemoModal>` per entry and `/playground/<id>` is generated from it.

Keep the `data-code-*` hooks stable. The jai host tests and `tests/jai/modal_browser.py` select on them.

## Configuration

There are no runtime flags. The narrow layout starts at `42rem`. The default files width and output height are the CSS fallbacks of `--files-width` (13rem) and `--output-height` (11rem). `prefers-reduced-motion` removes the modal animation.

## Dependencies

CodeMirror 6 (with `@replit/codemirror-vim`), native `<dialog>`, CSS custom properties with `color-mix()`, Web Workers and WebAssembly.
