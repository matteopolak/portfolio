const DEFAULT_GAME_URL = '/lodestone/index.html';

class LodestoneGameElement extends HTMLElement {
  #frame: HTMLIFrameElement | undefined;
  #status: HTMLElement | undefined;
  #startButton: HTMLButtonElement | undefined;

  connectedCallback() {
    if (this.shadowRoot) return;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          margin: 2rem 0;
          color: #d1fae5;
          font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
        }
        .shell {
          position: relative;
          overflow: hidden;
          aspect-ratio: 16 / 9;
          min-height: 18rem;
          border: 1px solid rgb(52 211 153 / 0.45);
          border-radius: 0.5rem;
          background:
            radial-gradient(circle at 50% 35%, rgb(16 185 129 / 0.13), transparent 45%),
            #080c0b;
          box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.35);
        }
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
        .title { margin: 0; color: white; font-size: 1.1rem; font-weight: 700; }
        .status { margin: 0; max-width: 40rem; color: rgb(209 250 229 / 0.72); font-size: 0.82rem; }
        button {
          border: 1px solid rgb(52 211 153 / 0.8);
          border-radius: 0.25rem;
          padding: 0.6rem 1rem;
          color: #d1fae5;
          background: rgb(6 78 59 / 0.72);
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }
        button:hover { background: rgb(6 95 70 / 0.9); }
        button:focus-visible { outline: 2px solid #34d399; outline-offset: 3px; }
        iframe {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #0a0a12;
        }
        .help {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 0.5rem;
          color: rgb(209 250 229 / 0.55);
          font-size: 0.72rem;
        }
        .help button {
          border: 0;
          padding: 0;
          color: #6ee7b7;
          background: transparent;
          font-size: inherit;
          font-weight: 400;
        }
        @media (max-width: 42rem) {
          .shell { min-height: 14rem; }
          .help { display: block; }
          .help span { display: block; margin-bottom: 0.25rem; }
        }
      </style>
      <div class="shell">
        <div class="prompt">
          <p class="title">Play Lodestone in your browser</p>
          <p class="status">Singleplayer only. The game downloads a large asset bundle after you start it.</p>
          <button type="button">Load game</button>
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
    this.#startButton?.addEventListener('click', () => this.#start());
    shadow
      .querySelector<HTMLButtonElement>('.fullscreen')
      ?.addEventListener('click', () => this.#enterFullscreen());

    if (!('gpu' in navigator)) {
      this.#setUnavailable(
        'WebGPU is unavailable in this browser. Try a current version of Chrome, Edge, Firefox, or Safari.'
      );
    }
  }

  #setUnavailable(message: string) {
    if (this.#status) this.#status.textContent = message;
    if (this.#startButton) {
      this.#startButton.disabled = true;
      this.#startButton.textContent = 'WebGPU unavailable';
    }
  }

  async #start() {
    if (this.#frame) {
      this.#frame.focus();
      return;
    }

    const shell = this.shadowRoot?.querySelector<HTMLElement>('.shell');
    const prompt = this.shadowRoot?.querySelector<HTMLElement>('.prompt');
    if (!shell || !prompt) return;

    if (this.#status) this.#status.textContent = 'Loading the game…';
    if (this.#startButton) this.#startButton.hidden = true;

    const source = this.getAttribute('src') ?? DEFAULT_GAME_URL;
    try {
      const response = await fetch(source, { method: 'HEAD' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      if (this.#status) {
        this.#status.textContent =
          'The game build is temporarily unavailable. Try again later.';
      }
      if (this.#startButton) {
        this.#startButton.hidden = false;
        this.#startButton.textContent = 'Try again';
      }
      return;
    }

    const frame = document.createElement('iframe');
    frame.title = this.getAttribute('title') ?? 'Lodestone singleplayer game';
    frame.allow = 'fullscreen; gamepad';
    frame.allowFullscreen = true;
    frame.src = source;
    frame.addEventListener(
      'load',
      () => {
        prompt.remove();
        frame.focus();
      },
      { once: true }
    );
    frame.addEventListener(
      'error',
      () => {
        if (this.#status) {
          this.#status.textContent =
            'The game could not be loaded. Try refreshing the page.';
        }
        if (this.#startButton) {
          this.#startButton.hidden = false;
          this.#startButton.textContent = 'Try again';
        }
        frame.remove();
        this.#frame = undefined;
      },
      { once: true }
    );

    this.#frame = frame;
    shell.append(frame);
  }

  async #enterFullscreen() {
    const shell = this.shadowRoot?.querySelector<HTMLElement>('.shell');
    if (!shell) return;

    try {
      await shell.requestFullscreen();
      this.#frame?.focus();
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
