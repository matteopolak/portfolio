/*
 * The Render pane: where a Jai program that draws with WebGPU shows its
 * frames. The layout docks the pane like the output (it starts closed); this
 * module owns what is inside it.
 *
 * A program draws in the execution worker, on a canvas whose drawing surface
 * was transferred there (`transferControlToOffscreen`), so every execution
 * worker needs a canvas of its own: the pane element stays, and the canvas
 * inside it is replaced per worker. Keyboard, mouse and focus events of the
 * canvas and size changes of the pane are posted to the worker, where the
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
  /** The pane (`[data-code-render-pane]`), in the document or not. */
  pane: HTMLElement | undefined;
  /**
   * Shows the pane where the layout last docked it; `select` also brings it
   * to the front on phones.
   */
  open(select: boolean): void;
}

export interface RenderPane {
  /** A fresh canvas for a new execution worker: its surface, to transfer at init. */
  canvas(): OffscreenCanvas | undefined;
  /** Connects the canvas `canvas()` made to the worker that received it. */
  attach(worker: Worker, capabilities: InitCapabilities): void;
  /** A run starts: `explicit` when the user asked (Run, Ctrl+Enter), not an edit. */
  started(sources: Iterable<string>, explicit: boolean): void;
  /** The program configured its surface at `size`, or unconfigured it. */
  surface(size: { width: number; height: number } | null): void;
  /** The run ended; the canvas stays with its worker for the next run. */
  ended(): void;
  /** The worker was terminated (Stop, an edit): its canvas goes with it. */
  stopped(): void;
  dispose(): void;
}

/** Default drawing size before the pane was ever laid out. */
const FALLBACK = { width: 640, height: 480 };

export function createRenderPane({
  pane,
  open,
}: RenderPaneOptions): RenderPane | undefined {
  const stage = pane?.querySelector<HTMLElement>('[data-code-render]');
  if (!pane || !stage) return undefined;
  const sizeLabel = pane.querySelector<HTMLElement>('[data-code-render-size]');
  const title = pane.querySelector<HTMLElement>('[data-code-render-title]');
  const detail = pane.querySelector<HTMLElement>('[data-code-render-detail]');
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
  /** This run: whether the user started it, and whether it has shown the pane. */
  let run = { explicit: false, shown: false };
  let unsupportedShown = false;
  let pixels = { width: 0, height: 0 };

  function setState(state: 'idle' | 'drawing' | 'unsupported') {
    stage!.dataset.state = state;
    if (state !== 'drawing' && sizeLabel) sizeLabel.textContent = '';
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

  // The pane's size in device pixels; the worker learns every change.
  const observer = new ResizeObserver(([entry]) => {
    const device = entry.devicePixelContentBoxSize?.[0];
    const scale = devicePixelRatio || 1;
    const width = Math.round(
      device ? device.inlineSize : entry.contentRect.width * scale
    );
    const height = Math.round(
      device ? device.blockSize : entry.contentRect.height * scale
    );
    // A closed pane (or a hidden phone pane) has no size: keep the last one.
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

  const editing = () =>
    Boolean(
      (document.activeElement as HTMLElement | null)?.closest?.(
        '.cm-editor, input, textarea, select, [contenteditable="true"]'
      )
    );

  /**
   * Shows the pane for this run, once. Keyboard focus (and, on phones, the
   * screen) follows unless the run came from an edit while the user types.
   */
  function show() {
    if (run.shown) return;
    run.shown = true;
    const take = run.explicit || !editing();
    open(take);
    if (current && take) current.element.focus({ preventScroll: true });
  }

  return {
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
    started(sources, explicit) {
      run = { explicit, shown: false };
      if (stage.dataset.state === 'drawing') setState('idle');
      if (!support.ok) {
        // Say why nothing draws, once, when the user ran a drawing program.
        if (explicit && !unsupportedShown && importsWebGPU(sources)) {
          unsupportedShown = true;
          open(true);
        }
        return;
      }
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
      if (sizeLabel) sizeLabel.textContent = `${size.width} × ${size.height}`;
      show();
    },
    ended() {
      if (support.ok) setState('idle');
    },
    stopped() {
      release();
      if (support.ok) setState('idle');
    },
    dispose() {
      observer.disconnect();
      release();
    },
  };
}
