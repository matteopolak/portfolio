<script lang="ts">
	import Project from '../Project.svelte';
	import Tags from '../Tags.svelte';
	import RustTag from '../tags/RustTag.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/tcd"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/tcd"
	alt="Preview of the GitHub repository matteopolak/tcd"
	index={0}
>
	<div style="background-color: red;">
		<Tags>
			<RustTag />
		</Tags>
		<p style="float: left; text-align: left; padding-left: 0.5em; width: 50%;">
			tcd is a command-line tool that allows you to download and archive
			millions of Twitch chat logs and store them in a PostgreSQL database.
			<br /><br />
			It contains unit tests and code-formatting checks when new commits are pushed
			to GitHub.
		</p>
	</div>
</Project>
