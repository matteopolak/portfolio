<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    headings: { depth: number; slug: string; text: string }[];
  }

  const { headings }: Props = $props();
  const filtered = $derived(headings.filter((heading) => heading.depth <= 3));

  let progress = $state(0);
  let visible = $state<Set<string>>(new Set());

  // Styling lives in the global `.toc*` rules (src/styles/global.css). The
  // list is server-rendered; this only tracks scroll position.
  onMount(() => {
    const article = document.querySelector<HTMLElement>('article.prose');
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('article h2, article h3')
    );
    if (!article || sections.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = article.getBoundingClientRect();
      const top = bounds.top + window.scrollY;
      const end = Math.max(
        top + 1,
        bounds.bottom + window.scrollY - window.innerHeight
      );
      progress = Math.min(
        100,
        Math.max(0, ((window.scrollY - top) / (end - top)) * 100)
      );

      const viewportTop = 96;
      const next = new Set<string>();
      sections.forEach((heading, index) => {
        const sectionTop = heading.getBoundingClientRect().top;
        const following = sections[index + 1];
        const sectionBottom = following
          ? following.getBoundingClientRect().top
          : bounds.bottom;
        if (sectionBottom > viewportTop && sectionTop < window.innerHeight) {
          next.add(heading.id);
        }
      });
      visible = next;
    };

    const request = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    update();

    return () => {
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      if (frame) window.cancelAnimationFrame(frame);
    };
  });
</script>

{#if filtered.length > 0}
  <nav id="toc" class="toc" aria-label="Table of contents">
    <p class="toc__label">On this page</p>
    <div class="toc__bar">
      <div
        id="toc-progress"
        class="toc__progress"
        style:width="{progress}%"
      ></div>
    </div>
    <ul>
      {#each filtered as heading (heading.slug)}
        <li style:padding-left="{(heading.depth - 2) * 0.65}rem">
          <a
            href="#{heading.slug}"
            data-toc-id={heading.slug}
            class:is-visible={visible.has(heading.slug)}
            aria-current={visible.has(heading.slug) ? 'location' : undefined}
          >
            {heading.text}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
