import type { APIRoute } from 'astro';
import { getSiteMarkdown } from '../lib/content';
import { renderLlmsFull } from '../lib/markdown-export';

export const prerender = true;

/** llms-full.txt: every markdown page concatenated. */
export const GET: APIRoute = async () =>
  new Response(renderLlmsFull(await getSiteMarkdown()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
