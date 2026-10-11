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
    id: 'gpt-6-1-sol',
    date: '2026-09-29',
    title: 'GPT-6.1 Sol released',
    detail: 'Released at OpenAI DevDay.',
    category: 'ai',
    sourceUrl: 'https://openai.com/index/introducing-gpt-6-1-sol/',
  },
  {
    id: 'claude-sonnet-5-5',
    date: '2026-09-28',
    title: 'Claude Sonnet 5.5 released',
    detail: 'The second Claude 5.5 model, six days after Opus 5.5.',
    category: 'ai',
    sourceUrl: 'https://www.anthropic.com/claude/sonnet',
  },
  {
    id: 'claude-opus-5-5',
    date: '2026-09-22',
    title: 'Claude Opus 5.5 released',
    detail: 'The first Claude 5.5 model, released the same day as GPT-6 Luna.',
    category: 'ai',
    sourceUrl: 'https://www.anthropic.com/news/claude-opus-5-5',
  },
  {
    id: 'gpt-6-luna',
    date: '2026-09-22',
    title: 'GPT-6 Luna released',
    detail: 'The lower-cost GPT-6 model.',
    category: 'ai',
    sourceUrl: 'https://openai.com/index/introducing-gpt-6-sol-and-luna/',
  },
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
  {
    id: 'instructgpt-api-default',
    date: '2022-01-27',
    title: "InstructGPT became OpenAI's API default",
    detail:
      'A marker for the early OpenAI API generation that preceded the few-shot Davinci integration in TheArchon.',
    category: 'ai',
    sourceUrl: 'https://openai.com/index/instruction-following/',
  },
];
