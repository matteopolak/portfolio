import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  highlightJai,
  jaiBlockHast,
  jaiTokenStyles,
} from '../../src/lib/highlight-jai.ts';
import { jaiHastPlugin } from '../../src/lib/jai-hast-plugin.ts';

const source = `Point :: struct { x: float; }
main :: () {
    // note <b>
    print("p = %\\n", 42);
}
`;

test('highlighting keeps the source text and splits it into lines', () => {
  const lines = highlightJai(source.replace(/\n$/, ''));
  assert.equal(
    lines.map((line) => line.map(({ text }) => text).join('')).join('\n'),
    source.replace(/\n$/, '')
  );
  assert.equal(lines.length, 5);
});

test('tokens match the editor tags', () => {
  const tokens = new Map(
    highlightJai(source)
      .flat()
      .map(({ text, token }) => [text, token])
  );
  assert.equal(tokens.get('struct'), 'keyword');
  assert.equal(tokens.get('float'), 'type');
  assert.equal(tokens.get('Point'), 'type');
  assert.equal(tokens.get('main'), 'function');
  assert.equal(tokens.get('42'), 'number');
  assert.equal(tokens.get('// note <b>'), 'comment');
  for (const token of tokens.values())
    if (token) assert.ok(token in jaiTokenStyles);
});

test('the block is a Shiki-shaped pre with both palettes as variables', () => {
  const pre = jaiBlockHast(source);
  assert.equal(pre.tagName, 'pre');
  assert.ok((pre.properties.className as string[]).includes('astro-code'));
  const code = pre.children[0] as { children: { properties?: object }[] };
  assert.equal(
    code.children.filter((child) => 'properties' in child).length,
    5
  );
  const html = JSON.stringify(pre);
  assert.match(html, /--shiki-light:[^"]+;--shiki-dark:/);
  // Text stays text nodes (escaped when serialized), never raw HTML.
  assert.ok(html.includes('// note <b>'));
});

test('the hast plugin only replaces jai code blocks', () => {
  const ctx = { textContent: () => 'x :: 1;' };
  const block = (lang: string) => ({
    type: 'element',
    tagName: 'pre',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: { className: [`language-${lang}`] },
        children: [],
      },
    ],
  });
  assert.equal(jaiHastPlugin.element.visit(block('rust'), ctx), undefined);
  const replaced = jaiHastPlugin.element.visit(block('jai'), ctx);
  assert.equal(replaced?.tagName, 'pre');
});
