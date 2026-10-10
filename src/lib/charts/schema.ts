import { z } from 'astro/zod';

/*
 * Data files for the blog's chart components: JSON next to the post at
 * `src/content/blog/<slug>/data/*.json`, referenced from MDX with
 * `src="<slug>/data/<name>.json"`. Every file is validated here at build time,
 * so a typo fails the build instead of rendering a broken chart.
 */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use YYYY-MM or YYYY-MM-DD.');

const timeSeries = z
  .object({
    unit: z.string().max(20).optional(),
    series: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          points: z.array(z.object({ t: day, v: z.number().finite() })).min(2),
        })
      )
      .min(1)
      .max(3),
  })
  .superRefine((data, ctx) => {
    for (const [index, series] of data.series.entries()) {
      const dates = series.points.map((p) => p.t);
      if (dates.some((d, i) => i > 0 && d <= dates[i - 1]))
        ctx.addIssue({
          code: 'custom',
          message: `Series "${series.name}" must have strictly increasing dates.`,
          path: ['series', index, 'points'],
        });
    }
  });

const bars = z.object({
  unit: z.string().max(20).optional(),
  bars: z
    .array(
      z.object({ label: z.string().min(1).max(40), value: z.number().finite() })
    )
    .min(1)
    .max(60),
});

const timeline = z.object({
  categories: z
    .array(
      z.object({ id: z.string().min(1), label: z.string().min(1).max(40) })
    )
    .min(1)
    .max(3),
  events: z
    .array(
      z.object({
        date: day,
        title: z.string().min(1).max(100),
        detail: z.string().max(300).optional(),
        category: z.string().min(1),
      })
    )
    .min(1)
    .max(40),
});

const stats = z.object({
  stats: z
    .array(
      z.object({
        value: z.string().min(1).max(20),
        label: z.string().min(1).max(60),
        note: z.string().max(120).optional(),
      })
    )
    .min(1)
    .max(8),
});

export const chartSchemas = { timeSeries, bars, timeline, stats } as const;
export type ChartKind = keyof typeof chartSchemas;
export type TimeSeriesData = z.infer<typeof timeSeries>;
export type BarsData = z.infer<typeof bars>;
export type TimelineData = z.infer<typeof timeline>;
export type StatsData = z.infer<typeof stats>;

export interface ChartDataByKind {
  timeSeries: TimeSeriesData;
  bars: BarsData;
  timeline: TimelineData;
  stats: StatsData;
}

/** Validates a parsed JSON file; throws a build error naming the file. */
export function parseChartData<K extends ChartKind>(
  kind: K,
  json: unknown,
  source: string
): ChartDataByKind[K] {
  const result = chartSchemas[kind].safeParse(json);
  if (!result.success)
    throw new Error(
      `Invalid ${kind} chart data in ${source}:\n` +
        result.error.issues
          .map(
            (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`
          )
          .join('\n')
    );
  return result.data as ChartDataByKind[K];
}

/** Which data kind each component reads. */
export const componentKinds = {
  LineChart: 'timeSeries',
  AreaChart: 'timeSeries',
  BarChart: 'bars',
  Timeline: 'timeline',
  StatGrid: 'stats',
} as const satisfies Record<string, ChartKind>;
export type ChartComponentName = keyof typeof componentKinds;
