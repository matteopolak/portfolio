<script lang="ts">
  import { onMount } from 'svelte';
  import ChartShell from './ChartShell.svelte';
  import {
    formatValue,
    type BarsLayout,
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
    unit,
    interactive = false,
  }: {
    id: string;
    title?: string;
    caption?: string;
    desc: string;
    table: ChartTable;
    layouts: Record<Variant, BarsLayout>;
    unit?: string;
    interactive?: boolean;
  } = $props();

  let enhanced = $state(false);
  let hover = $state<{ variant: Variant; index: number } | undefined>();
  onMount(() => {
    enhanced = interactive;
  });
  const variants: Variant[] = ['wide', 'narrow'];
</script>

<ChartShell {id} {title} {caption} {table}>
  {#each variants as variant}
    {@const layout = layouts[variant]}
    <svg
      class="plot plot--{variant}"
      viewBox="0 0 {layout.frame.width} {layout.frame.height}"
      role="img"
      aria-labelledby="{id}-{variant}-t {id}-{variant}-d"
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
      {#each layout.bars as bar, index}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="bar"
          class:active={enhanced &&
            hover?.variant === variant &&
            hover.index === index}
          onpointerenter={() => enhanced && (hover = { variant, index })}
          onpointerleave={() => (hover = undefined)}
        >
          <rect
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={Math.max(bar.height, 1)}
            rx="3"
          />
          {#if enhanced && hover?.variant === variant && hover.index === index}
            <text
              class="value"
              x={bar.x + bar.width / 2}
              y={bar.y - 6}
              text-anchor="middle"
              >{formatValue(bar.value)}{unit ? ` ${unit}` : ''}</text
            >
          {/if}
        </g>
        {#if bar.showLabel}
          <text
            class="tick"
            x={bar.x + bar.width / 2}
            y={layout.plot.y0 + 22}
            text-anchor="middle">{bar.label}</text
          >
        {/if}
      {/each}
      <line
        class="axis"
        x1={layout.plot.x0}
        x2={layout.plot.x1}
        y1={layout.plot.y0}
        y2={layout.plot.y0}
      />
    </svg>
  {/each}
</ChartShell>

<style>
  .plot {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

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
  }

  .axis {
    stroke: var(--muted);
  }

  .tick {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .bar rect {
    fill: color-mix(in oklch, var(--accent-1) 55%, transparent);
    stroke: var(--accent-1-text);
    stroke-width: 2;
  }

  .bar.active rect {
    fill: var(--accent-1-text);
  }

  .value {
    fill: var(--ink);
    font-size: 12px;
    font-weight: 700;
  }

  @media (prefers-reduced-motion: no-preference) {
    .bar rect {
      transition: fill 160ms ease;
    }
  }
</style>
