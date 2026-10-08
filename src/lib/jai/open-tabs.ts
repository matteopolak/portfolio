import type { ViewId } from '../workspace-layout-model.ts';

/**
 * One editor tab: a workspace file, a read-only preview (a stdlib file), the
 * rendered view of a workspace `.md` file (`markdown`), or a view that is no
 * file at all (`view`, the Render tab; its `path` is the view's id).
 */
export interface OpenTab {
  readonly path: string;
  readonly preview: boolean;
  readonly markdown?: boolean;
  readonly view?: ViewId;
}

/** What a view's tab is called. */
export const VIEW_LABELS: Readonly<Record<ViewId, string>> = {
  render: 'Render',
};

/** The tab of `view`. */
export const viewTab = (view: ViewId): OpenTab =>
  Object.freeze({ path: view, preview: false, view });

/** Two tabs that show the same thing (a group never holds both). */
export const sameTab = (a: OpenTab, b: OpenTab) =>
  a.path === b.path &&
  a.preview === b.preview &&
  Boolean(a.markdown) === Boolean(b.markdown) &&
  a.view === b.view;

const isFile = (tab: OpenTab) => !tab.preview && !tab.markdown && !tab.view;

/**
 * The open-file tabs of the Jai workspace, without any DOM. At most one
 * preview tab exists; opening another preview replaces it in place.
 */
export class OpenTabs {
  #tabs: OpenTab[] = [];
  #active: OpenTab | undefined;
  // Tabs in the order they were last focused, most recent last.
  #recent: OpenTab[] = [];

  get tabs(): readonly OpenTab[] {
    return this.#tabs;
  }

  get active(): OpenTab | undefined {
    return this.#active;
  }

  #focus(tab: OpenTab) {
    this.#recent = this.#recent.filter((item) => item !== tab);
    this.#recent.push(tab);
    this.#active = tab;
  }

  #insert(tab: OpenTab) {
    const index = this.#active ? this.#tabs.indexOf(this.#active) : -1;
    this.#tabs.splice(index < 0 ? this.#tabs.length : index + 1, 0, tab);
  }

  /** Focuses the workspace file's tab, opening it after the active tab if needed. */
  open(path: string): OpenTab {
    let tab = this.#tabs.find((item) => isFile(item) && item.path === path);
    if (!tab) {
      tab = Object.freeze({ path, preview: false });
      this.#insert(tab);
    }
    this.#focus(tab);
    return tab;
  }

  /** Focuses the rendered view of the `.md` file `path`, opening it after the active tab if needed. */
  openMarkdown(path: string): OpenTab {
    let tab = this.#tabs.find((item) => item.markdown && item.path === path);
    if (!tab) {
      tab = Object.freeze({ path, preview: false, markdown: true });
      this.#insert(tab);
    }
    this.#focus(tab);
    return tab;
  }

  /**
   * Focuses the tab of `view`, opening it after the active tab if needed;
   * `focus: false` adds it without changing the active tab.
   */
  openView(view: ViewId, { focus = true } = {}): OpenTab {
    let tab = this.#tabs.find((item) => item.view === view);
    if (!tab) {
      tab = viewTab(view);
      this.#insert(tab);
    }
    if (focus || !this.#active) this.#focus(tab);
    return tab;
  }

  /**
   * Puts `tab` (from another group, or this one to reorder it) at `index`
   * (after the active tab by default) and focuses it. A tab already here
   * that shows the same thing makes way; so does any other preview tab.
   */
  place(tab: OpenTab, index?: number): OpenTab {
    const existing = this.#tabs.find(
      (item) =>
        item === tab || sameTab(item, tab) || (tab.preview && item.preview)
    );
    let at = index ?? -1;
    if (existing) {
      const from = this.#tabs.indexOf(existing);
      this.#tabs.splice(from, 1);
      this.#recent = this.#recent.filter((item) => item !== existing);
      if (this.#active === existing) this.#active = undefined;
      if (at > from) at--;
    }
    if (at < 0) this.#insert(tab);
    else this.#tabs.splice(Math.min(at, this.#tabs.length), 0, tab);
    this.#focus(tab);
    return tab;
  }

  /** Shows `path` in the preview tab, replacing any earlier preview. */
  preview(path: string): OpenTab {
    const tab = Object.freeze({ path, preview: true });
    const index = this.#tabs.findIndex((item) => item.preview);
    if (index >= 0) {
      const replaced = this.#tabs[index];
      this.#recent = this.#recent.filter((item) => item !== replaced);
      this.#tabs[index] = tab;
    } else this.#insert(tab);
    this.#focus(tab);
    return tab;
  }

  activate(tab: OpenTab) {
    if (this.#tabs.includes(tab)) this.#focus(tab);
  }

  /** Closes the tab; returns the new active tab (the last one focused, or none). */
  close(tab: OpenTab): OpenTab | undefined {
    this.#remove(new Set([tab]));
    return this.#active;
  }

  /** Follows renamed files (`from` → `to`). Preview and view tabs are not workspace files. */
  move(moves: ReadonlyMap<string, string>) {
    this.#tabs = this.#tabs.map((tab) => {
      const target = tab.preview || tab.view ? undefined : moves.get(tab.path);
      if (target === undefined) return tab;
      const moved: OpenTab = Object.freeze(
        tab.markdown
          ? { path: target, preview: false, markdown: true }
          : { path: target, preview: false }
      );
      if (this.#active === tab) this.#active = moved;
      this.#recent = this.#recent.map((item) => (item === tab ? moved : item));
      return moved;
    });
  }

  /**
   * Closes the file and Markdown tabs whose paths are no longer in the
   * workspace, and Markdown tabs of files renamed away from `.md`.
   */
  retain(names: ReadonlySet<string>) {
    this.#remove(
      new Set(
        this.#tabs.filter(
          (tab) =>
            !tab.preview &&
            !tab.view &&
            (!names.has(tab.path) ||
              (tab.markdown && !/\.(md|markdown)$/iu.test(tab.path)))
        )
      )
    );
  }

  clear() {
    this.#tabs = [];
    this.#recent = [];
    this.#active = undefined;
  }

  // Like VS Code, the active tab passes to the most recently focused survivor;
  // a tab that was never focused falls back to its nearest neighbour.
  #remove(closed: ReadonlySet<OpenTab>) {
    if (!closed.size) return;
    const before = this.#tabs;
    this.#tabs = before.filter((tab) => !closed.has(tab));
    this.#recent = this.#recent.filter((tab) => !closed.has(tab));
    if (!this.#active || !closed.has(this.#active)) return;
    const index = before.indexOf(this.#active);
    this.#active =
      this.#recent.at(-1) ??
      before.slice(index + 1).find((tab) => !closed.has(tab)) ??
      before
        .slice(0, index)
        .reverse()
        .find((tab) => !closed.has(tab));
  }
}

/** The tab's label: the file name, plus its folder when another tab shares the name. */
export function tabLabel(tab: OpenTab, tabs: readonly OpenTab[]) {
  if (tab.view) return { name: VIEW_LABELS[tab.view], folder: '' };
  const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const name = base(tab.path);
  const shared = tabs.some(
    (other) =>
      !other.view && other.path !== tab.path && base(other.path) === name
  );
  const folder = tab.path.slice(0, Math.max(0, tab.path.lastIndexOf('/')));
  return { name, folder: shared ? folder : '' };
}
