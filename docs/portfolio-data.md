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
    └── resume/resume.typ        # Typst resume template (→ resume GitHub release → /resume.pdf)
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

## Resume PDF on the site

`.github/workflows/resume.yml` compiles `resume/resume.typ` on pushes that touch `resume/**` or `portfolio.toml` and publishes it as the `resume` GitHub release. `scripts/fetch-resume.ts` (`pnpm fetch:resume`, run by `prebuild`/`predev`) downloads that release asset to the gitignored `public/resume.pdf`, so the nav's Résumé link is the same-origin `/resume.pdf`.

- On Cloudflare Pages (`CF_PAGES=1`) it always downloads, and a failed download fails the build (Pages keeps the previous deployment).
- Locally an existing `public/resume.pdf` is kept (e.g. one from `pnpm resume`); a failed download only warns.
- Gotcha: the Pages build and the resume workflow start on the same push, so a resume change can deploy with the previous PDF until the next deploy. Fix by retrying the Pages deployment, or have `resume.yml` call a Pages deploy hook after publishing.
