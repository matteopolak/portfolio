# Jai formatter (Format button)

## What it is

The Jai workspace has a **Format** button (and Shift+Alt+F) that rewrites the open `.jai` file with jaifmt, the formatter in the compiler's `Jai_Format` stdlib module. It runs entirely in the browser, off the main thread. A `jaifmt.toml` at the workspace root (in the starter files) configures it.

There are two ways to run jaifmt, with the same result byte for byte:

- **`jaifmt.wasm`** (preferred): jaifmt compiled by the native compiler to a wasm64 WASI preview 1 command. About 1 ms for a 330-line file, roughly 60 times faster than the driver, and it does not need the compiler loaded. Needs Memory64 (Chrome/Edge 133+, Firefox 134+; not Safari releases).
- **The engine driver** (fallback): `jaifmt-playground.jai`, a small Jai program interpreted by the same WebAssembly compiler that runs programs. About 75 ms for the same file.

## How it works

1. **Loading.** `createSession` (`src/lib/jai/workspace-ui.ts`) calls `loadFormatter` while the compiler boots; the button is shown disabled meanwhile. `loadFormatter` starts a dedicated worker (`worker.ts`, without the compiler) and sends it `jaifmt-load`. The worker fetches `/jai/<revision>/jaifmt.wasm` and `build-metadata.json`, and `loadJaifmt` (`src/lib/jai/jaifmt-wasm.ts`) checks the module's SHA-256 against `jaifmt_wasm_sha256` (when the metadata has it), then `WebAssembly.validate`s and compiles it once.
   - Validates: the worker keeps the compiled module and every format goes there.
   - `validate` is false (no Memory64), the fetch fails (a release from before `jaifmt.wasm`) or the digest differs: that worker is terminated and `loadDriver` fetches `jaifmt-playground.jai`. If the driver is missing too, or has no `TARGET :: "...";` line, `driverMissing` is set and the button is hidden.
