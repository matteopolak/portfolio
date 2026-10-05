const entryName = 'main.jai';
const sourcePathAuthority = Symbol('parsed source path');

export class SourcePath {
  #name;

  constructor(name, authority) {
    if (authority !== sourcePathAuthority)
      throw new TypeError('Use SourcePath.parse().');
    this.#name = name;
    Object.freeze(this);
  }

  static parse(value) {
    if (
      typeof value !== 'string' ||
      value.startsWith('/') ||
      /[\\\0:]/u.test(value)
    ) {
      throw new TypeError('Use a relative file name with forward slashes.');
    }
    const parts = [];
    for (const part of value.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (parts.length === 0)
          throw new TypeError('File names cannot leave the workspace.');
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    const name = parts.join('/');
    const bytes = new TextEncoder().encode(name);
    if (
      !name ||
      bytes.length > 4096 ||
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== name
    ) {
      throw new TypeError(
        'Use a nonempty UTF-8 file name of at most 4,096 bytes.'
      );
    }
    return new SourcePath(name, sourcePathAuthority);
  }

  get name() {
    return this.#name;
  }
}

export class Workspace {
  #files = new Map();
  #selected;
  #folders = new Set();
  #revision = 0;

  constructor(source) {
    this.add(entryName, source);
  }

  get selected() {
    return this.#files.get(this.#selected);
  }

  get names() {
    return [...this.#files.keys()].sort((a, b) => {
      if (a === entryName) return -1;
      if (b === entryName) return 1;
      return a.localeCompare(b);
    });
  }

  get documents() {
    return this.names.map((name) =>
      Object.freeze({
        path: name,
        text: this.#files.get(name).text,
        version: this.#files.get(name).version,
      })
    );
  }

  get tree() {
    const root = { kind: 'directory', name: '', path: '', children: [] };
    const directories = new Map([['', root]]);
    const directory = (path) => {
      if (directories.has(path)) return directories.get(path);
      const parts = path.split('/');
      const node = { kind: 'directory', name: parts.pop(), path, children: [] };
      directory(parts.join('/')).children.push(node);
      directories.set(path, node);
      return node;
    };
    for (const path of this.#folders) directory(path);
    for (const name of this.names) {
      const parts = name.split('/');
      const leaf = parts.pop();
      directory(parts.join('/')).children.push({
        kind: 'file',
        name: leaf,
        path: name,
      });
    }
    const sort = (node) => {
      node.children.sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === 'directory'
            ? -1
            : 1
      );
      for (const child of node.children)
        if (child.kind === 'directory') sort(child);
      return node;
    };
    return sort(root);
  }

  #parents(name) {
    const parts = name.split('/');
    parts.pop();
    let path = '';
    for (const part of parts) {
      path += (path ? '/' : '') + part;
      this.#folders.add(path);
    }
  }
  #assertFree(name, ignored = new Set()) {
    if (
      !ignored.has(name) &&
      (this.#files.has(name) || this.#folders.has(name))
    )
      throw new Error('That name already exists.');
    const parts = name.split('/');
    parts.pop();
    let path = '';
    for (const part of parts) {
      path += (path ? '/' : '') + part;
      if (this.#files.has(path) && !ignored.has(path))
        throw new Error('A file cannot contain other files.');
    }
  }
  addFolder(name) {
    const path = SourcePath.parse(name).name;
    this.#assertFree(path);
    this.#parents(path);
    this.#folders.add(path);
  }
  rename(name, destination) {
    const old = SourcePath.parse(name).name,
      next = SourcePath.parse(destination).name;
    if (!this.#files.has(old) && !this.#folders.has(old))
      throw new Error('That item does not exist.');
    if (old === next) return new Map();
    if (next.startsWith(old + '/'))
      throw new Error('A folder cannot be moved inside itself.');
    const paths = [...this.#files.keys(), ...this.#folders].filter(
      (path) => path === old || path.startsWith(old + '/')
    );
    const ignored = new Set(paths),
      moves = new Map(
        paths.map((path) => [path, next + path.slice(old.length)])
      );
    for (const target of moves.values()) this.#assertFree(target, ignored);
    const files = paths
      .filter((path) => this.#files.has(path))
      .map((path) => [path, this.#files.get(path)]);
    const folders = paths.filter((path) => this.#folders.has(path));
    for (const path of paths) {
      this.#files.delete(path);
      this.#folders.delete(path);
    }
    for (const [path, file] of files) {
      const target = moves.get(path);
      this.#parents(target);
      this.#files.set(
        target,
        Object.freeze({
          path: SourcePath.parse(target),
          text: file.text,
          version: ++this.#revision,
        })
      );
    }
    for (const path of folders) {
      const target = moves.get(path);
      this.#parents(target);
      this.#folders.add(target);
    }
    this.#selected = moves.get(this.#selected) ?? this.#selected;
    return moves;
  }
  remove(name) {
    const path = SourcePath.parse(name).name;
    if (!this.#files.has(path) && !this.#folders.has(path))
      throw new Error('That item does not exist.');
    for (const file of this.#files.keys())
      if (file === path || file.startsWith(path + '/'))
        this.#files.delete(file);
    for (const folder of this.#folders)
      if (folder === path || folder.startsWith(path + '/'))
        this.#folders.delete(folder);
    if (!this.#files.has(this.#selected))
      this.#selected = this.#files.has(entryName) ? entryName : this.names[0];
  }

  get canRemoveSelected() {
    return this.#selected !== undefined;
  }

  add(name, text = '') {
    const path = SourcePath.parse(name);
    if (typeof text !== 'string')
      throw new TypeError('Source files must contain text.');
    this.#assertFree(path.name);
    this.#parents(path.name);
    this.#files.set(
      path.name,
      Object.freeze({ path, text, version: ++this.#revision })
    );
    this.#selected = path.name;
  }

  select(name) {
    const path = SourcePath.parse(name);
    if (!this.#files.has(path.name))
      throw new Error('That file does not exist.');
    this.#selected = path.name;
  }

  edit(text) {
    if (typeof text !== 'string')
      throw new TypeError('Source files must contain text.');
    if (text === this.selected.text) return;
    this.#files.set(
      this.#selected,
      Object.freeze({
        path: this.selected.path,
        text,
        version: ++this.#revision,
      })
    );
  }

  removeSelected() {
    if (this.#selected) this.remove(this.#selected);
  }

  applyDocumentEdits(updates) {
    const seen = new Set();
    for (const update of updates) {
      const document = this.#files.get(update.path);
      if (
        !document ||
        document.version !== update.version ||
        typeof update.text !== 'string' ||
        seen.has(update.path)
      )
        throw new Error('Rename is stale; no files were changed.');
      seen.add(update.path);
    }
    for (const update of updates) {
      const document = this.#files.get(update.path);
      this.#files.set(
        update.path,
        Object.freeze({
          path: document.path,
          text: update.text,
          version: ++this.#revision,
        })
      );
    }
  }

  snapshot() {
    if (!this.#files.has(entryName))
      throw new Error('Create main.jai to run the program.');
    const files = Object.fromEntries(
      [...this.#files]
        .filter(([name]) => name !== entryName)
        .map(([name, file]) => [name, file.text])
    );
    return Object.freeze({
      source: this.#files.get(entryName).text,
      files: Object.freeze(files),
    });
  }
}
