/**
 * Where the editor was: a workspace file (by path) or a read-only preview
 * (by URI), and the line of the cursor. Callers extend it with whatever they
 * need to restore the place (selection, scroll, the preview's text).
 */
export interface NavLocation {
  /** The workspace path, or the URI of a read-only preview. */
  readonly file: string;
  /** A module, stdlib or expansion preview: never renamed or pruned. */
  readonly readonly?: boolean;
  /** 1-based line of the cursor. */
  readonly line: number;
}

/** What the browser history has to do to mirror a change: one entry per op. */
export interface NavOp {
  readonly op: 'push' | 'replace';
  readonly id: number;
}

export interface NavHistoryOptions {
  /** Most entries kept; the oldest are dropped beyond it. */
  readonly limit?: number;
  /**
   * A navigation within this many ms of the one that reached the current
   * entry replaces that entry instead of keeping it, so flicking through
   * tabs leaves one step, not one per tab.
   */
  readonly coalesceMs?: number;
}

interface Entry<T> {
  readonly id: number;
  location: T;
  /** When a navigation pushed it; restores do not change it. */
  readonly at: number;
}

const same = (a: NavLocation, b: NavLocation) =>
  a.file === b.file &&
  Boolean(a.readonly) === Boolean(b.readonly) &&
  a.line === b.line;

/**
 * Go Back / Go Forward over editor places, like VS Code's navigation
 * history. Only navigations are recorded (switching files, go to
 * definition, big cursor jumps), never typing. Each entry has an id that
 * only ever grows, so a mirror in the browser history can find entries
 * again and tell back from forward. No DOM; see `workspace-ui.ts`.
 */
export class NavHistory<T extends NavLocation> {
  #entries: Entry<T>[] = [];
  #index = -1;
  /*
   * The editor is no longer at `#entries[#index]` (that entry was pruned):
   * Back returns to `#index` itself rather than the one before it.
   */
  #detached = false;
  #id = 0;
  readonly #limit: number;
  readonly #coalesceMs: number;

  constructor({ limit = 50, coalesceMs = 400 }: NavHistoryOptions = {}) {
    this.#limit = limit;
    this.#coalesceMs = coalesceMs;
  }

  get locations(): readonly T[] {
    return this.#entries.map((entry) => entry.location);
  }

  get index() {
    return this.#index;
  }

  /** The id of the current entry, if any. */
  get currentId(): number | undefined {
    return this.#entries[this.#index]?.id;
  }

  get canBack() {
    return this.#detached ? this.#index >= 0 : this.#index > 0;
  }

  get canForward() {
    return this.#index < this.#entries.length - 1;
  }

  find(id: number): T | undefined {
    return this.#entries.find((entry) => entry.id === id)?.location;
  }

  #push(location: T, at: number): Entry<T> {
    const entry = { id: ++this.#id, location, at };
    this.#entries.push(entry);
    this.#index = this.#entries.length - 1;
    return entry;
  }

