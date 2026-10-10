import { clearOutput } from './code-output.ts';
import { workspaceChromeFor, type WorkspacePane } from './workspace-chrome.ts';
import {
  defaultLayout,
  dockPanels,
  dockZone,
  editorFlexes,
  shareFlex,
  DOCKS,
  isSideDock,
  DOCK_SIZES,
  SPLIT_MIN_WIDTH,
  movePanel,
  panelDock,
  parseLayout,
  resizeDock,
  resizeDockPanels,
  resizeSplit,
  serializeLayout,
  splitAt,
  type Dock,
  type EditorNode,
  type PanelId,
  type WorkspaceLayout,
} from './workspace-layout-model.ts';

export type { WorkspacePane } from './workspace-chrome.ts';

/** Below this width the workspace is one pane at a time, picked by the bottom tabs. */
export const NARROW_QUERY = '(max-width: 42rem)';
/** Pointer travel (px) before a press on a tab or panel header becomes a drag. */
const DRAG_THRESHOLD = 5;
const SAVE_DELAY = 250;

/**
 * Selects the visible pane in the narrow tabbed layout. Desktop ignores it.
 * The pane is Svelte state of the mounted workspace; `data-pane` on the root
 * and the bottom tabs follow it.
 */
export function showPane(panel: HTMLElement, pane: WorkspacePane) {
  workspaceChromeFor(panel)?.setPane(pane);
}

/** True in the phone layout, where nothing is docked or split. */
export const isNarrow = () =>
  typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;

/* Pointer drag with a drop overlay */

export interface DropTarget<T> {
  /** The highlighted region, in client coordinates. */
  rect: { left: number; top: number; width: number; height: number };
  /** A thin insertion bar (between tabs) instead of a filled region. */
  insert?: boolean;
  value: T;
}

export interface DragOptions<T> {
  /** The workspace; the overlay and the label are drawn inside it. */
  panel: HTMLElement;
  /** Shown next to the pointer while dragging. */
  label: string;
  /** The drop target under the pointer, if any. */
  resolve(x: number, y: number): DropTarget<T> | undefined;
  drop(value: T): void;
}

/**
 * Follows a press that may become a drag. Nothing happens until the pointer
 * travels `DRAG_THRESHOLD` pixels, so plain clicks stay clicks; after a drag
 * the click the release would cause is swallowed. Escape cancels.
 */
export function trackDrag<T>(down: PointerEvent, options: DragOptions<T>) {
  if (down.button !== 0 || !down.isPrimary) return;
  const { panel } = options;
  const startX = down.clientX,
    startY = down.clientY;
  let dragging = false;
  let target: DropTarget<T> | undefined;
  let overlay: HTMLElement | undefined;
  let label: HTMLElement | undefined;
  const controller = new AbortController();
  const listen = { signal: controller.signal, capture: true };

  function place(x: number, y: number) {
    const box = panel.getBoundingClientRect();
    label!.style.transform = `translate(${x - box.left + 14}px, ${y - box.top + 12}px)`;
    target = options.resolve(x, y);
    overlay!.hidden = !target;
    if (!target) return;
    const { rect } = target;
    overlay!.toggleAttribute('data-insert', Boolean(target.insert));
    overlay!.style.left = `${rect.left - box.left}px`;
    overlay!.style.top = `${rect.top - box.top}px`;
    overlay!.style.width = `${rect.width}px`;
    overlay!.style.height = `${rect.height}px`;
  }
  function begin() {
    dragging = true;
    panel.classList.add('dragging');
    getSelection()?.removeAllRanges();
    overlay = document.createElement('div');
    overlay.className = 'ide-drop';
    overlay.hidden = true;
    label = document.createElement('div');
    label.className = 'ide-drag-label';
    label.textContent = options.label;
    panel.append(overlay, label);
  }
  function finish(dropped: boolean) {
    controller.abort();
    if (!dragging) return;
    panel.classList.remove('dragging');
    overlay?.remove();
    label?.remove();
    // The release over the pressed element would still click it.
    const swallow = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(
      () => window.removeEventListener('click', swallow, { capture: true }),
      0
    );
    if (dropped && target) options.drop(target.value);
  }
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerId !== down.pointerId) return;
      if (!dragging) {
        if (
          Math.hypot(event.clientX - startX, event.clientY - startY) <
          DRAG_THRESHOLD
        )
          return;
        begin();
      }
      event.preventDefault();
      place(event.clientX, event.clientY);
    },
    listen
  );
  window.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerId === down.pointerId) finish(true);
    },
    listen
  );
  window.addEventListener('pointercancel', () => finish(false), listen);
  // Only the window losing focus cancels. Element blurs reach this capturing
  // listener too, and pressing a focusable row (a tree file) blurs the editor.
  window.addEventListener(
    'blur',
    (event) => {
      if (event.target === window) finish(false);
    },
    listen
  );
  // A native drag or text selection would take the pointer over.
  for (const type of ['dragstart', 'selectstart'])
    window.addEventListener(type, (event) => event.preventDefault(), listen);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !dragging) return;
      // Ahead of the dialog, Vim and the editor: Escape only cancels the drag.
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(false);
    },
    listen
  );
}

