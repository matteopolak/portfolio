# Resume Technical Skills Refresh

## Goal

Replace the dated framework inventory with a compact, credible summary of current
systems, agent, API, and infrastructure experience. The section must remain one
page in the generated resume and use the same source data on the website.

## Recommended structure

Use three rows:

- **Languages:** Rust, TypeScript, Go, Python, C++ (20/23/26), Zig, Java, JavaScript
- **Protocols & Standards:** Model Context Protocol (MCP), Agent2Agent (A2A), OpenAPI,
  Protocol Buffers (Protobuf), GraphQL, WebSockets
- **Platforms & Tooling:** PostgreSQL, Redis, Docker, AWS, GCP, OpenTelemetry, LLVM,
  Bazel

This structure is preferred over a generic "Technologies" row because it tells a
reader what kind of expertise each item represents. It is also preferred over
keeping "Libraries" because frameworks such as Express.js, Flask, and SvelteKit
are implementation details already demonstrated by project and work history.

## Selection rationale

The list uses a substantial-project-or-production-use evidence bar.

- Remove C and add Zig as requested.
- Group the C++ standards under one ATS-readable `C++` entry instead of repeating
  the language three times.
- Remove Svelte and Vue from Languages because they are frameworks.
- Replace Swagger with OpenAPI to avoid listing a specification and one of its
  tool ecosystems as separate skills.
- Use full protocol names with abbreviations so both recruiters and keyword
  searches can recognize MCP, A2A, and Protobuf.
- Retain PostgreSQL, Redis, cloud platforms, Docker, and OpenTelemetry because
  they remain relevant across recent work.
- Add LLVM and Bazel because the Owl compiler provides direct, differentiated
  evidence for both.
- Drop MySQL, MongoDB, InfluxDB, Ansible, OpenStack, and Observe to reduce older
  or lower-signal inventory.
- Exclude generic workflow tools such as Git and GitHub Actions; proficiency is
  expected and does not differentiate this resume.

## Data and rendering changes

Rename the `skills.libraries` field to `skills.protocols` in `portfolio.toml` and
the TypeScript config type. Update the Astro skills component and Typst resume to
render the new labels:

- `Languages`
- `Protocols & Standards`
- `Platforms & Tooling`

Keep the existing three-array data model. A generalized list of arbitrary skill
groups would add complexity without a current need.

## Validation

- Build the Astro site and run lint and formatting checks.
- Compile the Typst resume.
- Confirm the generated PDF remains exactly one page.
- Confirm the old `libraries` field and label no longer appear in source or
  rendered text.

