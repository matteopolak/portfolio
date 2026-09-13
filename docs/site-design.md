# Site Design

## What it is

The website uses a light editorial Bauhaus design system shared by the portfolio, project index, blog index, and blog articles. It combines a warm paper background, geometric primary-color accents, strong typographic hierarchy, and asymmetric but readable grids.

## How it works

`src/styles/global.css` owns the shared color tokens, locally hosted Open Sans font faces, page introductions, résumé section grid, editorial list rows, and Markdown article typography. `src/layouts/Layout.astro` provides the common page width and navigation shell.

`src/lib/bauhaus.ts` is the deterministic pattern generator. Every placement is one aligned two-by-two module chosen from five primary forms: four dots, a layered quarter-circle, an open quarter-circle, two two-by-one rectangles, or a solid square. The weighted motif cycle makes dots occasional and solid squares common; stripe modules can also become solid connectors when curves on both axes require an uninterrupted neighboring edge. The hover generator uses the same weighting. There are no standalone fine-grid cells or segmented pinwheel discs. The outer module ring has a much higher chance of remaining empty, producing an irregular silhouette without changing the underlying rectangular grid. Color selection strongly rewards colors already present in neighboring modules so separate tiles join into larger visual phrases.

`BauhausPattern.astro` renders that placement data as SVG. Large patterns use a fine base grid and crop one complete base-cell ring from the SVG view box. Since every motif spans two-by-two cells, this exposes exactly half of a boundary motif; quarter-circles end abruptly instead of being compressed. A layered quarter-circle is built from three explicit pieces: a full background square, a large inverted quarter-circle, and a differently colored normal one-cell quarter-disc in the diagonal corner opposite the large piece. The open variant omits that innermost quarter. Colored geometry overlaps fractionally inside each clip to prevent hairline seams without paper-colored masking shapes. Four-dot motifs place one smaller paper or ink dot in each fine-grid cell. Only complete four-dot groups that do not touch the cropped ring can rotate; boundary motifs and every other form remain still.

On pointer-accurate devices, entering a new grid coordinate regenerates it immediately; there is no capture window, batching delay, or stagger. A short fade-and-fly animation enters by 28 pixels from the closest of four directions based on the pointer's dominant movement axis, without delaying generation. The module remembers that direction and uses it again when exiting. The replacement still evaluates the current composition's palette balance and adjacent colors before choosing a different compatible motif. Touch devices do not enable the interaction.

`BauhausField.astro` owns the site's only art grid. It breaks out of the centered content shell to span the viewport. Its canvas has a 75rem minimum width, keeping each two-by-two art module at the same roughly 50px physical size on phones, tablets, and a 1200px desktop rather than shrinking the mobile grid. The server renders only a six-row bootstrap view box; `BauhausPattern.astro` then derives the required even row count from the rendered field height and grid width. A `ResizeObserver` grows or shrinks that view box when content or route height changes, so long articles are covered without a fixed maximum-height SVG. Existing modules outside a shorter route's view box remain in memory and reappear if a later route needs those rows.

`Header.astro` and the field's section markers contribute empty elements carrying `data-bauhaus-region`; these are measurement placeholders, not separate artwork. The homepage field instantiates only its résumé-section placeholders, while non-home pages instantiate only the hero placeholder; keeping those modes exclusive prevents percentage-positioned résumé art from collapsing into headers on short pages. At the tablet breakpoint, the non-home hero placeholder moves upward and adopts the homepage art's compact nine-rem footprint so Blog and Projects artwork stays beside the page title instead of falling below or spreading behind it. At startup, after fonts and page loading settle, after the content entrance animation, and after resizing, the grid measures globally aligned cells against both the art placeholders and the actual rendered rectangles of text, inline images, and icons. A cell is marked special only when it overlaps a placeholder and clears content by a small safety margin, so responsive text wrapping cannot put full-opacity artwork behind words. If a later measurement demotes a previously special cell after text or fonts settle, it completes the existing fly-out animation before its special and visible state is removed. A deterministic boundary filter leaves some special edge cells empty so those regions retain a rugged silhouette. If pointer interaction later fills one of those empty special cells, it remains at full opacity. Every runtime module has its own exact cell clip path so stroke overscan cannot bleed into or overlap an adjacent module.

The document uses its native browser scrollbar with `scrollbar-gutter: stable`, preventing layout shifts between short and long routes on platforms with classic scrollbars. Firefox and WebKit/Blink receive lightweight native scrollbar colors and sizing; mobile browsers remain free to use their normal overlay or hidden scrollbar behavior. There is no JavaScript scrollbar layer.

Every other latent module exists only as a mathematical grid coordinate and has no initial SVG node or artwork. Crossing one with the pointer creates and regenerates that module on demand at 5% opacity; after 1.6 seconds it plays a short exit animation and disappears again. Designated placeholder cells remain persistent at 100%. This keeps the generated HTML small even though the interaction surface spans the page. It also avoids intercepting links or text selection. Because designated and interactive artwork come from the same SVG, every curve, bar, and dot shares one page-wide grid origin.

Internal links use Astro's client router, and the single `.latent-grid` element is marked with `transition:persist`. Astro therefore moves the existing live grid DOM into the next page instead of recreating it: generated motifs, animation directions, generator sequence, active timers, and recently hovered ambient cells all remain in memory. No grid state is written to browser storage. Each full document load mixes fresh entropy into the generator-version seed, producing a new composition; client-side route changes preserve that live composition. After every client-side page load, special status is recomputed from the destination page's placeholders and collision map, allowing the same artwork to carry over without retaining stale layout assumptions.

