/*
 * The Render tab's contents: where a Jai program that draws with WebGPU
 * shows its frames. workspace-ui.ts hosts the view in an editor tab (moving
 * the element into whichever group shows the tab); this module owns what is
 * inside it.
 *
 * A program draws in the execution worker, on a canvas whose drawing surface
 * was transferred there (`transferControlToOffscreen`), so every execution
 * worker needs a canvas of its own: the view element stays, and the canvas
 * inside it is replaced per worker. Keyboard, mouse and focus events of the
 * canvas and size changes of the view are posted to the worker, where the
 * bundle's webgpu_host.mjs queues them for stdlib/Input.
 */
import { forwardCanvasInput } from './canvas-input.ts';
import type {
  CanvasInputEvent,
  WorkerRequest,
  WorkerResponse,
} from './lsp-types.ts';

type InitCapabilities = Extract<
  WorkerResponse,
  { type: 'init'; error?: undefined }
>['capabilities'];

export type RenderSupport =
  | { ok: true }
  | { ok: false; title: string; detail: string };

interface RenderScope {
  navigator?: { gpu?: unknown };
  WebAssembly?: unknown;
  HTMLCanvasElement?: { prototype: object };
}

/** Whether this browser can run drawing programs; JSPI lets them wait for frames. */
export function renderSupport(
  scope: RenderScope = globalThis as unknown as RenderScope
): RenderSupport {
  const wasm = scope.WebAssembly as
    | { Suspending?: unknown; promising?: unknown }
    | undefined;
  const jspi =
    typeof wasm?.Suspending === 'function' &&
    typeof wasm?.promising === 'function';
  if (!scope.navigator?.gpu)
    return {
      ok: false,
      title: 'This browser has no WebGPU',
      detail:
        'Programs that draw need WebGPU and JavaScript Promise Integration, as in Chrome or Edge 137 and newer. They still run here, without drawing.',
    };
  if (!jspi)
    return {
      ok: false,
      title: 'Drawing needs JavaScript Promise Integration',
      detail:
        'A drawing program waits for every frame through JSPI (WebAssembly.Suspending), as in Chrome or Edge 137 and newer. It still runs here, without drawing.',
    };
  if (
    !scope.HTMLCanvasElement ||
    !('transferControlToOffscreen' in scope.HTMLCanvasElement.prototype)
  )
    return {
      ok: false,
      title: 'This browser cannot draw from a worker',
      detail: 'Drawing programs need OffscreenCanvas.',
    };
  return { ok: true };
}

/** Whether any source imports the WebGPU module (for hosts without surface events). */
export const importsWebGPU = (sources: Iterable<string>) =>
  [...sources].some((text) =>
    /^\s*#import\s+"(?:Extensions\/)?WebGPU"/mu.test(text)
  );

export interface RenderPaneOptions {
  /** The view (`[data-code-render-view]`), wherever it is in the document. */
  view: HTMLElement | undefined;
  /** A run started drawing: show the Render tab if it is closed. */
  open(): void;
}

export interface RenderPane {
  /** The drawing's size (`640 × 480`), for the tab's group head; empty when idle. */
  readonly size: HTMLElement;
  /** A fresh canvas for a new execution worker: its surface, to transfer at init. */
  canvas(): OffscreenCanvas | undefined;
  /** Connects the canvas `canvas()` made to the worker that received it. */
  attach(worker: Worker, capabilities: InitCapabilities): void;
  /** A run of `sources` starts. */
  started(sources: Iterable<string>): void;
  /** The program configured its surface at `size`, or unconfigured it. */
  surface(size: { width: number; height: number } | null): void;
  /** The run ended; the canvas stays with its worker for the next run. */
  ended(): void;
  /** The worker was terminated (Stop, an edit): its canvas goes with it. */
  stopped(): void;
  /** Focuses the drawing, so keys go to the program; false when nothing draws. */
  focus(): boolean;
  dispose(): void;
}

/** Default drawing size before the view was ever laid out. */
const FALLBACK = { width: 640, height: 480 };

