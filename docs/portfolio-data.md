# Portfolio Data

All resume/portfolio content lives in `portfolio.toml` at the project root. It is the single source of truth for both the website and the compiled resume PDF. It is read once at Vite bundle time via a `?raw` import, so changes take effect on the next `pnpm dev` or `pnpm build`.

## How it works

`portfolio.toml` → `src/lib/config.ts` (`?raw` import + `smol-toml` parse) → individual components.

```
portfolio.toml
    ├── src/lib/config.ts        # parse + filter (website)
    │    ├── Header.astro        # name, contact, socials
    │    ├── Experience.astro    # config.job[]
    │    ├── Projects.astro      # config.project[]
    │    ├── Education.astro     # config.education
    │    ├── Skills.astro        # config.skills
    │    └── Achievements.astro  # config.achievements.items
    └── resume/resume.typ        # Typst resume template (→ public/resume.pdf)
```

`src/lib/config.ts` exports:
- `default` — the full parsed config object
- `jobs` — `config.job` filtered to `enabled !== false`
- `projects` — `config.project` filtered to `enabled !== false`
- `formatDate(d: Date): string` — formats a date as `"Sep 2025"`

## Toggling entries

Set `enabled = false` on any `[[job]]` or `[[project]]` to hide it from the site without deleting it.

```toml
[[project]]
github = "matteopolak/grill"
enabled = false   # hidden from site
title = "Grill"
```

## Adding a job

```toml
[[job]]
id = "new-company-role"
title = "Software Engineer Intern"
company = "Acme Corp"
location = "Toronto, ON, Canada"
start = 2026-09-01
end = 2026-12-01
achievements = [
  "Did something impactful with *TypeScript*.",
]
```

- `start` and `end` are TOML local-dates (`YYYY-MM-DD`). `end` is optional (omit for "Present").
- `*word*` in achievement strings renders as `<strong>word</strong>`.

## Adding a project

```toml
[[project]]
github = "username/repo"
title = "My Project"
tags = ["Rust", "TypeScript"]
achievements = [
  "Built something cool with *Rust*.",
]
```

## TypeScript types

See `src/types/config.ts` for the full interface definitions.

## Configuration

No env vars. The only file to edit is `portfolio.toml`.
