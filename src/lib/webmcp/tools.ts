import { themes, type Theme } from '../themes.ts';
import { allowedRoute, type SiteRoute } from '../content/routes.ts';
import type { Profile } from '../content/profile.ts';
import type { Post } from '../content/posts.ts';
import type { Project } from '../content/projects.ts';
import type { RunTarget } from '../run-target.ts';
import { validateInput } from './schema.ts';
import {
  listProjects,
  postSummary,
  profileResult,
  PROFILE_SECTIONS,
  searchPosts,
  stripAnsi,
  truncate,
  type ProfileSection,
} from './logic.ts';
import type { JsonSchema, ToolDefinition } from './types.ts';

/** The build-time JSON the tools read (`/agent/<name>.json`, see src/pages/agent). */
export interface AgentData {
  profile: Profile;
  projects: Project[];
  blog: Post[];
  routes: SiteRoute[];
}

export interface ToolDeps {
  load<K extends keyof AgentData>(name: K): Promise<AgentData[K]>;
  /** Client-side navigation when the router is present, otherwise a full load. */
  navigate(path: string): void;
  theme: { current(): Theme; choose(theme: Theme): void };
  runTarget(): RunTarget | undefined;
}

export const RUN_TIMEOUT_MS = 30_000;
export const RUN_OUTPUT_LIMIT = 20 * 1024;

const readOnly = { readOnlyHint: true } as const;

const themeInfo = (theme: Theme) => ({
  id: theme.id,
  name: theme.name,
  mode: theme.dark ? 'dark' : 'light',
});

/** Finds a theme by id or name (case-insensitive); `next` is the one after `current`. */
export function resolveTheme(input: string, current: Theme): Theme | undefined {
  const wanted = input.trim().toLowerCase();
  if (wanted === 'next') {
    const index = themes.findIndex((theme) => theme.id === current.id);
    return themes[(index + 1) % themes.length];
  }
  return themes.find(
    (theme) => theme.id === wanted || theme.name.toLowerCase() === wanted
  );
}

const fail = (error: string) => ({ error });

