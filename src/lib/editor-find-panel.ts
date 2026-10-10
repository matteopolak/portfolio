/*
 * A VS Code-style find / replace widget for the CodeMirror editors, used as
 * `search({ top: true, createPanel })` from @codemirror/search. Plain TS (no
 * framework): code-editor.ts adds `findExtensions` to every editor, so the
 * playground pages, the project modals and the Jai workspace share it.
 *
 * The panel is a normal top panel, but `findPanelTheme` floats `.cm-panels-top`
 * over the editor's top-right corner so it overlays the text instead of
 * taking a row. Nothing else uses top panels (Vim's `/` and `:` prompts are
 * bottom panels), so the override cannot affect them.
 */
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import { EditorSelection, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from '@codemirror/view';

/** Matches counted before the counter reads "1000+". */
const COUNT_CAP = 1000;

const SVG_NS = 'http://www.w3.org/2000/svg';

type IconNode = [string, Record<string, string>][];

/* Lucide icon data (https://lucide.dev), ISC licence. */
const icons: Record<string, IconNode> = {
  chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  arrowUp: [
    ['path', { d: 'm5 12 7-7 7 7' }],
    ['path', { d: 'M12 19V5' }],
  ],
  arrowDown: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'm19 12-7 7-7-7' }],
  ],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  caseSensitive: [
    ['path', { d: 'm2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16' }],
    ['path', { d: 'M22 9v7' }],
    ['path', { d: 'M3.304 13h6.392' }],
    ['circle', { cx: '18.5', cy: '12.5', r: '3.5' }],
  ],
  wholeWord: [
    ['circle', { cx: '7', cy: '12', r: '3' }],
    ['path', { d: 'M10 9v6' }],
    ['circle', { cx: '17', cy: '12', r: '3' }],
    ['path', { d: 'M14 7v8' }],
    ['path', { d: 'M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1' }],
  ],
  regex: [
    ['path', { d: 'M17 3v10' }],
    ['path', { d: 'm12.67 5.5 8.66 5' }],
    ['path', { d: 'm12.67 10.5 8.66-5' }],
    [
      'path',
      {
        d: 'M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z',
      },
    ],
  ],
  replace: [
    ['path', { d: 'M14 4a1 1 0 0 1 1-1' }],
    ['path', { d: 'M15 10a1 1 0 0 1-1-1' }],
    ['path', { d: 'M21 4a1 1 0 0 0-1-1' }],
    ['path', { d: 'M21 9a1 1 0 0 1-1 1' }],
    ['path', { d: 'm3 7 3 3 3-3' }],
    ['path', { d: 'M6 10V5a2 2 0 0 1 2-2h2' }],
    ['rect', { x: '3', y: '14', width: '7', height: '7', rx: '1' }],
  ],
  replaceAll: [
    ['path', { d: 'M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1' }],
    ['path', { d: 'M14 4a1 1 0 0 1 1-1' }],
    ['path', { d: 'M15 10a1 1 0 0 1-1-1' }],
    ['path', { d: 'M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1' }],
    ['path', { d: 'M21 4a1 1 0 0 0-1-1' }],
    ['path', { d: 'M21 9a1 1 0 0 1-1 1' }],
    ['path', { d: 'm3 7 3 3 3-3' }],
    ['path', { d: 'M6 10V5a2 2 0 0 1 2-2h2' }],
    ['rect', { x: '3', y: '14', width: '7', height: '7', rx: '1' }],
  ],
};

function icon(name: keyof typeof icons) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of icons[name]) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

const mac = () => /Mac|iPhone|iPad/u.test(navigator.platform);

function button(
  className: string,
  label: string,
  glyph: keyof typeof icons,
  onclick: () => void
) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `cm-find__button ${className}`;
  element.title = label;
  element.setAttribute('aria-label', label);
  element.append(icon(glyph));
  // Keep the editor's or input's focus: a mouse press must not blur them.
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', onclick);
  return element;
}

