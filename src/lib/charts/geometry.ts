import { extent, max, min } from 'd3-array';
import { scaleBand, scaleLinear, scaleUtc } from 'd3-scale';
import {
  area,
  curveMonotoneX,
  line,
  stack,
  symbol,
  symbolCircle,
  symbolSquare,
  symbolTriangle,
} from 'd3-shape';
import { utcFormat } from 'd3-time-format';
import type { BarsData, TimeSeriesData } from './schema.ts';

/*
 * Chart geometry: d3 for the math only (scales, shapes, ticks), no DOM. The
 * output is plain data (path strings, tick positions) that the Svelte chart
 * components render as static SVG at build time. Every chart is laid out twice,
 * a wide and a narrow frame, so text keeps a readable size on phones: CSS
 * shows one of them by container width.
 */
export type Variant = 'wide' | 'narrow';

export interface Frame {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Target number of x ticks. */
  xTicks: number;
}

export const frames: Record<Variant, Frame> = {
  wide: {
    width: 640,
    height: 340,
    top: 16,
    right: 24,
    bottom: 40,
    left: 56,
    xTicks: 6,
  },
  narrow: {
    width: 360,
    height: 300,
    top: 14,
    right: 14,
    bottom: 38,
    left: 46,
    xTicks: 4,
  },
};

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
export const formatValue = (value: number) => compact.format(value);

/** `2025-03` / `2025-03-14` as a UTC date. */
export function parseDate(text: string): Date {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d ?? 1));
}

const SHAPES = [symbolCircle, symbolSquare, symbolTriangle] as const;
/** SVG `stroke-dasharray` per series: a second channel besides colour. */
export const DASHES = ['', '7 5', '2 5'] as const;

/** A marker path centred on the origin; place it with `transform="translate(x y)"`. */
export const markerPath = (index: number, size = 40) =>
  symbol(SHAPES[index % SHAPES.length], size)() ?? '';

export interface Tick {
  position: number;
  label: string;
}

export interface SeriesPoint {
  x: number;
  y: number;
  /** Source date and value, for tooltips. */
  t: string;
  v: number;
}

export interface SeriesShape {
  index: number;
  name: string;
  /** Line stroke path (the top edge when stacked). */
  line: string;
  /** Filled area path (area charts only). */
  area?: string;
  points: SeriesPoint[];
}

export interface TimeSeriesLayout {
  frame: Frame;
  /** Plot area edges. */
  plot: { x0: number; x1: number; y0: number; y1: number };
  xTicks: Tick[];
  yTicks: Tick[];
  series: SeriesShape[];
}

export interface TimeSeriesOptions {
  area: boolean;
  stacked: boolean;
}

function dateFormatFor(dates: Date[]) {
  const span = dates[dates.length - 1].getTime() - dates[0].getTime();
  const days = span / 86_400_000;
  if (days > 900) return utcFormat('%Y');
  if (days > 60) return utcFormat('%b %Y');
  return utcFormat('%b %-d');
}

