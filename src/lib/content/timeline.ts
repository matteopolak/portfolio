import { timelineCopy } from '../../data/pages.ts';
import { longDate } from './format.ts';

/*
 * The /projects journey: projects, job starts, curated milestones and
 * hackathon wins on one date-sorted list. Pure so the page and the markdown
 * variant render the same entries.
 */
export interface TimelineMilestone {
  id: string;
  date: string;
  title: string;
  detail: string;
  category: string;
  sourceUrl?: string;
}
export interface TimelineHackathon {
  id: string;
  date: string;
  project: string;
  hackathon: string;
  awards: string[];
  description: string;
  repositoryUrl: string;
  submissionUrl: string;
}

export type TimelineItem =
  | { kind: 'project'; id: string; date: Date; slug: string; title: string }
  | { kind: 'career'; id: string; date: Date; title: string }
  | { kind: 'milestone'; id: string; date: Date; milestone: TimelineMilestone }
  | { kind: 'hackathon'; id: string; date: Date; win: TimelineHackathon };

export interface TimelineInput {
  projects: { slug: string; title: string; date: string }[];
  jobs: { id: string; company: string; start: string }[];
  milestones: TimelineMilestone[];
  hackathons: TimelineHackathon[];
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const latestProject = input.projects.length
    ? Math.max(...input.projects.map((p) => utc(p.date).valueOf()))
    : Number.POSITIVE_INFINITY;
  return [
    ...input.projects.map((p): TimelineItem => ({
      kind: 'project',
      id: `project-${p.slug}`,
      date: utc(p.date),
      slug: p.slug,
      title: p.title,
    })),
    ...input.jobs
      // `start` is a full `YYYY-MM-DD` day.
      .filter((job) => utc(job.start).valueOf() <= latestProject)
      .map((job): TimelineItem => ({
        kind: 'career',
        id: `career-${job.id}`,
        date: utc(job.start),
        title: timelineCopy.careerStart(job.company),
      })),
    ...input.milestones
      .map((milestone): TimelineItem => ({
        kind: 'milestone',
        id: `milestone-${milestone.id}`,
        date: utc(milestone.date),
        milestone,
      }))
      .filter((item) => item.date.valueOf() <= latestProject),
    ...input.hackathons.map((win): TimelineItem => ({
      kind: 'hackathon',
      id: `hackathon-${win.id}`,
      date: utc(win.date),
      win,
    })),
  ].sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

/** The heading text of a non-project entry. */
export const timelineTitle = (item: TimelineItem): string =>
  item.kind === 'hackathon'
    ? item.win.project
    : item.kind === 'milestone'
      ? item.milestone.title
      : item.title;

/** `September 29, 2026`; milestones show the day, job starts only the month. */
export const timelineDate = (item: TimelineItem) =>
  longDate(item.date, item.kind === 'milestone' || item.kind === 'hackathon');
