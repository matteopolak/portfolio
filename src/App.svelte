<script lang="ts">
	import 'agnostic-svelte/css/common.min.css';
	import { fly } from 'svelte/transition';
	import { ButtonGroup } from 'agnostic-svelte';
	import GitHubLogo from './assets/github-logo.svg';
	import LinkedInLogo from './assets/linkedin-logo.svg';
	import Separator from './lib/Separator.svelte';
	import { onMount } from 'svelte';
	import ButtonLink from './lib/ButtonLink.svelte';

	let ready = false;
	onMount(() => (ready = true));
</script>

<main>
	{#if ready}
		<h3 transition:fly={{ y: 10, duration: 1_000, delay: 250 }}>
			Hey there, I'm
		</h3>
		<h1
			transition:fly={{ y: 10, duration: 1_000, delay: 300 }}
			class="gradient"
		>
			Matthew Polak
		</h1>

		<Separator />
		<ButtonGroup ariaLabel="Social connections">
			<ButtonLink
				klass="grouped"
				href="https://github.com/matteopolak"
				mode="github"
			>
				<img src={GitHubLogo} alt="GitHub Logo" class="button" />GitHub
			</ButtonLink>
			<ButtonLink
				klass="grouped"
				href="https://linkedin.com/in/matteo-polak"
				mode="linkedin"
			>
				<img src={LinkedInLogo} alt="LinkedIn Logo" class="button" />LinkedIn
			</ButtonLink>
		</ButtonGroup>
	{/if}
</main>

<style>
	:global(.btn-github) {
		background-color: var(--github-primary) !important;
	}

	:global(.btn-linkedin) {
		background-color: var(--linkedin-primary) !important;
	}

	.button {
		padding-right: 0.5em;
	}

	:global(.grouped:not(:first-of-type)) {
		padding-left: 0.5em;
	}

	.gradient {
		background: linear-gradient(90deg, #34eba2, #ebe134, #ebb734);
		background-clip: text;
		-webkit-text-fill-color: transparent;
		-webkit-background-clip: text;
	}

	h1 {
		margin-bottom: 0;
		margin-top: 0;
		text-align: left;
		font-size: 6em;
	}

	h3 {
		margin-bottom: 0;
		text-align: left;
		font-size: 2em;
	}
</style>
