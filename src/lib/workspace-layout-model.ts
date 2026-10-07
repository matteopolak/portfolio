/*
 * The code workspace's layout as plain data: where the docked panels (file
 * tree, output) sit, and the editor area's tree of splits and editor groups.
 * Nothing here touches the DOM, so it runs under `node --test`;
 * `code-workspace-layout.ts` renders it and `jai/workspace-ui.ts` fills the
 * groups. Every operation returns a new value and leaves its input alone.
 */

export type Dock = 'left' | 'right' | 'top' | 'bottom';
export type PanelId = 'files' | 'output';
/**
 * A view that is not a file but lives in an editor tab like one: the Render
 * tab, where a WebGPU program draws. The workspace has one tab of each.
 */
export type ViewId = 'render';
/** Where a dragged tab lands on an editor group: a split side or the group itself. */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';
export type SplitSide = Exclude<DropZone, 'center'>;

export const DOCKS: readonly Dock[] = ['left', 'right', 'top', 'bottom'];
export const PANELS: readonly PanelId[] = ['files', 'output'];
export const VIEWS: readonly ViewId[] = ['render'];
/**
 * Panels that stored layouts may still name but the workspace no longer has
 * (the Render pane became the Render tab). Parsing drops them.
 */
const RETIRED_PANELS: readonly string[] = ['render'];

/**
 * An open tab worth restoring: a workspace file, the rendered view of a `.md`
 * file, or a view (`path` is then its `ViewId`).
 */
export interface SavedTab {
  path: string;
  kind: 'file' | 'markdown' | 'view';
}

export interface GroupNode {
  type: 'group';
  id: string;
  tabs: SavedTab[];
  /** Index into `tabs` of the active tab (0 when empty). */
  active: number;
}

export interface SplitNode {
  type: 'split';
  /** `row` puts children side by side, `column` stacks them. */
  direction: 'row' | 'column';
  children: EditorNode[];
  /** Each child's share of the split; they sum to 1. */
  sizes: number[];
}

export type EditorNode = GroupNode | SplitNode;

export interface DockState {
  /** Width (left, right) or height (top, bottom) in CSS pixels. */
  size: number;
  /** Panels in the dock, first to last (top to bottom, or left to right). */
  panels: PanelId[];
  /**
   * Each panel's share of the dock, parallel to `panels` (summing to 1).
   * Closed panels keep theirs; the open ones split the dock in proportion.
   */
  shares: number[];
}

export interface WorkspaceLayout {
  version: 1;
  docks: Record<Dock, DockState>;
  editors: EditorNode;
}

export const DOCK_SIZES: Readonly<Record<Dock, number>> = {
  left: 240,
  right: 400,
  top: 176,
  bottom: 176,
};

/** Splits deeper than this are refused when parsing (and never built). */
const MAX_DEPTH = 8;
/** Most editor groups; a drop that would split further opens in place instead. */
export const MAX_GROUPS = 16;
const MAX_TABS = 64;

export const isSideDock = (dock: Dock) => dock === 'left' || dock === 'right';

export function emptyGroup(id = 'g1'): GroupNode {
  return { type: 'group', id, tabs: [], active: 0 };
}

/** Where each panel goes in the default layout. */
const DEFAULT_DOCKS: Readonly<Record<PanelId, Dock>> = {
  files: 'left',
  output: 'bottom',
};

const equalShares = (count: number) =>
  Array.from({ length: count }, () => 1 / count);

/** The tree on the left, output under the editors: the layout before any drag. */
export function defaultLayout(
  panels: readonly PanelId[] = PANELS
): WorkspaceLayout {
  const docks = Object.fromEntries(
    DOCKS.map((dock) => [
      dock,
      { size: DOCK_SIZES[dock], panels: [], shares: [] },
    ])
  ) as unknown as Record<Dock, DockState>;
  for (const panel of PANELS) {
    if (!panels.includes(panel)) continue;
    const dock = docks[DEFAULT_DOCKS[panel]];
    dock.panels = [...dock.panels, panel];
    dock.shares = equalShares(dock.panels.length);
  }
  return { version: 1, docks, editors: emptyGroup() };
}

/** The panels of `dock` with their shares of it (summing to 1). */
export function dockPanels(
  layout: WorkspaceLayout,
  dock: Dock
): { panel: PanelId; share: number }[] {
  const state = layout.docks[dock];
  const shares = normalizeSizes(state.shares, state.panels.length);
  return state.panels.map((panel, index) => ({ panel, share: shares[index] }));
}

