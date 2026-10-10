import { jaiBlockHast } from './highlight-jai.ts';

/*
 * Sätteri hast plugin (Astro 7's Markdown/MDX pipeline): replaces
 * `language-jai` code blocks with our highlighter's output (see
 * highlight-jai.ts). `jai` is excluded from Shiki in astro.config.ts, so these
 * blocks arrive as plain `<pre><code class="language-jai">`, and user hast
 * plugins run after Astro's highlight plugin. Plain TS for `node --test`.
 */
interface HastLike {
  type: string;
  tagName?: string;
  properties?: { className?: unknown };
  data?: { lang?: string };
  children?: HastLike[];
}

export const isJaiCode = (node: HastLike | undefined) =>
  node?.type === 'element' &&
  node.tagName === 'code' &&
  (node.data?.lang === 'jai' ||
    (Array.isArray(node.properties?.className) &&
      node.properties.className.includes('language-jai')));

export const jaiHastPlugin = {
  name: 'jai-highlight',
  element: {
    filter: ['pre'],
    visit(node: HastLike, ctx: { textContent(node: HastLike): string }) {
      const code = node.children?.find((child) => child.type === 'element');
      if (!isJaiCode(code)) return;
      return jaiBlockHast(ctx.textContent(code!).replace(/\n$/, ''));
    },
  },
};
