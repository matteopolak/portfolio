let removeTocListeners: (() => void) | undefined;

function initializeToc() {
  removeTocListeners?.();
  removeTocListeners = undefined;

  const toc = document.querySelector<HTMLElement>('#toc');
  const article = document.querySelector<HTMLElement>('article.prose');
  const progress = document.querySelector<HTMLElement>('#toc-progress');
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('[data-toc-id]')
  );
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>('article h2, article h3')
  );
  if (!toc || !article || !progress || headings.length === 0) return;

  const controller = new AbortController();
  let frame = 0;

  const updateToc = () => {
    frame = 0;
    const articleBounds = article.getBoundingClientRect();
    const articleTop = articleBounds.top + window.scrollY;
    const articleBottom = articleBounds.bottom + window.scrollY;
    const progressEnd = Math.max(
      articleTop + 1,
      articleBottom - window.innerHeight
    );
    const percentage = Math.min(
      100,
      Math.max(
        0,
        ((window.scrollY - articleTop) / (progressEnd - articleTop)) * 100
      )
    );
    progress.style.width = `${percentage}%`;

    const viewportTop = 96;
    const viewportBottom = window.innerHeight;
    const visibleIds = new Set<string>();
    headings.forEach((heading, index) => {
      const sectionTop = heading.getBoundingClientRect().top;
      const nextHeading = headings[index + 1];
      const sectionBottom = nextHeading
        ? nextHeading.getBoundingClientRect().top
        : article.getBoundingClientRect().bottom;
      if (sectionBottom > viewportTop && sectionTop < viewportBottom) {
        visibleIds.add(heading.id);
      }
    });

    links.forEach((link) => {
      const isVisible = visibleIds.has(link.dataset.tocId ?? '');
      link.classList.toggle('is-visible', isVisible);
      if (isVisible) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  const requestUpdate = () => {
    if (!frame) frame = window.requestAnimationFrame(updateToc);
  };
  window.addEventListener('scroll', requestUpdate, {
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener('resize', requestUpdate, {
    passive: true,
    signal: controller.signal,
  });
  updateToc();

  removeTocListeners = () => {
    controller.abort();
    if (frame) window.cancelAnimationFrame(frame);
  };
}

document.addEventListener('astro:page-load', initializeToc);
initializeToc();
