# Jai formatter (Format button)

## What it is

The Jai workspace has a **Format** button (and Shift+Alt+F) that rewrites the open `.jai` file with jaifmt, the formatter in the compiler's `Jai_Format` stdlib module. It runs entirely in the browser through the same WebAssembly compiler that runs programs. A `jaifmt.toml` at the workspace root (in the starter files) configures it.

## How it works

1. **The driver.** The compiler repo's `tools/jaifmt/playground.jai` is a small Jai program. It reads `/workspace/<TARGET>`, finds the nearest `jaifmt.toml` between that file's directory and `/workspace`, and calls `parse_config` and `format_source`. On success it prints the formatted file to stdout and exits 0. On failure it prints one `jaifmt: ...` line to stderr and exits 1. `tools/build_scripting_wasm.py` stages it as `jaifmt-playground.jai` next to `jai_wasm.wasm`, so it ships in every browser release bundle. The portfolio serves it at `/jai/<revision>/jaifmt-playground.jai`.
2. **Loading.** `createSession` (`src/lib/jai/workspace-ui.ts`) fetches the driver while the compiler boots. The button is shown disabled meanwhile. If the fetch fails (a release from before jaifmt) or the file has no `TARGET :: "...";` line, `driverMissing` is set and the button is hidden.
3. **Running.** `formatFiles` (`src/lib/jai/format.ts`) copies every workspace file and adds the driver as `__jaifmt__.jai`, with its `TARGET` line pointing at the open file. A dedicated worker, created on the first format, runs it with `engine.play(files, "__jaifmt__.jai")`: the `play` request in `worker.ts`/`engine.ts`. Running format on its own worker matters: editing restarts auto-run, which terminates the execution worker, so sharing that worker would kill the format run.
4. **Applying.** `formatOutcome` turns the result into `{ text }` or `{ error }`:
   - Exit 0: `formatChange` computes one minimal change (the common prefix and suffix are kept). It is dispatched as a single CodeMirror transaction, so one undo restores the original. `mapOffset` keeps each cursor or selection end at the same place among the non-whitespace characters. Formatting only moves whitespace, so a cursor before `x` stays before `x` after a reindent. The status line then says `Formatted main.jai` (or that the file is already formatted).
   - Exit 1 (bad `jaifmt.toml`, input that does not lex, unbalanced brackets, a failed token-equivalence check): the stderr line is written to the output pane as an error. The file is left as it was.
   - A null exit code means the driver itself failed to compile, for example a compiler build without `Jai_Format`. Its diagnostics are shown.
   - The file is also left alone if it changed while formatting (a version mismatch).

The button is disabled for non-`.jai` files (such as `jaifmt.toml`), for read-only stdlib views, and while a format is running. Non-`.jai` files are also kept out of the language server (`LanguageClient.sync`), so `jaifmt.toml` gets no Jai diagnostics, hover or completion.

## How to change it

- **Button markup and style:** `CodeWorkspace.astro` (`data-code-format`). It is an icon button in the header's editor tools ([Editor tools](code-workspace.md#editor-tools)), rendered only for the multi-file Jai workspace. It starts `disabled` (and `hidden` when the release is disabled).
- **Shortcut:** the panel `keydown` listener in `workspace-ui.ts`. It matches `event.code === 'KeyF'`, because on macOS Alt changes `event.key`.
- **Default config:** `formatConfigStarter` in `src/lib/jai/format.ts`. Keep it to keys that `parse_config` accepts. Unknown keys are errors, and `case_indent`/`case_body_indent` cannot be written as `-1` (their "use `indent_width`" default), which is why they are commented out.
- **Starter files:** `src/lib/jai/starter.ts`.
- **Driver protocol changes** (output format, file name, `TARGET` line) must be matched in `formatFiles`/`formatOutcome` and in the driver-check regex in `loadDriver`.
- **Tests:** `tests/jai/format.test.ts` covers the pure helpers. Its last test runs the real driver through the engine when `JAI_WASM_DIR` points at a `build_scripting_wasm.py` output (the starter stays unchanged, a messy file is formatted, `indent_width = 2` applies, and a bad config and unbalanced input are refused):

  ```sh
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

- The pinned compiler release must contain `jaifmt-playground.jai` and a stdlib with `Jai_Format` (compiler commits after the jaifmt browser driver and its staging in `build_scripting_wasm.py`).
- The `jai_play_*` ABI (with the entry name on channel 2).
- `@codemirror/state` `EditorSelection` for the remapped selection.
- See the compiler's `docs/tools/jaifmt.md` for the formatting rules themselves.