The oversized homepage name is optically aligned to the content edge with a small runtime measurement. `Header.astro` waits for the local font, reads the first line's horizontal glyph bound from `CanvasRenderingContext2D.measureText()`, and translates the heading by that side-bearing. It repeats after Astro client navigation and viewport resizing because the responsive font size can change. This deliberately handles the inline-axis gap that `text-box-trim` cannot remove; the unadjusted heading remains a readable fallback when canvas metrics are unavailable.

The GitHub and LinkedIn marks use a `1.25rem` visual height. The Canada flag uses a slightly smaller `2rem × 1rem` slot, preserving its native 2:1 proportion while sitting more quietly beside the social icons.

`GeometricMark.astro` displays the standard Canadian flag plus the actual GitHub and LinkedIn marks. `CompanyLogo.astro` uses standalone employer brandmarks beside ordinary company-name text. Every mark is a local SVG under `public/logos/`; see [logo-assets.md](./logo-assets.md) for provenance and replacement guidance. The navigation M uses a heavy clip-path silhouette containing nested, offset paper, blue, red, and yellow fields. The clip path avoids the transient disappearance that can occur when inherited OKLCH colors animate inside an SVG luminance mask. Nesting keeps every visible junction between exactly two colors. Its paper field uses an explicit SVG fill rather than relying on the component stylesheet, preventing a transient browser style replacement from falling back to SVG's default black. It sits in an ink tile; the favicon reuses the same geometry over a rounded cream background but substitutes ink for the mark's paper field so the silhouette remains legible. Adjacent navigation links use small palette-colored selection dots and gray hover states, while the résumé download is a yellow action tile.

Résumé section labels align toward a continuous vertical spine in the gutter immediately to their right. Each label has a colored node on the spine; when the rail moves to the screen's right edge on phones, the node is vertically centered from the label's actual line box rather than a fixed font offset. List markers are always filled shapes, with one consistent shape and palette color per entry.

The homepage, Blog, and Projects use `01`, `02`, and `03` index tiles respectively. Each tile sits immediately above its title at the left edge at every breakpoint, and all three use the shared responsive `--page-title-gap` token. The non-home introduction uses a responsive top margin matching the homepage hero's visual starting position, so `02` and `03` are not pulled closer to the navigation than `01`. Blog and project pages reuse the colors, shapes, typography, and numbered-list pattern. Each editorial row uses its title link as a full-card interaction target, with a shared hover response and card-level keyboard focus. At the phone breakpoint the editorial list offsets the site shell's one-rem inset on both sides, allowing card surfaces to bleed exactly to the viewport edges; the desktop hover translation is disabled there to prevent overflow. Cards always have a translucent paper surface above the art field; hover strengthens that surface and adds a restrained low-opacity ink tint, producing a neutral gray response while preventing full-opacity special cells from visually jumping in front of the card. Project Website and GitHub links remain independent targets above that stretched link and use borderless, high-contrast solid action chips. Article Markdown is styled through the global `.prose` class, while the table of contents updates its active entry and reading-progress bar with a small page script.

## How to change it

- Change the palette in the custom properties at the top of `src/styles/global.css`. Keep foreground/background pairings high contrast.
- Change shared spacing and widths in `.site-shell`, `.resume-section`, `.editorial-item`, and `.article-layout`.
- Change generator rules in `src/lib/bauhaus.ts`, SVG construction and dynamic sizing in `BauhausPattern.astro`, or cluster dimensions, density, seed namespace, and page positions in `BauhausField.astro`. Client navigation preserves a composition; a full reload deliberately generates another.
- Update employer logo mappings and display sizes in `CompanyLogo.astro`. Contact and country marks are configured in `GeometricMark.astro`.
- Article typography belongs in the global `.prose` rules; page-specific article structure belongs in `src/pages/blog/[slug].astro`. Code blocks use translucent warm paper plus restrained backdrop blur, allowing faint ambient art to remain visible without competing with syntax highlighting.

Keep interface copy in natural case. Reserve geometric color blocks for hierarchy instead of adding repeated divider rules.

## Configuration

The design has no environment variables or runtime flags. The site is intentionally light-only. The principal design tokens are:

```css
--paper: oklch(97.598% 0.02449 91.61);
--ink: oklch(20.463% 0 0);
--red: oklch(63.259% 0.24086 31.631);
--blue: oklch(56.774% 0.12194 238.83);
--yellow: oklch(83.099% 0.17046 81.363);
```

The primary colors and paper tone are sampled directly from the flat-color regions in the Bauhaus reference image, then represented in OKLCH. The ink is a neutral near-black rather than pure black. The main portfolio interface uses OKLCH consistently; standalone SVG assets and the isolated Lodestone embed shell retain their existing color values.

`prefers-reduced-motion: reduce` disables the occasional rotation of complete four-dot groups.

A generated pattern is configured directly in Astro:

```astro
<BauhausPattern columns={10} rows={8} seed="portfolio-bauhaus-v1-hero" density={0.58} />
```

Changing the seed produces another deterministic composition. Changing `density` adjusts the probability of occupied modules while retaining the deliberately sparse outer module rings.

## Dependencies

- Astro provides the static layouts, pages, and component scripts.
- The pattern generator and SVG renderer are internal modules and add no browser runtime dependency.
- Tailwind CSS and DaisyUI remain available for utility generation and baseline controls, although the visual system is primarily custom CSS.
- The Open Sans files under `resume/fonts/` are bundled locally for the website as well as the PDF résumé.
- Shiki uses its `github-light` theme for blog code blocks.
- Employer, social, and country marks are local SVG assets under `public/logos/`.
