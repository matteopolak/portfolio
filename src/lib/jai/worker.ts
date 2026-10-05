/// <reference lib="webworker" />
import { createEngine, type Engine } from './engine.ts';
import type { WorkerRequest, WorkerResponse } from './lsp-types.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: Engine | undefined;
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
