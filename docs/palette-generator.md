# Palette generator

## What it is

The large-screen navigation includes a three-dot control that generates a new harmonious accent palette. It changes the site's three Bauhaus accent roles without altering the paper or ink colors.

## How it works

`src/lib/palette.ts` chooses from five art-directed color families: variations on vermilion/cobalt/gold, coral/teal/mustard, berry/indigo/apricot, rust/azure/citron, and brick/peacock/saffron. It avoids immediately repeating the same family and applies only a small amount of lightness, chroma, and hue variation, keeping each click fresh without producing arbitrary color-wheel combinations.

The colors are generated directly in OKLCH: two darker accents serve links and light-text surfaces, while the brighter accent supports dark text. The three color properties are registered with CSS `@property`, allowing the root palette to interpolate as one synchronized 500ms transition when it changes. The navigation M receives the same final colors directly on its SVG circles and transitions their `fill` properties separately; this avoids browser compositing bugs that can temporarily drop SVG paint while an inherited registered color is interpolating.

Each color's chroma is binary-searched down until it fits inside the sRGB gamut. Lightness is then adjusted until the relevant foreground pairing reaches at least a 4.5:1 contrast ratio. `Nav.astro` assigns the result to the root `--red`, `--blue`, and `--yellow` properties, which immediately recolors the artwork and interface.

The palette lives only in JavaScript memory. It carries across Astro client-side navigation in the current page instance and returns to the reference palette after a full reload. A regular CSS media query displays the button only when the viewport is at least `80rem` wide. The button is absolutely positioned outside the centered site shell at every size, so it never consumes navigation layout space; JavaScript is used only after a click to generate and apply colors.

## How to change it

- Add or tune the curated OKLCH anchors in `PALETTE_FAMILIES`; keep variation deliberately narrow in `vary()`.
- Adjust the shared palette transition duration in the root rule in `src/styles/global.css`.
- Keep both darker colors at readable contrast against `--paper` because they are used for links and light-text controls.
- Keep the brighter color readable against `--ink` because it is used behind dark navigation text.
- Change the visibility breakpoint or dot presentation in `Nav.astro`.
- Do not persist palettes in browser storage unless cross-reload persistence is intentionally added.

## Configuration

There are no environment variables. The generator's harmony offsets, contrast target, and display breakpoint are constants in `src/lib/palette.ts` and `src/components/Nav.astro`.

## Dependencies

The feature uses browser CSS custom properties and JavaScript only. It has no runtime package or external service dependency.
