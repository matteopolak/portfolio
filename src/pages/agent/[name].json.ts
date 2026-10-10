import type { APIRoute, GetStaticPaths } from 'astro';
import {
  getPosts,
  getProfile,
  getProjects,
  getRoutes,
} from '../../lib/content';

export const prerender = true;

/*
 * Build-time JSON for the WebMCP tools (src/lib/webmcp), generated from the
 * same normalized content as the pages: /agent/profile.json, projects.json,
 * blog.json (with post bodies) and routes.json. The tools fetch these lazily,
 * so no content is bundled into JavaScript.
 */
const sources = {
  profile: async () => getProfile(),
  projects: getProjects,
  blog: getPosts,
  routes: getRoutes,
};

export const getStaticPaths = (() =>
  Object.keys(sources).map((name) => ({
    params: { name },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const source = sources[params.name as keyof typeof sources];
  return new Response(JSON.stringify(await source()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
