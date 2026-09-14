export type ProjectMilestoneCategory = 'ai' | 'personal';

export interface ProjectMilestone {
  id: string;
  date: `${number}-${number}-${number}`;
  title: string;
  detail: string;
  category: ProjectMilestoneCategory;
  sourceUrl?: string;
}

/**
 * Hand-curated events that changed, or help explain, how the projects were made.
 * Job starts are added separately from portfolio.toml in the projects page.
 */
export const projectMilestones: ProjectMilestone[] = [
  {
    id: 'gpt-6-astra',
    date: '2026-09-03',
    title: 'GPT-6 Astra released',
    detail:
      'A marker for my move from a Claude-led workflow to Codex shortly before its release.',
    category: 'ai',
    sourceUrl: 'https://openai.com/index/gpt-6-astra/',
  },
  {
    id: 'claude-opus-5',
    date: '2026-07-24',
    title: 'Claude Opus 5 released',
    detail: 'This became the orchestrator model for the Minecraft rewrite.',
    category: 'ai',
    sourceUrl: 'https://www.anthropic.com/news/claude-opus-5',
  },
  {
    id: 'gpt-5-6',
    date: '2026-07-09',
    title: 'GPT-5.6 Sol and Luna released',
    detail:
      'Sol and Luna later handled complementary subagent work when I moved the rewrite to Codex.',
    category: 'ai',
    sourceUrl: 'https://openai.com/index/gpt-5-6/',
  },
  {
    id: 'claude-sonnet-5',
    date: '2026-06-30',
    title: 'Claude Sonnet 5 released',
    detail:
      'Sonnet became the subagent workhorse in the agent-heavy Minecraft rewrite.',
    category: 'ai',
    sourceUrl: 'https://www.anthropic.com/news/claude-sonnet-5',
  },
  {
    id: 'cursor-composer-2-5',
    date: '2026-05-18',
    title: 'Cursor Composer 2.5 released',
    detail:
      "Cursor's agentic coding model joined the set of models I used to iterate on uoPlan.",
    category: 'ai',
    sourceUrl: 'https://cursor.com/blog/composer-2-5',
  },
  {
    id: 'claude-opus-4-7',
    date: '2026-04-16',
    title: 'Claude Opus 4.7 released',
    detail:
      'Part of the Claude model generation I used while developing uoPlan.',
    category: 'ai',
    sourceUrl: 'https://www.anthropic.com/news/claude-opus-4-7',
  },
  {
    id: 'claude-code-preview',
    date: '2025-02-24',
    title: 'Claude Code entered preview',
    detail:
      'A useful marker for the terminal-first agent workflow I later used on uoPlan.',
    category: 'ai',
    sourceUrl: 'https://www.anthropic.com/news/claude-3-7-sonnet',
  },
];
