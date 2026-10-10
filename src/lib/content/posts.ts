import { SITE_ORIGIN } from '../../data/pages.ts';
import { isoDay, slugOf } from './format.ts';

/** What the normalizer needs from a blog collection entry. */
export interface PostEntry {
  id: string;
  /** Source file; `.mdx` posts are converted to plain markdown. */
  filePath?: string;
  body?: string;
  data: {
    title: string;
    date: Date;
    description?: string;
    tags?: string[];
    published?: boolean;
  };
}

/**
 * The one place that decides whether a post is shown: drafts (`published:
 * false`) are visible only in dev. Used as the `getCollection` filter, so a
 * draft never enters a production build (no page, no MDX module, no chart data).
 */
export const isVisiblePost = (
  data: { published?: boolean },
  dev: boolean
): boolean => dev || data.published !== false;

export interface Post {
  slug: string;
  /** A draft (`published: false`), only ever present in dev. */
  draft: boolean;
  title: string;
  date: string;
  description?: string;
  tags: string[];
  /** Site paths. */
  path: string;
  markdownPath: string;
  url: string;
  /** `mdx` posts have their components replaced by markdown (see mdx-markdown.ts). */
  format: 'md' | 'mdx';
  /** The original, unrendered markdown (for MDX, the markdown fallback of it). */
  body: string;
}

/**
 * Published posts, newest first. `convertMdx` turns an MDX body into plain
 * markdown (chart components become tables); `.md` posts are used as written.
 */
export function buildPosts(
  entries: PostEntry[],
  convertMdx: (body: string, entry: PostEntry) => string = (body) => body,
  dev = false
): Post[] {
  return entries
    .filter((entry) => isVisiblePost(entry.data, dev))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((entry) => {
      const slug = slugOf(entry.id);
      const format = entry.filePath?.endsWith('.mdx') ? 'mdx' : 'md';
      const body = entry.body ?? '';
      return {
        slug,
        draft: entry.data.published === false,
        title: entry.data.title,
        date: isoDay(entry.data.date),
        description: entry.data.description,
        tags: entry.data.tags ?? [],
        path: `/blog/${slug}`,
        markdownPath: `/blog/${slug}.md`,
        url: `${SITE_ORIGIN}/blog/${slug}`,
        format,
        body: format === 'mdx' ? convertMdx(body, entry) : body,
      };
    });
}
