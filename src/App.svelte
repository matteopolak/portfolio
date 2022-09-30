<script lang="ts">
	import 'agnostic-svelte/css/common.min.css';
	import { fly } from 'svelte/transition';
	import { Button, ButtonGroup, Tabs } from 'agnostic-svelte';
	import GitHubLogo from './assets/github-logo.svg';
	import Separator from './lib/Separator.svelte';
</script>

<main>
	<h3 transition:fly={{ y: 100, duration: 5_000 }}>Hey there, I'm</h3>
	<h1 transition:fly={{ y: 100, duration: 5_000 }} class="gradient">
		Matthew Polak
	</h1>

	<p>Something something science etc etc</p>
	<Separator />
	<ButtonGroup ariaLabel="Social connections">
		<a href="https://github.com/matteopolak">
			<Button isGrouped isCapsule mode="primary"
				><img src={GitHubLogo} alt="GitHub Logo" class="button" />GitHub</Button
			>
		</a>
		<a href="https://github.com/matteopolak" class="grouped">
			<Button isGrouped isCapsule mode="primary"
				><img
					src={GitHubLogo}
					alt="GitHub Logo"
					class="button"
				/>LinkedIn</Button
			>
		</a>
	</ButtonGroup>
</main>

<style>
	:root {
		--github-modelight: ;
	}

	.button {
		padding-right: 0.5em;
	}

	.grouped:not(:first-of-type) {
		padding-left: 0.5em;
	}

	.gradient {
		background: linear-gradient(90deg, #4248f5, #f54242);
		background-clip: text;
		-webkit-text-fill-color: transparent;
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

	p {
		text-align: left;
	}
</style>
