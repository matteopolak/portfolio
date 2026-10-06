// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-nocheck -- hand-rolled DOM and client mocks; the code under test is typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../../src/lib/jai/workspace.ts';
import { initializeFileTree } from '../../src/lib/jai/file-tree.ts';

// A minimal DOM: just what initializeFileTree touches.
class Element extends EventTarget {
  children = [];
  dataset = {};
  attributes = {};
  parent = undefined;
  textContent = '';
  value = '';
  className = '';
  style = {
    setProperty() {},
    getPropertyValue() {
      return '';
    },
  };
  offsetWidth = 100;
  offsetHeight = 60;
  constructor(tag) {
    super();
    this.tag = tag;
  }
  get parentElement() {
    return this.parent;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children.forEach((node) => {
      node.parent = undefined;
    });
    this.children = [];
    this.append(...nodes);
  }
  replaceWith(node) {
    const siblings = this.parent.children;
    node.parent = this.parent;
    siblings[siblings.indexOf(this)] = node;
    this.parent = undefined;
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (node) => node !== this
      );
    this.parent = undefined;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  closest(selector) {
    return selector === 'details'
      ? undefined
      : this.dataset.treePath
        ? this
        : this.parent?.closest(selector);
  }
  descendants() {
    return this.children.flatMap((node) => [node, ...node.descendants()]);
  }
  querySelectorAll(selector) {
    const key = {
      '[data-tree-path]': 'treePath',
      '[data-tree-children]': 'treeChildren',
    }[selector];
    return this.descendants().filter(
      (node) => key && node.dataset[key] !== undefined
    );
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus() {
    document.activeElement = this;
  }
  blur() {
    this.dispatchEvent(new Event('blur'));
  }
  select() {}
  scrollIntoView() {}
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  get firstElementChild() {
    return this.children[0];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 600, height: 400 };
  }
}
function harness(changed = () => {}) {
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
  };
  const panel = new Element('section'),
    pane = new Element('aside'),
    tree = new Element('nav'),
    newFile = new Element('button');
  pane.append(tree);
  panel.append(pane, newFile);
  panel.querySelector = (selector) =>
    ({
      '[data-code-files]': tree,
      '[data-code-files-pane]': pane,
      '[data-tree-new-file]': newFile,
    })[selector] ?? null;
  const workspace = new Workspace('main'),
    errors = [],
    controller = new AbortController();
  initializeFileTree(
    panel,
    workspace,
    {
      select() {},
      changed,
      beforeChange() {},
      error: (message) => errors.push(message),
    },
    controller.signal
  );
  const create = () => {
    newFile.dispatchEvent(new Event('click'));
    return tree.descendants().find((node) => node.tag === 'input');
  };
  const enter = (field) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'Enter' });
    field.dispatchEvent(event);
  };
  const rows = () => tree.querySelectorAll('[data-tree-path]');
  return { workspace, tree, rows, errors, controller, create, enter };
}
test('new file is visible immediately even if editor synchronization fails', () => {
  const h = harness(() => {
    throw new Error('editor synchronization failed');
  });
  const input = h.create();
  input.value = 'new.jai';
  h.enter(input);
  assert.ok(h.rows().some((node) => node.dataset.treePath === 'new.jai'));
  assert.equal(h.workspace.selected.path.name, 'new.jai');
  assert.deepEqual(h.errors, ['editor synchronization failed']);
  h.controller.abort();
});
test('blur commits a filename once and empty names cancel', () => {
  const h = harness();
  const input = h.create();
  input.value = 'new.jai';
  input.blur();
  h.enter(input);
  assert.ok(h.rows().some((node) => node.dataset.treePath === 'new.jai'));
  assert.deepEqual(h.errors, []);
  const empty = h.create();
  empty.blur();
  assert.equal(h.workspace.names.length, 2);
  h.controller.abort();
});