export function createRenderPane({
  view,
  open,
}: RenderPaneOptions): RenderPane | undefined {
  const stage = view?.querySelector<HTMLElement>('[data-code-render]');
  if (!view || !stage) return undefined;
  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'ide-render-size';
  const title = view.querySelector<HTMLElement>('[data-code-render-title]');
  const detail = view.querySelector<HTMLElement>('[data-code-render-detail]');
  const idleTitle = title?.textContent ?? '';
  const idleDetail = [...(detail?.childNodes ?? [])].map((node) =>
    node.cloneNode(true)
  );
  const support = renderSupport();

  let current:
    | {
        element: HTMLCanvasElement;
        listeners: AbortController;
        worker?: Worker;
        drawing: boolean;
        surfaceEvents: boolean;
      }
    | undefined;
  /** Whether this run has drawn yet. */
  let shown = false;
  let pixels = { width: 0, height: 0 };

  function setState(state: 'idle' | 'drawing' | 'unsupported') {
    stage!.dataset.state = state;
    if (state !== 'drawing') sizeLabel.textContent = '';
  }
  if (!support.ok) {
    setState('unsupported');
    if (title) title.textContent = support.title;
    if (detail) detail.textContent = support.detail;
  } else if (title && detail) {
    title.textContent = idleTitle;
    detail.replaceChildren(...idleDetail.map((node) => node.cloneNode(true)));
  }

  const post = (message: WorkerRequest) =>
    current?.drawing && current.worker?.postMessage(message);

  // The view's size in device pixels; the worker learns every change.
  const observer = new ResizeObserver(([entry]) => {
    const device = entry.devicePixelContentBoxSize?.[0];
    const scale = devicePixelRatio || 1;
    const width = Math.round(
      device ? device.inlineSize : entry.contentRect.width * scale
    );
    const height = Math.round(
      device ? device.blockSize : entry.contentRect.height * scale
    );
    // A closed or background tab (or a hidden phone pane) has no size: keep the last one.
    if (!width || !height) return;
    if (width === pixels.width && height === pixels.height) return;
    pixels = { width, height };
    post({ type: 'resize', width, height });
  });
  try {
    observer.observe(stage, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(stage);
  }

  function release() {
    current?.listeners.abort();
    current?.element.remove();
    current = undefined;
  }

  /** The run draws: once per run, the Render tab is asked to show. */
  function show() {
    if (shown) return;
    shown = true;
    open();
  }

  return {
    size: sizeLabel,
    canvas() {
      release();
      if (!support.ok) return undefined;
      const element = document.createElement('canvas');
      element.tabIndex = 0;
      element.setAttribute('aria-label', 'Program drawing');
      // The program's first frame is this big, until it reads a resize.
      const size = pixels.width ? pixels : FALLBACK;
      element.width = size.width;
      element.height = size.height;
      stage.append(element);
      current = {
        element,
        listeners: new AbortController(),
        drawing: false,
        surfaceEvents: false,
      };
      return element.transferControlToOffscreen();
    },
    attach(worker, capabilities) {
      if (!current || current.worker) return;
      current.worker = worker;
      current.drawing = Boolean(capabilities.canvas?.drawing);
      current.surfaceEvents = Boolean(capabilities.canvas?.surfaceEvents);
      if (!current.drawing) return;
      const send = (event: CanvasInputEvent) =>
        worker.postMessage({ type: 'input', event } satisfies WorkerRequest);
      forwardCanvasInput(current.element, send, current.listeners.signal);
      if (pixels.width) post({ type: 'resize', ...pixels });
    },
    started(sources) {
      shown = false;
      if (stage.dataset.state === 'drawing') setState('idle');
      // Without drawing nothing opens; the tab, where open, says why.
      if (!support.ok) return;
      // A host without surface events: draw as soon as the program imports WebGPU.
      if (
        current?.drawing &&
        !current.surfaceEvents &&
        importsWebGPU(sources)
      ) {
        setState('drawing');
        show();
      }
    },
    surface(size) {
      if (!current?.drawing) return;
      if (!size) {
        setState('idle');
        return;
      }
      setState('drawing');
      sizeLabel.textContent = `${size.width} × ${size.height}`;
      show();
    },
    ended() {
      if (support.ok) setState('idle');
    },
    stopped() {
      release();
      if (support.ok) setState('idle');
    },
    focus() {
      if (!current?.drawing || stage.dataset.state !== 'drawing') return false;
      current.element.focus({ preventScroll: true });
      return true;
    },
    dispose() {
      observer.disconnect();
      release();
    },
  };
}
