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

export interface Engine {
  lsp?: (message: JsonRpcMessage) => JsonRpcMessage[];
  run(source: string, options?: RunOptions): RunOutput;
}

// The browser and Node verification harness instantiate the exact same Rust compiler (jaic).
export async function createEngine(wasmBytes: BufferSource): Promise<Engine> {
  const module = await WebAssembly.compile(wasmBytes);
  if (WebAssembly.Module.imports(module).length !== 0) {
    throw new Error('This runtime build unexpectedly requires host imports.');
  }
  const instance = await WebAssembly.instantiate(module, {});
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
    run(source, { files = {}, budget } = {}) {
      if (typeof source !== 'string')
        throw new TypeError('Source must be text.');
      if (
        budget !== undefined &&
        (!Number.isSafeInteger(budget) || budget <= 0)
      )
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
      for (const [name, text] of Object.entries({
        ...files,
        'main.jai': source,
      })) {
        if (typeof text !== 'string')
          throw new TypeError('Every supplied source file must be text.');
        push(0, name);
        push(1, text);
        check(api.jai_play_finish_file());
      }
      push(2, 'main.jai');
      check(api.jai_play_run());
      return JSON.parse(read('output')) as RunOutput;
    },
  };
}
