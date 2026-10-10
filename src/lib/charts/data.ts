import {
  parseChartData,
  type ChartDataByKind,
  type ChartKind,
} from './schema.ts';

/*
 * Loads and validates a chart data file at build time. Files live next to the
 * posts (`src/content/blog/<slug>/data/*.json`) and are found with Vite's
 * `import.meta.glob`, so this module only works inside Astro/Vite (the pure
 * pieces are in schema.ts, table.ts and geometry.ts).
 */
const files = import.meta.glob<unknown>('/src/content/blog/*/data/*.json', {
  eager: true,
  import: 'default',
});

export function loadChartData<K extends ChartKind>(
  kind: K,
  src: string
): ChartDataByKind[K] {
  const key = `/src/content/blog/${src.replace(/^\/+/, '')}`;
  if (!(key in files))
    throw new Error(
      `Chart data "${src}" not found. Put it at src/content/blog/<slug>/data/<name>.json and use src="<slug>/data/<name>.json".`
    );
  return parseChartData(kind, files[key], key);
}
