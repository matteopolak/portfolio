const SDK_ROOT = '/lodestone/';
const SDK_MANIFEST_URL = `${SDK_ROOT}lodestone-web-sdk.manifest.json`;
const STAGE_COUNT = 6;

interface LodestoneHandle {
  destroy(): void;
  isDestroyed(): boolean;
}

interface LodestoneProgressEvent {
  type: string;
  phase: string;
  fraction: number;
  message: string;
  assetName?: 'clientJar' | 'blocksJson';
  loadedBytes?: number;
  totalBytes?: number;
}

interface LodestoneModule {
  default(input?: { module_or_path: ArrayBuffer }): Promise<unknown>;
  mount(options: {
    canvas: HTMLCanvasElement;
    clientJar: ArrayBuffer;
    blocksJson: ArrayBuffer;
    onProgress: (event: LodestoneProgressEvent) => void;
  }): Promise<LodestoneHandle>;
}

interface SdkFile {
  path: string;
  size: number;
  sha256: string;
}

interface SdkManifest {
  schema: 'lodestone-web-sdk';
  schema_version: 1;
  entrypoint: string;
  files: SdkFile[];
}

class LodestoneGameElement extends HTMLElement {
  #status: HTMLElement | undefined;
  #startButton: HTMLButtonElement | undefined;
  #canvas: HTMLCanvasElement | undefined;
  #handle: LodestoneHandle | undefined;
  #abortController: AbortController | undefined;
  #startPromise: Promise<void> | undefined;
  #stageProgress = Array<number>(STAGE_COUNT).fill(0);
  #downloads = new Map<number, { loaded: number; total: number }>();

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
        }
        .title { margin: 0; color: #151515; font-size: 1.1rem; font-weight: 800; }
        .status { margin: 0; max-width: 40rem; color: #625f58; font-size: 0.82rem; }
        .progress {
          display: grid;
          grid-template-columns: .35fr 2.4fr 1fr 1.15fr .55fr .55fr;
          gap: .2rem;
          width: min(25rem, 80%);
          height: .55rem;
        }
        .progress span { overflow: hidden; background: rgb(21 21 21 / .12); }
        .progress i {
          display: block;
          width: 100%;
          height: 100%;
          transform: scaleX(var(--fill, 0));
          transform-origin: left;
          transition: transform 140ms linear;
        }
        .progress span:nth-child(1) i { background: #e5372f; }
        .progress span:nth-child(2) i { background: #1758c7; }
        .progress span:nth-child(3) i { background: #f2bd24; }
        .progress span:nth-child(4) i { background: #151515; }
        .progress span:nth-child(5) i { background: #e5372f; }
        .progress span:nth-child(6) i { background: #1758c7; }
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
            <span><i></i></span><span><i></i></span><span><i></i></span><span><i></i></span><span><i></i></span><span><i></i></span>
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
    if (!('gpu' in navigator)) {
      this.#setUnavailable(
        'WebGPU is unavailable in this browser. Try a current version of Chrome, Edge, Firefox, or Safari.'
      );
    }
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    this.#abortController = undefined;
    try {
      this.#handle?.destroy();
    } catch (error) {
      console.warn('Could not fully stop the Lodestone browser demo', error);
    }
    this.#handle = undefined;
  }

  #setUnavailable(message: string) {
    if (this.#status) this.#status.textContent = message;
    if (this.#startButton) {
      this.#startButton.disabled = true;
      this.#startButton.textContent = 'WebGPU unavailable';
    }
  }

  start() {
    if (this.#handle && !this.#handle.isDestroyed()) {
      this.#canvas?.focus();
      return Promise.resolve();
    }
    if (this.#startPromise) return this.#startPromise;
    if (!('gpu' in navigator) || !this.#canvas) return Promise.resolve();

    this.#startPromise = this.#mount().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async #mount() {
    const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
    if (!prompt || !this.#canvas) return;

    this.#abortController?.abort();
    const controller = new AbortController();
    this.#abortController = controller;
    this.#stageProgress.fill(0);
    this.#downloads.clear();
    prompt.dataset.loading = 'true';
    if (this.#startButton) this.#startButton.hidden = true;
    this.#setStageProgress(0, 0.15, 'Preparing browser downloads…');

    try {
      const manifest = await this.#loadManifest(controller.signal);
      this.#setStageProgress(0, 1, 'Loading the game engine…');
      const moduleUrl = new URL(
        manifest.entrypoint,
        location.origin + SDK_ROOT
      );
      const wasmPath = manifest.entrypoint.replace(/\.js$/, '_bg.wasm');
      const [sdk, wasm, clientJar, blocksJson] = await Promise.all([
        import(/* @vite-ignore */ moduleUrl.href) as Promise<LodestoneModule>,
        this.#fetchSdkFile(manifest, wasmPath, 1, controller.signal),
        this.#fetchSdkFile(manifest, 'client.jar', 2, controller.signal),
        this.#fetchSdkFile(manifest, 'blocks.json', 3, controller.signal),
      ]);
      if (!this.isConnected || controller.signal.aborted) return;

      this.#setStageProgress(4, 0.15, 'Initializing the game engine…');
      await sdk.default({ module_or_path: wasm });
      if (!this.isConnected || controller.signal.aborted) return;

      this.#handle = await sdk.mount({
        canvas: this.#canvas,
        clientJar,
        blocksJson,
        onProgress: (event) => this.#handleProgress(event),
      });
      if (!this.isConnected || controller.signal.aborted) {
        this.#handle.destroy();
        this.#handle = undefined;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Could not start the Lodestone browser demo', error);
      delete prompt.dataset.loading;
      if (this.#status) {
        this.#status.textContent =
          'The game could not be loaded. Check your connection and try again.';
      }
      if (this.#startButton) {
        this.#startButton.hidden = false;
        this.#startButton.textContent = 'Try again';
      }
    }
  }

  async #loadManifest(signal: AbortSignal) {
    const response = await fetch(SDK_MANIFEST_URL, { signal });
    if (!response.ok)
      throw new Error(`SDK manifest returned HTTP ${response.status}`);
    const manifest = (await response.json()) as SdkManifest;
    if (
      manifest.schema !== 'lodestone-web-sdk' ||
      manifest.schema_version !== 1 ||
      !/^[\w.-]+\.js$/.test(manifest.entrypoint) ||
      !Array.isArray(manifest.files)
    ) {
      throw new Error('The Lodestone SDK manifest is not supported.');
    }
    return manifest;
  }

  async #fetchSdkFile(
    manifest: SdkManifest,
    path: string,
    stage: number,
    signal: AbortSignal
  ) {
    const expected = manifest.files.find((entry) => entry.path === path);
    if (!expected) throw new Error(`SDK manifest does not contain ${path}`);
    const response = await fetch(new URL(path, location.origin + SDK_ROOT), {
      signal,
    });
    if (!response.ok)
      throw new Error(`${path} returned HTTP ${response.status}`);

    const announcedLength = Number(response.headers.get('content-length'));
    const total = announcedLength > 0 ? announcedLength : expected.size;
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = await response.arrayBuffer();
      this.#recordDownload(stage, bytes.byteLength, total);
      return bytes;
    }

    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      this.#recordDownload(stage, loaded, total);
    }
    if (loaded !== expected.size) {
      throw new Error(`${path} has ${loaded} bytes, expected ${expected.size}`);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.#recordDownload(stage, loaded, total);
    return bytes.buffer;
  }

  #recordDownload(stage: number, loaded: number, total: number) {
    this.#downloads.set(stage, { loaded, total });
    const totals = [...this.#downloads.values()].reduce(
      (sum, current) => ({
        loaded: sum.loaded + current.loaded,
        total: sum.total + current.total,
      }),
      { loaded: 0, total: 0 }
    );
    this.#setStageProgress(
      stage,
      total ? loaded / total : 0,
      `Downloading game files… ${formatMiB(totals.loaded)} / ${formatMiB(totals.total)}`
    );
  }

  #handleProgress(event: LodestoneProgressEvent) {
    if (event.type === 'starting') {
      this.#setStageProgress(
        4,
        Math.max(0.2, event.fraction),
        'Starting Minecraft…'
      );
    } else if (event.type === 'started') {
      this.#setStageProgress(4, 1, 'Building the first frame…');
      this.#setStageProgress(5, 0.25, 'Building the first frame…');
    } else if (event.type === 'first-frame') {
      this.#setStageProgress(5, 1, 'Ready');
      this.shadowRoot?.querySelector<HTMLElement>('.prompt')?.remove();
      this.#canvas?.focus();
    } else if (event.type === 'first-frame-timeout') {
      this.#setStageProgress(
        5,
        0,
        'The renderer did not produce a frame. Close this window and try again.'
      );
    } else if (event.type === 'asset-error') {
      this.#setStageProgress(
        4,
        0,
        'A required game file could not be installed.'
      );
    }
  }

  #setStageProgress(stage: number, fraction: number, message: string) {
    const bounded = Math.max(0, Math.min(1, fraction));
    this.#stageProgress[stage] = bounded;
    if (this.#status) this.#status.textContent = message;
    const progress = this.shadowRoot?.querySelector<HTMLElement>('.progress');
    progress
      ?.querySelectorAll<HTMLElement>('i')
      .item(stage)
      ?.style.setProperty('--fill', String(bounded));
    const total = this.#stageProgress.reduce((sum, value) => sum + value, 0);
    progress?.setAttribute(
      'aria-valuenow',
      String(Math.round((total / STAGE_COUNT) * 100))
    );
  }

  async enterFullscreen() {
    const shell = this.shadowRoot?.querySelector<HTMLElement>('.shell');
    if (!shell) return;

    try {
      await shell.requestFullscreen();
      try {
        await navigator.keyboard?.lock?.(['Escape']);
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

function formatMiB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

if (!customElements.get('lodestone-game')) {
  customElements.define('lodestone-game', LodestoneGameElement);
}
