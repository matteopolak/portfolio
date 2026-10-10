/*
 * Pure tile regeneration for the interactive Bauhaus pattern. BauhausPattern
 * .svelte calls `regenerateRegion` when a tile is hovered or revealed and
 * renders the returned `items`; nothing here touches the DOM. The initial
 * (server-rendered) tiles come from `generateBauhausPattern` in bauhaus.ts.
 */
import type { BauhausColor } from './bauhaus';

export type RegionKind =
  | 'empty'
  | 'dots'
  | 'curve-ring'
  | 'curve-open'
  | 'stripes'
  | 'solid';

export type RegionItem =
  | { type: 'hit'; x: number; y: number }
  | {
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      color: BauhausColor;
    }
  | { type: 'path'; d: string; color: BauhausColor }
  | { type: 'circle'; cx: number; cy: number; r: number; color: BauhausColor };

export interface RegenerateInput {
  x: number;
  y: number;
  column: number;
  row: number;
  currentKind: RegionKind;
  /** Other tiles on the pattern, used to avoid stripes meeting curves. */
  neighbors: { kind: RegionKind; column: number; row: number }[];
  random: () => number;
  chooseColor: (excluded?: Set<BauhausColor>) => BauhausColor;
}

export interface RegenerateResult {
  kind: RegionKind;
  items: RegionItem[];
  orientation?: 'horizontal' | 'vertical';
  direction?: number;
}

export const solidColors = ['ink', 'red', 'blue', 'yellow'] as const;

function curvePath(x: number, y: number, direction: number, size = 80) {
  const right = x + size;
  const bottom = y + size;
  return [
    `M${x} ${y}H${right}A${size} ${size} 0 0 0 ${x} ${bottom}Z`,
    `M${right} ${y}V${bottom}A${size} ${size} 0 0 0 ${x} ${y}Z`,
    `M${right} ${bottom}H${x}A${size} ${size} 0 0 0 ${right} ${y}Z`,
    `M${x} ${bottom}V${y}A${size} ${size} 0 0 0 ${right} ${bottom}Z`,
  ][direction];
}

function quarterCirclePath(x: number, y: number, direction: number, size = 80) {
  const right = x + size;
  const bottom = y + size;
  return [
    `M${x} ${y}H${right}A${size} ${size} 0 0 1 ${x} ${bottom}Z`,
    `M${right} ${y}V${bottom}A${size} ${size} 0 0 1 ${x} ${y}Z`,
    `M${right} ${bottom}H${x}A${size} ${size} 0 0 1 ${right} ${y}Z`,
    `M${x} ${bottom}V${y}A${size} ${size} 0 0 1 ${right} ${bottom}Z`,
  ][direction];
}

function innerQuarterPosition(x: number, y: number, direction: number) {
  return {
    x: direction === 1 || direction === 2 ? x + 80 : x,
    y: direction >= 2 ? y + 80 : y,
  };
}

const kindCandidates: RegionKind[] = [
  'empty',
  'dots',
  'curve-ring',
  'curve-ring',
  'curve-open',
  'curve-open',
  'stripes',
  'stripes',
  'solid',
  'solid',
  'solid',
];

const square = (x: number, y: number, color: BauhausColor): RegionItem => ({
  type: 'rect',
  x,
  y,
  width: 160,
  height: 160,
  color,
});

export function regenerateRegion(input: RegenerateInput): RegenerateResult {
  const { x, y, column, row, random, chooseColor } = input;
  const candidates = kindCandidates.filter(
    (kind) => kind !== input.currentKind
  );
  const nextKind = candidates[Math.floor(random() * candidates.length)];

  if (nextKind === 'empty') {
    return { kind: 'empty', items: [{ type: 'hit', x, y }] };
  }

  if (nextKind === 'solid') {
    return { kind: 'solid', items: [square(x, y, chooseColor())] };
  }

  if (nextKind === 'stripes') {
    const first = chooseColor();
    const second = chooseColor(new Set([first]));
    const curves = input.neighbors.filter((other) =>
      other.kind.startsWith('curve')
    );
    const touchesVertical = curves.some(
      (other) => Math.abs(other.column - column) === 2 && other.row === row
    );
    const touchesHorizontal = curves.some(
      (other) => Math.abs(other.row - row) === 2 && other.column === column
    );

    if (touchesVertical && touchesHorizontal) {
      return { kind: 'solid', items: [square(x, y, first)] };
    }

    const orientation = touchesVertical
      ? 'vertical'
      : touchesHorizontal
        ? 'horizontal'
        : random() > 0.5
          ? 'horizontal'
          : 'vertical';
    const horizontal = orientation === 'horizontal';
    return {
      kind: 'stripes',
      orientation,
      items: [
        {
          type: 'rect',
          x,
          y,
          width: horizontal ? 160 : 80.75,
          height: horizontal ? 80.75 : 160,
          color: first,
        },
        {
          type: 'rect',
          x: horizontal ? x : x + 79.25,
          y: horizontal ? y + 79.25 : y,
          width: horizontal ? 160 : 80.75,
          height: horizontal ? 80.75 : 160,
          color: second,
        },
      ],
    };
  }

  if (nextKind === 'dots') {
    const background: BauhausColor = random() > 0.45 ? 'paper' : chooseColor();
    const dot: BauhausColor =
      background === 'paper' || background === 'yellow' ? 'ink' : 'paper';
    const items: RegionItem[] = [square(x, y, background)];
    for (const [cx, cy] of [
      [x + 40, y + 40],
      [x + 120, y + 40],
      [x + 40, y + 120],
      [x + 120, y + 120],
    ]) {
      items.push({ type: 'circle', cx, cy, r: 11.2, color: dot });
    }
    return { kind: 'dots', items };
  }

  // curve-ring | curve-open
  const background: BauhausColor = random() > 0.42 ? 'paper' : chooseColor();
  const foreground = chooseColor(new Set([background]));
  const inner = chooseColor(new Set([background, foreground]));
  const direction = Math.floor(random() * 4);
  const innerDirection = (direction + 2) % 4;
  const innerPosition = innerQuarterPosition(x, y, innerDirection);
  const items: RegionItem[] = [
    square(x, y, background),
    { type: 'path', d: curvePath(x, y, direction, 160), color: foreground },
  ];
  if (nextKind === 'curve-ring') {
    items.push({
      type: 'path',
      d: quarterCirclePath(
        innerPosition.x,
        innerPosition.y,
        innerDirection,
        80
      ),
      color: inner,
    });
  }
  return { kind: nextKind, direction, items };
}
