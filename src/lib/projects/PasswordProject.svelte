<script lang="ts">
	import { Tag } from 'agnostic-svelte';
	import Project from '../Project.svelte';
	import Tags from '../Tags.svelte';
	import CryptographyTag from '../tags/CryptographyTag.svelte';
	import RustTag from '../tags/RustTag.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/password"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/password"
	alt="Preview of the GitHub repository matteopolak/stock-predict"
>
	<Tags>
		<RustTag />
		<CryptographyTag />
	</Tags>
	<p style="float: left; text-align: left; padding-left: 0.5em; width: 50%;">
		This project is a cryptographically-secure password generator written in
		Rust. It is highly configurable, with options for password length, the
		character set, and whether to use common character groups (upper- and
		lower-case letters, numbers, and special characters).
		<br /><br />
		<a href="https://github.com/clap-rs/clap">clap</a> is used for elegant
		command-line parsing, and
		<a href="https://github.com/rust-random/rand">rand</a> is used for random number
		generation.
	</p>
</Project>
