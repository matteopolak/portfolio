import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FORMAT_DRIVER_PATH,
  formatConfigStarter,
  formatFiles,
  formatOutcome,
} from '../../src/lib/jai/format.ts';
import {
  formatConfigFor,
  formatWithWasm,
  jaifmtArgs,
  loadJaifmt,
  runWasi,
} from '../../src/lib/jai/jaifmt-wasm.ts';
import { createEngine } from '../../src/lib/jai/engine.ts';
import { starterFiles } from '../../src/lib/jai/starter.ts';

const documents = (files: Record<string, string>) =>
  Object.entries(files).map(([path, text]) => ({ path, text }));

test('the nearest jaifmt.toml applies, like the engine driver', () => {
  const files = documents({
    'jaifmt.toml': 'root',
    'a/jaifmt.toml': 'a',
    'a/b/c.jai': '',
    'd/e.jai': '',
  });
  assert.deepEqual(formatConfigFor(files, 'a/b/c.jai'), {
    path: 'a/jaifmt.toml',
    text: 'a',
  });
  assert.deepEqual(formatConfigFor(files, 'd/e.jai'), {
    path: 'jaifmt.toml',
    text: 'root',
  });
  assert.equal(
    formatConfigFor(documents({ 'main.jai': '' }), 'main.jai'),
    undefined
  );
  assert.deepEqual(jaifmtArgs('main.jai'), [
    'jaifmt.wasm',
    '--name',
    'main.jai',
  ]);
  assert.deepEqual(jaifmtArgs('x.jai', 'indent_width = 2\n'), [
    'jaifmt.wasm',
    '--name',
    'x.jai',
    '--config',
    'indent_width = 2\n',
  ]);
});

test('loading checks the release digest and reports engines without Memory64', async () => {
  const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  const digest = createHash('sha256').update(empty).digest('hex');
  assert.ok((await loadJaifmt(empty, digest)) instanceof WebAssembly.Module);
  assert.ok((await loadJaifmt(empty)) instanceof WebAssembly.Module);
  // What a browser without Memory64 says about jaifmt.wasm: use the driver.
  assert.equal(await loadJaifmt(empty, digest, () => false), undefined);
  await assert.rejects(loadJaifmt(empty, 'f'.repeat(64)), /metadata/);
});

/*
 * jaifmt.wasm from a local bundle, when given:
 * JAI_WASM_DIR=<tools/build_scripting_wasm.py --jaic ... --output dir> pnpm test:jai
 */
const local = process.env.JAI_WASM_DIR;
test(
  'jaifmt.wasm formats byte-identically to the engine driver',
  { skip: !local && 'set JAI_WASM_DIR' },
  async () => {
    const bytes = await readFile(join(local!, 'jaifmt.wasm'));
    const metadata = JSON.parse(
      await readFile(join(local!, 'build-metadata.json'), 'utf8')
    );
    const module = await loadJaifmt(bytes, metadata.jaifmt_wasm_sha256);
    assert.ok(module, 'node 24 runs Memory64');
    const engine = await createEngine(
      await readFile(join(local!, 'jai_wasm.wasm'))
    );
    const driver = await readFile(
      join(local!, 'jaifmt-playground.jai'),
      'utf8'
    );
    const viaDriver = (files: Record<string, string>, target: string) =>
      formatOutcome(
        engine.play(
          formatFiles(documents(files), target, driver),
          FORMAT_DRIVER_PATH,
          { budget: 200_000_000 }
        )
      );
    const viaWasm = async (files: Record<string, string>, target: string) =>
      formatOutcome(await formatWithWasm(module, documents(files), target));

    const tour = JSON.parse(
      await readFile(join(local!, 'tour.json'), 'utf8')
    ) as { files: string[] };
    const tourFiles: Record<string, string> = {
      'jaifmt.toml': formatConfigStarter,
    };
    for (const name of tour.files)
      tourFiles[name] = await readFile(join(local!, 'tour', name), 'utf8');
    const messy =
      'main :: () {\nx:=1;\n      if x==1 {\nprint("%\\n",x);\n}\n}\n\n\n\n\nf::(a:int,b:int)->int{return a+b;}\n';
    const cases: [Record<string, string>, string][] = [
      [starterFiles, 'main.jai'],
      [starterFiles, 'lib/math.jai'],
      [{ ...starterFiles, 'main.jai': messy }, 'main.jai'],
      [
        {
          ...starterFiles,
          'lib/jaifmt.toml': 'indent_width = 2\nmax_blank_lines = 0\n',
          'lib/math.jai': messy,
        },
        'lib/math.jai',
      ],
      [{ 'main.jai': 'x :: 1;\r\ny :: 2;\r\n' }, 'main.jai'],
      [{ 'main.jai': 'greet :: "héllo, wörld ✓";\n' }, 'main.jai'],
      ...tour.files
        .filter((name) => name.endsWith('.jai'))
        .map((name): [Record<string, string>, string] => [tourFiles, name]),
    ];
    for (const [files, target] of cases) {
      const expected = viaDriver(files, target);
      assert.ok('text' in expected, `${target}: driver failed`);
      assert.deepEqual(await viaWasm(files, target), expected, target);
    }

    // A bad config: one error line naming the config file, nothing formatted.
    const bad = await formatWithWasm(
      module,
      documents({
        'a/jaifmt.toml': 'indent_width = wide\n',
        'a/m.jai': 'x :: 1;\n',
      }),
      'a/m.jai'
    );
    assert.equal(bad.exitCode, 1);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /^jaifmt: a\/jaifmt\.toml: line 1: indent_width/);

    // Input that cannot be formatted safely is refused.
    const refused = await formatWithWasm(
      module,
      documents({ 'broken.jai': 'f :: () { x := (1; }\n' }),
      'broken.jai'
    );
    assert.equal(refused.exitCode, 1);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /^jaifmt: broken\.jai:.*unbalanced/);
    assert.ok('error' in formatOutcome(refused));

    // The shim itself: unknown options fail through proc_exit with jaifmt's message.
    const unknown = await runWasi(module, ['jaifmt.wasm', '--bogus', 'x'], '');
    assert.deepEqual(unknown, {
      exitCode: 1,
      stdout: '',
      stderr: 'jaifmt: unknown option --bogus\n',
    });
    // Input larger than one fd_read chunk (16 KiB) comes through whole.
    const long = Array.from(
      { length: 2000 },
      (_, i) => `v${i} :: ${i};\n`
    ).join('');
    assert.deepEqual(await runWasi(module, ['jaifmt.wasm'], long), {
      exitCode: 0,
      stdout: long,
      stderr: '',
    });
  }
);
