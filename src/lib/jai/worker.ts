/// <reference lib="webworker" />
import { createEngine, type Engine } from './engine.ts';
import { formatWithWasm, loadJaifmt } from './jaifmt-wasm.ts';
import type {
  CanvasInputEvent,
  WorkerRequest,
  WorkerResponse,
} from './lsp-types.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: Engine | undefined;
// The bundle's webgpu_host.mjs, when the page gave this worker a canvas.
interface CanvasHost {
  functions: Record<string, (args: bigint[], memory: unknown) => unknown>;
  input(event: CanvasInputEvent): void;
  resize(width: number, height: number): void;
}
let canvasHost: CanvasHost | undefined;
// Compiled once per worker; every format run gets a fresh instance.
let jaifmt: WebAssembly.Module | undefined;
let queue = Promise.resolve();
const reply = (message: WorkerResponse) => scope.postMessage(message);

scope.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  // Canvas events reach a running program at once; it reads them when it
  // waits for the next frame.
  if (data.type === 'input') return canvasHost?.input(data.event);
  if (data.type === 'resize')
    return canvasHost?.resize(data.width, data.height);
  queue = queue.then(async () => {
    try {
      if (data.type === 'init') {
        const response = await fetch(data.url);
        if (!response.ok) throw new Error(`Compiler: HTTP ${response.status}`);
        if (data.canvas && data.hostUrl) {
          // Bundles before WebGPU have no host: programs then run as before.
          const hostModule = await loadHost(data.hostUrl).catch((error) => {
            console.warn('WebGPU host unavailable:', error);
            return undefined;
          });
          canvasHost = hostModule?.createWebGPUHost({
            canvas: data.canvas,
            output: (text: string, stream: 'stdout' | 'stderr') =>
              reply({ type: 'output', stream, text }),
          }) as CanvasHost | undefined;
        }
        engine = await createEngine(await response.arrayBuffer(), {
          host: canvasHost,
        });
        reply({
          type: 'init',
          capabilities: { languageServer: typeof engine.lsp === 'function' },
        });
        return;
      }
      // The formatter worker runs jaifmt.wasm without loading the compiler.
      if (data.type === 'jaifmt-load') {
        const [module, metadata] = await Promise.all([
          fetch(data.url),
          fetch(data.metadataUrl),
        ]);
        if (!module.ok) throw new Error(`jaifmt.wasm: HTTP ${module.status}`);
        // Local builds (JAI_WEB_LOCAL) have no metadata: nothing to check against.
        const digest: unknown = metadata.ok
          ? await metadata.json().then(
              (json) => json?.jaifmt_wasm_sha256,
              () => undefined
            )
          : undefined;
        jaifmt = await loadJaifmt(
          await module.arrayBuffer(),
          typeof digest === 'string' ? digest : undefined,
          data.unsupported ? () => false : undefined
        );
        reply({ type: 'jaifmt-load', id: data.id, available: !!jaifmt });
        return;
      }
      if (data.type === 'jaifmt') {
        if (!jaifmt) throw new Error('jaifmt.wasm is not loaded.');
        const started = performance.now();
        const result = await formatWithWasm(
          jaifmt,
          data.documents,
          data.target
        );
        const ms = performance.now() - started;
        reply({ type: 'jaifmt', id: data.id, result, ms });
        return;
      }
      if (!engine) throw new Error('Compiler is not initialized.');
      if (data.type === 'lsp') {
        if (!engine.lsp) throw new Error('Language service unavailable.');
        reply({ type: 'lsp', id: data.id, messages: engine.lsp(data.message) });
      } else if (data.type === 'play') {
        reply({
          type: 'play',
          id: data.id,
          result: engine.play(data.files, data.main, { budget: data.budget }),
        });
      } else {
        const files = { ...data.options.files, 'main.jai': data.source };
        reply({
          type: 'run',
          id: data.id,
          // A program may wait for the page (WebGPU, animation frames).
          result:
            canvasHost && engine.jspi
              ? await engine.playAsync(files, 'main.jai', {
                  budget: data.options.budget,
                })
              : engine.run(data.source, data.options),
        });
      }
    } catch (error) {
      reply({
        type: data.type,
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

/*
 * The bundle's webgpu_host.mjs and the bindings it imports, loaded from blob
 * URLs: the dev server refuses module imports from public/, and the release
 * serves them as plain files either way.
 */
async function loadHost(url: string) {
  const base = new URL(url, location.href);
  const source = async (u: URL) => {
    const response = await fetch(u);
    if (!response.ok) throw new Error(`${u.pathname}: HTTP ${response.status}`);
    return response.text();
  };
  const [host, bindings] = await Promise.all([
    source(base),
    source(new URL('webgpu_bindings.generated.mjs', base)),
  ]);
  const blob = (text: string) =>
    URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const bindingsUrl = blob(bindings);
  return import(
    /* @vite-ignore */ blob(
      host.replace('./webgpu_bindings.generated.mjs', bindingsUrl)
    )
  );
}
