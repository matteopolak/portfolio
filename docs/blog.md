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

Blog post styles are scoped inside `src/pages/blog/[slug].astro`. The `:global()` selector is used to style rendered markdown content (`.content :global(p)`, etc.).

## Dependencies

- Astro content collections (`astro:content`)
- `src/layouts/Layout.astro` for the page shell
