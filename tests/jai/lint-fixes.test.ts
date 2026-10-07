import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FIX_ALL,
  LINT_DOCS,
  combineFixes,
  diagnosticsAt,
  fixAllAction,
  fixLabel,
  fixRule,
  fixesFor,
  lintDocs,
  lintMessage,
  lintRule,
  offersFixAll,
  rangesTouch,
} from '../../src/lib/jai/lint-fixes.ts';
import { LanguageClient } from '../../src/lib/jai/language-client.ts';
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
const fix = (
  title: string,
  at: Range,
  newText: string,
  rule?: string
): CodeAction => ({
  title,
  kind: 'quickfix',
  edit: { changes: { [URI]: [{ range: at, newText }] } },
  ...(rule && { data: { rule } }),
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
  assert.equal(
    lintRule({ ...lint, code: 'jai-format', source: 'jai' }),
    undefined
  );
  assert.equal(lintRule({ ...lint, code: 'Not A Rule' }), undefined);
});

test('a lint message splits into the finding and its help line', () => {
  assert.deepEqual(lintMessage('unused variable `x`\nremove it'), {
    text: 'unused variable `x`',
    help: 'remove it',
  });
  assert.deepEqual(lintMessage('no help'), { text: 'no help' });
  assert.deepEqual(lintMessage('trailing\n'), {
    text: 'trailing',
    help: undefined,
  });
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

test("a rule's fixes are picked out by data.rule, then their lint", () => {
  const lint: Diagnostic = {
    range: range(4, 7, 4, 17),
    code: 'bool_comparison',
    source: 'jailint',
    message: 'comparing a bool with `true`',
  };
  const actions: CodeAction[] = [
    {
      title: 'Show #run result',
      command: { title: 'x', command: 'jai.showExpansion' },
    },
    {
      title: 'Replace #run with its value',
      kind: 'refactor.inline',
      edit: { changes: {} },
    },
    fix('Remove it', range(2, 0, 3, 0), '', 'unused_variable'),
    // No data: the lint it carries names the rule.
    { ...fix('Write `ok`', range(4, 7, 4, 17), 'ok'), diagnostics: [lint] },
  ];
  assert.deepEqual(
    fixesFor(actions, 'unused_variable').map((a) => a.title),
    ['Remove it']
  );
  assert.deepEqual(
    fixesFor(actions, 'bool_comparison').map((a) => a.title),
    ['Write `ok`']
  );
  assert.deepEqual(fixesFor(actions, 'shadowed_it'), []);
  assert.deepEqual(fixesFor(null, 'unused_variable'), []);
  // Titles are labels only; they no longer name the rule.
  assert.equal(fixRule(fix('Remove it', range(0, 0, 0, 0), '')), undefined);
  assert.equal(fixLabel(actions[3]), 'Write `ok`');
  // Servers before sentence-case titles: `<fix> (<rule>)`.
  const older = fix('remove it (unused_variable)', range(2, 0, 3, 0), '');
  assert.equal(fixRule(older), 'unused_variable');
  assert.equal(fixLabel(older), 'remove it');
});

test("the server's fix-all action and per-rule docs are used when present", () => {
  const all: CodeAction = {
    title: 'Fix 2 lint problems',
    kind: FIX_ALL,
    edit: { changes: {} },
  };
  assert.equal(
    fixAllAction([fix('Remove it', range(0, 0, 0, 1), ''), all]),
    all
  );
  assert.equal(
    fixAllAction([fix('Remove it', range(0, 0, 0, 1), '')]),
    undefined
  );
  assert.ok(
    offersFixAll({ codeActionKinds: ['quickfix', 'refactor.inline', FIX_ALL] })
  );
  assert.ok(!offersFixAll({ codeActionKinds: ['quickfix'] }));
  assert.ok(!offersFixAll(true));
  const lint: Diagnostic = {
    range: range(2, 4, 2, 5),
    code: 'unused_variable',
    source: 'jailint',
    message: 'unused variable `x`',
  };
  const href =
    'https://github.com/matteopolak/jai/blob/main/docs/tools/jailint.md#unused_variable';
  assert.equal(lintDocs({ ...lint, codeDescription: { href } }), href);
  assert.equal(lintDocs(lint), LINT_DOCS);
  assert.equal(
    lintDocs({ ...lint, codeDescription: { href: 'javascript:alert(1)' } }),
    LINT_DOCS
  );
});

test('jailint.toml files are synced to the server; other settings are not', () => {
  const posted: { method?: string; params?: unknown }[] = [];
  const worker = Object.assign(new EventTarget(), {
    postMessage: (data: { message: { method?: string; params?: unknown } }) =>
      posted.push(data.message),
  }) as unknown as Worker;
  const client = new LanguageClient(worker);
  const documents = [
    { path: 'main.jai', version: 1, text: 'main :: () {}' },
    { path: 'jaifmt.toml', version: 1, text: 'indent_width = 2\n' },
    { path: 'jailint.toml', version: 1, text: '[rules]\n' },
    { path: 'lib/jailint.toml', version: 1, text: '' },
    { path: 'notjailint.toml', version: 1, text: '' },
  ];
  client.sync(documents);
  const opened = posted.map(
    (m) =>
      (m.params as { textDocument: { uri: string; languageId: string } })
        .textDocument
  );
  assert.deepEqual(
    opened.map(({ uri, languageId }) => [uri, languageId]),
    [
      ['file:///jai-script/main.jai', 'jai'],
      ['file:///jai-script/jailint.toml', 'toml'],
      ['file:///jai-script/lib/jailint.toml', 'toml'],
    ]
  );
  posted.length = 0;
  client.sync([
    documents[0],
    { path: 'jailint.toml', version: 2, text: '[rules]\nx = "allow"\n' },
  ]);
  assert.deepEqual(
    posted.map((m) => m.method),
    ['textDocument/didChange', 'textDocument/didClose']
  );
});

test('fix all merges quick fixes and leaves overlapping ones for the next run', () => {
  const text =
    '#import "Basic";\nmain :: () {\n    x := 3;\n    ok := true;\n    if ok == true print("hi\\n");\n}\n';
  const { edit, applied, skipped } = combineFixes([
    {
      title: 'Show expansion',
      command: { title: 'x', command: 'jai.showExpansion' },
    },
    fix('write `ok` (bool_comparison)', range(4, 7, 4, 17), 'ok'),
    fix('remove it (unused_variable)', range(2, 0, 3, 0), ''),
    // Overlaps the bool_comparison fix.
    fix('rename to `_` (unused_variable)', range(4, 7, 4, 9), '_'),
    // Inserts where another fix already inserts: order would be ambiguous.
    fix('a (r)', range(2, 0, 2, 0), 'x'),
    // The compiler's import fix is not a lint fix: neither applied nor skipped.
    {
      ...fix('Add `#import "Math";`', range(1, 0, 1, 0), '#import "Math";\n'),
      diagnostics: [
        {
          range: range(4, 21, 4, 25),
          severity: 1,
          source: 'jai',
          code: 'jai-check',
          message: 'unknown identifier `sqrt`',
        },
      ],
    },
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
  assert.deepEqual(combineFixes([]), {
    edit: { changes: {} },
    applied: 0,
    skipped: 0,
  });
});

/*
 * Through the real language server, when a local build is given:
 * JAI_WASM_DIR=<tools/build_scripting_wasm.py --output dir> pnpm test:jai
 */
const local = process.env.JAI_WASM_DIR;

async function server() {
  const engine = await createEngine(
    await readFile(join(local!, 'jai_wasm.wasm'))
  );
  let id = 0;
  const send = (method: string, params: unknown, notify = false) =>
    engine.lsp!({
      jsonrpc: '2.0',
      ...(notify ? {} : { id: ++id }),
      method,
      params,
    } as JsonRpcMessage);
  const initialized = send('initialize', { capabilities: {} });
  send('initialized', {}, true);
  const capabilities = (
    initialized.find((m) => m.id === 1)!.result as {
      capabilities: { codeActionProvider?: { codeActionKinds?: string[] } };
    }
  ).capabilities;
  return { send, capabilities };
}

const published = (messages: JsonRpcMessage[]) =>
  messages
    .filter((m) => m.method === 'textDocument/publishDiagnostics')
    .map((m) => m.params as { uri: string; diagnostics: Diagnostic[] });

test(
  'a lint is published with a quick fix the client can apply',
  { skip: !local && 'set JAI_WASM_DIR' },
  async () => {
    const { send, capabilities } = await server();
    assert.ok(
      capabilities.codeActionProvider?.codeActionKinds?.includes('quickfix')
    );
    const text =
      '#import "Basic";\nmain :: () {\n    x := 3;\n    ok := true;\n    if ok == true print("hi\\n");\n}\n';
    const opened = send(
      'textDocument/didOpen',
      { textDocument: { uri: URI, languageId: 'jai', version: 1, text } },
      true
    );
    const diagnostics =
      published(opened).find((p) => p.uri === URI)?.diagnostics ?? [];
    assert.deepEqual(diagnostics.map(lintRule).sort(), [
      'bool_comparison',
      'unused_variable',
    ]);
    const unused = diagnostics.find((d) => lintRule(d) === 'unused_variable')!;
    const reply = send('textDocument/codeAction', {
      textDocument: { uri: URI },
      range: unused.range,
      context: { diagnostics: [unused], only: ['quickfix'] },
    });
    const fixes = fixesFor(
      reply.find((m) => m.id !== undefined)?.result as CodeAction[],
      'unused_variable'
    );
    assert.equal(fixes.length, 1);
    assert.match(fixLabel(fixes[0]), /^[A-Z]/u, 'sentence case');
    assert.equal(
      lintDocs(unused),
      `${LINT_DOCS.replace(/#rules$/u, '')}#unused_variable`
    );
    const fixed =
      '#import "Basic";\nmain :: () {\n    ok := true;\n    if ok print("hi\\n");\n}\n';
    // The server's fix-all, as the Fix all button asks for it.
    assert.ok(offersFixAll(capabilities.codeActionProvider));
    const whole = send('textDocument/codeAction', {
      textDocument: { uri: URI },
      range: range(0, 0, 6, 0),
      context: { diagnostics, only: [FIX_ALL] },
    });
    const actions = whole.find((m) => m.id !== undefined)
      ?.result as CodeAction[];
    assert.deepEqual(
      actions.map((a) => a.kind),
      [FIX_ALL]
    );
    const all = fixAllAction(actions)!;
    assert.equal(all.title, 'Fix 2 lint problems');
    const [planned] = planWorkspaceEdit(
      [{ path: 'main.jai', version: 1, text }],
      all.edit!
    );
    assert.equal(planned.text, fixed);
    // The client-side merge (servers without fix-all) agrees.
    const quick = send('textDocument/codeAction', {
      textDocument: { uri: URI },
      range: range(0, 0, 6, 0),
      context: { diagnostics, only: ['quickfix'] },
    });
    const merged = combineFixes(
      quick.find((m) => m.id !== undefined)?.result as CodeAction[]
    );
    assert.equal(merged.applied, 2);
    assert.equal(
      planWorkspaceEdit(
        [{ path: 'main.jai', version: 1, text }],
        merged.edit
      )[0].text,
      fixed
    );

    // A workspace jailint.toml, sent as an open document, sets the levels.
    const settings = 'file:///jai-script/jailint.toml';
    const allowed = send(
      'textDocument/didOpen',
      {
        textDocument: {
          uri: settings,
          languageId: 'toml',
          version: 1,
          text: '[rules]\nunused_variable = "allow"\nbool_comparison = "deny"\n',
        },
      },
      true
    );
    assert.ok(!published(allowed).some((p) => p.uri === settings));
    const relinted = send(
      'textDocument/didChange',
      {
        textDocument: { uri: URI, version: 2 },
        contentChanges: [{ text }],
      },
      true
    );
    const now = published(relinted).find((p) => p.uri === URI)!.diagnostics;
    assert.deepEqual(
      now.map((d) => [lintRule(d), d.severity]),
      [['bool_comparison', 1]]
    );
  }
);

test(
  'the starter and the tour have no lints',
  { skip: !local && 'set JAI_WASM_DIR' },
  async () => {
    const index = JSON.parse(
      await readFile(join(local!, 'tour.json'), 'utf8')
    ) as { files: string[] };
    const tour: Record<string, string> = {};
    for (const name of index.files)
      tour[name] = await readFile(join(local!, 'tour', name), 'utf8');
    for (const [label, files] of [
      ['starter', starterFiles],
      ['tour', tour],
    ] as const) {
      const { send } = await server();
      // The last diagnostics each file got, once every file is open.
      const last = new Map<string, Diagnostic[]>();
      for (const [path, text] of Object.entries(files)) {
        if (!path.endsWith('.jai')) continue;
        const uri = `file:///jai-script/${path}`;
        const messages = send(
          'textDocument/didOpen',
          { textDocument: { uri, languageId: 'jai', version: 1, text } },
          true
        );
        for (const p of published(messages)) last.set(p.uri, p.diagnostics);
      }
      const found = [...last].flatMap(([uri, diagnostics]) =>
        diagnostics.map((d) => `${uri}: ${d.code} ${String(d.message)}`)
      );
      assert.deepEqual(found, [], label);
    }
  }
);

test(
  'an unknown name gets a quick fix that adds the import declaring it',
  { skip: !local && 'set JAI_WASM_DIR' },
  async () => {
    const { send } = await server();
    const text = '// Hello.\n\nmain :: () {\n    print("hi\\n");\n}\n';
    const opened = send(
      'textDocument/didOpen',
      { textDocument: { uri: URI, languageId: 'jai', version: 1, text } },
      true
    );
    const diagnostics =
      published(opened).find((p) => p.uri === URI)?.diagnostics ?? [];
    const error = diagnostics.find((d) => d.code === 'jai-check')!;
    assert.equal(error.source, 'jai');
    assert.equal(lintRule(error), undefined);
    // What the lightbulb asks for: the diagnostics at the cursor, any kind.
    const reply = send('textDocument/codeAction', {
      textDocument: { uri: URI },
      range: { start: error.range.start, end: error.range.start },
      context: { diagnostics: diagnosticsAt(diagnostics, error.range) },
    });
    const actions = reply.find((m) => m.id !== undefined)
      ?.result as CodeAction[];
    const [add] = actions.filter((a) => a.kind === 'quickfix');
    assert.equal(add.title, 'Add `#import "Basic";`');
    assert.equal(add.isPreferred, true);
    assert.equal(fixRule(add), undefined);
    assert.equal(
      planWorkspaceEdit([{ path: 'main.jai', version: 1, text }], add.edit!)[0]
        .text,
      '// Hello.\n\n#import "Basic";\n\nmain :: () {\n    print("hi\\n");\n}\n'
    );
    // Not a lint fix: "Fix all lints" leaves it alone.
    assert.equal(combineFixes(actions).applied, 0);
  }
);
