# Lodestone web embed

## What it is

The Minecraft article embeds a singleplayer-only Lodestone WebAssembly build in
an isolated iframe. The game is published by a manual workflow and copied into
the static site during the next Cloudflare Pages build.

## How it works

`<lodestone-game>` in `src/content/blog/vibecoding-minecraft.md` is the durable
Markdown marker. The blog layout conditionally loads `src/lib/lodestone-game.ts`,
which displays an explicit load button and creates `/lodestone/index.html` only
after activation. Until that click, the large game bundle is not requested and
the article keeps normal keyboard, pointer, and scroll behavior.

`.github/workflows/lodestone-web.yml` checks out Lodestone, fetches its required
26.2 assets and generated block report, and runs Trunk with
`--no-default-features`. This excludes the `multiplayer` feature and its browser
relay path. Trunk's public URL is `/lodestone/`, so its generated JavaScript and
WebAssembly URLs remain inside the iframe's deployed directory. The workflow
publishes a versioned tarball and manifest on the fixed
`lodestone-web-latest` prerelease, and retains the same files as a 30-day Actions
artifact. The prerelease is public: draft releases cannot be fetched by an
unauthenticated Cloudflare build.

The workflow normally commits only `lodestone-web-release.json`. The package
`prebuild` hook runs `scripts/sync-lodestone-web.mjs`, verifies the tarball's
SHA-256 and paths, then materializes it under the ignored
`public/lodestone/` directory before Astro copies it into `dist/`. The release
pointer update uses a one-line conventional `chore:` commit so automated
deployments follow the same history format as hand-authored changes. The release
uses client-jar parts smaller than Cloudflare Pages' 25 MiB per-file limit; the
unpartitioned `client.jar` is deliberately removed after the multipart manifest
has been validated. Each part is limited to 20 MiB and named with its ordered
index plus full SHA-256 digest, so a stale CDN object cannot be mistaken for a
new release part.

## How to change it

Change presentation or focus behavior in `src/lib/lodestone-game.ts`. Keep
the game in an iframe: its fixed canvas id, full-page styles, keyboard events,
and generated JavaScript are intentionally isolated from the article.

Run the `Publish Lodestone web build` action to deploy a new revision. The
`pointer` update mode is the normal choice and triggers Cloudflare through a
small repository commit. `assets` also commits generated files under
`public/lodestone/`; use it sparingly because every binary revision permanently
grows Git history. `none` updates only the prerelease and requires a separate
Pages rebuild.

The release workflow deletes the previous release assets only after the new
bundle has built, passed confinement checks, and its repository pointer has
been pushed. A failed build or pointer update therefore leaves the currently
deployed bundle available. `none` mode retains older bundles because the site
may still point at one of them.

## Configuration

- `lodestone_ref` chooses the Lodestone branch, tag, or commit.
- `update_repository` chooses `pointer`, `assets`, or `none`.
- `include_sounds` controls whether the curated browser sound inputs are fetched.
- `LODESTONE_REPOSITORY_TOKEN` is required only when `matteopolak/lodestone` is
  private and the portfolio workflow token cannot read it.
- `lodestone-web-release.json` is generated deployment state. Keep `enabled:
  false` until the first release exists.

Cloudflare Pages should run `pnpm build` and publish `dist`. The iframe works
without cross-origin isolation today. If Lodestone adds WebAssembly threads,
the top-level site—not just iframe asset responses—will also need compatible
COOP/COEP headers.

## Dependencies

The site uses Astro, browser custom elements, WebGPU, GitHub Releases, GitHub
Actions, and Cloudflare Pages. The publisher additionally needs Rust,
`wasm32-unknown-unknown`, Trunk 0.21.14, and Java 25.
