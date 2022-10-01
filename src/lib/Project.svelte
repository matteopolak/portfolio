<script lang="ts">
	export let src = '';
	export let href = '';
	export let alt = '';
</script>

<div class="project wrapper">
	<a {href}>
		<img {src} {alt} width="50%" class="preview" />
	</a>
	<slot />
</div>

<style>
	.preview {
		border-radius: 10px;
		float: left;
	}

	.wrapper {
		max-width: 70em;
		margin-left: auto;
		margin-right: auto;
		overflow: auto;
		background-color: var(--color-dark);
		box-shadow: 0 0 10px 3px black;
	}
</style>
