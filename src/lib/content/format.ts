/** Formatting helpers shared by the HTML pages and every export format (plain TS). */

/** `May 2026`: the resume's month-and-year format. */
export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-CA', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `2026-05` for `<time datetime>` and JSON. */
export const isoMonth = (d: Date) => d.toISOString().slice(0, 7);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** `September 29, 2026`: long dates, in UTC so builds are timezone independent. */
export function longDate(d: Date, includeDay = true): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: includeDay ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

/** `a`, `a and b`, `a, b, and c`. */
export function joinNatural(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** The slug of a content collection id (`axum-extract.md` or `.mdx`). */
export const slugOf = (id: string) => id.replace(/\.mdx?$/, '');
