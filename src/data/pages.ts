/*
 * Page-level copy shared by the HTML pages, the markdown variants, llms.txt,
 * the sitemap and RSS. Anything the user edits as content lives in
 * portfolio.toml instead; this is the site's own framing text.
 */
export const SITE_ORIGIN = 'https://matteopolak.com';
export const HEADLINE = 'Software Engineer';

export type PageRoute = '/' | '/projects' | '/blog' | '/playground';

export interface PageCopy {
  /** `<title>` prefix and the meta/frontmatter title. */
  title: string;
  /** The page's visible `<h1>` (the home page uses the person's name). */
  heading?: string;
  description: string;
  /** One line for llms.txt. */
  summary: string;
}

export const pageCopy: Record<PageRoute, PageCopy> = {
  // The home description is portfolio.toml's `description`; see pageMeta().
  '/': {
    title: 'Portfolio',
    description: '',
    summary:
      'Résumé: experience, selected work, education, skills and achievements.',
  },
  '/projects': {
    title: 'Projects',
    heading: 'Stuff I built',
    description: 'Selected software projects by Matthew Polak.',
    summary:
      'Every project with dates, tags, AI-usage notes and links, plus a timeline.',
  },
  '/blog': {
    title: 'Blog',
    heading: 'Stuff I wrote',
    description:
      'Writing about systems, software, and things learned while building.',
    summary: 'Posts about systems and software.',
  },
  '/playground': {
    title: 'Playgrounds',
    heading: 'Stuff you can run',
    description:
      'Run Jai, Quasi, BaerScript and Lodestone in your browser: full-page editors and a game, built in Rust and compiled to WebAssembly.',
    summary: 'In-browser playgrounds.',
  },
};

/** Headings of the home page's sections. */
export const sectionHeadings = {
  experience: 'Experience',
  projects: 'Selected work',
  education: 'Education',
  skills: 'Skills',
  achievements: 'Achievements',
} as const;

/** Labels for the groups in portfolio.toml's `[skills]` table. */
export const skillGroups = [
  { key: 'languages', label: 'Languages' },
  { key: 'agents', label: 'AI & Agent Systems' },
  { key: 'protocols', label: 'APIs & Protocols' },
  { key: 'tools', label: 'Platforms & Tooling' },
] as const;

/** The timeline's framing text. */
export const timelineCopy = {
  careerStart: (company: string) => `Started at ${company}`,
  hackathonAt: (hackathon: string) => `at ${hackathon}`,
};
