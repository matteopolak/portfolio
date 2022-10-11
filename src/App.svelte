<script>
	import { Router, Route } from 'svelte-routing';
	import Home from './routes/Home.svelte';
	import About from './routes/About.svelte';
	import Blog from './routes/Blog.svelte';
	import { onMount } from 'svelte';

	export let url = '';
	let ready = false;

	onMount(() => {
		url = window.location.pathname;
		ready = true;
	});
</script>

<main>
	{#if ready}
		<Router {url}>
			<div>
				<Route path="blog" component={Blog} />
				<Route path="about" component={About} />
				<Route path="/"><Home /></Route>
			</div>
		</Router>
	{/if}
</main>
