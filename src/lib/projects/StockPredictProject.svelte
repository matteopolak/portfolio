<script lang="ts">
	import { Tag } from 'agnostic-svelte';
	import Project from '../Project.svelte';
	import Tags from '../Tags.svelte';
	import FinanceTag from '../tags/FinanceTag.svelte';
	import MachineLearningTag from '../tags/MachineLearningTag.svelte';
	import TypeScriptTag from '../tags/TypeScriptTag.svelte';

	export let hash = 0;
</script>

<Project
	href="https://github.com/matteopolak/stock-predict"
	src="https://opengraph.githubassets.com/{hash}/matteopolak/stock-predict"
	alt="Preview of the GitHub repository matteopolak/stock-predict"
	index={1}
>
	<Tags>
		<TypeScriptTag />
		<MachineLearningTag />
		<FinanceTag />
	</Tags>
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
