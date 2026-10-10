<script lang="ts">
  /*
   * The Bauhaus tile pattern. The server renders the initial tiles (from the
   * pure generator in lib/bauhaus.ts); once hydrated, tiles regenerate on
   * hover (static patterns) or pointer movement (the ambient page grid), using
   * the pure logic in lib/bauhaus-regenerate.ts. Rendering is driven by the
   * `regions` state; only transient animation classes are timer-driven.
   */
  import { onMount, tick } from 'svelte';
  import {
    generateBauhausPattern,
    randomFrom,
    type BauhausColor,
    type BauhausShape,
  } from '../../lib/bauhaus';
  import {
    regenerateRegion,
    solidColors,
    type RegionItem,
    type RegionKind,
  } from '../../lib/bauhaus-regenerate';

  interface Props {
    columns: number;
    rows: number;
    seed: string;
    density?: number;
    ambient?: boolean;
    cropEdges?: boolean;
  }

  interface Region {
    key: string;
    /** `data-region-index`: the shape index, or the cell key for runtime cells. */
    index: string;
    column: number;
    row: number;
    x: number;
    y: number;
    kind: RegionKind;
    /** Server-rendered shape, drawn until the tile is first regenerated. */
    shape?: BauhausShape;
    /** Regenerated content. */
    items: RegionItem[] | null;
    clipId?: string;
    direction?: number;
    orientation?: 'horizontal' | 'vertical';
    visible: boolean;
    special: boolean;
    entering: boolean;
    leaving: boolean;
    shiftX: string;
    shiftY: string;
    specialSeeded: boolean;
    /** Token that lets a newer exit/enter supersede an older timer. */
    token: number;
  }

  const unit = 80;
  const {
    columns,
    rows: initialRows,
    seed,
    density,
    ambient = false,
    cropEdges,
  }: Props = $props();

  // Props are read once: the pattern is built for its initial geometry.
  /* svelte-ignore state_referenced_locally */
  const pattern = ambient
    ? { shapes: [] as BauhausShape[] }
    : generateBauhausPattern({ columns, rows: initialRows, seed, density });
  /* svelte-ignore state_referenced_locally */
  const patternId = `bauhaus-${seed.replace(/[^a-z0-9]/gi, '').slice(-24)}-${columns}-${initialRows}`;
  /* svelte-ignore state_referenced_locally */
  const cropsOuterRing = cropEdges ?? (columns >= 5 && initialRows >= 5);
  const edgeInset = cropsOuterRing ? unit : 0;

  /* svelte-ignore state_referenced_locally */
  let rows = $state(initialRows);
  // The ambient field derives its column count from the container (cells have a
  // fixed pixel size); static patterns keep the `columns` prop.
  /* svelte-ignore state_referenced_locally */
  let columnCount = $state(columns);
  /* svelte-ignore state_referenced_locally */
  let viewBox = $state({
    x: edgeInset,
    y: edgeInset,
    width: columns * unit - edgeInset * 2,
    height: initialRows * unit - edgeInset * 2,
  });
  /* svelte-ignore state_referenced_locally */
  let patternKey = $state(seed);
  let interactive = $state(false);

  const kindOf = (shape: BauhausShape): RegionKind =>
    shape.kind === 'curve'
      ? shape.band
        ? 'curve-ring'
        : 'curve-open'
      : shape.kind;

  let regions = $state<Region[]>(
    pattern.shapes.map((shape, index) => ({
      key: `${shape.column}:${shape.row}`,
      index: String(index),
      column: shape.column,
      row: shape.row,
      x: shape.column * unit,
      y: shape.row * unit,
      kind: kindOf(shape),
      shape,
      items: null,
      clipId:
        shape.kind === 'curve' || shape.kind === 'dots'
          ? `${patternId}-cell-${index}`
          : undefined,
      direction: shape.kind === 'curve' ? shape.direction : undefined,
      orientation: shape.kind === 'stripes' ? shape.orientation : undefined,
      visible: false,
      special: false,
      entering: false,
      leaving: false,
      shiftX: '0px',
      shiftY: '0px',
      specialSeeded: false,
      token: 0,
    }))
  );

  const regionsByKey = new Map<string, Region>();
  const elements: Record<string, SVGGElement | undefined> = {};
  let svg: SVGSVGElement | undefined;

  const quarterPath = (
    x: number,
    y: number,
    direction: number,
    size = unit
  ) => {
    const right = x + size;
    const bottom = y + size;
    return [
      `M${x} ${y}H${right}A${size} ${size} 0 0 0 ${x} ${bottom}Z`,
      `M${right} ${y}V${bottom}A${size} ${size} 0 0 0 ${x} ${y}Z`,
      `M${right} ${bottom}H${x}A${size} ${size} 0 0 0 ${right} ${y}Z`,
      `M${x} ${bottom}V${y}A${size} ${size} 0 0 0 ${right} ${bottom}Z`,
    ][direction];
  };

  const quarterCirclePath = (
    x: number,
    y: number,
    direction: number,
    size = unit
  ) => {
    const right = x + size;
    const bottom = y + size;
    return [
      `M${x} ${y}H${right}A${size} ${size} 0 0 1 ${x} ${bottom}Z`,
      `M${right} ${y}V${bottom}A${size} ${size} 0 0 1 ${x} ${y}Z`,
      `M${right} ${bottom}H${x}A${size} ${size} 0 0 1 ${right} ${y}Z`,
      `M${x} ${bottom}V${y}A${size} ${size} 0 0 1 ${right} ${bottom}Z`,
    ][direction];
  };

  const innerQuarterOffset = (direction: number, size: number) => ({
    x: direction === 1 || direction === 2 ? size - unit : 0,
    y: direction >= 2 ? size - unit : 0,
  });

  /** Every colour a tile paints, one entry per painted element. */
  const colorsOf = (region: Region): BauhausColor[] => {
    if (region.items) {
      return region.items.flatMap((item) =>
        item.type === 'hit' ? [] : [item.color]
      );
    }
    const shape = region.shape;
    if (!shape) return [];
    switch (shape.kind) {
      case 'curve':
        return shape.band && shape.innerColor
          ? [shape.background, shape.color, shape.innerColor]
          : [shape.background, shape.color];
      case 'dots':
        return [
          shape.background,
          shape.color,
          shape.color,
          shape.color,
          shape.color,
        ];
      case 'solid':
        return [shape.color];
      case 'stripes':
        return [...shape.colors];
      default:
        return [];
    }
  };

  for (const region of regions) regionsByKey.set(region.key, region);

  const ensureRegion = (column: number, row: number) => {
    const key = `${column}:${row}`;
    const existing = regionsByKey.get(key);
    if (existing) return existing;

    const clean = patternKey.replace(/[^a-z0-9]/gi, '');
    regions.push({
      key,
      index: key,
      column,
      row,
      x: column * unit,
      y: row * unit,
      kind: 'empty',
      items: [{ type: 'hit', x: column * unit, y: row * unit }],
      clipId: `runtime-cell-${clean}-${column}-${row}`,
      visible: false,
      special: false,
      entering: false,
      leaving: false,
      shiftX: '0px',
      shiftY: '0px',
      specialSeeded: false,
      token: 0,
    });
    // Read back the reactive proxy so later mutations are tracked.
    const region = regions[regions.length - 1];
    regionsByKey.set(key, region);
    return region;
  };

  const animateIn = async (region: Region, shiftX = '0px', shiftY = '0px') => {
    region.shiftX = shiftX;
    region.shiftY = shiftY;
    region.leaving = false;
    region.entering = false;
    await tick();
    // Force a reflow so the animation restarts when it was already running.
    elements[region.key]?.getBoundingClientRect();
    region.token += 1;
    const token = region.token;
    region.entering = true;
    window.setTimeout(() => {
      if (region.token === token) region.entering = false;
    }, 340);
  };

  const animateSpecialOut = (region: Region) => {
    region.token += 1;
    const token = region.token;
    region.entering = false;
    region.leaving = true;
    window.setTimeout(() => {
      if (region.token !== token) return;
      region.special = false;
      region.visible = false;
      region.leaving = false;
    }, 340);
  };

  const applyRegeneration = (
    region: Region,
    random: () => number,
    chooseColor: (excluded?: Set<BauhausColor>) => BauhausColor
  ) => {
    const result = regenerateRegion({
      x: region.x,
      y: region.y,
      column: region.column,
      row: region.row,
      currentKind: region.kind,
      neighbors: regions.filter((other) => other !== region),
      random,
      chooseColor,
    });
    region.kind = result.kind;
    region.items = result.items;
    region.shape = undefined;
    region.direction = result.direction;
    region.orientation = result.orientation;
  };

  let generationCount = 0;
  const regenerateNow = (target: Region, shiftX = '0px', shiftY = '0px') => {
    generationCount += 1;
    const usage = Object.fromEntries(
      solidColors.map((color) => [color, 0])
    ) as Record<(typeof solidColors)[number], number>;
    for (const region of regions) {
      for (const color of colorsOf(region)) {
        if (color !== 'paper') usage[color] += 1;
      }
    }

    const signature = regions
      .map((region) => `${region.kind}:${colorsOf(region).join('')}`)
      .join('|');
    const random = randomFrom(
      `${patternKey}:${generationCount}:${target.index}:${signature}`
    );

    const neighborColors = new Set<BauhausColor>();
    const left = target.column;
    const top = target.row;
    const right = left + 2;
    const bottom = top + 2;
    for (const region of regions) {
      if (region === target) continue;
      const otherRight = region.column + 2;
      const otherBottom = region.row + 2;
      const touches =
        ((right === region.column || left === otherRight) &&
          top < otherBottom &&
          bottom > region.row) ||
        ((bottom === region.row || top === otherBottom) &&
          left < otherRight &&
          right > region.column);
      if (!touches) continue;
      for (const color of colorsOf(region)) neighborColors.add(color);
    }

    const chooseColor = (excluded = new Set<BauhausColor>()): BauhausColor => {
      const choices = solidColors
        .filter((color) => !excluded.has(color))
        .map((color) => ({
          color,
          score:
            usage[color] * 0.02 +
            (neighborColors.has(color) ? -8 : 0) +
            random() * 0.35,
        }))
        .sort((a, b) => a.score - b.score);
      const selected = choices[0]?.color ?? 'ink';
      usage[selected] += 1;
      return selected;
    };

    applyRegeneration(target, random, chooseColor);
    void animateIn(target, shiftX, shiftY);
  };

  onMount(() => {
    if (!svg) return;
    const root = svg;
    interactive = true;
    const cleanups: (() => void)[] = [];

    if (ambient) {
      const entropy = new Uint32Array(4);
      crypto.getRandomValues(entropy);
      const instanceSeed = Array.from(entropy, (value) =>
        value.toString(16).padStart(8, '0')
      ).join('');
      patternKey = `${seed}:${instanceSeed}`;
    }

    const resizePatternToField = () => {
      if (!ambient) return;
      const field = root.closest<HTMLElement>('.bauhaus-field');
      const grid = root.closest<HTMLElement>('.latent-grid');
      if (!field || !grid) return;

      void grid;
      const fieldRect = field.getBoundingClientRect();
      const renderedHeight = fieldRect.height;
      if (fieldRect.width <= 0 || renderedHeight <= 0) return;

      // Cells are a fixed pixel size (`--bauhaus-cell`); only the number of
      // columns and rows changes with the container.
      const cell =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--bauhaus-cell'
          )
        ) || 30;
      const inset = unit;
      const moduleSize = 160;
      const visibleColumns = Math.max(4, Math.floor(fieldRect.width / cell));
      const viewWidth = visibleColumns * unit;
      const requiredViewHeight = (renderedHeight / cell) * unit;
      const coordinateHeight =
        Math.ceil((requiredViewHeight + inset * 2) / moduleSize) * moduleSize;
      const rowCount = Math.max(6, coordinateHeight / unit);
      if (rows === rowCount && columnCount === visibleColumns + 2) return;

      rows = rowCount;
      columnCount = visibleColumns + 2;
      viewBox = {
        x: inset,
        y: inset,
        width: viewWidth,
        height: rowCount * unit - inset * 2,
      };
    };

    const markSpecialRegions = () => {
      if (!ambient) return;
      const previous = new Set(regions.filter((region) => region.special));
      const next = new Set<Region>();
      const patternBounds = root.getBoundingClientRect();
      const placeholders = Array.from(
        document.querySelectorAll<HTMLElement>('[data-bauhaus-region]')
      ).map((placeholder) => placeholder.getBoundingClientRect());
      const textBounds: DOMRect[] = [];
      const main = document.querySelector('.site-main');
      if (main) {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
          if (textNode.textContent?.trim()) {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            textBounds.push(...Array.from(range.getClientRects()));
          }
          textNode = walker.nextNode();
        }
        main
          .querySelectorAll<HTMLElement>('.page-intro__index, img, svg')
          .forEach((element) =>
            textBounds.push(element.getBoundingClientRect())
          );
      }

      const overlapsContent = (bounds: {
        left: number;
        top: number;
        width: number;
        height: number;
      }) => {
        const safetyMargin = 6;
        const right = bounds.left + bounds.width;
        const bottom = bounds.top + bounds.height;
        return textBounds.some(
          (content) =>
            right > content.left - safetyMargin &&
            bounds.left < content.right + safetyMargin &&
            bottom > content.top - safetyMargin &&
            bounds.top < content.bottom + safetyMargin
        );
      };

      for (const placeholder of placeholders) {
        const svgLeft =
          viewBox.x +
          ((placeholder.left - patternBounds.left) / patternBounds.width) *
            viewBox.width;
        const svgRight =
          viewBox.x +
          ((placeholder.right - patternBounds.left) / patternBounds.width) *
            viewBox.width;
        const svgTop =
          viewBox.y +
          ((placeholder.top - patternBounds.top) / patternBounds.height) *
            viewBox.height;
        const svgBottom =
          viewBox.y +
          ((placeholder.bottom - patternBounds.top) / patternBounds.height) *
            viewBox.height;
        const firstColumn = Math.max(0, Math.floor(svgLeft / 160) * 2);
        const lastColumn = Math.min(
          columnCount - 2,
          Math.floor(svgRight / 160) * 2
        );
        const firstRow = Math.max(0, Math.floor(svgTop / 160) * 2);
        const lastRow = Math.min(rows - 2, Math.floor(svgBottom / 160) * 2);

        for (let row = firstRow; row <= lastRow; row += 2) {
          for (let column = firstColumn; column <= lastColumn; column += 2) {
            const bounds = {
              left:
                patternBounds.left +
                ((column * unit - viewBox.x) / viewBox.width) *
                  patternBounds.width,
              top:
                patternBounds.top +
                ((row * unit - viewBox.y) / viewBox.height) *
                  patternBounds.height,
              width: (160 / viewBox.width) * patternBounds.width,
              height: (160 / viewBox.height) * patternBounds.height,
            };
            const right = bounds.left + bounds.width;
            const bottom = bounds.top + bounds.height;
            const overlapWidth = Math.max(
              0,
              Math.min(right, placeholder.right) -
                Math.max(bounds.left, placeholder.left)
            );
            const overlapHeight = Math.max(
              0,
              Math.min(bottom, placeholder.bottom) -
                Math.max(bounds.top, placeholder.top)
            );
            const overlapRatio =
              (overlapWidth * overlapHeight) / (bounds.width * bounds.height);
            if (overlapRatio < 0.08) continue;
            if (overlapsContent(bounds)) continue;

            const centerX = bounds.left + bounds.width / 2;
            const centerY = bounds.top + bounds.height / 2;
            const edgeDepth = Math.max(
              0,
              Math.min(
                centerX - placeholder.left,
                placeholder.right - centerX,
                centerY - placeholder.top,
                placeholder.bottom - centerY
              )
            );
            const edgeFactor = Math.min(
              1,
              edgeDepth / (Math.max(bounds.width, bounds.height) * 1.6)
            );
            const keepChance = 0.18 + edgeFactor * 0.8;
            const boundaryRandom = randomFrom(
              `${patternKey}:boundary:${column}:${row}`
            );
            const region = ensureRegion(column, row);
            next.add(region);
            // Cancel any pending exit.
            region.token += 1;
            region.leaving = false;
            region.special = true;
            if (boundaryRandom() >= keepChance) continue;
            if (region.kind === 'empty' && !region.specialSeeded) {
              region.specialSeeded = true;
              const random = randomFrom(
                `${patternKey}:special:${region.column}:${region.row}`
              );
              const chooseColor = (excluded = new Set<BauhausColor>()) => {
                const choices = solidColors.filter(
                  (color) => !excluded.has(color)
                );
                return choices[Math.floor(random() * choices.length)] ?? 'ink';
              };
              applyRegeneration(region, random, chooseColor);
              void animateIn(region);
            }
          }
        }
      }

      previous.forEach((region) => {
        if (!next.has(region)) animateSpecialOut(region);
      });
    };

    const refresh = () => {
      resizePatternToField();
      markSpecialRegions();
    };

    let observedField: HTMLElement | null = null;
    const fieldResizeObserver = new ResizeObserver(refresh);
    const observeCurrentField = () => {
      const field = root.closest<HTMLElement>('.bauhaus-field');
      if (field === observedField) return;
      if (observedField) fieldResizeObserver.unobserve(observedField);
      observedField = field;
      if (observedField) fieldResizeObserver.observe(observedField);
    };

    const afterRouteSettles = () => {
      void document.fonts?.ready.then(markSpecialRegions);
      document
        .querySelector('.site-main')
        ?.addEventListener('animationend', markSpecialRegions, { once: true });
    };
    // The persisted grid outlives route changes, but the placeholders and page
    // content around it are new, so re-measure on every page load.
    const onPageLoad = () => {
      resizePatternToField();
      observeCurrentField();
      markSpecialRegions();
      afterRouteSettles();
    };

    resizePatternToField();
    observeCurrentField();
    markSpecialRegions();
    afterRouteSettles();
    window.addEventListener('load', markSpecialRegions, { once: true });
    window.addEventListener('resize', refresh, { passive: true });
    document.addEventListener('astro:page-load', onPageLoad);
    cleanups.push(() => {
      fieldResizeObserver.disconnect();
      window.removeEventListener('load', markSpecialRegions);
      window.removeEventListener('resize', refresh);
      document.removeEventListener('astro:page-load', onPageLoad);
    });

    if (ambient) {
      let lastRegion: Region | undefined;
      const hideTimers = new Map<Region, number>();

      const scheduleAmbientExit = (region: Region) => {
        const previousTimer = hideTimers.get(region);
        if (previousTimer) window.clearTimeout(previousTimer);
        if (region.special) return;

        const timer = window.setTimeout(() => {
          hideTimers.delete(region);
          region.token += 1;
          const token = region.token;
          region.entering = false;
          region.leaving = true;
          window.setTimeout(() => {
            if (region.token !== token) return;
            region.visible = false;
            region.leaving = false;
            if (lastRegion === region) lastRegion = undefined;
          }, 340);
        }, 1600);
        hideTimers.set(region, timer);
      };

      const regionAtPointer = (event: PointerEvent) => {
        const bounds = root.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX >= bounds.right ||
          event.clientY < bounds.top ||
          event.clientY >= bounds.bottom
        ) {
          return;
        }
        const svgX =
          viewBox.x +
          ((event.clientX - bounds.left) / bounds.width) * viewBox.width;
        const svgY =
          viewBox.y +
          ((event.clientY - bounds.top) / bounds.height) * viewBox.height;
        return ensureRegion(
          Math.floor(svgX / 160) * 2,
          Math.floor(svgY / 160) * 2
        );
      };

      const revealRegion = (region: Region, shiftX = '0px', shiftY = '0px') => {
        region.visible = true;
        lastRegion = region;
        regenerateNow(region, shiftX, shiftY);
        scheduleAmbientExit(region);
      };

      const onPointerMove = (event: PointerEvent) => {
        const region = regionAtPointer(event);
        if (!region) {
          lastRegion = undefined;
          return;
        }
        if (region === lastRegion) return;
        const horizontal =
          Math.abs(event.movementX) >= Math.abs(event.movementY);
        const shiftX = horizontal
          ? event.movementX >= 0
            ? '-28px'
            : '28px'
          : '0px';
        const shiftY = horizontal
          ? '0px'
          : event.movementY >= 0
            ? '-28px'
            : '28px';
        revealRegion(region, shiftX, shiftY);
      };
      const onPointerDown = (event: PointerEvent) => {
        const region = regionAtPointer(event);
        if (region) revealRegion(region);
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerdown', onPointerDown);
      cleanups.push(() => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerdown', onPointerDown);
        hideTimers.forEach((timer) => window.clearTimeout(timer));
      });
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  });
</script>

