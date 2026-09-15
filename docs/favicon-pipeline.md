# Favicon pipeline

## What it is

The favicon pipeline turns one authored SVG into every raster fallback used by the site. Generated icons are build artifacts and are not committed.

## How it works

`src/assets/favicon.svg` is the source of truth. `scripts/generate-favicons.mjs` uses Sharp to render the 32px browser icon, 180px Apple touch icon, 512px social image, root ICO fallback, and legacy WebP fallback. It compares bytes before writing so repeated runs do not touch unchanged files.

The raster imports and SVG pass through Vite with inlining disabled. Vite emits content-hashed URLs, so changing the source also changes the URL seen by mobile icon caches. The root `/favicon.ico` remains available for clients that request it implicitly.

Both `predev` and `prebuild` invoke `pnpm generate:favicons` before Astro starts. A fresh clone therefore does not need generated assets in Git.

## How to change it

Edit `src/assets/favicon.svg`, then restart `pnpm dev` or run `pnpm generate:favicons`. Change output sizes in `scripts/generate-favicons.mjs` and matching metadata in `src/components/Head.astro` together.

Do not add generated files under `src/generated/favicons/` or the generated `public/favicon.*` fallbacks to Git. If a new generated path is introduced, add it to `.gitignore`.

## Configuration

The generator has no environment variables. Output sizes, compression, and the list of fallback formats are constants in `scripts/generate-favicons.mjs`.

## Dependencies

The pipeline depends on the `sharp` development package, Astro's existing `predev` and `prebuild` lifecycle, and Vite's `?url&no-inline` asset handling.
