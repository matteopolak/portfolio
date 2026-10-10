import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import config from '../lib/config';
import { feedTitle } from '../data/pages';
import { getPosts } from '../lib/content';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error(
      'Astro `site` must be configured to generate the RSS feed.'
    );
  }

  const posts = await getPosts();

  return rss({
    title: feedTitle(config.name),
    description: config.description,
    site,
    items: posts.map((post) => ({
      title: post.title,
      description: post.description,
      pubDate: new Date(post.date),
      link: post.path,
      categories: post.tags,
    })),
    trailingSlash: false,
    customData: '<language>en-ca</language>',
  });
};
