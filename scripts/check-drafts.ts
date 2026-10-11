/*
 * Draft check, run after `pnpm build` (`pnpm check:drafts`, and in CI). A post
 * with `published: false` must be absent from the production build: this finds
 * every draft in src/content/blog, collects markers from it (its title, its
 * `/blog/<slug>` URL and every `draft-marker-*` token in the post or its data
 * files) and fails if any marker appears in any file under dist/, JS chunks
 * included. It also fails if there is no draft to check, so the check stays
 * meaningful (keep src/content/blog/chart-demo.mdx as the fixture).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const blog = join(root, 'src', 'content', 'blog');
const dist = join(root, 'dist');

async function files(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}

interface Draft {
  slug: string;
  markers: Set<string>;
}

const drafts: Draft[] = [];
for (const entry of await readdir(blog, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
  const source = await readFile(join(blog, entry.name), 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  if (!/^published:\s*false\s*$/m.test(frontmatter)) continue;
  const slug = entry.name.replace(/\.mdx?$/, '');
  const markers = new Set<string>([`/blog/${slug}`]);
  const title = /^title:\s*(.+)$/m
    .exec(frontmatter)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (title) markers.add(title);
  let text = source;
  const dataDirectory = join(blog, slug, 'data');
  for (const file of await files(dataDirectory).catch(() => [])) {
    text += '\n' + (await readFile(file, 'utf8'));
  }
  for (const [marker] of text.matchAll(/draft-marker-[a-z0-9-]+/g))
    markers.add(marker);
  drafts.push({ slug, markers });
}

const errors: string[] = [];
if (drafts.length === 0)
  errors.push(
    'no draft post found: keep at least one `published: false` fixture'
  );

const built = await files(dist);
if (built.length === 0)
  throw new Error('dist/ is empty: run `pnpm build` first.');
for (const file of built) {
  const content = await readFile(file);
  for (const draft of drafts)
    for (const marker of draft.markers)
      if (content.includes(marker))
        errors.push(
          `${relative(dist, file)} contains "${marker}" from draft ${draft.slug}`
        );
}

if (errors.length) {
  console.error(
    `Draft check failed (${errors.length}):\n- ${errors.join('\n- ')}`
  );
  process.exit(1);
}
console.log(
  `Draft check passed: ${drafts.length} draft(s) absent from ${built.length} files.`
);
