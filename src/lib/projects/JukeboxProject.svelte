<script lang="ts">
	import { Tag } from 'agnostic-svelte';
	import Project from '../Project.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/jukebox"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/jukebox"
	alt="Preview of the GitHub repository matteopolak/jukebox"
>
	<section
		style="float: right; width: 50%; display: flex; justify-content: flex-start; gap: 5px; padding-left: 10px; padding-top: 10px; padding-bottom: 10px;"
	>
		<Tag shape="pill" type="info" --agnostic-primary-light="#1f91de"
			>TypeScript</Tag
		>
		<Tag shape="pill" type="info" --agnostic-primary-light="#5865f2"
			>Discord</Tag
		>
	</section>
	<p style="float: left; text-align: left; padding-left: 0.5em; width: 50%;">
		Jukebox is a Discord bot that streams audio directly to a voice channel. It
		supports playlists, tracks, and queries from YouTube, YouTube Music,
		Spotify, and Soundcloud.
		<br /><br />
		<a href="https://ffmpeg.org/">ffmpeg</a> is used to convert the raw Opus
		stream received from Discord into a more friendly mp3 format.
		<br /><br />
		It also supports voice commands with the use of
		<a href="https://wit.ai/">Wit.ai</a>
	</p>
</Project>
