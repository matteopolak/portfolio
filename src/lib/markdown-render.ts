/*
 * Markdown to HTML for the workspace preview. Everything here is pure (no
 * DOM), so it runs under `node --test`; `markdown-preview.ts` adds the DOM
 * side and a DOMPurify pass on top.
 *
 * Safety does not depend on that pass: raw HTML in the source is shown as
 * text, and only http(s)/mailto, in-document and workspace-relative links
 * become anchors.
 */
import { Marked, Renderer, type Token, type Tokens } from 'marked';

/**
 * How a `.md` source tab is shown on phones, where its rendered view replaces
 * the source in place (wider layouts open a separate preview tab instead).
 */
export type MarkdownView = 'source' | 'preview';

export const isMarkdownPath = (path: string | undefined) =>
  path !== undefined && /\.(md|markdown)$/iu.test(path);

/**
 * The phone view for a markdown file: the saved choice, else the rendered
 * preview, because a phone visitor opening a README wants to read it. An
 * empty file has nothing to show yet, so it opens as source.
 */
export function markdownView(
  choice: MarkdownView | undefined,
  empty = false
): MarkdownView {
  if (empty) return 'source';
  return choice ?? 'preview';
}

/**
 * Parses the stored choice: `source` or `preview`, or the older
 * `{"narrow": ...}` record. Anything else is no choice.
 */
export function parseViewChoice(
  stored: string | null
): MarkdownView | undefined {
  if (stored === 'source' || stored === 'preview') return stored;
  try {
    const value = JSON.parse(stored ?? '{}') as Record<string, unknown>;
    return value.narrow === 'source' || value.narrow === 'preview'
      ? value.narrow
      : undefined;
  } catch {
    return undefined;
  }
}

export type ResolvedLink =
  /** A file in the workspace, opened in the editor. */
  | { kind: 'file'; path: string; anchor?: string }
  /** A heading in the same document. */
  | { kind: 'anchor'; anchor: string }
  /** Opens in a new tab. */
  | { kind: 'external'; href: string }
  /** A relative path that names no workspace file. */
  | { kind: 'missing'; path: string }
  /** `javascript:`, `data:` and other schemes; rendered as plain text. */
  | { kind: 'blocked' };

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Joins `target` onto the folder of `from` (both workspace paths, `/`
 * separated). A leading `/` starts at the workspace root. Returns undefined
 * when `..` climbs above the root.
 */
export function joinPath(from: string, target: string): string | undefined {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/** Classifies a link's `href` written in the markdown file at `from`. */
export function resolveLink(
  href: string,
  from: string,
  files: Iterable<string>
): ResolvedLink {
  const trimmed = href.trim();
  if (trimmed.startsWith('#'))
    return { kind: 'anchor', anchor: decode(trimmed.slice(1)) };
  if (trimmed.startsWith('//'))
    return { kind: 'external', href: `https:${trimmed}` };
  // Browsers ignore control characters and whitespace inside a scheme
  // (`java\tscript:`), so test the scheme with those removed.
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(
    [...trimmed].filter((char) => char > ' ').join('')
  );
  if (scheme) {
    return /^(https?|mailto)$/iu.test(scheme[1])
      ? { kind: 'external', href: trimmed }
      : { kind: 'blocked' };
  }
  const hash = trimmed.indexOf('#');
  const anchor = hash === -1 ? undefined : decode(trimmed.slice(hash + 1));
  const target = decode(
    (hash === -1 ? trimmed : trimmed.slice(0, hash)).replace(/\?.*$/su, '')
  );
  const path = joinPath(from, target);
  if (path === undefined || path === '')
    return { kind: 'missing', path: target };
  const names = new Set(files);
  if (names.has(path)) return { kind: 'file', path, anchor };
  return { kind: 'missing', path };
}

/** GitHub-style heading slug: lower case, punctuation dropped, spaces to `-`. */
export function slug(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/gu, '-');
}

export const escapeHtml = (text: string) =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

/** Decodes the few entities marked leaves in heading text, for slugs. */
const unescapeHtml = (text: string) =>
  text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&');

