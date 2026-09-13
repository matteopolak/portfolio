# Blog

Blog posts are Markdown files in `src/content/blog/`. They are rendered as static pages at `/blog/[slug]`.

## Writing a post

Create a file at `src/content/blog/<slug>.md`:

```markdown
---
title: My Post Title
date: 2026-04-01
description: Optional one-line summary shown on /blog listing.
---

Post content here. Standard Markdown.
```

The filename becomes the URL slug (with `.md` stripped). For example, `hello-world.md` → `/blog/hello-world`.

## Frontmatter fields

| Field         | Type                | Required | Description                             |
| ------------- | ------------------- | -------- | --------------------------------------- |
| `title`       | string              | yes      | Post title                              |
| `date`        | date (`YYYY-MM-DD`) | yes      | Publication date, used for sorting      |
| `description` | string              | no       | Short summary shown on the listing page |

## How it works

- `src/content.config.ts` defines the `blog` collection using Astro's `glob` loader.
- `/blog` (`src/pages/blog/index.astro`) lists all posts sorted by date descending.
- `/blog/[slug]` (`src/pages/blog/[slug].astro`) renders each post using Astro's `render()` function.

## Changing the layout

The article structure lives in `src/pages/blog/[slug].astro`. Shared rendered-Markdown typography is defined by the global `.prose` rules in `src/styles/global.css`, including headings, lists, quotes, tables, inline code, and borderless highlighted code blocks. Level-two headings cycle through a fixed square, circle, triangle, and quarter-round marker sequence using the Bauhaus palette. `BlogToc.astro` owns the desktop sticky table of contents: its rule measures progress through the article body, and every section intersecting the viewport changes to ink without changing weight. It reinitializes after Astro client-side navigation and remains hidden at the existing small-screen breakpoint. The index and article reuse the site-wide editorial patterns documented in [site-design.md](./site-design.md).

The desktop table of contents is rendered by `src/components/BlogToc.astro`. It sticks to the viewport while the article scrolls and is hidden when the article switches to its single-column layout. It does not create an independent scrolling container.

## Dependencies

- Astro content collections (`astro:content`)
- `src/layouts/Layout.astro` for the page shell
- Shiki's `github-light` theme for syntax highlighting
