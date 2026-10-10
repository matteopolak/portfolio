import { SITE_ORIGIN } from '../../data/pages.ts';
import { isoDay, slugOf } from './format.ts';

/** What the normalizer needs from a blog collection entry. */
export interface PostEntry {
  id: string;
  body?: string;
  data: {
    title: string;
    date: Date;
    description?: string;
    tags?: string[];
    published?: boolean;
  };
}

export interface Post {
  slug: string;
  title: string;
  date: string;
  description?: string;
  tags: string[];
  /** Site paths. */
  path: string;
  markdownPath: string;
  url: string;
  /** The original, unrendered markdown. */
  body: string;
}

/** Published posts, newest first. */
export function buildPosts(entries: PostEntry[]): Post[] {
  return entries
    .filter((entry) => entry.data.published !== false)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((entry) => {
      const slug = slugOf(entry.id);
      return {
        slug,
        title: entry.data.title,
        date: isoDay(entry.data.date),
        description: entry.data.description,
        tags: entry.data.tags ?? [],
        path: `/blog/${slug}`,
        markdownPath: `/blog/${slug}.md`,
        url: `${SITE_ORIGIN}/blog/${slug}`,
        body: entry.body ?? '',
      };
    });
}
