import { clearOutput } from './code-output.ts';

export type WorkspacePane = 'files' | 'code' | 'output';

const panes: readonly WorkspacePane[] = ['files', 'code', 'output'];

/** Selects the visible pane in the narrow tabbed layout. Desktop ignores it. */
export function showPane(panel: HTMLElement, pane: WorkspacePane) {
  panel.dataset.pane = pane;
  if (pane === 'output') delete panel.dataset.outputUnread;
  for (const tab of panel.querySelectorAll<HTMLButtonElement>(
    '[data-pane-tab]'
  ))
    tab.setAttribute('aria-selected', String(tab.dataset.paneTab === pane));
}

function isPane(value: string | undefined): value is WorkspacePane {
  return panes.includes(value as WorkspacePane);
}

function initializeResizer(
  panel: HTMLElement,
  handle: HTMLElement,
  signal: AbortSignal
) {
  const vertical = handle.dataset.codeResize === 'files';
  const host = vertical
    ? panel
    : panel.querySelector<HTMLElement>('[data-code-main]')!;
  const property = vertical ? '--files-width' : '--output-height';
  const minimum = vertical ? 140 : 72;
  const reserve = vertical ? 240 : 120;
  const available = () => (vertical ? panel.clientWidth : host.clientHeight);
  const maximum = () => Math.max(minimum, available() - reserve);
  const current = () =>
    (vertical
      ? panel.querySelector<HTMLElement>('[data-code-files-pane]')
      : panel.querySelector<HTMLElement>('[data-code-output-pane]')
    )?.getBoundingClientRect()[vertical ? 'width' : 'height'] ?? minimum;
  const set = (value: number) => {
    const bounded = Math.max(minimum, Math.min(value, maximum()));
    host.style.setProperty(property, `${bounded}px`);
    handle.setAttribute('aria-valuenow', String(Math.round(bounded)));
    handle.setAttribute('aria-valuemax', String(Math.round(maximum())));
  };
  let start: number | undefined;
  let size = 0;
  handle.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      start = vertical ? event.clientX : event.clientY;
      size = current();
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('resizing');
    },
    { signal }
  );
  handle.addEventListener(
    'pointermove',
    (event) => {
      if (start === undefined) return;
      const delta = (vertical ? event.clientX : event.clientY) - start;
      set(size + (vertical ? delta : -delta));
    },
    { signal }
  );
  const finish = () => {
    start = undefined;
    panel.classList.remove('resizing');
  };
  handle.addEventListener('pointerup', finish, { signal });
  handle.addEventListener('pointercancel', finish, { signal });
  handle.addEventListener('lostpointercapture', finish, { signal });
  handle.addEventListener(
    'keydown',
    (event) => {
      const change: Record<string, number> = vertical
        ? { ArrowLeft: -16, ArrowRight: 16 }
        : { ArrowUp: 16, ArrowDown: -16 };
      const step = change[event.key];
      if (step === undefined) return;
      event.preventDefault();
      set(current() + step);
    },
    { signal }
  );
}

/**
 * Wires the shared workspace chrome: desktop resize handles, the narrow-screen
 * pane tabs, the output collapse toggle, and the platform shortcut hint.
 */
export function initializeWorkspaceLayout(
  panel: HTMLElement,
  signal: AbortSignal
) {
  for (const handle of panel.querySelectorAll<HTMLElement>(
    '[data-code-resize]'
  ))
    initializeResizer(panel, handle, signal);

  for (const tab of panel.querySelectorAll<HTMLButtonElement>(
    '[data-pane-tab]'
  ))
    tab.addEventListener(
      'click',
      () => {
        if (isPane(tab.dataset.paneTab)) showPane(panel, tab.dataset.paneTab);
      },
      { signal }
    );

  const toggle = panel.querySelector<HTMLButtonElement>(
    '[data-code-output-toggle]'
  );
  toggle?.addEventListener(
    'click',
    () => {
      const collapsed = panel.dataset.outputCollapsed !== 'true';
      panel.dataset.outputCollapsed = String(collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute(
        'aria-label',
        collapsed ? 'Expand output' : 'Collapse output'
      );
    },
    { signal }
  );

  panel
    .querySelector<HTMLButtonElement>('[data-code-clear]')
    ?.addEventListener('click', () => clearOutput(panel), { signal });

  const mac = /Mac|iPhone|iPad/u.test(navigator.platform);
  for (const hint of panel.querySelectorAll<HTMLElement>(
    '[data-code-shortcut]'
  ))
    hint.textContent = mac ? '⌘↵' : 'Ctrl↵';

  signal.addEventListener(
    'abort',
    () => {
      panel.classList.remove('resizing');
      showPane(panel, 'code');
    },
    { once: true }
  );
}
