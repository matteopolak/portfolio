/*
 * Sätteri hast plugin: gives every Markdown `h2`–`h4` a GitHub-style section
 * link. User plugins run before Astro's own heading-id plugin, so this one
 * assigns the id (same rules as github-slugger: lowercase, punctuation
 * dropped, spaces to `-`, `-1`, `-2`… for repeats) and Astro keeps it for the
 * TOC. The link has no text (the `#` is CSS `content`), so heading text in
 * the TOC stays clean. Plain TS for `node --test`.
 */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

interface VisitContext {
  textContent(node: HastNode): string;
}

export function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    let count = seen.get(base) ?? 0;
    while (seen.has(slug)) slug = `${base}-${++count}`;
    seen.set(base, count);
    seen.set(slug, 0);
    return slug;
  };
}

/** A factory: Sätteri calls it once per document, so repeat counts reset. */
export const headingAnchorPlugin = () => {
  const slug = slugger();
  return {
    name: 'heading-anchor',
    element: {
      filter: ['h2', 'h3', 'h4'],
      visit(node: HastNode, ctx: VisitContext) {
        const existing = node.properties?.id;
        const id =
          typeof existing === 'string' ? existing : slug(ctx.textContent(node));
        if (!id) return;
        return {
          ...node,
          properties: { ...node.properties, id },
          children: [
            ...(node.children ?? []),
            {
              type: 'element',
              tagName: 'a',
              properties: {
                className: ['heading-anchor'],
                href: `#${id}`,
                ariaLabel: 'Link to this section',
              },
              children: [],
            },
          ],
        };
      },
    },
  };
};
