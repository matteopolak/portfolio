/*
 * Starts the blog `<Playground>` embeds (see components/Playground.astro).
 * This module is tiny on purpose: it ships with every post that has an
 * embed, and everything heavy (the Lodestone engine, the CodeWorkspace
 * bundle, the language runtimes and their wasm) is a dynamic import that only
 * runs after a reader presses Start.
 */
interface LodestoneGameElement extends HTMLElement {
  start(): Promise<void>;
  focusGame(): void;
  enterFullscreen(): Promise<void>;
}

interface Running {
  destroy(): void;
}

const running = new Set<Running>();

async function startMinecraft(
  stage: HTMLElement,
  signal: AbortSignal
): Promise<Running> {
  await import('./lodestone-game');
  if (signal.aborted) return { destroy() {} };
  const game = document.createElement('lodestone-game') as LodestoneGameElement;
  game.setAttribute('mode', 'modal');
  stage.replaceChildren(game);
  game.focusGame();
  void game.start();
  const fullscreen = stage.parentElement?.querySelector<HTMLButtonElement>(
    '[data-playground-embed-fullscreen]'
  );
  if (fullscreen) {
    fullscreen.hidden = false;
    fullscreen.addEventListener('click', () => void game.enterFullscreen(), {
      signal,
    });
  }
  return { destroy: () => stage.replaceChildren() };
}

async function startCode(
  id: string,
  props: Record<string, unknown>,
  stage: HTMLElement,
  signal: AbortSignal
): Promise<Running> {
  const [{ mount, unmount }, { default: CodeWorkspace }, demos, runTarget] =
    await Promise.all([
      import('svelte'),
      import('../components/svelte/CodeWorkspace.svelte'),
      import('./code-demos'),
      import('./run-target'),
    ]);
  const demo = demos.codeDemos.find((candidate) => candidate.id === id);
  if (signal.aborted || !demo) return { destroy() {} };
  const component = mount(CodeWorkspace, {
    target: stage,
    props: { ...props, language: demo.id, mode: 'embed' } as never,
  });
  const panel = stage.querySelector<HTMLElement>('[data-code-workspace]');
  demos.watchDemoLoading(stage, signal);
  demos.wireFullscreen(stage, panel, signal);
  const playground = demo.initialize(stage, signal);
  const target = demos.runTargetFor(demo.id, playground);
  const unregister = target ? runTarget.registerRunTarget(target) : undefined;
  demos.setDemoLoading(stage, 0, 'Loading playground…');
  playground.prepare().then(
    () => {
      if (!signal.aborted) demos.setDemoLoading(stage, 1, 'Ready', 'ready');
    },
    () => {
      // The loader shows the demo's own error event.
    }
  );
  return {
    destroy() {
      unregister?.();
      playground.destroy();
      void unmount(component);
    },
  };
}

function wire(embed: HTMLElement) {
  const button = embed.querySelector<HTMLButtonElement>(
    '[data-playground-embed-start]'
  );
  const stage = embed.querySelector<HTMLElement>(
    '[data-playground-embed-stage]'
  );
  const status = embed.querySelector<HTMLElement>(
    '[data-playground-embed-status]'
  );
  if (!button || !stage || embed.dataset.playgroundEmbedState) return;
  embed.dataset.playgroundEmbedState = 'idle';
  const controller = new AbortController();
  const { signal } = controller;
  let instance: Running | undefined;
  const teardown = () => {
    controller.abort();
    if (instance) running.delete(instance);
    instance?.destroy();
    instance = undefined;
  };
  button.addEventListener(
    'click',
    () => {
      embed.dataset.playgroundEmbedState = 'running';
      button.disabled = true;
      if (status) status.textContent = 'Loading…';
      const name = embed.dataset.playgroundEmbed ?? '';
      const props = JSON.parse(embed.dataset.playgroundEmbedProps ?? '{}');
      const start =
        name === 'minecraft'
          ? startMinecraft(stage, signal)
          : startCode(name, props, stage, signal);
      start.then(
        (started) => {
          if (signal.aborted) return started.destroy();
          instance = started;
          running.add(started);
          embed.dataset.playgroundEmbedState = 'started';
          embed.querySelector('[data-playground-embed-card]')?.remove();
          stage.hidden = false;
        },
        () => {
          embed.dataset.playgroundEmbedState = 'idle';
          button.disabled = false;
          if (status)
            status.textContent = 'Couldn’t start. Press play to retry.';
        }
      );
    },
    { signal }
  );
  // The embed leaves with the page (ClientRouter swap or a real unload), so its
  // workers, audio and wasm cannot outlive it.
  document.addEventListener('astro:before-swap', teardown, { once: true });
  window.addEventListener(
    'pagehide',
    (event) => {
      if (!event.persisted) teardown();
    },
    { once: true }
  );
}

export function initializePlaygroundEmbeds() {
  for (const embed of document.querySelectorAll<HTMLElement>(
    '[data-playground-embed]'
  ))
    wire(embed);
}
