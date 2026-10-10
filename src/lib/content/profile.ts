import type { Config } from '../../types/config.ts';
import { HEADLINE, SITE_ORIGIN, skillGroups } from '../../data/pages.ts';
import { formatDate, isoMonth } from './format.ts';

/*
 * The portfolio.toml data, normalized once for every consumer (the home page,
 * home .md, WebMCP, JSON-LD). Pure: it takes the parsed Config. Bullets keep
 * their `*bold*` markers; renderers choose how to show them (src/lib/bold.ts).
 */
export interface ProfileLink {
  label: string;
  url: string;
}
export interface ProfileJob {
  id: string;
  title: string;
  company: string;
  location: string;
  start: string;
  end?: string;
  period: string;
  bullets: string[];
}
export interface ProfileProject {
  title: string;
  repository: string;
  github: string;
  tags: string[];
  bullets: string[];
}
export type ProfileAchievement =
  | { kind: 'text'; text: string }
  | {
      kind: 'links';
      prefix: string;
      items: { name: string; url: string; pop?: number }[];
    };
export interface Profile {
  name: string;
  headline: string;
  summary: string;
  location: string;
  email: string;
  links: ProfileLink[];
  experience: ProfileJob[];
  projects: ProfileProject[];
  education: {
    degree: string;
    school: string;
    gpa: string;
    start: string;
    end: string;
    period: string;
  };
  skills: { label: string; items: string[] }[];
  achievements: ProfileAchievement[];
}

const enabled = <T extends { enabled?: boolean }>(item: T) =>
  item.enabled !== false;

export function buildProfile(config: Config): Profile {
  return {
    name: config.name,
    headline: HEADLINE,
    summary: config.description,
    location: config.location,
    email: config.email,
    links: [
      { label: 'Website', url: `${SITE_ORIGIN}/` },
      { label: 'GitHub', url: `https://github.com/${config.github}` },
      {
        label: 'LinkedIn',
        url: `https://www.linkedin.com/in/${config.linkedin}`,
      },
      { label: 'Email', url: `mailto:${config.email}` },
    ],
    experience: config.job.filter(enabled).map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      start: isoMonth(job.start),
      end: job.end ? isoMonth(job.end) : undefined,
      period: `${formatDate(job.start)} — ${job.end ? formatDate(job.end) : 'Present'}`,
      bullets: [...job.achievements],
    })),
    projects: config.project.filter(enabled).map((project) => ({
      title: project.title,
      repository: `https://github.com/${project.github}`,
      github: project.github,
      tags: [...project.tags],
      bullets: [...project.achievements],
    })),
    education: {
      degree: config.education.degree,
      school: config.education.school,
      gpa: config.education.gpa,
      start: isoMonth(config.education.start),
      end: isoMonth(config.education.end),
      period: `${formatDate(config.education.start)} — ${formatDate(config.education.end)}`,
    },
    skills: skillGroups.map(({ key, label }) => ({
      label,
      items: [...config.skills[key]],
    })),
    achievements: Object.values(config.achievement).map((entry) =>
      'text' in entry
        ? { kind: 'text' as const, text: entry.text }
        : {
            kind: 'links' as const,
            prefix: entry.prefix,
            items: entry.item.map((item) => ({ ...item })),
          }
    ),
  };
}
