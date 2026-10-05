import { initializeBaerscriptPlayground } from './baerscript-playground';
import { initializeQuasiPlayground } from './quasi-playground';
import { initializeJaiPlayground } from './jai-playground';

/*
 * The code demos shared by the project modals (`project-actions.ts`) and the
 * full-page playgrounds (`playground-page.ts`). Each `initialize` takes the
 * element that contains a `CodeWorkspace` and reports loading through the
 * bubbling `project-demo-*` events on it.
 */
export interface CodePlayground {
  prepare(): Promise<void>;
  isReady(): boolean;
  destroy(): void;
}

export type CodeDemoId = 'quasi' | 'baerscript' | 'jai';

export const codeDemos: {
  id: CodeDemoId;
  actionId: string;
  initialize(root: HTMLElement, signal: AbortSignal): CodePlayground;
}[] = [
  { id: 'quasi', actionId: 'try-quasi', initialize: initializeQuasiPlayground },
  {
    id: 'baerscript',
    actionId: 'try-baerscript',
    initialize: initializeBaerscriptPlayground,
  },
  { id: 'jai', actionId: 'try-jai', initialize: initializeJaiPlayground },
];

interface DemoProgressEvent extends CustomEvent {
  detail: { progress: number; message: string };
}

function replaceWithInlineCode(element: HTMLElement, message: string) {
  const parts = message.split('`');
  element.replaceChildren(
    ...parts.map((part, index) => {
      if (index % 2 === 0) return document.createTextNode(part);
      const code = document.createElement('code');
      code.textContent = part;
      return code;
    })
  );
}

/** Updates the `ProjectDemoLoading` surface inside `host` (a dialog or a page). */
export function setDemoLoading(
  host: HTMLElement,
  progress: number,
  message: string,
  state: 'loading' | 'ready' | 'error' = 'loading'
) {
  const bounded = Math.max(0, Math.min(1, progress));
  host.dataset.demoState = state;
  const loader = host.querySelector<HTMLElement>('[data-project-demo-loading]');
  const progressElement = host.querySelector<HTMLElement>(
    '[data-project-demo-loading-progress]'
  );
  loader?.setAttribute('data-state', state);
  const label = loader?.querySelector<HTMLElement>(
    '[data-project-demo-loading-label]'
  );
  if (label) replaceWithInlineCode(label, message);
  progressElement?.setAttribute(
    'aria-valuenow',
    String(Math.round(bounded * 100))
  );
}

/** Drives the loading surface from a demo's `project-demo-*` events. */
export function watchDemoLoading(host: HTMLElement, signal: AbortSignal) {
  host.addEventListener(
    'project-demo-progress',
    (event) => {
      const { progress, message } = (event as DemoProgressEvent).detail;
      setDemoLoading(host, progress, message);
    },
    { signal }
  );
  host.addEventListener(
    'project-demo-ready',
    () => setDemoLoading(host, 1, 'Ready', 'ready'),
    { signal }
  );
  host.addEventListener(
    'project-demo-error',
    (event) => {
      const message = (event as CustomEvent<{ message: string }>).detail
        .message;
      setDemoLoading(host, 1, message, 'error');
    },
    { signal }
  );
}

/** The workspace header's full-screen toggle. */
export function wireFullscreen(
  host: HTMLElement,
  panel: HTMLElement | null,
  signal: AbortSignal
) {
  host
    .querySelector<HTMLButtonElement>('[data-code-fullscreen]')
    ?.addEventListener(
      'click',
      () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else if (panel) void panel.requestFullscreen();
      },
      { signal }
    );
}
