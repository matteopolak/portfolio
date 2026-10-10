import type { APIRoute, GetStaticPaths } from 'astro';
import { getSiteMarkdown } from '../../lib/content';
import { toMarkdown } from '../../lib/markdown-export';

export const prerender = true;

/** A post as markdown (`/blog/<slug>.md`), alternate of `/blog/<slug>`. */
export const getStaticPaths = (async () =>
  (await getSiteMarkdown()).posts.map(({ post, doc }) => ({
    params: { slug: post.slug },
    props: { doc },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(toMarkdown(props.doc), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
