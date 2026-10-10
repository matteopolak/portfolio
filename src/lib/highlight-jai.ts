import { tagHighlighter, highlightTree, tags } from '@lezer/highlight';
import type { DocStyle } from './jai/doc-comments.ts';
import {
  docCommentTags,
  formatPercentTag,
  formatSpecifierTag,
  jaiLanguage,
} from './jai/language.ts';

/*
 * Build-time Jai highlighting for blog code blocks. It runs the same Lezer
 * stream parser as the editor (jai/language.ts, imported read-only) and maps
 * its tags to the same token set as the editor's HighlightStyle in
 * code-editor.ts, but emits Shiki-style spans: each carries `--shiki-light`
 * and `--shiki-dark`, which global.css and themeCss() already switch per site
 * theme. Plain TS so `node --test` can cover it; no client JS.
 */
export interface JaiTokenStyle {
  light: string;
  dark: string;
  bold?: boolean;
  italic?: boolean;
}

/*
 * The dark values are the editor's `--ide-syntax-*` tokens (CodeWorkspace.svelte).
 * The light values are the same hues darkened for the paper background, built
 * from the theme's own `-text` accents so they follow the site theme.
 */
export const jaiTokenStyles = {
  keyword: {
    light: 'var(--accent-3-text)',
    dark: 'color-mix(in oklch, var(--accent-3-light) 88%, white)',
    bold: true,
  },
  type: {
    light: 'var(--accent-2-text)',
    dark: 'color-mix(in oklch, var(--accent-2-light) 52%, white)',
  },
  function: { light: 'var(--ink)', dark: 'oklch(94% 0.035 91)' },
  variable: { light: 'var(--ink)', dark: 'oklch(90% 0.016 91)' },
  string: { light: 'oklch(42% 0.11 150)', dark: 'oklch(81% 0.11 150)' },
  format: {
    light: 'oklch(44% 0.17 310)',
    dark: 'oklch(78% 0.15 310)',
    bold: true,
  },
  formatPercent: { light: 'oklch(48% 0.09 310)', dark: 'oklch(76% 0.07 310)' },
  comment: {
    light: 'var(--muted)',
    dark: 'oklch(76% 0.014 270)',
    italic: true,
  },
  number: {
    light: 'var(--accent-1-text)',
    dark: 'color-mix(in oklch, var(--accent-1-light) 55%, white)',
  },
  directive: {
    light: 'color-mix(in oklch, var(--accent-1-text) 70%, var(--ink))',
    dark: 'color-mix(in oklch, var(--accent-1-light) 72%, white)',
  },
  punctuation: {
    light: 'color-mix(in oklch, var(--ink) 72%, var(--paper-bright))',
    dark: 'oklch(80% 0.01 270)',
  },
} satisfies Record<string, JaiTokenStyle>;

export type JaiToken = keyof typeof jaiTokenStyles;

// Order matters: the first matching rule of the most specific tag wins, as in the editor.
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'keyword' },
  { tag: [tags.typeName, tags.className], class: 'type' },
  { tag: tags.function(tags.variableName), class: 'function' },
  { tag: tags.variableName, class: 'variable' },
  { tag: formatSpecifierTag, class: 'format' },
  { tag: formatPercentTag, class: 'formatPercent' },
  { tag: [tags.string, tags.character], class: 'string' },
  { tag: tags.comment, class: 'comment' },
  { tag: tags.number, class: 'number' },
  { tag: [tags.processingInstruction, tags.annotation], class: 'directive' },
  { tag: [tags.operator, tags.punctuation], class: 'punctuation' },
  // Markdown in comments: added on top of `comment` (see jai/doc-comments.ts).
  ...Object.entries(docCommentTags).map(([style, tag]) => ({
    tag,
    class: `doc-${style}`,
  })),
]);

