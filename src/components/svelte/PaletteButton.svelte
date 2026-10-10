<script lang="ts">
  import { onMount } from 'svelte';
  import { generatePalette, type GeneratedPalette } from '../../lib/palette';

  type PaletteWindow = Window &
    typeof globalThis & { bauhausPalette?: GeneratedPalette };

  let shuffling = $state(false);
  let timer = 0;

  const applyPalette = (palette: GeneratedPalette) => {
    const root = document.documentElement;
    root.style.setProperty('--red', palette.red);
    root.style.setProperty('--blue', palette.blue);
    root.style.setProperty('--yellow', palette.yellow);

    for (const [selector, color] of [
      ['.mark-red', palette.red],
      ['.mark-blue', palette.blue],
      ['.mark-yellow', palette.yellow],
    ] as const) {
      document.querySelectorAll<SVGElement>(selector).forEach((element) => {
        element.style.fill = color;
      });
    }
  };

  const reapply = () => {
    const palette = (window as PaletteWindow).bauhausPalette;
    if (palette) applyPalette(palette);
  };

  const shuffle = () => {
    const palette = generatePalette();
    (window as PaletteWindow).bauhausPalette = palette;
    applyPalette(palette);

    // Restart the CSS animation if it is already running.
    shuffling = false;
    window.clearTimeout(timer);
    requestAnimationFrame(() => {
      shuffling = true;
      timer = window.setTimeout(() => (shuffling = false), 500);
    });
  };

  // The island persists across ClientRouter navigations (transition:persist),
  // but the new page's logo marks are fresh DOM and need the palette again.
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
  aria-label="Generate a new color palette"
  title="Generate a new color palette"
  data-palette-generator
  onclick={shuffle}
>
  <span class="palette-dot palette-dot--red"></span>
  <span class="palette-dot palette-dot--blue"></span>
  <span class="palette-dot palette-dot--yellow"></span>
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

  .palette-dot--red {
    background: var(--red);
  }

  .palette-dot--blue {
    background: var(--blue);
  }

  .palette-dot--yellow {
    background: var(--yellow);
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

  @media (min-width: 80rem) {
    .site-nav__palette {
      display: flex;
    }
  }
</style>
