# Search discovery and page metadata

## What it is

The site emits crawlable metadata, canonical URLs, social previews, structured data, `robots.txt`, and a build-generated XML sitemap. Everything is rendered into the static build, so search engines do not need client-side JavaScript to discover it.

## How it works

`src/components/Head.astro` owns page titles, descriptions, self-referencing canonical links, Open Graph and Twitter fields, and a Schema.org JSON-LD graph. The graph describes Matthew as the site publisher, normal routes as `WebPage`, and blog posts as `BlogPosting` with their publication date. `src/lib/urls.ts` removes Astro's static `.html` output filename from public canonicals so metadata and sitemap URLs stay aligned.

`src/pages/sitemap.xml.ts` is a prerendered Astro endpoint. At build time it reads the blog content collection, excludes drafts, and writes absolute canonical URLs for the home, Projects, Blog, and every published post. Blog entries use their publication date as `lastmod`; static pages omit it because the repository does not track a reliable content-modification date. The prerendered `src/pages/robots.txt.ts` route allows normal crawling and advertises the sitemap using the same configured production origin.

## How to change it

- Add a new indexable static route to the `entries` array in `src/pages/sitemap.xml.ts`.
- Keep blog posts in `src/content/blog`; published posts enter the sitemap automatically, while `published: false` posts stay out.
- Pass a concise, page-specific `description` to `Layout`. Blog metadata comes from post frontmatter.
- Change shared social image fields and structured data in `src/components/Head.astro`.
- Keep sitemap URLs and `rel="canonical"` URLs in the same canonical route form.

Do not add `priority` or `changefreq` to the sitemap; Google ignores both. Only add `lastmod` where the date represents a real significant content update.

## Configuration

`site` in `astro.config.ts` is the canonical origin and must remain the production HTTPS URL. The social preview uses the generated, content-hashed 512px icon derived from `src/assets/favicon.svg`. `portfolio.toml` provides the public name, biography, GitHub username, and LinkedIn slug used in structured data.

## Dependencies

The implementation uses Astro's static endpoint API and content collections. It makes no network requests at build time or runtime and adds no package dependency.
