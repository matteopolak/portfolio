<script lang="ts">
  import { onMount } from 'svelte';
  import {
    defaultTheme,
    nextTheme,
    THEME_STORAGE_KEY,
    themeById,
    type Theme,
  } from '../../lib/themes';

  let shuffling = $state(false);
  let theme = $state<Theme>(defaultTheme);
  let timer = 0;

  const currentTheme = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* Blocked storage: the choice lasts for this page. */
    }
    return (
      themeById(document.documentElement.dataset.siteTheme ?? saved) ??
      defaultTheme
    );
  };

  // The logo marks get their fill directly: an inherited registered colour that
  // animates inside an SVG mask can drop paint, so the CSS variables are not used for them.
  const paintMarks = (next: Theme) => {
    next.accents.forEach((accent, index) => {
      document
        .querySelectorAll<SVGElement>(`.mark-${index + 1}`)
        .forEach((element) => {
          element.style.fill = accent.fill;
        });
    });
  };

  const apply = (next: Theme) => {
    const root = document.documentElement;
    if (next === defaultTheme) delete root.dataset.siteTheme;
    else root.dataset.siteTheme = next.id;
    paintMarks(next);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', next.paper);
    theme = next;
  };

  const cycle = () => {
    const next = nextTheme(theme.id);
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next.id);
    } catch {
      /* Blocked storage: the choice lasts for this page. */
    }

    // Restart the CSS animation if it is already running.
    shuffling = false;
    window.clearTimeout(timer);
    requestAnimationFrame(() => {
      shuffling = true;
      timer = window.setTimeout(() => (shuffling = false), 500);
    });
  };

  // The island persists across ClientRouter navigations (transition:persist),
  // but the new page's logo marks are fresh DOM and need the theme again.
  const reapply = () => apply(currentTheme());

  onMount(() => {
    reapply();
    document.addEventListener('astro:page-load', reapply);
    return () => {
      document.removeEventListener('astro:page-load', reapply);
      window.clearTimeout(timer);
    };
  });
</script>

<button
  class="site-nav__palette"
  class:is-shuffling={shuffling}
  type="button"
  aria-label="Theme: {theme.name} — switch theme"
  title="Theme: {theme.name} — switch theme"
  data-palette-generator
  onclick={cycle}
>
  <span class="palette-dot palette-dot--1"></span>
  <span class="palette-dot palette-dot--2"></span>
  <span class="palette-dot palette-dot--3"></span>
</button>

<style>
  .site-nav__palette {
    position: absolute;
    top: 50%;
    right: calc(100% + 0.85rem);
    display: none;
    align-items: center;
    gap: 0.32rem;
    padding: 0.65rem 0.45rem;
    border: 0;
    background: transparent;
    transform: translateY(-50%);
    cursor: pointer;
  }

  .palette-dot {
    display: block;
    width: 0.62rem;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--ink);
  }

  .palette-dot--1 {
    background: var(--accent-1);
  }

  .palette-dot--2 {
    background: var(--accent-2);
  }

  .palette-dot--3 {
    background: var(--accent-3);
  }

  .site-nav__palette:hover .palette-dot {
    transform: translateY(-0.16rem);
  }

  .site-nav__palette:hover .palette-dot:nth-child(2) {
    transform: translateY(0.16rem);
  }

  .site-nav__palette.is-shuffling .palette-dot {
    animation: palette-pop 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .site-nav__palette.is-shuffling .palette-dot:nth-child(2) {
    animation-delay: 45ms;
  }

  .site-nav__palette.is-shuffling .palette-dot:nth-child(3) {
    animation-delay: 90ms;
  }

  @keyframes palette-pop {
    50% {
      transform: translateY(-0.35rem) scale(1.25);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .site-nav__palette.is-shuffling .palette-dot {
      animation: none;
    }
  }

  @media (min-width: 80rem) {
    .site-nav__palette {
      display: flex;
    }
  }
</style>
