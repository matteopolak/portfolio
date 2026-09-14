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

`src/lib/lodestone-game.ts` reads the staged manifest and imports its hashed ESM
entrypoint with a runtime URL. It downloads the page Wasm, filtered resource
pack, and block report in parallel with streamed progress, initializes the
module, and calls `mount({ canvas, clientJar, blocksJson, onProgress })`. The
portfolio owns the loading surface, fullscreen controls, and canvas; the SDK
supplies structured lifecycle events and never inserts its own iframe, loader,
CSS, or service worker.

The SDK's returned handle is retained for exactly one mounted custom element.
Closing the project modal, navigating away, or otherwise disconnecting the
element aborts unfinished downloads and calls the idempotent `destroy()` method.
That releases Lodestone listeners, observers, workers, audio/render loops, and
its active-mount lease so the same module can be cleanly mounted again. One
initialized module keeps one immutable asset bundle, so changing SDK contents
requires loading a newly hashed entrypoint.

`destroy()` requests teardown immediately, while the structured `destroyed`
event is delayed until the old browser event loop and renderer have actually
dropped. If a new `mount()` begins during that short interval, the SDK waits for
the teardown boundary instead of racing the previous WebGPU session.

Fullscreen is portfolio-owned. Chromium's Keyboard Lock API is requested for
Escape when available so inventory interactions do not immediately collapse
fullscreen; the overlay explains the browser's hold-Escape exit gesture.

## How to change it

Change loader styling, progress wording, focus, or fullscreen behavior in
`src/lib/lodestone-game.ts`. Keep SDK API changes in Lodestone's
`web/src/embed.rs`, then republish via the workflow rather than patching emitted
JavaScript or renaming archive members. The sync script deliberately rejects a
dirty SDK package, unexpected schema, changed inventory, unsafe path, mismatched
commit, or failed digest.

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
  threaded worker path. Without cross-origin isolation, its packaged serial
  worker fallback remains available.

## Dependencies

The embed uses Astro, WebGPU, GitHub Releases, GitHub Actions, Lodestone's
wasm-bindgen SDK and matching CLI, Rust, Trunk, Java 25, and Minecraft 26.2 build
inputs. The SDK archive contains Lodestone's filtered render resource pack and
generated block report; optional title panorama, sound assets, standalone page,
diagnostics, and consumer presentation are excluded.
