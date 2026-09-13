export type BauhausColor = 'paper' | 'ink' | 'red' | 'blue' | 'yellow';

type Placement = { column: number; row: number };

export type BauhausShape =
  | (Placement & {
      kind: 'curve';
      background: BauhausColor;
      color: BauhausColor;
      innerColor?: BauhausColor;
      direction: 0 | 1 | 2 | 3;
      band: boolean;
    })
  | (Placement & {
      kind: 'dots';
      background: BauhausColor;
      color: BauhausColor;
      rotates: boolean;
    })
  | (Placement & {
      kind: 'stripes';
      colors: [BauhausColor, BauhausColor];
      orientation: 'horizontal' | 'vertical';
    })
  | (Placement & {
      kind: 'solid';
      color: BauhausColor;
    })
  | (Placement & { kind: 'empty' });

export interface BauhausPattern {
  columns: number;
  rows: number;
  seed: string;
  shapes: BauhausShape[];
}

interface GenerateOptions {
  columns: number;
  rows: number;
  seed: string;
  density?: number;
}

const colors: BauhausColor[] = ['red', 'blue', 'yellow', 'ink'];

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function generateBauhausPattern({
  columns,
  rows,
  seed,
  density = 0.72,
}: GenerateOptions): BauhausPattern {
  if (columns < 2 || rows < 2) {
    throw new Error('Bauhaus patterns require at least a 2 by 2 grid.');
  }

  const random = seededRandom(hashSeed(seed));
  const moduleColumns = Math.floor(columns / 2);
  const moduleRows = Math.floor(rows / 2);
  const placedColors = Array.from({ length: moduleRows }, () =>
    Array.from<Set<BauhausColor> | undefined>(
      { length: moduleColumns },
      () => undefined
    )
  );
  const shapes: BauhausShape[] = [];

  const neighboringColors = (moduleColumn: number, moduleRow: number) => {
    const neighbors: BauhausColor[] = [];
    if (moduleRow > 0 && placedColors[moduleRow - 1][moduleColumn]) {
      neighbors.push(...placedColors[moduleRow - 1][moduleColumn]);
    }
    if (
      moduleRow + 1 < moduleRows &&
      placedColors[moduleRow + 1][moduleColumn]
    ) {
      neighbors.push(...placedColors[moduleRow + 1][moduleColumn]);
    }
    if (moduleColumn > 0 && placedColors[moduleRow][moduleColumn - 1]) {
      neighbors.push(...placedColors[moduleRow][moduleColumn - 1]);
    }
    if (
      moduleColumn + 1 < moduleColumns &&
      placedColors[moduleRow][moduleColumn + 1]
    ) {
      neighbors.push(...placedColors[moduleRow][moduleColumn + 1]);
    }
    return neighbors;
  };

  const chooseColor = (
    moduleColumn: number,
    moduleRow: number,
    except: BauhausColor[] = []
  ) => {
    const excluded = new Set(except);
    const neighbors = neighboringColors(moduleColumn, moduleRow);
    return colors
      .filter((color) => !excluded.has(color))
      .map((color) => ({
        color,
        score:
          neighbors.filter((neighbor) => neighbor === color).length * -6 +
          random(),
      }))
      .sort((left, right) => left.score - right.score)[0].color;
  };

  const candidates = shuffled(
    Array.from({ length: moduleRows }, (_, moduleRow) =>
      Array.from({ length: moduleColumns }, (_, moduleColumn) => ({
        moduleColumn,
        moduleRow,
      }))
    ).flat(),
    random
  );
  const motifCycle = shuffled(
    [
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
    ] as const,
    random
  );
  const isCroppedAtEdge = (column: number, row: number) =>
    columns >= 5 &&
    rows >= 5 &&
    (column === 0 || row === 0 || column + 2 === columns || row + 2 === rows);

  for (const { moduleColumn, moduleRow } of candidates) {
    const edgeDistance = Math.min(
      moduleColumn,
      moduleRow,
      moduleColumns - moduleColumn - 1,
      moduleRows - moduleRow - 1
    );
    const fadeDepth = Math.min(
      2,
      Math.max(1, Math.floor(Math.min(moduleColumns, moduleRows) / 4))
    );
    const edgeFactor = Math.min(1, edgeDistance / fadeDepth);
    const fillChance = Math.min(0.97, density * 0.52 + edgeFactor * 0.66);
    if (random() > fillChance) continue;

    const column = moduleColumn * 2;
    const row = moduleRow * 2;
    const motif = motifCycle[shapes.length % motifCycle.length];

    if (motif === 'dots') {
      const background =
        random() > 0.48 ? 'paper' : chooseColor(moduleColumn, moduleRow);
      shapes.push({
        kind: 'dots',
        column,
        row,
        background,
        color:
          background === 'paper' || background === 'yellow' ? 'ink' : 'paper',
        rotates: !isCroppedAtEdge(column, row) && random() > 0.55,
      });
      placedColors[moduleRow][moduleColumn] = new Set([background]);
      continue;
    }

    if (motif === 'solid') {
      const color = chooseColor(moduleColumn, moduleRow);
      shapes.push({ kind: 'solid', column, row, color });
      placedColors[moduleRow][moduleColumn] = new Set([color]);
      continue;
    }

    if (motif === 'stripes') {
      const first = chooseColor(moduleColumn, moduleRow);
      const second = chooseColor(moduleColumn, moduleRow, [first]);
      shapes.push({
        kind: 'stripes',
        column,
        row,
        colors: [first, second],
        orientation: random() > 0.5 ? 'horizontal' : 'vertical',
      });
      placedColors[moduleRow][moduleColumn] = new Set([first, second]);
      continue;
    }

    const background =
      random() > 0.48 ? 'paper' : chooseColor(moduleColumn, moduleRow);
    const color = chooseColor(moduleColumn, moduleRow, [background]);
    const band = motif === 'curve-ring';
    const innerColor = band
      ? chooseColor(moduleColumn, moduleRow, [background, color])
      : undefined;
    shapes.push({
      kind: 'curve',
      column,
      row,
      background,
      color,
      innerColor,
      direction: Math.floor(random() * 4) as 0 | 1 | 2 | 3,
      band,
    });
    placedColors[moduleRow][moduleColumn] = new Set([
      background,
      color,
      ...(innerColor ? [innerColor] : []),
    ]);
  }

  for (let moduleRow = 0; moduleRow < moduleRows; moduleRow += 1) {
    for (
      let moduleColumn = 0;
      moduleColumn < moduleColumns;
      moduleColumn += 1
    ) {
      if (placedColors[moduleRow][moduleColumn]) continue;
      shapes.push({
        kind: 'empty',
        column: moduleColumn * 2,
        row: moduleRow * 2,
      });
    }
  }

  const shapeAt = new Map(
    shapes.map((shape) => [`${shape.column / 2}:${shape.row / 2}`, shape])
  );
  shapes.forEach((shape, index) => {
    if (shape.kind !== 'stripes') return;
    const moduleColumn = shape.column / 2;
    const moduleRow = shape.row / 2;
    const touchesCurveAcrossVerticalEdge = [-1, 1].some(
      (offset) =>
        shapeAt.get(`${moduleColumn + offset}:${moduleRow}`)?.kind === 'curve'
    );
    const touchesCurveAcrossHorizontalEdge = [-1, 1].some(
      (offset) =>
        shapeAt.get(`${moduleColumn}:${moduleRow + offset}`)?.kind === 'curve'
    );

    if (touchesCurveAcrossVerticalEdge && touchesCurveAcrossHorizontalEdge) {
      shapes[index] = {
        kind: 'solid',
        column: shape.column,
        row: shape.row,
        color: shape.colors[0],
      };
    } else if (touchesCurveAcrossVerticalEdge) {
      shape.orientation = 'vertical';
    } else if (touchesCurveAcrossHorizontalEdge) {
      shape.orientation = 'horizontal';
    }
  });

  return { columns, rows, seed, shapes };
}
