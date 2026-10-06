# Markdown preview and highlighting

## What it is

`.md` files in the Jai code workspace (the `/playground/jai` page and the jai modal on `/projects`) get a rendered preview and Markdown syntax highlighting in the editor. Quasi and BaerScript have no file workspace, so they never see a Markdown file.

The preview works like VS Code's: it is a tab of its own ("Preview tour.md", `markdown: true` in `OpenTab`), separate from the file's source tab, so it can be dragged, split and closed like any other tab ([Workspace layout](workspace-layout.md)). A `.md` source tab has an **Open preview to the side** button at the right of its group's tab strip; a preview tab has **Open source to the side**. Both open the other view in the neighbouring group to the right (or left), splitting the group if there is none. The language tour's `tour.md` opens as a preview tab.

- **Wide screens:** source and preview are separate tabs, in one group or side by side.
- **Phones** (below `42rem`, one group visible at a time): a `.md` source tab shows a labelled Source / Preview toggle in place of the side button. Preview is the default: a visitor opening a README on a phone wants to read it, and editing prose on a phone is rare. An empty file opens in Source, because there is nothing to preview and it needs typing. The choice is stored in `localStorage` (`code-editor-markdown-view`: `"source"` or `"preview"`).

## How it works

| File | Role |
| --- | --- |
| `src/lib/markdown-render.ts` | Pure (no DOM, unit-tested): `renderMarkdown`, link resolution, the phone view choice, slugs |
| `src/lib/markdown-preview.ts` | DOM: the preview element, DOMPurify, scroll sync, link clicks |
| `src/lib/markdown-preview.css` | Preview layout and prose styles, the group action buttons, all from the `--ide-*` tokens |
| `src/lib/markdown-language.ts` | Editor highlighting for `.md` sources (`markdownSyntax`) |

Every editor group in `workspace-ui.ts` owns one preview, created with `createMarkdownPreview(host, { files, text, open }, signal)`. `show(g)` calls `markdown.show(path)` with the file to render (a preview tab, or a source tab toggled to Preview on a phone) or `undefined`; edits to a `.md` file call `changed()` on every group's preview, so a preview follows its source live, whichever group is being typed in.

**Layout.** The preview is an `<article class="md-preview" data-code-markdown>` appended inside the group's editor host (`[data-code-editor]`) next to CodeMirror's `.cm-editor`. The host's `data-markdown-view` (`source` or `preview`) shows one of them. The group actions (`[data-code-group-actions]`) sit at the right of the tab strip; `.md-side` buttons are hidden on phones and the `.md-toggle` group is shown only there.

**Links.** A click on a link to another workspace file in a preview tab: another `.md` file replaces the preview in place (as VS Code's does), any other file opens beside the preview; `#heading` scrolls the preview. In a phone's toggled preview the file opens in the same group. Following a link is recorded in [Navigation history](code-workspace.md#navigation-history).

**Rendering.** `marked` (GFM: tables, task lists, strikethrough, autolinks) with a custom renderer:

- Raw HTML is escaped and shown as text (block HTML as `p.md-raw`), never interpreted.
- Links go through `resolveLink(href, path, files)`. A workspace file (resolved against the `.md` file's folder; a leading `/` means the workspace root) becomes `data-md-file`, and a click opens it in a tab. `#heading` scrolls the preview. `http(s)`/`mailto` links open in a new tab with `rel="noopener noreferrer"`. A relative path that names no file is struck through, with a tooltip. Any other scheme (`javascript:`, `data:` …) is plain text.
- Only `https:` images load; workspace images can't, since the workspace holds text, so they show their alt text instead.
- Headings carry `data-anchor` (a GitHub-style slug, made unique with `-1`, `-2` …) instead of `id`, so they can't collide with ids on the page.
- Fenced `jai` and `toml` blocks are highlighted with the editor's own stream grammars via `highlightTree` and a `tagHighlighter` (`md-tok-*` classes coloured with `--ide-syntax-*`). Other languages are plain monospace.
- Tables are wrapped in a horizontal scroller (`.md-table`), so nothing widens the pane at 375px.

The HTML then goes through `DOMPurify.sanitize` as a second layer. Re-rendering is debounced by 150ms and skipped while the preview is hidden.

**Scroll sync.** When a preview tab and its file's source are both on screen in different groups, `linkPreviews` pairs the preview with that editor (the most recently focused one if several show the file) through `markdown.link(view)`. Each top-level block carries `data-line`, its first source line, computed from the lexer tokens' `raw` lengths. Scrolling either side finds the surrounding pair of blocks and interpolates between their line numbers and offsets. A programmatic scroll mutes the other side's handler for 120ms so the two never chase each other. The top and bottom of either pane map to the top and bottom of the other.

**Source highlighting.** `syntaxFor` in `code-editor.ts` returns `markdownSyntax` for `.md`/`.markdown` paths. That extension combines `@codemirror/lang-markdown` (GFM base, fenced `jai`/`toml` blocks parsed with the editor's grammars), its own `HighlightStyle` and `EditorView.lineWrapping`. @lezer/markdown tags every markup character (`#`, `*`, `` ` ``, `>`, `-`) as `processingInstruction`, which the editor's shared style colours as a Jai directive (red). So `markdown-language.ts` re-tags them with private tags: heading marks match the heading (accent blue), list marks use the keyword yellow, and other marks are faint. Inline code gets a raised background.

## How to change it

- **Phone default:** `markdownView()` and `parseViewChoice()` in `markdown-render.ts` (the latter also accepts the old `{"narrow": …}` value); update `tests/jai/markdown-preview.test.ts` with them.
- **Side buttons and preview tabs:** `renderActions`, `openBeside` and `followLink` in `workspace-ui.ts`; tab identity (`sameTab`, `openMarkdown`) in `jai/open-tabs.ts`.
- **Allowed links or images:** `resolveLink` and the `image` renderer. Keep the scheme allowlist: DOMPurify would also strip `javascript:`, but the tests cover the pure layer.
- **Highlighted fence languages:** add a grammar to `languages` in `markdown-preview.ts` (preview) and to `codeLanguages` in `markdown-language.ts` (editor).
- **Rendering raw HTML:** to render a safe subset (e.g. `<kbd>`, `<details>`) instead of escaping it, change the `html` renderer and rely on DOMPurify with an explicit `ALLOWED_TAGS`. Then the "raw HTML is shown as text" test must change.
- **Styles:** `markdown-preview.css` (global, every selector scoped under `.ide`). The workspace is a dark surface on every site theme (the site itself has no dark mode), so use `--ide-*` tokens, never site colours.
- The preview and actions are created in script. The hooks are `[data-code-markdown]` (the preview), `[data-code-open-preview]` (Open preview to the side) and the phone toggle's buttons (`data-md-view`).

## Configuration

- `localStorage["code-editor-markdown-view"]`: the phone Source / Preview choice (invalid values are ignored; storage errors are caught). Which preview tabs are open, and where, is part of the saved [workspace layout](workspace-layout.md).
- `RENDER_DELAY = 150` (ms) is a constant.

## Dependencies

- `marked` (pinned 18.0.14): Markdown lexer and renderer.
- `dompurify` (pinned 3.4.16): sanitizes the rendered HTML.
- `@codemirror/lang-markdown` (pinned 6.5.2; it pulls in `@lezer/markdown` and `@codemirror/lang-html`): source highlighting, plus list continuation on Enter.
- Internal: `jai/language.ts` and `toml-language.ts` grammars, the `--ide-*` tokens from `CodeWorkspace.astro`, and `OpenTabs`/`show()` in `jai/workspace-ui.ts` for opening linked files.
