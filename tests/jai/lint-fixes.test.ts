import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  combineFixes,
  diagnosticsAt,
  fixLabel,
  fixesFor,
  lintMessage,
  lintRule,
  rangesTouch,
} from '../../src/lib/jai/lint-fixes.ts';
import { planWorkspaceEdit } from '../../src/lib/jai/language-actions.ts';
import { createEngine } from '../../src/lib/jai/engine.ts';
import { starterFiles } from '../../src/lib/jai/starter.ts';
import type {
  CodeAction,
  Diagnostic,
  JsonRpcMessage,
  Range,
} from '../../src/lib/jai/lsp-types.ts';

const URI = 'file:///jai-script/main.jai';
const range = (
  line: number,
  character: number,
  endLine: number,
  endCharacter: number
): Range => ({
  start: { line, character },
  end: { line: endLine, character: endCharacter },
});
const fix = (title: string, at: Range, newText: string): CodeAction => ({
  title,
  kind: 'quickfix',
  edit: { changes: { [URI]: [{ range: at, newText }] } },
});

test('only jailint diagnostics name a rule', () => {
  const lint: Diagnostic = {
    range: range(2, 4, 2, 5),
    severity: 2,
    code: 'unused_variable',
    source: 'jailint',
    message: 'unused variable `x`\nremove it',
  };
  assert.equal(lintRule(lint), 'unused_variable');
  assert.equal(lintRule({ ...lint, source: undefined }), undefined);
  assert.equal(lintRule({ ...lint, code: 'jai-format', source: 'jai' }), undefined);
  assert.equal(lintRule({ ...lint, code: 'Not A Rule' }), undefined);
});

test('a lint message splits into the finding and its help line', () => {
  assert.deepEqual(lintMessage('unused variable `x`\nremove it'), {
    text: 'unused variable `x`',
    help: 'remove it',
  });
  assert.deepEqual(lintMessage('no help'), { text: 'no help' });
  assert.deepEqual(lintMessage('trailing\n'), { text: 'trailing', help: undefined });
});

test('ranges touch like the server matches lints, empty ranges included', () => {
  assert.ok(rangesTouch(range(2, 4, 2, 5), range(2, 5, 2, 5)));
  assert.ok(rangesTouch(range(2, 4, 2, 5), range(0, 0, 9, 0)));
  assert.ok(!rangesTouch(range(2, 4, 2, 5), range(2, 6, 2, 8)));
  assert.ok(!rangesTouch(range(2, 4, 2, 5), range(1, 0, 2, 3)));
  const diagnostics: Diagnostic[] = [
    { range: range(2, 4, 2, 5), message: 'a' },
    { range: range(4, 7, 4, 17), message: 'b' },
  ];
  assert.deepEqual(
    diagnosticsAt(diagnostics, range(4, 9, 4, 9)).map((d) => d.message),
    ['b']
  );
});

test("a rule's fixes are picked out by their title", () => {
  const actions: CodeAction[] = [
    { title: 'Show #run result', command: { title: 'x', command: 'jai.showExpansion' } },
    { title: 'Replace #run with its value', kind: 'refactor.inline', edit: { changes: {} } },
    fix('remove it (unused_variable)', range(2, 0, 3, 0), ''),
    fix('write `ok` (bool_comparison)', range(4, 7, 4, 17), 'ok'),
  ];
  assert.deepEqual(
    fixesFor(actions, 'unused_variable').map((a) => a.title),
    ['remove it (unused_variable)']
  );
  assert.deepEqual(fixesFor(actions, 'shadowed_it'), []);
  assert.deepEqual(fixesFor(null, 'unused_variable'), []);
  assert.equal(fixLabel(actions[3]), 'write `ok`');
});

test('fix all merges quick fixes and leaves overlapping ones for the next run', () => {
  const text = '#import "Basic";\nmain :: () {\n    x := 3;\n    ok := true;\n    if ok == true print("hi\\n");\n}\n';
  const { edit, applied, skipped } = combineFixes([
    { title: 'Show expansion', command: { title: 'x', command: 'jai.showExpansion' } },
    fix('write `ok` (bool_comparison)', range(4, 7, 4, 17), 'ok'),
    fix('remove it (unused_variable)', range(2, 0, 3, 0), ''),
    // Overlaps the bool_comparison fix.
    fix('rename to `_` (unused_variable)', range(4, 7, 4, 9), '_'),
    // Inserts where another fix already inserts: order would be ambiguous.
    fix('a (r)', range(2, 0, 2, 0), 'x'),
  ]);
  assert.equal(applied, 2);
  assert.equal(skipped, 2);
  const [planned] = planWorkspaceEdit(
    [{ path: 'main.jai', version: 1, text }],
    edit
  );
  assert.equal(
    planned.text,
    '#import "Basic";\nmain :: () {\n    ok := true;\n    if ok print("hi\\n");\n}\n'
  );
  assert.deepEqual(combineFixes([]), { edit: { changes: {} }, applied: 0, skipped: 0 });
});

