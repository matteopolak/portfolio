import type { JsonRpcMessage } from './lsp-types.ts';

// Status and byte exports return i32 numbers; result exports return i64 BigInts.
type Export = (...args: number[]) => number;

export interface RunOptions {
  arguments?: string[];
  files?: Record<string, string>;
  fuel?: number;
}

export interface Engine {
  lsp?: (message: JsonRpcMessage) => JsonRpcMessage[];
  run(
    source: string,
    options?: RunOptions
  ): { exitCode: bigint; steps: number };
}

// The browser and Node verification harness instantiate the exact same Rust VM.
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
      throw new Error('Compiler module is missing the runtime bridge.');
    return value as Export;
  };
  const required = [
    'jai_script_reset',
    'jai_script_push',
    'jai_script_finish_source',
    'jai_script_finish_argument',
    'jai_script_run',
    'jai_script_has_result',
    'jai_script_exit_code',
    'jai_script_steps',
    'jai_script_diagnostic_len',
    'jai_script_diagnostic_byte',
  ] as const;
  const api = Object.fromEntries(required.map((name) => [name, fn(name)])) as {
    [K in (typeof required)[number]]: Export;
  };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  function diagnostic() {
    const bytes = new Uint8Array(api.jai_script_diagnostic_len());
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = api.jai_script_diagnostic_byte(i);
    return decoder.decode(bytes);
  }
  function check(status: number) {
    if (status !== 0)
      throw new Error(diagnostic() || 'Runtime boundary rejected the request.');
  }
  function push(channel: number, text: string) {
    for (const byte of encoder.encode(text))
      check(api.jai_script_push(channel, byte));
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
    run(source, { arguments: args = [], files = {}, fuel = 1_000_000 } = {}) {
      if (
        typeof source !== 'string' ||
        !Array.isArray(args) ||
        args.some((arg) => typeof arg !== 'string')
      ) {
        throw new TypeError(
          'Source must be text and arguments must be an array of strings.'
        );
      }
      if (!Number.isInteger(fuel) || fuel < 0 || fuel > 0xffffffff) {
        throw new RangeError('Fuel must be an unsigned 32-bit integer.');
      }
      check(api.jai_script_reset());
      for (const [name, text] of Object.entries({
        ...files,
        'main.jai': source,
      })) {
        if (typeof text !== 'string')
          throw new TypeError('Every supplied source file must be text.');
        push(2, name);
        push(0, text);
        check(api.jai_script_finish_source());
      }
      for (const arg of args) {
        push(1, arg);
        check(api.jai_script_finish_argument());
      }
      check(api.jai_script_run(fuel));
      if (api.jai_script_has_result() !== 1)
        throw new Error('Runtime produced no result.');
      return {
        exitCode: BigInt(api.jai_script_exit_code() as number | bigint),
        steps: Number(api.jai_script_steps() as number | bigint),
      };
    },
  };
}
