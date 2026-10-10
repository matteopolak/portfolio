/*
 * Source highlighting for `.md` files in the editor (the rendered view is
 * markdown-preview.ts). `syntaxFor` in code-editor.ts returns
 * `markdownSyntax` for markdown paths.
 *
 * The editor's shared HighlightStyle colours `processingInstruction` as a Jai
 * directive (red), and @lezer/markdown tags every markup character (`#`,
 * `*`, `` ` ``, `>`, `-`) with it. So the marks are re-tagged with tags of
 * their own here, which only this file's style knows about (see the note on
 * `markdownTags` for why the selectors name any parent).
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Tag, styleTags, tags } from '@lezer/highlight';
import { jaiLanguage } from './jai/language.ts';
import { tomlLanguage } from './toml-language.ts';

const headingMark = Tag.define();
const listMark = Tag.define();
const markup = Tag.define();
const inlineCode = Tag.define();

// `*/Node` (any parent) gives each rule a context, so it sorts ahead of
// @lezer/markdown's own context-free rule. Since @lezer/highlight 1.2.2 rules
// for the same node are merged instead of replaced, so a plain `HeaderMark`
// here would lose to the `processingInstruction` default.
const markdownTags = styleTags({
  '*/HeaderMark': headingMark,
  '*/ListMark': listMark,
  '*/EmphasisMark */CodeMark */LinkMark */QuoteMark */HardBreak': markup,
  '*/InlineCode': inlineCode,
});

// Colours come from the `--ide-*` tokens, like the rest of the editor theme.
const markdownColors = HighlightStyle.define([
  {
    tag: [tags.heading, headingMark],
    color: 'color-mix(in oklch, var(--accent-2-light) 55%, white)',
    fontWeight: '700',
  },
  { tag: tags.strong, color: 'var(--ide-fg-strong)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: markup, color: 'var(--ide-faint)' },
  { tag: listMark, color: 'var(--ide-syntax-keyword)' },
  {
    tag: inlineCode,
    color: 'var(--ide-syntax-string)',
    backgroundColor: 'var(--ide-raised)',
  },
  // Fenced blocks without a known language, and the fence's info string.
  { tag: tags.monospace, color: 'var(--ide-syntax-string)' },
  { tag: tags.labelName, color: 'var(--ide-syntax-type)' },
  {
    tag: tags.link,
    color: 'color-mix(in oklch, var(--accent-2-light) 55%, white)',
  },
  {
    tag: tags.url,
    color: 'var(--ide-muted)',
    textDecoration: 'underline',
  },
  { tag: tags.quote, color: 'var(--ide-muted)', fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: 'var(--ide-faint)' },
]);

/** Fenced blocks tagged `jai` or `toml` use the editor's own grammars. */
const codeLanguages = (info: string) => {
  const name = info.trim().toLowerCase();
  return name === 'jai' ? jaiLanguage : name === 'toml' ? tomlLanguage : null;
};

export const markdownSyntax: Extension = [
  markdown({
    base: markdownLanguage,
    codeLanguages,
    extensions: { props: [markdownTags] },
  }),
  syntaxHighlighting(markdownColors),
  // Prose lines wrap instead of scrolling sideways.
  EditorView.lineWrapping,
];