/*
 * Through the real language server, when a local build is given:
 * JAI_WASM_DIR=<tools/build_scripting_wasm.py --output dir> pnpm test:jai
 */
const local = process.env.JAI_WASM_DIR;

async function server() {
  const engine = await createEngine(await readFile(join(local!, 'jai_wasm.wasm')));
  let id = 0;
  const send = (method: string, params: unknown, notify = false) =>
    engine.lsp!({ jsonrpc: '2.0', ...(notify ? {} : { id: ++id }), method, params } as JsonRpcMessage);
  const initialized = send('initialize', { capabilities: {} });
  send('initialized', {}, true);
  const capabilities = (initialized.find((m) => m.id === 1)?.result as {
    capabilities: { codeActionProvider?: { codeActionKinds?: string[] } };
  }).capabilities;
  return { send, capabilities };
}

const published = (messages: JsonRpcMessage[]) =>
  messages
    .filter((m) => m.method === 'textDocument/publishDiagnostics')
    .map((m) => m.params as { uri: string; diagnostics: Diagnostic[] });

test('a lint is published with a quick fix the client can apply', { skip: !local && 'set JAI_WASM_DIR' }, async () => {
  const { send, capabilities } = await server();
  assert.ok(capabilities.codeActionProvider?.codeActionKinds?.includes('quickfix'));
  const text = '#import "Basic";\nmain :: () {\n    x := 3;\n    ok := true;\n    if ok == true print("hi\\n");\n}\n';
  const opened = send('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'jai', version: 1, text } }, true);
  const diagnostics = published(opened).find((p) => p.uri === URI)?.diagnostics ?? [];
  assert.deepEqual(diagnostics.map(lintRule).sort(), ['bool_comparison', 'unused_variable']);
  const unused = diagnostics.find((d) => lintRule(d) === 'unused_variable')!;
  const reply = send('textDocument/codeAction', {
    textDocument: { uri: URI },
    range: unused.range,
    context: { diagnostics: [unused], only: ['quickfix'] },
  });
  const fixes = fixesFor(reply.find((m) => m.id !== undefined)?.result as CodeAction[], 'unused_variable');
  assert.equal(fixes.length, 1);
  const whole = send('textDocument/codeAction', {
    textDocument: { uri: URI },
    range: range(0, 0, 6, 0),
    context: { diagnostics },
  });
  const all = combineFixes(whole.find((m) => m.id !== undefined)?.result as CodeAction[]);
  assert.equal(all.applied, 2);
  const [planned] = planWorkspaceEdit([{ path: 'main.jai', version: 1, text }], all.edit);
  assert.equal(planned.text, '#import "Basic";\nmain :: () {\n    ok := true;\n    if ok print("hi\\n");\n}\n');
});

test('the starter and the tour have no lints', { skip: !local && 'set JAI_WASM_DIR' }, async () => {
  const index = JSON.parse(await readFile(join(local!, 'tour.json'), 'utf8')) as { files: string[] };
  const tour: Record<string, string> = {};
  for (const name of index.files) tour[name] = await readFile(join(local!, 'tour', name), 'utf8');
  for (const [label, files] of [['starter', starterFiles], ['tour', tour]] as const) {
    const { send } = await server();
    // The last diagnostics each file got, once every file is open.
    const last = new Map<string, Diagnostic[]>();
    for (const [path, text] of Object.entries(files)) {
      if (!path.endsWith('.jai')) continue;
      const uri = `file:///jai-script/${path}`;
      const messages = send('textDocument/didOpen', { textDocument: { uri, languageId: 'jai', version: 1, text } }, true);
      for (const p of published(messages)) last.set(p.uri, p.diagnostics);
    }
    const found = [...last].flatMap(([uri, diagnostics]) =>
      diagnostics.map((d) => `${uri}: ${d.code} ${String(d.message)}`)
    );
    assert.deepEqual(found, [], label);
  }
});