  #cap() {
    const excess = this.#entries.length - this.#limit;
    if (excess <= 0) return;
    this.#entries.splice(0, excess);
    this.#index = Math.max(0, this.#index - excess);
  }

  /** Starts over with one entry: the place the session opened on. */
  reset(location: T, now = Date.now()): number {
    this.#entries = [];
    this.#detached = false;
    // Never coalesced into: the first navigation keeps the starting place.
    return this.#push(location, now - this.#coalesceMs).id;
  }

  /**
   * Records a navigation from `from` (where the editor was, if anywhere) to
   * `to`. Entries after the current one are dropped, as a browser does.
   * Returns how a browser-history mirror follows: `push` adds an entry,
   * `replace` overwrites its current one.
   */
  navigate(from: T | undefined, to: T, now = Date.now()): NavOp[] {
    const ops: NavOp[] = [];
    // The browser's current entry is free to reuse (its place was dropped).
    let free = false;
    const add = (location: T) => {
      const { id } = this.#push(location, now);
      ops.push({ op: free ? 'replace' : 'push', id });
      free = false;
    };
    this.#entries.splice(this.#index + 1);
    const current = this.#entries[this.#index];
    if (
      current &&
      !this.#detached &&
      this.#index > 0 &&
      now - current.at < this.#coalesceMs
    ) {
      // Passed through quickly: forget it, and reuse its browser entry.
      this.#entries.pop();
      this.#index--;
      free = true;
    } else if (from) {
      if (current && current.location.file === from.file)
        current.location = from;
      else if (!current || !same(current.location, from)) add(from);
    }
    this.#detached = false;
    const top = this.#entries[this.#index];
    if (!free && top && same(top.location, to)) top.location = to;
    else add(to);
    this.#cap();
    return ops;
  }

  /**
   * Makes entry `id` current, first saving `here` (the editor's place now)
   * into the entry being left when it is the same file. Returns the place
   * to restore, or undefined when the entry no longer exists.
   */
  go(id: number, here?: T): T | undefined {
    const index = this.#entries.findIndex((entry) => entry.id === id);
    if (index < 0) return undefined;
    const current = this.#entries[this.#index];
    if (
      here &&
      current &&
      !this.#detached &&
      index !== this.#index &&
      current.location.file === here.file
    )
      current.location = here;
    this.#index = index;
    this.#detached = false;
    return this.#entries[index].location;
  }

  /** The entry Back would go to. */
  get previousId(): number | undefined {
    if (!this.canBack) return undefined;
    return this.#entries[this.#detached ? this.#index : this.#index - 1].id;
  }

  /** The entry Forward would go to. */
  get nextId(): number | undefined {
    return this.canForward ? this.#entries[this.#index + 1].id : undefined;
  }

  back(here?: T): T | undefined {
    const id = this.previousId;
    return id === undefined ? undefined : this.go(id, here);
  }

  forward(here?: T): T | undefined {
    const id = this.nextId;
    return id === undefined ? undefined : this.go(id, here);
  }

  /** Follows renamed workspace files (`from` → `to`); previews are untouched. */
  move(moves: ReadonlyMap<string, string>) {
    for (const entry of this.#entries) {
      const target = entry.location.readonly
        ? undefined
        : moves.get(entry.location.file);
      if (target !== undefined)
        entry.location = { ...entry.location, file: target };
    }
    this.#collapse();
  }

  /** Drops the entries of workspace files that no longer exist. */
  retain(names: ReadonlySet<string>) {
    this.#filter(
      (entry) => entry.location.readonly || names.has(entry.location.file),
      true
    );
    this.#collapse();
  }

  clear() {
    this.#entries = [];
    this.#index = -1;
    this.#detached = false;
  }

  // Neighbours that became the same place (after a rename or a removal) merge.
  #collapse() {
    this.#filter(
      (entry, index, all) =>
        index === 0 || !same(all[index - 1].location, entry.location),
      false
    );
  }

  /**
   * Keeps the entries `keep` accepts. If the current one goes, the editor
   * stands after the nearest earlier survivor: `detach` says whether it is
   * somewhere else (a removed file) rather than at that survivor (a merge).
   */
  #filter(
    keep: (entry: Entry<T>, index: number, all: Entry<T>[]) => boolean,
    detach: boolean
  ) {
    const current = this.#entries[this.#index];
    const before = this.#entries;
    this.#entries = before.filter((entry, index) => keep(entry, index, before));
    if (!current) return;
    if (this.#entries.includes(current)) {
      this.#index = this.#entries.indexOf(current);
      return;
    }
    // The current entry went: stand just after the nearest earlier survivor.
    const survivor = before
      .slice(0, before.indexOf(current))
      .reverse()
      .find((entry) => this.#entries.includes(entry));
    this.#index = survivor ? this.#entries.indexOf(survivor) : -1;
    this.#detached = Boolean(survivor) && detach;
  }
}
