import { boldPlain } from '../bold.ts';
import { joinNatural } from '../content/format.ts';
import type { Profile } from '../content/profile.ts';
import type { Post } from '../content/posts.ts';
import type { Project } from '../content/projects.ts';

/*
 * The pure parts of the WebMCP tools: result shaping, search and truncation.
 * They take already-normalized content (src/lib/content), so they run under
 * `node --test` without a browser.
 */
export const PROFILE_SECTIONS = [
  'contact',
  'experience',
  'projects',
  'education',
  'skills',
  'achievements',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The profile with the `*bold*` markers removed; `section` limits it to one part. */
export function profileResult(profile: Profile, section?: ProfileSection) {
  const all = {
    name: profile.name,
    headline: profile.headline,
    summary: profile.summary,
    contact: {
      location: profile.location,
      email: profile.email,
      links: profile.links,
    },
    experience: profile.experience.map((job) => ({
      title: job.title,
      company: job.company,
      location: job.location,
      period: job.period,
      highlights: job.bullets.map(boldPlain),
    })),
    projects: profile.projects.map((project) => ({
      title: project.title,
      repository: project.repository,
      tags: project.tags,
      highlights: project.bullets.map(boldPlain),
    })),
    education: profile.education,
    skills: Object.fromEntries(
      profile.skills.map((group) => [group.label, group.items])
    ),
    achievements: profile.achievements.map((entry) =>
      entry.kind === 'text'
        ? { text: boldPlain(entry.text) }
        : {
            text:
              entry.prefix + joinNatural(entry.items.map((item) => item.name)),
            links: entry.items.map(({ name, url }) => ({ name, url })),
          }
    ),
  };
  if (!section) return all;
  if (section === 'contact')
    return { name: all.name, headline: all.headline, contact: all.contact };
  return { name: all.name, [section]: all[section] };
}

export const projectSummary = (project: Project) => ({
  slug: project.slug,
  title: project.title,
  date: project.date,
  tags: project.tags,
  repository: project.repository,
  ...(project.website ? { website: project.website } : {}),
  url: project.url,
  ...(project.ai ? { ai: project.ai.usage } : {}),
});

/** Projects, optionally those with `tag` (case-insensitive). */
export function listProjects(projects: Project[], tag?: string) {
  const wanted = tag?.trim().toLowerCase();
  return projects
    .filter(
      (project) =>
        !wanted || project.tags.some((t) => t.toLowerCase() === wanted)
    )
    .map(projectSummary);
}

export const postSummary = (post: Post) => ({
  slug: post.slug,
  title: post.title,
  date: post.date,
  ...(post.description ? { description: post.description } : {}),
  tags: post.tags,
  url: post.url,
});

/** Posts whose title, description or tags contain every word of `query` (case-insensitive). */
export function searchPosts(posts: Post[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return posts
    .filter((post) => {
      const haystack = [post.title, post.description ?? '', ...post.tags]
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .map(postSummary);
}

/** `text` cut to `limit` characters, with a flag when something was removed. */
export function truncate(text: string, limit: number) {
  return text.length <= limit
    ? { text, truncated: false }
    : { text: text.slice(0, limit), truncated: true };
}

/** Removes ANSI colour codes (the Jai compiler colours its errors). */
export const stripAnsi = (text: string) =>
  // eslint-disable-next-line no-control-regex
  text.replace(/\u001b\[[0-9;]*m/g, '');
