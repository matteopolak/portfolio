<script lang="ts">
	import { Tag } from 'agnostic-svelte';
	import Project from '../Project.svelte';
	import Tags from '../Tags.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/thearchon"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/thearchon"
	alt="Preview of the GitHub repository matteopolak/thearchon"
>
	<Tags>
		<Tag shape="pill" type="info" --agnostic-primary-light="#1f91de"
			>TypeScript</Tag
		>
		<Tag shape="pill" type="info" --agnostic-primary-light="#54f088"
			>Minecraft</Tag
		>
		<Tag shape="pill" type="info" --agnostic-primary-light="#5865f2"
			>Discord</Tag
		>
	</Tags>
	<p style="float: left; text-align: left; padding-left: 0.5em; width: 50%;">
		This project is a multi-functional Minecraft bot created to be used on
		TheArchon, a Minecraft server. It contains capabilities to automatically
		fish, store items, and solve in-game captchas.
		<br /><br />
		It was created with the
		<a href="https://github.com/PrismarineJS/mineflayer">mineflayer</a> library,
		which provides access to raw Minecraft packets.
	</p>
</Project>
