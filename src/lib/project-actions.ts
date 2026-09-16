import './lodestone-game';
import { initializeBaerscriptPlayground } from './baerscript-playground';
import { initializeQuasiPlayground } from './quasi-playground';

type ProjectActionCallback = (
  trigger: HTMLButtonElement
) => void | Promise<void>;

interface LodestoneGameElement extends HTMLElement {
  start(): Promise<void>;
  enterFullscreen(): Promise<void>;
}

interface DemoProgressEvent extends CustomEvent {
  detail: { progress: number; message: string };
}

interface CodePlayground {
  prepare(): Promise<void>;
  destroy(): void;
}

const callbacks = new Map<string, ProjectActionCallback>();
let cleanup: (() => void) | undefined;

export function registerProjectAction(
  id: string,
  callback: ProjectActionCallback
) {
  callbacks.set(id, callback);
}

function setDemoLoading(
  dialog: HTMLDialogElement,
  progress: number,
  message: string,
  state: 'loading' | 'ready' | 'error' = 'loading'
) {
  const bounded = Math.max(0, Math.min(1, progress));
  dialog.dataset.demoState = state;
  const loader = dialog.querySelector<HTMLElement>(
    '[data-project-demo-loading]'
  );
  const progressElement = dialog.querySelector<HTMLElement>(
    '[data-project-demo-loading-progress]'
  );
  loader?.setAttribute('data-state', state);
  loader
    ?.querySelector<HTMLElement>('[data-project-demo-loading-label]')
    ?.replaceChildren(message);
  loader?.style.setProperty('--project-demo-progress', String(bounded));
  progressElement?.setAttribute(
    'aria-valuenow',
    String(Math.round(bounded * 100))
  );
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
  const projectDialogs = [
    ...document.querySelectorAll<HTMLDialogElement>('[data-project-demo]'),
  ];
  let activeTrigger: HTMLButtonElement | undefined;
  const codeDemos = [
    {
      id: 'quasi',
      actionId: 'try-quasi',
      initialize: initializeQuasiPlayground,
    },
    {
      id: 'baerscript',
      actionId: 'try-baerscript',
      initialize: initializeBaerscriptPlayground,
    },
  ]
    .map(({ id, actionId, initialize }) => {
      const dialog = document.querySelector<HTMLDialogElement>(
        `[data-project-demo="${id}"]`
      );
      if (!dialog) return undefined;
      return {
        actionId,
        dialog,
        panel: dialog.querySelector<HTMLElement>(
          '[data-code-fullscreen-target]'
        ),
        playground: initialize(dialog, signal) as CodePlayground,
      };
    })
    .filter((demo) => demo !== undefined);

  for (const dialog of projectDialogs) {
    dialog.addEventListener(
      'project-demo-progress',
      (event) => {
        const { progress, message } = (event as DemoProgressEvent).detail;
        setDemoLoading(dialog, progress, message);
      },
      { signal }
    );
    dialog.addEventListener(
      'project-demo-ready',
      () => setDemoLoading(dialog, 1, 'Ready', 'ready'),
      { signal }
    );
    dialog.addEventListener(
      'project-demo-error',
      (event) => {
        const message = (event as CustomEvent<{ message: string }>).detail
          .message;
        setDemoLoading(dialog, 1, message, 'error');
      },
      { signal }
    );
  }

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

  registerProjectAction('play-minecraft', async (trigger) => {
    if (!minecraftDialog || !gameHost) return;

    activeTrigger = trigger;
    const game = document.createElement(
      'lodestone-game'
    ) as LodestoneGameElement;
    game.setAttribute('mode', 'modal');
    setDemoLoading(minecraftDialog, 0, 'Loading demo…');
    gameHost.replaceChildren(game);
    document.documentElement.classList.add('has-project-demo');
    minecraftDialog.showModal();
    void game.start();
  });

  for (const demo of codeDemos) {
    registerProjectAction(demo.actionId, async (trigger) => {
      activeTrigger = trigger;
      setDemoLoading(demo.dialog, 0, 'Loading demo…');
      document.documentElement.classList.add('has-project-demo');
      demo.dialog.showModal();
      demo.panel?.scrollTo(0, 0);
      try {
        await demo.playground.prepare();
        if (!demo.dialog.open) return;
        demo.dialog
          .querySelector<HTMLTextAreaElement>('[data-code-source]')
          ?.focus({ preventScroll: true });
      } catch {
        // The shared modal loader receives the worker's error event.
      }
    });

    demo.dialog
      .querySelector<HTMLButtonElement>('[data-code-close]')
      ?.addEventListener('click', () => closeAnimated(demo.dialog), { signal });
    demo.dialog
      .querySelector<HTMLButtonElement>('[data-code-fullscreen]')
      ?.addEventListener(
        'click',
        () => {
          if (demo.panel) void demo.panel.requestFullscreen();
        },
        { signal }
      );
    demo.dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        closeAnimated(demo.dialog);
      },
      { signal }
    );
    demo.dialog.addEventListener(
      'click',
      (event) => {
        if (event.target === demo.dialog) closeAnimated(demo.dialog);
      },
      { signal }
    );
    demo.dialog.addEventListener(
      'close',
      () => {
        demo.playground.destroy();
        document.documentElement.classList.remove('has-project-demo');
        activeTrigger?.focus();
        activeTrigger = undefined;
      },
      { signal }
    );
  }

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
  const getOpenProjectDialog = () =>
    projectDialogs.find((dialog) => dialog.open);
  const isModalScrollRegion = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('[data-project-demo-scroll]'));

  for (const eventName of ['wheel', 'touchmove'] as const) {
    window.addEventListener(
      eventName,
      (event) => {
        if (getOpenProjectDialog() && !isModalScrollRegion(event.target)) {
          event.preventDefault();
        }
      },
      { capture: true, passive: false, signal }
    );
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        getOpenProjectDialog() &&
        !isModalScrollRegion(event.target) &&
        [
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'End',
          'Home',
          'PageDown',
          'PageUp',
          'Space',
        ].includes(event.code)
      ) {
        event.preventDefault();
      }
    },
    { capture: true, signal }
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

  cleanup = () => {
    controller.abort();
    for (const demo of codeDemos) {
      demo.playground.destroy();
      closeAnimated(demo.dialog);
    }
    closeMinecraft();
    destroyGame();
  };
}

document.addEventListener('astro:page-load', initializeProjectActions);
initializeProjectActions();
