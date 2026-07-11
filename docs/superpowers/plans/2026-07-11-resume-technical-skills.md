# Resume Technical Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the resume's dated library inventory with evidence-backed language, AI agent, protocol, and platform skills while keeping the PDF to one page.

**Architecture:** Keep `portfolio.toml` as the shared data source for the Astro site and Typst resume. Replace the `libraries` array with explicit `agents` and `protocols` arrays; retain a fixed four-row model and render the same accurate labels in both outputs.

**Tech Stack:** TOML, TypeScript, Astro, Typst, pnpm

---

### Task 1: Update the shared skills model and content

**Files:**

- Modify: `portfolio.toml:76-79`
- Modify: `src/types/config.ts:5-18`

- [ ] **Step 1: Install the locked dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: pnpm completes successfully without changing `pnpm-lock.yaml`.

- [ ] **Step 2: Verify the new schema contract is initially absent**

Run:

```bash
rg -n 'agents|protocols|MCP|A2A' portfolio.toml src/types/config.ts
```

Expected: no matches and exit status 1.

- [ ] **Step 3: Replace the skills data**

Change the skills block in `portfolio.toml` to:

```toml
[skills]
languages = ["Rust", "TypeScript", "Go", "Python", "C++ (20/23/26)", "Zig", "Java", "JavaScript"]
agents = ["MCP", "A2A", "Tool Calling", "Agent Evals", "Browser Agents", "Cursor", "Claude Code", "GitHub Copilot"]
protocols = ["OpenAPI", "Protobuf", "GraphQL", "WebSockets"]
tools = ["PostgreSQL", "Redis", "Docker", "AWS", "GCP", "OpenTelemetry", "LLVM", "Bazel"]
```

- [ ] **Step 4: Rename the typed config field**

Change the `skills` member in `src/types/config.ts` to:

```ts
skills: { languages: string[]; agents: string[]; protocols: string[]; tools: string[] };
```

- [ ] **Step 5: Verify the shared data contract**

Run:

```bash
rg -n 'agents|protocols|MCP|A2A|C\+\+ \(20/23/26\)' portfolio.toml src/types/config.ts
```

Expected: the new `agents` and `protocols` fields appear in both files, and the new content appears in `portfolio.toml`.

### Task 2: Render the new categories on the site and resume

**Files:**

- Modify: `src/components/Skills.astro:6-22`
- Modify: `resume/resume.typ:108-118`

- [ ] **Step 1: Verify the old rendering labels are present**

Run:

```bash
rg -n 'skills\.libraries|\*Libraries\*|>Libraries<' src/components/Skills.astro resume/resume.typ
```

Expected: matches in both renderers.

- [ ] **Step 2: Update the Astro renderer**

Replace the libraries row in `src/components/Skills.astro` with these two rows:

```astro
<div class="flex gap-3">
  <dt class="font-semibold min-w-24 text-base-content/70">
    AI & Agent Systems
  </dt>
  <dd class="m-0">{skills.agents.join(', ')}</dd>
</div>
<div class="flex gap-3">
  <dt class="font-semibold min-w-24 text-base-content/70">APIs & Protocols</dt>
  <dd class="m-0">{skills.protocols.join(', ')}</dd>
</div>
```

Replace the Tools label with:

```astro
<dt class="font-semibold min-w-24 text-base-content/70">Platforms & Tooling</dt>
```

- [ ] **Step 3: Update the Typst renderer**

Replace the two old skill labels and the libraries field in `resume/resume.typ` with:

```typst
*AI & Agent Systems*: #config.skills.agents.join(", ")
#space(h: .8em)
*APIs & Protocols*: #config.skills.protocols.join(", ")
#space(h: .8em)
*Platforms & Tooling*: #config.skills.tools.join(", ")
```

- [ ] **Step 4: Verify old references are gone**

Run:

```bash
if rg -n 'skills\.libraries|\*Libraries\*|>Libraries<' portfolio.toml src/types/config.ts src/components/Skills.astro resume/resume.typ; then
  exit 1
fi
```

Expected: no matches and exit status 0.

### Task 3: Validate both rendered outputs

**Files:**

- Modify: `public/resume.pdf`

- [ ] **Step 1: Run repository quality checks**

Run:

```bash
pnpm format:check
pnpm lint
pnpm build
```

Expected: all three commands exit successfully.

- [ ] **Step 2: Confirm the website contains the new labels**

Run:

```bash
rg -n 'AI &amp; Agent Systems|MCP|APIs &amp; Protocols|Platforms &amp; Tooling' dist/index.html
```

Expected: all four strings appear in the generated home page.

- [ ] **Step 3: Compile the resume**

Run:

```bash
pnpm resume
```

Expected: Typst compiles `public/resume.pdf` successfully.

- [ ] **Step 4: Confirm the PDF remains one page**

Run:

```bash
pdfinfo public/resume.pdf | rg '^Pages:\s+1$'
```

Expected: `Pages: 1`.

- [ ] **Step 5: Confirm the PDF contains the new section text**

Run:

```bash
pdftotext public/resume.pdf - | rg 'AI & Agent Systems|MCP|APIs & Protocols|Platforms & Tooling'
```

Expected: the four new strings appear in extracted PDF text.

- [ ] **Step 6: Commit the implementation**

Run:

```bash
git add portfolio.toml src/types/config.ts src/components/Skills.astro resume/resume.typ public/resume.pdf
git commit -m "feat: modernize resume technical skills"
```

Expected: one implementation commit containing the shared data, both renderers, and generated PDF.
