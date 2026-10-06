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

test('closing the active tab returns to the previously focused tab', () => {
  const tabs = new OpenTabs();
  for (const path of ['a', 'b', 'c']) tabs.open(path);
  tabs.activate(tabs.tabs[0]);
  // Go to definition from `a` opens a preview right after it.
  tabs.preview('modules/Basic/Print.jai');
  assert.deepEqual(paths(tabs), ['a', '~modules/Basic/Print.jai', 'b', 'c']);
  assert.equal(tabs.close(tabs.tabs[1])?.path, 'a');
  assert.equal(tabs.close(tabs.tabs[0])?.path, 'c');
  assert.equal(tabs.close(tabs.tabs[1])?.path, 'b');
  assert.equal(tabs.close(tabs.tabs[0]), undefined);
  assert.deepEqual(paths(tabs), []);
});

test('a replaced preview drops out of the focus history', () => {
  const tabs = new OpenTabs();
  tabs.open('a');
  tabs.open('b');
  tabs.preview('x');
  tabs.preview('y');
  assert.equal(tabs.close(tabs.active!)?.path, 'b');
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
  for (const path of ['main.jai', 'lib/a.jai', 'lib/b.jai', 'c.jai'])
    tabs.open(path);
  tabs.preview('lib/a.jai');
  tabs.activate(tabs.tabs[2]);
  tabs.move(
    new Map([
      ['lib/a.jai', 'src/a.jai'],
      ['lib/b.jai', 'src/b.jai'],
    ])
  );
  assert.deepEqual(paths(tabs), [
    'main.jai',
    'src/a.jai',
    'src/b.jai',
    'c.jai',
    '~lib/a.jai',
  ]);
  assert.equal(tabs.active?.path, 'src/b.jai');
  tabs.retain(new Set(['main.jai', 'c.jai']));
  assert.deepEqual(paths(tabs), ['main.jai', 'c.jai', '~lib/a.jai']);
  // The preview was focused just before the deleted file.
  assert.equal(tabs.active?.preview, true);
});

test('labels add the folder only when names collide', () => {
  const tabs = new OpenTabs();
  for (const path of ['main.jai', 'lib/util.jai', 'src/util.jai'])
    tabs.open(path);
  assert.deepEqual(tabLabel(tabs.tabs[0], tabs.tabs), {
    name: 'main.jai',
    folder: '',
  });
  assert.deepEqual(tabLabel(tabs.tabs[1], tabs.tabs), {
    name: 'util.jai',
    folder: 'lib',
  });
});

test('markdown tabs sit beside the source tab and follow renames', () => {
  const tabs = new OpenTabs();
  tabs.open('README.md');
  const rendered = tabs.openMarkdown('README.md');
  assert.equal(tabs.tabs.length, 2);
  assert.equal(tabs.active, rendered);
  assert.equal(tabs.open('README.md').markdown, undefined);
  assert.equal(tabs.openMarkdown('README.md'), rendered);
  tabs.move(new Map([['README.md', 'docs/guide.md']]));
  assert.deepEqual(
    tabs.tabs.map((tab) => [tab.path, Boolean(tab.markdown)]),
    [
      ['docs/guide.md', false],
      ['docs/guide.md', true],
    ]
  );
  // Renamed away from Markdown: the rendered view has nothing to render.
  tabs.move(new Map([['docs/guide.md', 'docs/guide.txt']]));
  tabs.retain(new Set(['docs/guide.txt']));
  assert.deepEqual(
    tabs.tabs.map((tab) => tab.path),
    ['docs/guide.txt']
  );
});

test('place reorders, adopts tabs from other groups and keeps one preview', () => {
  const tabs = new OpenTabs();
  for (const path of ['a', 'b', 'c']) tabs.open(path);
  tabs.place(tabs.tabs[0], 3);
  assert.deepEqual(paths(tabs), ['b', 'c', 'a']);
  assert.equal(tabs.active?.path, 'a');
  tabs.place({ path: 'd', preview: false }, 0);
  assert.deepEqual(paths(tabs), ['d', 'b', 'c', 'a']);
  // The same file from another group replaces this group's tab for it.
  tabs.place({ path: 'b', preview: false }, 4);
  assert.deepEqual(paths(tabs), ['d', 'c', 'a', 'b']);
  tabs.preview('lib/x.jai');
  tabs.place({ path: 'lib/y.jai', preview: true }, 0);
  assert.deepEqual(paths(tabs), ['~lib/y.jai', 'd', 'c', 'a', 'b']);
  assert.equal(tabs.close(tabs.active!)?.path, 'b');
});
