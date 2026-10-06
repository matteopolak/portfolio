# Markdown preview and highlighting

## What it is

`.md` files in the Jai code workspace (the `/playground/jai` page and the jai modal on `/projects`) get a rendered preview and Markdown syntax highlighting in the editor. Quasi and BaerScript have no file workspace, so they never see a Markdown file.

- **Wide editor column** (at least `SPLIT_MIN_WIDTH`, 760px): source on the left and preview on the right by default. A three-button switch (Source / Split / Preview, icons only) sits at the right end of the open-file tab strip.
- **Narrow editor column** (phones, small laptops, a wide file tree): one pane at a time, with a labelled Source / Preview toggle in the same place. Preview is the default: a visitor opening a README on a phone wants to read it, and editing prose on a phone is rare. An empty file opens in Source, because there is nothing to preview and it needs typing.

The choice is remembered per layout in `localStorage` (`code-editor-markdown-view`, `{"wide": "split", "narrow": "preview"}`), so toggling on a phone does not undo split view on a laptop.

## How it works

| File | Role |
| --- | --- |
| `src/lib/markdown-render.ts` | Pure (no DOM, unit-tested): `renderMarkdown`, link resolution, view choice, slugs |
| `src/lib/markdown-preview.ts` | DOM: preview pane, view switch, DOMPurify, scroll sync, link clicks |
| `src/lib/markdown-preview.css` | Preview layout and prose styles, all from the `--ide-*` tokens |
| `src/lib/markdown-language.ts` | Editor highlighting for `.md` sources (`markdownSyntax`) |

`workspace-ui.ts` creates the preview with `createMarkdownPreview(panel, editor.view, { files, open }, signal)` and makes two calls: `markdown.show(path)` at the end of `show()` (every tab switch, open or close), and `markdown.changed()` in the editor's `onChange`.

**Layout.** The preview is an `<article class="md-preview">` appended inside the editor host (`[data-code-editor]`) next to CodeMirror's `.cm-editor`. The host becomes a one- or two-column grid through `data-markdown-view` (`split`, `source`, `preview`). The switch is absolutely positioned at the top right of `[data-code-main]`. `panel[data-markdown]` gives the tab strip a right margin of `--md-switch-width`, which a `ResizeObserver` keeps equal to the switch's width. Another `ResizeObserver` on the editor column re-picks the view when the width crosses the breakpoint.

**Resizing the split.** In split view a 1px `.md-divider` sits between source and preview as the grid's middle column (`minmax(0, var(--md-source)) 1px minmax(0, var(--md-preview))`). Dragging it, or pressing ←/→ while it is focused (2% a step), sets the source's share as two `fr` values on the host, so the split keeps its proportion when the window resizes. Each side keeps at least `SPLIT_MIN_PANE` (180px). Double-click resets to 50/50. The share is saved in `localStorage` (`code-editor-markdown-split`). Scroll sync re-runs when a drag ends, since the panes reflow.

**Rendering.** `marked` (GFM: tables, task lists, strikethrough, autolinks) with a custom renderer:

- Raw HTML is escaped and shown as text (block HTML as `p.md-raw`), never interpreted.
- Links go through `resolveLink(href, path, files)`. A workspace file (resolved against the `.md` file's folder; a leading `/` means the workspace root) becomes `data-md-file`, and a click opens it in a tab. `#heading` scrolls the preview. `http(s)`/`mailto` links open in a new tab with `rel="noopener noreferrer"`. A relative path that names no file is struck through, with a tooltip. Any other scheme (`javascript:`, `data:` …) is plain text.
- Only `https:` images load; workspace images can't, since the workspace holds text, so they show their alt text instead.
- Headings carry `data-anchor` (a GitHub-style slug, made unique with `-1`, `-2` …) instead of `id`, so they can't collide with ids on the page.
- Fenced `jai` and `toml` blocks are highlighted with the editor's own stream grammars via `highlightTree` and a `tagHighlighter` (`md-tok-*` classes coloured with `--ide-syntax-*`). Other languages are plain monospace.
- Tables are wrapped in a horizontal scroller (`.md-table`), so nothing widens the pane at 375px.

The HTML then goes through `DOMPurify.sanitize` as a second layer. Re-rendering is debounced by 150ms and skipped while only the source is visible.

**Scroll sync** (split view only). Each top-level block carries `data-line`, its first source line, computed from the lexer tokens' `raw` lengths. Scrolling either side finds the surrounding pair of blocks and interpolates between their line numbers and offsets. A programmatic scroll mutes the other side's handler for 120ms so the two never chase each other. The top and bottom of either pane map to the top and bottom of the other.

**Source highlighting.** `syntaxFor` in `code-editor.ts` returns `markdownSyntax` for `.md`/`.markdown` paths. That extension combines `@codemirror/lang-markdown` (GFM base, fenced `jai`/`toml` blocks parsed with the editor's grammars), its own `HighlightStyle` and `EditorView.lineWrapping`. @lezer/markdown tags every markup character (`#`, `*`, `` ` ``, `>`, `-`) as `processingInstruction`, which the editor's shared style colours as a Jai directive (red). So `markdown-language.ts` re-tags them with private tags: heading marks match the heading (accent blue), list marks use the keyword yellow, and other marks are faint. Inline code gets a raised background.

## How to change it

- **Breakpoint:** `SPLIT_MIN_WIDTH` in `markdown-render.ts`. It is the editor column's width, not the viewport's, so the modal, the page and a resized file tree all behave the same.
- **Defaults:** `markdownView()`; update `tests/jai/markdown-preview.test.ts` with it.
- **Allowed links or images:** `resolveLink` and the `image` renderer. Keep the scheme allowlist: DOMPurify would also strip `javascript:`, but the tests cover the pure layer.
- **Highlighted fence languages:** add a grammar to `languages` in `markdown-preview.ts` (preview) and to `codeLanguages` in `markdown-language.ts` (editor).
- **Rendering raw HTML:** to render a safe subset (e.g. `<kbd>`, `<details>`) instead of escaping it, change the `html` renderer and rely on DOMPurify with an explicit `ALLOWED_TAGS`. Then the "raw HTML is shown as text" test must change.
- **Styles:** `markdown-preview.css` (global, every selector scoped under `.ide`). The workspace is a dark surface on every site theme (the site itself has no dark mode), so use `--ide-*` tokens, never site colours.
- The preview and switch are created in script, so the `data-code-*` markup in `CodeWorkspace.astro` is unchanged. The hooks are `[data-code-markdown]` (the preview) and `[data-code-markdown-switch]` (its buttons carry `data-md-view`).

## Configuration

- `localStorage["code-editor-markdown-view"]`: the saved view per layout (invalid values are ignored; storage errors are caught).
- `SPLIT_MIN_WIDTH = 760` and `RENDER_DELAY = 150` (ms) are constants.

## Dependencies

- `marked` (pinned 18.0.14): Markdown lexer and renderer.
- `dompurify` (pinned 3.4.16): sanitizes the rendered HTML.
- `@codemirror/lang-markdown` (pinned 6.5.2; it pulls in `@lezer/markdown` and `@codemirror/lang-html`): source highlighting, plus list continuation on Enter.
- Internal: `jai/language.ts` and `toml-language.ts` grammars, the `--ide-*` tokens from `CodeWorkspace.astro`, and `OpenTabs`/`show()` in `jai/workspace-ui.ts` for opening linked files.
