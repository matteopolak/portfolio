# Lodestone web embed

## What it is

The Minecraft project action and related blog post mount Lodestone's WebGPU
runtime directly into a portfolio-owned canvas. Lodestone is shipped as its
canonical, versioned WebAssembly SDK through a GitHub Release and copied into
the static site at build time.

## How it works

`.github/workflows/lodestone-web.yml` checks out the selected Lodestone commit,
populates its Minecraft 26.2 build cache, installs the `wasm-bindgen` CLI version
matching Lodestone's locked Rust crate, and runs `just wasm-sdk`. That command is
Lodestone's canonical packaging recipe and emits
`lodestone-web-sdk.tar.gz` plus `lodestone-web-sdk.manifest.json`; the portfolio
uploads both files unchanged. The schema-v2 manifest records the source commit,
content-versioned ESM and render-worker entrypoints, archive digest and size,
and every member's digest and size. Both validators require
`lodestone-resources.zip` and `blocks.json`; `client.jar` and separate
`panorama_*.png` files are obsolete and rejected.

The workflow writes a small `lodestone-web-release.json` deployment pointer.
`scripts/sync-lodestone-web.mjs` first verifies the pointer-pinned manifest,
then verifies the archive against that manifest, validates its path inventory,
and verifies every extracted member. It copies the manifest and archive members
to ignored `public/lodestone/` output. `pnpm dev` and `pnpm build` both run this
sync, so Vite development and the fully static production build consume the
same release.

Release downloads retry transient HTTP and network failures with bounded
exponential backoff. Permanent HTTP errors still fail immediately, and a retry
never weakens the manifest, archive, or per-file digest checks.

`src/lib/lodestone-game.ts` reads the staged manifest with `cache: 'no-store'`,
creates the manifest's content-versioned render worker, and transfers a freshly
sized `OffscreenCanvas` with the same manifest object. The worker verifies its
own filename against `worker_entrypoint`, imports the matching versioned ESM,
derives its matching Wasm URL, and fetches the packaged assets. Keeping the
module, Wasm, and worker cache keys on one release prevents older glue from
instantiating a newer Wasm binary after an SDK update.

The worker initializes wasm-bindgen and calls
`mount({ canvas, assetProvider, onProgress, onHostAction })`, keeping asset
installation, Wasm compilation, renderer initialization, simulation, and
rendering away from the page's main thread. Stable worker/module aliases are
deliberately absent from schema-v2 bundles.

The portfolio owns the shared project-modal loading surface, fullscreen
controls, and canvas; the SDK supplies structured lifecycle events and never
inserts its own iframe, loader, CSS, or service worker. Lodestone maps those
events onto one aggregate modal progress value rather than rendering its old
multi-stage loader. The surface fades away only after `first-frame`, which the
worker SDK emits from the actual presentation path. A `first-frame-timeout`
remains visible as an actionable renderer failure.

The element also forwards each complete SDK payload as a bubbling, composed
`lodestone-progress` CustomEvent. Its `detail` preserves `type`, `phase`,
`fraction`, `message`, asset fields, and optional world-loading counters:
`elapsedMs`, `loadedColumns`, `expectedColumns`, `settledColumns`,
`presentedColumns`, `pendingColumns`, `pendingRemovals`, `pendingMeshes`, and
`pendingLightRemeshes`. `settledColumns` counts columns whose every section has
its latest renderer handoff or an explicit empty result. `presentedColumns`
tracks first presentation and can retain earlier geometry during replacement.
`pendingColumns` counts ready and forced column work; `pendingRemovals` counts
renderer removals awaiting handoff. `pendingMeshes` counts scheduler work and
ready results; lighting intents awaiting admission stay in `pendingLightRemeshes`.
`full-view-presented` can arrive while remesh work remains;
`full-view-quiescent` requires latest requested-view coverage and all four queues
drained.
These events describe world-loading diagnostics and do not reveal the canvas,
reset the shared modal loader, or gate keyboard/pointer input. Readiness remains
worker-ready plus `first-frame`.

For example, observe the independent queue counts from the host:

```js
document.addEventListener('lodestone-progress', (event) => {
  const { phase, pendingMeshes, pendingLightRemeshes } = event.detail;
  console.debug(phase, { pendingMeshes, pendingLightRemeshes });
});
```

