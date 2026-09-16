# Project Journey

## What it is

The Projects page is a newest-first timeline that mixes project launches with career starts, hackathon wins, and a small, hand-curated set of AI-tool milestones. It independently identifies how each project was developed and whether AI or machine learning is part of the product itself.

## How it works

Project entries still come from `src/content/projects/*.md`. `src/pages/projects.astro` merges those entries with enabled job start dates from `portfolio.toml`, the events in `src/data/project-milestones.ts`, and team results from `src/data/hackathon-wins.ts`, then sorts the combined list by date. Contextual milestones newer than the newest project remain in the curated data but are not rendered, keeping the visible journey anchored to completed project work.

Hackathon wins use the event's final day as their timeline date. They are richer than ordinary milestones but deliberately smaller than full project cards: each entry names the project and event, lists the verified prize or sponsor challenge, gives a concise technical explanation, and links to both the official submission and source repository. They live outside the Astro project collection because these are collaborative weekend projects rather than the primary portfolio projects.

Project cards remain full-width, centered rows. Contextual events are interleaved by date and alternate across a straight center rail. Ordinary career and AI milestones display only their date and title; their descriptions, category labels, and source links remain in the data but are not rendered. Hackathon results add their award, technical summary, and project links. The light-gray rail spans the full event interval, including a deliberate buffer before and after the event labels, and touches the project cards above and below. Two adjacent projects with no intervening events instead receive ordinary whitespace and no connector. Small solid dots distinguish career milestones in red, AI milestones in blue, and hackathon results in a red-blue blend. On phones, event text moves to the right of a short left-side rail while project cards remain full-width.

Projects with a non-zero AI relationship receive an understated inline label.
Workflow, model, and token metadata remains available in frontmatter but is
intentionally not rendered inside the card:

- `AI-assisted` means models produced substantial work under direct human prompting and review.
- `Agent-led` means an orchestrated agent workflow produced most of the implementation work.
- `Uses AI` means AI or machine learning is part of the product itself.

An omitted `ai` object renders no development label. The separate
`aiFeature: true` frontmatter flag adds `Uses AI`, so product capabilities never
imply that a model wrote the code. Projects with neither are left unlabelled.
These indicators are plain inline text with short colored rules rather than
badges or meters.

TheArchon is the explicit historical example of that distinction: its product
used OpenAI's Davinci model with few-shot examples for in-game replies in 2022,
but there is no claim that generative AI helped write the project. It therefore
shows only `Uses AI`; the nearby InstructGPT release appears as historical
context. Grill, Crave, and stock-predict use the same product-feature flag for
their embedded ML behavior.

`ProjectCard.astro` normally reads the validated `project.data.ai` and
`project.data.aiFeature` values. It falls back to the same entry's rendered
Markdown frontmatter so an already-running Astro development content store
cannot temporarily display stale optional metadata; production builds still
receive the validated collection values directly.

A project card may also receive a custom action descriptor. The descriptor renders a red button with a stable action ID; `src/lib/project-actions.ts` maps that ID to a client callback after direct entry and every Astro navigation. Minecraft's `Try in browser` callback opens `ProjectDemoModal.astro`, creates the shared `<lodestone-game>` element only on demand, and immediately starts its asset preparation while showing progress. It destroys the game element when the modal closes so hidden game audio and processing cannot continue. The reusable blog embed retains a `Try in browser` control so merely reading the post cannot initiate the 37.4 MiB download. Quasi uses the same project-card action and floating-dialog pattern for its unlabelled two-panel interpreter playground, with Run anchored inside the source pane. Both use a crisp, shadowless 16:9 surface over a 30%-dimmed, blurred page backdrop and a shared aggregate loader with the static beige header monogram and progress bar. Opening uses a short scale-and-fade entrance; close controls, backdrop clicks, and Escape use the matching animated exit. Both transitions are disabled for reduced-motion visitors. Shared modal input handling consumes wheel, touch, and keyboard scrolling before it can move the page underneath, without changing the document's layout or scroll state. Explicit `data-project-demo-scroll` regions remain internally scrollable and contain overscroll at their edges; Quasi uses these for its source editor and output console. The Lodestone canvas receives focus as soon as the modal opens and again when its first frame is exposed. Every pointer-button event sends its current canvas coordinates before the button state so a stationary pointer's first click reaches the game instead of merely establishing input state.

## How to change it

Add or edit project-specific AI details in the project's Markdown frontmatter:

```yaml
ai:
  usage: paired
  summary: I prompted the models directly and reviewed their work.
  models:
    - Claude Opus 5
  approximateTokens: 100000000000
aiFeature: true
```

Only `paired` and `agent-led` are valid non-zero development values. Set
`aiFeature: true` independently when AI or ML is part of the project itself.
Omit `approximateTokens` when there is no defensible estimate. Totals describe
processed-token scale, not monetary spend, and are retained as data for possible
future use rather than displayed in the current interface.

Edit `src/data/project-milestones.ts` to add, remove, or reword contextual events. These should be events that affected Matthew's work, not a general model-release feed. Use a stable `id`, an exact ISO date, concise first-person relevance, and an authoritative `sourceUrl` for researched claims. Career starts are automatic; change their source data in `portfolio.toml`.

Edit `src/data/hackathon-wins.ts` to maintain competition results. Use the event's closing date, the official displayed project and hackathon names, exact award labels, a short technical description, the public repository, and the official Devpost, DoraHacks, or organizer submission URL. Keep multiple prizes on one result rather than creating duplicate timeline entries.

The event layout, line, dots, and mobile cutoff live in `src/pages/projects.astro`. Keep project rows free of the rail and avoid adding client-side layout measurement; the timeline is intentionally CSS-only.

To add another interactive project, pass an `{ id, label }` action to `ProjectCard.astro` and register the matching callback in `src/lib/project-actions.ts`. The ID crosses Astro's static HTML boundary; the callback remains in the client module. Keep ordinary Website and GitHub destinations as links.

## Configuration

There are no environment variables or remote runtime feeds. The relevant configuration is:

- project `date`, optional development `ai`, and optional `aiFeature` frontmatter;
- enabled jobs and their `start` dates in `portfolio.toml`;
- curated entries in `src/data/project-milestones.ts`;
- curated team results in `src/data/hackathon-wins.ts`;
- the `52rem` desktop/mobile journey breakpoint.

Dates are formatted in UTC so date-only values cannot move into the preceding month in western time zones.

## Dependencies

- Astro content collections validate and load project frontmatter.
- `ProjectDemoModal.astro`, `CodeDemoModal.astro`, and `src/lib/project-actions.ts` provide the interactive project demos.
- `portfolio.toml` and `src/lib/config.ts` provide career milestones.
- The shared Bauhaus color tokens and typography come from `src/styles/global.css`.
