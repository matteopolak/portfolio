/*
 * A small keyboard-driven list over the editor: code actions, references,
 * polymorph instances and workspace symbol search. One picker exists at a
 * time; it closes on Escape, on picking an item, or when focus leaves it.
 */

export interface PickerItem {
  label: string;
  detail?: string;
  /** Extra line under the label (a reference's source line). */
  preview?: string;
  run?: () => void;
}

export interface PickerOptions {
  /** The heading, e.g. "3 references". */
  title: string;
  items?: readonly PickerItem[];
  /** With a query field: items for the typed text (may be async). */
  search?: (
    query: string
  ) => Promise<readonly PickerItem[]> | readonly PickerItem[];
  placeholder?: string;
  /** Viewport coordinates to open at; otherwise the top of `host`. */
  at?: { left: number; top: number; bottom: number };
  /** Called after it closes (to return focus to the editor). */
  closed?: () => void;
  empty?: string;
}

let current: { close(): void } | undefined;

export function closePicker() {
  current?.close();
}

export function showPicker(host: HTMLElement, options: PickerOptions) {
  closePicker();
  const root = document.createElement('div');
  root.className = 'jai-picker';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', options.title);
  const heading = document.createElement('div');
  heading.className = 'jai-picker__title';
  heading.textContent = options.title;
  const list = document.createElement('ul');
  list.className = 'jai-picker__list';
  list.setAttribute('role', 'listbox');
  list.id = `jai-picker-${Math.random().toString(36).slice(2)}`;
  let input: HTMLInputElement | undefined;
  if (options.search) {
    input = document.createElement('input');
    input.className = 'jai-picker__input';
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = options.placeholder ?? '';
    input.setAttribute('aria-label', options.title);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'true');
    root.append(input);
  } else root.append(heading);
  root.append(list);

  let items: readonly PickerItem[] = [];
  let selected = 0;
  let open = true;
  let query = 0;
  const render = () => {
    list.replaceChildren(
      ...items.map((item, index) => {
        const row = document.createElement('li');
        row.className = 'jai-picker__item';
        row.id = `${list.id}-${index}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(index === selected));
        if (!item.run) row.dataset.static = 'true';
        const label = document.createElement('span');
        label.className = 'jai-picker__label';
        label.textContent = item.label;
        row.append(label);
        if (item.detail) {
          const detail = document.createElement('span');
          detail.className = 'jai-picker__detail';
          detail.textContent = item.detail;
          row.append(detail);
        }
        if (item.preview) {
          const preview = document.createElement('code');
          preview.className = 'jai-picker__preview';
          preview.textContent = item.preview;
          row.append(preview);
        }
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => pick(index));
        return row;
      })
    );
    if (!items.length) {
      const row = document.createElement('li');
      row.className = 'jai-picker__empty';
      row.textContent = options.empty ?? 'No results';
      list.append(row);
    }
    input?.setAttribute(
      'aria-activedescendant',
      items.length ? `${list.id}-${selected}` : ''
    );
    list
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    if (!open) return;
    open = false;
    root.remove();
    document.removeEventListener('mousedown', outside, true);
    if (current?.close === close) current = undefined;
    options.closed?.();
  };
  function pick(index: number) {
    const item = items[index];
    if (!item?.run) return;
    close();
    item.run();
  }
  const outside = (event: MouseEvent) => {
    if (!root.contains(event.target as Node)) close();
  };
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      selected = (selected + step + items.length) % items.length;
      render();
    } else if (event.key === 'Enter') pick(selected);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  const update = async () => {
    const id = ++query;
    const result = await options.search!(input!.value);
    if (id !== query || !open) return;
    items = result;
    selected = 0;
    render();
  };
  input?.addEventListener('input', () => void update().catch(() => {}));

  // Place inside the editor so it scrolls and themes with it.
  host.append(root);
  if (options.at) {
    const box = host.getBoundingClientRect();
    const width = Math.min(root.offsetWidth, box.width - 16);
    const left = Math.min(
      Math.max(8, options.at.left - box.left),
      box.width - width - 8
    );
    const below = options.at.bottom - box.top + 4;
    const fitsBelow = below + root.offsetHeight < box.height - 8;
    root.style.left = `${Math.max(8, left)}px`;
    root.style.top = `${fitsBelow ? below : Math.max(8, options.at.top - box.top - root.offsetHeight - 4)}px`;
  } else root.dataset.centered = 'true';
  document.addEventListener('mousedown', outside, true);
  current = { close };
  items = options.items ?? [];
  render();
  if (input) {
    input.focus();
    void update().catch(() => {});
  } else {
    root.tabIndex = -1;
    root.focus();
  }
  return { close };
}
