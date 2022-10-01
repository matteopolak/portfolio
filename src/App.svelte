<script lang="ts">
	import 'agnostic-svelte/css/common.min.css';
	import { fly } from 'svelte/transition';
	import { ButtonGroup } from 'agnostic-svelte';
	import GitHubLogo from './assets/github-logo.svg';
	import LinkedInLogo from './assets/linkedin-logo.svg';
	import DownArrowSvg from './assets/down-arrow.svg';
	import Separator from './lib/Separator.svelte';
	import { onMount } from 'svelte';
	import ButtonLink from './lib/ButtonLink.svelte';
	import BaerScriptProject from './lib/projects/BaerScriptProject.svelte';
	import StockPredictProject from './lib/projects/StockPredictProject.svelte';
	import JukeboxProject from './lib/projects/JukeboxProject.svelte';
	import TheArchonProject from './lib/projects/TheArchonProject.svelte';
	import PasswordProject from './lib/projects/PasswordProject.svelte';

	let hash = Math.floor(Date.now() / 86_400_000);
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
						<img src={GitHubLogo} alt="GitHub logo" class="button" />GitHub
					</ButtonLink>
					<ButtonLink
						klass="grouped"
						href="https://linkedin.com/in/matteo-polak"
						mode="linkedin"
					>
						<img
							src={LinkedInLogo}
							alt="LinkedIn logo"
							class="button"
						/>LinkedIn
					</ButtonLink>
				</ButtonGroup>
			</div>
		</section>
		<ButtonLink
			style="position: absolute; bottom: 10vh;"
			href="#projects"
			mode="blank"
			target="_self"
			><img
				src={DownArrowSvg}
				alt="Down arrow"
				class="move-hover"
			/></ButtonLink
		>
		<Separator --padding="100vh" />
		<section id="projects">
			<BaerScriptProject {hash} />
			<StockPredictProject {hash} />
			<JukeboxProject {hash} />
			<PasswordProject {hash} />
			<TheArchonProject {hash} />
		</section>
	{/if}
	<section>
		<div class="footer">
			<p>© Copyright 2022 Matthew Polak. All right reserved.</p>
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

	.wrapper {
		display: inline-block;
		font-weight: 700;
		letter-spacing: -0.2em;
		line-height: 1em;
	}

	:global(.button) {
		margin-right: 0.5em;
	}

	:global(.grouped:not(:first-of-type)) {
		padding-left: 0.5em;
	}

	:global(.project) {
		padding-bottom: 3em;
		padding-top: 3em;
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
		font-size: 1em;
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
