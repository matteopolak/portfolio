/// <reference lib="webworker" />
import { createEngine, type Engine, type Host } from './engine.ts';
import { StdinChannel } from './stdin-channel.ts';
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
interface HostModule {
  createWebGPUHost(options: {
    canvas: OffscreenCanvas;
    output: (text: string, stream: 'stdout' | 'stderr') => void;
    onSurface: (size: { width: number; height: number } | null) => void;
  }): CanvasHost;
}
let canvasHost: CanvasHost | undefined;
/*
 * Without both, a program cannot draw: it then gets no host at all, so
 * `jai_webgpu_available` says no and it can print why instead of failing.
 */
const hasJspi = () =>
  typeof (WebAssembly as { Suspending?: unknown }).Suspending === 'function' &&
  typeof (WebAssembly as { promising?: unknown }).promising === 'function';
const canDraw = () => 'gpu' in navigator && hasJspi();
// The program's standard input: it waits here, suspended, for the terminal's next line.
const stdin = new StdinChannel({
  request: () => scope.postMessage({ type: 'stdin-request' }),
});
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
  if (data.type === 'stdin') return stdin.push(data.text);
  queue = queue.then(async () => {
    try {
      if (data.type === 'init') {
        const response = await fetch(data.url);
        if (!response.ok) throw new Error(`Compiler: HTTP ${response.status}`);
        let canvas: { drawing: boolean; surfaceEvents: boolean } | undefined;
        if (data.canvas && data.hostUrl) {
          // Bundles before WebGPU have no host: programs then run as before.
          const host = canDraw()
            ? await loadHost(data.hostUrl).catch((error: unknown) => {
                console.warn('WebGPU host unavailable:', error);
                return undefined;
              })
            : undefined;
          canvasHost = host?.module.createWebGPUHost({
            canvas: data.canvas,
            output: (text, stream) => reply({ type: 'output', stream, text }),
            onSurface: (size) =>
              reply({
                type: 'surface',
                size: size && { width: size.width, height: size.height },
              }),
          });
          canvas = {
            drawing: Boolean(canvasHost),
            surfaceEvents: Boolean(canvasHost && host?.surfaceEvents),
          };
        }
        engine = await createEngine(await response.arrayBuffer(), {
          host: programHost(),
        });
        reply({
          type: 'init',
          capabilities: {
            languageServer: typeof engine.lsp === 'function',
            io: engine.io,
            ...(canvas ? { canvas } : {}),
          },
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
        stdin.reset();
        const { budget, args } = data.options;
        reply({
          type: 'run',
          id: data.id,
          // A program may wait for the page: input, WebGPU, animation frames.
          result: engine.jspi
            ? await engine.playAsync(files, 'main.jai', { budget, args })
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
 * What programs may ask the page for: the canvas host's functions, standard
 * input (where the module can be suspended to wait for it) and, since the
 * module streams output while it waits, the terminal's output.
 */
function programHost(): Host {
  const readStdin: Host['functions'][string] = (
    [pointer, capacity],
    memory
  ) => {
    const copy = (bytes: Uint8Array) => {
      new Uint8Array(memory.buffer, Number(pointer), bytes.length).set(bytes);
      return bytes.length;
    };
    const bytes = stdin.read(Number(capacity));
    return bytes instanceof Promise ? bytes.then(copy) : copy(bytes);
  };
  return {
    functions: {
      ...canvasHost?.functions,
      ...(hasJspi() ? { jai_stdin_read: readStdin } : {}),
    },
    output: (text, stream) => reply({ type: 'output', stream, text }),
  };
}

/*
 * The bundle's webgpu_host.mjs and the bindings it imports, loaded from blob
 * URLs: the dev server refuses module imports from public/, and the release
 * serves them as plain files either way.
 */
async function loadHost(
  url: string
): Promise<{ module: HostModule; surfaceEvents: boolean }> {
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
  const module = (await import(
    /* @vite-ignore */ blob(
      host.replace('./webgpu_bindings.generated.mjs', bindingsUrl)
    )
  )) as HostModule;
  // Hosts before `onSurface` ignore it; the page then guesses from the source.
  return { module, surfaceEvents: /\bonSurface\b/u.test(host) };
}
