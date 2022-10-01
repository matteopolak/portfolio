<script lang="ts">
	import { Tag } from 'agnostic-svelte';
	import Project from '../Project.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/baerscript"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/baerscript"
	alt="Preview of the GitHub repository matteopolak/baerscript"
>
	<div style="background-color: red;">
		<section
			style="float: right; width: 50%; display: flex; justify-content: flex-start; gap: 5px; padding-left: 10px; padding-top: 10px; padding-bottom: 10px;"
		>
			<Tag shape="pill" type="info" --agnostic-primary-light="#ab5926">Rust</Tag
			>
			<Tag shape="pill" type="info" --agnostic-primary-light="#83e645"
				>Interpreter</Tag
			>
		</section>
		<p style="float: left; text-align: left; padding-left: 0.5em; width: 50%;">
			BaerScript is a interpreted programming language. It utilizes nine symbols
			in order to achieve turing complete-ness.
			<br /><br />
			It contains unit tests and code-formatting checks when new commits are pushed
			to GitHub.
		</p>
	</div>
</Project>
