import { loadChartData } from './data.ts';
import { barsLayout, timeSeriesLayout } from './geometry.ts';
import { describeChart, tableFor } from './table.ts';
import type { ChartComponentName } from './schema.ts';

/*
 * Turns a chart component's props into the props of its Svelte renderer:
 * validated data, both layouts, the hidden-table model and the description.
 * Runs at build time inside Astro.
 */
export interface CommonProps {
  /** Data file, relative to src/content/blog: `<slug>/data/<name>.json`. */
  src: string;
  title?: string;
  caption?: string;
  /** Hydrate (`client:visible`) for hover tooltips and series toggles. */
  interactive?: boolean;
}

/** A stable, unique-per-chart DOM id fragment. */
export function chartId(component: string, src: string, title = ''): string {
  let hash = 5381;
  for (const char of `${component}|${src}|${title}`)
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `chart-${hash.toString(36)}`;
}

const summary = (
  component: ChartComponentName,
  data: unknown,
  title?: string
) => [title, describeChart(component, data)].filter(Boolean).join('. ');

export function timeSeriesModel(
  component: 'LineChart' | 'AreaChart',
  props: CommonProps & { stacked?: boolean }
) {
  const data = loadChartData('timeSeries', props.src);
  const filled = component === 'AreaChart';
  const options = { area: filled, stacked: filled && props.stacked === true };
  return {
    id: chartId(component, props.src, props.title),
    title: props.title,
    caption: props.caption,
    desc: summary(component, data, props.title),
    table: tableFor(component, data),
    layouts: {
      wide: timeSeriesLayout(data, 'wide', options),
      narrow: timeSeriesLayout(data, 'narrow', options),
    },
    filled,
  };
}

export function barsModel(props: CommonProps) {
  const data = loadChartData('bars', props.src);
  return {
    id: chartId('BarChart', props.src, props.title),
    title: props.title,
    caption: props.caption,
    desc: summary('BarChart', data, props.title),
    table: tableFor('BarChart', data),
    layouts: {
      wide: barsLayout(data, 'wide'),
      narrow: barsLayout(data, 'narrow'),
    },
    unit: data.unit,
  };
}
