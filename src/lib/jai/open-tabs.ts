/** One editor tab: a workspace file, or a read-only preview (a stdlib file). */
export interface OpenTab {
  readonly path: string;
  readonly preview: boolean;
}

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
    let tab = this.#tabs.find((item) => !item.preview && item.path === path);
    if (!tab) {
      tab = Object.freeze({ path, preview: false });
      this.#insert(tab);
    }
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

  /** Follows renamed files (`from` → `to`). Preview tabs are not workspace files. */
  move(moves: ReadonlyMap<string, string>) {
    this.#tabs = this.#tabs.map((tab) => {
      const target = tab.preview ? undefined : moves.get(tab.path);
      if (target === undefined) return tab;
      const moved = Object.freeze({ path: target, preview: false });
      if (this.#active === tab) this.#active = moved;
      this.#recent = this.#recent.map((item) => (item === tab ? moved : item));
      return moved;
    });
  }

  /** Closes the file tabs whose paths are no longer in the workspace. */
  retain(names: ReadonlySet<string>) {
    this.#remove(
      new Set(this.#tabs.filter((tab) => !tab.preview && !names.has(tab.path)))
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
  const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const name = base(tab.path);
  const shared = tabs.some(
    (other) => other !== tab && base(other.path) === name
  );
  const folder = tab.path.slice(0, Math.max(0, tab.path.lastIndexOf('/')));
  return { name, folder: shared ? folder : '' };
}
