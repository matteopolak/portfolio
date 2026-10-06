// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-nocheck -- hand-rolled DOM and client mocks; the code under test is typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../../src/lib/jai/workspace.ts';

test('empty nested folders survive and appear before files', () => {
  const workspace = new Workspace('main');
  workspace.addFolder('lib/empty');
  assert.equal(workspace.tree.children[0].path, 'lib');
  assert.equal(workspace.tree.children[0].children[0].path, 'lib/empty');
  assert.deepEqual(workspace.snapshot().files, {});
});

test('renaming folders preserves text and selection and moves all descendants', () => {
  const workspace = new Workspace('main');
  workspace.addFolder('lib/empty');
  workspace.add('lib/helper.jai', 'helper');
  const moves = workspace.rename('lib', 'modules');
  assert.equal(moves.get('lib/helper.jai'), 'modules/helper.jai');
  assert.equal(workspace.selected.path.name, 'modules/helper.jai');
  assert.equal(workspace.selected.text, 'helper');
  assert.deepEqual(workspace.snapshot().files, {
    'modules/helper.jai': 'helper',
  });
  assert.equal(workspace.tree.children[0].children[0].path, 'modules/empty');
});

test('name collisions and recursive folder moves fail without modifying files', () => {
  const workspace = new Workspace('main');
  workspace.add('lib/helper.jai', 'one');
  workspace.add('other/helper.jai', 'two');
  const before = workspace.documents;
  assert.throws(() => workspace.rename('lib', 'other'), /already exists/);
  assert.throws(() => workspace.rename('lib', 'lib/child'), /inside itself/);
  assert.throws(() => workspace.add('main.jai/child'), /cannot contain/);
  assert.deepEqual(workspace.documents, before);
});

test('recursive delete removes sources, handles an empty workspace and permits recreation', () => {
  const workspace = new Workspace('main');
  workspace.add('lib/helper.jai', 'helper');
  workspace.remove('lib');
  assert.equal(workspace.selected.path.name, 'main.jai');
  workspace.rename('main.jai', 'renamed.jai');
  assert.throws(() => workspace.snapshot(), /Create main.jai/);
  workspace.remove('renamed.jai');
  assert.equal(workspace.selected, undefined);
  workspace.add('main.jai', 'recreated');
  assert.equal(workspace.snapshot().source, 'recreated');
});