export function panelDock(
  layout: WorkspaceLayout,
  panel: PanelId
): Dock | undefined {
  return DOCKS.find((dock) => layout.docks[dock].panels.includes(panel));
}

/**
 * Moves `panel` to `dock`, at `index` among the panels already there (the
 * end by default). Moving within its own dock reorders it. The panels of the
 * dock it joins share that dock equally; the dock it leaves keeps the others'
 * proportions.
 */
export function movePanel(
  layout: WorkspaceLayout,
  panel: PanelId,
  dock: Dock,
  index?: number
): WorkspaceLayout {
  const docks = { ...layout.docks };
  for (const name of DOCKS) {
    const state = docks[name];
    const at = state.panels.indexOf(panel);
    if (at < 0) continue;
    const shares = state.shares.filter((_, item) => item !== at);
    docks[name] = {
      ...state,
      panels: state.panels.filter((item) => item !== panel),
      shares: normalizeSizes(shares, shares.length),
    };
  }
  const target = docks[dock];
  const panels = [...target.panels];
  panels.splice(
    Math.max(0, Math.min(index ?? panels.length, panels.length)),
    0,
    panel
  );
  docks[dock] = { ...target, panels, shares: equalShares(panels.length) };
  return { ...layout, docks };
}

/**
 * Sets the shares of the panels at `first` and `first + 1` of `dock` so that
 * the first takes `fraction` of what the two hold together.
 */
export function resizeDockPanels(
  layout: WorkspaceLayout,
  dock: Dock,
  first: number,
  fraction: number
): WorkspaceLayout {
  const state = layout.docks[dock];
  if (first < 0 || first + 1 >= state.panels.length) return layout;
  const shares = normalizeSizes(state.shares, state.panels.length);
  const pair = shares[first] + shares[first + 1];
  const bounded = Math.min(0.95, Math.max(0.05, fraction));
  shares[first] = pair * bounded;
  shares[first + 1] = pair - shares[first];
  return resizeDock(layout, dock, { shares });
}

export function resizeDock(
  layout: WorkspaceLayout,
  dock: Dock,
  change: Partial<Pick<DockState, 'size' | 'shares'>>
): WorkspaceLayout {
  return {
    ...layout,
    docks: { ...layout.docks, [dock]: { ...layout.docks[dock], ...change } },
  };
}

/** Every group, in reading order (left to right, top to bottom within splits). */
export function groupsOf(node: EditorNode): GroupNode[] {
  return node.type === 'group' ? [node] : node.children.flatMap(groupsOf);
}

export function findGroup(node: EditorNode, id: string): GroupNode | undefined {
  return groupsOf(node).find((group) => group.id === id);
}

/** An id no group in `node` uses yet: `g1`, `g2`, ... */
export function nextGroupId(node: EditorNode): string {
  const used = new Set(groupsOf(node).map((group) => group.id));
  let number = 1;
  while (used.has(`g${number}`)) number++;
  return `g${number}`;
}

/** Replaces the group `id` with whatever `change` returns for it. */
export function updateGroup(
  node: EditorNode,
  id: string,
  change: (group: GroupNode) => EditorNode
): EditorNode {
  if (node.type === 'group') return node.id === id ? change(node) : node;
  return {
    ...node,
    children: node.children.map((child) => updateGroup(child, id, change)),
  };
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

/** Shares that sum to 1 (equal shares when the input is unusable). */
function normalizeSizes(sizes: readonly number[], count: number): number[] {
  const usable =
    sizes.length === count &&
    sizes.every((size) => Number.isFinite(size) && size > 0);
  if (!usable) return Array.from({ length: count }, () => 1 / count);
  const total = sum(sizes);
  return sizes.map((size) => size / total);
}

/**
 * Collapses splits with one child, lifts a child split that runs the same way
 * as its parent into the parent, and drops empty splits. Returns undefined
 * when nothing is left.
 */
export function normalize(node: EditorNode): EditorNode | undefined {
  if (node.type === 'group') return node;
  const children: EditorNode[] = [];
  const sizes: number[] = [];
  const shares = normalizeSizes(node.sizes, node.children.length);
  node.children.forEach((child, index) => {
    const tidy = normalize(child);
    if (!tidy) return;
    if (tidy.type === 'split' && tidy.direction === node.direction) {
      children.push(...tidy.children);
      sizes.push(...tidy.sizes.map((size) => size * shares[index]));
    } else {
      children.push(tidy);
      sizes.push(shares[index]);
    }
  });
  if (!children.length) return undefined;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(sizes, children.length) };
}

