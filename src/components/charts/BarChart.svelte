<script lang="ts">
  import { onMount } from 'svelte';
  import ChartShell from './ChartShell.svelte';
  import {
    barPath,
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
  // Sized to its longest row once it renders, like the time-series tooltip.
  let tip = $state<SVGGElement | undefined>();
  let tipWidth = $state(120);
  $effect(() => {
    void hover;
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
</script>

<ChartShell {id} {title} {caption} {table} {unit}>
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
          <path d={barPath(bar)} />
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
      {#if enhanced && hover?.variant === variant}
        {@const bar = layout.bars[hover.index]}
        {@const tipHeight = 46}
        {@const tipX = Math.max(
          0,
          Math.min(
            bar.x + bar.width / 2 - tipWidth / 2,
            layout.frame.width - tipWidth
          )
        )}
        {@const tipY = Math.max(
          0,
          Math.min(bar.y, bar.y + bar.height) - tipHeight - 8
        )}
        <g
          class="tip"
          bind:this={tip}
          transform="translate({tipX} {tipY})"
          pointer-events="none"
        >
          <rect x="0" y="0" width={tipWidth} height={tipHeight} rx="6" />
          <text class="tip__label" x="8" y="18">{bar.label}</text>
          <text x="8" y="36"
            >{formatValue(bar.value)}{unit ? ` ${unit}` : ''}</text
          >
        </g>
      {/if}
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

  .bar path {
    fill: color-mix(in oklch, var(--accent-1) 55%, transparent);
    stroke: var(--accent-1-text);
    stroke-width: 2;
  }

  .bar.active path {
    fill: var(--accent-1-text);
  }

  .tip rect {
    fill: var(--paper-bright);
    stroke: var(--card-border);
    filter: drop-shadow(0 4px 10px oklch(0% 0 0 / 0.06));
  }

  .tip text {
    fill: var(--ink);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .tip .tip__label {
    fill: var(--muted);
  }

  @media (prefers-reduced-motion: no-preference) {
    .bar path {
      transition: fill 160ms ease;
    }
  }
</style>