export interface JaiSpan {
  text: string;
  /** Absent for text with no colour of its own (whitespace, unknown tokens). */
  token?: JaiToken;
  /** Markdown styles inside a comment (`**bold**`, `` `code` ``, `[link]`). */
  doc?: DocStyle[];
}

/** The source split into per-line runs of coloured text. Joined, the text equals the input. */
export function highlightJai(source: string): JaiSpan[][] {
  const lines: JaiSpan[][] = [[]];
  const push = (text: string, token?: JaiToken, doc?: DocStyle[]) => {
    const parts = text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part)
        lines[lines.length - 1].push({
          text: part,
          token,
          ...(doc?.length ? { doc } : {}),
        });
    });
  };
  const tree = jaiLanguage.parser.parse(source);
  let position = 0;
  highlightTree(tree, highlighter, (from, to, classes) => {
    if (from > position) push(source.slice(position, from));
    const names = classes.split(' ');
    const doc = names
      .filter((name) => name.startsWith('doc-'))
      .map((name) => name.slice(4) as DocStyle);
    // Several classes can match one range; the last is the most specific.
    const token = names.filter((name) => !name.startsWith('doc-')).pop();
    push(
      source.slice(from, to),
      token && token in jaiTokenStyles ? (token as JaiToken) : undefined,
      doc
    );
    position = to;
  });
  if (position < source.length) push(source.slice(position));
  return lines;
}

/**
 * How comment Markdown changes a comment's style, as in the editor: bold
 * `**strong**` and headings, upright `` `code` ``, links in the type colour,
 * list markers in the punctuation colour. Markers stay visible.
 */
function withDoc(
  style: JaiTokenStyle,
  doc: readonly DocStyle[]
): JaiTokenStyle {
  const has = (name: DocStyle) => doc.includes(name);
  const colour = has('link')
    ? jaiTokenStyles.type
    : has('list')
      ? jaiTokenStyles.punctuation
      : style;
  return {
    light: colour.light,
    dark: colour.dark,
    bold: style.bold || has('strong') || has('heading'),
    italic: style.italic && !has('code') && !has('list'),
  };
}

/** The inline style of a span: the two palettes as variables, like Shiki's dual themes. */
export function jaiSpanStyle(
  token: JaiToken,
  doc: readonly DocStyle[] = []
): string {
  const { light, dark, bold, italic } = withDoc(
    jaiTokenStyles[token] as JaiTokenStyle,
    doc
  );
  return [
    `--shiki-light:${light}`,
    `--shiki-dark:${dark}`,
    ...(bold
      ? ['--shiki-light-font-weight:600', '--shiki-dark-font-weight:600']
      : []),
    ...(italic
      ? ['--shiki-light-font-style:italic', '--shiki-dark-font-style:italic']
      : []),
  ].join(';');
}

export interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: (HastElement | { type: 'text'; value: string })[];
}

const el = (
  tagName: string,
  properties: Record<string, unknown>,
  children: HastElement['children']
): HastElement => ({ type: 'element', tagName, properties, children });

/** A complete `<pre>` with Shiki's structure (`astro-code`, one `.line` per line). */
export function jaiBlockHast(source: string): HastElement {
  const lines = highlightJai(source.replace(/\n$/, ''));
  const code: HastElement['children'] = [];
  lines.forEach((line, index) => {
    if (index > 0) code.push({ type: 'text', value: '\n' });
    code.push(
      el(
        'span',
        { className: ['line'] },
        line.map(({ text, token, doc }) =>
          token
            ? el('span', { style: jaiSpanStyle(token, doc) }, [
                { type: 'text', value: text },
              ])
            : { type: 'text', value: text }
        )
      )
    );
  });
  return el(
    'pre',
    {
      className: ['astro-code', 'astro-code-themes', 'jai-code'],
      style:
        '--shiki-light:var(--ink);--shiki-dark:oklch(90% 0.016 91); overflow-x: auto;',
      tabIndex: 0,
      dataLanguage: 'jai',
    },
    [el('code', {}, code)]
  );
}
