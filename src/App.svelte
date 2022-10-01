<script lang="ts">
	import 'agnostic-svelte/css/common.min.css';
	import { fly } from 'svelte/transition';
	import { ButtonGroup, Tabs } from 'agnostic-svelte';
	import GitHubLogo from './assets/github-logo.svg';
	import LinkedInLogo from './assets/linkedin-logo.svg';
	import DownArrowSvg from './assets/down-arrow.svg';
	import Separator from './lib/Separator.svelte';
	import { onMount } from 'svelte';
	import ButtonLink from './lib/ButtonLink.svelte';
	import RustTab from './lib/tabs/RustTab.svelte';

	let ready = false;
	onMount(() => (ready = true));
</script>

<main>
	{#if ready}
		<section class="vertical">
			<div class="wrapper">
				<h3
					transition:fly={{ y: 10, duration: 500, delay: 250 }}
					class="text-left"
				>
					Hey there, I'm
				</h3>
				<h1
					transition:fly={{ y: 10, duration: 1_000, delay: 500 }}
					class="gradient text-center"
				>
					Matthew Polak
				</h1>
			</div>
			<Separator --padding="1em" />
			<div transition:fly={{ y: 10, duration: 1_000, delay: 1_000 }}>
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
						<img
							src={LinkedInLogo}
							alt="LinkedIn Logo"
							class="button"
						/>LinkedIn
					</ButtonLink>
				</ButtonGroup>
			</div>
		</section>
		<ButtonLink
			style="position: absolute; bottom: 10vh;"
			href="#languages"
			mode="blank"
			target="_self"
			><img
				src={DownArrowSvg}
				alt="Down arrow"
				class="move-hover"
			/></ButtonLink
		>
		<Separator --padding="100vh" />
		<section id="languages" class="tabs horizontal">
			<Tabs
				tabs={[
					{
						title: 'Rust',
						ariaControls: 'rust',
						tabPanelComponent: RustTab,
					},
				]}
			/>
		</section>
	{/if}
	<section>
		<div class="footer">
			<p>© 2022 Matthew Polak</p>
		</div>
	</section>
</main>

<style>
	:global(.btn-github) {
		background-color: var(--github-primary) !important;
	}

	:global(.btn-linkedin) {
		background-color: var(--linkedin-primary) !important;
	}

	:global(.tab) {
		max-width: 50vw;
		text-align: left;
	}

	.wrapper {
		display: inline-block;
	}

	.button {
		padding-right: 0.5em;
	}

	.tabs {
		max-width: 50vw;
	}

	:global(.grouped:not(:first-of-type)) {
		padding-left: 0.5em;
	}

	.move-hover {
		transition: top ease 0.5s;
		top: 0;
		position: relative;
	}

	.move-hover:hover {
		top: 3px;
	}

	.footer {
		background-color: var(--color-secondary);
		width: 100vw;
		padding: 2.5vh;
		text-align: center;
		font-size: 1.2em;
	}

	.gradient {
		background: linear-gradient(90deg, #34eba2, #ebe134, #ebb734);
		background-clip: text;
		-webkit-text-fill-color: transparent;
		-webkit-background-clip: text;
	}

	.vertical {
		transform: translateY(calc(50vh - 50%));
	}

	.horizontal {
		transform: translateX(calc(50vw - 50%));
	}

	h1.text-center {
		text-align: center;
	}

	h3.text-left {
		text-align: left;
	}

	h1 {
		margin-bottom: 0;
		margin-top: 0;
		text-align: left;
		font-size: 8em;
	}

	h3 {
		margin-bottom: 0;
		text-align: left;
		font-size: 3em;
	}
</style>
