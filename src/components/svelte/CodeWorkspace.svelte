<script lang="ts">
  import { onMount } from 'svelte';
  import {
    registerWorkspaceChrome,
    type RunState,
    type WorkspaceChrome,
    type WorkspaceChromeHandlers,
    type WorkspacePane,
  } from '../../lib/workspace-chrome';
  import ProjectDemoLoading from './ProjectDemoLoading.svelte';
  import { isApple } from '../../lib/platform.ts';

  interface Props {
    language: 'jai' | 'quasi' | 'baerscript';
    label: string;
    starter?: string;
    files?: boolean;
    enabled?: boolean;
    revision?: string;
    /**
     * `modal` (inside a demo dialog), `page` (a /playground route) or `embed`
     * (a blog post's `<Playground>`, which links out to the full page).
     */
    mode?: 'modal' | 'page' | 'embed';
  }

  const {
    language,
    label,
    starter = '',
    files = false,
    enabled = true,
    revision = '',
    mode = 'modal',
  }: Props = $props();

  let panel: HTMLElement | undefined;

  // The header and the narrow-screen tabs are driven by the runtime through
  // the `WorkspaceChrome` registered below (see lib/workspace-chrome.ts).
  let status = $state('');
  let retryVisible = $state(false);
  let run = $state<RunState>({ disabled: true, running: false });
  let pane = $state<WorkspacePane>('code');

  // Arrow keys / Home / End move between the panel tabs (roving tabindex).
  const onPaneTabKeydown = (event: KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const tabs = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-pane-tab]'
      ),
    ];
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current < 0) return;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
            tabs.length;
    event.preventDefault();
    chrome.setPane(tabs[next].dataset.paneTab as WorkspacePane);
    tabs[next].focus();
  };
  let outputUnread = $state(false);
  let shortcut = $state('Ctrl↵');
  let formatShortcut = $state('Shift+Alt+F');
  let handlers: WorkspaceChromeHandlers = {};

  const chrome: WorkspaceChrome = {
    setStatus: (text) => (status = text),
    getStatus: () => status,
    setRetryVisible: (visible) => (retryVisible = visible),
    isRetryVisible: () => retryVisible,
    setRun: (state) => (run = { ...state }),
    getRun: () => run,
    setPane: (next) => {
      pane = next;
      if (next === 'output') outputUnread = false;
    },
    getPane: () => pane,
    setOutputUnread: (unread) => (outputUnread = unread),
    setHandlers: (next) => {
      handlers = { ...handlers, ...next };
    },
    triggerRun: () => {
      if (!run.disabled) handlers.run?.();
    },
  };

  onMount(() => {
    const mac = isApple();
    shortcut = mac ? '⌘↵' : 'Ctrl↵';
    formatShortcut = mac ? '⇧⌥F' : 'Shift+Alt+F';
    return registerWorkspaceChrome(panel!, chrome);
  });
</script>

<section
  bind:this={panel}
  class="ide ide--{language}"
  class:ide--single={!files}
  class:ide--page={mode !== 'modal'}
  data-code-workspace
  data-code-language={language}
  data-code-starter={starter}
  data-jai-revision={revision}
  data-jai-enabled={String(enabled)}
  data-pane={pane}
  data-output-unread={outputUnread ? 'true' : undefined}
  data-left-dock={files ? '' : undefined}
  data-code-fullscreen-target
  data-project-demo-scroll
  aria-label="{label} code editor"
