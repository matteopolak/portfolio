/*
 * jaifmt compiled to WebAssembly (`jaifmt.wasm` in the release bundle): a
 * wasm64 WASI preview 1 command that reads Jai source on stdin and writes the
 * formatted file to stdout. This module holds the small WASI shim it needs and
 * the format call; docs/jai-formatter.md describes the protocol.
 */
import { FORMAT_CONFIG_PATH } from './format.ts';

/** Release asset next to `jai_wasm.wasm`. */
export const JAIFMT_WASM_ASSET = 'jaifmt.wasm';
/** Release metadata that records `jaifmt_wasm_sha256`. */
export const BUILD_METADATA_ASSET = 'build-metadata.json';

export interface WasiResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Thrown by `proc_exit` to unwind out of `_start`. */
class WasiExit {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_INVAL = 28;
const ERRNO_NOSYS = 52;

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/**
 * Compiles `jaifmt.wasm` once. Returns undefined when this engine cannot run
 * it (no Memory64, e.g. Safari releases), so the caller falls back to the
 * engine driver. A digest mismatch with the release metadata is an error.
 */
export async function loadJaifmt(
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
  expectedSha256?: string,
  validate: (bytes: BufferSource) => boolean = (b) => WebAssembly.validate(b)
): Promise<WebAssembly.Module | undefined> {
  if (expectedSha256 !== undefined) {
    const actual = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (actual !== expectedSha256)
      throw new Error('jaifmt.wasm does not match its release metadata.');
  }
  if (!validate(bytes)) return undefined;
  return WebAssembly.compile(bytes);
}

/**
 * Runs a WASI preview 1 command once, on a fresh instance: `stdin` is fed to
 * fd 0, fds 1 and 2 are collected. jaic's wasm64 modules pass WASI addresses
 * as 32-bit offsets into a 64-bit memory; `Number()` accepts either form.
 */
export async function runWasi(
  module: WebAssembly.Module,
  args: readonly string[],
  stdin: string
): Promise<WasiResult> {
  const encoder = new TextEncoder();
  const input = encoder.encode(stdin);
  const argv = args.map((arg) => encoder.encode(`${arg}\0`));
  let consumed = 0;
  const output: Record<1 | 2, Uint8Array[]> = { 1: [], 2: [] };
  // Set once instantiated. memory.buffer is replaced when the module grows its
  // memory, so every call re-reads it.
  const exported: { memory?: WebAssembly.Memory } = {};
  const view = () => new DataView(exported.memory!.buffer);
  const bytes = () => new Uint8Array(exported.memory!.buffer);
  const at = (pointer: number | bigint) => Number(pointer);
  type Pointer = number | bigint;

  const wasi: Record<string, (...args: never[]) => number> = {
    fd_read(fd: number, iovs: Pointer, count: Pointer, read: Pointer) {
      if (fd !== 0) return ERRNO_BADF;
      const data = view();
      let total = 0;
      for (let i = 0; i < at(count); i++) {
        const base = at(iovs) + i * 8;
        const target = data.getUint32(base, true);
        const length = data.getUint32(base + 4, true);
        const chunk = input.subarray(consumed, consumed + length);
        bytes().set(chunk, target);
        consumed += chunk.length;
        total += chunk.length;
        if (chunk.length < length) break;
      }
      view().setUint32(at(read), total, true);
      return ERRNO_SUCCESS;
    },
    fd_write(fd: number, iovs: Pointer, count: Pointer, written: Pointer) {
      if (fd !== 1 && fd !== 2) return ERRNO_BADF;
      const data = view();
      let total = 0;
      for (let i = 0; i < at(count); i++) {
        const base = at(iovs) + i * 8;
        const source = data.getUint32(base, true);
        const length = data.getUint32(base + 4, true);
        output[fd].push(bytes().slice(source, source + length));
        total += length;
      }
      view().setUint32(at(written), total, true);
      return ERRNO_SUCCESS;
    },
    args_sizes_get(count: Pointer, size: Pointer) {
      const data = view();
      data.setUint32(at(count), argv.length, true);
      data.setUint32(
        at(size),
        argv.reduce((sum, arg) => sum + arg.length, 0),
        true
      );
      return ERRNO_SUCCESS;
    },
    args_get(pointers: Pointer, text: Pointer) {
      let offset = at(text);
      argv.forEach((arg, i) => {
        view().setUint32(at(pointers) + i * 4, offset, true);
        bytes().set(arg, offset);
        offset += arg.length;
      });
      return ERRNO_SUCCESS;
    },
    environ_sizes_get(count: Pointer, size: Pointer) {
      view().setUint32(at(count), 0, true);
      view().setUint32(at(size), 0, true);
      return ERRNO_SUCCESS;
    },
    environ_get: () => ERRNO_SUCCESS,
    clock_time_get(clock: number, _precision: bigint, time: Pointer) {
      if (clock !== 0 && clock !== 1) return ERRNO_INVAL;
      const now = clock === 0 ? Date.now() * 1e6 : performance.now() * 1e6;
      view().setBigUint64(at(time), BigInt(Math.round(now)), true);
      return ERRNO_SUCCESS;
    },
    proc_exit(code: number) {
      throw new WasiExit(code);
    },
  };
  // Anything else the module imports from WASI answers "not supported".
  const imports: Record<string, Record<string, unknown>> = {};
  for (const { module: from, name, kind } of WebAssembly.Module.imports(
    module
  )) {
    if (kind !== 'function') continue;
    imports[from] ??= {};
    imports[from][name] =
      from === 'wasi_snapshot_preview1' && name in wasi
        ? wasi[name]
        : () => ERRNO_NOSYS;
  }
  const instance = await WebAssembly.instantiate(
    module,
    imports as WebAssembly.Imports
  );
  exported.memory = instance.exports.memory as WebAssembly.Memory;
  const decode = (chunks: Uint8Array[]) => {
    const decoder = new TextDecoder();
    return (
      chunks.map((c) => decoder.decode(c, { stream: true })).join('') +
      decoder.decode()
    );
  };
  let exitCode = 0;
  try {
    (instance.exports._start as () => void)();
  } catch (error) {
    if (!(error instanceof WasiExit)) throw error;
    exitCode = error.code;
  }
  return { exitCode, stdout: decode(output[1]), stderr: decode(output[2]) };
}

/**
 * The `jaifmt.toml` that applies to `target`: the nearest one between the
 * file's folder and the workspace root, like the engine driver's lookup.
 */
export function formatConfigFor(
  documents: readonly { path: string; text: string }[],
  target: string
): { path: string; text: string } | undefined {
  const files = new Map(documents.map((d) => [d.path, d.text]));
  const folders = target.split('/').slice(0, -1);
  for (let depth = folders.length; depth >= 0; depth--) {
    const path = [...folders.slice(0, depth), FORMAT_CONFIG_PATH].join('/');
    const text = files.get(path);
    if (text !== undefined) return { path, text };
  }
  return undefined;
}

/** jaifmt.wasm's command line for one file. */
export function jaifmtArgs(name: string, config?: string): string[] {
  return [
    JAIFMT_WASM_ASSET,
    '--name',
    name,
    ...(config === undefined ? [] : ['--config', config]),
  ];
}

/**
 * Formats `target` from the workspace with jaifmt.wasm. The result has the
 * engine driver's shape: exit 0 with the whole file on stdout, or exit 1 with
 * one `jaifmt: ...` line on stderr. A trap is reported as a jaifmt error.
 */
export async function formatWithWasm(
  module: WebAssembly.Module,
  documents: readonly { path: string; text: string }[],
  target: string
): Promise<WasiResult> {
  const source = documents.find((d) => d.path === target);
  if (!source)
    return {
      exitCode: 1,
      stdout: '',
      stderr: `jaifmt: ${target}: cannot read the file\n`,
    };
  const config = formatConfigFor(documents, target);
  let result: WasiResult;
  try {
    result = await runWasi(
      module,
      jaifmtArgs(target, config?.text),
      source.text
    );
  } catch (error) {
    if (!(error instanceof WebAssembly.RuntimeError)) throw error;
    return {
      exitCode: 134,
      stdout: '',
      stderr: `jaifmt: jaifmt.wasm trapped: ${error.message}\n`,
    };
  }
  // jaifmt.wasm only sees the config text; name the file it came from.
  if (config && result.exitCode !== 0)
    result.stderr = result.stderr.replace(
      `jaifmt: ${FORMAT_CONFIG_PATH}:`,
      () => `jaifmt: ${config.path}:`
    );
  return result;
}
