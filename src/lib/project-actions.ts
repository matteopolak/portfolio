import './lodestone-game';
import { initializeBaerscriptPlayground } from './baerscript-playground';
import { initializeQuasiPlayground } from './quasi-playground';
import { initializeJaiPlayground } from './jai-playground';

type ProjectActionCallback = (
  trigger: HTMLButtonElement
) => void | Promise<void>;

interface LodestoneGameElement extends HTMLElement {
  start(): Promise<void>;
  focusGame(): void;
  enterFullscreen(): Promise<void>;
}

interface DemoProgressEvent extends CustomEvent {
  detail: { progress: number; message: string };
}

interface CodePlayground {
  prepare(): Promise<void>;
  isReady(): boolean;
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
  const label = loader?.querySelector<HTMLElement>(
    '[data-project-demo-loading-label]'
  );
  if (label) replaceWithInlineCode(label, message);
  progressElement?.setAttribute(
    'aria-valuenow',
    String(Math.round(bounded * 100))
  );
}

export function initializeProjectActions() {
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
    {
      id: 'jai',
      actionId: 'try-jai',
      initialize: initializeJaiPlayground,
    },
  ]
    .map(({ id, actionId, initialize }) => {
      const dialog = document.querySelector<HTMLDialogElement>(
        `[data-project-demo="${id}"]`
      );
      if (!dialog) return undefined;
      return {
        id,
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

  // Every demo shares DemoModal's exit animation; close once it finishes.
  const closeAnimated = (dialog: HTMLDialogElement | null) => {
    if (!dialog?.open || dialog.dataset.closing === 'true') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog.close();
      return;
    }
    dialog.dataset.closing = 'true';
    const finish = () => {
      window.clearTimeout(fallback);
      dialog.removeEventListener('animationend', ended);
      if (dialog.open) dialog.close();
      delete dialog.dataset.closing;
    };
    const ended = (event: AnimationEvent) => {
      if (event.target === dialog) finish();
    };
    const fallback = window.setTimeout(finish, 300);
    dialog.addEventListener('animationend', ended);
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
    game.focusGame();
    void game.start();
  });

  for (const demo of codeDemos) {
    registerProjectAction(demo.actionId, async (trigger) => {
      activeTrigger = trigger;
      const ready = demo.playground.isReady();
      setDemoLoading(
        demo.dialog,
        ready ? 1 : 0,
        ready ? 'Ready' : 'Loading demo…',
        ready ? 'ready' : 'loading'
      );
      document.documentElement.classList.add('has-project-demo');
      demo.dialog.showModal();
      demo.panel?.scrollTo(0, 0);
      try {
        await demo.playground.prepare();
        if (!demo.dialog.open) return;
        setDemoLoading(demo.dialog, 1, 'Ready', 'ready');
        demo.dialog
          .querySelector<HTMLElement>('.cm-content')
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
          if (document.fullscreenElement) void document.exitFullscreen();
          else if (demo.panel) void demo.panel.requestFullscreen();
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

  const getOpenProjectDialog = () =>
    projectDialogs.find((dialog) => dialog.open);
  // `#<project>/try` deep-links the demo modal: opening a demo writes it to
  // the URL, closing restores the plain `#<project>` anchor.
  const openAction = (button: HTMLButtonElement) => {
    const id = button.dataset.projectAction;
    const callback = id ? callbacks.get(id) : undefined;
    if (!callback) return;
    const slug = button.dataset.projectSlug;
    if (slug) history.replaceState(history.state, '', `#${slug}/try`);
    void callback(button);
  };
  const openFromHash = () => {
    const slug = /^#(.+)\/try$/u.exec(location.hash)?.[1];
    if (!slug || getOpenProjectDialog()) return;
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-project-slug]'),
    ].find((candidate) => candidate.dataset.projectSlug === slug);
    if (!button) return;
    document.getElementById(slug)?.scrollIntoView({ block: 'center' });
    openAction(button);
  };
  document
    .querySelectorAll<HTMLButtonElement>('[data-project-action]')
    .forEach((button) => {
      button.addEventListener('click', () => openAction(button), { signal });
    });
  for (const dialog of projectDialogs) {
    dialog.addEventListener(
      'close',
      () => {
        if (location.hash.endsWith('/try'))
          history.replaceState(
            history.state,
            '',
            location.hash.slice(0, -'/try'.length)
          );
      },
      { signal }
    );
  }
  window.addEventListener('hashchange', openFromHash, { signal });

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
  const isModalScrollRegion = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('[data-project-demo-scroll]'));

  // True when some scroll container between the target and its modal scroll
  // region can still move by (dx, dy); otherwise the browser would chain the
  // scroll to the page behind the dialog.
  const canScrollWithin = (
    target: EventTarget | null,
    dx: number,
    dy: number
  ) => {
    if (!(target instanceof Element)) return false;
    const region = target.closest('[data-project-demo-scroll]');
    for (
      let node: Element | null = target;
      node && region?.contains(node);
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      const scrollsY = /auto|scroll/.test(style.overflowY);
      const scrollsX = /auto|scroll/.test(style.overflowX);
      if (
        scrollsY &&
        ((dy < 0 && node.scrollTop > 0) ||
          (dy > 0 &&
            Math.ceil(node.scrollTop + node.clientHeight) < node.scrollHeight))
      )
        return true;
      if (
        scrollsX &&
        ((dx < 0 && node.scrollLeft > 0) ||
          (dx > 0 &&
            Math.ceil(node.scrollLeft + node.clientWidth) < node.scrollWidth))
      )
        return true;
    }
    return false;
  };
  let lastTouch: { x: number; y: number } | undefined;
  window.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      lastTouch = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    },
    { capture: true, passive: true, signal }
  );
  window.addEventListener(
    'wheel',
    (event) => {
      if (
        getOpenProjectDialog() &&
        !canScrollWithin(event.target, event.deltaX, event.deltaY)
      )
        event.preventDefault();
    },
    { capture: true, passive: false, signal }
  );
  window.addEventListener(
    'touchmove',
    (event) => {
      if (!getOpenProjectDialog()) return;
      const touch = event.touches[0];
      const previous = lastTouch;
      lastTouch = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
      // Finger movement is opposite to scroll direction.
      const dx = touch && previous ? previous.x - touch.clientX : 0;
      const dy = touch && previous ? previous.y - touch.clientY : 0;
      if (
        event.touches.length === 1 &&
        isModalScrollRegion(event.target) &&
        canScrollWithin(event.target, dx, dy)
      )
        return;
      if (event.cancelable) event.preventDefault();
    },
    { capture: true, passive: false, signal }
  );
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

  queueMicrotask(openFromHash);

  cleanup = () => {
    controller.abort();
    for (const demo of codeDemos) {
      demo.playground.destroy();
      // Close immediately: a re-initialization may deep-link straight back in.
      if (demo.dialog.open) demo.dialog.close();
    }
    if (minecraftDialog?.open) minecraftDialog.close();
    destroyGame();
  };
}
