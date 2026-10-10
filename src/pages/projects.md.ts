import type { APIRoute } from 'astro';
import { getSiteMarkdown } from '../lib/content';
import { toMarkdown } from '../lib/markdown-export';

export const prerender = true;

/** Every project and the timeline as markdown (`/projects.md`), alternate of `/projects`. */
export const GET: APIRoute = async () =>
  new Response(toMarkdown((await getSiteMarkdown()).projects.doc), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
