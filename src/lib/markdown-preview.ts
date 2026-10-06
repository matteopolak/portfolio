/*
 * Rendered preview for `.md` files in the code workspace. It lives inside the
 * editor host next to CodeMirror's `.cm-editor`, and a small view switch sits
 * at the right end of the open-file tab strip. Rendering is in
 * `markdown-render.ts`; this module owns the DOM, the view choice, scroll
 * sync and link clicks.
 */
import DOMPurify from 'dompurify';
import type { EditorView } from '@codemirror/view';
import type { StreamLanguage } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { jaiLanguage, formatSpecifierTag } from './jai/language.ts';
import { tomlLanguage } from './toml-language.ts';
import {
  escapeHtml,
  isMarkdownPath,
  markdownView,
  parseViewChoice,
  renderMarkdown,
  SPLIT_MIN_WIDTH,
  type MarkdownView,
  type MarkdownViewChoice,
} from './markdown-render.ts';
import './markdown-preview.css';

const STORAGE_KEY = 'code-editor-markdown-view';
/** Re-render delay after an edit; typing stays smooth on long files. */
const RENDER_DELAY = 150;

// Fenced-block classes; `markdown-preview.css` colours them with the editor's tokens.
const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'md-tok-keyword' },
  { tag: [tags.typeName, tags.className], class: 'md-tok-type' },
  { tag: tags.function(tags.variableName), class: 'md-tok-function' },
  { tag: formatSpecifierTag, class: 'md-tok-format' },
  { tag: [tags.string, tags.character], class: 'md-tok-string' },
  { tag: tags.comment, class: 'md-tok-comment' },
  { tag: [tags.number, tags.bool, tags.atom], class: 'md-tok-number' },
  {
    tag: [tags.processingInstruction, tags.annotation],
    class: 'md-tok-directive',
  },
  { tag: [tags.operator, tags.punctuation], class: 'md-tok-punct' },
]);

const languages: Record<string, StreamLanguage<unknown>> = {
  jai: jaiLanguage as StreamLanguage<unknown>,
  toml: tomlLanguage as StreamLanguage<unknown>,
};

function highlight(code: string, language: string) {
  const grammar = languages[language];
  if (!grammar) return undefined;
  let html = '';
  let at = 0;
  highlightTree(grammar.parser.parse(code), highlighter, (from, to, cls) => {
    if (from > at) html += escapeHtml(code.slice(at, from));
    html += `<span class="${cls}">${escapeHtml(code.slice(from, to))}</span>`;
    at = to;
  });
  return html + escapeHtml(code.slice(at));
}

