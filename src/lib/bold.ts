/*
 * The `*word*` emphasis syntax used in portfolio.toml bullets. This is the only
 * place that parses it; each output format has a renderer here.
 */
const EMPHASIS = /\*([^*]+)\*/g;

/** HTML: escapes the text and turns `*word*` into `<strong>`. */
export function boldHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(EMPHASIS, '<strong>$1</strong>');
}

/** Markdown: `*word*` becomes `**word**`. */
export function boldMarkdown(text: string): string {
  return text.replace(EMPHASIS, '**$1**');
}

/** Plain text: the markers are dropped. */
export function boldPlain(text: string): string {
  return text.replace(EMPHASIS, '$1');
}

/** Kept for existing callers: the HTML renderer. */
export const bold = boldHtml;
