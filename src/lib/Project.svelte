<script lang="ts">
	export let src = '';
	export let href = '';
	export let alt = '';
</script>

<div style="max-width: 60em; margin: auto; overflow: auto;" class="project">
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
</style>