>
  <header class="ide-bar">
    <!-- Editor tools start at the editor column's left edge, not above the file tree. -->
    <div class="ide-tools" role="group" aria-label="Editor tools">
      {#if language === 'jai' && files}
        <button
          type="button"
          class="ide-icon ide-tool"
          data-code-format
          hidden={!enabled}
          disabled
          aria-label="Format file"
          aria-keyshortcuts="Shift+Alt+F"
          title="Format file ({formatShortcut})"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"
            ><path
              d="M3 4.5h14M8.5 8.5H17M8.5 12H17M3 15.5h14M3.5 7.75 6 10.25l-2.5 2.5"
            ></path></svg
          >
        </button>
      {/if}
      <button
        type="button"
        class="ide-icon ide-tool ide-tool--vim"
        data-code-vim
        aria-pressed="false"
        aria-label="Vim mode"
        title="Vim mode"
      >
        <!-- Monochrome Vim mark: a diamond with the slab V cut out (even-odd). -->
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M10 1.2 18.8 10 10 18.8 1.2 10ZM6.2 6.4h3.2v1.2h-.6l1.8 4.6 1.6-4.6h-.5V6.4h2.1v1.2h-.5l-2.7 7h-1L7 7.6h-.8Z"
          ></path>
        </svg>
      </button>
      {#if language === 'jai' && files}
        <button
          type="button"
          class="ide-icon ide-tool"
          data-code-show-render
          aria-label="Show the Render tab"
          title="Render"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"
            ><path d="M3 4.5h14v11H3zM6.5 12.5l2.5-3 2 2 1.5-1.5 2 2.5"
            ></path></svg
          >
        </button>
      {/if}
      {#if !files}
        <button
          type="button"
          class="ide-icon ide-tool"
          data-code-reset
          aria-label="Reset to starter code"
          title="Reset to starter code"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"
            ></path></svg
          >
        </button>
      {/if}
      <button
        type="button"
        class="ide-icon ide-tool ide-tool--layout"
        data-code-reset-layout
        aria-label="Reset layout"
        title="Reset layout"
      >
        <!-- Panels back to the default layout: a window with a side bar and a bottom panel. -->
        <svg viewBox="0 0 20 20" aria-hidden="true"
          ><path d="M3 3.5h14v13H3zM7.5 3.5v13M7.5 12h9.5"></path></svg
        >
      </button>
    </div>
    <span class="ide-status" data-code-status role="status" aria-live="polite"
      >{status}</span
    >
    <button
      type="button"
      class="ide-text-button"
      data-code-retry
      hidden={!retryVisible}
      onclick={() => handlers.retry?.()}>Retry</button
    >
    <button
      type="button"
      class="ide-run"
      data-code-run
      disabled={run.disabled}
      hidden={run.running}
      aria-label="Run program"
      title="Run"
      onclick={() => handlers.run?.()}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"
        ><path d="M6 3.5 16 10 6 16.5Z"></path></svg
      >
      <span>Run</span>
      <kbd data-code-shortcut>{shortcut}</kbd>
    </button>
    <button
      type="button"
      class="ide-run ide-run--stop"
      data-code-cancel
      hidden={!run.running}
      aria-label="Stop program"
      title="Stop"
      onclick={() => handlers.cancel?.()}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"
        ><path d="M5 5h10v10H5z"></path></svg
      >
      <span>Stop</span>
    </button>
    <button
      type="button"
      class="ide-icon ide-icon--fullscreen"
      data-code-fullscreen
      aria-label="Enter full screen"
      title="Full screen"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"></path></svg
      >
    </button>
    {#if mode !== 'page'}
      <a
        class="ide-icon ide-icon--page"
        href="/playground/{language}"
        data-code-open-page
        data-astro-reload
        aria-label="Open the {label} playground as a full page"
        title="Open in playground"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v6H4V6h6"></path></svg
        >
      </a>
    {/if}
    {#if mode === 'modal'}
      <button
        type="button"
        class="ide-icon ide-icon--close"
        data-code-close
        aria-label="Close editor"
        title="Close"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="m6 6 12 12M18 6 6 18"></path></svg
        >
      </button>
    {:else if mode === 'page'}
      <a
        class="ide-icon ide-icon--back"
        href="/projects#{language}"
        data-code-back
        aria-label="Back to projects"
        title="Back to projects"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path d="M19 12H5M11 6l-6 6 6 6"></path></svg
        >
      </a>
    {/if}
  </header>

  <div class="ide-body">
    <!-- Default layout; code-workspace-layout.ts re-renders it from the saved one. -->
    <div class="ide-layout" data-code-layout>
      {#if files}
        <div class="ide-dock" data-dock="left" style="flex-basis: 240px">
          <aside class="ide-files" data-code-files-pane aria-label="Files">
            <div class="ide-pane-head" data-panel-handle>
              <span>Files</span>
              <span class="ide-pane-actions">
                <button
                  type="button"
                  class="ide-icon ide-icon--small"
                  data-tree-new-file
                  aria-label="New file"
                  title="New file"
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true"
                    ><path
                      d="M5.5 2.5h6l3.5 3.5v11.5h-9.5zM10.25 9v5.5M7.5 11.75H13"
                    ></path></svg
                  >
                </button>
                <button
                  type="button"
                  class="ide-icon ide-icon--small"
                  data-tree-new-folder
                  aria-label="New folder"
                  title="New folder"
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true"
                    ><path
                      d="M2.5 5.5h5.25l1.75 1.75h8v9.25h-15zM10 9.25v5M7.5 11.75h5"
                    ></path></svg
                  >
                </button>
                <button
                  type="button"
                  class="ide-icon ide-icon--small"
                  data-code-import
                  aria-label="Import folder"
                  title="Import folder (replaces all files)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"
                    ><path
                      d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1M2 13h10M9 16l3-3-3-3"
                    ></path></svg
                  >
                </button>
                <button
                  type="button"
                  class="ide-icon ide-icon--small"
                  data-code-reset
                  aria-label="Reset workspace"
                  title="Reset workspace to the default"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"
                    ><path
                      d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"
                    ></path></svg
                  >
                </button>
              </span>
            </div>
            <nav class="ide-tree" data-code-files aria-label="File tree"></nav>
          </aside>
        </div>
        <div class="ide-divider ide-divider--col" aria-hidden="true"></div>
      {/if}
      <div class="ide-center">
        <div class="ide-editors" data-code-editors>
          {#if files}
            <section
              class="ide-group"
              data-code-group
              data-active
              aria-label="Editor"
            >
              <div class="ide-group-head">
                <div
                  class="ide-filetabs"
                  role="tablist"
                  aria-label="Open files"
                  data-code-tabs
                ></div>
                <div class="ide-group-actions" data-code-group-actions></div>
              </div>
              <div class="ide-editor" data-code-editor></div>
              <div class="ide-empty" data-code-empty hidden>
                <p class="ide-empty-title">No open files</p>
                <p>Open a file from the file tree.</p>
              </div>
            </section>
          {:else}
            <div class="ide-editor" data-code-editor></div>
          {/if}
        </div>
        <div class="ide-divider ide-divider--row" aria-hidden="true"></div>
        <div class="ide-dock" data-dock="bottom" style="flex-basis: 176px">
          <section class="ide-output" data-code-output-pane aria-label="Output">
            <div class="ide-output__head" data-panel-handle>
              <span class="ide-output__title">Output</span>
              <span class="ide-output__summary" data-code-summary></span>
              <button
                type="button"
                class="ide-output__button"
                data-code-clear
                aria-label="Clear output"
                title="Clear output"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"
                  ><path d="M4.5 6h11M8 6V4h4v2M6 6l.75 10h6.5L14 6"
                  ></path></svg
                >
              </button>
              <button
                type="button"
                class="ide-output__button ide-output__toggle"
                data-code-output-toggle
                aria-expanded="true"
                aria-label="Collapse output"
                title="Collapse output"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"
                  ><path d="m6 8 4 4 4-4"></path></svg
                >
              </button>
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre
              data-code-output
              data-empty="Run the program to see its output."
              aria-label="Program output"
              aria-live="polite"
              tabindex="0"></pre>
            <!-- The Jai playground shows an xterm.js terminal here instead of the pre (src/lib/jai/terminal.ts). -->
            <div
              class="ide-terminal"
              data-code-terminal
              role="group"
              aria-label="Program terminal"
              hidden
            ></div>
          </section>
        </div>
      </div>
    </div>
    <!--
      The Render tab's contents. workspace-ui.ts moves it into the editor
      group whose active tab is Render, and back here (hidden) otherwise.
    -->
    {#if language === 'jai' && files}
      <section
        class="ide-render"
        data-code-render-view
        aria-label="Render"
        hidden
      >
        <div class="ide-render__stage" data-code-render data-state="idle">
          <div class="ide-render__message" data-code-render-message>
            <p class="ide-empty-title" data-code-render-title>
              Nothing is rendering
            </p>
            <p data-code-render-detail>
              A program that draws with WebGPU shows here.
            </p>
          </div>
        </div>
      </section>
    {/if}
    <ProjectDemoLoading seed={language} />
  </div>

  <!-- svelte-ignore a11y_role_supports_aria_props_implicit -->
  <nav
    class="ide-tabs"
    role="tablist"
    aria-label="Workspace panels"
    onkeydown={onPaneTabKeydown}
  >
    {#if files}
      <button
        type="button"
        data-pane-tab="files"
        role="tab"
        tabindex={pane === 'files' ? 0 : -1}
        aria-selected={pane === 'files'}
        onclick={() => chrome.setPane('files')}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"
          ><path d="M2.5 5.5h5.25l1.75 1.75h8v9.25h-15z"></path></svg
        >
        Files
      </button>
    {/if}
    <button
      type="button"
      data-pane-tab="code"
      role="tab"
      tabindex={pane === 'code' ? 0 : -1}
      aria-selected={pane === 'code'}
      onclick={() => chrome.setPane('code')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"
        ><path d="m7 6-4 4 4 4M13 6l4 4-4 4"></path></svg
      >
      Code
    </button>
    <button
      type="button"
      data-pane-tab="output"
      role="tab"
      tabindex={pane === 'output' ? 0 : -1}
      aria-selected={pane === 'output'}
      onclick={() => chrome.setPane('output')}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"
        ><path d="M3 4.5h14v11H3zM6 8l2.5 2L6 12M10.5 12.5h3.5"></path></svg
      >
      Output
      <span class="ide-tab-dot" aria-hidden="true"></span>
    </button>
  </nav>
</section>

<style>
  .ide-output {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ide-sunken);
  }

  .ide-output__head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    height: 2.25rem;
    flex: none;
    padding: 0 0.35rem 0 1rem;
    /* The header is the panel's drag handle, like the file tree's. */
    cursor: grab;
    user-select: none;
  }

  .ide-output__title {
    color: var(--ide-muted);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .ide-output__summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--ide-faint);
    font: 0.72rem/1 var(--ide-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ide-output__button {
    display: grid;
    cursor: pointer;
    width: 1.65rem;
    height: 1.65rem;
    place-items: center;
    border-radius: var(--radius-sm) !important;
    color: var(--ide-muted) !important;
  }

  .ide-output__button:hover {
    color: var(--ide-fg-strong) !important;
    background: var(--ide-hover) !important;
  }

  .ide-output__button svg {
    width: 1rem;
    height: 1rem;
    transition: transform 120ms ease;
  }

  :global(.ide[data-output-collapsed='true']) .ide-output__toggle svg {
    transform: rotate(180deg);
  }

  :global(.ide[data-output-collapsed='true']) :is(pre, .ide-terminal) {
    display: none;
  }

  .ide-terminal {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    overscroll-behavior: contain;
    background: var(--ide-sunken);
  }

  .ide-terminal[hidden] {
    display: none;
  }

  /*
   * xterm paints its own background and scrolls its own viewport. The inset
   * is padding on `.xterm`, not the host: the fit addon subtracts the
   * terminal element's padding but measures the host's full box, so padding
   * there made it fit one row too many and cut off the last line.
   */
  .ide-terminal :global(.xterm) {
    box-sizing: border-box;
    height: 100%;
    padding: 0.25rem 0 0.25rem 1rem;
  }

  .ide-terminal :global(.xterm-viewport) {
    background-color: var(--ide-sunken) !important;
    overscroll-behavior: contain;
  }

  .ide-terminal :global(.xterm-viewport::-webkit-scrollbar) {
    width: 0.6rem;
  }

  .ide-terminal :global(.xterm-viewport::-webkit-scrollbar-thumb) {
    border: 0.15rem solid transparent;
    border-radius: var(--radius-pill);
    background: var(--ide-rule);
    background-clip: padding-box;
  }

  pre {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0.25rem 1rem 1rem;
    overflow: auto;
    overscroll-behavior: contain;
    color: var(--ide-fg);
    font: 0.8rem/1.65 var(--ide-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  pre {
    transition: opacity 140ms ease;
  }

  pre:global([data-state='stale']) {
    opacity: 0.4;
  }

  pre:global(.is-fresh) {
    animation: ide-output-in 180ms ease-out;
  }

  @keyframes ide-output-in {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    pre,
    pre:global(.is-fresh) {
      transition: none;
      animation: none;
    }
  }

  pre:focus-visible {
    outline: 2px solid var(--accent-3);
    outline-offset: -2px;
  }

  pre:empty::before {
    content: attr(data-empty);
    color: var(--ide-faint);
    font-family: var(--font-sans);
  }

  pre:global([aria-busy='true']):empty::before {
    content: 'Running…';
  }

  pre:global([data-kind='error']),
  pre :global([data-stream='stderr']) {
    color: var(--ide-error);
  }

  /* Output with ANSI colour codes keeps the default colour where it sets none. */
  pre :global([data-ansi]) {
    color: var(--ide-fg);
  }

  pre :global(.ansi-bold) {
    font-weight: 700;
  }

  pre :global(.ansi-dim) {
    opacity: 0.7;
  }

  pre :global(.ansi-italic) {
    font-style: italic;
  }

  pre :global(.ansi-underline) {
    text-decoration: underline;
  }

  pre :global(:is(.ansi-fg-red, .ansi-fg-bright-red)) {
    color: var(--ide-error);
  }

  pre :global(:is(.ansi-fg-yellow, .ansi-fg-bright-yellow)) {
    color: var(--ide-syntax-keyword);
  }

  pre :global(:is(.ansi-fg-green, .ansi-fg-bright-green)) {
    color: var(--ide-syntax-string);
  }

  pre :global(:is(.ansi-fg-blue, .ansi-fg-bright-blue)) {
    color: var(--ide-syntax-type);
  }

  pre :global(:is(.ansi-fg-cyan, .ansi-fg-bright-cyan)) {
    color: oklch(82% 0.1 210);
  }

  pre :global(:is(.ansi-fg-magenta, .ansi-fg-bright-magenta)) {
    color: var(--ide-syntax-format);
  }

  pre :global(:is(.ansi-fg-black, .ansi-fg-bright-black)) {
    color: var(--ide-faint);
  }

  pre :global(:is(.ansi-fg-white, .ansi-fg-bright-white)) {
    color: var(--ide-fg);
  }

  pre :global(.ide-output__exit) {
    color: var(--ide-muted);
  }

  .ide {
    --ide-bg: oklch(21% 0.006 270);
    --ide-sunken: oklch(17.5% 0.006 270);
    --ide-raised: oklch(25.5% 0.008 270);
    --ide-hover: oklch(28% 0.009 270);
    --ide-rule: oklch(31% 0.008 270);
    --ide-fg: oklch(90% 0.016 91);
    --ide-fg-strong: oklch(97.598% 0.02449 91.61);
    --ide-muted: oklch(76% 0.012 270);
    --ide-faint: oklch(75% 0.01 270);
    --ide-active-line: oklch(100% 0 0 / 0.035);
    --ide-selection: color-mix(in oklch, var(--accent-2) 24%, transparent);
    --ide-selection-match: oklch(100% 0 0 / 0.07);
    --ide-search: color-mix(in oklch, var(--accent-3) 22%, transparent);
    --ide-search-outline: color-mix(in oklch, var(--accent-3) 55%, transparent);
    /* Syntax colours are fixed (not the site accents, which are pastel and
       change per theme) so tokens stay distinct; every one clears 4.5:1 on
       --ide-bg. */
    --ide-syntax-keyword: oklch(76% 0.12 255);
    --ide-syntax-type: oklch(80% 0.1 185);
    --ide-syntax-function: oklch(87% 0.12 95);
    --ide-syntax-string: oklch(79% 0.14 145);
    /* Format specifiers (`%`, `%1`) in print-family strings: violet, away from the green strings. */
    --ide-syntax-format: oklch(76% 0.16 310);
    --ide-syntax-format-percent: oklch(72% 0.09 310);
    --ide-syntax-number: oklch(79% 0.12 45);
    --ide-syntax-directive: oklch(75% 0.14 10);
    --ide-syntax-comment: oklch(70% 0.02 270);
    --ide-syntax-punct: oklch(78% 0.01 270);
    --ide-error: color-mix(in oklch, var(--accent-1-light) 58%, white);
    --ide-mono:
      ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas,
      'Liberation Mono', monospace;
    --ide-accent: var(--accent-1);

    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--ide-fg);
    background: var(--ide-bg);
    border: 1px solid oklch(100% 0 0 / 0.08);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1.5rem 4rem oklch(0% 0 0 / 0.38),
      0 0.25rem 1rem oklch(0% 0 0 / 0.2);
    color-scheme: dark;
    font-family: var(--font-sans);
  }

  .ide--quasi {
    --ide-accent: var(--accent-2);
  }

  .ide--baerscript {
    --ide-accent: var(--accent-3);
  }

  /* Full-screen and the full-page playground fill the viewport: no frame corners. */
  .ide:fullscreen,
  .ide--page {
    border-radius: 0;
  }

  .ide:fullscreen {
    border: 0;
  }

  .ide button {
    font: inherit;
    color: inherit;
    cursor: pointer;
    border: 0;
    background: transparent;
  }

  .ide a.ide-icon {
    text-decoration: none;
  }

  .ide button:focus-visible,
  .ide a:focus-visible,
  .ide [tabindex]:focus-visible {
    outline: 2px solid var(--accent-3);
    outline-offset: -2px;
  }

  .ide [hidden] {
    display: none !important;
  }

  .ide :global(svg) {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Header */
  .ide-bar {
    /*
     * Where the editor column starts: right of the file tree and its divider
     * (multi-file), else the left edge. Capped so a very wide tree never pushes
     * Run and the window buttons out of the bar.
     */
    --ide-editor-start: 0px;

    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    height: 3rem;
    padding: 0 0.5rem 0 calc(var(--ide-editor-start) + 0.4rem);
    background: var(--ide-sunken);
    border-bottom: 1px solid var(--ide-rule);
  }

  /* `--ide-editor-offset` is measured by code-workspace-layout.ts; the fallback is the default tree width. */
  .ide[data-left-dock] .ide-bar {
    --ide-editor-start: min(
      var(--ide-editor-offset, calc(15rem + 1px)),
      calc(100% - 19rem)
    );
  }

  /* The left dock's divider continues through the bar, so the tools read as the editor's. */
  .ide[data-left-dock] .ide-bar::before {
    position: absolute;
    top: 0;
    bottom: -1px;
    left: calc(var(--ide-editor-start) - 1px);
    width: 1px;
    content: '';
    background: var(--ide-rule);
  }

  /* `margin-right: auto` keeps Run and the window buttons right-aligned when the status is hidden. */
  .ide-tools {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex: none;
    margin-right: auto;
  }

  .ide-tool:disabled {
    opacity: 0.4;
    cursor: default !important;
  }

  .ide-tool:disabled:hover {
    color: var(--ide-muted) !important;
    background: transparent !important;
  }

  .ide-tool:global([aria-busy='true']) svg {
    animation: ide-tool-busy 0.9s ease-in-out infinite alternate;
  }

  @keyframes ide-tool-busy {
    to {
      opacity: 0.35;
    }
  }

  /* The Vim mark is filled; the diamond's V is cut out with even-odd. */
  .ide-tool--vim svg {
    fill: currentColor;
    stroke: none;
  }

  .ide-tool--vim:global([aria-pressed='true']) {
    color: var(--ide-fg-strong) !important;
    background: var(--ide-raised) !important;
    box-shadow: inset 0 0 0 1px var(--accent-2);
  }

  .ide-tool--vim:global([aria-pressed='true']) svg {
    color: color-mix(in oklch, var(--accent-2-light) 45%, white);
  }

  .ide-status {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--ide-muted);
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ide-text-button {
    height: 2rem;
    padding: 0 0.75rem;
    font-size: 0.8rem !important;
    font-weight: 650 !important;
    border: 1px solid var(--ide-rule) !important;
    border-radius: var(--radius-sm) !important;
  }

  .ide-text-button:hover {
    background: var(--ide-hover) !important;
  }

  .ide-run {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    height: 2rem;
    padding: 0 0.7rem 0 0.6rem;
    margin-left: 0.25rem;
    border-radius: var(--radius-sm) !important;
    color: var(--accent-3-on) !important;
    background: var(--accent-3) !important;
    font-size: 0.8rem !important;
    font-weight: 700 !important;
    transition: filter 120ms ease;
  }

  .ide-run svg {
    width: 0.95rem;
    height: 0.95rem;
    fill: currentColor;
    stroke: none;
  }

  .ide-run:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .ide-run:disabled {
    opacity: 0.45;
    cursor: default !important;
  }

  .ide-run kbd {
    padding: 0.1rem 0.3rem;
    border-radius: var(--radius-xs);
    font: 600 0.68rem/1 var(--ide-mono);
    background: oklch(0% 0 0 / 0.12);
  }

  .ide-run--stop {
    color: var(--accent-1-on) !important;
    background: var(--accent-1) !important;
  }

  .ide-icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    flex: none;
    border-radius: var(--radius-sm) !important;
    color: var(--ide-muted) !important;
    transition:
      color 120ms ease,
      background 120ms ease;
  }

  .ide-icon svg {
    width: 1.1rem;
    height: 1.1rem;
  }

  .ide-icon:hover {
    color: var(--ide-fg-strong) !important;
    background: var(--ide-hover) !important;
  }

  .ide-icon--close:hover {
    color: var(--accent-1-on) !important;
    background: var(--accent-1) !important;
  }

  .ide-icon--fullscreen {
    margin-left: 0.25rem;
  }

  .ide-icon--small {
    width: 1.65rem;
    height: 1.65rem;
  }

  .ide-icon--small svg {
    width: 1rem;
    height: 1rem;
  }

  /* Body */
  .ide-body {
    position: relative;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-height: 0;
  }

  .ide-files {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--ide-sunken);
  }

  .ide-pane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    height: 2.25rem;
    flex: none;
    padding: 0 0.35rem 0 1rem;
    color: var(--ide-muted);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: grab;
    user-select: none;
  }

  .ide-pane-actions {
    display: flex;
  }

  .ide-tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0 0 1rem;
  }

  .ide-tree :global(.tree-row) {
    position: relative;
    display: flex;
    align-items: center;
  }

  /*
   * Every row's icon starts at the same column for its depth, files and folders
   * alike; a folder's chevron sits in the gutter to the left of its icon. One
   * level of nesting moves the icon a full step right of its parent's.
   */
  .ide-tree {
    --tree-gutter: 1.75rem;
    --tree-indent: 1.15rem;
  }

  .ide-tree :global(.tree-item) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    min-width: 0;
    height: 1.875rem;
    padding: 0 2rem 0
      calc(var(--tree-gutter) + var(--depth, 0) * var(--tree-indent));
    border-radius: var(--radius-xs) !important;
    color: var(--ide-fg) !important;
    font: 0.875rem/1 var(--ide-mono) !important;
    text-align: left;
    white-space: nowrap;
  }

  .ide-tree :global(.tree-item:hover),
  .ide-tree :global(.tree-row:hover .tree-item) {
    background: var(--ide-hover) !important;
  }

  .ide-tree :global(.tree-item[aria-current]) {
    position: relative;
    color: var(--ide-fg-strong) !important;
    background: var(--ide-raised) !important;
  }

  /* A straight bar clear of the rounded corners (see the file tabs). */
  .ide-tree :global(.tree-item[aria-current])::before {
    position: absolute;
    top: var(--radius-xs);
    bottom: var(--radius-xs);
    left: 0;
    width: 2px;
    content: '';
    background: var(--accent-2);
  }

  .ide-tree :global(.tree-icon) {
    width: 1rem;
    height: 1rem;
    color: var(--ide-muted);
  }

  .ide-tree :global(.folder .tree-icon) {
    color: color-mix(in oklch, var(--accent-3-light) 75%, var(--ide-muted));
  }

  /* File-type tints, shared by tree rows and tabs (icons from jai/file-icons.ts). */
  .ide :global(svg[data-icon='jai']) {
    color: color-mix(in oklch, var(--accent-1-light) 62%, white);
  }

  .ide :global(svg[data-icon='config']) {
    color: color-mix(in oklch, var(--accent-2-light) 50%, white);
  }

  .ide :global(svg[data-icon='markdown']) {
    color: color-mix(in oklch, var(--accent-2-light) 35%, var(--ide-fg));
  }

  .ide :global(svg[data-icon='text']),
  .ide :global(svg[data-icon='file']) {
    color: var(--ide-muted);
  }

  .ide-tree :global(.tree-chevron) {
    width: 0.85rem;
    height: 0.85rem;
    margin-left: -1rem;
    margin-right: 0.15rem;
    color: var(--ide-faint);
    transition: transform 120ms ease;
  }

  .ide-tree :global(.tree-item[aria-expanded='true'] .tree-chevron) {
    transform: rotate(90deg);
  }

  .ide-tree :global(.tree-label) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ide-tree :global(.children) {
    position: relative;
  }

  .ide-tree
    :global(
      .children[data-tree-children]:not([data-tree-children=''])::before
    ) {
    position: absolute;
    top: 0;
    bottom: 0;
    /* Under the parent folder's chevron. */
    left: calc(
      var(--tree-gutter) - 0.575rem + (var(--depth, 1) - 1) * var(--tree-indent)
    );
    width: 1px;
    content: '';
    background: var(--ide-rule);
  }

  .ide-tree :global(.tree-more) {
    position: absolute;
    right: 0.3rem;
    display: grid;
    width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    border-radius: var(--radius-xs) !important;
    color: var(--ide-muted) !important;
    opacity: 0;
  }

  .ide-tree :global(.tree-row:hover .tree-more),
  .ide-tree :global(.tree-row:focus-within .tree-more),
  .ide-tree :global(.tree-more[aria-expanded='true']) {
    opacity: 1;
  }

  .ide-tree :global(.tree-more:hover) {
    color: var(--ide-fg-strong) !important;
    background: var(--ide-rule) !important;
  }

  .ide-tree :global(.tree-more-icon) {
    width: 1rem;
    height: 1rem;
    stroke-width: 2.6;
  }

  .ide-tree :global(.tree-name-input) {
    display: block;
    width: calc(
      100% - var(--tree-gutter) - var(--depth, 0) * var(--tree-indent) - 0.5rem
    );
    height: 1.75rem;
    margin: 0.05rem 0.5rem 0.05rem
      calc(var(--tree-gutter) + var(--depth, 0) * var(--tree-indent));
    padding: 0 0.45rem;
    color: var(--ide-fg-strong);
    background: var(--ide-bg);
    border: 1px solid var(--accent-2);
    border-radius: var(--radius-xs);
    outline: none;
    font: 0.875rem/1 var(--ide-mono);
  }

  .ide-tree :global(.tree-name-input::placeholder) {
    color: var(--ide-faint);
  }

  .ide :global(.tree-menu) {
    position: absolute;
    z-index: 20;
    min-width: 11rem;
    padding: 0.3rem;
    background: var(--ide-raised);
    border: 1px solid var(--ide-rule);
    border-radius: var(--radius);
    box-shadow: 0 0.75rem 2rem oklch(0% 0 0 / 0.45);
  }

  .ide :global(.tree-menu button) {
    display: block;
    width: 100%;
    padding: 0.45rem 0.7rem;
    /* Menu radius minus its 0.3rem padding, so items nest inside the frame. */
    border-radius: var(--radius-xs) !important;
    color: var(--ide-fg);
    font-size: 0.8rem;
    text-align: left;
  }

  .ide :global(.tree-menu button:hover),
  .ide :global(.tree-menu button:focus) {
    color: var(--ide-fg-strong);
    background: var(--ide-hover);
    outline: none;
  }

  .ide :global(.tree-menu button[data-danger]) {
    color: var(--ide-error);
  }

  /* An editor group: its tab strip (with the group's actions) over the editor. */
  .ide-group {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--ide-bg);
  }

  .ide-group-head {
    display: flex;
    flex: none;
    height: 2.25rem;
    min-width: 0;
    background: var(--ide-sunken);
    box-shadow: inset 0 -1px var(--ide-rule);
  }

  .ide-editor {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .ide-editors > .ide-editor {
    flex: 1 1 0;
  }

  /* Open-file tabs (jai). The strip matches the file tree's 2.25rem pane head. */
  .ide-filetabs {
    display: flex;
    flex: 1 1 auto;
    height: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .ide-filetabs::-webkit-scrollbar {
    display: none;
  }

  .ide-filetabs :global(.ide-filetab) {
    position: relative;
    display: flex;
    align-items: center;
    flex: none;
    max-width: 16rem;
    color: var(--ide-muted);
    border-right: 1px solid var(--ide-rule);
    /* Tabs round on top only; the bottom stays flush with the editor below. */
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }

  .ide-filetabs :global(.ide-filetab:hover) {
    color: var(--ide-fg);
    background: var(--ide-hover);
  }

  .ide-filetabs :global(.ide-filetab[data-active]) {
    color: var(--ide-fg-strong);
    background: var(--ide-bg);
  }

  /* The active tab's rule is a straight bar between the rounded corners; an
     inset shadow would follow the radius and taper at the ends. */
  .ide-filetabs :global(.ide-filetab[data-active])::after {
    position: absolute;
    top: 0;
    left: var(--radius-sm);
    right: var(--radius-sm);
    height: 2px;
    content: '';
    background: var(--accent-2);
  }

  /* With several groups, only the focused group's tab keeps the blue rule. */
  :global(.ide-split)
    .ide-group:not([data-active])
    .ide-filetabs
    :global(.ide-filetab[data-active])::after {
    background: var(--ide-faint);
  }

  .ide-filetabs :global(.ide-filetab[data-dragging]) {
    opacity: 0.5;
  }

  .ide-filetabs :global(.ide-filetab-open) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    height: 100%;
    padding: 0 0.15rem 0 0.8rem;
    font: 0.78rem/2.25rem var(--ide-mono) !important;
    white-space: nowrap;
  }

  .ide-filetabs :global(.ide-filetab-name) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ide-filetabs :global(.ide-filetab[data-preview] .ide-filetab-name) {
    font-style: italic;
  }

  .ide-filetabs :global(.ide-filetab-folder) {
    color: var(--ide-faint);
    font-size: 0.7rem;
  }

  .ide-filetabs :global(.ide-filetab-icon) {
    width: 1rem;
    height: 1rem;
    margin-left: -0.15rem;
  }

  /* Inactive tabs dim their icon with the label. */
  .ide-filetabs :global(.ide-filetab:not([data-active]) .ide-filetab-icon) {
    opacity: 0.75;
  }

  .ide-filetabs :global(.ide-filetab-readonly) {
    width: 0.75rem;
    height: 0.75rem;
    color: var(--ide-faint);
  }

  .ide-filetabs :global(.ide-filetab-close) {
    display: grid;
    width: 1.35rem;
    height: 1.35rem;
    margin: 0 0.4rem 0 0.2rem;
    place-items: center;
    border-radius: var(--radius-xs) !important;
    color: var(--ide-muted) !important;
    opacity: 0;
  }

  .ide-filetabs :global(.ide-filetab-close svg) {
    width: 0.85rem;
    height: 0.85rem;
    stroke-width: 1.8;
  }

  .ide-filetabs :global(.ide-filetab[data-active] .ide-filetab-close),
  .ide-filetabs :global(.ide-filetab:hover .ide-filetab-close),
  .ide-filetabs :global(.ide-filetab:focus-within .ide-filetab-close) {
    opacity: 1;
  }

  .ide-filetabs :global(.ide-filetab-close:hover) {
    color: var(--ide-fg-strong) !important;
    background: var(--ide-rule) !important;
  }

  .ide-empty {
    flex: 1 1 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 0.35rem;
    min-height: 0;
    padding: 1.5rem;
    color: var(--ide-muted);
    background: var(--ide-bg);
    font-size: 0.82rem;
    text-align: center;
  }

  .ide-empty p {
    margin: 0;
  }

  .ide-empty-title {
    color: var(--ide-fg);
    font-weight: 700;
  }

  /* The Render tab: a WebGPU program's canvas, or why nothing is drawn. */
  .ide-render {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--ide-bg);
  }

  .ide-render[hidden] {
    display: none;
  }

  .ide-render__stage {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--ide-bg);
  }

  .ide-render__stage:global([data-state='drawing']) {
    background: #000;
  }

  .ide-render__message {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 0.35rem;
    padding: 1.5rem;
    color: var(--ide-muted);
    font-size: 0.82rem;
    text-align: center;
  }

  .ide-render__message p {
    max-width: 22rem;
    margin: 0;
  }

  .ide-render__message :global(code) {
    color: var(--ide-fg);
    font: 0.78rem var(--ide-mono);
  }

  .ide-render__stage:global([data-state='drawing']) .ide-render__message {
    display: none;
  }

  .ide-render__stage:global([data-state='unsupported']) .ide-empty-title {
    color: var(--accent-3);
  }

  .ide-render__stage :global(canvas) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }

  .ide-render__stage:not([data-state='drawing']) :global(canvas) {
    visibility: hidden;
  }

  /* Keys go to the program while the canvas has focus: say so with a ring over it. */
  .ide-render__stage::after {
    position: absolute;
    inset: 0;
    content: '';
    pointer-events: none;
  }

  .ide-render__stage:global([data-state='drawing']):has(
      :global(canvas:focus)
    )::after {
    box-shadow: inset 0 0 0 1px var(--accent-2);
  }

  /* The shared loader covers the body only, so close and retry stay usable. */
  .ide-body :global(.project-demo-loading) {
    z-index: 10;
    color: var(--ide-fg);
    background: var(--ide-bg);
  }

  .ide-body :global(.project-demo-loading p) {
    color: var(--ide-muted);
  }

  .ide-body :global(.project-demo-loading p code) {
    color: var(--ide-fg);
    border-color: var(--ide-rule);
    background: var(--ide-raised);
  }

  /* Narrow-screen tabs */
  .ide-tabs {
    display: none;
  }

  @media (max-width: 42rem) {
    .ide {
      /* iOS zooms the page when focusing text below 16px. */
      --ide-code-size: 16px;

      grid-template-rows: auto minmax(0, 1fr) auto;
      border: 0;
      /* A full-screen sheet on phones (the blog embed's frame still clips it). */
      border-radius: 0;
      box-shadow: none;
    }

    /* The tree is its own pane here, so the tools start at the left edge. */
    .ide-bar,
    .ide[data-left-dock] .ide-bar {
      --ide-editor-start: 0px;

      height: calc(3.25rem + env(safe-area-inset-top));
      padding: env(safe-area-inset-top) 0.35rem 0 0.35rem;
    }

    .ide[data-left-dock] .ide-bar::before {
      display: none;
    }

    .ide-run {
      height: 2.5rem;
      padding: 0 0.9rem 0 0.75rem;
    }

    /* Nothing docks or splits on phones, so there is no layout to reset. */
    .ide-run kbd,
    .ide-icon--fullscreen,
    .ide-tool--layout {
      display: none !important;
    }

    .ide-icon {
      width: 2.5rem;
      height: 2.5rem;
    }

    .ide-icon--small {
      width: 2.5rem;
      height: 2.5rem;
    }

    .ide-status {
      display: none;
    }

    .ide-pane-head {
      cursor: auto;
    }

    .ide-group-head {
      height: 2.75rem;
    }

    .ide-filetabs {
      height: 2.75rem;
    }

    .ide-filetabs :global(.ide-filetab-open) {
      font-size: 0.85rem !important;
      line-height: 2.75rem !important;
    }

    /* Touch has no hover: every tab shows its close button. */
    .ide-filetabs :global(.ide-filetab-close) {
      width: 2rem;
      height: 2rem;
      margin-right: 0.15rem;
      opacity: 1;
    }

    .ide :global(.ide-output__toggle) {
      display: none !important;
    }

    .ide :global(.ide-output pre:not([hidden])) {
      display: block !important;
    }

    .ide-tree :global(.tree-name-input),
    .ide :global(.cm-rename-input),
    .ide :global(.cm-panel input) {
      font-size: 16px !important;
    }

    .ide-tree :global(.tree-item) {
      height: 2.5rem;
      font-size: 0.875rem !important;
    }

    .ide-tree :global(.tree-more) {
      width: 2.25rem;
      height: 2.25rem;
      opacity: 1;
    }

    .ide-tabs {
      display: flex;
      padding-bottom: env(safe-area-inset-bottom);
      background: var(--ide-sunken);
      border-top: 1px solid var(--ide-rule);
    }

    .ide-tabs button {
      position: relative;
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      height: 3.5rem;
      color: var(--ide-muted);
      font-size: 0.7rem;
      font-weight: 650;
    }

    .ide-tabs button svg {
      width: 1.25rem;
      height: 1.25rem;
    }

    .ide-tabs button[aria-selected='true'] {
      color: var(--ide-fg-strong);
    }

    .ide-tabs button[aria-selected='true']::before {
      position: absolute;
      top: -1px;
      left: 25%;
      right: 25%;
      height: 3px;
      content: '';
      background: var(--ide-accent);
    }

    .ide-tab-dot {
      position: absolute;
      top: 0.7rem;
      left: calc(50% + 0.55rem);
      display: none;
      width: 0.45rem;
      height: 0.45rem;
      background: var(--accent-3);
    }

    .ide[data-output-unread='true'] .ide-tab-dot {
      display: block;
    }
  }

  :global {
    /*
   * Dock, split and drag chrome. code-workspace-layout.ts and workspace-ui.ts
   * build these elements in script, so they carry no scoped-style attribute;
   * every rule is anchored at `.ide` instead.
   */
    .ide .ide-layout {
      display: flex;
      grid-area: 1 / 1;
      min-width: 0;
      min-height: 0;
    }

    .ide .ide-center {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .ide .ide-editors {
      display: flex;
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
    }

    /* A dock holds one or two panels: stacked at the sides, side by side above or below. */
    .ide .ide-dock {
      display: flex;
      flex: none;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .ide .ide-dock[data-dock='left'],
    .ide .ide-dock[data-dock='right'] {
      flex-direction: column;
    }

    .ide .ide-dock > .ide-files,
    .ide .ide-dock > .ide-output {
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
    }

    /* The drawing size, at the right of the Render tab's group head. */
    .ide .ide-render-size {
      align-self: center;
      padding: 0 0.6rem;
      color: var(--ide-faint);
      font: 400 0.72rem/1 var(--ide-mono);
      white-space: nowrap;
    }

    .ide .ide-render-size:empty {
      display: none;
    }

    .ide .ide-split {
      display: flex;
      min-width: 0;
      min-height: 0;
    }

    .ide .ide-split[data-direction='column'] {
      flex-direction: column;
    }

    .ide .ide-split > * {
      min-width: 0;
      min-height: 0;
    }

    .ide .ide-divider {
      position: relative;
      z-index: 6;
      flex: none;
      background: var(--ide-rule);
      touch-action: none;
      transition: background 120ms ease;
    }

    .ide .ide-divider::after {
      position: absolute;
      content: '';
    }

    .ide .ide-divider--col {
      width: 1px;
      cursor: col-resize;
    }

    .ide .ide-divider--col::after {
      inset: 0 -4px;
    }

    .ide .ide-divider--row {
      height: 1px;
      cursor: row-resize;
    }

    .ide .ide-divider--row::after {
      inset: -4px 0;
    }

    .ide .ide-divider[role='separator']:hover,
    .ide .ide-divider:focus-visible,
    .ide .ide-divider.active {
      background: var(--accent-2);
      outline: none;
    }

    /* A collapsed output keeps its rule but cannot be resized. */
    .ide[data-output-collapsed='true']
      .ide-divider:has(+ .ide-dock > .ide-output),
    .ide[data-output-collapsed='true']
      .ide-dock:has(> .ide-output)
      + .ide-divider {
      pointer-events: none;
    }

    .ide.resizing,
    .ide.dragging {
      user-select: none;
    }

    .ide.dragging,
    .ide.dragging * {
      cursor: grabbing !important;
    }

    /* Drag and drop: the region a drop would take, and the dragged item's name. */
    .ide .ide-drop {
      position: absolute;
      z-index: 40;
      pointer-events: none;
      border-radius: var(--radius-sm);
      background: color-mix(in oklch, var(--accent-2) 20%, transparent);
      box-shadow: inset 0 0 0 1px
        color-mix(in oklch, var(--accent-2) 65%, transparent);
      transition:
        left 80ms ease,
        top 80ms ease,
        width 80ms ease,
        height 80ms ease;
    }

    .ide .ide-drop[hidden] {
      display: none;
    }

    .ide .ide-drop[data-insert] {
      background: var(--accent-2);
      box-shadow: none;
      transition: none;
    }

    .ide .ide-drag-label {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 41;
      max-width: 16rem;
      overflow: hidden;
      padding: 0.3rem 0.6rem;
      color: var(--ide-fg-strong);
      background: var(--ide-raised);
      border: 1px solid var(--ide-rule);
      border-radius: var(--radius-sm);
      box-shadow: 0 0.5rem 1.5rem oklch(0% 0 0 / 0.4);
      font: 0.78rem/1.2 var(--ide-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .ide .ide-drop {
        transition: none;
      }
    }

    /*
   * Phones: one pane at a time. The dock and split containers step aside
   * (`display: contents`), so the tree, the focused editor group and the
   * output share the body's single grid cell and `data-pane` picks one.
   */
    @media (max-width: 42rem) {
      .ide .ide-layout,
      .ide .ide-center,
      .ide .ide-dock,
      .ide .ide-editors,
      .ide .ide-split {
        display: contents;
      }

      .ide .ide-divider {
        display: none;
      }

      .ide .ide-files,
      .ide .ide-group,
      .ide .ide-output,
      .ide .ide-editors > .ide-editor {
        grid-area: 1 / 1;
      }

      .ide .ide-files,
      .ide .ide-group:not([data-active]),
      .ide[data-pane='files'] .ide-group,
      .ide[data-pane='output'] .ide-group,
      .ide[data-pane='files'] .ide-editors > .ide-editor,
      .ide[data-pane='output'] .ide-editors > .ide-editor,
      .ide[data-pane='code'] .ide-output,
      .ide[data-pane='files'] .ide-output {
        display: none;
      }

      .ide[data-pane='files'] .ide-files {
        display: flex;
      }
    }
  }

  /* The confirmation dialog (workspace-actions.ts) is created in the panel at runtime. */
  :global(.ide-confirm) {
    /* The global reset zeroes the UA's `margin: auto`, so centre it explicitly. */
    position: fixed;
    inset: 50% auto auto 50%;
    margin: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 1rem;
    width: min(27rem, calc(100vw - 2rem));
    padding: 1.35rem 1.4rem 1.2rem;
    color: var(--ide-fg-strong, oklch(97.598% 0.02449 91.61));
    background: var(--ide-raised, oklch(25.5% 0.008 270));
    border: 1px solid oklch(100% 0 0 / 0.12);
    border-radius: var(--radius-lg);
    box-shadow:
      0 0.5rem 1.25rem oklch(0% 0 0 / 0.3),
      0 1.75rem 4rem oklch(0% 0 0 / 0.45);
    font-family: var(--font-sans);
    transform: translate(-50%, -50%);
  }

  :global(.ide-confirm[open]) {
    animation: ide-confirm-enter 200ms cubic-bezier(0.2, 0.75, 0.25, 1) both;
  }

  :global(.ide-confirm[open][data-closing='true']) {
    animation: ide-confirm-exit 150ms ease-in both;
  }

  :global(.ide-confirm)::backdrop {
    background: oklch(0% 0 0 / 0.4);
    backdrop-filter: blur(0.3rem);
    animation: ide-confirm-fade-in 200ms ease-out both;
  }

  :global(.ide-confirm[data-closing='true'])::backdrop {
    animation: ide-confirm-fade-out 150ms ease-in both;
  }

  :global(.ide-confirm__icon) {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius);
    color: var(--accent-1-on);
    background: var(--accent-1);
  }

  :global(.ide-confirm__body) {
    min-width: 0;
  }

  :global(.ide-confirm h2) {
    margin: 0.3rem 0 0.45rem;
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.3;
  }

  :global(.ide-confirm p) {
    margin: 0;
    color: var(--ide-fg, oklch(90% 0.016 91));
    font-size: 0.875rem;
    line-height: 1.55;
  }

  :global(.ide-confirm__actions) {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid oklch(100% 0 0 / 0.08);
  }

  :global(.ide-confirm button) {
    padding: 0.5rem 0.95rem;
    font: 700 0.82rem var(--font-sans);
    color: var(--ide-fg-strong, oklch(97.598% 0.02449 91.61));
    background: transparent;
    border: 1px solid oklch(100% 0 0 / 0.22);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      filter 120ms ease;
  }

  :global(.ide-confirm button:hover) {
    background: oklch(100% 0 0 / 0.07);
    border-color: oklch(100% 0 0 / 0.32);
  }

  :global(.ide-confirm .ide-confirm__danger) {
    color: var(--accent-1-on);
    background: var(--accent-1);
    border-color: var(--accent-1);
  }

  :global(.ide-confirm .ide-confirm__danger:hover) {
    background: var(--accent-1);
    border-color: var(--accent-1);
    filter: brightness(1.08);
  }

  :global(.ide-confirm button:focus-visible) {
    outline: 2px solid var(--accent-3);
    outline-offset: 2px;
  }

  @keyframes -global-ide-confirm-enter {
    from {
      opacity: 0;
      transform: translate(-50%, -47%) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @keyframes -global-ide-confirm-exit {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -48%) scale(0.98);
    }
  }

  @keyframes -global-ide-confirm-fade-in {
    from {
      opacity: 0;
    }
  }

  @keyframes -global-ide-confirm-fade-out {
    to {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.ide-confirm),
    :global(.ide-confirm)::backdrop {
      animation: none !important;
    }
  }
</style>