/** Runs `execute` after validating the input against `schema`. */
function tool(
  definition: Omit<ToolDefinition, 'execute'>,
  run: (
    input: Record<string, string>,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>
): ToolDefinition {
  return {
    ...definition,
    async execute(input, options) {
      const checked = validateInput(definition.inputSchema, input ?? {});
      if (!checked.ok) return fail(checked.error);
      try {
        return await run(checked.value, options);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** The tools that are on every page. */
export function createSiteTools(deps: ToolDeps): ToolDefinition[] {
  return [
    tool(
      {
        name: 'get_profile',
        title: 'Get profile',
        description:
          "Matthew Polak's profile from his portfolio: name, headline, contact links, experience, selected work, education, skills and achievements. Pass `section` to get only one part.",
        inputSchema: {
          type: 'object',
          properties: {
            section: {
              type: 'string',
              description: 'Return only this part of the profile.',
              enum: PROFILE_SECTIONS,
            },
          },
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async ({ section }) =>
        profileResult(
          await deps.load('profile'),
          section as ProfileSection | undefined
        )
    ),
    tool(
      {
        name: 'list_projects',
        title: 'List projects',
        description:
          'Lists the projects on the site, newest first, with slug, date, tags and links. Optionally keep only projects with one tag (for example "rust").',
        inputSchema: {
          type: 'object',
          properties: {
            tag: {
              type: 'string',
              description: 'Only projects with this tag (case-insensitive).',
              maxLength: 60,
            },
          },
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async ({ tag }) => {
        const projects = listProjects(await deps.load('projects'), tag);
        return { count: projects.length, projects };
      }
    ),
    tool(
      {
        name: 'get_project',
        title: 'Get project',
        description:
          'Returns one project by slug (from list_projects): description in markdown, tags, links and how AI was used to build it, if at all.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: {
              type: 'string',
              description: 'The project slug, for example "quasi".',
              minLength: 1,
              maxLength: 80,
            },
          },
          required: ['slug'],
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async ({ slug }) => {
        const project = (await deps.load('projects')).find(
          (item) => item.slug === slug
        );
        return project ?? fail(`No project "${slug}". Use list_projects.`);
      }
    ),
    tool(
      {
        name: 'search_blog',
        title: 'Search blog',
        description:
          'Finds blog posts whose title, description or tags contain every word of the query. An empty result means no match.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Words to look for, for example "axum extract".',
              minLength: 1,
              maxLength: 120,
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async ({ query }) => {
        const posts = searchPosts(await deps.load('blog'), query);
        return { count: posts.length, posts };
      }
    ),
    tool(
      {
        name: 'get_post',
        title: 'Get blog post',
        description:
          'Returns one blog post by slug: title, date, description, URL and the full markdown body.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: {
              type: 'string',
              description: 'The post slug, for example "axum-extract".',
              minLength: 1,
              maxLength: 120,
            },
          },
          required: ['slug'],
          additionalProperties: false,
        },
        annotations: readOnly,
      },
      async ({ slug }) => {
        const post = (await deps.load('blog')).find(
          (item) => item.slug === slug
        );
        return post
          ? { ...postSummary(post), body: post.body }
          : fail(`No post "${slug}". Use search_blog.`);
      }
    ),
    tool(
      {
        name: 'navigate',
        title: 'Navigate',
        description:
          "Opens one of this site's own pages in the current tab (for example /projects, /blog or /playground/quasi). Other sites are refused.",
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'A site path such as "/projects".',
              minLength: 1,
              maxLength: 200,
            },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
      async ({ path }) => {
        const routes = await deps.load('routes');
        const target = allowedRoute(path, routes);
        if (!target)
          return fail(
            `"${path}" is not a page on this site. Pages: ${routes.map((r) => r.path).join(', ')}`
          );
        // Let the result reach the agent before the page changes.
        setTimeout(() => deps.navigate(target), 50);
        return { navigating: target };
      }
    ),
    tool(
      {
        name: 'set_theme',
        title: 'Set theme',
        description:
          'Changes the site colour theme and remembers the choice. Pass a theme id or name, or "next" for the next one. Without an argument it only lists the themes.',
        inputSchema: {
          type: 'object',
          properties: {
            theme: {
              type: 'string',
              description: 'A theme id or name, or "next".',
              maxLength: 40,
            },
          },
          additionalProperties: false,
        },
      },
      async ({ theme }) => {
        const current = deps.theme.current();
        if (theme !== undefined) {
          const next = resolveTheme(theme, current);
          if (!next)
            return fail(
              `Unknown theme "${theme}". Themes: ${themes.map((t) => t.id).join(', ')}`
            );
          deps.theme.choose(next);
        }
        return {
          current: themeInfo(deps.theme.current()),
          available: themes.map(themeInfo),
        };
      }
    ),
  ];
}

export const runCodeSchema: JsonSchema = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: 'The complete program to run.',
      minLength: 1,
      maxLength: 100_000,
    },
    filename: {
      type: 'string',
      description:
        'Jai workspace only: the file to write the code to (default main.jai). Ignored by single-file playgrounds.',
      maxLength: 200,
    },
  },
  required: ['code'],
  additionalProperties: false,
};

/** Only registered while a code workspace is mounted (playground pages and open demo modals). */
export function createRunCodeTool(deps: ToolDeps): ToolDefinition {
  return tool(
    {
      name: 'run_code',
      title: 'Run code in the playground',
      description:
        'Loads code into the open in-browser playground (Jai, Quasi or BaerScript, whichever is on this page), runs it and returns its output. The editor contents are replaced. Returns stdout, stderr, the exit status and diagnostics; output is cut at 20 KB and the run is stopped after 30 seconds. Jai restarts its compiler session first, so it takes longer.',
      inputSchema: runCodeSchema,
      annotations: { consequentialHint: true },
    },
    async ({ code, filename }) => {
      const target = deps.runTarget();
      if (!target)
        return fail(
          'No playground is open on this page. Navigate to one first.'
        );
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          controller.abort(new DOMException('Timed out', 'TimeoutError'));
          resolve('timeout');
        }, RUN_TIMEOUT_MS);
      });
      try {
        const run = target.run({ code, filename }, controller.signal);
        // A run that loses the race must not become an unhandled rejection.
        run.catch(() => {});
        const result = await Promise.race([run, timeout]);
        if (result === 'timeout')
          return {
            language: target.language,
            status: 'timeout',
            error: `Stopped waiting after ${RUN_TIMEOUT_MS / 1000} seconds.`,
          };
        const stdout = truncate(stripAnsi(result.stdout), RUN_OUTPUT_LIMIT);
        const stderr = truncate(stripAnsi(result.stderr), RUN_OUTPUT_LIMIT);
        return {
          language: target.language,
          status: result.exitCode === 0 ? 'ok' : 'failed',
          exitCode: result.exitCode,
          stdout: stdout.text,
          stderr: stderr.text,
          ...(result.diagnostics?.length
            ? { diagnostics: result.diagnostics.slice(0, 50).map(stripAnsi) }
            : {}),
          ...(stdout.truncated || stderr.truncated ? { truncated: true } : {}),
        };
      } finally {
        clearTimeout(timer);
      }
    }
  );
}

/** The tools for the current page. */
export function toolsForPage(deps: ToolDeps): ToolDefinition[] {
  return [
    ...createSiteTools(deps),
    ...(deps.runTarget() ? [createRunCodeTool(deps)] : []),
  ];
}
