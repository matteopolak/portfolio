import './lodestone-game';
import { initializeQuasiPlayground } from './quasi-playground';

type ProjectActionCallback = (
  trigger: HTMLButtonElement
) => void | Promise<void>;

interface LodestoneGameElement extends HTMLElement {
  start(): Promise<void>;
  enterFullscreen(): Promise<void>;
}

const callbacks = new Map<string, ProjectActionCallback>();
let cleanup: (() => void) | undefined;

export function registerProjectAction(
  id: string,
  callback: ProjectActionCallback
) {
  callbacks.set(id, callback);
}

function initializeProjectActions() {
  cleanup?.();

  const controller = new AbortController();
  const { signal } = controller;
  const minecraftDialog = document.querySelector<HTMLDialogElement>(
    '[data-project-demo="minecraft"]'
  );
  const gameHost = minecraftDialog?.querySelector<HTMLElement>(
    '[data-project-demo-game]'
  );
  const quasiDialog = document.querySelector<HTMLDialogElement>(
    '[data-project-demo="quasi"]'
  );
  const quasiPanel = quasiDialog?.querySelector<HTMLElement>(
    '[data-quasi-fullscreen-target]'
  );
  let activeTrigger: HTMLButtonElement | undefined;
  const cleanupQuasi = quasiDialog
    ? initializeQuasiPlayground(quasiDialog, signal)
    : undefined;

  const destroyGame = () => {
    gameHost?.replaceChildren();
    document.documentElement.classList.remove('has-project-demo');
  };

  const closeAnimated = (dialog: HTMLDialogElement | null) => {
    if (!dialog?.open || dialog.dataset.closing === 'true') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog.close();
      return;
    }
    dialog.dataset.closing = 'true';
    window.setTimeout(() => {
      if (dialog.open) dialog.close();
      delete dialog.dataset.closing;
    }, 170);
  };

  const closeMinecraft = () => {
    closeAnimated(minecraftDialog ?? null);
  };

  const closeQuasi = () => {
    closeAnimated(quasiDialog ?? null);
  };

  registerProjectAction('play-minecraft', async (trigger) => {
    if (!minecraftDialog || !gameHost) return;

    activeTrigger = trigger;
    const game = document.createElement(
      'lodestone-game'
    ) as LodestoneGameElement;
    game.setAttribute('mode', 'modal');
    gameHost.replaceChildren(game);
    document.documentElement.classList.add('has-project-demo');
    minecraftDialog.showModal();
    void game.start();
  });

  registerProjectAction('try-quasi', (trigger) => {
    if (!quasiDialog) return;
    activeTrigger = trigger;
    document.documentElement.classList.add('has-project-demo');
    quasiDialog.showModal();
    quasiPanel?.scrollTo(0, 0);
    quasiDialog
      .querySelector<HTMLTextAreaElement>('[data-quasi-source]')
      ?.focus({ preventScroll: true });
  });

  document
    .querySelectorAll<HTMLButtonElement>('[data-project-action]')
    .forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          const id = button.dataset.projectAction;
          const callback = id ? callbacks.get(id) : undefined;
          if (callback) void callback(button);
        },
        { signal }
      );
    });

  minecraftDialog
    ?.querySelector<HTMLButtonElement>('[data-project-demo-close]')
    ?.addEventListener('click', closeMinecraft, { signal });
  minecraftDialog
    ?.querySelector<HTMLButtonElement>('[data-project-demo-fullscreen]')
    ?.addEventListener(
      'click',
      () => {
        const game =
          gameHost?.querySelector<LodestoneGameElement>('lodestone-game');
        if (game) void game.enterFullscreen();
      },
      { signal }
    );
  minecraftDialog?.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      closeMinecraft();
    },
    { signal }
  );
  minecraftDialog?.addEventListener(
    'click',
    (event) => {
      if (event.target === minecraftDialog) closeMinecraft();
    },
    { signal }
  );
  minecraftDialog?.addEventListener(
    'close',
    () => {
      destroyGame();
      activeTrigger?.focus();
      activeTrigger = undefined;
    },
    { signal }
  );

  quasiDialog
    ?.querySelector<HTMLButtonElement>('[data-quasi-close]')
    ?.addEventListener('click', closeQuasi, { signal });
  quasiDialog
    ?.querySelector<HTMLButtonElement>('[data-quasi-fullscreen]')
    ?.addEventListener(
      'click',
      () => {
        if (quasiPanel) void quasiPanel.requestFullscreen();
      },
      { signal }
    );
  quasiDialog?.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      closeQuasi();
    },
    { signal }
  );
  quasiDialog?.addEventListener(
    'click',
    (event) => {
      if (event.target === quasiDialog) closeQuasi();
    },
    { signal }
  );
  quasiDialog?.addEventListener(
    'close',
    () => {
      cleanupQuasi?.();
      document.documentElement.classList.remove('has-project-demo');
      activeTrigger?.focus();
      activeTrigger = undefined;
    },
    { signal }
  );

  cleanup = () => {
    controller.abort();
    cleanupQuasi?.();
    closeMinecraft();
    closeQuasi();
    destroyGame();
  };
}

document.addEventListener('astro:page-load', initializeProjectActions);
initializeProjectActions();