The render worker retains the SDK handle for exactly one mounted custom element.
Closing the project modal, navigating away, or otherwise disconnecting the
element aborts unfinished downloads, sends the worker an idempotent `destroy`
request, disconnects the page's resize and input bridges, and terminates the
worker. A transferred canvas cannot be reused, so retries and remounts replace
it with a fresh canvas before starting a fresh worker.

The page forwards pointer position and motion, mouse buttons, wheel input,
keyboard state, focus, backing-size changes, and actual pointer-lock state to
the worker. Lodestone requests pointer lock through `onHostAction`; the page
performs the user-gesture-gated DOM operation and reports the resulting state
back to the worker.

The canvas sits inside `<lodestone-game>`'s shadow root. Check
`shadowRoot.pointerLockElement` when deciding whether that canvas is locked:
`document.pointerLockElement` is retargeted to the custom-element host. Menu
hover uses absolute `pointermove` coordinates while unlocked; camera look uses
relative `mousemove` deltas while locked. The worker ignores camera deltas until
the actual lock state has been reported, so both the root check and event type
matter when changing mouse input.

Pointer positions are converted from CSS coordinates to canvas backing pixels
before reaching Lodestone's physical-position input API. Preserve this mapping
when changing canvas sizing or input handling; it lets menu controls line up
with the pointer on high-density displays and after modal resizing.

Fullscreen is portfolio-owned. Chromium's Keyboard Lock API is requested for
Escape when available so inventory interactions do not immediately collapse
fullscreen; the overlay explains the browser's hold-Escape exit gesture.

## How to change it

Change loader styling, progress wording, the input bridge, focus, or fullscreen
behavior in `src/lib/lodestone-game.ts`. Keep SDK API changes in Lodestone's
`web/src/embed.rs`, then republish via the workflow rather than patching emitted
JavaScript or renaming archive members. The sync script deliberately rejects a
dirty SDK package, unexpected schema, changed inventory, unsafe path, mismatched
commit, or failed digest. Adjust `downloadAttempts` in
`scripts/sync-lodestone-web.mjs` only if GitHub Releases needs a different retry
budget.

Run `pnpm test:lodestone` for positive and negative manifest controls covering
both the build-time and browser validators, plus progress forwarding and
readiness controls. Add new world-loading fields to `LodestoneProgressEvent`
without mapping them onto the modal readiness gate.

Run `Publish Lodestone web SDK` with `update_repository: pointer` for normal
deployment. `assets` also commits the generated `public/lodestone/` directory
and should be used only when release downloads are unavailable during the site
build. `none` publishes the release without moving the website pointer. Old
release assets are removed only after the new pointer/build step succeeds.

## Configuration

- `lodestone_ref` selects the Lodestone branch, tag, or commit.
- `update_repository` selects `pointer`, `assets`, or `none`.
- `LODESTONE_REPOSITORY_TOKEN` lets Actions read a private Lodestone repository.
- `lodestone-web-release.json` pins the release manifest digest and source
  commit. `enabled: false` intentionally skips sync before the first canonical
  SDK release is published.
- Cloudflare Pages should run `pnpm build` and publish `dist/`.
- COOP `same-origin` and COEP `require-corp` response headers enable Lodestone's
  threaded worker path. `public/_headers` configures the static deployment, and
  `astro.config.ts` applies the same headers to local development and preview.
  Without cross-origin isolation, its packaged serial worker fallback remains
  available.

## Dependencies

The embed uses Astro, WebGPU, `OffscreenCanvas`, Web Workers, GitHub Releases,
GitHub Actions, Lodestone's wasm-bindgen SDK and matching CLI, Rust nightly with
`rust-src`, Trunk, Java 25, and Minecraft 26.2 build inputs. `rust-src` is
required because Lodestone's threaded Wasm worker builds its standard library
for the browser target. The SDK archive contains Lodestone's canonical render
worker, merged `lodestone-resources.zip` and generated `blocks.json` report.
The archive contains Whimscape 26.1–26.3 r2 by kavast, including its panorama
and author credit/project link in `pack.mcmeta`, plus retained non-image game
definitions. Only the 18 default player-skin textures remain from the original
pack; block/item textures have no vanilla fallback. The SDK provider maps
`resourcePack` to this archive and `blocksJson` to the report. Change the pack
in Lodestone and rebuild the SDK; never add a consumer-side vanilla fallback. Standalone pages, diagnostics, and consumer presentation are excluded.
