import {
  renderBlogIndex,
  renderHome,
  renderPost,
  renderProjects,
  type SiteMarkdown,
} from '../markdown-export.ts';
import type { PageMeta } from './page-meta.ts';
import type { Post } from './posts.ts';
import type { Profile } from './profile.ts';
import type { Project } from './projects.ts';
import type { TimelineItem } from './timeline.ts';

export interface SiteContent {
  profile: Profile;
  posts: Post[];
  projects: Project[];
  timeline: TimelineItem[];
  meta: { home: PageMeta; blog: PageMeta; projects: PageMeta };
}

/** Renders every markdown document from the normalized content (shared by the endpoints and tests). */
export function buildSiteMarkdown(content: SiteContent): SiteMarkdown {
  const { profile, posts, projects, timeline, meta } = content;
  return {
    home: { meta: meta.home, doc: renderHome(profile, meta.home) },
    blog: { meta: meta.blog, doc: renderBlogIndex(posts, meta.blog) },
    projects: {
      meta: meta.projects,
      doc: renderProjects(projects, timeline, meta.projects),
    },
    posts: posts.map((post) => ({ post, doc: renderPost(post) })),
    projectList: projects,
    profile,
  };
}
