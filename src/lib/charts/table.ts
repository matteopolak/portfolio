import type { ChartComponentName, ChartDataByKind } from './schema.ts';

/*
 * One tabular view of each chart's data: the visually-hidden data table (also shown in the chart's Data dialog and its CSV)
 * in HTML and the compact table in the markdown variant are both built from it.
 */
export interface ChartTable {
  columns: string[];
  rows: string[][];
}

const number = (value: number, unit?: string) =>
  `${Number.isInteger(value) ? value : value.toFixed(2)}${unit ? ` ${unit}` : ''}`;

export function timeSeriesTable(
  data: ChartDataByKind['timeSeries']
): ChartTable {
  const dates = [
    ...new Set(data.series.flatMap((s) => s.points.map((p) => p.t))),
  ].sort();
  return {
    // Units go in the headers so cells stay plain numbers (clean CSV).
    columns: [
      'Date',
      ...data.series.map((s) =>
        data.unit ? `${s.name} (${data.unit})` : s.name
      ),
    ],
    rows: dates.map((date) => [
      date,
      ...data.series.map((s) => {
        const point = s.points.find((p) => p.t === date);
        return point ? number(point.v) : '';
      }),
    ]),
  };
}

export const barsTable = (data: ChartDataByKind['bars']): ChartTable => ({
  columns: ['', data.unit ? `Value (${data.unit})` : 'Value'],
  rows: data.bars.map((bar) => [bar.label, number(bar.value)]),
});

export function timelineTable(data: ChartDataByKind['timeline']): ChartTable {
  const label = new Map(data.categories.map((c) => [c.id, c.label]));
  return {
    columns: ['Date', 'Event', 'Category'],
    rows: [...data.events]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [
        e.date,
        e.detail ? `${e.title}: ${e.detail}` : e.title,
        label.get(e.category) ?? e.category,
      ]),
  };
}

export const statsTable = (data: ChartDataByKind['stats']): ChartTable => ({
  columns: ['Measure', 'Value'],
  rows: data.stats.map((s) => [
    s.label,
    s.note ? `${s.value} (${s.note})` : s.value,
  ]),
});

/** The table for a component's validated data. */
export function tableFor<C extends ChartComponentName>(
  component: C,
  data: unknown
): ChartTable {
  switch (component) {
    case 'LineChart':
    case 'AreaChart':
      return timeSeriesTable(data as ChartDataByKind['timeSeries']);
    case 'BarChart':
      return barsTable(data as ChartDataByKind['bars']);
    case 'Timeline':
      return timelineTable(data as ChartDataByKind['timeline']);
    case 'StatGrid':
      return statsTable(data as ChartDataByKind['stats']);
  }
  throw new Error(`Unknown chart component ${String(component)}`);
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** A GitHub-flavoured markdown table. */
export function markdownTable({ columns, rows }: ChartTable): string {
  return [
    `| ${columns.map(cell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** What a chart says in words: the caption for markdown and the SVG `<desc>`. */
export function describeChart(
  component: ChartComponentName,
  data: unknown
): string {
  switch (component) {
    case 'LineChart':
    case 'AreaChart': {
      const d = data as ChartDataByKind['timeSeries'];
      return d.series
        .map((s) => {
          const first = s.points[0];
          const last = s.points[s.points.length - 1];
          const top = s.points.reduce((a, b) => (b.v > a.v ? b : a));
          return `${s.name} goes from ${number(first.v, d.unit)} (${first.t}) to ${number(last.v, d.unit)} (${last.t}), peaking at ${number(top.v, d.unit)} (${top.t}).`;
        })
        .join(' ');
    }
    case 'BarChart': {
      const d = data as ChartDataByKind['bars'];
      const top = d.bars.reduce((a, b) => (b.value > a.value ? b : a));
      const low = d.bars.reduce((a, b) => (b.value < a.value ? b : a));
      return `${d.bars.length} bars; highest ${top.label} (${number(top.value, d.unit)}), lowest ${low.label} (${number(low.value, d.unit)}).`;
    }
    case 'Timeline': {
      const d = data as ChartDataByKind['timeline'];
      const dates = d.events.map((e) => e.date).sort();
      return `${d.events.length} events from ${dates[0]} to ${dates[dates.length - 1]}.`;
    }
    case 'StatGrid':
      return (data as ChartDataByKind['stats']).stats
        .map((s) => `${s.label}: ${s.value}`)
        .join('; ');
  }
  return '';
}
