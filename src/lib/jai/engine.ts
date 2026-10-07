import type { JsonRpcMessage } from './lsp-types.ts';

// Every bridge export takes and returns i32 numbers.
type Export = (...args: number[]) => number;

export interface RunOptions {
  files?: Record<string, string>;
  /** Interpreter budget in basic blocks, so a runaway program fails instead of hanging. */
  budget?: number;
}

export interface RunDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: string;
  message: string;
}

export interface RunOutput {
  /** `null` when compilation failed. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Program writes in order. */
  output?: { stream: 'stdout' | 'stderr'; text: string }[];
  rendered?: string;
  diagnostics?: RunDiagnostic[];
}

/**
 * Procedures the page offers a program beyond the sandbox (the bundle's
 * webgpu_host.mjs builds them): arguments are the call's 64-bit slots,
 * pointers are addresses in `memory.buffer`; a promise suspends the program
 * (JSPI) until it settles.
 */
export interface HostMemory {
  readonly buffer: ArrayBuffer;
  alloc(size: number): number;
  free(pointer: number, size: number): void;
}
export interface Host {
  functions: Record<string, (args: bigint[], memory: HostMemory) => unknown>;
  output?: (text: string, stream: 'stdout' | 'stderr') => void;
}

export interface Engine {
  /** Whether programs can wait for the page (JSPI); needed by `playAsync`. */
  jspi: boolean;
  playAsync(
    files: Record<string, string>,
    main: string,
    options?: Pick<RunOptions, 'budget'>
  ): Promise<RunOutput>;
  lsp?: (message: JsonRpcMessage) => JsonRpcMessage[];
  /** Runs `main.jai` from `source` plus `options.files`. */
  run(source: string, options?: RunOptions): RunOutput;
  /** Runs the file named `main` from `files` (the `/workspace` file map). */
  play(
    files: Record<string, string>,
    main: string,
    options?: Pick<RunOptions, 'budget'>
  ): RunOutput;
}

