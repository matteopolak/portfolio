import { SITE_ORIGIN, sectionHeadings } from '../data/pages.ts';
import { boldMarkdown } from './bold.ts';
import { joinNatural, longDate } from './content/format.ts';
import type { PageMeta } from './content/page-meta.ts';
import type { Post } from './content/posts.ts';
import type { Profile } from './content/profile.ts';
import type { Project } from './content/projects.ts';
import { markdownTable, tableFor, describeChart } from './charts/table.ts';
import type { ChartComponentName } from './charts/schema.ts';
import {
  timelineDate,
  timelineTitle,
  type TimelineItem,
} from './content/timeline.ts';

/*
 * Markdown renderers for the `.md` variants of the pages and llms.txt. They
 * only render: every input comes from the content layer (src/lib/content), the
 * same data the HTML pages use. Plain TS so `node --test` covers it.
 */
export interface MarkdownDocument {
  /** Frontmatter fields; `undefined` values are skipped. */
  meta: Record<string, string | string[] | undefined>;
  body: string;
}

const yamlString = (value: string) => JSON.stringify(value);

/** `---` frontmatter (JSON-quoted strings are valid YAML) followed by the body. */
export function toMarkdown({ meta, body }: MarkdownDocument): string {
  const lines = Object.entries(meta).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (Array.isArray(value))
      return value.length
        ? [`${key}:`, ...value.map((item) => `  - ${yamlString(item)}`)]
        : [];
    return [`${key}: ${yamlString(value)}`];
  });
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

const absolute = (path: string) => new URL(path, SITE_ORIGIN).href;

/**
 * Rewrites relative links, images and reference definitions to absolute URLs,
 * resolved against `base` (the page's HTML URL). Code fences and inline code
 * are left alone, so examples keep their exact text.
 */
export function absolutizeLinks(markdown: string, base: string): string {
  const resolve = (url: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  };
  const rewrite = (text: string) =>
    text
      .replace(
        /(!?\[[^\]\n]*\]\()(\s*)(<[^>\n]*>|[^\s)]+)/g,
        (_match, open: string, space: string, url: string) =>
          url.startsWith('<')
            ? `${open}${space}<${resolve(url.slice(1, -1))}>`
            : `${open}${space}${resolve(url)}`
      )
      .replace(
        /^(\s{0,3}\[[^\]\n]+\]:\s*)(\S+)/gm,
        (_match, open: string, url: string) => `${open}${resolve(url)}`
      );
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined && marker) {
      fence = marker;
      out.push(line);
    } else if (fence !== undefined) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
    } else {
      out.push(maskInlineCode(line, rewrite));
    }
  }
  return out.join('\n');
}

