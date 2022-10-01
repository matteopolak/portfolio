<script lang="ts">
	import { Button } from 'agnostic-svelte';

	export let klass = '';
	export let href = '';
	export let mode = '';
</script>

<a {href} class={klass} target="_blank" {...$$restProps}>
	<Button isGrouped isCapsule {mode}><slot /></Button>
</a>