// The browser and Node verification harness instantiate the exact same Rust compiler (jaic).
export async function createEngine(
  wasmBytes: BufferSource,
  { host }: { host?: Host } = {}
): Promise<Engine> {
  const module = await WebAssembly.compile(wasmBytes);
  if (WebAssembly.Module.imports(module).some((i) => i.module !== 'jai_host')) {
    throw new Error('This runtime build unexpectedly requires host imports.');
  }
  // JavaScript Promise Integration: not yet in TypeScript's lib.
  const wasm = WebAssembly as unknown as {
    Suspending?: new (f: (...a: number[]) => Promise<number>) => unknown;
    promising?: (f: Export) => (...a: number[]) => Promise<number>;
  };
  const jspi =
    typeof wasm.Suspending === 'function' &&
    typeof wasm.promising === 'function';
  let pending: Promise<unknown> | null = null;
  let lastError = '';
  const memory: HostMemory = {
    get buffer() {
      return (instance.exports.memory as WebAssembly.Memory).buffer;
    },
    alloc: (size) => (instance.exports.jai_host_alloc as Export)(size),
    free: (pointer, size) =>
      void (instance.exports.jai_host_free as Export)(pointer, size),
  };
  const text = new TextDecoder();
  const store = (results: number, count: number, value: unknown) => {
    if (count === 0 || value === undefined || value === null) return;
    let bits: bigint;
    if (typeof value === 'bigint') bits = BigInt.asUintN(64, value);
    else if (typeof value === 'boolean') bits = value ? 1n : 0n;
    else if (typeof value === 'number' && Number.isInteger(value))
      bits = BigInt.asUintN(64, BigInt(value));
    else throw new TypeError(`host function returned ${String(value)}`);
    new BigUint64Array(memory.buffer, results, count)[0] = bits;
  };
  const fail = (error: unknown) => {
    lastError = error instanceof Error ? error.message : String(error);
    return 2;
  };
  const imports = {
    jai_host: {
      call(
        name: number,
        nameLength: number,
        args: number,
        count: number,
        results: number,
        resultCount: number
      ) {
        const functions = host?.functions;
        if (!functions) return 1;
        const key = text.decode(
          new Uint8Array(memory.buffer, name, nameLength)
        );
        if (!Object.hasOwn(functions, key)) return 1;
        try {
          const value = functions[key](
            Array.from(new BigUint64Array(memory.buffer, args, count)),
            memory
          );
          if (value instanceof Promise) {
            pending = value;
            return 3;
          }
          store(results, resultCount, value);
          return 0;
        } catch (error) {
          return fail(error);
        }
      },
      wait: jspi
        ? new wasm.Suspending!(async (results: number, resultCount: number) => {
            const promise = pending;
            pending = null;
            try {
              store(results, resultCount, await promise);
              return 0;
            } catch (error) {
              return fail(error);
            }
          })
        : () => fail('This browser cannot suspend WebAssembly (JSPI).'),
      error(buffer: number, capacity: number) {
        const bytes = new TextEncoder().encode(lastError).subarray(0, capacity);
        new Uint8Array(memory.buffer, buffer, bytes.length).set(bytes);
        return bytes.length;
      },
      output(data: number, length: number, toStderr: number) {
        host?.output?.(
          text.decode(new Uint8Array(memory.buffer, data, length)),
          toStderr ? 'stderr' : 'stdout'
        );
      },
      now_ms: () => performance.now(),
    },
  };
  const instance = await WebAssembly.instantiate(
    module,
    imports as unknown as WebAssembly.Imports
  );
  const exports = instance.exports;
  const fn = (name: string): Export => {
    const value = exports[name];
    if (typeof value !== 'function')
      throw new Error('Compiler module is missing the playground bridge.');
    return value as Export;
  };
  const required = [
    'jai_play_reset',
    'jai_play_push',
    'jai_play_finish_file',
    'jai_play_run',
    'jai_play_output_len',
    'jai_play_output_byte',
    'jai_play_error_len',
    'jai_play_error_byte',
  ] as const;
  const api = Object.fromEntries(required.map((name) => [name, fn(name)])) as {
    [K in (typeof required)[number]]: Export;
  };
  const setBudget =
    typeof exports.jai_play_set_budget === 'function'
      ? (exports.jai_play_set_budget as Export)
      : undefined;
  // Errors drawn as a terminal draws them (colour, box drawing); older bundles lack it.
  const setStyled =
    typeof exports.jai_play_set_styled === 'function'
      ? (exports.jai_play_set_styled as Export)
      : undefined;
  if (setStyled) check(setStyled(1));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  function read(kind: 'output' | 'error') {
    const length =
      kind === 'output' ? api.jai_play_output_len() : api.jai_play_error_len();
    const byte =
      kind === 'output' ? api.jai_play_output_byte : api.jai_play_error_byte;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = byte(i);
    return decoder.decode(bytes);
  }
  function check(status: number) {
    if (status !== 0)
      throw new Error(
        read('error') || 'Playground boundary rejected the request.'
      );
  }
  function push(channel: number, text: string) {
    for (const byte of encoder.encode(text))
      check(api.jai_play_push(channel, byte));
  }
  const lspExports = [
    'reset',
    'begin',
    'push',
    'dispatch',
    'output_len',
    'output_byte',
    'diagnostic_len',
    'diagnostic_byte',
  ] as const;
  const supportsLsp = lspExports.every(
    (name) => typeof exports[`jai_lsp_${name}`] === 'function'
  );
  const lsp = (name: (typeof lspExports)[number]) => fn(`jai_lsp_${name}`);
  function readLanguage(kind: 'output' | 'diagnostic', limit: number) {
    const length = lsp(`${kind}_len`)();
    if (!Number.isInteger(length) || length < 0 || length > limit)
      throw new Error('Language response byte limit exceeded.');
    const read = lsp(`${kind}_byte`);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const byte = read(i);
      if (byte < 0 || byte > 255)
        throw new Error('Invalid language response byte.');
      bytes[i] = byte;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  function languageCheck(status: number) {
    if (status !== 0)
      throw new Error(
        readLanguage('diagnostic', 2 * 1024 * 1024) ||
          'Language boundary rejected the request.'
      );
  }
  if (supportsLsp) languageCheck(lsp('reset')());
  return {
    ...(supportsLsp
      ? {
          lsp(message: JsonRpcMessage): JsonRpcMessage[] {
            const text = JSON.stringify(message);
            if (typeof text !== 'string' || text.length > 1024 * 1024)
              throw new Error('Language message byte limit exceeded.');
            const bytes = encoder.encode(text);
            if (bytes.length > 1024 * 1024)
              throw new Error('Language message byte limit exceeded.');
            languageCheck(lsp('begin')());
            const pushByte = lsp('push');
            for (const byte of bytes) languageCheck(pushByte(byte));
            languageCheck(lsp('dispatch')());
            const result: unknown = JSON.parse(
              readLanguage('output', 2 * 1024 * 1024)
            );
            if (!Array.isArray(result))
              throw new Error('Invalid language response envelope.');
            return result as JsonRpcMessage[];
          },
        }
      : {}),
    jspi,
    async playAsync(files, main, options = {}) {
      prepare(files, main, options);
      const run = jspi ? wasm.promising!(api.jai_play_run) : null;
      check(run ? await run() : api.jai_play_run());
      return JSON.parse(read('output')) as RunOutput;
    },
    run(source, { files = {}, budget } = {}) {
      if (typeof source !== 'string')
        throw new TypeError('Source must be text.');
      return play({ ...files, 'main.jai': source }, 'main.jai', { budget });
    },
    play,
  };
  function play(
    files: Record<string, string>,
    main: string,
    options: Pick<RunOptions, 'budget'> = {}
  ): RunOutput {
    prepare(files, main, options);
    check(api.jai_play_run());
    return JSON.parse(read('output')) as RunOutput;
  }
  function prepare(
    files: Record<string, string>,
    main: string,
    { budget }: Pick<RunOptions, 'budget'> = {}
  ) {
    if (typeof main !== 'string' || !files || typeof files !== 'object')
      throw new TypeError('Play needs a file map and a main path.');
    if (budget !== undefined && (!Number.isSafeInteger(budget) || budget <= 0))
      throw new RangeError('Budget must be a positive integer.');
    if (setBudget)
      check(
        setBudget(
          budget === undefined
            ? 0
            : Math.min(0xffffffff, Math.ceil(budget / 1000))
        )
      );
    check(api.jai_play_reset());
    for (const [name, text] of Object.entries(files)) {
      if (typeof text !== 'string')
        throw new TypeError('Every supplied source file must be text.');
      push(0, name);
      push(1, text);
      check(api.jai_play_finish_file());
    }
    push(2, main);
  }
}
