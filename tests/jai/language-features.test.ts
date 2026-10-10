import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentUri,
  linkTarget,
  pathFromUri,
  resourceFromUri,
} from '../../src/lib/jai/language-client.ts';
import {
  normalizeLocations,
  planWorkspaceEdit,
} from '../../src/lib/jai/language-actions.ts';
import {
  decodeSemanticTokens,
  inlayLabel,
  provides,
  signatureParts,
  signatureView,
  supportsCommand,
  tokenClass,
  tokenLegend,
} from '../../src/lib/jai/lsp-features.ts';

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

test('workspace URIs map to paths and back', () => {
  const uri = documentUri('lib/my math.jai');
  assert.equal(uri, 'file:///jai-script/lib/my%20math.jai');
  assert.equal(pathFromUri(uri), 'lib/my math.jai');
  assert.deepEqual(resourceFromUri(uri), {
    kind: 'workspace',
    path: 'lib/my math.jai',
    uri,
  });
});

test('stdlib and module URIs are read-only library files', () => {
  const uri = 'file:///stdlib/Basic/module.jai';
  assert.equal(pathFromUri(uri), undefined);
  assert.deepEqual(resourceFromUri(uri), {
    kind: 'library',
    path: 'stdlib/Basic/module.jai',
    uri,
  });
});

test('expansion URIs are named after their 1-based source position', () => {
  const uri = 'jai-expansion:///jai-script/lib/math.jai?14:4';
  assert.deepEqual(resourceFromUri(uri), {
    kind: 'expansion',
    path: 'lib/math.jai:15:5',
    source: 'lib/math.jai',
    uri,
  });
  assert.equal(pathFromUri(uri), undefined);
});

test('foreign, empty and malformed URIs are rejected', () => {
  for (const uri of [
    'https://example.com/a.jai',
    'file://host/stdlib/a.jai',
    'file:///',
    'file:///stdlib/a.jai?x',
    'jai-expansion:///stdlib/a.jai?1:2',
    'jai-expansion:///jai-script/a.jai',
    'not a uri',
  ])
    assert.equal(resourceFromUri(uri), undefined, uri);
});

const documents = [
  { path: 'main.jai', text: 'square(2);\nsquare(3);\n', version: 4 },
  {
    path: 'lib/math.jai',
    text: 'square :: (x: int) -> int { return x * x; }\n',
    version: 1,
  },
];

test('unversioned changes edit several workspace files', () => {
  const plan = planWorkspaceEdit(documents, {
    changes: {
      [documentUri('main.jai')]: [
        { range: range(1, 0, 6), newText: 'sq' },
        { range: range(0, 0, 6), newText: 'sq' },
      ],
      [documentUri('lib/math.jai')]: [{ range: range(0, 0, 6), newText: 'sq' }],
    },
  });
  assert.deepEqual(
    plan.map(({ path, version, text }) => ({ path, version, text })),
    [
      { path: 'main.jai', version: 4, text: 'sq(2);\nsq(3);\n' },
      {
        path: 'lib/math.jai',
        version: 1,
        text: 'sq :: (x: int) -> int { return x * x; }\n',
      },
    ]
  );
  assert.deepEqual(plan[0].changes, [
    { from: 0, to: 6, insert: 'sq' },
    { from: 11, to: 17, insert: 'sq' },
  ]);
});

test('versioned document changes must match the file version', () => {
  const edit = (version: number) => ({
    documentChanges: [
      {
        textDocument: { uri: documentUri('main.jai'), version },
        edits: [{ range: range(0, 0, 6), newText: 'sq' }],
      },
    ],
  });
  assert.equal(planWorkspaceEdit(documents, edit(4))[0].text.slice(0, 2), 'sq');
  assert.throws(() => planWorkspaceEdit(documents, edit(3)), /stale/u);
});