/* Resize handles */

interface ResizeOptions {
  /** `col`: a vertical rule moved sideways; `row`: a horizontal rule moved up and down. */
  axis: 'col' | 'row';
  label: string;
  /** The size the handle controls, in px. */
  current(): number;
  /** Moving the pointer right or down by `delta` px changes the size by `sign * delta`. */
  sign: 1 | -1;
  minimum: number;
  maximum(): number;
  set(size: number): void;
  /** After a drag or a key press: save. */
  done(): void;
}

function divider(
  panel: HTMLElement,
  options: ResizeOptions,
  signal: AbortSignal
): HTMLElement {
  const handle = document.createElement('div');
  const vertical = options.axis === 'col';
  handle.className = `ide-divider ide-divider--${options.axis}`;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', options.label);
  handle.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
  handle.setAttribute('aria-valuemin', String(options.minimum));
  handle.tabIndex = 0;
  const publish = () => {
    handle.setAttribute('aria-valuenow', String(Math.round(options.current())));
    handle.setAttribute(
      'aria-valuemax',
      String(Math.round(Math.max(options.minimum, options.maximum())))
    );
  };
  publish();
  const set = (value: number) => {
    const maximum = Math.max(options.minimum, options.maximum());
    const bounded = Math.max(options.minimum, Math.min(value, maximum));
    options.set(bounded);
    handle.setAttribute('aria-valuenow', String(Math.round(bounded)));
    handle.setAttribute('aria-valuemax', String(Math.round(maximum)));
  };
  let start: number | undefined;
  let size = 0;
  handle.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      start = vertical ? event.clientX : event.clientY;
      size = options.current();
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('resizing');
      handle.classList.add('active');
    },
    { signal }
  );
  handle.addEventListener(
    'pointermove',
    (event) => {
      if (start === undefined) return;
      const delta = (vertical ? event.clientX : event.clientY) - start;
      set(size + options.sign * delta);
    },
    { signal }
  );
  const finish = () => {
    if (start === undefined) return;
    start = undefined;
    panel.classList.remove('resizing');
    handle.classList.remove('active');
    options.done();
  };
  handle.addEventListener('pointerup', finish, { signal });
  handle.addEventListener('pointercancel', finish, { signal });
  handle.addEventListener('lostpointercapture', finish, { signal });
  handle.addEventListener(
    'focus',
    () => {
      handle.setAttribute(
        'aria-valuenow',
        String(Math.round(options.current()))
      );
      handle.setAttribute(
        'aria-valuemax',
        String(Math.round(Math.max(options.minimum, options.maximum())))
      );
    },
    { signal }
  );
  handle.addEventListener(
    'keydown',
    (event) => {
      const keys: Record<string, number> = vertical
        ? { ArrowLeft: -16, ArrowRight: 16 }
        : { ArrowUp: -16, ArrowDown: 16 };
      const step = keys[event.key];
      if (step === undefined) return;
      event.preventDefault();
      set(options.current() + options.sign * step);
      options.done();
    },
    { signal }
  );
  return handle;
}

