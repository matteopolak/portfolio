import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import config from '../lib/config';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error(
      'Astro `site` must be configured to generate the RSS feed.'
    );
  }

  const posts = (await getCollection('blog'))
    .filter((post) => post.data.published !== false)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: `${config.name} — Blog`,
    description: config.description,
    site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/blog/${post.id.replace(/\.md$/, '')}`,
      categories: post.data.tags,
    })),
    trailingSlash: false,
    customData: '<language>en-ca</language>',
  });
};
