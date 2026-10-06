/*
 * Rendered preview for `.md` files in the code workspace: the view of a
 * Markdown preview tab, or (on phones) a source tab toggled to Preview. It
 * lives inside an editor group's host next to CodeMirror's `.cm-editor`.
 * Rendering is in `markdown-render.ts`; this module owns the DOM, scroll sync
 * and link clicks. `jai/workspace-ui.ts` decides what each group shows.
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
  renderMarkdown,
} from './markdown-render.ts';
import './markdown-preview.css';

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

export interface MarkdownPreviewOptions {
  /** The workspace's file names, for links between files. */
  files: () => Iterable<string>;
  /** The current text of a workspace file. */
  text: (path: string) => string | undefined;
  /** Follows a link to another workspace file, and a heading in it if given. */
  open: (path: string, anchor?: string) => void;
}

/**
 * The rendered view of one `.md` file inside an editor group's host, next to
 * CodeMirror's `.cm-editor` (which `data-markdown-view` hides). `link` pairs
 * it with an editor showing the same file elsewhere, for scroll sync.
 */
export function createMarkdownPreview(
  host: HTMLElement,
  { files, text, open }: MarkdownPreviewOptions,
  signal: AbortSignal
) {
  const preview = document.createElement('article');
  preview.className = 'md-preview';
  preview.dataset.codeMarkdown = '';
  preview.tabIndex = 0;
  preview.setAttribute('aria-label', 'Markdown preview');
  preview.hidden = true;
  host.append(preview);

  let path: string | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAnchor: string | undefined;
  /** The editor showing the same file, scrolled in step with the preview. */
  let view: EditorView | undefined;
  let unlink: AbortController | undefined;

  function render() {
    clearTimeout(renderTimer);
    if (!path) return;
    const html = renderMarkdown(text(path) ?? '', {
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

  /** Shows the rendered `shown` file, or hands the host back to the editor. */
  function show(shown: string | undefined) {
    clearTimeout(renderTimer);
    const changed = shown !== path;
    path = isMarkdownPath(shown) ? shown : undefined;
    preview.hidden = !path;
    if (!path) {
      delete host.dataset.markdownView;
      link(undefined);
      return;
    }
    host.dataset.markdownView = 'preview';
    render();
    if (changed) preview.scrollTop = 0;
    const anchor = pendingAnchor;
    pendingAnchor = undefined;
    if (anchor) scrollToAnchor(anchor);
  }

  /** Called after any edit to the shown file. */
  function changed() {
    if (!path) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const top = preview.scrollTop;
      render();
      preview.scrollTop = top;
      syncFromEditor();
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
      if (file && file !== path) open(file, anchor);
      else if (anchor) scrollToAnchor(anchor);
    },
    { signal }
  );

  /*
   * Scroll sync (while linked): each top-level block carries its first
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
  const editorOffset = (editor: EditorView) =>
    editor.documentTop -
    editor.scrollDOM.getBoundingClientRect().top +
    editor.scrollDOM.scrollTop;
  /** The (fractional, 1-based) source line at the top of the editor. */
  function editorLine(editor: EditorView) {
    const top = editor.scrollDOM.scrollTop - editorOffset(editor);
    const block = editor.lineBlockAtHeight(Math.max(0, top));
    const line = editor.state.doc.lineAt(block.from).number;
    return line + Math.max(0, top - block.top) / Math.max(1, block.height);
  }
  // Both sides must be on screen: a hidden one reports no size.
  const syncing = (editor: EditorView | undefined): editor is EditorView =>
    Boolean(
      editor && path && preview.clientHeight && editor.scrollDOM.clientHeight
    );
  function syncFromEditor() {
    if (!syncing(view)) return;
    const scroller = view.scrollDOM;
    let top: number;
    if (scroller.scrollTop <= 0) top = 0;
    else if (
      scroller.scrollTop + scroller.clientHeight >=
      scroller.scrollHeight - 2
    )
      top = preview.scrollHeight;
    else {
      const line = editorLine(view);
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
    if (!syncing(view)) return;
    const editor = view;
    const top = preview.scrollTop + 12;
    let line: number;
    if (preview.scrollTop <= 0) line = 1;
    else if (
      preview.scrollTop + preview.clientHeight >=
      preview.scrollHeight - 2
    )
      line = editor.state.doc.lines + 1;
    else {
      const points = anchors();
      const index = points.findLastIndex((point) => point.top <= top);
      if (index === -1) line = 1;
      else {
        const from = points[index];
        const to = points[index + 1] ?? {
          line: editor.state.doc.lines + 1,
          top: preview.scrollHeight,
        };
        line =
          from.line +
          ((to.line - from.line) * (top - from.top)) /
            Math.max(1, to.top - from.top);
      }
    }
    const doc = editor.state.doc;
    const whole = Math.min(doc.lines, Math.max(1, Math.floor(line)));
    const block = editor.lineBlockAt(doc.line(whole).from);
    muteEditor = performance.now() + 120;
    editor.scrollDOM.scrollTop =
      line > doc.lines
        ? editor.scrollDOM.scrollHeight
        : block.top + block.height * (line - whole) + editorOffset(editor);
  }
  preview.addEventListener(
    'scroll',
    () => {
      if (performance.now() >= mutePreview) syncFromPreview();
    },
    { signal, passive: true }
  );

  /** Pairs the preview with `editor` (showing the same file) for scroll sync, or unpairs it. */
  function link(editor: EditorView | undefined) {
    if (editor === view) return;
    unlink?.abort();
    unlink = undefined;
    view = editor;
    if (!editor) return;
    unlink = new AbortController();
    editor.scrollDOM.addEventListener(
      'scroll',
      () => {
        if (performance.now() >= muteEditor) syncFromEditor();
      },
      { signal: unlink.signal, passive: true }
    );
    requestAnimationFrame(syncFromEditor);
  }

  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(renderTimer);
      unlink?.abort();
      delete host.dataset.markdownView;
      preview.remove();
    },
    { once: true }
  );

  return {
    element: preview,
    get path() {
      return path;
    },
    show,
    changed,
    link,
    /** Scrolls to a heading once the file is shown (a link with `#anchor`). */
    reveal(anchor: string) {
      if (path) scrollToAnchor(anchor);
      else pendingAnchor = anchor;
    },
    focus: () => preview.focus({ preventScroll: true }),
  };
}

export type MarkdownPreview = ReturnType<typeof createMarkdownPreview>;
