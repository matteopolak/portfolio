# Bauhaus grid state

## What it is

The global Bauhaus field keeps one live artwork instance while the user follows internal links. Generated tiles, directional animations, and pending ambient-tile exits therefore continue naturally across Blog, Projects, résumé, and article routes.

## How it works

`Layout.astro` enables Astro's `ClientRouter`, which swaps page content without reloading the browser document. `BauhausField.astro` marks only `.latent-grid` with the stable `transition:persist="bauhaus-grid"` key. During a route swap, Astro moves that existing element into the new page rather than replacing it.

Because the SVG node and its original script closure remain alive, its generated children, generator sequence, event listeners, and timeout handles remain in memory. No state is serialized. The fixed generator-version seed is mixed with cryptographic in-memory entropy when a new document initializes, so a reload, separately opened tab, or direct navigation receives a new composition while client-side route changes retain the current one.

The placeholder elements surrounding the persisted grid are route-specific. `BauhausPattern.astro` listens for `astro:page-load` and measures the destination page's `[data-bauhaus-region]` placeholders and rendered content again. This recalculates which existing tiles are special and fully opaque without carrying stale collision decisions from the previous layout.

## How to change it

- Keep the `bauhaus-grid` persistence key stable when refactoring the field. Changing it causes Astro to replace the artwork during navigation.
- Persist `.latent-grid`, not the complete `BauhausField`. The outer field and its placeholders must come from the destination route so special regions can change.
- Keep special-region measurement attached to `astro:page-load`; initial-load-only measurement will leave client-routed pages with the previous route's opacity map.
- If the SVG dimensions or module coordinate system changes, update both the generator and placeholder-to-SVG calculations in `BauhausPattern.astro`.

## Configuration

The persistence key is the fixed string `bauhaus-grid`, while `portfolio-bauhaus-v1-page` namespaces the current generator version. There are no environment variables, storage keys, expiry settings, or cookies. Ambient tile lifetime and per-document random seed remain in memory.

## Dependencies

This behavior uses Astro's `ClientRouter` and transition persistence, plus standard browser DOM events and timers. It adds no runtime package and does not use `sessionStorage` or `localStorage`.
