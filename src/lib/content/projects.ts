import { SITE_ORIGIN } from '../../data/pages.ts';
import { isoDay } from './format.ts';

export interface ProjectEntry {
  id: string;
  body?: string;
  data: {
    title: string;
    date: Date;
    tags: string[];
    repository: string;
    website?: string;
    aiFeature?: boolean;
    ai?: {
      usage: 'paired' | 'agent-orchestrated';
      summary: string;
      models: string[];
      approximateTokens?: number;
    };
  };
}

export interface Project {
  slug: string;
  title: string;
  date: string;
  tags: string[];
  repository: string;
  website?: string;
  /** `/projects#slug`. */
  path: string;
  url: string;
  ai?: ProjectEntry['data']['ai'];
  usesAi: boolean;
  /** The original, unrendered markdown. */
  body: string;
}

/** Projects newest first, the order of /projects. */
export function buildProjects(entries: ProjectEntry[]): Project[] {
  return [...entries]
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((entry) => ({
      slug: entry.id,
      title: entry.data.title,
      date: isoDay(entry.data.date),
      tags: entry.data.tags,
      repository: entry.data.repository,
      website: entry.data.website,
      path: `/projects#${entry.id}`,
      url: `${SITE_ORIGIN}/projects#${entry.id}`,
      ai: entry.data.ai,
      usesAi: entry.data.aiFeature === true,
      body: (entry.body ?? '').trim(),
    }));
}
