<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultTheme, nextTheme, type Theme } from '../../lib/themes';
  import {
    applyTheme,
    chooseTheme,
    currentTheme,
    SITE_THEME_EVENT,
  } from '../../lib/theme-client';

  let shuffling = $state(false);
  let theme = $state<Theme>(defaultTheme);
  let timer = 0;

  const apply = (next: Theme) => {
    applyTheme(next);
    theme = next;
  };

  const cycle = () => {
    chooseTheme(nextTheme(theme.id));

    // Restart the CSS animation if it is already running.
    shuffling = false;
    window.clearTimeout(timer);
    requestAnimationFrame(() => {
      shuffling = true;
      timer = window.setTimeout(() => (shuffling = false), 500);
    });
  };

  // Another caller (the WebMCP `set_theme` tool) changed the theme.
  const follow = (event: Event) => {
    theme = (event as CustomEvent<{ theme: Theme }>).detail.theme;
  };

  // The island persists across ClientRouter navigations (transition:persist),
  // but the new page's logo marks are fresh DOM and need the theme again.
  const reapply = () => apply(currentTheme());

  onMount(() => {
    reapply();
    document.addEventListener('astro:page-load', reapply);
    document.addEventListener(SITE_THEME_EVENT, follow);
    return () => {
      document.removeEventListener('astro:page-load', reapply);
      document.removeEventListener(SITE_THEME_EVENT, follow);
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
    border-radius: var(--radius-sm);
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
