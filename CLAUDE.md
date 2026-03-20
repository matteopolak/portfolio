# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start dev server at localhost:4321
pnpm build      # Build production site to ./dist/
pnpm preview    # Preview the built site
pnpm resume     # Compile resume PDF using Typst
```

## Architecture

This is an Astro static site (TypeScript) for a personal portfolio with a Typst-based resume PDF.

### Data Flow

All portfolio content lives in a single `portfolio.toml` at the root. It is the source of truth for both the website and the PDF resume:

```
portfolio.toml
  → src/lib/config.ts (parsed at build time via smol-toml, exports typed config object)
  → src/components/*.astro (each section reads from config)
  → src/pages/index.astro (assembles components into the page)
  → resume/resume.typ (separate Typst file reads portfolio.toml for PDF output)
```

Individual items in `portfolio.toml` can be hidden without deletion by adding `enabled = false`.

### Key Files

- `portfolio.toml` — all portfolio data (name, contact, jobs, projects, education, skills)
- `src/lib/config.ts` — TOML parser + config exporter; filters out disabled items
- `src/types/config.ts` — TypeScript types for the config shape
- `src/lib/bold.ts` — parses `*word*` syntax into `<strong>` tags for rich text fields

### Blog

Markdown posts go in `src/content/blog/`. Frontmatter requires `title` and `date` (YYYY-MM-DD); `description` is optional. The filename becomes the slug. Posts are sorted by date descending.

### Styling

Tailwind CSS v4 + DaisyUI v5, configured via `@tailwindcss/vite` plugin in `astro.config.ts`. No separate `tailwind.config.*` file — configuration is inline.

## Docs

The `docs/` folder contains developer documentation. Keep `docs/README.md` updated as a table of contents when adding new docs.
