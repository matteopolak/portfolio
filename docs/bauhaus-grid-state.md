# Bauhaus grid state

## What it is

The global Bauhaus field keeps one live artwork instance while the user follows internal links. Generated tiles, directional animations, and pending ambient-tile exits therefore continue naturally across Blog, Projects, résumé, and article routes.

## How it works

`Layout.astro` enables Astro's `ClientRouter`, which swaps page content without reloading the browser document. Internal route links set `data-astro-history="push"` so each route swap creates an explicit browser-history entry. `BauhausField.astro` marks only `.latent-grid` with the stable `transition:persist="bauhaus-grid"` key. During a route swap, Astro moves that existing element into the new page rather than replacing it.

Because the SVG node and its original script closure remain alive, its generated children, generator sequence, event listeners, and timeout handles remain in memory. No state is serialized. The fixed generator-version seed is mixed with cryptographic in-memory entropy when a new document initializes, so a reload, separately opened tab, or direct navigation receives a new composition while client-side route changes retain the current one.

The placeholder elements surrounding the persisted grid are route-specific. `BauhausPattern.astro` listens for `astro:page-load` and measures the destination page's `[data-bauhaus-region]` placeholders and rendered content again. This recalculates which existing tiles are special and fully opaque without carrying stale collision decisions from the previous layout.

## How to change it

- Keep the `bauhaus-grid` persistence key stable when refactoring the field. Changing it causes Astro to replace the artwork during navigation.
- Persist `.latent-grid`, not the complete `BauhausField`. The outer field and its placeholders must come from the destination route so special regions can change.
- Keep special-region measurement attached to `astro:page-load`; initial-load-only measurement will leave client-routed pages with the previous route's opacity map.
- Keep explicit push history on internal route links so Back and Forward remain deterministic across deployment environments.
- If the SVG dimensions or module coordinate system changes, update both the generator and placeholder-to-SVG calculations in `BauhausPattern.astro`.

## Configuration

The persistence key is the fixed string `bauhaus-grid`, while `portfolio-bauhaus-v1-page` namespaces the current generator version. There are no environment variables, storage keys, expiry settings, or cookies. Ambient tile lifetime and per-document random seed remain in memory.

## Dependencies

This behavior uses Astro's `ClientRouter` and transition persistence, plus standard browser DOM events and timers. It adds no runtime package and does not use `sessionStorage` or `localStorage`.

## Svelte implementation

The pattern is now `src/components/svelte/BauhausPattern.svelte` (hydrated `client:idle` inside the persisted `.latent-grid`). Tiles are `$state` regions rendered by the component; tile regeneration is the pure `src/lib/bauhaus-regenerate.ts`, and `bauhaus.ts` still generates the server-rendered shapes. The `astro:page-load` re-measurement now lives in the component's `onMount` (with cleanup). See [svelte-islands.md](./svelte-islands.md).

## Fixed cell size

The ambient page grid no longer scales with the viewport. One grid cell (the 80-unit `unit` in `BauhausPattern.svelte`) is `--bauhaus-cell` pixels (`30px`, defined on `:root` in `src/styles/global.css`, which is what the old layout produced at 1440px wide). The pattern's column and row counts change instead:

- `resizePatternToField()` measures `.bauhaus-field`, sets `columnCount = floor(width / cell) + 2` and the row count from the field height, and rewrites the `viewBox` so one cell is exactly `--bauhaus-cell` wide. It runs on mount and from the existing debounced `ResizeObserver`, and only changes state when the counts change.
- The `<svg>` gets an inline `width: calc(<cells> * var(--bauhaus-cell))`; `.latent-grid` is `width: max-content` and centred, so leftover space is split evenly on both sides and clipped by `.bauhaus-field`.
- The ambient pattern renders no shapes on the server (regions are created on pointer movement), so there is nothing to shift between SSR and hydration. The SSR `columns={50}` only seeds a 48-cell wide empty svg that is replaced on mount.
- To change the cell size, edit `--bauhaus-cell` (a media query is fine, the JS reads the computed value on each resize). `ProjectDemoLoading` uses a fixed `5.4rem` static pattern and is unaffected.
