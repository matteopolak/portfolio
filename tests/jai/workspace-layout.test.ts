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
  dockPanels,
  movePanel,
  neighbourGroup,
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
  viewGroup,
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
  // Only the tree and the output dock; the Render tab is an editor tab.
  assert.deepEqual(layout.docks.right.panels, []);
});

test('two panels in one dock share it', () => {
  let layout = movePanel(defaultLayout(), 'files', 'bottom', 0);
  assert.deepEqual(dockPanels(layout, 'bottom'), [
    { panel: 'files', share: 0.5 },
    { panel: 'output', share: 0.5 },
  ]);
  // Resizing two neighbours sets their split of what they hold.
  layout = resizeDockPanels(layout, 'bottom', 0, 0.25);
  const [files, output] = dockPanels(layout, 'bottom');
  assert.ok(close(files.share, 0.25) && close(output.share, 0.75));
  // Out of range: nothing changes.
  assert.equal(resizeDockPanels(layout, 'bottom', 1, 0.5), layout);
  // Leaving gives the rest the whole dock.
  assert.deepEqual(dockPanels(movePanel(layout, 'files', 'left'), 'bottom'), [
    { panel: 'output', share: 1 },
  ]);
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

test('older stored layouts still load', () => {
  // Before `shares`: two-panel docks have a `ratio`.
  const docks = {
    left: { size: 260, panels: [], ratio: 0.5 },
    right: { size: 300, panels: ['files', 'output'], ratio: 0.3 },
    top: { size: 176, panels: [], ratio: 0.5 },
    bottom: { size: 176, panels: [], ratio: 0.5 },
  };
  const old = JSON.stringify({
    version: 1,
    docks,
    editors: group('g1', 'main.jai'),
  });
  const layout = parseLayout(old);
  assert.ok(layout);
  assert.equal(layout.docks.right.size, 300);
  const [files, output] = dockPanels(layout, 'right');
  assert.ok(close(files.share, 0.3) && close(output.share, 0.7));
  // Files and output are never added: a layout without them was malformed.
  assert.equal(parseLayout(old.replace('"files",', '')), undefined);
});

test('layouts from the Render pane drop it and keep the rest', () => {
  // The Render pane was a panel, closed through `closed`, before it became a tab.
  const stored = (closed: string[]) =>
    JSON.stringify({
      version: 1,
      docks: {
        left: { size: 240, panels: [], shares: [] },
        right: {
          size: 400,
          panels: ['files', 'render', 'output'],
          shares: [0.2, 0.5, 0.3],
        },
        top: { size: 176, panels: [], shares: [] },
        bottom: { size: 176, panels: [], shares: [] },
      },
      closed,
      editors: group('g1', 'main.jai'),
    });
  for (const closed of [['render'], []]) {
    const layout = parseLayout(stored(closed));
    assert.ok(layout);
    assert.deepEqual(layout.docks.right.panels, ['files', 'output']);
    const [files, output] = dockPanels(layout, 'right');
    assert.ok(close(files.share, 0.4) && close(output.share, 0.6));
    assert.equal('closed' in layout, false);
    assert.deepEqual(parseLayout(serializeLayout(layout)), layout);
  }
});

test('the Render tab is saved with its group, once', () => {
  const render = { path: 'render', kind: 'view' } as const;
  const editors: EditorNode = splitGroup(
    group('g1', 'main.jai'),
    'g1',
    'right',
    { type: 'group', id: 'g2', tabs: [render], active: 0 }
  );
  assert.equal(viewGroup(editors, 'render')?.id, 'g2');
  assert.equal(viewGroup(group('g1', 'main.jai'), 'render'), undefined);
  // A file named like a view is still a file.
  assert.equal(viewGroup(group('g1', 'render'), 'render'), undefined);
  const layout = { ...defaultLayout(), editors };
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout);
  // A second Render tab is dropped (the first in reading order stays).
  const twice = JSON.parse(serializeLayout(layout));
  twice.editors.children[0].tabs.push(render);
  const parsed = parseLayout(JSON.stringify(twice));
  assert.ok(parsed);
  assert.deepEqual(groupsOf(parsed.editors)[0].tabs, [
    { path: 'main.jai', kind: 'file' },
    render,
  ]);
  assert.deepEqual(groupsOf(parsed.editors)[1].tabs, []);
  // Unknown views are malformed.
  const unknown = JSON.parse(serializeLayout(layout));
  unknown.editors.children[1].tabs = [{ path: 'terminal', kind: 'view' }];
  assert.equal(parseLayout(JSON.stringify(unknown)), undefined);
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
