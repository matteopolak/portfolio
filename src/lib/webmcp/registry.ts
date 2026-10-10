import type { ModelContextLike, ToolDefinition } from './types.ts';

/**
 * Keeps the registered WebMCP tools equal to what the current page wants.
 * `sync` registers new tools, unregisters (aborts the signal of) removed ones
 * and leaves unchanged ones alone, so repeated page loads under ClientRouter
 * never register a tool twice.
 */
export function createToolRegistry(context: ModelContextLike) {
  const registered = new Map<string, AbortController>();
  return {
    sync(tools: ToolDefinition[]) {
      const wanted = new Set(tools.map((tool) => tool.name));
      for (const [name, controller] of registered) {
        if (!wanted.has(name)) {
          controller.abort();
          registered.delete(name);
        }
      }
      for (const tool of tools) {
        if (registered.has(tool.name)) continue;
        const controller = new AbortController();
        registered.set(tool.name, controller);
        try {
          Promise.resolve(
            context.registerTool(tool, { signal: controller.signal })
          ).catch(() => registered.delete(tool.name));
        } catch {
          registered.delete(tool.name);
        }
      }
    },
    names: () => [...registered.keys()],
    clear() {
      for (const controller of registered.values()) controller.abort();
      registered.clear();
    },
  };
}
