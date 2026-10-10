import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { componentKinds, type ChartComponentName } from './charts/schema.ts';

/*
 * MDX posts use JSX components (charts, callouts). The markdown variant of a
 * post must be plain markdown, so this turns the MDX source into markdown by
 * splicing replacements into the original text (everything else, code fences
 * included, stays byte-for-byte): imports/exports and expressions are
 * removed, chart components become the markdown the caller builds from the
 * same data, `Callout`/`Aside` become blockquotes and unknown components are
 * unwrapped to their children. Plain TS; the chart fallback is injected.
 */
export type JsxProps = Record<string, string | number | boolean>;

export interface MdxMarkdownOptions {
  /** The markdown for a chart component (a caption and a table), built from its data. */
  chart(component: ChartComponentName, props: JsxProps): string;
}

interface Point {
  offset?: number;
}
interface MdxNode {
  type: string;
  name?: string | null;
  attributes?: {
    type: string;
    name?: string;
    value?: string | { value: string } | null;
  }[];
  children?: MdxNode[];
  position?: { start: Point; end: Point };
}

const isChart = (name: string | null | undefined): name is ChartComponentName =>
  !!name && Object.hasOwn(componentKinds, name);
const isJsx = (node: MdxNode) =>
  node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
const isRemoved = (node: MdxNode) =>
  node.type === 'mdxjsEsm' ||
  node.type === 'mdxFlowExpression' ||
  node.type === 'mdxTextExpression';

function propsOf(node: MdxNode): JsxProps {
  const props: JsxProps = {};
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== 'mdxJsxAttribute' || !attribute.name) continue;
    const { value } = attribute;
    if (value === null || value === undefined) props[attribute.name] = true;
    else if (typeof value === 'string') props[attribute.name] = value;
    else {
      try {
        props[attribute.name] = JSON.parse(value.value);
      } catch {
        props[attribute.name] = value.value;
      }
    }
  }
  return props;
}

/** Collapses runs of blank lines outside fenced code. */
function collapseBlankLines(markdown: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  let blank = 0;
  for (const line of markdown.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === undefined && marker) fence = marker;
    else if (
      fence !== undefined &&
      marker &&
      marker[0] === fence[0] &&
      marker.length >= fence.length
    )
      fence = undefined;
    if (fence === undefined && line.trim() === '') {
      if (++blank > 1) continue;
    } else blank = 0;
    out.push(line);
  }
  return out.join('\n');
}

/** Removes the indentation JSX children carry (the first line starts at the content). */
function dedent(text: string): string {
  const [first, ...rest] = text.split('\n');
  const indents = rest
    .filter((l) => l.trim())
    .map((l) => /^ */.exec(l)![0].length);
  const strip = indents.length ? Math.min(...indents) : 0;
  return [
    first,
    ...rest.map((l) => l.slice(Math.min(strip, /^ */.exec(l)![0].length))),
  ].join('\n');
}

export function mdxToMarkdown(
  source: string,
  options: MdxMarkdownOptions
): string {
  const tree = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .parse(source) as MdxNode;
  const needs = (node: MdxNode): boolean =>
    isRemoved(node) || isJsx(node) || !!node.children?.some(needs);
  const offset = (point: Point | undefined) => point?.offset ?? 0;

  /** `source[start, end)` with the nodes inside `node` that need it replaced. */
  function rebuild(node: MdxNode, start: number, end: number): string {
    let out = '';
    let cursor = start;
    for (const child of node.children ?? []) {
      if (!child.position || !needs(child)) continue;
      const from = offset(child.position.start);
      const to = offset(child.position.end);
      out += source.slice(cursor, from) + replacement(child, from, to);
      cursor = to;
    }
    return out + source.slice(cursor, end);
  }

  function replacement(node: MdxNode, from: number, to: number): string {
    if (isRemoved(node)) return '';
    if (!isJsx(node)) return rebuild(node, from, to);
    if (isChart(node.name)) return options.chart(node.name, propsOf(node));
    const first = node.children?.[0]?.position;
    const last = node.children?.[node.children.length - 1]?.position;
    const inner =
      first && last ? rebuild(node, offset(first.start), offset(last.end)) : '';
    if (node.name === 'Callout' || node.name === 'Aside') {
      const props = propsOf(node);
      const label = String(
        props.title ??
          { tip: 'Tip', warning: 'Warning' }[String(props.type)] ??
          'Note'
      );
      const quoted = [`**${label}**`, '', ...dedent(inner).split('\n')].map(
        (line) => (line ? `> ${line}` : '>')
      );
      return quoted.join('\n');
    }
    return inner;
  }

  return collapseBlankLines(rebuild(tree, 0, source.length)).trim() + '\n';
}
