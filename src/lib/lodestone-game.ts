const SDK_ROOT = '/lodestone/';
const SDK_MANIFEST_URL = `${SDK_ROOT}lodestone-web-sdk.manifest.json`;
interface LodestoneProgressEvent {
  type?: string;
  phase?: string;
  fraction: number;
  message: string;
  assetName?: string;
  loadedBytes?: number;
  totalBytes?: number;
}

interface LodestoneHostAction {
  type: 'pointer-lock';
  locked: boolean;
}

type LodestoneWorkerMessage =
  | { kind: 'progress'; event: LodestoneProgressEvent }
  | { kind: 'host-action'; action: LodestoneHostAction }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

interface SdkFile {
  path: string;
  size: number;
  sha256: string;
}

interface SdkManifest {
  schema: 'lodestone-web-sdk';
  schema_version: 2;
  entrypoint: string;
  worker_entrypoint: string;
  files: SdkFile[];
}

interface DemoProgressDetail {
  progress: number;
  message: string;
}

interface WorkerCapabilityReport {
  webGpu: boolean;
  offscreenCanvas: boolean;
  webGpuCanvas: boolean;
}

async function missingRendererCapabilities() {
  const missing: string[] = [];
  if (!('gpu' in navigator)) missing.push('page WebGPU (`navigator.gpu`)');
  if (typeof Worker === 'undefined') missing.push('Web Workers (`Worker`)');
  if (typeof OffscreenCanvas === 'undefined') {
    missing.push('worker canvas support (`OffscreenCanvas`)');
  }
  if (!('transferControlToOffscreen' in HTMLCanvasElement.prototype)) {
    missing.push(
      'canvas transfer (`HTMLCanvasElement.transferControlToOffscreen`)'
    );
  }
  if (missing.length > 0) return missing;

  const report = await probeWorkerCapabilities();
  if (!report) {
    missing.push('worker capability detection');
    return missing;
  }
  if (!report.webGpu) missing.push('worker WebGPU (`WorkerNavigator.gpu`)');
  if (!report.offscreenCanvas) {
    missing.push('worker canvas support (`OffscreenCanvas`)');
  } else if (!report.webGpuCanvas) {
    missing.push('a worker WebGPU canvas context (`getContext("webgpu")`)');
  }
  return missing;
}

function probeWorkerCapabilities() {
  return new Promise<WorkerCapabilityReport | undefined>((resolve) => {
    const source = `
      const offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
      let webGpuCanvas = false;
      if (offscreenCanvas) {
        try {
          webGpuCanvas = Boolean(new OffscreenCanvas(1, 1).getContext('webgpu'));
        } catch {}
      }
      self.postMessage({
        webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
        offscreenCanvas,
        webGpuCanvas,
      });
    `;
    const url = URL.createObjectURL(
      new Blob([source], { type: 'text/javascript' })
    );
    let worker: Worker | undefined;
    let settled = false;
    const finish = (report?: WorkerCapabilityReport) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      worker?.terminate();
      URL.revokeObjectURL(url);
      resolve(report);
    };
    const timeout = window.setTimeout(() => finish(), 2_000);

    try {
      worker = new Worker(url, { name: 'lodestone-capability-probe' });
      worker.addEventListener('message', (event) => {
        finish(event.data as WorkerCapabilityReport);
      });
      worker.addEventListener('error', () => finish());
    } catch {
      finish();
    }
  });
}

function rendererCapabilityError(missing: string[]) {
  return `This browser cannot run the Lodestone renderer. Missing required capabilities: ${missing.join('; ')}. Lodestone renders WebGPU through a transferred OffscreenCanvas in a dedicated worker.`;
}

