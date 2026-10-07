import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLayout,
  dockZone,
  dropZone,
  emptyGroup,
  findGroup,
  groupDropZone,
  groupRects,
  groupsOf,
  insertionIndex,
  closePanel,
  isPanelOpen,
  movePanel,
  neighbourGroup,
  openPanel,
  openPanels,
  resizeDockPanels,
  nextGroupId,
  normalize,
  panelDock,
  parseLayout,
  removeGroup,
  resizeSplit,
  serializeLayout,
  splitGroup,
  updateGroup,
  type EditorNode,
  type GroupNode,
} from '../../src/lib/workspace-layout-model.ts';

const group = (id: string, ...paths: string[]): GroupNode => ({
  type: 'group',
  id,
  tabs: paths.map((path) => ({ path, kind: 'file' })),
  active: 0,
});

/** A compact picture of a tree: `row(g1 column(g2 g3))`. */
function shape(node: EditorNode): string {
  if (node.type === 'group') return node.id;
  return `${node.direction}(${node.children.map(shape).join(' ')})`;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('default layout: tree on the left, output below the editors', () => {
  const layout = defaultLayout();
  assert.equal(panelDock(layout, 'files'), 'left');
  assert.equal(panelDock(layout, 'output'), 'bottom');
  assert.equal(shape(layout.editors), 'g1');
  // Quasi and BaerScript have no file tree.
  const single = defaultLayout(['output']);
  assert.equal(panelDock(single, 'files'), undefined);
  assert.deepEqual(single.docks.left.panels, []);
  assert.deepEqual(single.closed, []);
  // The Render pane waits, closed, on the right until a program draws.
  assert.equal(panelDock(layout, 'render'), 'right');
  assert.deepEqual(layout.closed, ['render']);
  assert.equal(isPanelOpen(layout, 'render'), false);
  assert.deepEqual(openPanels(layout, 'right'), []);
});

test('opening and closing the Render pane', () => {
  let layout = movePanel(defaultLayout(), 'render', 'bottom');
  assert.deepEqual(openPanels(layout, 'bottom'), [
    { panel: 'output', share: 1 },
  ]);
  layout = openPanel(layout, 'render');
  assert.equal(isPanelOpen(layout, 'render'), true);
  assert.deepEqual(openPanels(layout, 'bottom'), [
    { panel: 'output', share: 0.5 },
    { panel: 'render', share: 0.5 },
  ]);
  // Resizing two open neighbours sets their split of what they hold.
  layout = resizeDockPanels(layout, 'bottom', 0, 0.25);
  const [output, render] = openPanels(layout, 'bottom');
  assert.ok(close(output.share, 0.25) && close(render.share, 0.75));
  // Closed, it keeps its dock and share for the next open.
  const closed = closePanel(layout, 'render');
  assert.equal(panelDock(closed, 'render'), 'bottom');
  assert.deepEqual(openPanels(closed, 'bottom'), [
    { panel: 'output', share: 1 },
  ]);
  const reopened = openPanels(openPanel(closed, 'render'), 'bottom');
  assert.ok(close(reopened[1].share, 0.75));
  // Only closable panels close.
  assert.equal(closePanel(layout, 'output'), layout);
});

test('three panels in one dock', () => {
  let layout = openPanel(defaultLayout(), 'render');
  layout = movePanel(layout, 'files', 'right', 0);
  layout = movePanel(layout, 'output', 'right');
  assert.deepEqual(layout.docks.right.panels, ['files', 'render', 'output']);
  assert.ok(layout.docks.right.shares.every((share) => close(share, 1 / 3)));
  // files 1/2, render 1/6, output 1/3; leaving keeps the others' proportions.
  layout = resizeDockPanels(layout, 'right', 0, 0.75);
  const [render, output] = movePanel(layout, 'files', 'left').docks.right
    .shares;
  assert.ok(close(render, 1 / 3) && close(output, 2 / 3));
});

test('moving panels between docks', () => {
  let layout = defaultLayout(['files', 'output']);
  layout = movePanel(layout, 'output', 'right');
  assert.equal(panelDock(layout, 'output'), 'right');
  assert.deepEqual(layout.docks.bottom.panels, []);
  // Two panels share a dock, in drop order; the input is left alone.
  const both = movePanel(layout, 'files', 'right', 0);
  assert.deepEqual(both.docks.right.panels, ['files', 'output']);
  assert.deepEqual(both.docks.left.panels, []);
  assert.deepEqual(layout.docks.left.panels, ['files']);
  const reordered = movePanel(both, 'files', 'right');
  assert.deepEqual(reordered.docks.right.panels, ['output', 'files']);
});

test('splitting a group beside another', () => {
  let tree: EditorNode = group('g1', 'main.jai');
  tree = splitGroup(tree, 'g1', 'right', group('g2', 'a.jai'));
  assert.equal(shape(tree), 'row(g1 g2)');
  // A split the same way gains a sibling rather than nesting.
  tree = splitGroup(tree, 'g1', 'right', group('g3'));
  assert.equal(shape(tree), 'row(g1 g3 g2)');
  assert.ok(tree.type === 'split');
  assert.deepEqual(tree.sizes, [0.25, 0.25, 0.5]);
  // The other way nests, sharing the target's space.
  tree = splitGroup(tree, 'g2', 'bottom', group('g4'));
  assert.equal(shape(tree), 'row(g1 g3 column(g2 g4))');
  tree = splitGroup(tree, 'g4', 'top', group('g5'));
  assert.equal(shape(tree), 'row(g1 g3 column(g2 g5 g4))');
  tree = splitGroup(tree, 'g1', 'left', group('g6'));
  assert.equal(shape(tree), 'row(g6 g1 g3 column(g2 g5 g4))');
  assert.deepEqual(
    groupsOf(tree).map((item) => item.id),
    ['g6', 'g1', 'g3', 'g2', 'g5', 'g4']
  );
  assert.equal(nextGroupId(tree), 'g7');
  assert.equal(findGroup(tree, 'g2')?.tabs[0].path, 'a.jai');
});

test('removing groups collapses and flattens splits', () => {
  let tree: EditorNode = group('g1');
  tree = splitGroup(tree, 'g1', 'right', group('g2'));
  tree = splitGroup(tree, 'g2', 'bottom', group('g3'));
  tree = splitGroup(tree, 'g3', 'right', group('g4'));
  assert.equal(shape(tree), 'row(g1 column(g2 row(g3 g4)))');
  // g2 goes: the column has one child left, a row inside a row, so it flattens.
  let after = removeGroup(tree, 'g2')!;
  assert.equal(shape(after), 'row(g1 g3 g4)');
  assert.ok(after.type === 'split');
  assert.ok(
    close(
      after.sizes.reduce((a, b) => a + b, 0),
      1
    )
  );
  after = removeGroup(after, 'g3')!;
  after = removeGroup(after, 'g4')!;
  assert.equal(shape(after), 'g1');
  assert.equal(removeGroup(after, 'g1'), undefined);
  assert.equal(removeGroup(after, 'nope'), after);
});

test('a removed group gives its share to the rest in proportion', () => {
  const tree: EditorNode = {
    type: 'split',
    direction: 'row',
    children: [group('g1'), group('g2'), group('g3')],
    sizes: [0.5, 0.25, 0.25],
  };
  const after = removeGroup(tree, 'g3');
  assert.ok(after?.type === 'split');
  assert.ok(close(after.sizes[0], 2 / 3));
  assert.ok(close(after.sizes[1], 1 / 3));
});

test('normalize repairs bad shares and empty splits', () => {
  const messy: EditorNode = {
    type: 'split',
    direction: 'column',
    children: [
      { type: 'split', direction: 'row', children: [], sizes: [] },
      group('g1'),
      {
        type: 'split',
        direction: 'column',
        children: [group('g2'), group('g3')],
        sizes: [Number.NaN, 2],
      },
    ],
    sizes: [1, 1, 1],
  };
  const tidy = normalize(messy)!;
  assert.equal(shape(tidy), 'column(g1 g2 g3)');
  assert.ok(tidy.type === 'split');
  assert.ok(close(tidy.sizes[0], 0.5));
  assert.ok(close(tidy.sizes[1], 0.25));
});

test('resizing a nested split and updating a group', () => {
  let tree: EditorNode = splitGroup(group('g1'), 'g1', 'right', group('g2'));
  tree = splitGroup(tree, 'g2', 'bottom', group('g3'));
  tree = resizeSplit(tree, [1], [3, 1]);
  assert.ok(tree.type === 'split' && tree.children[1].type === 'split');
  assert.deepEqual(tree.children[1].sizes, [0.75, 0.25]);
  tree = updateGroup(tree, 'g3', (item) => ({ ...item, active: 0 }));
  assert.equal(shape(tree), 'row(g1 column(g2 g3))');
});

test('group rectangles and neighbours', () => {
  let tree: EditorNode = splitGroup(group('g1'), 'g1', 'right', group('g2'));
  tree = splitGroup(tree, 'g2', 'bottom', group('g3'));
  const rects = groupRects(tree);
  assert.deepEqual(rects.get('g3'), {
    x: 0.5,
    y: 0.5,
    width: 0.5,
    height: 0.5,
  });
  assert.equal(neighbourGroup(tree, 'g1', 'right'), 'g2');
  assert.equal(neighbourGroup(tree, 'g3', 'left'), 'g1');
  assert.equal(neighbourGroup(tree, 'g2', 'bottom'), 'g3');
  assert.equal(neighbourGroup(tree, 'g2', 'right'), undefined);
  assert.equal(neighbourGroup(tree, 'missing', 'right'), undefined);
});

test('drop zones: outer thirds split, the middle opens in place', () => {
  const rect = { x: 100, y: 100, width: 300, height: 300 };
  assert.equal(dropZone(rect, 250, 250), 'center');
  assert.equal(dropZone(rect, 120, 250), 'left');
  assert.equal(dropZone(rect, 390, 250), 'right');
  assert.equal(dropZone(rect, 250, 110), 'top');
  assert.equal(dropZone(rect, 250, 395), 'bottom');
  // In a corner the nearer edge wins.
  assert.equal(dropZone(rect, 105, 130), 'left');
  assert.equal(dropZone(rect, 130, 105), 'top');
});

test('group drop zones: an empty or a full workspace only opens in place', () => {
  const rect = { x: 0, y: 0, width: 300, height: 300 };
  const open = { empty: false, full: false };
  assert.equal(groupDropZone(rect, 290, 150, open), 'right');
  assert.equal(groupDropZone(rect, 150, 150, open), 'center');
  assert.equal(
    groupDropZone(rect, 290, 150, { empty: true, full: false }),
    'center'
  );
  assert.equal(
    groupDropZone(rect, 10, 150, { empty: false, full: true }),
    'center'
  );
});

test('dock zones and tab insertion points', () => {
  const body = { x: 0, y: 0, width: 1000, height: 600 };
  assert.equal(dockZone(body, 100, 300), 'left');
  assert.equal(dockZone(body, 900, 300), 'right');
  assert.equal(dockZone(body, 500, 100), 'top');
  assert.equal(dockZone(body, 500, 500), 'bottom');
  const spans = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
  ];
  assert.equal(insertionIndex(spans, 20), 0);
  assert.equal(insertionIndex(spans, 60), 1);
  assert.equal(insertionIndex(spans, 160), 2);
  assert.equal(insertionIndex([], 10), 0);
});

