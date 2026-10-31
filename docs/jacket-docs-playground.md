# Jacket docs playground

## What it is

The Jacket playground lives at `/docs/jacket/playground`, inside the generated [Jacket API docs](jai-integration.md#api-docs-docsjacket). It is an Astro page (`src/pages/docs/jacket/playground.astro`) that copies the docs' header (logo, search, API/Tools/Playground nav, version menu, theme button, GitHub) and mounts the shared [code workspace](code-workspace.md) underneath it in `mode="docs"`. `/playground/jacket` and `/playground/jai` redirect here.

## How it works

- **Route.** `JACKET_PLAYGROUND` in `src/data/code-demos.ts` is the jai demo's `path` and `page`. `src/pages/playground/[language].astro` builds only demos under `/playground/`, so this page is the only place the jai demo gets a full page. Program links (`#code=…`) and file deep links (`#lib/math.jai`) work as before (see [Program links](jai-integration.md#program-links)).
- **Docs behaviour comes from the docs.** The page loads `/docs/jacket/assets/site.js` (the staged docs' own script) for search, the theme button and the version menu. That script finds its elements by id (`#q`, `#results`, `#ver`, `#ver-menu`, `#theme`) and reads `body[data-base]` (`/docs/jacket/`) to fetch `search-index.json` and `versions.json`. The header CSS is copied from the docs' `site.css` into the page's global styles under `--jd-*` tokens, so the page does not depend on the docs' stylesheet.
- **Theme.** The docs keep the theme in `localStorage['jacket-docs-theme']` (`system`, `light` or `dark`) and set `html[data-theme]`. An inline script in the page applies the stored value before paint, then mirrors `data-theme` to `data-ide-theme` with a `MutationObserver`, which pins the editor tokens (see [How it works](code-workspace.md#how-it-works)). With `system` the attribute is removed and the editor follows `prefers-color-scheme`.
- **Redirects.** `public/_redirects` 301s `/playground/jacket`, `/playground/jai` and their `.html` forms to `/docs/jacket/playground`; browsers keep the fragment. `src/pages/playground/jacket.astro` is a noindex `meta refresh` stub that also calls `location.replace(path + search + hash)`, for dev and `pnpm preview`, which ignore `_redirects`.
- **SEO.** The page is our own, so `check:seo` checks `dist/docs/jacket/playground.html` even though it skips the rest of `dist/docs`. Breadcrumbs (`Head.astro`) are Home › Jacket docs › Jacket playground. It has no markdown variant (`markdownPathFor` returns nothing for `/docs/`).

## How to change it

- **Header markup or styles:** `src/pages/docs/jacket/playground.astro`. Keep the element ids and class names in step with the docs generator (`jacket doc` in the Jacket repo). If the docs header changes there, copy the change here.
- **Editor look:** the `--ide-*` tokens in `CodeWorkspace.svelte`. They are shared with every other playground.
- **Gotcha:** the docs are staged at build time (`sync-jai-web.ts`). With no docs pin, `site.js` 404s: the page still works, but search, theme cycling and the version menu do nothing.
- **Gotcha:** the docs generator must not emit its own `playground.html` or `playground/` path, or the staged file and the Astro page collide in `dist/docs/jacket/`.

## Configuration

- `JACKET_PLAYGROUND` (`src/data/code-demos.ts`): the route.
- `localStorage['jacket-docs-theme']`: shared with the docs pages.
- `public/_redirects`: the old routes.

## Dependencies

- The staged Jacket docs (`public/docs/jacket/`, from the release pinned in `releases/jai-web-release.json`): `assets/site.js`, `search-index.json`, `versions.json`.
- [Code workspace](code-workspace.md) and [Jai integration](jai-integration.md).