/**
 * Puts `group` beside the group `targetId`, on `side`. The two share the
 * target's old space; a split that already runs that way gains a child
 * rather than a nested split.
 */
export function splitGroup(
  node: EditorNode,
  targetId: string,
  side: SplitSide,
  group: GroupNode
): EditorNode {
  const direction = side === 'left' || side === 'right' ? 'row' : 'column';
  const before = side === 'left' || side === 'top';
  function visit(current: EditorNode): EditorNode {
    if (current.type === 'group') {
      if (current.id !== targetId) return current;
      return {
        type: 'split',
        direction,
        children: before ? [group, current] : [current, group],
        sizes: [0.5, 0.5],
      };
    }
    const index = current.children.findIndex(
      (child) => child.type === 'group' && child.id === targetId
    );
    if (index >= 0 && current.direction === direction) {
      const children = [...current.children];
      const sizes = [...current.sizes];
      const half = sizes[index] / 2;
      sizes.splice(index, 1, half, half);
      children.splice(before ? index : index + 1, 0, group);
      return { ...current, children, sizes };
    }
    return { ...current, children: current.children.map(visit) };
  }
  return normalize(visit(node)) ?? group;
}

/**
 * Removes the group `id`; its space goes to its neighbours in proportion.
 * Returns undefined when it was the only group.
 */
export function removeGroup(
  node: EditorNode,
  id: string
): EditorNode | undefined {
  function visit(current: EditorNode): EditorNode | undefined {
    if (current.type === 'group')
      return current.id === id ? undefined : current;
    const children: EditorNode[] = [];
    const sizes: number[] = [];
    current.children.forEach((child, index) => {
      const kept = visit(child);
      if (kept) {
        children.push(kept);
        sizes.push(current.sizes[index] ?? 0);
      }
    });
    if (!children.length) return undefined;
    return { ...current, children, sizes };
  }
  const kept = visit(node);
  return kept && normalize(kept);
}

/** The split reached by following child `path` indices from the root. */
export function splitAt(
  node: EditorNode,
  path: readonly number[]
): SplitNode | undefined {
  let current: EditorNode | undefined = node;
  for (const index of path)
    current = current?.type === 'split' ? current.children[index] : undefined;
  return current?.type === 'split' ? current : undefined;
}

/**
 * The CSS `flex` of a node holding `share` of its split: it grows by its
 * share from a zero basis, so the children of a split divide all of it in
 * proportion whatever its size. The root (share 1) fills the editor area.
 */
export const shareFlex = (share = 1) => `${share} 1 0px`;

/**
 * The CSS `flex` of every node of the tree by its path (child indices joined
 * by `/`; the root is `''`), as the editor area lays it out.
 */
export function editorFlexes(node: EditorNode): Map<string, string> {
  const flexes = new Map<string, string>();
  function visit(current: EditorNode, path: string, share: number) {
    flexes.set(path, shareFlex(share));
    if (current.type === 'group') return;
    const shares = normalizeSizes(current.sizes, current.children.length);
    current.children.forEach((child, index) =>
      visit(child, path ? `${path}/${index}` : String(index), shares[index])
    );
  }
  visit(node, '', 1);
  return flexes;
}

