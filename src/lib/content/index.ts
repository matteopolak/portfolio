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
import { buildPosts, isVisiblePost } from './posts';
import { componentKinds } from '../charts/schema';
import { loadChartData } from '../charts/data';
import { mdxToMarkdown } from '../mdx-markdown';
import { renderChartMarkdown } from '../markdown-export';
import { buildProjects } from './projects';
import { buildTimeline } from './timeline';
import { buildRoutes } from './routes';
import { isoDay } from './format';
import { pageMeta } from './page-meta';
import { buildSiteMarkdown } from './site-markdown';

export const getProfile = () => buildProfile(config);
// MDX posts reach every non-HTML format as plain markdown: chart components
// become a title, a table of their data and a caption.
const mdxBody = (body: string) =>
  mdxToMarkdown(body, {
    chart(component, props) {
      const data = loadChartData(componentKinds[component], String(props.src));
      return renderChartMarkdown(component, data, {
        title: typeof props.title === 'string' ? props.title : undefined,
        caption: typeof props.caption === 'string' ? props.caption : undefined,
      });
    },
  });
/** Blog collection entries; drafts only in dev (filtered here, so production never loads them). */
export const getBlogEntries = () =>
  getCollection('blog', ({ data }) => isVisiblePost(data, import.meta.env.DEV));
export const getPosts = async () =>
  buildPosts(await getBlogEntries(), mdxBody, import.meta.env.DEV);
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

/** Every markdown document (the .md endpoints, llms.txt) from one build of the content. */
export async function getSiteMarkdown() {
  return buildSiteMarkdown({
    profile: getProfile(),
    posts: await getPosts(),
    projects: await getProjects(),
    timeline: await getTimeline(),
    meta: {
      home: getPageMeta('/'),
      blog: getPageMeta('/blog'),
      projects: getPageMeta('/projects'),
    },
  });
}

export { pageCopy };