/* Layout controller */

export interface WorkspaceLayoutController {
  readonly layout: WorkspaceLayout;
  /** The element holding the editor area (one editor, or a tree of groups). */
  readonly editors: HTMLElement;
  /**
   * Replaces the editor tree. With `elements`, the editor area is rebuilt
   * from the groups' elements; without, only the saved copy changes (tabs).
   */
  setEditors(
    editors: EditorNode,
    elements?: (id: string) => HTMLElement | undefined
  ): void;
  /** Calls `listener` on Reset layout (after the panels are back) until `until` aborts. */
  onReset(listener: () => void, until: AbortSignal): void;
}

const controllers = new WeakMap<HTMLElement, WorkspaceLayoutController>();

/** The layout of a workspace that `initializeWorkspaceLayout` has set up. */
export function workspaceLayout(panel: HTMLElement) {
  return controllers.get(panel);
}

const storageKey = (panel: HTMLElement) =>
  `code-workspace-layout:${panel.dataset.codeLanguage ?? 'code'}`;

function loadLayout(panel: HTMLElement, panels: readonly PanelId[]) {
  try {
    return parseLayout(localStorage.getItem(storageKey(panel)), panels);
  } catch {
    return undefined;
  }
}

function storeLayout(panel: HTMLElement, layout: WorkspaceLayout | undefined) {
  try {
    if (layout)
      localStorage.setItem(storageKey(panel), serializeLayout(layout));
    else localStorage.removeItem(storageKey(panel));
  } catch {
    /* Without storage the layout lasts for this page. */
  }
}

const panelNames: Record<PanelId, string> = {
  files: 'file tree',
  output: 'output',
};

const panelLabels: Record<PanelId, string> = {
  files: 'Files',
  output: 'Output',
};

type Box = { left: number; top: number; width: number; height: number };

