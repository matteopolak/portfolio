import type { APIRoute } from 'astro';
import { getSiteMarkdown } from '../lib/content';
import { renderLlmsTxt } from '../lib/markdown-export';

export const prerender = true;

/** llms.txt (llmstxt.org): a markdown index of the site for language models. */
export const GET: APIRoute = async () =>
  new Response(renderLlmsTxt(await getSiteMarkdown()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