<svg
  bind:this={svg}
  class="bauhaus-pattern"
  data-bauhaus-pattern={patternKey}
  data-ambient={ambient ? 'true' : undefined}
  data-interactive={interactive ? 'true' : undefined}
  data-columns={columnCount}
  data-rows={rows}
  style={ambient
    ? `width: calc(${viewBox.width / unit} * var(--bauhaus-cell, 30px))`
    : undefined}
  viewBox="{viewBox.x} {viewBox.y} {viewBox.width} {viewBox.height}"
  role="presentation"
>
  <defs>
    {#each regions as region (region.key)}
      {#if region.clipId}
        <clipPath id={region.clipId}>
          <rect x={region.x} y={region.y} width={2 * unit} height={2 * unit} />
        </clipPath>
      {/if}
    {/each}
  </defs>

  {#each regions as region (region.key)}
    {@const shape = region.shape}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g
      bind:this={elements[region.key]}
      class="pattern-region"
      class:is-visible={region.visible}
      class:is-special={region.special}
      class:is-entering={region.entering}
      class:is-leaving={region.leaving}
      data-kind={region.kind}
      data-region-index={region.index}
      data-column={region.column}
      data-row={region.row}
      data-columns="2"
      data-rows="2"
      data-x={region.x}
      data-y={region.y}
      data-direction={region.direction}
      data-orientation={region.orientation}
      clip-path={region.clipId ? `url(#${region.clipId})` : undefined}
      style:--tile-shift-x={region.shiftX === '0px' ? undefined : region.shiftX}
      style:--tile-shift-y={region.shiftY === '0px' ? undefined : region.shiftY}
      onpointerenter={interactive && !ambient
        ? () => regenerateNow(region)
        : undefined}
    >
      {#if region.items}
        {#each region.items as item, itemIndex (itemIndex)}
          {#if item.type === 'hit'}
            <rect
              class="pattern-hit-area"
              x={item.x}
              y={item.y}
              width="160"
              height="160"
              fill="transparent"
              pointer-events="all"
            />
          {:else if item.type === 'rect'}
            <rect
              class="fill-{item.color}"
              x={item.x}
              y={item.y}
              width={item.width}
              height={item.height}
              fill="var(--{item.color})"
              color="var(--{item.color})"
              stroke="var(--{item.color})"
              stroke-width="1.25"
            />
          {:else if item.type === 'path'}
            <path
              class="fill-{item.color}"
              d={item.d}
              fill="var(--{item.color})"
              color="var(--{item.color})"
              stroke="var(--{item.color})"
              stroke-width="1.25"
            />
          {:else}
            <circle
              class="fill-{item.color}"
              cx={item.cx}
              cy={item.cy}
              r={item.r}
              fill="var(--{item.color})"
              color="var(--{item.color})"
            />
          {/if}
        {/each}
      {:else if shape?.kind === 'curve'}
        <rect
          class="fill-{shape.background}"
          x={region.x - 0.75}
          y={region.y - 0.75}
          width={2 * unit + 1.5}
          height={2 * unit + 1.5}
        />
        <g data-curve-geometry transform="translate({region.x} {region.y})">
          <path
            class="fill-{shape.color}"
            d={quarterPath(0, 0, shape.direction, 2 * unit)}
            stroke="currentColor"
            stroke-width="1.25"
            vector-effect="non-scaling-stroke"
          />
          {#if shape.band && shape.innerColor}
            {@const innerDirection = (shape.direction + 2) % 4}
            {@const innerOffset = innerQuarterOffset(innerDirection, 2 * unit)}
            <path
              class="fill-{shape.innerColor}"
              d={quarterCirclePath(
                innerOffset.x,
                innerOffset.y,
                innerDirection,
                unit
              )}
              stroke="currentColor"
              stroke-width="1.25"
              vector-effect="non-scaling-stroke"
            />
          {/if}
        </g>
      {:else if shape?.kind === 'dots'}
        <rect
          class="fill-{shape.background}"
          x={region.x - 0.75}
          y={region.y - 0.75}
          width={2 * unit + 1.5}
          height={2 * unit + 1.5}
        />
        <g class="rotor" class:rotor--active={shape.rotates}>
          {#each [[0, 0], [1, 0], [0, 1], [1, 1]] as [dx, dy] (`${dx}${dy}`)}
            <circle
              class="fill-{shape.color}"
              cx={region.x + unit / 2 + dx * unit}
              cy={region.y + unit / 2 + dy * unit}
              r={unit * 0.14}
            />
          {/each}
        </g>
      {:else if shape?.kind === 'empty'}
        <rect
          class="pattern-hit-area"
          x={region.x}
          y={region.y}
          width={2 * unit}
          height={2 * unit}
        />
      {:else if shape?.kind === 'solid'}
        <rect
          class="fill-{shape.color}"
          x={region.x}
          y={region.y}
          width={2 * unit}
          height={2 * unit}
          stroke="currentColor"
          stroke-width="1.25"
        />
      {:else if shape?.kind === 'stripes'}
        {@const horizontal = shape.orientation === 'horizontal'}
        <rect
          class="fill-{shape.colors[0]}"
          x={region.x}
          y={region.y}
          width={horizontal ? 2 * unit : unit + 0.75}
          height={horizontal ? unit + 0.75 : 2 * unit}
          stroke="currentColor"
          stroke-width="1.25"
        />
        <rect
          class="fill-{shape.colors[1]}"
          x={horizontal ? region.x : region.x + unit - 0.75}
          y={horizontal ? region.y + unit - 0.75 : region.y}
          width={horizontal ? 2 * unit : unit + 0.75}
          height={horizontal ? unit + 0.75 : 2 * unit}
          stroke="currentColor"
          stroke-width="1.25"
        />
      {/if}
    </g>
  {/each}
</svg>

<style>
  .bauhaus-pattern {
    display: block;
    width: 100%;
    height: auto;
    overflow: hidden;
  }

  .bauhaus-pattern :global(.fill-paper) {
    fill: var(--paper);
    color: var(--paper);
  }

  .bauhaus-pattern :global(.fill-ink) {
    fill: var(--ink);
    color: var(--ink);
  }

  .bauhaus-pattern :global(.fill-red) {
    fill: var(--accent-1);
    color: var(--accent-1);
  }

  .bauhaus-pattern :global(.fill-blue) {
    fill: var(--accent-2);
    color: var(--accent-2);
  }

  .bauhaus-pattern :global(.fill-yellow) {
    fill: var(--accent-3);
    color: var(--accent-3);
  }

  .pattern-region {
    cursor: crosshair;
    pointer-events: visiblePainted;
    transform-box: fill-box;
    transform-origin: center;
    transition:
      opacity 150ms ease,
      transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  :global(.bauhaus-pattern[data-ambient='true'] .pattern-region) {
    --tile-opacity: 0;
    opacity: 0;
    cursor: default;
    pointer-events: none;
    transition: none;
  }

  :global(.bauhaus-pattern[data-ambient='true'] .pattern-region.is-visible) {
    --tile-opacity: 0.05;
    opacity: var(--tile-opacity);
  }

  :global(.bauhaus-pattern[data-ambient='true'] .pattern-region.is-special) {
    --tile-opacity: 1;
    opacity: var(--tile-opacity);
  }

  :global(.bauhaus-pattern[data-ambient='true'] .pattern-region.is-entering) {
    animation: tile-pop-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  :global(.bauhaus-pattern[data-ambient='true'] .pattern-region.is-leaving) {
    animation: tile-pop-out 280ms cubic-bezier(0.4, 0, 1, 1) both;
  }

  .pattern-hit-area {
    fill: transparent;
  }

  .rotor {
    transform-box: fill-box;
    transform-origin: center;
  }

  .rotor--active {
    animation: quarter-turn 18s cubic-bezier(0.65, 0, 0.35, 1) 8s infinite;
  }

  @keyframes quarter-turn {
    0%,
    68% {
      transform: rotate(0);
    }
    76%,
    94% {
      transform: rotate(90deg);
    }
    100% {
      transform: rotate(0);
    }
  }

  @keyframes tile-pop-in {
    from {
      opacity: 0;
      transform: translate(var(--tile-shift-x, 0px), var(--tile-shift-y, 0px));
    }
    to {
      opacity: var(--tile-opacity);
      transform: translate(0, 0);
    }
  }

  @keyframes tile-pop-out {
    from {
      opacity: var(--tile-opacity);
      transform: translate(0, 0);
    }
    to {
      opacity: 0;
      transform: translate(var(--tile-shift-x, 0px), var(--tile-shift-y, 0px));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rotor--active {
      animation: none;
    }

    .pattern-region {
      transition: none;
    }

    :global(.bauhaus-pattern[data-ambient='true'] .pattern-region.is-entering),
    :global(.bauhaus-pattern[data-ambient='true'] .pattern-region.is-leaving) {
      animation: none;
    }
  }

  @media (hover: none), (pointer: coarse) {
    .pattern-region {
      cursor: default;
      pointer-events: none;
    }
  }
</style>
