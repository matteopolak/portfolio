/*
 * The single place that reads the data sources (portfolio.toml, the content
 * collections, src/data/*) and hands out normalized content. Pages, endpoints
 * and the WebMCP JSON all call these; format-specific code only renders.
 * The normalizers live next to this file and are plain TS for `node --test`.
 */
import { getCollection } from 'astro:content';
import config from '../config';
import { projectMilestones } from '../../data/project-milestones';
import { hackathonWins } from '../../data/hackathon-wins';
import { playgroundPages } from '../../data/code-demos';
import { pageCopy, type PageRoute } from '../../data/pages.ts';
import { buildProfile } from './profile';
import { buildPosts } from './posts';
import { buildProjects } from './projects';
import { buildTimeline } from './timeline';
import { buildRoutes } from './routes';
import { isoDay } from './format';
import { pageMeta } from './page-meta';

export const getProfile = () => buildProfile(config);
export const getPosts = async () => buildPosts(await getCollection('blog'));
export const getProjects = async () =>
  buildProjects(await getCollection('projects'));

export const getPageMeta = (route: PageRoute) =>
  pageMeta(route, config.description);

export async function getTimeline() {
  const projects = await getProjects();
  return buildTimeline({
    projects,
    jobs: config.job
      .filter((job) => job.enabled !== false)
      .map((job) => ({
        id: job.id,
        company: job.company,
        start: isoDay(job.start),
      })),
    milestones: projectMilestones,
    hackathons: hackathonWins,
  });
}

export async function getRoutes() {
  return buildRoutes({
    posts: await getPosts(),
    playgrounds: playgroundPages.map(({ path, title }) => ({ path, title })),
  });
}

export { pageCopy };
