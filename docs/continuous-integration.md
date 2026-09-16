# Continuous integration

## What it is

`.github/workflows/ci.yml` is the repository's required-quality workflow. It checks every pushed commit and pull request, and it can also be run manually from GitHub Actions.

## How it works

The workflow runs one read-only Ubuntu job with Node.js 24, pnpm 10.32.1, and Typst. It installs the exact dependency versions from `pnpm-lock.yaml`, then checks formatting, lint rules, the résumé test suite, and the complete static Astro production build. `actions/setup-node` keys its pnpm-store cache from `pnpm-lock.yaml`, and a newer run on the same ref cancels an obsolete in-progress run.

The production build also exercises the prerendered pages, sitemap and robots endpoints, and the release-backed Lodestone, Quasi, and BaerScript asset synchronization used by `prebuild`.

## How to change it

Add repository-wide checks as named steps in `.github/workflows/ci.yml`. Prefer invoking package scripts instead of duplicating commands in YAML so local and CI validation remain identical. If a new test family is added, expose it as a package script and call it before the production build.

Keep the Node version compatible with the `engines` range in `package.json`, and keep the pnpm version aligned with the other publishing workflows. The workflow uses the latest stable major versions available when it was added: `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, and `typst-community/setup-typst@v5`. Update action major versions deliberately and rerun the workflow after changing them.

The résumé and browser-asset publishing workflows use the same current action majors. Release bundles are retained with `actions/upload-artifact@v6`, whose Node.js 24 runtime avoids the deprecation warning emitted by earlier artifact action majors.

## Configuration

The workflow requires no secrets and has only read access to repository contents. It runs on all `push` and `pull_request` events; `workflow_dispatch` provides a manual retry. The job timeout is 15 minutes.

## Dependencies

The workflow uses `actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, and `typst-community/setup-typst`. The build may read public GitHub Release metadata and assets through the existing synchronization scripts.
