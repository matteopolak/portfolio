<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ChartTable } from '../../lib/charts/table';

  let {
    id,
    title,
    caption,
    table,
    children,
    legend,
  }: {
    id: string;
    title?: string;
    caption?: string;
    table: ChartTable;
    children: Snippet;
    legend?: Snippet;
  } = $props();
</script>

<figure
  class="chart"
  aria-labelledby={title ? `${id}-title` : undefined}
  data-chart-id={id}
>
  <div class="chart__head">
    {#if title}<p class="chart__title" id="{id}-title">{title}</p>{/if}
    <!-- Revealed by lib/charts/data-dialog.ts; without JS the hidden table below still serves screen readers. -->
    <button
      type="button"
      class="chart__data-button"
      data-chart-data
      aria-haspopup="dialog"
      hidden
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        ><rect x="1.5" y="2.5" width="13" height="11" /><path
          d="M1.5 6.5h13M1.5 10h13M6 6.5v7"
        /></svg
      >
      Data
    </button>
  </div>
  {@render children()}
  {@render legend?.()}
  {#if caption}<figcaption class="chart__caption">{caption}</figcaption>{/if}
  <div class="chart__data visually-hidden" data-chart-table>
    <table>
      {#if title}<caption>{title}</caption>{/if}
      <thead>
        <tr>
          {#each table.columns as column}<th scope="col">{column}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row}
          <tr>
            {#each row as cell, index}
              {#if index === 0}<th scope="row">{cell}</th>{:else}<td>{cell}</td
                >{/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>

<style>
  .chart {
    container-type: inline-size;
    margin: 2rem 0;
    padding: 1rem 0;
    border-block: 1px solid var(--soft-rule);
    color: var(--ink);
  }

  .chart__title {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    font-weight: 750;
    line-height: 1.3;
  }

  .chart__caption {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .chart__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 0 0.75rem;
  }

  .chart__head .chart__title {
    margin: 0;
  }

  .chart__data-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
    padding: 0.2rem 0.55rem;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--soft-rule);
    font: 650 0.78rem var(--font-sans);
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }

  .chart__data-button[hidden] {
    display: none;
  }

  .chart__data-button:hover {
    color: var(--ink);
    border-color: var(--ink);
  }
</style>