const stripTags = (html: string) => html.replace(/<[^>]*>/gu, '');

export interface RenderOptions {
  /** Path of the file being rendered, for relative links. */
  path: string;
  /** Workspace file names, so links to them open in the editor. */
  files: Iterable<string>;
  /**
   * Highlights a fenced block. Must return escaped HTML, or undefined to
   * fall back to plain text.
   */
  highlight?: (code: string, language: string) => string | undefined;
}

/**
 * Renders `source` to HTML. Each top-level block carries `data-line`, its
 * first source line (1-based), for scroll sync. Headings carry
 * `data-anchor` (their slug) instead of an `id`, so they never collide with
 * ids on the page around the editor.
 */
export function renderMarkdown(source: string, options: RenderOptions) {
  const files = [...options.files];
  const slugs = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      // Raw HTML is shown as written, never interpreted.
      html: (token: Tokens.HTML | Tokens.Tag) =>
        'block' in token && token.block
          ? `<p class="md-raw">${escapeHtml(token.text.trimEnd())}</p>\n`
          : escapeHtml(token.text),
      heading(this: Renderer, { tokens, depth }: Tokens.Heading) {
        const html = this.parser.parseInline(tokens);
        const base = slug(unescapeHtml(stripTags(html))) || 'section';
        const seen = slugs.get(base) ?? 0;
        slugs.set(base, seen + 1);
        const anchor = seen ? `${base}-${seen}` : base;
        return `<h${depth} data-anchor="${escapeHtml(anchor)}">${html}</h${depth}>\n`;
      },
      link(this: Renderer, { href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const titled = title ? ` title="${escapeHtml(title)}"` : '';
        const link = resolveLink(href, options.path, files);
        switch (link.kind) {
          case 'external':
            return `<a href="${escapeHtml(link.href)}"${titled} data-md-external="">${text}</a>`;
          case 'anchor':
            return `<a href="#${escapeHtml(link.anchor)}"${titled} data-md-anchor="${escapeHtml(slug(link.anchor))}">${text}</a>`;
          case 'file': {
            const anchor = link.anchor
              ? ` data-md-anchor="${escapeHtml(slug(link.anchor))}"`
              : '';
            return `<a href="#${escapeHtml(link.path)}" title="${escapeHtml(title || `Open ${link.path}`)}" data-md-file="${escapeHtml(link.path)}"${anchor}>${text}</a>`;
          }
          case 'missing':
            return `<span class="md-missing" title="${escapeHtml(`${link.path} is not in this workspace`)}">${text}</span>`;
          case 'blocked':
            return `<span>${text}</span>`;
        }
      },
      image({ href, title, text }: Tokens.Image) {
        // Workspace files are text, so only web images can load.
        if (!/^https:\/\//iu.test(href.trim()))
          return `<span class="md-image-alt">${escapeHtml(text)}</span>`;
        const titled = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(href.trim())}" alt="${escapeHtml(text)}"${titled} loading="lazy" referrerpolicy="no-referrer">`;
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? '').trim().split(/\s/u)[0].toLowerCase();
        const body =
          (language && options.highlight?.(text, language)) || escapeHtml(text);
        const label = language ? ` data-lang="${escapeHtml(language)}"` : '';
        return `<pre class="md-code"${label}><code>${body}</code></pre>\n`;
      },
      table(this: Renderer, token: Tokens.Table) {
        // A scroller, so wide tables never widen the pane on a phone.
        return `<div class="md-table">${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
    },
  });
  const tokens = marked.lexer(source.replace(/\r\n?/gu, '\n'));
  let line = 1;
  let html = '';
  for (const token of tokens) {
    const start = line;
    line += (token.raw.match(/\n/gu) ?? []).length;
    if (token.type === 'space' || token.type === 'def') continue;
    const block = marked.parser(
      Object.assign([token] as Token[], { links: tokens.links })
    );
    html += block.replace(/^<([a-z][a-z0-9]*)/u, `<$1 data-line="${start}"`);
  }
  return html;
}
