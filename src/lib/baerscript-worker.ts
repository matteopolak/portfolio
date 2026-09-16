/// <reference lib="webworker" />

interface BaerscriptResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface BaerscriptModule {
  default: (input?: {
    module_or_path:
      | string
      | URL
      | Request
      | Response
      | BufferSource
      | WebAssembly.Module;
  }) => Promise<unknown>;
  execute: (
    source: string,
    input: string,
    ascii: boolean,
    maxSteps: number
  ) => BaerscriptResult;
}

type WorkerRequest = { source: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let baerscript: BaerscriptModule | undefined;

async function boot() {
  try {
    scope.postMessage({ type: 'progress', progress: 0.08 });
    const [moduleResponse, wasmResponse] = await Promise.all([
      fetch('/baerscript/baerscript_wasm.js'),
      fetch('/baerscript/baerscript_wasm_bg.wasm'),
    ]);
    if (!moduleResponse.ok || !wasmResponse.ok) {
      throw new Error(
        `BaerScript assets returned HTTP ${moduleResponse.status}/${wasmResponse.status}.`
      );
    }
    scope.postMessage({ type: 'progress', progress: 0.45 });

    const blobUrl = URL.createObjectURL(
      new Blob([await moduleResponse.text()], { type: 'text/javascript' })
    );
    try {
      baerscript = (await import(
        /* @vite-ignore */ blobUrl
      )) as BaerscriptModule;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    scope.postMessage({ type: 'progress', progress: 0.72 });
    await baerscript.default({ module_or_path: wasmResponse });
    scope.postMessage({ type: 'progress', progress: 1 });
    scope.postMessage({ type: 'ready' });
  } catch (error) {
    scope.postMessage({ type: 'boot-error', error: errorMessage(error) });
  }
}

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    if (!baerscript) throw new Error('The interpreter is not ready.');
    const result = baerscript.execute(event.data.source, '', false, 250_000);
    scope.postMessage({
      type: 'result',
      output: result.ok ? result.stdout : undefined,
      error: result.ok ? undefined : result.stderr || 'Execution failed.',
    });
  } catch (error) {
    scope.postMessage({ type: 'result', error: errorMessage(error) });
  }
});

void boot();

function errorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'The interpreter stopped with an unknown error.';
}

export {};
