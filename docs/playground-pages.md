# Full-page playgrounds

## What it is

`/playground/jai`, `/playground/quasi` and `/playground/baerscript` show the same code workspace as the Projects-page modals, filling the whole viewport: the editor, the file tree (Jai only) and the output pane. `/playground` lists all three. Each page has its own title, description and OpenGraph/Twitter tags, so a shared link previews well.

## How it works

- **One description per demo.** `src/data/code-demos.ts` (`codeDemoPages`) holds, for each demo, the route, the page title and description, the index summary and the `CodeWorkspace` props (label, starter, or Jai's `files`/release pointer). `projects.astro` mounts one `CodeDemoModal` per entry, and `src/pages/playground/[language].astro` generates one page per entry with `getStaticPaths`, so the modal and the page always show the same workspace.
- **One client registry.** `src/lib/code-demos.ts` lists each demo's initializer (`initializeJaiPlayground`, `initializeQuasiPlayground`, `initializeBaerscriptPlayground`). It also holds the shared loading-surface helpers (`setDemoLoading`, `watchDemoLoading`) and the full-screen toggle (`wireFullscreen`). `project-actions.ts` uses them for the `<dialog>`s; `src/lib/playground-page.ts` uses them for the page.
- **Page lifecycle.** `PlaygroundLayout.astro` has no site nav and no `ClientRouter`. The document does not scroll, and `.playground` is `100dvh`. `initializePlaygroundPage` initializes the demo on `[data-playground-page]` and calls `prepare()` immediately (there is no "Try in browser" click). It drives `ProjectDemoLoading` from the demo's `project-demo-*` events, focuses the editor when the demo is ready, and destroys the session on `pagehide`. Every link into or out of a playground uses `data-astro-reload` or is a plain link, so each visit starts a fresh runtime.
- **Header.** `CodeWorkspace` has `mode="modal" | "page"`:
  - In a modal, an "Open in playground" icon link (`data-code-open-page`) sits before Close.
  - On a page, Close is replaced by a back arrow to `/projects#<id>` (`data-code-back`).

  Project cards also get a `Playground` link (`ProjectCard`'s `playground` prop).

- **Escape.** There is no dialog on the page, so Escape does nothing special and stays with the editor (Vim, completion, search). The modals still prevent `cancel`.
- **Deep link.** `/playground/jai#lib/math.jai` opens that workspace file: the page sets `data-code-open` on the workspace, and `createSession` selects that file if it exists. Quasi and BaerScript have a single file and ignore the hash. After that the hash follows the file on screen: the jai navigation history pushes a browser entry per navigation, so the browser's Back and Forward move between files and definition jumps (see [Navigation history](code-workspace.md#navigation-history)).
- **Phones.** The workspace's narrow layout (below `42rem`) applies unchanged: the header, the Code/Output (and Files) tab bar, and no horizontal scroll at 375 px.

## How to change it

- **Copy and metadata:** `src/data/code-demos.ts`. Titles become `<title>` and `og:title` (with the site name appended) through `Head.astro`.
- **Adding a language:** add it to both registries. In `src/data/code-demos.ts`, add the route, copy and workspace props. In `src/lib/code-demos.ts`, add the initializer and action ID. The modal, the page, the sitemap entry and the card link then follow automatically, but the card's action still needs a branch in `projects.astro`.
- **Page chrome:** `PlaygroundLayout.astro` and the `[language].astro` styles. The loader overlay hides on `[data-playground-page][data-demo-state='ready']` (`ProjectDemoLoading.astro`).
- Keep the `data-code-*` hooks stable (tests and `modal_browser.py` use them).

## Configuration

None at runtime. Production URLs follow `site` in `astro.config.ts`: `https://matteopolak.com/playground`, `/playground/jai`, `/playground/quasi` and `/playground/baerscript`. All four are in `sitemap.xml`. The Jai page uses the release in `jai-web-release.json`. A disabled pointer shows the same "unavailable" message as the modal.

## Dependencies

- The demo runtimes: [Jai](jai-integration.md), [Quasi](quasi-web-playground.md) and [BaerScript](baerscript-web-playground.md).
- The [shared code workspace](code-workspace.md) and [demo loading surface](project-demo-modals.md).
- COOP/COEP headers from `public/_headers` (all routes) for the module workers.