test('edits outside the workspace, overlapping or malformed are rejected', () => {
  const reject = (edit: unknown) =>
    assert.throws(() => planWorkspaceEdit(documents, edit as never));
  reject(null);
  reject({ changes: { 'file:///stdlib/Basic/module.jai': [] } });
  reject({ changes: { [documentUri('missing.jai')]: [] } });
  reject({
    changes: {
      [documentUri('main.jai')]: [
        { range: range(0, 0, 4), newText: 'a' },
        { range: range(0, 2, 6), newText: 'b' },
      ],
    },
  });
  reject({
    changes: {
      [documentUri('main.jai')]: [{ range: range(9, 0, 1), newText: '' }],
    },
  });
  reject({
    changes: { [documentUri('main.jai')]: [{ range: range(0, 0, 1) }] },
  });
  reject({ changes: [] });
  reject({ documentChanges: [{ kind: 'create', uri: documentUri('x.jai') }] });
});

test('locations and location links normalize to plain locations', () => {
  assert.deepEqual(normalizeLocations(null), []);
  assert.deepEqual(
    normalizeLocations([
      { uri: 'file:///jai-script/main.jai', range: range(0, 1, 2) },
      {
        targetUri: 'file:///stdlib/Basic/module.jai',
        targetRange: range(3, 0, 9),
        targetSelectionRange: range(3, 0, 4),
      },
      { bogus: true },
    ]),
    [
      { uri: 'file:///jai-script/main.jai', range: range(0, 1, 2) },
      { uri: 'file:///stdlib/Basic/module.jai', range: range(3, 0, 4) },
    ]
  );
});

const legend = tokenLegend({
  tokenTypes: [
    'keyword',
    'string',
    'number',
    'variable',
    'function',
    'type',
    'property',
    'parameter',
    'macro',
    'operator',
    'namespace',
    'typeParameter',
    'enumMember',
    'decorator',
    'formatSpecifier',
  ],
  tokenModifiers: ['declaration', 'readonly', 'macro'],
})!;

test('the semantic legend is read by name, not position', () => {
  assert.equal(tokenClass(legend, 0, 0), undefined); // keyword: tokenizer colour
  assert.equal(tokenClass(legend, 5, 0), 'cm-sem-type');
  assert.equal(tokenClass(legend, 10, 0), 'cm-sem-namespace');
  assert.equal(tokenClass(legend, 11, 0), 'cm-sem-type-parameter');
  assert.equal(tokenClass(legend, 12, 0), 'cm-sem-enum-member');
  assert.equal(tokenClass(legend, 13, 0), 'cm-sem-decorator');
  assert.equal(tokenClass(legend, 14, 0), 'cm-sem-format');
  assert.equal(tokenClass(legend, 4, 0b100), 'cm-sem-function cm-sem-expand');
  assert.equal(tokenClass(legend, 3, 0b010), 'cm-sem-constant');
  assert.equal(tokenClass(legend, 3, 0b001), undefined);
  assert.equal(tokenClass(legend, 99, 0), undefined);
  // An older server's shorter legend: index 10 does not exist there.
  const old = tokenLegend({
    tokenTypes: ['keyword', 'string', 'number', 'variable', 'function', 'type'],
    tokenModifiers: ['declaration', 'readonly'],
  })!;
  assert.equal(tokenClass(old, 10, 0), undefined);
  assert.equal(tokenClass(old, 4, 0b100), 'cm-sem-function');
  assert.equal(tokenLegend(undefined), undefined);
});

test('semantic tokens decode relative positions into offsets', () => {
  const text = 'Thing :: struct {}\nx := Thing.{};\n';
  // `Thing` (type, declaration) at 0:0, `x` (variable) at 1:0, `Thing` at 1:5.
  const data = [0, 0, 5, 5, 1, 1, 0, 1, 3, 1, 0, 5, 5, 5, 0, 3, 0, 4, 4, 0];
  assert.deepEqual(decodeSemanticTokens(data, legend, text), [
    { from: 0, to: 5, className: 'cm-sem-type' },
    { from: 24, to: 29, className: 'cm-sem-type' },
  ]);
  // A token running past its line is dropped.
  assert.deepEqual(decodeSemanticTokens([0, 10, 50, 5, 0], legend, text), []);
});

