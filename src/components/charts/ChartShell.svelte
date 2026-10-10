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

<figure class="chart" aria-labelledby={title ? `${id}-title` : undefined}>
  {#if title}<p class="chart__title" id="{id}-title">{title}</p>{/if}
  {@render children()}
  {@render legend?.()}
  {#if caption}<figcaption class="chart__caption">{caption}</figcaption>{/if}
  <details class="chart__data">
    <summary>Show data</summary>
    <div class="chart__table-scroll">
      <table>
        <thead>
          <tr>
            {#each table.columns as column}<th scope="col">{column}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each table.rows as row}
            <tr>
              {#each row as cell, index}
                {#if index === 0}<th scope="row">{cell}</th>{:else}<td
                    >{cell}</td
                  >{/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
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

  .chart__data {
    margin-top: 0.75rem;
    font-size: 0.875rem;
  }

  .chart__data summary {
    width: fit-content;
    cursor: pointer;
    color: var(--muted);
    font-weight: 650;
  }

  .chart__data summary:focus-visible {
    outline: 3px solid var(--accent-2-text);
    outline-offset: 3px;
  }

  /* The table scrolls inside its own box so the page never scrolls sideways. */
  .chart__table-scroll {
    max-width: 100%;
    margin-top: 0.5rem;
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    min-width: 100%;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 0.3rem 0.75rem 0.3rem 0;
    border-bottom: 1px solid var(--soft-rule);
    text-align: left;
    white-space: nowrap;
  }

  thead th {
    color: var(--muted);
    font-weight: 700;
  }
</style>
