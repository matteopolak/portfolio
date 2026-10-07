// Small file-type glyphs for the Jai workspace's file tree and tabs.

export type FileIconKind =
  | 'jai'
  | 'config'
  | 'markdown'
  | 'text'
  | 'file'
  | 'folder'
  | 'folder-open'
  | 'lock'
  | 'render';

/**
 * One shape of a glyph. `fill` paints it solid in the icon colour; otherwise
 * it is stroked at 1.5 units. `evenodd` lets a filled shape carry a cut-out.
 */
interface Shape {
  d: string;
  fill?: boolean;
  evenodd?: boolean;
  opacity?: number;
}

/**
 * Glyphs on a 16×16 grid, drawn at 16px so one unit is one pixel. Each type
 * has its own silhouette (no shared page outline), with filled shapes where
 * a stroke alone would read as hairlines.
 */
const glyphs: Record<FileIconKind, Shape[]> = {
  // A rounded tile with a `J` cut out of it.
  jai: [
    {
      d: 'M4 1.5h8A2.5 2.5 0 0 1 14.5 4v8a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 12V4A2.5 2.5 0 0 1 4 1.5z M8.9 4.25h1.85V9.4a2.75 2.75 0 0 1-5.5 0h1.85a.9.9 0 0 0 1.8 0z',
      fill: true,
      evenodd: true,
    },
  ],
  // Two slider rails with solid knobs.
  config: [
    { d: 'M2 5h12 M2 11h12' },
    {
      d: 'M5 2.75a2.25 2.25 0 1 1 0 4.5a2.25 2.25 0 1 1 0-4.5z M11 8.75a2.25 2.25 0 1 1 0 4.5a2.25 2.25 0 1 1 0-4.5z',
      fill: true,
    },
  ],
  // The Markdown mark: a frame holding `M` and a down arrow.
  markdown: [
    {
      d: 'M2 3.25h12a1.25 1.25 0 0 1 1.25 1.25v7a1.25 1.25 0 0 1-1.25 1.25H2A1.25 1.25 0 0 1 .75 11.5v-7A1.25 1.25 0 0 1 2 3.25z',
    },
    {
      d: 'M3.75 10.25v-4.5l2 2.25 2-2.25v4.5 M11.25 5.75v4.25 M9.5 8.5l1.75 1.75L13 8.5',
    },
  ],
  text: [{ d: 'M2.5 3.5h11 M2.5 6.5h11 M2.5 9.5h11 M2.5 12.5h7' }],
  // A plain sheet with a folded corner.
  file: [{ d: 'M3.75 1.75h5.5l3 3v9.5h-8.5z M9.25 1.75v3h3' }],
  folder: [
    {
      d: 'M1.5 3.5a1 1 0 0 1 1-1h3.75l1.5 1.5h5.75a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z',
      fill: true,
    },
  ],
  // The back panel stays dim so the tilted front reads as "open".
  'folder-open': [
    {
      d: 'M1.5 3.5a1 1 0 0 1 1-1h3.75l1.5 1.5h5.25a1 1 0 0 1 1 1V7H4.25L1.5 13z',
      fill: true,
      opacity: 0.55,
    },
    {
      d: 'M4.1 7.25h10.9a.6.6 0 0 1 .56.82l-2.1 5.2a1 1 0 0 1-.93.63H2.1a.6.6 0 0 1-.56-.82z',
      fill: true,
    },
  ],
  // The Render tab: a frame around a little landscape.
  render: [
    {
      d: 'M2.5 2.75h11a1.25 1.25 0 0 1 1.25 1.25v8a1.25 1.25 0 0 1-1.25 1.25h-11A1.25 1.25 0 0 1 1.25 12V4A1.25 1.25 0 0 1 2.5 2.75z',
    },
    { d: 'M3.75 11l3-3.5 2 2 1.5-1.5 2 3z', fill: true },
  ],
  lock: [
    { d: 'M5.25 7.5V5a2.75 2.75 0 0 1 5.5 0v2.5' },
    {
      d: 'M4 7h8a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
      fill: true,
    },
  ],
};

/** The icon for a file name, by extension. */
export function fileIconKind(name: string): FileIconKind {
  const extension = /\.([^./]+)$/u.exec(name)?.[1]?.toLowerCase();
  switch (extension) {
    case 'jai':
      return 'jai';
    case 'toml':
    case 'json':
    case 'ini':
    case 'cfg':
    case 'yaml':
    case 'yml':
      return 'config';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'txt':
      return 'text';
    default:
      return 'file';
  }
}

/** The shapes of `kind`, for tests. */
export const fileIconShapes = (kind: FileIconKind): readonly Shape[] =>
  glyphs[kind];

const svgNamespace = 'http://www.w3.org/2000/svg';

/** An `aria-hidden` SVG icon; `data-icon` carries the kind for styling. */
export function fileIcon(kind: FileIconKind, className: string): SVGElement {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.icon = kind;
  for (const shape of glyphs[kind]) {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', shape.d);
    // Attributes on the path override the workspace's stroked-svg defaults.
    if (shape.fill) {
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('stroke', 'none');
      if (shape.evenodd) path.setAttribute('fill-rule', 'evenodd');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '1.5');
    }
    if (shape.opacity !== undefined)
      path.setAttribute('opacity', String(shape.opacity));
    svg.append(path);
  }
  return svg;
}
