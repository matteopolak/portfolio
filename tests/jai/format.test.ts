import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FORMAT_DRIVER_PATH,
  formatChange,
  formatConfigStarter,
  formatFiles,
  formatOutcome,
  mapOffset,
} from '../../src/lib/jai/format.ts';
import { createEngine } from '../../src/lib/jai/engine.ts';
import { starterFiles } from '../../src/lib/jai/starter.ts';

const driver = 'main :: () {}\nTARGET :: "main.jai";\n';

test('the driver is pointed at the target and joins the workspace', () => {
  const files = formatFiles(
    [
      { path: 'main.jai', text: 'a' },
      { path: 'jaifmt.toml', text: 'indent_width = 2\n' },
    ],
    'lib/"odd".jai',
    driver
  );
  assert.equal(files['main.jai'], 'a');
  assert.equal(files['jaifmt.toml'], 'indent_width = 2\n');
  assert.match(files[FORMAT_DRIVER_PATH], /^TARGET :: "lib\/\\"odd\\".jai";$/m);
  assert.throws(() => formatFiles([], 'main.jai', 'main :: () {}'), /TARGET/);
});

test('outcomes separate formatted text, jaifmt errors and driver failures', () => {
  const base = { stdout: '', stderr: '' };
  assert.deepEqual(formatOutcome({ ...base, exitCode: 0, stdout: 'x\n' }), {
    text: 'x\n',
  });
  assert.deepEqual(
    formatOutcome({
      ...base,
      exitCode: 1,
      stderr: 'jaifmt: main.jai:1:5: unbalanced\n',
    }),
    { error: 'jaifmt: main.jai:1:5: unbalanced' }
  );
  const failed = formatOutcome({
    ...base,
    exitCode: null,
    rendered: 'no Jai_Format\n',
  });
  assert.ok(
    'error' in failed && /failed to run[\s\S]*no Jai_Format/.test(failed.error)
  );
});

test('the change keeps the common prefix and suffix', () => {
  assert.equal(formatChange('same', 'same'), undefined);
  assert.deepEqual(formatChange('a  =  1;\nb;\n', 'a = 1;\nb;\n'), {
    from: 2,
    to: 5,
    insert: '=',
  });
});

test('the cursor keeps its place among non-whitespace characters', () => {
  const before = 'f :: () {\n  x  :=  1;\n}\n';
  const after = 'f :: () {\n    x := 1;\n}\n';
  const change = formatChange(before, after)!;
  const at = (text: string, needle: string) => text.indexOf(needle);
  // Before `x`, before `1`, after `1`, and outside the change.
  assert.equal(mapOffset(before, change, at(before, 'x')), at(after, 'x'));
  assert.equal(mapOffset(before, change, at(before, '1')), at(after, '1'));
  assert.equal(mapOffset(before, change, at(before, ';')), at(after, ';'));
  assert.equal(mapOffset(before, change, 3), 3);
  assert.equal(mapOffset(before, change, before.length), after.length);
});

test('the starter workspace ships a jaifmt.toml with the defaults', () => {
  assert.equal(starterFiles['jaifmt.toml'], formatConfigStarter);
  for (const line of formatConfigStarter.split('\n')) {
    const code = line.replace(/#.*/, '').trim();
    if (code)
      assert.match(code, /^(indent_width|max_blank_lines|brace_style) = /);
  }
});

/*
 * End to end through the real compiler, when a local build is given:
 * JAI_WASM_DIR=<tools/build_scripting_wasm.py --output dir> pnpm test:jai
 */
const local = process.env.JAI_WASM_DIR;
test(
  'jaifmt formats through the engine',
  { skip: !local && 'set JAI_WASM_DIR' },
  async () => {
    const engine = await createEngine(
      await readFile(join(local!, 'jai_wasm.wasm'))
    );
    const realDriver = await readFile(
      join(local!, 'jaifmt-playground.jai'),
      'utf8'
    );
    const format = (files: Record<string, string>, target = 'main.jai') =>
      formatOutcome(
        engine.play(
          formatFiles(
            Object.entries(files).map(([path, text]) => ({ path, text })),
            target,
            realDriver
          ),
          FORMAT_DRIVER_PATH,
          { budget: 200_000_000 }
        )
      );
    // The starter is already formatted under its own config.
    for (const name of ['main.jai', 'lib/math.jai'])
      assert.deepEqual(format(starterFiles, name), {
        text: starterFiles[name],
      });
    const messy =
      'main :: () {\nx:=1;\n      if x==1 {\nprint("%\\n",x);\n}\n}\n';
    const files = { ...starterFiles, 'main.jai': messy };
    assert.deepEqual(format(files), {
      text: 'main :: () {\n    x := 1;\n    if x == 1 {\n        print("%\\n", x);\n    }\n}\n',
    });
    const two = format({ ...files, 'jaifmt.toml': 'indent_width = 2\n' });
    assert.deepEqual(two, {
      text: 'main :: () {\n  x := 1;\n  if x == 1 {\n    print("%\\n", x);\n  }\n}\n',
    });
    const badConfig = format({
      ...files,
      'jaifmt.toml': 'indent_width = wide\n',
    });
    assert.ok(
      'error' in badConfig &&
        /jaifmt\.toml: line 1: indent_width/.test(badConfig.error)
    );
    const refused = format({ ...files, 'main.jai': 'f :: () { x := (1; }\n' });
    assert.ok('error' in refused && /unbalanced/.test(refused.error));
  }
);

test(
  'the tour runs and is already formatted under the default jaifmt.toml',
  { skip: !local && 'set JAI_WASM_DIR' },
  async () => {
    const index = JSON.parse(
      await readFile(join(local!, 'tour.json'), 'utf8')
    ) as { files: string[] };
    const files: Record<string, string> = {
      'jaifmt.toml': formatConfigStarter,
    };
    for (const name of index.files)
      files[name] = await readFile(join(local!, 'tour', name), 'utf8');
    const engine = await createEngine(
      await readFile(join(local!, 'jai_wasm.wasm'))
    );
    const run = engine.play(files, 'main.jai', { budget: 200_000_000 });
    assert.equal(run.exitCode, 0, run.stderr);
    assert.match(run.stdout, /That's the tour/);
    const realDriver = await readFile(
      join(local!, 'jaifmt-playground.jai'),
      'utf8'
    );
    for (const name of index.files.filter((file) => file.endsWith('.jai'))) {
      const documents = Object.entries(files).map(([path, text]) => ({
        path,
        text,
      }));
      const result = formatOutcome(
        engine.play(
          formatFiles(documents, name, realDriver),
          FORMAT_DRIVER_PATH,
          { budget: 200_000_000 }
        )
      );
      assert.deepEqual(result, { text: files[name] }, name);
    }
  }
);
