import type { APIRoute } from 'astro';
import { getSiteMarkdown } from '../lib/content';
import { toMarkdown } from '../lib/markdown-export';

export const prerender = true;

/** The home page as markdown (`/index.md`), alternate of `/`. */
export const GET: APIRoute = async () =>
  new Response(toMarkdown((await getSiteMarkdown()).home.doc), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
