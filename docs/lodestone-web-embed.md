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
uploads both files unchanged. The manifest records the source commit, hashed
ESM entrypoint, archive digest and size, and every member's digest and size.

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

`src/lib/lodestone-game.ts` reads the staged manifest and downloads the filtered
resource pack and block report in parallel. The buffers are assembled through
`Blob` rather than a large JavaScript copy loop, and progress DOM writes are
limited to one animation frame. It sizes a fresh HTML canvas, transfers its
`OffscreenCanvas` plus both asset buffers to the package's canonical
`lodestone-render-worker.js`, and then relinquishes those transferable objects.
The worker initializes wasm-bindgen and calls
`mount({ canvas, clientJar, blocksJson, onProgress, onHostAction })`, keeping
Wasm compilation, resource installation, renderer initialization, simulation,
and rendering away from the page's main thread.

The portfolio owns the loading surface, fullscreen controls, and canvas; the SDK
supplies structured lifecycle events and never inserts its own iframe, loader,
CSS, or service worker. The loading surface stops accepting pointer input as
soon as the SDK reports `started`, then fades away after `first-frame`. The
current SDK can conservatively emit `first-frame-timeout` after an interactive
WebGPU frame is already visible, so that fallback also releases the overlay;
explicit worker errors remain visible.

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
worker, filtered render resource pack, and generated block report; optional
title panorama, sound assets, standalone page, diagnostics, and consumer
presentation are excluded.
