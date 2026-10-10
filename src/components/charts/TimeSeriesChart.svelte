<script lang="ts">
  import { onMount } from 'svelte';
  import ChartShell from './ChartShell.svelte';
  import {
    DASHES,
    markerPath,
    nearestIndex,
    formatValue,
    type TimeSeriesLayout,
    type Variant,
  } from '../../lib/charts/geometry';
  import type { ChartTable } from '../../lib/charts/table';

  let {
    id,
    title,
    caption,
    desc,
    table,
    layouts,
    filled,
    interactive = false,
  }: {
    id: string;
    title?: string;
    caption?: string;
    desc: string;
    table: ChartTable;
    layouts: Record<Variant, TimeSeriesLayout>;
    filled: boolean;
    interactive?: boolean;
  } = $props();

  // Hover and series toggles are added after hydration; the server markup is
  // the same static chart (buttons replace the legend's plain list items).
  let enhanced = $state(false);
  let hidden = $state<number[]>([]);
  let hover = $state<{ variant: Variant; x: number } | undefined>();
  // The tooltip box is sized to its longest row once it renders, since series
  // names vary in length.
  let tip = $state<SVGGElement | undefined>();
  let tipWidth = $state(138);
  $effect(() => {
    void hover;
    void hidden;
    if (!tip) return;
    const widths = [...tip.querySelectorAll('text')].map((t) =>
      t.getComputedTextLength()
    );
    tipWidth = Math.ceil(Math.max(0, ...widths)) + 16;
  });
  onMount(() => {
    enhanced = interactive;
  });

  const variants: Variant[] = ['wide', 'narrow'];
  const names = $derived(layouts.wide.series.map((s) => s.name));
  const toggle = (index: number) => {
    hidden = hidden.includes(index)
      ? hidden.filter((i) => i !== index)
      : [...hidden, index];
  };

  function move(event: PointerEvent, variant: Variant) {
    if (!enhanced) return;
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const frame = layouts[variant].frame;
    const x = ((event.clientX - box.left) * frame.width) / box.width;
    const reference = layouts[variant].series[0].points.map((p) => p.x);
    hover = { variant, x: reference[nearestIndex(reference, x)] };
  }

  /** Values of the visible series at the hovered x. */
  const readout = (variant: Variant) => {
    if (!hover || hover.variant !== variant) return [];
    const x = hover.x;
    return layouts[variant].series
      .filter((s) => !hidden.includes(s.index))
      .map((s) => {
        const point =
          s.points[
            nearestIndex(
              s.points.map((p) => p.x),
              x
            )
          ];
        return { name: s.name, index: s.index, point };
      });
  };
</script>