test('layouts round-trip through storage', () => {
  let layout = movePanel(defaultLayout(), 'output', 'right');
  layout = {
    ...layout,
    editors: splitGroup(group('g1', 'main.jai'), 'g1', 'bottom', {
      type: 'group',
      id: 'g2',
      tabs: [
        { path: 'tour.md', kind: 'markdown' },
        { path: 'tour.md', kind: 'file' },
      ],
      active: 1,
    }),
  };
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout);
});

test('layouts saved before the Render pane still load', () => {
  // As stored before it existed: two-panel docks have a `ratio`, no `shares` or `closed`.
  const old = JSON.stringify({
    version: 1,
    docks: {
      left: { size: 260, panels: [], ratio: 0.5 },
      right: { size: 300, panels: ['files', 'output'], ratio: 0.3 },
      top: { size: 176, panels: [], ratio: 0.5 },
      bottom: { size: 176, panels: [], ratio: 0.5 },
    },
    editors: group('g1', 'main.jai'),
  });
  const layout = parseLayout(old);
  assert.ok(layout);
  assert.equal(layout.docks.right.size, 300);
  // The newcomer joins its default dock, closed; the others keep their split.
  assert.deepEqual(layout.docks.right.panels, ['files', 'output', 'render']);
  assert.deepEqual(layout.closed, ['render']);
  const [files, output] = openPanels(layout, 'right');
  assert.ok(close(files.share, 0.3) && close(output.share, 0.7));
  // Opened, it takes about a third.
  const shares = openPanels(openPanel(layout, 'render'), 'right');
  assert.ok(close(shares[2].share, 1 / 3));
  // Workspaces without the pane (Quasi, BaerScript) read it as before.
  assert.deepEqual(parseLayout(old, ['files', 'output'])?.closed, []);
  // An open Render pane round-trips.
  const open = openPanel(layout, 'render');
  assert.deepEqual(parseLayout(serializeLayout(open)), open);
  // Files and output are never added: a layout without them was malformed.
  assert.equal(
    parseLayout(old.replace('"files",', ''), ['files', 'output', 'render']),
    undefined
  );
  // `closed` lists only closable panels this workspace has.
  const odd = JSON.parse(serializeLayout(open));
  odd.closed = ['output', 'render', 'render', 'terminal'];
  assert.deepEqual(parseLayout(JSON.stringify(odd))?.closed, ['render']);
  odd.closed = 'render';
  assert.equal(parseLayout(JSON.stringify(odd)), undefined);
});