/** Applies `rewrite` to a line except inside `inline code` spans. */
function maskInlineCode(line: string, rewrite: (text: string) => string) {
  if (!line.includes('`')) return rewrite(line);
  return line
    .split(/(`+[^`]*`+)/g)
    .map((part, index) => (index % 2 === 1 ? part : rewrite(part)))
    .join('');
}

const link = (label: string, url: string) => `[${label}](${url})`;

const bullets = (items: string[]) =>
  items.map((item) => `- ${boldMarkdown(item)}`).join('\n');

/** The home page: the résumé from portfolio.toml. */
export function renderHome(profile: Profile, meta: PageMeta): MarkdownDocument {
  const contact = [
    `- Location: ${profile.location}`,
    ...profile.links.map((l) =>
      l.label === 'Email'
        ? `- Email: ${link(profile.email, l.url)}`
        : `- ${link(l.label, l.url)}`
    ),
  ];
  const experience = profile.experience.map((job) =>
    [
      `### ${job.title}, ${job.company}`,
      `*${job.location} · ${job.period}*`,
      job.bullets.length ? bullets(job.bullets) : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  );
  const projects = profile.projects.map((project) =>
    [
      `### ${link(project.title, project.repository)}`,
      project.tags.length ? `*${project.tags.join(' · ')}*` : '',
      project.bullets.length ? bullets(project.bullets) : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  );
  const { education } = profile;
  const skills = profile.skills.map(
    (group) => `- **${group.label}:** ${group.items.join(', ')}`
  );
  const achievements = profile.achievements.map((entry) =>
    entry.kind === 'text'
      ? `- ${boldMarkdown(entry.text)}`
      : `- ${entry.prefix}${joinNatural(
          entry.items.map((item) =>
            item.pop === undefined
              ? link(item.name, item.url)
              : `${link(item.name, item.url)} (${item.pop})`
          )
        )}`
  );
  const body = [
    `# ${profile.name}`,
    `${profile.headline}`,
    `> ${profile.summary}`,
    contact.join('\n'),
    `## ${sectionHeadings.experience}`,
    experience.join('\n\n'),
    `## ${sectionHeadings.projects}`,
    projects.join('\n\n'),
    `## ${sectionHeadings.education}`,
    [
      `### ${education.degree}`,
      `*${education.school} · GPA ${education.gpa} · ${education.period}*`,
    ].join('\n\n'),
    `## ${sectionHeadings.skills}`,
    skills.join('\n'),
    `## ${sectionHeadings.achievements}`,
    achievements.join('\n'),
  ].join('\n\n');
  return {
    meta: {
      title: meta.title,
      description: meta.description,
      url: absolute('/'),
    },
    body,
  };
}

/** The blog index. */
export function renderBlogIndex(
  posts: Post[],
  meta: PageMeta
): MarkdownDocument {
  const list = posts.map(
    (post) =>
      `- ${link(post.title, absolute(post.markdownPath))} (${post.date})` +
      (post.description ? `: ${post.description}` : '') +
      ` · ${link('HTML', post.url)}`
  );
  return {
    meta: {
      title: meta.title,
      description: meta.description,
      url: absolute('/blog'),
    },
    body: [
      `# ${meta.heading ?? meta.title}`,
      meta.description,
      list.join('\n'),
    ].join('\n\n'),
  };
}

/** One post: frontmatter plus the original markdown with absolute links. */
export function renderPost(post: Post): MarkdownDocument {
  return {
    meta: {
      title: post.title,
      date: post.date,
      description: post.description,
      url: post.url,
      tags: post.tags,
    },
    body: `# ${post.title}\n\n${absolutizeLinks(post.body, post.url)}`,
  };
}

const aiLine = (project: Project) => {
  const parts: string[] = [];
  if (project.ai)
    parts.push(
      `${project.ai.usage === 'paired' ? 'AI-assisted' : 'Agent-orchestrated'}: ${project.ai.summary}` +
        (project.ai.models.length
          ? ` (models: ${project.ai.models.join(', ')})`
          : '')
    );
  if (project.usesAi) parts.push('Uses AI as a feature.');
  return parts.join(' ');
};

/** /projects: every project in page order, then the timeline. */
export function renderProjects(
  projects: Project[],
  timeline: TimelineItem[],
  meta: PageMeta
): MarkdownDocument {
  const entries = projects.map((project) => {
    const links = [
      link('Repository', project.repository),
      project.website ? link('Website', project.website) : '',
    ].filter(Boolean);
    return [
      `### ${project.title}`,
      [
        `*${longDate(new Date(`${project.date}T00:00:00Z`), false)} · ${project.tags.join(' · ')}*`,
        links.join(' · '),
      ].join('\n\n'),
      aiLine(project),
      absolutizeLinks(project.body, project.url),
    ]
      .filter(Boolean)
      .join('\n\n');
  });
  const events = timeline.map((item) => {
    const date = timelineDate(item);
    if (item.kind === 'project')
      return `- **${date}** — ${link(item.title, `${absolute('/projects')}#${item.slug}`)}`;
    if (item.kind === 'career') return `- **${date}** — ${item.title}`;
    if (item.kind === 'hackathon')
      return `- **${date}** — ${item.win.project} at ${item.win.hackathon} (${item.win.awards.join(', ')}): ${item.win.description} ${link('Hackathon', item.win.submissionUrl)} · ${link('GitHub', item.win.repositoryUrl)}`;
    return (
      `- **${date}** — ${timelineTitle(item)}: ${item.milestone.detail}` +
      (item.milestone.sourceUrl
        ? ` ${link('Source', item.milestone.sourceUrl)}`
        : '')
    );
  });
  return {
    meta: {
      title: meta.title,
      description: meta.description,
      url: absolute('/projects'),
    },
    body: [
      `# ${meta.heading ?? meta.title}`,
      meta.description,
      '## Projects',
      entries.join('\n\n'),
      '## Timeline',
      events.join('\n'),
    ].join('\n\n'),
  };
}

export interface SiteMarkdown {
  home: { meta: PageMeta; doc: MarkdownDocument };
  blog: { meta: PageMeta; doc: MarkdownDocument };
  projects: { meta: PageMeta; doc: MarkdownDocument };
  posts: { post: Post; doc: MarkdownDocument }[];
  projectList: Project[];
  profile: Profile;
}

/** The first sentence of a project's description, for llms.txt. */
const firstSentence = (markdown: string) => {
  const text = markdown.replace(/\s+/g, ' ').trim();
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
};

/** /llms.txt following the llmstxt.org convention. */
export function renderLlmsTxt(site: SiteMarkdown): string {
  const { home, blog, projects, posts, projectList, profile } = site;
  const pages = [
    `- ${link('Home', absolute('/index.md'))}: ${home.meta.summary}`,
    `- ${link(projects.meta.title, absolute('/projects.md'))}: ${projects.meta.summary}`,
    `- ${link(blog.meta.title, absolute('/blog.md'))}: ${blog.meta.summary}`,
  ];
  const postLines = posts.map(
    ({ post }) =>
      `- ${link(post.title, absolute(post.markdownPath))}` +
      (post.description ? `: ${post.description}` : '')
  );
  const projectLines = projectList.map(
    (project) =>
      `- ${link(project.title, project.website ?? project.repository)}: ${firstSentence(project.body)}`
  );
  return (
    [
      `# ${profile.name}`,
      `> ${profile.summary}`,
      `Every page below is also available as markdown. The full content is in one file at ${absolute('/llms-full.txt')}.`,
      '## Pages',
      pages.join('\n'),
      '## Blog posts',
      postLines.join('\n'),
      '## Projects',
      projectLines.join('\n'),
      '## Optional',
      [
        `- ${link('Full content in one file', absolute('/llms-full.txt'))}`,
        `- ${link('RSS feed', absolute('/rss.xml'))}`,
        `- ${link('Sitemap', absolute('/sitemap.xml'))}`,
      ].join('\n'),
    ].join('\n\n') + '\n'
  );
}

/** /llms-full.txt: every markdown page in one file, each preceded by its URL. */
export function renderLlmsFull(site: SiteMarkdown): string {
  const sections = [
    site.home.doc,
    site.blog.doc,
    ...site.posts.map((p) => p.doc),
    site.projects.doc,
  ];
  return (
    sections
      .map((doc) => `Source: ${doc.meta.url}\n\n${doc.body.trim()}`)
      .join('\n\n---\n\n') + '\n'
  );
}

/**
 * The markdown stand-in for a chart component in an MDX post: its title, a
 * table of the same data the chart (and its hidden HTML table) shows, and a
 * caption. Built from the validated data, so it never drifts from the chart.
 */
export function renderChartMarkdown(
  component: ChartComponentName,
  data: unknown,
  { title, caption }: { title?: string; caption?: string }
): string {
  return [
    title ? `**${title}**` : '',
    markdownTable(tableFor(component, data)),
    `*${caption ?? describeChart(component, data)}*`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