function loadChoice(): MarkdownViewChoice {
  try {
    return parseViewChoice(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function saveChoice(choice: MarkdownViewChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* Without storage the choice lasts for this page. */
  }
}

const icons: Record<MarkdownView, string> = {
  source: '<path d="m6 5.5-3.5 4.5L6 14.5M14 5.5l3.5 4.5-3.5 4.5"></path>',
  split: '<path d="M3 4h14v12H3zM10 4v12"></path>',
  preview:
    '<path d="M1.75 10S4.75 4.5 10 4.5 18.25 10 18.25 10 15.25 15.5 10 15.5 1.75 10 1.75 10Z"></path><circle cx="10" cy="10" r="2.5"></circle>',
};
const labels: Record<MarkdownView, string> = {
  source: 'Source',
  split: 'Split',
  preview: 'Preview',
};

export interface MarkdownPreviewOptions {
  /** The workspace's file names, for links between files. */
  files: () => Iterable<string>;
  /** Opens a workspace file in the editor (a link was followed). */
  open: (path: string) => void;
}

export function createMarkdownPreview(
  panel: HTMLElement,
  view: EditorView,
  { files, open }: MarkdownPreviewOptions,
  signal: AbortSignal
) {
  const host = panel.querySelector<HTMLElement>('[data-code-editor]')!;
  const main = panel.querySelector<HTMLElement>('[data-code-main]')!;
  const preview = document.createElement('article');
  preview.className = 'md-preview';
  preview.dataset.codeMarkdown = '';
  preview.tabIndex = 0;
  preview.setAttribute('aria-label', 'Markdown preview');
  preview.hidden = true;
  host.append(preview);

  const switcher = document.createElement('div');
  switcher.className = 'md-switch';
  switcher.dataset.codeMarkdownSwitch = '';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Markdown view');
  switcher.hidden = true;
  const buttons = (['source', 'split', 'preview'] as const).map((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.mdView = mode;
    button.title =
      mode === 'split' ? 'Source and preview side by side' : labels[mode];
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${icons[mode]}</svg><span>${labels[mode]}</span>`;
    button.addEventListener(
      'click',
      () => {
        choose(mode);
        if (mode === 'preview') preview.focus({ preventScroll: true });
        else view.focus();
      },
      { signal }
    );
    return button;
  });
  switcher.append(...buttons);
  main.append(switcher);

  let choice = loadChoice();
  let path: string | undefined;
  let current: MarkdownView | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAnchor: { path: string; anchor: string } | undefined;
  let wide = main.clientWidth >= SPLIT_MIN_WIDTH;

  function apply(mode: MarkdownView | undefined) {
    current = mode;
    if (mode) {
      host.dataset.markdownView = mode;
      panel.dataset.markdown = mode;
      panel.dataset.markdownLayout = wide ? 'wide' : 'narrow';
    } else {
      delete host.dataset.markdownView;
      delete panel.dataset.markdown;
      delete panel.dataset.markdownLayout;
    }
    preview.hidden = !mode || mode === 'source';
    switcher.hidden = !mode;
    for (const button of buttons) {
      const value = button.dataset.mdView as MarkdownView;
      // Narrow layouts have no room for split; they toggle Source/Preview.
      button.hidden = value === 'split' && !wide;
      button.setAttribute('aria-pressed', String(value === mode));
    }
    fitSwitch();
    if (mode === 'split') requestAnimationFrame(syncFromEditor);
  }

  // The tab strip gives way to the switch (`--md-switch-width`).
  function fitSwitch() {
    if (current && switcher.offsetWidth)
      panel.style.setProperty('--md-switch-width', `${switcher.offsetWidth}px`);
    else if (!current) panel.style.removeProperty('--md-switch-width');
  }

  function choose(mode: MarkdownView) {
    if (wide) choice = { ...choice, wide: mode };
    else if (mode !== 'split') choice = { ...choice, narrow: mode };
    saveChoice(choice);
    if (mode !== 'source') render();
    apply(mode);
  }

  function render() {
    clearTimeout(renderTimer);
    if (!path) return;
    const html = renderMarkdown(view.state.doc.toString(), {
      path,
      files: files(),
      highlight,
    });
    // Defence in depth: renderMarkdown already escapes raw HTML and filters links.
    preview.innerHTML = DOMPurify.sanitize(html || emptyNote, {
      ADD_ATTR: ['referrerpolicy'],
    });
    for (const link of preview.querySelectorAll<HTMLAnchorElement>(
      'a[data-md-external]'
    )) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
  const emptyNote = '<p class="md-empty">Nothing to preview yet.</p>';

  /** Called whenever the editor shows another file (or none). */
  function show(shown: string | undefined) {
    clearTimeout(renderTimer);
    if (!isMarkdownPath(shown)) {
      path = undefined;
      apply(undefined);
      return;
    }
    const changed = shown !== path;
    path = shown;
    render();
    if (changed) preview.scrollTop = 0;
    wide = main.clientWidth >= SPLIT_MIN_WIDTH;
    apply(markdownView(main.clientWidth, choice, view.state.doc.length === 0));
    const pending = pendingAnchor;
    pendingAnchor = undefined;
    if (pending && pending.path === shown) scrollToAnchor(pending.anchor);
  }

  /** Called on every edit to the shown file. */
  function changed() {
    if (!path || current === 'source') return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const top = preview.scrollTop;
      render();
      preview.scrollTop = top;
      if (current === 'split') syncFromEditor();
    }, RENDER_DELAY);
  }

  function scrollToAnchor(anchor: string) {
    const target = [
      ...preview.querySelectorAll<HTMLElement>('[data-anchor]'),
    ].find((heading) => heading.dataset.anchor === anchor);
    if (!target) return;
    preview.scrollTop +=
      target.getBoundingClientRect().top -
      preview.getBoundingClientRect().top -
      12;
  }

  preview.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a');
      if (!link || link.dataset.mdExternal !== undefined) return;
      event.preventDefault();
      const anchor = link.dataset.mdAnchor;
      const file = link.dataset.mdFile;
      if (file && file !== path) {
        if (anchor) pendingAnchor = { path: file, anchor };
        open(file);
      } else if (anchor) scrollToAnchor(anchor);
    },
    { signal }
  );

  /*
   * Scroll sync (split view only): each top-level block carries its first
   * source line, and positions between two blocks are interpolated. A
   * programmatic scroll on one side mutes that side's handler for a frame
   * so the two never chase each other.
   */
  let muteEditor = 0,
    mutePreview = 0;
  const anchors = () =>
    [...preview.querySelectorAll<HTMLElement>('[data-line]')].map(
      (element) => ({
        line: Number(element.dataset.line),
        top: element.offsetTop,
      })
    );
  // Document height inside the scroller above line 1 (CodeMirror's padding).
  const editorOffset = () =>
    view.documentTop -
    view.scrollDOM.getBoundingClientRect().top +
    view.scrollDOM.scrollTop;
  /** The (fractional, 1-based) source line at the top of the editor. */
  function editorLine() {
    const top = view.scrollDOM.scrollTop - editorOffset();
    const block = view.lineBlockAtHeight(Math.max(0, top));
    const line = view.state.doc.lineAt(block.from).number;
    return line + Math.max(0, top - block.top) / Math.max(1, block.height);
  }
  function syncFromEditor() {
    if (current !== 'split') return;
    const scroller = view.scrollDOM;
    let top: number;
    if (scroller.scrollTop <= 0) top = 0;
    else if (
      scroller.scrollTop + scroller.clientHeight >=
      scroller.scrollHeight - 2
    )
      top = preview.scrollHeight;
    else {
      const line = editorLine();
      const points = anchors();
      const index = points.findLastIndex((point) => point.line <= line);
      if (index === -1) top = 0;
      else {
        const from = points[index];
        const to = points[index + 1] ?? {
          line: view.state.doc.lines + 1,
          top: preview.scrollHeight,
        };
        const span = Math.max(1, to.line - from.line);
        top = from.top + ((to.top - from.top) * (line - from.line)) / span;
      }
    }
    mutePreview = performance.now() + 120;
    preview.scrollTop = top - 12;
  }
  function syncFromPreview() {
    if (current !== 'split') return;
    const top = preview.scrollTop + 12;
    let line: number;
    if (preview.scrollTop <= 0) line = 1;
    else if (
      preview.scrollTop + preview.clientHeight >=
      preview.scrollHeight - 2
    )
      line = view.state.doc.lines + 1;
    else {
      const points = anchors();
      const index = points.findLastIndex((point) => point.top <= top);
      if (index === -1) line = 1;
      else {
        const from = points[index];
        const to = points[index + 1] ?? {
          line: view.state.doc.lines + 1,
          top: preview.scrollHeight,
        };
        line =
          from.line +
          ((to.line - from.line) * (top - from.top)) /
            Math.max(1, to.top - from.top);
      }
    }
    const doc = view.state.doc;
    const whole = Math.min(doc.lines, Math.max(1, Math.floor(line)));
    const block = view.lineBlockAt(doc.line(whole).from);
    muteEditor = performance.now() + 120;
    view.scrollDOM.scrollTop =
      line > doc.lines
        ? view.scrollDOM.scrollHeight
        : block.top + block.height * (line - whole) + editorOffset();
  }
  view.scrollDOM.addEventListener(
    'scroll',
    () => {
      if (performance.now() >= muteEditor) syncFromEditor();
    },
    { signal, passive: true }
  );
  preview.addEventListener(
    'scroll',
    () => {
      if (performance.now() >= mutePreview) syncFromPreview();
    },
    { signal, passive: true }
  );

  // Crossing the split breakpoint re-picks the view for that layout.
  const resized = new ResizeObserver(() => {
    fitSwitch();
    const now = main.clientWidth >= SPLIT_MIN_WIDTH;
    if (now === wide) return;
    wide = now;
    if (path)
      apply(
        markdownView(main.clientWidth, choice, view.state.doc.length === 0)
      );
  });
  resized.observe(main);
  resized.observe(switcher);

  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(renderTimer);
      resized.disconnect();
      apply(undefined);
      preview.remove();
      switcher.remove();
    },
    { once: true }
  );

  return { show, changed };
}