<ChartShell {id} {title} {caption} {table}>
  {#each variants as variant}
    {@const layout = layouts[variant]}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      class="plot plot--{variant}"
      viewBox="0 0 {layout.frame.width} {layout.frame.height}"
      role="img"
      aria-labelledby="{id}-{variant}-t {id}-{variant}-d"
      onpointermove={(event) => move(event, variant)}
      onpointerleave={() => (hover = undefined)}
    >
      <title id="{id}-{variant}-t">{title ?? 'Chart'}</title>
      <desc id="{id}-{variant}-d">{desc}</desc>
      {#each layout.yTicks as tick}
        <line
          class="grid"
          x1={layout.plot.x0}
          x2={layout.plot.x1}
          y1={tick.position}
          y2={tick.position}
        />
        <text
          class="tick"
          x={layout.plot.x0 - 8}
          y={tick.position}
          text-anchor="end"
          dominant-baseline="middle">{tick.label}</text
        >
      {/each}
      {#each layout.xTicks as tick}
        <text
          class="tick"
          x={tick.position}
          y={layout.plot.y0 + 22}
          text-anchor="middle">{tick.label}</text
        >
      {/each}
      <line
        class="axis"
        x1={layout.plot.x0}
        x2={layout.plot.x1}
        y1={layout.plot.y0}
        y2={layout.plot.y0}
      />
      {#each layout.series as s}
        {@const off = hidden.includes(s.index)}
        <g class="series series--{s.index + 1}" class:off>
          {#if filled && s.area}<path class="area" d={s.area} />{/if}
          <path
            class="line"
            d={s.line}
            stroke-dasharray={DASHES[s.index % DASHES.length]}
          />
          {#if s.points.length <= 24}
            {#each s.points as p}
              <path
                class="marker"
                d={markerPath(s.index)}
                transform="translate({p.x} {p.y})"
              />
            {/each}
          {/if}
        </g>
      {/each}
      {#if enhanced && hover && hover.variant === variant}
        {@const rows = readout(variant)}
        {@const left = hover.x > layout.frame.width / 2}
        {@const tipX = Math.max(
          0,
          Math.min(
            left ? hover.x - 8 - tipWidth : hover.x + 8,
            layout.frame.width - tipWidth
          )
        )}
        <line
          class="guide"
          x1={hover.x}
          x2={hover.x}
          y1={layout.plot.y1}
          y2={layout.plot.y0}
        />
        <g
          class="tip"
          bind:this={tip}
          transform="translate({tipX} {layout.plot.y1 + 4})"
        >
          <rect
            x="0"
            y="0"
            width={tipWidth}
            height={rows.length * 18 + 10}
            rx="6"
          />
          {#each rows as row, i}
            <text x="8" y={18 + i * 18}
              >{row.name}: {formatValue(row.point.v)}</text
            >
          {/each}
        </g>
      {/if}
    </svg>
  {/each}
  {#snippet legend()}
    {#if names.length > 1}
      <ul class="legend">
        {#each names as name, index}
          <li class="series--{index + 1}" class:off={hidden.includes(index)}>
            <svg width="28" height="12" aria-hidden="true">
              <line
                x1="1"
                x2="27"
                y1="6"
                y2="6"
                stroke-dasharray={DASHES[index % DASHES.length]}
              />
            </svg>
            {#if enhanced}
              <button
                type="button"
                aria-pressed={!hidden.includes(index)}
                onclick={() => toggle(index)}>{name}</button
              >
            {:else}
              {name}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</ChartShell>

<style>
  .plot {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  /* Both frames are in the HTML; the container width picks one. */
  .plot--narrow {
    display: none;
  }

  @container (max-width: 34rem) {
    .plot--wide {
      display: none;
    }
    .plot--narrow {
      display: block;
    }
  }

  .grid {
    stroke: var(--soft-rule);
    stroke-width: 1;
  }

  .axis {
    stroke: var(--muted);
    stroke-width: 1;
  }

  .tick {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .line,
  .legend line {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .marker {
    stroke-width: 0;
  }

  .series--1 {
    --series: var(--accent-1-text);
    --series-fill: var(--accent-1);
  }
  .series--2 {
    --series: var(--accent-2-text);
    --series-fill: var(--accent-2);
  }
  .series--3 {
    --series: var(--accent-3-text);
    --series-fill: var(--accent-3);
  }

  .line,
  .legend line {
    stroke: var(--series);
  }

  .marker {
    fill: var(--series);
  }

  .area {
    fill: color-mix(in oklch, var(--series-fill) 42%, transparent);
    stroke: none;
  }

  .series.off {
    display: none;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
    margin: 0.75rem 0 0;
    padding: 0;
    color: var(--ink);
    font-size: 0.875rem;
    list-style: none;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .legend li.off {
    opacity: 0.55;
    text-decoration: line-through;
  }

  .legend button {
    padding: 0.1rem 0.25rem;
    border: 0;
    border-radius: var(--radius-xs);
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-decoration: inherit;
  }

  .legend button:focus-visible {
    outline: 3px solid var(--accent-2-text);
    outline-offset: 2px;
  }

  .guide {
    stroke: var(--ink);
    stroke-dasharray: 3 3;
  }

  .tip rect {
    fill: var(--paper-bright);
    stroke: var(--ink);
  }

  .tip text {
    fill: var(--ink);
    font-size: 12px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .series {
      transition: opacity 160ms ease;
    }
  }
</style>
