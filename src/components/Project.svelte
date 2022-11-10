<script lang="ts">
	import { inview } from 'svelte-inview';
	import { fly } from 'svelte/transition';
	import { create_in_transition } from 'svelte/internal';
	import type { Options, ObserverEventDetails } from 'svelte-inview';
	import Separator from './Separator.svelte';

	export let src = '';
	export let href = '';
	export let alt = '';
	export let index = 0;

	let inView: boolean = false;
	let element;

	const handleChange = ({ detail }: CustomEvent<ObserverEventDetails>) => {
		if (detail.inView) {
			inView = true;

			create_in_transition(element, fly, {
				x: ((index % 2) * 2 - 1) * 200,
				duration: 500,
			}).start();
		}
	};
</script>

<div bind:this={element} class="project wrapper" on:change={handleChange}>
	<a {href}>
		<img {src} {alt} width="50%" class="preview" />
	</a>
	<slot />
</div>

<style>
	.preview {
		border-radius: 10px;
		float: left;
	}

	.wrapper {
		max-width: 70em;
		margin-left: auto;
		margin-right: auto;
		overflow: auto;
		background-color: var(--colour-secondary);
	}
</style>