class LodestoneGameElement extends HTMLElement {
  #status: HTMLElement | undefined;
  #startButton: HTMLButtonElement | undefined;
  #canvas: HTMLCanvasElement | undefined;
  #worker: Worker | undefined;
  #abortController: AbortController | undefined;
  #startPromise: Promise<void> | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #capabilityCheck: Promise<string[]> | undefined;
  #capabilityError: string | undefined;
  #sendInput: ((input: Record<string, unknown>) => void) | undefined;
  #canvasTransferred = false;
  #canvasRevealed = false;
  #workerReady = false;
  #firstFrameReady = false;
  #pointerLockRequested = false;
  #readyAssets = new Set<string>();

  connectedCallback() {
    if (this.shadowRoot) return;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          margin: 2rem 0;
          color: #151515;
          font-family: 'Open Sans Variable', 'Helvetica Neue', Arial, sans-serif;
        }
        :host([mode='modal']) {
          position: relative;
          height: 100%;
          margin: 0;
        }
        .shell {
          position: relative;
          overflow: hidden;
          aspect-ratio: 16 / 9;
          min-height: 18rem;
          border: 1px solid #151515;
          border-left: 0.7rem solid #1758c7;
          background:
            linear-gradient(135deg, transparent 65%, rgb(242 189 36 / 0.55) 65%),
            #fffdf7;
        }
        :host([mode='modal']) .shell {
          height: 100%;
          min-height: 0;
          border: 0;
          border-left: 0;
        }
        .shell:fullscreen {
          width: 100vw;
          height: 100vh;
          min-height: 0;
          border: 0;
          outline: 0;
          aspect-ratio: auto;
        }
        .fullscreen-hint {
          position: absolute;
          top: .75rem;
          right: .75rem;
          z-index: 5;
          display: none;
          padding: .55rem .75rem;
          color: #fffdf7;
          background: rgb(10 10 18 / .76);
          font-size: .72rem;
          font-weight: 700;
          backdrop-filter: blur(7px);
          pointer-events: none;
        }
        .shell:fullscreen .fullscreen-hint { display: block; }
        .prompt {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 0.75rem;
          padding: 1.5rem;
          text-align: center;
          transition: opacity 180ms ease;
        }
        .prompt[data-mounted='true'] { pointer-events: none; }
        .prompt[data-ready='true'] { opacity: 0; pointer-events: none; }
        .title { margin: 0; color: #151515; font-size: 1.1rem; font-weight: 800; }
        .status { margin: 0; max-width: 40rem; color: #625f58; font-size: 0.82rem; }
        .progress {
          width: min(25rem, 80%);
          height: .55rem;
          overflow: hidden;
          background: rgb(21 21 21 / .12);
        }
        .progress i {
          display: block;
          width: 100%;
          height: 100%;
          transform: scaleX(var(--fill, 0));
          transform-origin: left;
          transition: transform 140ms linear;
          background: #1758c7;
        }
        button {
          border: 1px solid #151515;
          padding: 0.6rem 1rem;
          color: #fffdf7;
          background: #e5372f;
          font: inherit;
          font-weight: 800;
          cursor: pointer;
        }
        button:hover { background: #1758c7; }
        button:focus-visible { outline: 3px solid #1758c7; outline-offset: 3px; }
        canvas {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          outline: 0;
          background: #0a0a12;
        }
        canvas:focus,
        canvas:focus-visible { outline: 0; }
        .help {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 0.5rem;
          color: #625f58;
          font-size: 0.72rem;
        }
        .help button {
          border: 0;
          padding: 0;
          color: #1758c7;
          background: transparent;
          font-size: inherit;
          font-weight: 400;
        }
        :host([mode='modal']) .help { display: none; }
        :host([mode='modal']) .title,
        :host([mode='modal']) .prompt > button { display: none; }
        :host([mode='modal']) .prompt { display: none; }
        @media (max-width: 42rem) {
          .shell { min-height: 14rem; }
          .help { display: block; }
          .help span { display: block; margin-bottom: 0.25rem; }
        }
      </style>
      <div class="shell">
        <span class="fullscreen-hint">Press and hold Esc to exit full screen</span>
        <canvas tabindex="0" aria-label="Lodestone singleplayer game"></canvas>
        <div class="prompt">
          <p class="title">Play Lodestone in your browser</p>
          <p class="status">The game loads only after you choose to start it.</p>
          <div class="progress" role="progressbar" aria-label="Preparing Minecraft" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <i></i>
          </div>
          <button type="button">Try in browser</button>
        </div>
      </div>
      <div class="help">
        <span>Click the game before using keyboard or mouse controls. Press Escape to release the cursor.</span>
        <button class="fullscreen" type="button">Full screen</button>
      </div>
    `;

    this.#status = shadow.querySelector<HTMLElement>('.status') ?? undefined;
    this.#startButton =
      shadow.querySelector<HTMLButtonElement>('.prompt > button') ?? undefined;
    this.#canvas =
      shadow.querySelector<HTMLCanvasElement>('canvas') ?? undefined;
    this.#startButton?.addEventListener('click', () => void this.start());
    shadow
      .querySelector<HTMLButtonElement>('.fullscreen')
      ?.addEventListener('click', () => void this.enterFullscreen());
    this.#capabilityCheck = missingRendererCapabilities();
    void this.#capabilityCheck.then((missing) => {
      if (missing.length > 0) {
        this.#setUnavailable(rendererCapabilityError(missing));
      }
    });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#stopWorker();
  }

  #setUnavailable(message: string) {
    if (this.#capabilityError === message) return;
    this.#capabilityError = message;
    if (this.#status) this.#status.textContent = message;
    if (this.#startButton) {
      this.#startButton.disabled = true;
      this.#startButton.textContent = 'WebGPU unavailable';
    }
    this.#reportError(message);
  }

  async start() {
    if (this.#worker) {
      this.#canvas?.focus();
      return;
    }
    if (this.#startPromise) return this.#startPromise;
    if (!this.#canvas) return;

    this.#startPromise = this.#startSupported().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async #startSupported() {
    const missing = await (this.#capabilityCheck ??
      missingRendererCapabilities());
    if (missing.length > 0) {
      this.#setUnavailable(rendererCapabilityError(missing));
      return;
    }
    await this.#mount();
  }

  async #mount() {
    const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
    if (!prompt || !this.#canvas) return;

    if (this.#canvasTransferred) this.#replaceCanvas();
    const canvas = this.#canvas;
    if (!canvas) return;

    this.#abortController?.abort();
    const controller = new AbortController();
    this.#abortController = controller;
    this.#canvasRevealed = false;
    this.#workerReady = false;
    this.#firstFrameReady = false;
    this.#readyAssets.clear();
    delete prompt.dataset.mounted;
    delete prompt.dataset.ready;
    prompt.dataset.loading = 'true';
    if (this.#startButton) this.#startButton.hidden = true;
    this.#setProgress(0.04, 'Preparing demo…');

    try {
      const manifest = await this.#loadManifest(controller.signal);
      if (!this.isConnected || controller.signal.aborted) return;

      this.#setProgress(0.1, 'Starting demo…');
      this.#launchWorker(canvas, manifest, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#stopWorker();
      console.error('Could not start the Lodestone browser demo', error);
      delete prompt.dataset.mounted;
      delete prompt.dataset.ready;
      delete prompt.dataset.loading;
      if (this.#status) {
        this.#status.textContent =
          'The game could not be loaded. Check your connection and try again.';
      }
      if (this.#startButton) {
        this.#startButton.hidden = false;
        this.#startButton.textContent = 'Try again';
      }
      this.#reportError(
        'The demo could not be loaded. Check your connection and try again.'
      );
    }
  }

  async #loadManifest(signal: AbortSignal) {
    const response = await fetch(SDK_MANIFEST_URL, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(`SDK manifest returned HTTP ${response.status}`);
    const manifest = (await response.json()) as SdkManifest;
    if (
      manifest.schema !== 'lodestone-web-sdk' ||
      manifest.schema_version !== 2 ||
      !/^[\w.-]+\.js$/.test(manifest.entrypoint) ||
      !/^[\w.-]+\.js$/.test(manifest.worker_entrypoint) ||
      !Array.isArray(manifest.files) ||
      ![
        manifest.entrypoint,
        `${manifest.entrypoint.slice(0, -3)}_bg.wasm`,
        manifest.worker_entrypoint,
        'client.jar',
        'blocks.json',
        ...Array.from({ length: 6 }, (_, index) => `panorama_${index}.png`),
      ].every((path) => manifest.files.some((entry) => entry.path === path))
    ) {
      throw new Error('The Lodestone SDK manifest is not supported.');
    }
    return manifest;
  }

  #launchWorker(
    canvas: HTMLCanvasElement,
    manifest: SdkManifest,
    signal: AbortSignal
  ) {
    this.#resizeCanvas(canvas);
    const offscreen = canvas.transferControlToOffscreen();
    this.#canvasTransferred = true;
    const worker = new Worker(
      new URL(manifest.worker_entrypoint, location.origin + SDK_ROOT),
      { type: 'module', name: 'lodestone-renderer' }
    );
    this.#worker = worker;

    worker.addEventListener(
      'message',
      (event: MessageEvent<LodestoneWorkerMessage>) => {
        const message = event.data;
        if (message.kind === 'progress') {
          this.#handleProgress(message.event);
        } else if (message.kind === 'host-action') {
          this.#handleHostAction(message.action);
        } else if (message.kind === 'ready') {
          this.#workerReady = true;
          this.focusGame();
          this.#reconcileVisibleGate();
          if (this.#firstFrameReady) {
            this.#setProgress(1, 'Ready');
            this.#revealCanvas();
          } else {
            this.#setProgress(0.92, 'Preparing demo…');
          }
        } else if (message.kind === 'error') {
          this.#handleWorkerError(message.message);
        }
      },
      { signal }
    );
    worker.addEventListener(
      'error',
      (event) => this.#handleWorkerError(event.message),
      { signal }
    );
    this.#installInputBridge(canvas, worker, signal);
    worker.postMessage({ kind: 'mount', canvas: offscreen, manifest }, [
      offscreen,
    ]);
  }

  #installInputBridge(
    canvas: HTMLCanvasElement,
    worker: Worker,
    signal: AbortSignal
  ) {
    const sendInput = (input: Record<string, unknown>) => {
      worker.postMessage({ kind: 'input', input });
    };
    this.#sendInput = sendInput;

    canvas.addEventListener(
      'pointermove',
      (event) => {
        sendInput({ type: 'pointerMove', x: event.offsetX, y: event.offsetY });
        if (event.movementX || event.movementY) {
          sendInput({
            type: 'mouseMotion',
            dx: event.movementX,
            dy: event.movementY,
          });
        }
      },
      { signal }
    );
    for (const eventName of ['pointerdown', 'pointerup'] as const) {
      canvas.addEventListener(
        eventName,
        (event) => {
          canvas.focus({ preventScroll: true });
          // DOM focus may predate the worker bridge. Always synchronize the
          // renderer before forwarding the press so activation never consumes
          // the user's first intended click.
          sendInput({ type: 'focus', focused: true });
          // The loading layer can disappear underneath an already-stationary
          // pointer, so the canvas may never receive a pointermove before the
          // first click. Seed the renderer with the press location first.
          sendInput({
            type: 'pointerMove',
            x: event.offsetX,
            y: event.offsetY,
          });
          sendInput({
            type: 'mouseButton',
            button: event.button,
            pressed: eventName === 'pointerdown',
          });
          if (
            eventName === 'pointerdown' &&
            this.#pointerLockRequested &&
            document.pointerLockElement !== canvas
          ) {
            void canvas.requestPointerLock();
          }
        },
        { signal }
      );
    }
    if (this.shadowRoot?.activeElement === canvas) {
      sendInput({ type: 'focus', focused: true });
    }
    canvas.addEventListener(
      'wheel',
      (event) => {
        sendInput({ type: 'wheel', dx: event.deltaX, dy: event.deltaY });
        event.preventDefault();
      },
      { passive: false, signal }
    );
    for (const eventName of ['keydown', 'keyup'] as const) {
      canvas.addEventListener(
        eventName,
        (event) => {
          let modifiers = 0;
          if (event.shiftKey) modifiers |= 1;
          if (event.ctrlKey) modifiers |= 2;
          if (event.altKey) modifiers |= 4;
          if (event.metaKey) modifiers |= 8;
          sendInput({
            type: 'key',
            code: event.code,
            pressed: eventName === 'keydown',
            text: event.key || undefined,
            modifiers,
          });
          event.preventDefault();
        },
        { signal }
      );
    }
    for (const eventName of ['focus', 'blur'] as const) {
      canvas.addEventListener(
        eventName,
        () => {
          sendInput({ type: 'focus', focused: eventName === 'focus' });
        },
        { signal }
      );
    }
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), {
      signal,
    });
    document.addEventListener(
      'pointerlockchange',
      () => {
        const locked = document.pointerLockElement === canvas;
        sendInput({ type: 'pointerLock', locked });
        if (!locked) this.#pointerLockRequested = false;
      },
      { signal }
    );

    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => {
      const { width, height } = this.#canvasSize(canvas);
      sendInput({ type: 'resize', width, height });
    });
    this.#resizeObserver.observe(canvas);
  }

  #canvasSize(canvas: HTMLCanvasElement) {
    const scale = window.devicePixelRatio || 1;
    return {
      width: Math.max(1, Math.round(canvas.clientWidth * scale)),
      height: Math.max(1, Math.round(canvas.clientHeight * scale)),
    };
  }

  #resizeCanvas(canvas: HTMLCanvasElement) {
    const { width, height } = this.#canvasSize(canvas);
    canvas.width = width;
    canvas.height = height;
  }

  #replaceCanvas() {
    if (!this.#canvas) return;
    const replacement = this.#canvas.cloneNode(false) as HTMLCanvasElement;
    this.#canvas.replaceWith(replacement);
    this.#canvas = replacement;
    this.#canvasTransferred = false;
  }

  #stopWorker() {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#pointerLockRequested = false;
    this.#sendInput = undefined;
    this.#workerReady = false;
    this.#firstFrameReady = false;
    if (document.pointerLockElement === this.#canvas) {
      document.exitPointerLock();
    }
    const worker = this.#worker;
    this.#worker = undefined;
    if (!worker) return;
    try {
      worker.postMessage({ kind: 'destroy' });
    } catch {
      // A failed worker no longer needs a graceful destroy request.
    }
    window.setTimeout(() => worker.terminate(), 250);
  }

  #handleWorkerError(message: string) {
    console.error('Lodestone renderer worker failed', message);
    this.#abortController?.abort();
    this.#stopWorker();
    const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
    if (prompt) {
      delete prompt.dataset.mounted;
      delete prompt.dataset.ready;
      delete prompt.dataset.loading;
    }
    if (this.#status) {
      this.#status.textContent =
        'The game could not be started. Close this window and try again.';
    }
    if (this.#startButton) {
      this.#startButton.hidden = false;
      this.#startButton.textContent = 'Try again';
    }
    this.#reportError(
      'The demo could not be started. Close this window and try again.'
    );
  }

  #handleHostAction(action: LodestoneHostAction) {
    if (action.type !== 'pointer-lock') return;
    this.#pointerLockRequested = action.locked;
    if (!action.locked && document.pointerLockElement === this.#canvas) {
      document.exitPointerLock();
    }
  }

  #handleProgress(event: LodestoneProgressEvent) {
    const type = event.type ?? event.phase;
    if (type === 'asset-start') {
      this.#setProgress(
        Math.max(0.12, this.#currentAssetProgress()),
        'Loading demo…'
      );
    } else if (type === 'asset-ready') {
      if (event.assetName) this.#readyAssets.add(event.assetName);
      this.#setProgress(this.#currentAssetProgress(), 'Loading demo…');
    } else if (type === 'starting') {
      this.#setProgress(
        0.78 + Math.max(0, event.fraction) * 0.1,
        'Preparing demo…'
      );
    } else if (type === 'started') {
      this.#setProgress(0.9, 'Preparing demo…');
      const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
      if (prompt) prompt.dataset.mounted = 'true';
    } else if (type === 'first-frame') {
      this.#firstFrameReady = true;
      if (this.#workerReady) {
        this.#setProgress(1, 'Ready');
        this.#revealCanvas();
      } else {
        this.#setProgress(0.98, 'Preparing demo…');
      }
    } else if (type === 'first-frame-timeout') {
      const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
      if (prompt) delete prompt.dataset.mounted;
      const message =
        'The renderer could not start. Close this window and try again.';
      this.#setProgress(0, message);
      this.#reportError(message);
    } else if (type === 'asset-error') {
      const message = 'A required demo file could not be installed.';
      this.#setProgress(0, message);
      this.#reportError(message);
    }
  }

  #revealCanvas() {
    if (this.#canvasRevealed) return;
    this.#canvasRevealed = true;
    const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
    if (prompt) {
      prompt.dataset.ready = 'true';
      window.setTimeout(() => prompt.remove(), 180);
    }
    this.dispatchEvent(
      new CustomEvent('project-demo-ready', { bubbles: true, composed: true })
    );
    requestAnimationFrame(() => this.focusGame());
  }

  #currentAssetProgress() {
    return 0.12 + Math.min(this.#readyAssets.size, 8) * 0.08;
  }

  #setProgress(fraction: number, message: string) {
    const bounded = Math.max(0, Math.min(1, fraction));
    if (this.#status) this.#status.textContent = message;
    const progress = this.shadowRoot?.querySelector<HTMLElement>('.progress');
    progress
      ?.querySelector<HTMLElement>('i')
      ?.style.setProperty('--fill', String(bounded));
    progress?.setAttribute('aria-valuenow', String(Math.round(bounded * 100)));
    const detail: DemoProgressDetail = { progress: bounded, message };
    this.dispatchEvent(
      new CustomEvent('project-demo-progress', {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  #reportError(message: string) {
    this.dispatchEvent(
      new CustomEvent('project-demo-error', {
        detail: { message },
        bubbles: true,
        composed: true,
      })
    );
  }

  focusGame() {
    this.#canvas?.focus({ preventScroll: true });
    this.#sendInput?.({ type: 'focus', focused: true });
  }

  #reconcileVisibleGate() {
    const key = {
      type: 'key',
      code: 'ArrowLeft',
      text: undefined,
      modifiers: 0,
    };
    this.#sendInput?.({ ...key, pressed: true });
    this.#sendInput?.({ ...key, pressed: false });
  }

  async enterFullscreen() {
    const shell = this.shadowRoot?.querySelector<HTMLElement>('.shell');
    if (!shell) return;

    try {
      await shell.requestFullscreen();
      try {
        const keyboard = (
          navigator as Navigator & {
            keyboard?: { lock?: (keys: string[]) => Promise<void> };
          }
        ).keyboard;
        await keyboard?.lock?.(['Escape']);
      } catch {
        // Keyboard Lock is a progressive enhancement; fullscreen still works.
      }
      this.#canvas?.focus();
    } catch {
      if (this.#status) {
        this.#status.textContent =
          'Full screen was blocked. Click the game and try again.';
      }
    }
  }
}

if (!customElements.get('lodestone-game')) {
  customElements.define('lodestone-game', LodestoneGameElement);
}
