import { createEngine } from './engine.js';
let engine;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'init') {
        const response = await fetch(data.url);
        if (!response.ok) throw new Error(`Compiler: HTTP ${response.status}`);
        engine = await createEngine(await response.arrayBuffer());
        self.postMessage({
          type: 'init',
          capabilities: { languageServer: typeof engine.lsp === 'function' },
        });
      } else if (data.type === 'lsp') {
        self.postMessage({
          type: 'lsp',
          id: data.id,
          messages: engine.lsp(data.message),
        });
      } else if (data.type === 'run') {
        const result = engine.run(data.source, data.options);
        self.postMessage({
          type: 'run',
          id: data.id,
          result: { exitCode: String(result.exitCode) },
        });
      }
    } catch (error) {
      self.postMessage({
        type: data.type,
        id: data.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