export function timeSeriesLayout(
  data: TimeSeriesData,
  variant: Variant,
  { area: filled, stacked }: TimeSeriesOptions
): TimeSeriesLayout {
  const frame = frames[variant];
  const x0 = frame.left;
  const x1 = frame.width - frame.right;
  const y1 = frame.top;
  const y0 = frame.height - frame.bottom;

  const allDates = [
    ...new Set(data.series.flatMap((s) => s.points.map((p) => p.t))),
  ].sort();
  const dates = allDates.map(parseDate);
  const x = scaleUtc()
    .domain(extent(dates) as [Date, Date])
    .range([x0, x1]);

  let tops: number[][];
  let bottoms: number[][];
  if (stacked) {
    for (const s of data.series)
      if (s.points.map((p) => p.t).join() !== allDates.join())
        throw new Error('Stacked charts need every series on the same dates.');
    const rows = allDates.map((_, i) =>
      Object.fromEntries(data.series.map((s, k) => [k, s.points[i].v]))
    );
    const layers = stack<Record<string, number>>().keys(
      data.series.map((_, k) => String(k))
    )(rows);
    tops = layers.map((layer) => layer.map((d) => d[1]));
    bottoms = layers.map((layer) => layer.map((d) => d[0]));
  } else {
    tops = data.series.map((s) => s.points.map((p) => p.v));
    bottoms = tops.map((values) => values.map(() => 0));
  }

  const top = max(tops.flat()) ?? 1;
  const low = filled || stacked ? 0 : Math.min(0, min(tops.flat()) ?? 0);
  const y = scaleLinear().domain([low, top]).nice(5).range([y0, y1]);

  const lineGen = line<[number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .curve(curveMonotoneX);
  const areaGen = area<[number, number, number]>()
    .x((d) => d[0])
    .y0((d) => d[1])
    .y1((d) => d[2])
    .curve(curveMonotoneX);

  const series = data.series.map((s, index): SeriesShape => {
    const xs = s.points.map((p) => x(parseDate(p.t)));
    const ys = tops[index].map((v) => y(v));
    const base = bottoms[index].map((v) => y(v));
    return {
      index,
      name: s.name,
      line: lineGen(xs.map((px, i) => [px, ys[i]])) ?? '',
      area: filled
        ? (areaGen(xs.map((px, i) => [px, base[i], ys[i]])) ?? '')
        : undefined,
      points: s.points.map((p, i) => ({ x: xs[i], y: ys[i], t: p.t, v: p.v })),
    };
  });

  const format = dateFormatFor(dates);
  return {
    frame,
    plot: { x0, x1, y0, y1 },
    xTicks: x
      .ticks(frame.xTicks)
      .map((d) => ({ position: x(d), label: format(d) })),
    yTicks: y.ticks(5).map((v) => ({ position: y(v), label: formatValue(v) })),
    series,
  };
}

export interface BarShape {
  label: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Whether the x label is drawn (thinned out so labels never overlap). */
  showLabel: boolean;
}

export interface BarsLayout {
  frame: Frame;
  plot: { x0: number; x1: number; y0: number; y1: number };
  yTicks: Tick[];
  bars: BarShape[];
}

export function barsLayout(data: BarsData, variant: Variant): BarsLayout {
  const frame = frames[variant];
  const x0 = frame.left;
  const x1 = frame.width - frame.right;
  const y1 = frame.top;
  const y0 = frame.height - frame.bottom;
  const x = scaleBand<string>()
    .domain(data.bars.map((b) => b.label))
    .range([x0, x1])
    .padding(0.25);
  const y = scaleLinear()
    .domain([
      Math.min(0, min(data.bars, (b) => b.value) ?? 0),
      max(data.bars, (b) => b.value) ?? 1,
    ])
    .nice(5)
    .range([y0, y1]);
  const zero = y(0);
  // The widest label is about 6.5px per character at the chart's font size.
  const longest = Math.max(...data.bars.map((b) => b.label.length));
  const fit = Math.max(1, Math.ceil((longest * 6.5 + 6) / x.step()));
  return {
    frame,
    plot: { x0, x1, y0, y1 },
    yTicks: y.ticks(5).map((v) => ({ position: y(v), label: formatValue(v) })),
    bars: data.bars.map((b, i) => {
      const top = y(b.value);
      return {
        label: b.label,
        value: b.value,
        x: x(b.label) ?? 0,
        y: Math.min(top, zero),
        width: x.bandwidth(),
        height: Math.abs(zero - top),
        showLabel: i % fit === 0,
      };
    }),
  };
}

/**
 * A bar's outline: rounded at the value end, square and open at the zero end,
 * so the stroke stops at the axis and the bar sits on it. Filling closes the
 * path; the stroke leaves the zero edge undrawn.
 */
export function barPath(bar: BarShape, radius = 3): string {
  const h = Math.max(bar.height, 1);
  const r = Math.min(radius, bar.width / 2, h);
  const { x, width: w } = bar;
  const right = x + w;
  if (bar.value < 0) {
    const top = bar.y;
    const bottom = top + h;
    return `M${x} ${top}V${bottom - r}Q${x} ${bottom} ${x + r} ${bottom}H${right - r}Q${right} ${bottom} ${right} ${bottom - r}V${top}`;
  }
  const bottom = bar.y + bar.height;
  const top = bottom - h;
  return `M${x} ${bottom}V${top + r}Q${x} ${top} ${x + r} ${top}H${right - r}Q${right} ${top} ${right} ${top + r}V${bottom}`;
}

/** Index of the point whose x is closest to `px` (tooltips). */
export function nearestIndex(xs: number[], px: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++)
    if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
  return best;
}
