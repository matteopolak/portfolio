import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parseChartData, componentKinds } from '../src/lib/charts/schema.ts';
import {
  barsLayout,
  nearestIndex,
  timeSeriesLayout,
} from '../src/lib/charts/geometry.ts';
import {
  describeChart,
  markdownTable,
  tableFor,
} from '../src/lib/charts/table.ts';
import { mdxToMarkdown } from '../src/lib/mdx-markdown.ts';
import { renderChartMarkdown } from '../src/lib/markdown-export.ts';
import { buildPosts } from '../src/lib/content/posts.ts';

const series = {
  unit: 'lines',
  series: [
    {
      name: 'A',
      points: [
        { t: '2026-01-01', v: 1 },
        { t: '2026-02-01', v: 5 },
        { t: '2026-03-01', v: 3 },
      ],
    },
    {
      name: 'B',
      points: [
        { t: '2026-01-01', v: 2 },
        { t: '2026-02-01', v: 2 },
        { t: '2026-03-01', v: 8 },
      ],
    },
  ],
};

test('every fixture data file under src/content/blog validates', () => {
  const root = new URL('../src/content/blog/', import.meta.url);
  let checked = 0;
  for (const slug of readdirSync(root, { withFileTypes: true }).filter((e) =>
    e.isDirectory()
  )) {
    const dir = new URL(`${slug.name}/data/`, root);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const json = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      const kind = ['timeSeries', 'bars', 'timeline', 'stats'].find((k) => {
        try {
          parseChartData(k as 'bars', json, file);
          return true;
        } catch {
          return false;
        }
      });
      assert.ok(kind, `${slug.name}/data/${file} matches no chart schema`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('schemas reject bad data with a message naming the file', () => {
  assert.doesNotThrow(() => parseChartData('timeSeries', series, 'x.json'));
  assert.throws(
    () => parseChartData('timeSeries', { series: [] }, 'x.json'),
    /x\.json/
  );
  assert.throws(
    () =>
      parseChartData(
        'timeSeries',
        {
          series: [
            {
              name: 'A',
              points: [
                { t: '2026-02-01', v: 1 },
                { t: '2026-01-01', v: 2 },
              ],
            },
          ],
        },
        'x.json'
      ),
    /strictly increasing/
  );
  assert.throws(() =>
    parseChartData(
      'timeSeries',
      {
        series: [
          {
            name: 'A',
            points: [
              { t: 'Jan', v: 1 },
              { t: 'Feb', v: 2 },
            ],
          },
        ],
      },
      'x.json'
    )
  );
  assert.throws(
    () =>
      parseChartData('bars', { bars: [{ label: 'a', value: 'x' }] }, 'b.json'),
    /b\.json/
  );
  assert.throws(() => parseChartData('stats', { stats: [] }, 's.json'));
});

test('time series layout produces paths, ticks and stacked totals', () => {
  const data = parseChartData('timeSeries', series, 'x');
  for (const variant of ['wide', 'narrow'] as const) {
    const layout = timeSeriesLayout(data, variant, {
      area: false,
      stacked: false,
    });
    assert.equal(layout.series.length, 2);
    assert.ok(layout.series[0].line.startsWith('M'));
    assert.equal(layout.series[0].area, undefined);
    assert.ok(layout.xTicks.length >= 2 && layout.yTicks.length >= 2);
    for (const point of layout.series.flatMap((s) => s.points)) {
      assert.ok(point.x >= layout.plot.x0 && point.x <= layout.plot.x1);
      assert.ok(point.y >= layout.plot.y1 && point.y <= layout.plot.y0);
    }
  }
  const stacked = timeSeriesLayout(data, 'wide', { area: true, stacked: true });
  assert.ok(stacked.series[1].area);
  // Stacked: the second series' top edge sits above the first's.
  assert.ok(stacked.series[1].points[2].y < stacked.series[0].points[2].y);
  const misaligned = {
    series: [
      series.series[0],
      {
        name: 'C',
        points: [
          { t: '2026-01-01', v: 1 },
          { t: '2026-02-15', v: 2 },
        ],
      },
    ],
  };
  assert.throws(
    () => timeSeriesLayout(misaligned, 'wide', { area: true, stacked: true }),
    /same dates/
  );
});

test('bars layout thins crowded labels and keeps bars inside the plot', () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({
    label: `Week ${i + 1}`,
    value: i * 2,
  }));
  const layout = barsLayout({ bars }, 'narrow');
  assert.ok(layout.bars.filter((b) => b.showLabel).length < 30);
  for (const bar of layout.bars) {
    assert.ok(
      bar.x >= layout.plot.x0 && bar.x + bar.width <= layout.plot.x1 + 0.001
    );
    assert.ok(bar.height >= 0);
  }
  assert.equal(nearestIndex([10, 20, 30], 26), 2);
});

test('tables and descriptions come from the same data', () => {
  const data = parseChartData('timeSeries', series, 'x');
  const table = tableFor('LineChart', data);
  assert.deepEqual(table.columns, ['Date', 'A', 'B']);
  assert.deepEqual(table.rows[0], ['2026-01-01', '1 lines', '2 lines']);
  assert.equal(markdownTable(table).split('\n')[1], '| --- | --- | --- |');
  assert.match(
    describeChart('LineChart', data),
    /A goes from 1 lines \(2026-01-01\) to 3 lines \(2026-03-01\), peaking at 5 lines/
  );
  assert.equal(Object.keys(componentKinds).length, 5);
});

const options = {
  chart: (component: string, props: Record<string, unknown>) =>
    `[[${component} ${props.src} ${props.title ?? ''} ${props.stacked ?? ''}]]`,
};

test('mdxToMarkdown replaces components and keeps everything else verbatim', () => {
  const source = [
    "import X from './x.json';",
    'export const meta = { a: 1 };',
    '',
    'Intro with `<LineChart />` in code and {1 + 1} an expression.',
    '',
    '<LineChart src="p/data/a.json" title="Lines" stacked />',
    '',
    '<Callout type="tip" title="Heads up">',
    '  Inner **markdown** here.',
    '',
    '  <BarChart src="p/data/b.json" />',
    '</Callout>',
    '',
    '```mdx',
    '<LineChart src="inside-fence" />',
    '',
    '',
    '',
    'import keep from "x";',
    '```',
    '',
    '<Unknown>child text</Unknown>',
  ].join('\n');
  const out = mdxToMarkdown(source, options as never);
  assert.ok(!out.includes('import X'), 'esm removed');
  assert.ok(!out.includes('export const'));
  assert.ok(
    out.includes('Intro with `<LineChart />` in code and  an expression.')
  );
  assert.ok(out.includes('[[LineChart p/data/a.json Lines true]]'));
  assert.ok(out.includes('> **Heads up**'));
  assert.ok(out.includes('> Inner **markdown** here.'));
  assert.ok(out.includes('> [[BarChart p/data/b.json  ]]'));
  assert.ok(
    out.includes(
      '```mdx\n<LineChart src="inside-fence" />\n\n\n\nimport keep from "x";\n```'
    ),
    'fence untouched'
  );
  assert.ok(out.includes('child text') && !out.includes('<Unknown>'));
  assert.ok(!/<Callout|<\/Callout/.test(out));
});

test('renderChartMarkdown gives title, table and caption', () => {
  const data = parseChartData(
    'bars',
    {
      unit: 'commits',
      bars: [
        { label: 'W1', value: 4 },
        { label: 'W2', value: 9 },
      ],
    },
    'b'
  );
  const withCaption = renderChartMarkdown('BarChart', data, {
    title: 'Commits',
    caption: 'Two weeks.',
  });
  assert.equal(
    withCaption,
    '**Commits**\n\n|  | Value (commits) |\n| --- | --- |\n| W1 | 4 |\n| W2 | 9 |\n\n*Two weeks.*'
  );
  assert.match(
    renderChartMarkdown('BarChart', data, {}),
    /\*2 bars; highest W2/
  );
});

test('mdx posts are converted, md posts are not, drafts stay out', () => {
  const entries = [
    {
      id: 'a',
      filePath: 'src/content/blog/a.mdx',
      body: '<Callout>x</Callout>',
      data: { title: 'A', date: new Date('2026-01-02') },
    },
    {
      id: 'b',
      filePath: 'src/content/blog/b.md',
      body: '<b>raw</b>',
      data: { title: 'B', date: new Date('2026-01-01') },
    },
    {
      id: 'c',
      filePath: 'src/content/blog/c.mdx',
      body: 'draft',
      data: { title: 'C', date: new Date('2026-01-03'), published: false },
    },
  ];
  const posts = buildPosts(entries, (body) => `converted:${body}`);
  assert.deepEqual(
    posts.map((p) => [p.slug, p.format, p.body]),
    [
      ['a', 'mdx', 'converted:<Callout>x</Callout>'],
      ['b', 'md', '<b>raw</b>'],
    ]
  );
  assert.equal(posts[0].markdownPath, '/blog/a.md');
});

test('chart colours meet contrast in every theme', async () => {
  const { themes } = await import('../src/lib/themes.ts');
  const { contrastBetween } = await import('../src/lib/color-contrast.ts');
  for (const theme of themes) {
    // Axis labels and legends: muted and ink text on the paper (AAA).
    assert.ok(
      contrastBetween(theme.muted, theme.paper) >= 7,
      `${theme.id} muted`
    );
    assert.ok(contrastBetween(theme.ink, theme.paper) >= 7, `${theme.id} ink`);
    // Lines, markers, bar outlines and timeline markers use the accent text colours on paper (>= 3:1).
    for (const [index, accent] of theme.accents.entries()) {
      assert.ok(
        contrastBetween(accent.text, theme.paper) >= 3,
        `${theme.id} accent ${index + 1} stroke`
      );
      assert.ok(
        contrastBetween(accent.text, theme.paperBright) >= 3,
        `${theme.id} accent ${index + 1} on bright`
      );
    }
  }
});
