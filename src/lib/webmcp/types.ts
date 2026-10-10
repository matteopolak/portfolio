/*
 * WebMCP types: the parts of the W3C draft (webmachinelearning.github.io/webmcp)
 * the site uses. `document.modelContext` is the current home of the API;
 * `navigator.modelContext` is the older one and is feature-detected too.
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: 'string';
      description: string;
      enum?: readonly string[];
      minLength?: number;
      maxLength?: number;
    }
  >;
  required?: readonly string[];
  additionalProperties?: false;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  execute(
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(
    tool: ToolDefinition,
    options?: { signal?: AbortSignal }
  ): Promise<void> | void;
}

/** `document.modelContext`, falling back to `navigator.modelContext`; undefined without WebMCP. */
export function findModelContext(
  doc: object = document,
  nav: object = navigator
): ModelContextLike | undefined {
  for (const host of [doc, nav]) {
    const context = (host as { modelContext?: ModelContextLike }).modelContext;
    if (context && typeof context.registerTool === 'function') return context;
  }
  return undefined;
}