/** Sets the shares of the split at `path`. */
export function resizeSplit(
  node: EditorNode,
  path: readonly number[],
  sizes: readonly number[]
): EditorNode {
  if (node.type === 'group') return node;
  if (!path.length)
    return { ...node, sizes: normalizeSizes(sizes, node.children.length) };
  const [first, ...rest] = path;
  return {
    ...node,
    children: node.children.map((child, index) =>
      index === first ? resizeSplit(child, rest, sizes) : child
    ),
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each group's rectangle within `bounds` (the unit square by default). */
export function groupRects(
  node: EditorNode,
  bounds: Rect = { x: 0, y: 0, width: 1, height: 1 }
): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  function visit(current: EditorNode, rect: Rect) {
    if (current.type === 'group') {
      rects.set(current.id, rect);
      return;
    }
    let offset = 0;
    current.children.forEach((child, index) => {
      const share = current.sizes[index] ?? 0;
      visit(
        child,
        current.direction === 'row'
          ? {
              x: rect.x + rect.width * offset,
              y: rect.y,
              width: rect.width * share,
              height: rect.height,
            }
          : {
              x: rect.x,
              y: rect.y + rect.height * offset,
              width: rect.width,
              height: rect.height * share,
            }
      );
      offset += share;
    });
  }
  visit(node, bounds);
  return rects;
}

/**
 * The group touching group `id` on `side` with the longest shared edge, if
 * any: where "open to the side" goes before it makes a new split.
 */
export function neighbourGroup(
  node: EditorNode,
  id: string,
  side: SplitSide
): string | undefined {
  const rects = groupRects(node);
  const from = rects.get(id);
  if (!from) return undefined;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    Math.min(a1, b1) - Math.max(a0, b0);
  let best: string | undefined;
  let bestOverlap = 0;
  for (const [other, rect] of rects) {
    if (other === id) continue;
    const touching =
      side === 'right'
        ? near(rect.x, from.x + from.width)
        : side === 'left'
          ? near(rect.x + rect.width, from.x)
          : side === 'bottom'
            ? near(rect.y, from.y + from.height)
            : near(rect.y + rect.height, from.y);
    if (!touching) continue;
    const shared =
      side === 'left' || side === 'right'
        ? overlap(from.y, from.y + from.height, rect.y, rect.y + rect.height)
        : overlap(from.x, from.x + from.width, rect.x, rect.x + rect.width);
    if (shared > bestOverlap + 1e-9) {
      best = other;
      bestOverlap = shared;
    }
  }
  return best;
}

/** The group holding the tab of `view`, if one does. */
export function viewGroup(
  node: EditorNode,
  view: ViewId
): GroupNode | undefined {
  return groupsOf(node).find((group) =>
    group.tabs.some((tab) => tab.kind === 'view' && tab.path === view)
  );
}

/**
 * Where a tab dropped at (`x`, `y`) inside an editor group's content lands:
 * the outer third on a side splits that way (the nearer edge wins), the
 * middle opens the tab in the group itself.
 */
export function dropZone(rect: Rect, x: number, y: number): DropZone {
  const fx = rect.width > 0 ? (x - rect.x) / rect.width : 0.5;
  const fy = rect.height > 0 ? (y - rect.y) / rect.height : 0.5;
  const edges: [SplitSide, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  const [side, distance] = edges.reduce((best, edge) =>
    edge[1] < best[1] ? edge : best
  );
  return distance < 1 / 3 ? side : 'center';
}

/**
 * Where a tab or tree file dropped on a group's content goes. A group with no
 * tabs, or a workspace that cannot hold another group, only opens it in place.
 */
export function groupDropZone(
  rect: Rect,
  x: number,
  y: number,
  { empty, full }: { empty: boolean; full: boolean }
): DropZone {
  return empty || full ? 'center' : dropZone(rect, x, y);
}

/**
 * Where a panel dropped at (`x`, `y`) inside the workspace body docks: the
 * outer quarter on the left or right, else the top or bottom half.
 */
export function dockZone(rect: Rect, x: number, y: number): Dock {
  const fx = rect.width > 0 ? (x - rect.x) / rect.width : 0.5;
  const fy = rect.height > 0 ? (y - rect.y) / rect.height : 0.5;
  if (fx < 0.25) return 'left';
  if (fx > 0.75) return 'right';
  return fy < 0.4 ? 'top' : 'bottom';
}

/** The insertion index for a tab dropped at `x` over tabs spanning `spans` (left, width). */
export function insertionIndex(
  spans: readonly { left: number; width: number }[],
  x: number
): number {
  const index = spans.findIndex((span) => x < span.left + span.width / 2);
  return index < 0 ? spans.length : index;
}

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify(layout);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseTab(value: unknown): SavedTab | undefined {
  if (!isRecord(value) || typeof value.path !== 'string' || !value.path)
    return undefined;
  if (value.path.length > 4096) return undefined;
  if (value.kind === 'view')
    return VIEWS.includes(value.path as ViewId)
      ? { path: value.path, kind: 'view' }
      : undefined;
  if (value.kind !== 'file' && value.kind !== 'markdown') return undefined;
  return { path: value.path, kind: value.kind };
}

function parseNode(
  value: unknown,
  depth: number,
  ids: Set<string>,
  views: Set<string>
): EditorNode | undefined {
  if (!isRecord(value) || depth > MAX_DEPTH) return undefined;
  if (value.type === 'group') {
    if (
      typeof value.id !== 'string' ||
      !/^g\d{1,4}$/u.test(value.id) ||
      ids.has(value.id) ||
      ids.size >= MAX_GROUPS ||
      !Array.isArray(value.tabs) ||
      value.tabs.length > MAX_TABS
    )
      return undefined;
    const tabs: SavedTab[] = [];
    for (const item of value.tabs) {
      const tab = parseTab(item);
      if (!tab) return undefined;
      // A view has one tab in the whole workspace; later copies are dropped.
      if (tab.kind === 'view') {
        if (views.has(tab.path)) continue;
        views.add(tab.path);
      }
      if (!tabs.some((t) => t.path === tab.path && t.kind === tab.kind))
        tabs.push(tab);
    }
    ids.add(value.id);
    const active =
      Number.isInteger(value.active) &&
      (value.active as number) >= 0 &&
      (value.active as number) < tabs.length
        ? (value.active as number)
        : 0;
    return { type: 'group', id: value.id, tabs, active };
  }
  if (value.type === 'split') {
    if (
      (value.direction !== 'row' && value.direction !== 'column') ||
      !Array.isArray(value.children) ||
      !Array.isArray(value.sizes) ||
      value.children.length < 1 ||
      value.children.length !== value.sizes.length
    )
      return undefined;
    const children: EditorNode[] = [];
    for (const child of value.children) {
      const parsed = parseNode(child, depth + 1, ids, views);
      if (!parsed) return undefined;
      children.push(parsed);
    }
    const sizes = value.sizes as unknown[];
    if (
      !sizes.every(
        (size) => typeof size === 'number' && Number.isFinite(size) && size > 0
      )
    )
      return undefined;
    return {
      type: 'split',
      direction: value.direction,
      children,
      sizes: sizes as number[],
    };
  }
  return undefined;
}

/**
 * Reads a stored layout. Anything malformed, from another version, or that
 * misplaces a panel (`panels` lists the ones this workspace has) gives
 * undefined, and the caller starts from `defaultLayout`. Older layouts still
 * load: a two-panel `ratio` becomes `shares`, and a panel of `RETIRED_PANELS`
 * (the Render pane, and the `closed` list that hid it) is dropped, the rest
 * of its dock keeping their proportions.
 */
export function parseLayout(
  text: string | null | undefined,
  panels: readonly PanelId[] = PANELS
): WorkspaceLayout | undefined {
  if (!text) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.docks))
    return undefined;
  const docks = {} as Record<Dock, DockState>;
  const seen = new Set<PanelId>();
  for (const dock of DOCKS) {
    const state = value.docks[dock];
    if (!isRecord(state)) return undefined;
    const { size, ratio, shares } = state;
    if (
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 40 ||
      size > 10_000 ||
      (ratio !== undefined &&
        (typeof ratio !== 'number' || !(ratio > 0 && ratio < 1))) ||
      (shares !== undefined && !Array.isArray(shares)) ||
      !Array.isArray(state.panels)
    )
      return undefined;
    const stored: unknown[] = Array.isArray(shares)
      ? shares
      : typeof ratio === 'number' && state.panels.length === 2
        ? [ratio, 1 - ratio]
        : [];
    if (
      stored.some(
        (share) =>
          typeof share !== 'number' || !Number.isFinite(share) || share <= 0
      )
    )
      return undefined;
    const stateShares = normalizeSizes(stored as number[], state.panels.length);
    const list: PanelId[] = [];
    const listShares: number[] = [];
    for (const [index, panel] of (state.panels as unknown[]).entries()) {
      if (RETIRED_PANELS.includes(panel as string)) continue;
      if (!panels.includes(panel as PanelId) || seen.has(panel as PanelId))
        return undefined;
      seen.add(panel as PanelId);
      list.push(panel as PanelId);
      listShares.push(stateShares[index]);
    }
    docks[dock] = {
      size,
      panels: list,
      shares: normalizeSizes(listShares, list.length),
    };
  }
  if (panels.some((panel) => !seen.has(panel))) return undefined;
  const editors = parseNode(value.editors, 0, new Set(), new Set());
  if (!editors) return undefined;
  return { version: 1, docks, editors: normalize(editors) ?? emptyGroup() };
}
