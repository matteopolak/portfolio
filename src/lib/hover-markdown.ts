/*
 * Markdown hovers from a language server, to HTML. Pure (no DOM), so it runs
 * under `node --test`; `code-editor.ts` sanitizes the result with DOMPurify
 * and colours the code blocks with the editor's highlighter.
 *
 * Only standard Markdown is read. Two shapes get a layout of their own:
 *
 * - A thematic break followed by a paragraph that is only emphasis
 *   (`---` then `*expands to*`) is a section label: it becomes a
 *   `.jai-hover__divider`, a rule with the label set into it.
 * - A fenced block whose every line is a `name :: (` declaration is an
 *   overload set: a count, then one row per declaration.
 */
import { Marked, Renderer, type Token, type Tokens } from 'marked';
import { escapeHtml } from './markdown-render.ts';
import type { MarkupText } from './jai/lsp-types.ts';

/** The text of a hover result when the server sent it as Markdown. */
export function markdownHover(contents: MarkupText): string | undefined {
  if (typeof contents !== 'object' || Array.isArray(contents)) return;
  const { kind, value } = contents as { kind?: unknown; value?: unknown };
  return kind === 'markdown' && typeof value === 'string' ? value : undefined;
}

const overloadLine = /^[^\s:]+ :: \(/u;

const codeBlock = (text: string, language: string, className = '') =>
  `<pre${className ? ` class="${className}"` : ''} data-lang="${escapeHtml(language)}"><code>${escapeHtml(text)}</code></pre>\n`;

const marked = new Marked({
  gfm: true,
  renderer: {
    // Raw HTML is shown as written, never interpreted.
    html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
    // Hovers are not navigable: a link shows its text.
    link(this: Renderer, { tokens }: Tokens.Link) {
      return this.parser.parseInline(tokens);
    },
    image: ({ text }: Tokens.Image) => escapeHtml(text),
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? '').trim().split(/\s/u)[0].toLowerCase();
      const lines = text.split('\n');
      if (lines.length > 1 && lines.every((line) => overloadLine.test(line)))
        return (
          `<div class="jai-hover__count">${lines.length} overloads</div>\n` +
          lines
            .map((line) => codeBlock(line, language, 'jai-hover__overload'))
            .join('')
        );
      return codeBlock(text, language);
    },
  },
});

/** A paragraph that holds nothing but one emphasized run: a section label. */
function sectionLabel(token: Token | undefined): string | undefined {
  if (token?.type !== 'paragraph') return;
  const inline = (token as Tokens.Paragraph).tokens;
  if (inline.length !== 1 || inline[0].type !== 'em') return;
  return (inline[0] as Tokens.Em).text;
}

export function renderHoverMarkdown(source: string): string {
  const tokens = marked.lexer(source.replace(/\r\n?/gu, '\n'));
  const blocks = tokens.filter((token) => token.type !== 'space');
  let html = '';
  for (let i = 0; i < blocks.length; i++) {
    const label =
      blocks[i].type === 'hr' ? sectionLabel(blocks[i + 1]) : undefined;
    if (label !== undefined) {
      // `em.text` is the source; render it so escapes (`\*`) resolve.
      const text = marked.parseInline(label) as string;
      html += `<div class="jai-hover__divider" role="separator">${text}</div>\n`;
      i++;
      continue;
    }
    html += marked.parser(
      Object.assign([blocks[i]] as Token[], { links: tokens.links })
    );
  }
  return html;
}
