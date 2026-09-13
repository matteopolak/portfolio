# Logo assets

## What it is

All company, social, and country marks shown beside portfolio text are vendored SVG files under `public/logos/`. The site does not make third-party image requests when rendering these marks.

## How it works

`CompanyLogo.astro` maps portfolio company names to `/logos/microsoft-ai.svg`, `/logos/shopify.svg`, `/logos/solace.svg`, and `/logos/ciena.svg`. The Microsoft AI entry also displays “within Microsoft” with `/logos/microsoft.svg`, making the parent-company relationship explicit. `GeometricMark.astro` maps the location and social labels to `/logos/canada.svg`, `/logos/github.svg`, and `/logos/linkedin.svg`. Images are decorative because adjacent text already provides the accessible name.

The Canada flag and Microsoft symbol were sourced from Wikimedia Commons. `microsoft-ai.svg` is the supplied official Microsoft AI “MAI” SVG. It has a transparent background, so the site does not add a backing shape; `CompanyLogo.astro` places it in the same square footprint as the other company marks while preserving the artwork's proportions. Shopify and Solace came from their companies' published brand/favicon assets. GitHub and LinkedIn use their standard vector marks. Ciena does not publish a separate symbol in the sources reviewed, so `ciena.svg` isolates the genuine initial `c` glyph from the red vector wordmark instead of repeating the complete company name beside the text label.

## How to change it

- Replace a file in `public/logos/` without changing its path when updating artwork in place.
- Add or rename company mappings in `src/components/CompanyLogo.astro` when `portfolio.toml` company labels change.
- Keep files as real vector SVGs without embedded raster images, scripts, external stylesheets, or remote references.
- Prefer a standalone symbol rather than a lockup containing the company name, because the plain-text name is rendered beside it.
- Preserve official colors and proportions; control displayed dimensions in the Astro component rather than rewriting source geometry.

## Configuration

There are no environment variables. Asset paths are static mappings in `CompanyLogo.astro` and `GeometricMark.astro`.

## Dependencies

The SVGs are served directly by Astro's `public/` asset handling. Corporate names and marks remain trademarks of their respective owners.
