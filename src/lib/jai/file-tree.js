export function initializeFileTree(
  panel,
  workspace,
  { select, changed, error, beforeChange },
  signal
) {
  const tree = panel.querySelector('[data-code-files]');
  const expanded = new Map();
  let menu, input;
  const parentPath = (path) => path.split('/').slice(0, -1).join('/');
  function icon(folder) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', 'tree-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute(
      'd',
      folder ? 'M2 5h6l2 2h8v10H2z' : 'M5 2h7l4 4v12H5z M12 2v5h4'
    );
    svg.append(path);
    return svg;
  }
  function label(name) {
    const span = document.createElement('span');
    span.className = 'file-label';
    span.textContent = name;
    return span;
  }
  function render() {
    const build = (node) => {
      if (node.kind === 'file') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'file';
        button.title = node.path;
        button.dataset.treePath = node.path;
        button.dataset.treeKind = 'file';
        button.append(icon(false), label(node.name));
        if (node.path === workspace.selected?.path.name)
          button.setAttribute('aria-current', 'page');
        button.addEventListener('click', () => {
          select(node.path);
          render();
        });
        return button;
      }
      const details = document.createElement('details');
      details.open = expanded.get(node.path) ?? true;
      const summary = document.createElement('summary');
      summary.dataset.treePath = node.path;
      summary.dataset.treeKind = 'directory';
      summary.append(icon(true), label(node.name));
      const children = document.createElement('div');
      children.className = 'children';
      children.dataset.treeChildren = node.path;
      children.append(...node.children.map(build));
      details.append(summary, children);
      details.addEventListener('toggle', () =>
        expanded.set(node.path, details.open)
      );
      return details;
    };
    tree.replaceChildren(...workspace.tree.children.map(build));
  }
  function closeMenu() {
    menu?.remove();
    menu = undefined;
  }
  function enterName(kind, path, rename = false) {
    input?.blur();
    input?.remove();
    render();
    const parent = rename || kind === 'file' ? parentPath(path) : path;
    const target =
      [...tree.querySelectorAll('[data-tree-children]')].find(
        (node) => node.dataset.treeChildren === parent
      ) ?? tree;
    const field = document.createElement('input');
    input = field;
    field.className = 'tree-name-input';
    field.setAttribute(
      'aria-label',
      rename
        ? 'Rename item'
        : kind === 'file'
          ? 'New file name'
          : 'New folder name'
    );
    field.value = rename ? path.split('/').at(-1) : '';
    target.append(field);
    if (target.closest('details')) target.closest('details').open = true;
    let finished = false;
    const cancel = () => {
      finished = true;
      field.remove();
      if (input === field) input = undefined;
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
        let moves;
        if (rename) moves = workspace.rename(path, destination);
        else if (kind === 'file') workspace.add(destination);
        else workspace.addFolder(destination);
        cancel();
        // Publish the tree before editor synchronization can move focus or fail.
        render();
        changed(moves);
      } catch (reason) {
        error(reason.message);
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
  panel.querySelector('.code-files').addEventListener(
    'contextmenu',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      const item = event.target.closest('[data-tree-path]');
      const path = item?.dataset.treePath ?? '',
        kind = item?.dataset.treeKind ?? 'directory';
      const directory = kind === 'directory' ? path : parentPath(path);
      menu = document.createElement('div');
      menu.className = 'tree-menu';
      menu.setAttribute('role', 'menu');
      const action = (name, callback) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.textContent = name;
        button.addEventListener('click', () => {
          closeMenu();
          try {
            callback();
          } catch (reason) {
            error(reason.message);
          }
        });
        menu.append(button);
      };
      action('New file', () =>
        enterName('file', directory ? directory + '/new' : '', false)
      );
      action('New folder', () => enterName('directory', directory));
      if (path) {
        action('Rename', () => enterName(kind, path, true));
        action('Delete', () => {
          beforeChange();
          workspace.remove(path);
          render();
          changed();
        });
      }
      panel.append(menu);
      const rect = panel.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(event.clientX - rect.left, rect.width - menu.offsetWidth))}px`;
      menu.style.top = `${Math.max(0, Math.min(event.clientY - rect.top, rect.height - menu.offsetHeight))}px`;
      menu.firstElementChild.focus();
    },
    { signal }
  );
  panel.addEventListener(
    'pointerdown',
    (event) => {
      if (menu && !menu.contains(event.target)) closeMenu();
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
        closeMenu();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...menu.children],
          index = buttons.indexOf(document.activeElement);
        buttons[
          (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
            buttons.length
        ].focus();
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
