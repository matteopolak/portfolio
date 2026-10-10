# Continuous integration

## What it is

`.github/workflows/ci.yml` is the repository's required-quality workflow. It checks every pushed commit and pull request, and it can also be run manually from GitHub Actions.

## How it works

The workflow runs one read-only Ubuntu job with Node.js 24.21.0 (from `.node-version`), pnpm 12.7.0 (from `packageManager` in `package.json`), Python 3, and Typst 0.15.1. It installs the exact dependency versions from `pnpm-lock.yaml`, then checks formatting, lint rules, types (`pnpm check`, which runs `astro check` over every TypeScript and Astro file), the Lodestone and Jai test suites, and the complete static Astro production build. `actions/setup-node` keys its pnpm-store cache from `pnpm-lock.yaml`, and a newer run on the same ref cancels an obsolete in-progress run.

The production build also exercises the prerendered pages, sitemap and robots endpoints, and the release-backed Lodestone, Quasi, BaerScript and Jai asset synchronization used by `prebuild`.

## How to change it

Add repository-wide checks as named steps in `.github/workflows/ci.yml`. Prefer invoking package scripts instead of duplicating commands in YAML so local and CI validation remain identical. If a new test family is added, expose it as a package script and call it before the production build.

Node comes from `.node-version` (via `node-version-file`) and pnpm from the `packageManager` field, so `pnpm/action-setup` takes no `version:`. Keep the Node version within the `engines` range. Bump pnpm by editing `packageManager` (`pnpm@X.Y.Z+sha512.<hex>`, the hex is `npm view pnpm@X.Y.Z dist.integrity` converted from base64) and re-running `pnpm install`.

Every action in `.github/workflows/*.yml` is pinned to a full commit SHA with a trailing `# vX.Y.Z` comment, and tools are pinned to exact versions (Typst, wasm-pack, just, trunk, wasm-bindgen-cli, Rust, Python, Java). Choose releases at least 14 days old, matching `minimumReleaseAge`. To resolve a tag: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` and, if the object type is `tag`, dereference it with `git/tags/<sha>`. `dtolnay/rust-toolchain` has no release tags, so it is pinned to a `master` commit and the toolchain is always set through `toolchain:`.

The résumé and browser-asset publishing workflows use the same current action majors. Release bundles are retained with `actions/upload-artifact@v6`, whose Node.js 24 runtime avoids the deprecation warning emitted by earlier artifact action majors.

## Configuration

The workflow requires no secrets and has only read access to repository contents. It runs on all `push` and `pull_request` events; `workflow_dispatch` provides a manual retry. The job timeout is 15 minutes.

## Dependencies

The workflow uses `actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, and `typst-community/setup-typst`. The build may read public GitHub Release metadata and assets through the existing synchronization scripts.

The workflow also runs `pnpm check:seo` after the build (see [seo.md](./seo.md)).

## Lighthouse job

The `lighthouse` job in `ci.yml` builds the site, runs `pnpm lighthouse` (mobile and desktop presets, see [performance.md](./performance.md)) and uploads `.lighthouseci` as the `lighthouse-reports` artifact. Accessibility, SEO and best-practices scores are enforced; performance only warns.
