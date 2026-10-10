# Blog

Blog posts are Markdown (`.md`) or MDX (`.mdx`) files in `src/content/blog/`. MDX posts can use the build-time chart components, see [blog-charts.md](./blog-charts.md). They are rendered as static pages at `/blog/[slug]`.

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

The filename becomes the URL slug (with `.md` / `.mdx` stripped). For example, `hello-world.md` → `/blog/hello-world`.

## Frontmatter fields

| Field         | Type                | Required | Description                             |
| ------------- | ------------------- | -------- | --------------------------------------- |
| `title`       | string              | yes      | Post title                              |
| `date`        | date (`YYYY-MM-DD`) | yes      | Publication date, used for sorting      |
| `description` | string              | no       | Short summary shown on the listing page |
| `tags`        | string[]            | no       | Shown in feeds, search and the markdown variant |
| `published`   | boolean             | no       | `false` makes the post a draft: shown only in `pnpm dev` (see Drafts), absent from production |

## Drafts

Set `published: false` to keep a post a draft. The rule lives in one place, `isVisiblePost(data, dev)` in `src/lib/content/posts.ts`:

- In `pnpm dev` (`import.meta.env.DEV`) drafts appear in `/blog`, at `/blog/<slug>`, in the `.md` variants and the agent JSON, marked with a **Draft** badge (`DraftBadge.astro`) on the index card and the post header, and the page has `<meta name="robots" content="noindex, nofollow">`.
- In a production build drafts are filtered at the collection level (`getBlogEntries()` passes `isVisiblePost` to `getCollection`), so nothing references them: no page, `.md`, llms.txt, sitemap, RSS or WebMCP entry, and the post's MDX module and chart data are never bundled.
- `pnpm check:drafts` (`scripts/check-drafts.ts`, run in CI after the build) fails if a draft's title, `/blog/<slug>` URL or any `draft-marker-*` token (in the post or its `data/*.json`) appears in any file under `dist/`, JS chunks included. Put a `draft-marker-<something>` token in new draft posts you care about; keep at least one draft fixture (`chart-demo.mdx`), otherwise the check fails.

## How it works

- `src/content.config.ts` defines the `blog` collection using Astro's `glob` loader (`**/*.{md,mdx}`).
- `/blog` (`src/pages/blog/index.astro`) lists all posts sorted by date descending.
- `/blog/[slug]` (`src/pages/blog/[slug].astro`) renders each post using Astro's `render()` function.

## Changing the layout

The article structure lives in `src/pages/blog/[slug].astro`. Shared rendered-Markdown typography is defined by the global `.prose` rules in `src/styles/global.css`, including headings, lists, quotes, tables, inline code, and borderless highlighted code blocks. Level-two headings cycle through a fixed square, circle, triangle, and quarter-round marker sequence using the Bauhaus palette. `BlogToc.astro` owns the table-of-contents markup, while `src/lib/blog-toc.ts` owns its behavior: the progress rule measures movement through the article body, and every section intersecting the viewport changes to bold ink while retaining the same line height. The controller is imported by the shared layout so its `astro:page-load` listener exists before client-side navigation begins. It cleans up the previous page's listeners on every route and remains hidden at the existing small-screen breakpoint. The index and article reuse the site-wide editorial patterns documented in [site-design.md](./site-design.md).

The desktop table of contents is rendered by `src/components/BlogToc.astro` and controlled by `src/lib/blog-toc.ts`. It sticks to the viewport while the article scrolls and is hidden when the article switches to its single-column layout. It does not create an independent scrolling container.

## Dependencies

- Astro content collections (`astro:content`)
- `src/layouts/Layout.astro` for the page shell
- Shiki's `github-light` theme for syntax highlighting

Note: the table of contents is now `src/components/svelte/BlogToc.svelte` (`client:idle`); `src/lib/blog-toc.ts` was removed. The list is server-rendered, and the component only tracks scroll progress and the visible sections.