test('stored layouts are validated', () => {
  const good = JSON.parse(serializeLayout(defaultLayout()));
  const variant = (change: (value: typeof good) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return JSON.stringify(copy);
  };
  assert.equal(parseLayout(null), undefined);
  assert.equal(parseLayout('not json'), undefined);
  assert.equal(parseLayout('[]'), undefined);
  assert.equal(parseLayout(variant((v) => (v.version = 2))), undefined);
  // Every panel exactly once, and only panels this workspace has.
  assert.equal(
    parseLayout(variant((v) => v.docks.right.panels.push('files'))),
    undefined
  );
  assert.equal(
    parseLayout(variant((v) => (v.docks.bottom.panels = []))),
    undefined
  );
  assert.equal(
    parseLayout(variant((v) => v.docks.top.panels.push('terminal'))),
    undefined
  );
  assert.ok(parseLayout(serializeLayout(defaultLayout())));
  assert.equal(
    parseLayout(serializeLayout(defaultLayout()), ['output']),
    undefined
  );
  assert.equal(
    parseLayout(variant((v) => (v.docks.left.size = -5))),
    undefined
  );
  assert.equal(
    parseLayout(variant((v) => (v.docks.left.ratio = 1))),
    undefined
  );
  // Editor trees: known node types, unique ids, matching sizes, sane tabs.
  assert.equal(
    parseLayout(variant((v) => (v.editors = { type: 'pane' }))),
    undefined
  );
  assert.equal(
    parseLayout(
      variant(
        (v) =>
          (v.editors = {
            type: 'split',
            direction: 'row',
            children: [emptyGroup('g1'), emptyGroup('g1')],
            sizes: [0.5, 0.5],
          })
      )
    ),
    undefined
  );
  assert.equal(
    parseLayout(
      variant(
        (v) =>
          (v.editors = {
            type: 'split',
            direction: 'row',
            children: [emptyGroup('g1'), emptyGroup('g2')],
            sizes: [1],
          })
      )
    ),
    undefined
  );
  assert.equal(
    parseLayout(
      variant(
        (v) =>
          (v.editors = {
            ...emptyGroup(),
            tabs: [{ path: 'a.jai', kind: 'binary' }],
          })
      )
    ),
    undefined
  );
  // Repairable details are repaired: duplicate tabs, an active index out of range.
  const repaired = parseLayout(
    variant(
      (v) =>
        (v.editors = {
          ...emptyGroup(),
          tabs: [
            { path: 'a.jai', kind: 'file' },
            { path: 'a.jai', kind: 'file' },
          ],
          active: 7,
        })
    )
  );
  assert.deepEqual(repaired?.editors, {
    type: 'group',
    id: 'g1',
    tabs: [{ path: 'a.jai', kind: 'file' }],
    active: 0,
  });
  // Deep nesting is refused rather than rendered.
  let deep: unknown = emptyGroup('g1');
  for (let index = 0; index < 12; index++)
    deep = { type: 'split', direction: 'row', children: [deep], sizes: [1] };
  assert.equal(parseLayout(variant((v) => (v.editors = deep))), undefined);
});
