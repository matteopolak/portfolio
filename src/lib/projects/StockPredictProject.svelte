<script lang="ts">
	import { Tag } from 'agnostic-svelte';
	import Project from '../Project.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/stock-predict"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/stock-predict"
	alt="Preview of the GitHub repository matteopolak/stock-predict"
>
	<section
		style="float: right; width: 50%; display: flex; justify-content: flex-start; gap: 5px; padding-left: 10px; padding-top: 10px; padding-bottom: 10px;"
	>
		<Tag shape="pill" type="info" --agnostic-primary-light="#1f91de"
			>TypeScript</Tag
		>
		<Tag shape="pill" type="info" --agnostic-primary-light="#ff6f00"
			>TensorFlow</Tag
		>
		<Tag shape="pill" type="info" --agnostic-primary-light="#7e54f0"
			>Finance</Tag
		>
	</section>
	<p style="float: left; text-align: left; padding-left: 0.5em; width: 50%;">
		This stock prediction model was created with <a
			href="https://www.tensorflow.org/">TensorFlow</a
		>, a machine-learning library. It uses an LSTM-based model for prediction
		and collects stock price history from the
		<a href="https://data.nasdaq.com/tools/api">NASDAQ API</a>.
		<br /><br />
		It provides support for
		<a href="https://developer.nvidia.com/cuda-zone">NVIDIA CUDA</a>
		and <a href="https://www.khronos.org/opencl/">OpenCL</a>, resulting in
		significant speed improvements when trained on a GPU.
	</p>
</Project>
