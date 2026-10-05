export function initializeWorkspaceLayout(panel, signal) {
  for (const handle of panel.querySelectorAll('[data-code-resize]')) {
    const vertical = handle.dataset.codeResize === 'files';
    const host = vertical ? panel : panel.querySelector('.code-workspace');
    const property = vertical ? '--files-width' : '--terminal-height';
    const clamp = (value) => {
      const size = vertical ? panel.clientWidth : host.clientHeight;
      return Math.max(
        vertical ? 90 : 72,
        Math.min(value, size - (vertical ? 160 : 140))
      );
    };
    const current = () =>
      vertical
        ? panel.querySelector('.code-files').getBoundingClientRect().width
        : panel.querySelector('.code-bottom').getBoundingClientRect().height;
    const set = (value) => {
      const bounded = clamp(value);
      host.style.setProperty(property, `${bounded}px`);
      handle.setAttribute('aria-valuenow', String(Math.round(bounded)));
      handle.setAttribute(
        'aria-valuemax',
        String(
          Math.max(
            vertical ? 90 : 72,
            (vertical ? panel.clientWidth : host.clientHeight) -
              (vertical ? 160 : 140)
          )
        )
      );
    };
    let start, size;
    handle.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start = vertical ? event.clientX : event.clientY;
        size = current();
        handle.setPointerCapture(event.pointerId);
        panel.classList.add('resizing');
      },
      { signal }
    );
    handle.addEventListener(
      'pointermove',
      (event) => {
        if (start === undefined) return;
        const delta = (vertical ? event.clientX : event.clientY) - start;
        set(size + (vertical ? delta : -delta));
      },
      { signal }
    );
    const finish = () => {
      start = undefined;
      panel.classList.remove('resizing');
    };
    handle.addEventListener('pointerup', finish, { signal });
    handle.addEventListener('pointercancel', finish, { signal });
    handle.addEventListener('lostpointercapture', finish, { signal });
    handle.addEventListener(
      'keydown',
      (event) => {
        const change = vertical
          ? { ArrowLeft: -16, ArrowRight: 16 }
          : { ArrowUp: 16, ArrowDown: -16 };
        if (change[event.key] === undefined) return;
        event.preventDefault();
        set(current() + change[event.key]);
      },
      { signal }
    );
  }
  signal.addEventListener('abort', () => panel.classList.remove('resizing'), {
    once: true,
  });
}
