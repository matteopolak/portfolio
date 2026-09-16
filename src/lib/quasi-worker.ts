/// <reference lib="webworker" />

interface QuasiModule {
  default: (
    input?:
      | string
      | URL
      | Request
      | Response
      | BufferSource
      | WebAssembly.Module
  ) => Promise<unknown>;
  execute: (input: Uint8Array, timeoutMs: bigint) => string;
}

type WorkerRequest = { source: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();
let quasi: QuasiModule | undefined;

async function boot() {
  try {
    scope.postMessage({ type: 'progress', progress: 0.08 });
    const [moduleResponse, wasmResponse] = await Promise.all([
      fetch('/quasi/quasi.js'),
      fetch('/quasi/quasi_bg.wasm'),
    ]);
    if (!moduleResponse.ok || !wasmResponse.ok) {
      throw new Error(
        `Quasi assets returned HTTP ${moduleResponse.status}/${wasmResponse.status}.`
      );
    }
    scope.postMessage({ type: 'progress', progress: 0.45 });

    // Vite deliberately refuses to import ESM from public/. Fetching the
    // release-generated wrapper as an opaque asset keeps it out of Vite's
    // transform graph while preserving an ESM interface inside this worker.
    const blobUrl = URL.createObjectURL(
      new Blob([await moduleResponse.text()], { type: 'text/javascript' })
    );
    try {
      quasi = (await import(/* @vite-ignore */ blobUrl)) as QuasiModule;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    scope.postMessage({ type: 'progress', progress: 0.72 });
    await quasi.default(wasmResponse);
    scope.postMessage({ type: 'progress', progress: 1 });
    scope.postMessage({ type: 'ready' });
  } catch (error) {
    scope.postMessage({ type: 'boot-error', error: errorMessage(error) });
  }
}

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    if (!quasi) throw new Error('The interpreter is not ready.');
    const output = quasi.execute(encoder.encode(event.data.source), 0n);
    scope.postMessage({ type: 'result', output });
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
