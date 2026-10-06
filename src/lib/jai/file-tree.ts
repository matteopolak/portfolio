import type { TreeNode, Workspace } from './workspace.ts';
import { fileIcon, fileIconKind } from './file-icons.ts';

type Kind = TreeNode['kind'];

interface FileTreeCallbacks {
  select(path: string): void;
  /** A file the pointer rests on, so it may be opened next. */
  intent?(path: string): void;
  changed(moves?: Map<string, string>): void;
  error(message: string): void;
  beforeChange(): void;
}

const svgNamespace = 'http://www.w3.org/2000/svg';
const iconPaths = {
  chevron: 'm7.5 5 5 5-5 5',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
};

function icon(name: keyof typeof iconPaths, className: string) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svgNamespace, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
}

const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

/**
 * Renders the workspace file tree. Every action is reachable without a
 * secondary click: the pane header creates items and each row has a menu
 * button, while right-click and arrow-key navigation remain available.
 */
export function initializeFileTree(
  panel: HTMLElement,
  workspace: Workspace,
  { select, intent, changed, error, beforeChange }: FileTreeCallbacks,
  signal: AbortSignal
) {
  const tree = panel.querySelector<HTMLElement>('[data-code-files]')!;
  const pane = panel.querySelector<HTMLElement>('[data-code-files-pane]')!;
  const collapsed = new Set<string>();
  let menu: HTMLElement | undefined;
  let menuTrigger: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;

  function row(node: TreeNode, depth: number) {
    const item = document.createElement('div');
    item.className = 'tree-row';
    item.style.setProperty('--depth', String(depth));
    item.setAttribute('role', 'none');

    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      node.kind === 'file' ? 'tree-item file' : 'tree-item folder';
    button.title = node.path;
    button.dataset.treePath = node.path;
    button.dataset.treeKind = node.kind;
    if (node.kind === 'directory') {
      const open = !collapsed.has(node.path);
      button.setAttribute('aria-expanded', String(open));
      button.append(
        icon('chevron', 'tree-chevron'),
        fileIcon(open ? 'folder-open' : 'folder', 'tree-icon')
      );
    } else {
      button.append(fileIcon(fileIconKind(node.name), 'tree-icon'));
      if (node.path === workspace.selected?.path.name)
        button.setAttribute('aria-current', 'true');
      // A short dwell, so sweeping the pointer across the tree asks nothing.
      let dwell: ReturnType<typeof setTimeout> | undefined;
      button.addEventListener('pointerenter', () => {
        dwell = setTimeout(() => intent?.(node.path), 80);
      });
      button.addEventListener('pointerleave', () => clearTimeout(dwell));
    }
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;
    button.append(label);
    button.addEventListener('click', () => {
      if (node.kind === 'directory') {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        render();
        focusPath(node.path);
      } else {
        select(node.path);
        render();
      }
    });

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tree-more';
    more.tabIndex = -1;
    more.setAttribute('aria-label', `Actions for ${node.name}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.append(icon('more', 'tree-more-icon'));
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = more.getBoundingClientRect();
      openMenu(node.path, node.kind, rect.right, rect.bottom, more);
    });

    item.append(button, more);
    return item;
  }

  function render() {
    const build = (node: TreeNode, depth: number): HTMLElement[] => {
      if (node.kind === 'file') return [row(node, depth)];
      const group = document.createElement('div');
      group.className = 'children';
      group.dataset.treeChildren = node.path;
      group.style.setProperty('--depth', String(depth + 1));
      group.hidden = collapsed.has(node.path);
      group.append(
        ...node.children.flatMap((child) => build(child, depth + 1))
      );
      return [row(node, depth), group];
    };
    const root = document.createElement('div');
    root.className = 'children';
    root.dataset.treeChildren = '';
    root.append(...workspace.tree.children.flatMap((child) => build(child, 0)));
    tree.replaceChildren(root);
  }

  function focusPath(path: string) {
    [...tree.querySelectorAll<HTMLElement>('[data-tree-path]')]
      .find((node) => node.dataset.treePath === path)
      ?.focus();
  }

  function closeMenu(restoreFocus = false) {
    menu?.remove();
    menu = undefined;
    if (restoreFocus) menuTrigger?.focus();
    menuTrigger = undefined;
  }

  function enterName(kind: Kind, path: string, rename = false) {
    input?.blur();
    input?.remove();
    collapsed.delete(rename || kind === 'file' ? parentPath(path) : path);
    render();
    const parent = rename || kind === 'file' ? parentPath(path) : path;
    const target =
      [...tree.querySelectorAll<HTMLElement>('[data-tree-children]')].find(
        (node) => node.dataset.treeChildren === parent
      ) ?? tree;
    const field = document.createElement('input');
    input = field;
    field.className = 'tree-name-input';
    field.spellcheck = false;
    field.autocapitalize = 'off';
    field.setAttribute(
      'aria-label',
      rename
        ? 'Rename item'
        : kind === 'file'
          ? 'New file name'
          : 'New folder name'
    );
    field.placeholder = kind === 'file' ? 'name.jai' : 'folder';
    field.value = rename ? (path.split('/').at(-1) ?? '') : '';
    const renamed = rename
      ? [...tree.querySelectorAll<HTMLElement>('[data-tree-path]')].find(
          (node) => node.dataset.treePath === path
        )
      : undefined;
    if (renamed?.parentElement) {
      field.style.setProperty(
        '--depth',
        renamed.parentElement.style.getPropertyValue('--depth')
      );
      renamed.parentElement.replaceWith(field);
    } else target.append(field);
    field.scrollIntoView({ block: 'nearest' });
    let finished = false;
    const cancel = () => {
      finished = true;
      field.remove();
      if (input === field) input = undefined;
      if (renamed) render();
    };
    const commit = () => {
      if (finished) return;
      const name = field.value.trim();
      if (!name) {
        cancel();
        return;
      }
      try {
        if (name === '.' || name === '..' || /[/\\]/u.test(name))
          throw new Error('Enter a file or folder name.');
        const destination = parent ? `${parent}/${name}` : name;
        beforeChange();
        let moves: Map<string, string> | undefined;
        if (rename) moves = workspace.rename(path, destination);
        else if (kind === 'file') workspace.add(destination);
        else workspace.addFolder(destination);
        finished = true;
        field.remove();
        if (input === field) input = undefined;
        // Publish the tree before editor synchronization can move focus or fail.
        render();
        changed(moves);
      } catch (reason) {
        error(message(reason));
        if (!finished) field.focus();
      }
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    field.addEventListener('blur', commit);
    field.focus();
    field.select();
  }

  function openMenu(
    path: string,
    kind: Kind,
    x: number,
    y: number,
    trigger?: HTMLElement
  ) {
    closeMenu();
    const directory = kind === 'directory' ? path : parentPath(path);
    const element = document.createElement('div');
    menu = element;
    menuTrigger = trigger;
    element.className = 'tree-menu';
    element.setAttribute('role', 'menu');
    const action = (name: string, callback: () => void, danger = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      if (danger) button.dataset.danger = 'true';
      button.textContent = name;
      button.addEventListener('click', () => {
        closeMenu();
        try {
          callback();
        } catch (reason) {
          error(message(reason));
        }
      });
      element.append(button);
    };
    action('New file', () =>
      enterName('file', directory ? `${directory}/new` : 'new')
    );
    action('New folder', () => enterName('directory', directory));
    if (path) {
      action('Rename', () => enterName(kind, path, true));
      action(
        'Delete',
        () => {
          beforeChange();
          workspace.remove(path);
          render();
          changed();
        },
        true
      );
    }
    panel.append(element);
    const rect = panel.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(x - rect.left, rect.width - element.offsetWidth - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(y - rect.top, rect.height - element.offsetHeight - 4))}px`;
    element.querySelector<HTMLElement>('button')?.focus();
  }

  pane.addEventListener(
    'contextmenu',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const item =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tree-path]')
          : null;
      openMenu(
        item?.dataset.treePath ?? '',
        item?.dataset.treeKind === 'file' ? 'file' : 'directory',
        event.clientX,
        event.clientY,
        item ?? undefined
      );
    },
    { signal }
  );

  const selectedDirectory = () =>
    parentPath(workspace.selected?.path.name ?? '');
  panel
    .querySelector<HTMLButtonElement>('[data-tree-new-file]')
    ?.addEventListener(
      'click',
      () => {
        const directory = selectedDirectory();
        enterName('file', directory ? `${directory}/new` : 'new');
      },
      { signal }
    );
  panel
    .querySelector<HTMLButtonElement>('[data-tree-new-folder]')
    ?.addEventListener(
      'click',
      () => enterName('directory', selectedDirectory()),
      { signal }
    );

  tree.addEventListener(
    'keydown',
    (event) => {
      const current =
        event.target instanceof HTMLElement &&
        event.target.dataset.treePath !== undefined
          ? event.target
          : undefined;
      if (!current) return;
      const items = [...tree.querySelectorAll<HTMLElement>('[data-tree-path]')];
      const index = items.indexOf(current);
      const path = current.dataset.treePath ?? '';
      const folder = current.dataset.treeKind === 'directory';
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
      } else if (event.key === 'ArrowRight' && folder && collapsed.has(path)) {
        event.preventDefault();
        current.click();
      } else if (event.key === 'ArrowLeft' && folder && !collapsed.has(path)) {
        event.preventDefault();
        current.click();
      } else if (event.key === 'F2') {
        event.preventDefault();
        enterName(folder ? 'directory' : 'file', path, true);
      } else if (
        event.key === 'ContextMenu' ||
        (event.shiftKey && event.key === 'F10')
      ) {
        event.preventDefault();
        const rect = current.getBoundingClientRect();
        openMenu(
          path,
          folder ? 'directory' : 'file',
          rect.right,
          rect.bottom,
          current
        );
      }
    },
    { signal }
  );

  panel.addEventListener(
    'pointerdown',
    (event) => {
      if (
        menu &&
        !(event.target instanceof Node && menu.contains(event.target))
      )
        closeMenu();
    },
    { signal }
  );
  panel.addEventListener(
    'keydown',
    (event) => {
      if (!menu) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...menu.querySelectorAll<HTMLElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[
          (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
    },
    { signal }
  );
  signal.addEventListener(
    'abort',
    () => {
      closeMenu();
      input?.remove();
    },
    { once: true }
  );
  render();
  return { render };
}
