<script lang="ts">
	import 'agnostic-svelte/css/common.min.css';
	import { fly } from 'svelte/transition';
	import {
		ButtonGroup,
		Header,
		HeaderNav,
		HeaderNavItem,
	} from 'agnostic-svelte';
	import LinkedInLogo from '../assets/linkedin-logo.svg';
	import MailIcon from '../assets/mail-icon.svg';
	import DownArrowSvg from '../assets/down-arrow.svg';
	import Separator from './lib/Separator.svelte';
	import { onMount } from 'svelte';
	import ButtonLink from './lib/ButtonLink.svelte';
	import BaerScriptProject from './lib/projects/BaerScriptProject.svelte';
	import StockPredictProject from './lib/projects/StockPredictProject.svelte';
	import JukeboxProject from './lib/projects/JukeboxProject.svelte';
	import TheArchonProject from './lib/projects/TheArchonProject.svelte';
	import PasswordProject from './lib/projects/PasswordProject.svelte';
	import Logo from '../assets/logo.png';

	const hash = Math.floor(Date.now() / 86_400_000);
	let ready = false;
	onMount(() => (ready = true));
</script>

<main>
	{#if ready}
		<Header css="secondary-background">
			<HeaderNav css="nav-overrides">
				<HeaderNavItem><a href="/blog">Blog</a></HeaderNavItem>
				<HeaderNavItem><a href="/about">About</a></HeaderNavItem>
			</HeaderNav>
			<div slot="logoright">
				<img
					src={Logo}
					alt="Header logo"
					width="35%"
					style="border-radius: 50%;"
				/>
			</div>
		</Header>
		<section class="vertical">
			<div class="wrapper">
				<h3 class="text-left">
					<span transition:fly={{ y: 10, duration: 500, delay: 250 }}
						>Hey there,
					</span><span transition:fly={{ y: 10, duration: 500, delay: 1_250 }}
						>I'm</span
					>
				</h3>
				<h1
					transition:fly={{ y: 10, duration: 1_000, delay: 1_850 }}
					class="gradient text-center"
				>
					Matthew Polak
				</h1>
			</div>

			<Separator --padding="1em" />
			<div transition:fly={{ y: 10, duration: 1_000, delay: 2_500 }}>
				<ButtonGroup ariaLabel="Social connections">
					<ButtonLink
						klass="grouped"
						href="https://github.com/matteopolak"
						mode="github"
					>
						<!--
						Temporarily inline SVG to use dynamic colours
					-->
						<svg
							width="20"
							height="20"
							viewBox="0 0 1024 1024"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							class="button invert"
						>
							<path
								fill-rule="evenodd"
								clip-rule="evenodd"
								d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
								transform="scale(64)"
								style="fill: var(--github-secondary)"
							/>
						</svg>
						<p style="color: var(--font-colour-dark)">GitHub</p>
					</ButtonLink>
					<ButtonLink
						klass="grouped"
						href="https://linkedin.com/in/matteo-polak"
						mode="linkedin"
					>
						<img
							src={LinkedInLogo}
							width="20"
							height="20"
							alt="LinkedIn logo"
							class="button"
						/>
						<p style="color: white;">LinkedIn</p>
					</ButtonLink>
					<ButtonLink
						klass="grouped"
						href="mailto:contact@matteopolak.com"
						mode="mail"
					>
						<img
							src={MailIcon}
							width="20"
							height="20"
							alt="Mail icon"
							class="button"
						/>
						<p style="color: white;">Contact</p>
					</ButtonLink>
				</ButtonGroup>
			</div>
		</section>
		<ButtonLink
			style="position: absolute; bottom: 10vh;"
			href="#projects"
			mode="blank"
			><img
				src={DownArrowSvg}
				width="30"
				height="30"
				alt="Down arrow"
				class="move-hover"
			/></ButtonLink
		>
		<Separator --padding="90vh" />
		<section id="projects">
			<Separator --padding="10vh" />
			<h2>Projects</h2>
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
	:global(.secondary-background) {
		background-color: var(--colour-secondary) !important;
	}

	:global(.btn-github) {
		background-color: var(--github-primary) !important;
	}

	:global(.btn-linkedin) {
		background-color: var(--linkedin-primary) !important;
	}

	:global(.btn-mail) {
		background-color: var(--mail-primary) !important;
	}

	.wrapper {
		display: inline-block;
		font-weight: 700;
		letter-spacing: 0em;
		line-height: 1em;
		font-variant-ligatures: no-common-ligatures;
		-webkit-font-variant-ligatures: no-common-ligatures;
	}

	:global(.button) {
		margin-right: 0.5em;
	}

	:global(.grouped:not(:first-of-type)) {
		padding-left: 0.5em;
	}

	:global(.project) {
		padding: 1em;
		margin-top: 2em;
		margin-bottom: 2em;
		border-radius: 1.5em;
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
		background-color: var(--colour-secondary);
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

	h2 {
		font-size: 4em;
	}

	h3 {
		margin-bottom: 0;
		text-align: left;
		font-size: 3em;
	}
</style>
