/*
 * The editor's syntax colours, and the DOM built from them outside the text:
 * highlighted code fragments and the hover / documentation panels. Shared by
 * `code-editor.ts` (hover, completion info, lint tooltips) and
 * `jai/lsp-extensions.ts` (signature help).
 */
import { HighlightStyle, type StreamLanguage } from '@codemirror/language';
import { tags, highlightTree } from '@lezer/highlight';
import DOMPurify from 'dompurify';
import { renderHoverMarkdown } from './hover-markdown.ts';
import {
  formatPercentTag,
  formatSpecifierTag,
  jaiLanguage,
} from './jai/language.ts';

// Colors resolve from the `--ide-*` tokens declared by CodeWorkspace.svelte.
export const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--ide-syntax-keyword)', fontWeight: '600' },
  { tag: [tags.typeName, tags.className], color: 'var(--ide-syntax-type)' },
  {
    tag: tags.function(tags.variableName),
    color: 'var(--ide-syntax-function)',
  },
  { tag: tags.variableName, color: 'var(--ide-fg)' },
  { tag: [tags.string, tags.character], color: 'var(--ide-syntax-string)' },
  {
    tag: formatSpecifierTag,
    color: 'var(--ide-syntax-format)',
    fontWeight: '650',
  },
  { tag: formatPercentTag, color: 'var(--ide-syntax-format-percent)' },
  {
    tag: tags.comment,
    color: 'var(--ide-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: tags.number, color: 'var(--ide-syntax-number)' },
  {
    tag: [tags.processingInstruction, tags.annotation],
    color: 'var(--ide-syntax-directive)',
  },
  { tag: [tags.operator, tags.punctuation], color: 'var(--ide-syntax-punct)' },
]);

/**
 * `source` as a fragment of highlighted spans. With `skip`/`length`, only that
 * slice is emitted, highlighted in the context of the whole source (a format
 * string is coloured as the argument of `print(...)`).
 */
export function highlighted(
  source: string,
  { parser }: StreamLanguage<unknown> = jaiLanguage,
  skip = 0,
  length = source.length - skip
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const end = skip + length;
  let at = skip;
  const plain = (to: number) => {
    if (to > at) fragment.append(source.slice(at, to));
    at = Math.max(at, to);
  };
  highlightTree(parser.parse(source), highlightStyle, (from, to, cls) => {
    from = Math.max(from, skip);
    to = Math.min(to, end);
    if (to <= from) return;
    plain(from);
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = source.slice(from, to);
    fragment.append(span);
    at = to;
  });
  plain(end);
  return fragment;
}

/** A format string literal on its own, highlighted as a `print` argument. */
export const formatLiteral = (source: string) =>
  highlighted(`print(${source})`, jaiLanguage, 6, source.length);

/**
 * Plain hover text is code: type signatures and declarations. Markdown
 * fences, when present, mark the code regions and the rest stays plain.
 */
function highlightedText(
  text: string,
  syntax: StreamLanguage<unknown>
): (Node | string)[] {
  if (!/```/u.test(text)) return [highlighted(text, syntax)];
  const nodes: (Node | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(highlighted(match[1].replace(/\n$/u, ''), syntax));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * A plain-text hover. Overload sets come back as one `name :: header` line
 * per procedure; long headers wrap, so each gets its own row, a rule between
 * rows and a count.
 */
export function plainHoverContent(
  text: string,
  syntax: StreamLanguage<unknown>
): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'jai-hover';
  const lines = text.split('\n');
  const overloads =
    lines.length > 1 && lines.every((line) => /^[^\s:]+ :: \(/u.test(line));
  if (!overloads) {
    dom.append(...highlightedText(text, syntax));
    return dom;
  }
  dom.classList.add('jai-hover--overloads');
  const count = document.createElement('div');
  count.className = 'jai-hover__count';
  count.textContent = `${lines.length} overloads`;
  dom.append(count);
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'jai-hover__overload';
    row.append(...highlightedText(line, syntax));
    dom.append(row);
  }
  return dom;
}

/**
 * Markdown from the language server (see `hover-markdown.ts`), sanitized,
 * with its code in the editor's colours. Fenced blocks tagged `fence` (or
 * untagged) and inline code are highlighted with `syntax`; other fences
 * (`text`: what `#run` printed) stay plain. A list is a format-string hover:
 * one row per `%`, the leading code of each row is the specifier, and a bold
 * one is the hovered row.
 */
export function markdownContent(
  markdown: string,
  syntax: StreamLanguage<unknown> = jaiLanguage,
  fence = 'jai'
): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'jai-hover jai-hover--markdown';
  dom.innerHTML = DOMPurify.sanitize(renderHoverMarkdown(markdown));
  for (const code of dom.querySelectorAll<HTMLElement>('pre > code')) {
    const lang = code.parentElement?.dataset.lang ?? '';
    if (lang !== '' && lang !== fence) continue;
    const source = code.textContent ?? '';
    // A string literal on its own is a format string: colour it as the
    // argument of a `print` call so its `%` specifiers stand out.
    code.replaceChildren(
      fence === 'jai' && /^"(?:[^"\\\n]|\\.)*"$/u.test(source)
        ? formatLiteral(source)
        : highlighted(source, syntax)
    );
  }
  for (const code of dom.querySelectorAll<HTMLElement>(':not(pre) > code')) {
    const row = code.closest('li');
    const leading =
      row &&
      (row.firstElementChild === code ||
        (row.firstElementChild?.tagName === 'STRONG' &&
          code.parentElement === row.firstElementChild));
    if (leading) code.classList.add('jai-hover__format-spec');
    else code.replaceChildren(highlighted(code.textContent ?? '', syntax));
  }
  for (const row of dom.querySelectorAll<HTMLElement>('li')) {
    row.classList.add('jai-hover__format-row');
    if (row.firstElementChild?.tagName === 'STRONG')
      row.dataset.current = 'true';
  }
  return dom;
}

/** Text with `code` spans highlighted as Jai, as jailint writes names and snippets. */
export function withCode(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  text.split(/(`[^`\n]+`)/u).forEach((part, index) => {
    if (index % 2 === 0) {
      if (part) fragment.append(part);
      return;
    }
    const code = document.createElement('code');
    code.append(highlighted(part.slice(1, -1)));
    fragment.append(code);
  });
  return fragment;
}