interface MatchCount {
  /** 1-based position of the match at the selection, or 0 if none. */
  index: number;
  total: number;
  capped: boolean;
}

function countMatches(view: EditorView, query: SearchQuery): MatchCount {
  const none = { index: 0, total: 0, capped: false };
  if (!query.valid) return none;
  const { from, to } = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let total = 0;
  let index = 0;
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    total += 1;
    if (!index && step.value.from === from && step.value.to === to)
      index = total;
    if (total >= COUNT_CAP) return { index, total, capped: true };
  }
  return { index, total, capped: false };
}

/** Selects the first match at or after `from` (wrapping) without moving focus. */
function selectMatchFrom(view: EditorView, query: SearchQuery, from: number) {
  if (!query.valid) return;
  const state = view.state;
  let step = query.getCursor(state, from).next();
  if (step.done) step = query.getCursor(state).next();
  if (step.done) return;
  view.dispatch({
    selection: EditorSelection.single(step.value.from, step.value.to),
    effects: EditorView.scrollIntoView(step.value.from, { y: 'center' }),
    userEvent: 'select.search',
  });
}

const panels = new WeakMap<EditorView, FindPanel>();

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  top = true;
  private query: SearchQuery;
  private readonly searchInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private readonly count: HTMLElement;
  private readonly options: Record<
    'caseSensitive' | 'wholeWord' | 'regexp',
    HTMLButtonElement
  >;
  private expanded = false;
  private readonly readOnly: boolean;

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.readOnly = view.state.readOnly;
    panels.set(view, this);

    this.searchInput = this.input('Find', 'search');
    this.searchInput.setAttribute('main-field', 'true');
    this.replaceInput = this.input('Replace', 'replace');

    const shortcut = (key: string) => (mac() ? `⌥${key}` : `Alt+${key}`);
    this.options = {
      caseSensitive: this.option(
        'caseSensitive',
        `Match Case (${shortcut('C')})`,
        'caseSensitive'
      ),
      wholeWord: this.option(
        'wholeWord',
        `Match Whole Word (${shortcut('W')})`,
        'wholeWord'
      ),
      regexp: this.option(
        'regexp',
        `Use Regular Expression (${shortcut('R')})`,
        'regex'
      ),
    };

    this.count = document.createElement('span');
    this.count.className = 'cm-find__count';
    this.count.setAttribute('role', 'status');
    this.count.setAttribute('aria-live', 'polite');

    const field = document.createElement('div');
    field.className = 'cm-find__field';
    const toggles = document.createElement('span');
    toggles.className = 'cm-find__toggles';
    toggles.append(
      this.options.caseSensitive,
      this.options.wholeWord,
      this.options.regexp
    );
    field.append(this.searchInput, toggles);

    const findRow = document.createElement('div');
    findRow.className = 'cm-find__row';
    findRow.append(
      field,
      this.count,
      button('cm-find__prev', 'Previous Match (Shift+Enter)', 'arrowUp', () =>
        this.step(findPrevious)
      ),
      button('cm-find__next', 'Next Match (Enter)', 'arrowDown', () =>
        this.step(findNext)
      ),
      button('cm-find__close', 'Close (Escape)', 'x', () => this.close())
    );

    this.replaceRow = document.createElement('div');
    this.replaceRow.className = 'cm-find__row cm-find__row--replace';
    this.replaceRow.hidden = true;
    const replaceField = document.createElement('div');
    replaceField.className = 'cm-find__field';
    replaceField.append(this.replaceInput);
    this.replaceRow.append(
      replaceField,
      button('cm-find__replace', 'Replace (Enter)', 'replace', () =>
        this.replaceOne()
      ),
      button('cm-find__replace-all', 'Replace All', 'replaceAll', () =>
        this.replaceEverything()
      )
    );

    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'cm-find__toggle';
    this.toggle.setAttribute('aria-label', 'Toggle Replace');
    this.toggle.title = 'Toggle Replace';
    this.toggle.addEventListener('mousedown', (event) =>
      event.preventDefault()
    );
    this.toggle.addEventListener('click', () => {
      this.setExpanded(!this.expanded);
      (this.expanded ? this.replaceInput : this.searchInput).focus();
    });
    this.toggle.hidden = this.readOnly;

    const rows = document.createElement('div');
    rows.className = 'cm-find__rows';
    rows.append(findRow, ...(this.readOnly ? [] : [this.replaceRow]));

    this.dom = document.createElement('div');
    this.dom.className = 'cm-find';
    this.dom.setAttribute('role', 'search');
    this.dom.setAttribute('aria-label', 'Find and replace');
    this.dom.append(this.toggle, rows);
    this.dom.addEventListener('keydown', (event) => this.keydown(event));
    this.setExpanded(false);
    this.sync(this.query);
    this.refreshCount();
  }

  private input(label: string, name: string) {
    const element = document.createElement('input');
    element.className = 'cm-find__input';
    element.placeholder = label;
    element.setAttribute('aria-label', label);
    element.name = name;
    element.setAttribute('form', '');
    element.spellcheck = false;
    element.autocomplete = 'off';
    element.setAttribute('autocapitalize', 'off');
    element.addEventListener('input', () => this.commit(true));
    return element;
  }

  private option(
    key: 'caseSensitive' | 'wholeWord' | 'regexp',
    label: string,
    glyph: keyof typeof icons
  ) {
    const element = button('cm-find__option', label, glyph, () => {
      const pressed = element.getAttribute('aria-pressed') !== 'true';
      element.setAttribute('aria-pressed', String(pressed));
      this.commit(true);
    });
    element.dataset.option = key;
    element.setAttribute('aria-pressed', 'false');
    return element;
  }

  private pressed(key: 'caseSensitive' | 'wholeWord' | 'regexp') {
    return this.options[key].getAttribute('aria-pressed') === 'true';
  }

  /** Writes the inputs' state into the editor's search query. */
  private commit(live: boolean) {
    const query = new SearchQuery({
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.pressed('caseSensitive'),
      wholeWord: this.pressed('wholeWord'),
      regexp: this.pressed('regexp'),
    });
    if (query.eq(this.query)) return;
    const searchChanged =
      query.search !== this.query.search ||
      query.caseSensitive !== this.query.caseSensitive ||
      query.wholeWord !== this.query.wholeWord ||
      query.regexp !== this.query.regexp;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    // Typing searches live: jump to the first match from where the search began.
    if (live && searchChanged && query.search)
      selectMatchFrom(this.view, query, this.view.state.selection.main.from);
    this.refreshCount();
  }

  private sync(query: SearchQuery) {
    this.query = query;
    if (this.searchInput.value !== query.search)
      this.searchInput.value = query.search;
    if (this.replaceInput.value !== query.replace)
      this.replaceInput.value = query.replace;
    this.options.caseSensitive.setAttribute(
      'aria-pressed',
      String(query.caseSensitive)
    );
    this.options.wholeWord.setAttribute(
      'aria-pressed',
      String(query.wholeWord)
    );
    this.options.regexp.setAttribute('aria-pressed', String(query.regexp));
  }

  private refreshCount() {
    const query = this.query;
    const empty = !query.search;
    const { index, total, capped } = countMatches(this.view, query);
    this.searchInput.toggleAttribute(
      'data-empty-result',
      !empty && total === 0
    );
    this.searchInput.setAttribute(
      'aria-invalid',
      String(!empty && !query.valid)
    );
    this.count.dataset.state = empty ? 'idle' : total ? 'found' : 'none';
    this.count.textContent = empty
      ? ''
      : total === 0
        ? 'No results'
        : `${index || '?'} of ${total}${capped ? '+' : ''}`;
  }

  private step(command: (view: EditorView) => boolean) {
    command(this.view);
    this.refreshCount();
  }

  private replaceOne() {
    replaceNext(this.view);
    this.refreshCount();
  }

  private replaceEverything() {
    replaceAll(this.view);
    this.refreshCount();
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded && !this.readOnly;
    this.replaceRow.hidden = !this.expanded;
    this.toggle.setAttribute('aria-expanded', String(this.expanded));
    this.toggle.replaceChildren(
      icon(this.expanded ? 'chevronDown' : 'chevronRight')
    );
    this.dom.dataset.expanded = String(this.expanded);
  }

  focus(select = true) {
    this.searchInput.focus();
    if (select) this.searchInput.select();
  }

  private close() {
    closeSearchPanel(this.view);
    this.view.focus();
  }

  private keydown(event: KeyboardEvent) {
    // Mod-f, Mod-h, F3 and Escape come from the editor keymap (scope `search-panel`).
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const key =
        event.code === 'KeyC'
          ? 'caseSensitive'
          : event.code === 'KeyW'
            ? 'wholeWord'
            : event.code === 'KeyR'
              ? 'regexp'
              : undefined;
      if (key) {
        event.preventDefault();
        this.options[key].click();
        return;
      }
    }
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (event.target === this.replaceInput) this.replaceOne();
    else this.step(event.shiftKey ? findPrevious : findNext);
  }

  /* The CodeMirror `Panel` interface */

  mount() {
    this.searchInput.select();
  }

  update(update: ViewUpdate) {
    let queryChanged = false;
    for (const transaction of update.transactions)
      for (const effect of transaction.effects)
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.sync(effect.value);
          queryChanged = true;
        }
    if (queryChanged || update.docChanged || update.selectionSet)
      this.refreshCount();
  }

  destroy() {
    if (panels.get(this.view) === this) panels.delete(this.view);
  }

  get pos() {
    return 80;
  }
}