test('inlay hint labels keep kind, padding and tooltip', () => {
  assert.deepEqual(
    inlayLabel({
      position: { line: 0, character: 1 },
      label: 'x:',
      kind: 2,
      paddingRight: true,
      tooltip: 'x: $T',
    }),
    {
      text: 'x:',
      kind: 'parameter',
      paddingLeft: false,
      paddingRight: true,
      tooltip: 'x: $T',
    }
  );
  assert.equal(
    inlayLabel({
      position: { line: 0, character: 1 },
      label: [{ value: ': ' }, { value: 's64' }],
      kind: 1,
    })?.text,
    ': s64'
  );
  assert.equal(
    inlayLabel({ position: { line: 0, character: 0 }, label: ' ' }),
    undefined
  );
});

test('signature help splits around the active parameter', () => {
  const signature = {
    label: 'twice :: (x: $T, y: int) -> T',
    parameters: [{ label: 'x: $T' }, { label: [17, 23] as [number, number] }],
  };
  assert.deepEqual(signatureParts(signature, 0), {
    before: 'twice :: (',
    active: 'x: $T',
    after: ', y: int) -> T',
  });
  assert.equal(signatureParts(signature, 1).active, 'y: int');
  assert.equal(signatureParts(signature, 5).active, '');
});

test('capabilities are present unless absent or false', () => {
  assert.equal(provides(undefined, 'hoverProvider'), false);
  assert.equal(provides({ hoverProvider: false }, 'hoverProvider'), false);
  assert.equal(provides({ inlayHintProvider: {} }, 'inlayHintProvider'), true);
  assert.equal(
    supportsCommand(
      { executeCommandProvider: { commands: ['jai.showExpansion'] } },
      'jai.showExpansion'
    ),
    true
  );
  assert.equal(supportsCommand({}, 'jai.showExpansion'), false);
});

test('doc link targets carry a 1-based line fragment', () => {
  assert.deepEqual(linkTarget('file:///stdlib/Basic/Print.jai#L1213'), {
    uri: 'file:///stdlib/Basic/Print.jai',
    range: {
      start: { line: 1212, character: 0 },
      end: { line: 1212, character: 0 },
    },
  });
  assert.deepEqual(
    linkTarget('file:///jai-script/main.jai#L4').uri,
    documentUri('main.jai')
  );
  // `#import` links and other fragments are opened as they are.
  assert.deepEqual(linkTarget('file:///stdlib/Basic/module.jai'), {
    uri: 'file:///stdlib/Basic/module.jai',
  });
  assert.deepEqual(linkTarget('file:///a.jai#L0'), { uri: 'file:///a.jai#L0' });
  assert.deepEqual(linkTarget('file:///a.jai#x'), { uri: 'file:///a.jai#x' });
});

test('signature help carries the procedure and active parameter docs', () => {
  const view = signatureView({
    activeSignature: 0,
    activeParameter: 1,
    signatures: [
      {
        label: 'hail :: (n: int, steps: int) -> int',
        documentation: { kind: 'markdown', value: 'Runs **Collatz**.' },
        parameters: [
          { label: [9, 15] },
          {
            label: [17, 27],
            documentation: { kind: 'markdown', value: 'how many' },
          },
        ],
      },
    ],
  });
  assert.ok(view);
  assert.equal(view.count, 1);
  assert.equal(view.parts.active, 'steps: int');
  assert.deepEqual(view.parameter, { kind: 'markdown', value: 'how many' });
  assert.deepEqual(view.documentation, {
    kind: 'markdown',
    value: 'Runs **Collatz**.',
  });
  // An undocumented parameter has no row; no signatures, no tooltip.
  const first = signatureView({
    activeParameter: 0,
    signatures: [{ label: 'f :: (a: int)', parameters: [{ label: 'a: int' }] }],
  });
  assert.equal(first?.parameter, undefined);
  assert.equal(first?.documentation, undefined);
  assert.equal(signatureView({ signatures: [] }), undefined);
});

test('doc link labels naming a field get the property colour', () => {
  const legend = tokenLegend({
    tokenTypes: ['property', 'variable'],
    tokenModifiers: ['readonly'],
  });
  assert.ok(legend);
  assert.equal(tokenClass(legend, 0, 0), 'cm-sem-property');
});
