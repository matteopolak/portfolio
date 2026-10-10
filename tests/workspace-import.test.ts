import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryPath,
  hasBinaryExtension,
  IMPORT_LIMITS,
  isIgnoredPath,
  looksBinary,
  normalizeImportPath,
  planImport,
  skippedSummary,
} from '../src/lib/workspace-import.ts';
import { defaultFiles, defaultStarter } from '../src/lib/jai/starter.ts';
import { FORMAT_CONFIG_PATH } from '../src/lib/jai/format.ts';
import { LINT_SETTINGS } from '../src/lib/jai/language-client.ts';

test('the picked folder name is stripped and unsafe paths are dropped', () => {
  assert.equal(normalizeImportPath('myproj/src/main.jai'), 'src/main.jai');
  assert.equal(normalizeImportPath('myproj/main.jai'), 'main.jai');
  assert.equal(normalizeImportPath('myproj//./a.jai'), 'a.jai');
  assert.equal(normalizeImportPath('main.jai'), undefined);
  assert.equal(normalizeImportPath('myproj/../etc/passwd'), undefined);
  assert.equal(normalizeImportPath('/abs/main.jai'), undefined);
  assert.equal(normalizeImportPath('myproj\\main.jai'), undefined);
});

test('noise directories, OS files and binaries are filtered', () => {
  assert.ok(isIgnoredPath('.git/config'));
  assert.ok(isIgnoredPath('a/node_modules/x/index.js'));
  assert.ok(isIgnoredPath('target/debug/main'));
  assert.ok(isIgnoredPath('src/.DS_Store'));
  assert.ok(!isIgnoredPath('src/targets.jai'));
  assert.ok(hasBinaryExtension('img/logo.PNG'));
  assert.ok(!hasBinaryExtension('main.jai'));
  assert.ok(!hasBinaryExtension('.gitignore'));
  assert.ok(looksBinary(new Uint8Array([104, 105, 0, 1])));
  assert.ok(!looksBinary(new TextEncoder().encode('hello\n')));
  // Only the first 8 KB count.
  const late = new Uint8Array(9000).fill(65);
  late[8500] = 0;
  assert.ok(!looksBinary(late));
});

test('planImport keeps source files and reports what it skipped', () => {
  const plan = planImport([
    { path: 'p/main.jai', size: 10 },
    { path: 'p/lib/math.jai', size: 10 },
    { path: 'p/.git/HEAD', size: 5 },
    { path: 'p/node_modules/x.js', size: 5 },
    { path: 'p/logo.png', size: 5 },
    { path: 'p/huge.txt', size: IMPORT_LIMITS.fileBytes + 1 },
  ]);
  assert.deepEqual(
    plan.accepted.map((file) => file.path),
    ['main.jai', 'lib/math.jai']
  );
  assert.deepEqual(plan.skipped, { ignored: 2, binary: 1, large: 1 });
  assert.equal(plan.error, undefined);
  assert.equal(
    skippedSummary(plan.skipped),
    'Skipped 2 ignored, 1 binary, 1 too large.'
  );
});

test('planImport enforces the file count and size caps', () => {
  const many = Array.from({ length: IMPORT_LIMITS.files + 1 }, (_, index) => ({
    path: `p/f${index}.txt`,
    size: 1,
  }));
  assert.match(planImport(many).error ?? '', /limit is 500/u);
  const big = Array.from({ length: 6 }, (_, index) => ({
    path: `p/f${index}.txt`,
    size: 900 * 1024,
  }));
  assert.match(planImport(big).error ?? '', /5 MB/u);
  assert.match(
    planImport([{ path: 'p/a.png', size: 1 }]).error ?? '',
    /no text files/u
  );
});

test('the entry file is main.jai, then a nested main, then the first source', () => {
  assert.equal(entryPath(['a.jai', 'main.jai'], 'main.jai'), 'main.jai');
  assert.equal(
    entryPath(['a.jai', 'src/main.jai', 'x/y/main.jai'], 'main.jai'),
    'src/main.jai'
  );
  assert.equal(entryPath(['README.md', 'z.jai', 'a.jai'], 'main.jai'), 'a.jai');
  assert.equal(entryPath(['README.md'], 'main.jai'), 'README.md');
  assert.equal(entryPath([], 'main.jai'), undefined);
});

test('the default Jai workspace is hello world plus the tool configs', () => {
  const files = defaultFiles();
  assert.deepEqual(
    Object.keys(files).sort(),
    ['main.jai', FORMAT_CONFIG_PATH, LINT_SETTINGS].sort()
  );
  assert.match(files['main.jai'], /Hello, World!/u);
  assert.ok(
    files[FORMAT_CONFIG_PATH].length > 0 && files[LINT_SETTINGS].length > 0
  );
  assert.deepEqual(defaultStarter().open, ['main.jai']);
  // Each call returns fresh data.
  assert.notEqual(defaultFiles(), defaultFiles());
});
