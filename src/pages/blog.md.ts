import type { APIRoute } from 'astro';
import { getSiteMarkdown } from '../lib/content';
import { toMarkdown } from '../lib/markdown-export';

export const prerender = true;

/** The post list as markdown (`/blog.md`), alternate of `/blog`. */
export const GET: APIRoute = async () =>
  new Response(toMarkdown((await getSiteMarkdown()).blog.doc), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