2. **Running `jaifmt.wasm`.** `formatSelected` → `runFormatter` posts `jaifmt` with the workspace documents and the target path. `formatWithWasm` finds the nearest `jaifmt.toml` (`formatConfigFor`: the target's folder, then each parent, like the driver) and calls `runWasi` with `["jaifmt.wasm", "--name", <path>, "--config", <toml text>]` and the file as stdin. `runWasi` instantiates the module afresh with a minimal `wasi_snapshot_preview1` shim: `fd_read` (fd 0 from the source), `fd_write` (fd 1/2 collected), `args_*`, empty `environ_*`, `clock_time_get` and `proc_exit` (throws, caught for the exit code); any other import returns `ENOSYS`. jaic's wasm64 modules pass WASI addresses as 32-bit offsets into the 64-bit memory; the shim accepts numbers or BigInts and re-reads `memory.buffer` on every call, since the module may grow it. A trap becomes exit 134 and a `jaifmt: jaifmt.wasm trapped: ...` error.
3. **Running the driver (fallback).** `formatFiles` (`src/lib/jai/format.ts`) copies every workspace file and adds the driver as `__jaifmt__.jai`, with its `TARGET` line pointing at the open file. A compiler worker of its own, created on the first format, runs it with `engine.play(files, "__jaifmt__.jai")`. Format never shares the execution worker: editing restarts auto-run, which terminates that worker and would kill the format run.
4. **Applying.** Both paths return the driver's contract, which `formatOutcome` turns into `{ text }` or `{ error }`:
   - Exit 0: stdout is the whole formatted file. `formatChange` computes one minimal change (the common prefix and suffix are kept). It is dispatched as a single CodeMirror transaction, so one undo restores the original. `mapOffset` keeps each cursor or selection end at the same place among the non-whitespace characters. Formatting only moves whitespace, so a cursor before `x` stays before `x` after a reindent. The status line then says `Formatted main.jai` (or that the file is already formatted).
   - Exit 1 (bad `jaifmt.toml`, input that does not lex, unbalanced brackets, a failed token-equivalence check): stdout is empty and the one `jaifmt: ...` stderr line is written to the output pane as an error. The file is left as it was. `jaifmt.wasm` only sees the config's text, so `formatWithWasm` rewrites its `jaifmt: jaifmt.toml:` prefix to the config's workspace path (`jaifmt: lib/jaifmt.toml: line 1: ...`); the driver names it `/workspace/lib/jaifmt.toml`.
   - A null exit code (driver only) means the driver itself failed to compile, for example a compiler build without `Jai_Format`. Its diagnostics are shown.
   - The file is also left alone if it changed while formatting (a version mismatch).
5. **Timing.** Each run logs to the console: `jaifmt.wasm: main.jai in 1.1 ms (3.0 ms with the worker round trip)`, or `jaifmt (engine driver): main.jai in 80.2 ms`.

The button is disabled for non-`.jai` files (such as `jaifmt.toml`), for read-only stdlib views, and while a format is running. Non-`.jai` files are also kept out of the language server (`LanguageClient.sync`), so `jaifmt.toml` gets no Jai diagnostics, hover or completion.

## How to change it

- **Button markup and style:** `CodeWorkspace.astro` (`data-code-format`). It is an icon button in the header's editor tools ([Editor tools](code-workspace.md#editor-tools)), rendered only for the multi-file Jai workspace. It starts `disabled` (and `hidden` when the release is disabled).
- **Shortcut:** the panel `keydown` listener in `workspace-ui.ts`. It matches `event.code === 'KeyF'`, because on macOS Alt changes `event.key`.
- **Default config:** `formatConfigStarter` in `src/lib/jai/format.ts`. Keep it to keys that `parse_config` accepts. Unknown keys are errors, and `case_indent`/`case_body_indent` cannot be written as `-1` (their "use `indent_width`" default), which is why they are commented out.
- **Starter files:** `src/lib/jai/starter.ts`.
- **Driver protocol changes** (output format, file name, `TARGET` line) must be matched in `formatFiles`/`formatOutcome` and in the driver-check regex in `loadDriver`. **`jaifmt.wasm` protocol changes** (arguments, exit codes, new WASI imports) go in `jaifmtArgs`, `formatWithWasm` and the `wasi` table in `runWasi`; an import the shim lacks gets an `ENOSYS` stub, so add real implementations rather than relying on that.
- **Worker messages:** `jaifmt-load` and `jaifmt` in `WorkerRequest`/`WorkerResponse` (`lsp-types.ts`), handled in `worker.ts` before the "compiler is not initialized" check.
- **Trying the fallback:** open the playground with `?jaifmt=engine` (`/playground/jai?jaifmt=engine`). The worker then treats `jaifmt.wasm` as unvalidatable, exactly as a browser without Memory64 would, and the driver is used.
- **Tests:** `tests/jai/format.test.ts` covers the pure helpers and runs the real driver through the engine; `tests/jai/jaifmt-wasm.test.ts` covers config lookup, arguments, digest checking and the no-Memory64 result, and with a local bundle runs `jaifmt.wasm` through the shim: byte-identical to the driver on the starter, the tour, messy input, a nested config, CRLF and non-ASCII text, plus a bad config, refused input, an unknown option (exit via `proc_exit`) and input longer than one `fd_read` chunk. The bundle needs `jaifmt.wasm`, so build it with `--jaic` (a native jaic with LLVM 23 and `wasm-ld`):

  ```sh
  # in the compiler repo
  cargo build -p jaic-cli
  python3 tools/build_scripting_wasm.py --release --output /path/to/jai-wasm --jaic target/debug/jaic
  # here (node 24: Memory64)
  JAI_WASM_DIR=/path/to/jai-wasm pnpm test:jai
  ```

## Configuration

`jaifmt.toml` (the starter version shows the defaults):

```toml
indent_width = 4           # spaces per block level, 1-16
# case_indent = 4          # `case` lines inside `if x == {`, 0-16; default indent_width
# case_body_indent = 4     # statements under a `case`, 0-16; default indent_width
max_blank_lines = 2        # longest run of blank lines kept, 0-100
brace_style = "same_line"  # or "preserve"
```

A `jaifmt.toml` in a subfolder applies to the files below it. The driver uses a 200-million-block budget, the same as Run.

## Dependencies

- The pinned compiler release must contain `jaifmt-playground.jai` and a stdlib with `Jai_Format`; releases built with `--jaic` also contain `jaifmt.wasm` and its `jaifmt_wasm_sha256` in `build-metadata.json` (checked by `scripts/verify-jai-bundle.py` when syncing).
- WebAssembly Memory64 for `jaifmt.wasm` (node 24 for its tests); otherwise the `jai_play_*` ABI (with the entry name on channel 2) for the driver.
- `@codemirror/state` `EditorSelection` for the remapped selection.
- See the compiler's `docs/tools/jaifmt.md` for the formatting rules themselves and `docs/native/wasm-target.md` for the wasm64 WASI target.
