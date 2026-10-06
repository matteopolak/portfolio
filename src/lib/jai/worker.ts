/// <reference lib="webworker" />
import { createEngine, type Engine } from './engine.ts';
import { formatWithWasm, loadJaifmt } from './jaifmt-wasm.ts';
import type { WorkerRequest, WorkerResponse } from './lsp-types.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: Engine | undefined;
// Compiled once per worker; every format run gets a fresh instance.
let jaifmt: WebAssembly.Module | undefined;
let queue = Promise.resolve();
const reply = (message: WorkerResponse) => scope.postMessage(message);

scope.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'init') {
        const response = await fetch(data.url);
        if (!response.ok) throw new Error(`Compiler: HTTP ${response.status}`);
        engine = await createEngine(await response.arrayBuffer());
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
        reply({
          type: 'run',
          id: data.id,
          result: engine.run(data.source, data.options),
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
