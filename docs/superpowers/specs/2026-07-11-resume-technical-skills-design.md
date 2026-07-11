# Resume Technical Skills Refresh

## Goal

Replace the dated framework inventory with a compact, credible summary tailored
to big-tech, quantitative software engineering, AI, and startup roles. The
section must emphasize current agent-systems experience, remain one page in the
generated resume, and use the same source data on the website.

## Recommended structure

Use four rows:

- **Languages:** Rust, TypeScript, Go, Python, C++ (20/23/26), Zig, Java, JavaScript
- **AI & Agent Systems:** MCP, A2A, Tool Calling, Agent Evals, Browser Agents,
  Cursor, Claude Code, GitHub Copilot
- **APIs & Protocols:** OpenAPI, Protobuf, GraphQL, WebSockets
- **Platforms & Tooling:** PostgreSQL, Redis, Docker, AWS, GCP, OpenTelemetry, LLVM,
  Bazel

This structure is preferred over a generic "Technologies" row because it
distinguishes agent engineering from API and data interchange experience. AI
coding tools stay in the agent row rather than appearing equivalent to databases
or infrastructure. The structure is also preferred over keeping "Libraries"
because frameworks such as Express.js, Flask, and SvelteKit are implementation
details already demonstrated by project and work history.

## Selection rationale

The list uses a substantial-project-or-production-use evidence bar.

- Remove C and add Zig as requested.
- Group the C++ standards under one ATS-readable `C++` entry instead of repeating
  the language three times.
- Remove Svelte and Vue from Languages because they are frameworks.
- Replace Swagger with OpenAPI to avoid listing a specification and one of its
  tool ecosystems as separate skills.
- Use the standard MCP, A2A, and Protobuf names. Expanded names caused the final
  tooling row to overflow to a second PDF page, while the conventional acronyms
  preserve both scanability and keyword recognition.
- Include Tool Calling, Agent Evaluation, and Browser Automation because the
  recent Microsoft AI and Shopify experience directly demonstrates them.
- Include Cursor, Claude Code, and GitHub Copilot to signal an AI-native
  development workflow without presenting them as infrastructure expertise.
- Retain PostgreSQL, Redis, cloud platforms, Docker, and OpenTelemetry because
  they remain relevant across recent work.
- Add LLVM and Bazel because the Owl compiler provides direct, differentiated
  evidence for both.
- Drop MySQL, MongoDB, InfluxDB, Ansible, OpenStack, and Observe to reduce older
  or lower-signal inventory.
- Exclude generic workflow tools such as Git and GitHub Actions; proficiency is
  expected and does not differentiate this resume.

## Data and rendering changes

Replace the `skills.libraries` field with `skills.agents` and `skills.protocols`
in `portfolio.toml` and the TypeScript config type. Update the Astro skills
component and Typst resume to render the new labels:

- `Languages`
- `AI & Agent Systems`
- `APIs & Protocols`
- `Platforms & Tooling`

Keep a fixed four-array data model. A generalized list of arbitrary skill groups
would add complexity without a current need.

## Validation

- Build the Astro site and run lint and formatting checks.
- Compile the Typst resume.
- Confirm the generated PDF remains exactly one page.
- Confirm the old `libraries` field and label no longer appear in source or
  rendered text.
