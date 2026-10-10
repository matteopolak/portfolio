# Editor find / replace

## What it is

A VS Code-style find and replace widget for every CodeMirror editor (the `/playground/*` pages, the project demo modals and the Jai workspace). It replaces the default `@codemirror/search` panel, which was a full-width row under the text.

## How it works

`src/lib/editor-find-panel.ts` exports `findExtensions`, which `code-editor.ts` adds to each editor state. It calls `search({ top: true, createPanel })` with a custom `FindPanel` (plain DOM, inline Lucide SVGs), plus a keymap and a theme.

- The panel is a normal top panel, but `findPanelTheme` makes `.cm-panels-top` `position: absolute` in the editor's top-right corner, so it overlays the text. Vim's `/` and `:` prompts are bottom panels and are unaffected.
- The inputs and toggles write a `SearchQuery` with `setSearchQuery`; `findNext`, `findPrevious`, `replaceNext` and `replaceAll` do the work. Typing searches live: the first match from the selection is selected without taking focus, and all matches are highlighted by CodeMirror's own `.cm-searchMatch`.
- The counter iterates `query.getCursor(state)` and stops at 1000 (`COUNT_CAP`), showing `N of 1000+`.
- Colours come from the editor's `--ide-*` tokens (the editor is always dark), the active toggle uses `--blue` and focus uses `--yellow`.

| Key                  | Action                                                            |
| -------------------- | ----------------------------------------------------------------- |
| Mod-F                | Open or focus, seeded with the selection                          |
| Mod-H, Mod-Alt-F     | Open with Replace expanded                                        |
| Enter / Shift-Enter  | Next / previous match (Enter in Replace replaces one)             |
| F3 / Shift-F3, Mod-G | Next / previous match                                             |
| Alt-C, Alt-W, Alt-R  | Toggle Match Case, Whole Word, Regex (while the widget has focus) |
| Escape               | Close and refocus the editor                                      |

## How to change it

- Layout and colours: `findPanelTheme` in `editor-find-panel.ts`. The phone layout (`max-width: 42rem`) makes it span the editor.
- Keys: `findKeymap`. Bindings use `scope: 'editor search-panel'` so they also work while the widget has focus.
- Read-only editors get no Replace row or chevron.
- Gotcha: `openFind` relies on `@codemirror/search`'s `[main-field]` lookup, so the Find input keeps the `main-field` attribute.

## Dependencies

`@codemirror/search`, `@codemirror/view`, `@codemirror/state`. Icons are inlined Lucide path data (ISC).