/** Opens (or focuses) the widget, seeded with the selection; optionally with Replace open. */
export function openFind(view: EditorView, replace = false) {
  openSearchPanel(view);
  const panel = panels.get(view);
  if (panel) {
    if (replace) panel.setExpanded(true);
    panel.focus();
  }
  return true;
}

const findKeymap = keymap.of([
  {
    key: 'Mod-f',
    run: (view) => openFind(view),
    scope: 'editor search-panel',
    preventDefault: true,
  },
  {
    key: 'Mod-h',
    run: (view) => openFind(view, true),
    scope: 'editor search-panel',
    preventDefault: true,
  },
  {
    key: 'Mod-Alt-f',
    run: (view) => openFind(view, true),
    scope: 'editor search-panel',
    preventDefault: true,
  },
  {
    key: 'Escape',
    run: (view) => {
      if (!searchPanelOpen(view.state)) return false;
      closeSearchPanel(view);
      view.focus();
      return true;
    },
    scope: 'editor search-panel',
  },
  // F3 / Shift-F3 and Mod-g, go to line, select next occurrence, ...
  ...searchKeymap.filter(
    (binding) => binding.key !== 'Mod-f' && binding.key !== 'Escape'
  ),
]);

export const findPanelTheme = EditorView.theme(
  {
    // Float over the editor's top-right corner instead of taking a row.
    '.cm-panels-top': {
      position: 'absolute',
      top: '0',
      right: '0',
      left: 'auto',
      width: 'auto',
      maxWidth: '100%',
      padding: '0 14px 0 0',
      border: 'none',
      backgroundColor: 'transparent',
      pointerEvents: 'none',
      zIndex: '6',
    },
    '.cm-find': {
      position: 'relative',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '2px',
      marginTop: '4px',
      padding: '4px 6px 4px 2px',
      color: 'var(--ide-fg)',
      backgroundColor: 'var(--ide-raised)',
      border: '1px solid var(--ide-rule)',
      borderTop: 'none',
      borderRadius: '0 0 4px 4px',
      boxShadow: '0 0.5rem 1.25rem oklch(0% 0 0 / 0.45)',
      font: '0.78rem/1.2 var(--font-sans)',
      pointerEvents: 'auto',
    },
    '.cm-find__toggle': {
      display: 'grid',
      alignSelf: 'stretch',
      width: '1.25rem',
      placeItems: 'center',
      padding: '0',
      color: 'var(--ide-muted)',
      cursor: 'pointer',
    },
    '.cm-find__toggle:hover': { color: 'var(--ide-fg-strong)' },
    '.cm-find__toggle[hidden]': { display: 'none' },
    '.cm-find__rows': { display: 'grid', gap: '4px' },
    '.cm-find__row': { display: 'flex', alignItems: 'center', gap: '2px' },
    '.cm-find__row[hidden]': { display: 'none' },
    '.cm-find__field': {
      display: 'flex',
      flex: '1',
      alignItems: 'center',
      minWidth: '0',
      width: '15.5rem',
      backgroundColor: 'var(--ide-sunken)',
      border: '1px solid var(--ide-rule)',
      borderRadius: '3px',
    },
    '.cm-find__field:focus-within': { borderColor: 'var(--accent-3)' },
    '.cm-find .cm-find__input': {
      flex: '1',
      minWidth: '0',
      padding: '0.28rem 0.4rem',
      color: 'var(--ide-fg)',
      backgroundColor: 'transparent',
      border: '0',
      borderRadius: '0',
      outline: 'none',
      font: 'inherit',
    },
    '.cm-find__input::placeholder': { color: 'var(--ide-faint)' },
    '.cm-find__input[data-empty-result]': {
      color: 'var(--ide-error)',
    },
    '.cm-find__toggles': { display: 'flex', gap: '1px', paddingRight: '2px' },
    '.cm-find .cm-find__button': {
      display: 'grid',
      width: '1.5rem',
      height: '1.5rem',
      placeItems: 'center',
      padding: '0',
      color: 'var(--ide-muted)',
      backgroundColor: 'transparent',
      border: '1px solid transparent',
      borderRadius: '3px',
      cursor: 'pointer',
    },
    '.cm-find .cm-find__button:hover': {
      color: 'var(--ide-fg-strong)',
      backgroundColor: 'var(--ide-hover)',
    },
    '.cm-find .cm-find__option[aria-pressed="true"]': {
      color: 'var(--ide-fg-strong)',
      backgroundColor: 'color-mix(in oklch, var(--accent-2) 28%, transparent)',
      borderColor: 'var(--accent-2)',
    },
    '.cm-find .cm-find__button svg': {
      width: '1rem',
      height: '1rem',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.75',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    '.cm-find__toggle svg': {
      width: '1rem',
      height: '1rem',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    '.cm-find__count': {
      minWidth: '4.6rem',
      padding: '0 0.35rem',
      color: 'var(--ide-muted)',
      textAlign: 'center',
      whiteSpace: 'nowrap',
    },
    '.cm-find__count[data-state="none"]': { color: 'var(--ide-error)' },
    '.cm-find__row--replace .cm-find__field': { flex: 'none' },
    // Phones: the widget spans the editor.
    '@media (max-width: 42rem)': {
      '.cm-panels-top': { left: '0', padding: '0' },
      '.cm-find': { width: '100%', borderRadius: '0' },
      '.cm-find__rows': { flex: '1', minWidth: '0' },
      '.cm-find__field': { width: 'auto' },
      '.cm-find__count': { minWidth: '3.6rem' },
    },
  },
  { dark: true }
);

/** The find widget, its keys and the theme that floats it. */
export const findExtensions: Extension = [
  search({ top: true, createPanel: (view) => new FindPanel(view) }),
  findKeymap,
  findPanelTheme,
];
