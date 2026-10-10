# Svelte islands

## What it is

Stateful UI is written as Svelte 5 (runes) components mounted as Astro islands through `@astrojs/svelte`. Static content stays in `.astro`. The site is still a static Astro build (not SvelteKit): it relies on content collections, build-time Shiki, `build.format: 'file'`, `trailingSlash: 'never'` and `ClientRouter`.

## How it works

Components live in `src/components/svelte/`; `svelte.config.js` uses `vitePreprocess`. Everything is server-rendered into the static HTML (no `client:only` for content), then hydrated:

| Component                                       | Directive                            | Why                                                                                 |
| ----------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `PaletteButton` (in `Nav.astro`)                | `client:load` + `transition:persist` | Survives `ClientRouter`; reapplies the palette on `astro:page-load`                 |
| `BlogToc`                                       | `client:idle`                        | List is SSR'd; only scroll tracking needs JS                                        |
| `BauhausPattern` (ambient grid, `BauhausField`) | `client:idle`                        | Decorative; SSR'd empty grid, tiles appear on pointer move                          |
| `BauhausPattern` in `ProjectDemoLoading`        | none (SSR only)                      | Pure CSS animation, no JS needed                                                    |
| `CodeWorkspace` on `/playground/<id>`           | `client:load`                        | The page is the editor                                                              |
| `CodeWorkspace` in `CodeDemoModal`              | `client:idle`                        | Hydrated before the dialog opens (`client:visible` never fires for a closed dialog) |

Islands remount on `ClientRouter` navigations, so converted code does not use `astro:page-load` except where the island is persisted.

## How to change it

- **Workers stay in TS.** `new Worker(new URL('./worker.ts', import.meta.url))` and `?worker` imports live in `.ts` files (`jai/workspace-ui.ts`, `quasi-playground.ts`, `baerscript-playground.ts`), never in `.svelte`.
- **Logic covered by `node --test` stays `.ts`** (tests cannot import `.svelte` or `.svelte.ts`). That is why `workspace-chrome.ts` is a plain interface + registry, and `bauhaus-regenerate.ts` is pure.
- **Do not move server-rendered nodes before hydration.** The dock layout (`code-workspace-layout.ts`) re-parents nodes of `CodeWorkspace.svelte`; runtimes therefore call `whenWorkspaceMounted(panel)` before `initializeWorkspaceLayout`.
- `.svelte` files are checked by `svelte-check` (part of `pnpm check`) and `oxlint` (rune globals in `oxlint.config.ts`); `oxfmt` does not format them.
- Svelte prunes selectors that match no element in the template, so attributes set only by imperative code (`[aria-pressed]`, `[data-state]`) are wrapped in `:global(...)` in `CodeWorkspace.svelte`.
- Not converted: the Jai workspace UI (`jai/workspace-ui.ts`, file tree, tabs, render pane) and demo modals (`project-actions.ts`) remain imperative; their DOM is moved around by the layout engine, which does not mix with Svelte-managed nodes.

## Configuration

- `COOP: same-origin` and `COEP: require-corp` in `astro.config.ts` (dev and preview) and `public/_headers` must stay: Lodestone and Jai need `crossOriginIsolated`. Do not add cross-origin assets.
- Runtime asset paths stay root-absolute (`/jai/<sha>/...`, `/quasi/...`, `/baerscript/...`, `/lodestone/...`).
- Package versions are pinned and must be at least 14 days old; `minimumReleaseAge: 20160` in `pnpm-workspace.yaml` enforces it for transitive dependencies (pnpm >= 10.16).

## Dependencies

`svelte`, `@astrojs/svelte`, `svelte-check` (dev).