function initializeLayout(
  panel: HTMLElement,
  signal: AbortSignal
): WorkspaceLayoutController | undefined {
  const layoutElement = panel.querySelector<HTMLElement>('[data-code-layout]');
  const editorsElement = panel.querySelector<HTMLElement>(
    '[data-code-editors]'
  );
  if (!layoutElement || !editorsElement) return undefined;
  const root: HTMLElement = layoutElement;
  const editors: HTMLElement = editorsElement;
  const body = root.parentElement!;
  const elements: Partial<Record<PanelId, HTMLElement>> = {};
  const files = panel.querySelector<HTMLElement>('[data-code-files-pane]');
  const output = panel.querySelector<HTMLElement>('[data-code-output-pane]');
  if (files) elements.files = files;
  if (output) elements.output = output;
  const available = (Object.keys(elements) as PanelId[]).sort();
  let layout = loadLayout(panel, available) ?? defaultLayout(available);
  let groupElements: ((id: string) => HTMLElement | undefined) | undefined;
  const resetListeners = new Set<() => void>();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storeLayout(panel, layout), SAVE_DELAY);
  };
  const toggle = panel.querySelector<HTMLButtonElement>(
    '[data-code-output-toggle]'
  );
  const extent = (element: Element, side: boolean) =>
    element.getBoundingClientRect()[side ? 'width' : 'height'];

  /** Keeps scroll positions across the DOM moves of a re-render. */
  function keepScroll(action: () => void) {
    const scrolled = [
      ...panel.querySelectorAll<HTMLElement>(
        '.cm-scroller, .ide-tree, .md-preview, [data-code-output]'
      ),
    ].map(
      (element) => [element, element.scrollTop, element.scrollLeft] as const
    );
    action();
    for (const [element, top, left] of scrolled) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }

  const outputCollapsed = (dock: Dock) => {
    const open = dockPanels(layout, dock);
    return (
      !isSideDock(dock) &&
      open.length === 1 &&
      open[0].panel === 'output' &&
      panel.dataset.outputCollapsed === 'true'
    );
  };

  /**
   * A dock's flex basis. An editor area too narrow to split off the Render
   * tab (`SPLIT_MIN_WIDTH`) gives an untouched top or bottom dock half the
   * height, so the code and the output split evenly; a dragged size wins.
   */
  function dockBasis(dock: Dock) {
    if (outputCollapsed(dock)) return 'auto';
    const size = layout.docks[dock].size;
    const cramped =
      !isSideDock(dock) &&
      size === DOCK_SIZES[dock] &&
      !isNarrow() &&
      editors.getBoundingClientRect().width < SPLIT_MIN_WIDTH;
    return cramped ? '50%' : `${size}px`;
  }

  function dockElement(dock: Dock) {
    const open = dockPanels(layout, dock);
    const element = document.createElement('div');
    element.className = 'ide-dock';
    element.dataset.dock = dock;
    element.style.flexBasis = dockBasis(dock);
    // Several panels in one dock: stacked in a side dock, side by side otherwise.
    const stacked = isSideDock(dock);
    open.forEach(({ panel: id, share }, index) => {
      const pane = elements[id]!;
      pane.dataset.dock = dock;
      pane.style.flex = open.length > 1 ? `${share} 1 0` : '';
      if (index > 0) {
        const before = elements[open[index - 1].panel]!;
        const pair = () => extent(before, !stacked) + extent(pane, !stacked);
        element.append(
          divider(
            panel,
            {
              axis: stacked ? 'row' : 'col',
              label: `Resize ${panelNames[open[index - 1].panel]} and ${panelNames[id]}`,
              sign: 1,
              minimum: 72,
              current: () => extent(before, !stacked),
              maximum: () => pair() - 72,
              set: (size) => {
                layout = resizeDockPanels(
                  layout,
                  dock,
                  index - 1,
                  size / pair()
                );
                for (const item of dockPanels(layout, dock))
                  elements[item.panel]!.style.flex = `${item.share} 1 0`;
              },
              done: save,
            },
            signal
          )
        );
      }
      element.append(pane);
    });
    return element;
  }

  function dockDivider(dock: Dock, element: HTMLElement) {
    const side = isSideDock(dock);
    const names = dockPanels(layout, dock).map(
      ({ panel: id }) => panelNames[id]
    );
    const handle = divider(
      panel,
      {
        axis: side ? 'col' : 'row',
        label: `Resize ${names.join(' and ')}`,
        sign: dock === 'left' || dock === 'top' ? 1 : -1,
        minimum: side ? 140 : 72,
        current: () => extent(element, side),
        maximum: () => extent(body, side) - (side ? 240 : 120),
        set: (size) => {
          layout = resizeDock(layout, dock, { size });
          element.style.flexBasis = `${size}px`;
          measureEditorStart();
        },
        done: save,
      },
      signal
    );
    handle.dataset.codeResize = dock;
    return handle;
  }

  function renderEditors() {
    if (!groupElements) return;
    const lookup = groupElements;
    // Proportional sizes all the way up: the root fills the editor area, so
    // the groups cover it at any window size (ResizeObservers do the rest).
    const flexes = editorFlexes(layout.editors);
    const build = (node: EditorNode, path: number[]): HTMLElement => {
      const element = place(node, path);
      element.style.flex = flexes.get(path.join('/')) ?? shareFlex();
      return element;
    };
    const place = (node: EditorNode, path: number[]): HTMLElement => {
      if (node.type === 'group') return lookup(node.id)!;
      const split = document.createElement('div');
      split.className = 'ide-split';
      split.dataset.direction = node.direction;
      const row = node.direction === 'row';
      const minimum = row ? 120 : 72;
      const children = node.children.map((child, index) =>
        build(child, [...path, index])
      );
      children.forEach((element, index) => {
        if (index > 0) {
          const before = children[index - 1];
          const pair = () => extent(before, row) + extent(element, row);
          split.append(
            divider(
              panel,
              {
                axis: row ? 'col' : 'row',
                label: 'Resize editor groups',
                sign: 1,
                minimum,
                current: () => extent(before, row),
                maximum: () => pair() - minimum,
                set: (size) => {
                  const current = splitAt(layout.editors, path);
                  if (!current) return;
                  const shares =
                    current.sizes[index - 1] + current.sizes[index];
                  const sizes = [...current.sizes];
                  sizes[index - 1] = (shares * size) / pair();
                  sizes[index] = shares - sizes[index - 1];
                  layout = {
                    ...layout,
                    editors: resizeSplit(layout.editors, path, sizes),
                  };
                  before.style.flex = shareFlex(sizes[index - 1]);
                  element.style.flex = shareFlex(sizes[index]);
                },
                done: save,
              },
              signal
            )
          );
        }
        split.append(element);
      });
      return split;
    };
    editors.replaceChildren(build(layout.editors, []));
  }

  function render() {
    keepScroll(() => {
      const before: HTMLElement[] = [],
        after: HTMLElement[] = [],
        above: HTMLElement[] = [],
        below: HTMLElement[] = [];
      for (const dock of DOCKS) {
        if (!layout.docks[dock].panels.length) continue;
        const element = dockElement(dock);
        const rule = dockDivider(dock, element);
        if (dock === 'left') before.push(element, rule);
        else if (dock === 'right') after.push(rule, element);
        else if (dock === 'top') above.push(element, rule);
        else below.push(rule, element);
      }
      const center = document.createElement('div');
      center.className = 'ide-center';
      center.append(...above, editors, ...below);
      root.replaceChildren(...before, center, ...after);
      renderEditors();
    });
    const outputDock = panelDock(layout, 'output');
    const collapsible =
      outputDock !== undefined &&
      !isSideDock(outputDock) &&
      layout.docks[outputDock].panels.length === 1;
    if (toggle) {
      toggle.hidden = !collapsible;
      if (!collapsible && panel.dataset.outputCollapsed === 'true')
        setCollapsed(false);
    }
    panel.toggleAttribute(
      'data-left-dock',
      layout.docks.left.panels.length > 0
    );
    measureEditorStart();
  }

  /* The header's editor tools start where the editor area starts. */
  function measureEditorStart() {
    const offset =
      editors.getBoundingClientRect().left - panel.getBoundingClientRect().left;
    panel.style.setProperty(
      '--ide-editor-offset',
      `${Math.max(0, Math.round(offset))}px`
    );
  }
  const observer = new ResizeObserver(() => {
    measureEditorStart();
    for (const element of root.querySelectorAll<HTMLElement>(
      '.ide-dock[data-dock="top"], .ide-dock[data-dock="bottom"]'
    ))
      element.style.flexBasis = dockBasis(element.dataset.dock as Dock);
  });
  observer.observe(editors);
  signal.addEventListener('abort', () => observer.disconnect(), {
    once: true,
  });

  function setCollapsed(collapsed: boolean) {
    if (!toggle) return;
    panel.dataset.outputCollapsed = String(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute(
      'aria-label',
      collapsed ? 'Expand output' : 'Collapse output'
    );
    const dock = panelDock(layout, 'output');
    const element =
      dock && root.querySelector<HTMLElement>(`.ide-dock[data-dock="${dock}"]`);
    if (dock && element) element.style.flexBasis = dockBasis(dock);
  }
  toggle?.addEventListener(
    'click',
    () => setCollapsed(panel.dataset.outputCollapsed !== 'true'),
    { signal }
  );

  /** The region a panel dropped on `dock` would take, for the drop overlay. */
  function dockPreview(id: PanelId, dock: Dock): Box {
    const box = body.getBoundingClientRect();
    const center = root!
      .querySelector<HTMLElement>('.ide-center')!
      .getBoundingClientRect();
    const from = panelDock(layout, id);
    // A side dock this panel would leave empty gives its room back.
    const leaving = (side: Dock) =>
      from === side && layout.docks[side].panels.length === 1;
    const left = leaving('left') ? box.left : center.left;
    const right = leaving('right') ? box.right : center.right;
    const size = Math.min(
      layout.docks[dock].size,
      (isSideDock(dock) ? box.width : box.height) * 0.45
    );
    if (dock === 'left')
      return { left: box.left, top: box.top, width: size, height: box.height };
    if (dock === 'right')
      return {
        left: box.right - size,
        top: box.top,
        width: size,
        height: box.height,
      };
    return {
      left,
      top: dock === 'top' ? box.top : box.bottom - size,
      width: right - left,
      height: size,
    };
  }

  /* Dragging a panel by its header docks it on another side. */
  for (const id of available) {
    const handle = elements[id]!.querySelector<HTMLElement>(
      '[data-panel-handle]'
    );
    if (!handle) continue;
    handle.title = `Drag to move the ${panelNames[id]}`;
    handle.addEventListener(
      'pointerdown',
      (event) => {
        if (isNarrow() || (event.target as Element).closest('button')) return;
        // No text selection from the header label.
        event.preventDefault();
        trackDrag<Dock>(event, {
          panel,
          label: panelLabels[id],
          resolve: (x, y) => {
            const box = body.getBoundingClientRect();
            const dock = dockZone(
              { x: box.left, y: box.top, width: box.width, height: box.height },
              x,
              y
            );
            return { rect: dockPreview(id, dock), value: dock };
          },
          drop: (dock) => {
            if (panelDock(layout, id) === dock) return;
            layout = movePanel(layout, id, dock);
            render();
            save();
          },
        });
      },
      { signal }
    );
  }

  const controller: WorkspaceLayoutController = {
    get layout() {
      return layout;
    },
    editors,
    setEditors(next, lookup) {
      layout = { ...layout, editors: next };
      if (lookup) {
        groupElements = lookup;
        keepScroll(renderEditors);
        measureEditorStart();
      }
      save();
    },
    onReset(listener, until) {
      resetListeners.add(listener);
      until.addEventListener('abort', () => resetListeners.delete(listener), {
        once: true,
      });
    },
  };

  panel
    .querySelector<HTMLButtonElement>('[data-code-reset-layout]')
    ?.addEventListener(
      'click',
      () => {
        layout = { ...defaultLayout(available), editors: layout.editors };
        setCollapsed(false);
        render();
        // Listeners rebuild the editor groups' default arrangement.
        for (const listener of resetListeners) listener();
        save();
      },
      { signal }
    );

  render();
  controllers.set(panel, controller);
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(saveTimer);
      storeLayout(panel, layout);
      controllers.delete(panel);
    },
    { once: true }
  );
  return controller;
}

/**
 * Wires the shared workspace chrome: the dockable panels and their resize
 * handles and the output collapse toggle. (The pane tabs and the platform
 * shortcut hint are CodeWorkspace.svelte's.)
 */
export function initializeWorkspaceLayout(
  panel: HTMLElement,
  signal: AbortSignal
) {
  const controller = initializeLayout(panel, signal);

  panel
    .querySelector<HTMLButtonElement>('[data-code-clear]')
    ?.addEventListener('click', () => clearOutput(panel), { signal });

  signal.addEventListener(
    'abort',
    () => {
      panel.classList.remove('resizing', 'dragging');
      showPane(panel, 'code');
    },
    { once: true }
  );
  return controller;
}
