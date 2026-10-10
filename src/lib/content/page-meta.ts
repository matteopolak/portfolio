import { pageCopy, type PageRoute } from '../../data/pages.ts';

export interface PageMeta {
  title: string;
  heading?: string;
  description: string;
  summary: string;
}

/** Title, heading and description of a page; the home description is portfolio.toml's. */
export function pageMeta(route: PageRoute, homeDescription: string): PageMeta {
  const copy = pageCopy[route];
  return {
    ...copy,
    description: route === '/' ? homeDescription : copy.description,
  };
}
