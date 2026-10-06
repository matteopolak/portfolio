import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenTabs, tabLabel } from '../../src/lib/jai/open-tabs.ts';

const paths = (tabs: OpenTabs) =>
  tabs.tabs.map((tab) => (tab.preview ? `~${tab.path}` : tab.path));

test('opening focuses an existing tab or inserts after the active one', () => {
  const tabs = new OpenTabs();
  tabs.open('main.jai');
  tabs.open('b.jai');
  tabs.activate(tabs.tabs[0]);
  tabs.open('a.jai');
  assert.deepEqual(paths(tabs), ['main.jai', 'a.jai', 'b.jai']);
  const again = tabs.open('b.jai');
  assert.equal(tabs.tabs.length, 3);
  assert.equal(tabs.active, again);
});

test('closing the active tab activates its right neighbour, then its left', () => {
  const tabs = new OpenTabs();
  for (const path of ['a', 'b', 'c']) tabs.open(path);
  tabs.activate(tabs.tabs[1]);
  assert.equal(tabs.close(tabs.tabs[1])?.path, 'c');
  assert.equal(tabs.close(tabs.tabs[1])?.path, 'a');
  assert.equal(tabs.close(tabs.tabs[0]), undefined);
  assert.deepEqual(paths(tabs), []);
});

test('closing an inactive tab keeps the active one', () => {
  const tabs = new OpenTabs();
  for (const path of ['a', 'b']) tabs.open(path);
  assert.equal(tabs.close(tabs.tabs[0])?.path, 'b');
});

test('one preview tab is replaced in place by the next preview', () => {
  const tabs = new OpenTabs();
  tabs.open('main.jai');
  tabs.open('lib.jai');
  tabs.activate(tabs.tabs[0]);
  tabs.preview('modules/Basic/module.jai');
  tabs.activate(tabs.tabs[2]);
  tabs.preview('modules/Basic/Print.jai');
  assert.deepEqual(paths(tabs), [
    'main.jai',
    '~modules/Basic/Print.jai',
    'lib.jai',
  ]);
  assert.equal(tabs.active?.preview, true);
});

test('renames follow files and deletes close tabs', () => {
  const tabs = new OpenTabs();
  for (const path of ['main.jai', 'lib/a.jai', 'lib/b.jai', 'c.jai']) tabs.open(path);
  tabs.preview('lib/a.jai');
  tabs.activate(tabs.tabs[2]);
  tabs.move(new Map([['lib/a.jai', 'src/a.jai'], ['lib/b.jai', 'src/b.jai']]));
  assert.deepEqual(paths(tabs), ['main.jai', 'src/a.jai', 'src/b.jai', 'c.jai', '~lib/a.jai']);
  assert.equal(tabs.active?.path, 'src/b.jai');
  tabs.retain(new Set(['main.jai', 'c.jai']));
  assert.deepEqual(paths(tabs), ['main.jai', 'c.jai', '~lib/a.jai']);
  assert.equal(tabs.active?.path, 'c.jai');
});

test('labels add the folder only when names collide', () => {
  const tabs = new OpenTabs();
  for (const path of ['main.jai', 'lib/util.jai', 'src/util.jai']) tabs.open(path);
  assert.deepEqual(tabLabel(tabs.tabs[0], tabs.tabs), { name: 'main.jai', folder: '' });
  assert.deepEqual(tabLabel(tabs.tabs[1], tabs.tabs), { name: 'util.jai', folder: 'lib' });
});
