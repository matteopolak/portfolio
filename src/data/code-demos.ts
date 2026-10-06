import jaiRelease from '../../jai-web-release.json';

/*
 * Build-time description of each in-browser code demo. The Projects page
 * mounts one modal per entry and `/playground/<id>` renders the same workspace
 * as a full page, so both always show the same starter and release.
 */
export interface CodeDemoPage {
  /** Route segment: `/playground/<id>`. */
  id: 'jai' | 'quasi' | 'baerscript';
  /** Project card (and `/projects#<slug>` anchor) the demo belongs to. */
  slug: string;
  path: string;
  /** Page heading and `<title>` prefix. */
  title: string;
  /** Meta and OpenGraph description. */
  description: string;
  /** Short line for the /playground index. */
  summary: string;
  /** Props for `CodeWorkspace` / `CodeDemoModal`. */
  workspace: {
    id: 'jai' | 'quasi' | 'baerscript';
    label: string;
    starter?: string;
    files?: boolean;
    enabled?: boolean;
    revision?: string;
  };
}

const quasiStarter = `# Sum the squares from 1 through 10
let total = 0;

for let i = 1; i < 11; i = i + 1 [
  total = total + i * i;
]

print "sum of squares:";
print total;`;

const baerscriptStarter = `+v
+v
>v`;

export const codeDemoPages: CodeDemoPage[] = [
  {
    id: 'jai',
    slug: 'jai',
    path: '/playground/jai',
    title: 'Jai playground',
    description:
      'Write and run Jai in your browser: a Rust-built Jai compiler compiled to WebAssembly, with a multi-file workspace, diagnostics, hover, go to definition, a formatter and a linter.',
    summary:
      'Multi-file Jai workspace with the compiler, language server, formatter and linter running in WebAssembly.',
    workspace: {
      id: 'jai',
      label: 'Jai',
      files: true,
      enabled: jaiRelease.enabled,
      revision: jaiRelease.revision ?? '',
    },
  },
  {
    id: 'quasi',
    slug: 'quasi',
    path: '/playground/quasi',
    title: 'Quasi playground',
    description:
      'Write and run Quasi, a small interpreted language written in Rust, in your browser through WebAssembly.',
    summary: 'The Quasi interpreter compiled to WebAssembly.',
    workspace: { id: 'quasi', label: 'Quasi', starter: quasiStarter },
  },
  {
    id: 'baerscript',
    slug: 'baerscript',
    path: '/playground/baerscript',
    title: 'BaerScript playground',
    description:
      'Write and run BaerScript, a two-dimensional esoteric language built on Collatz-sequence operations, in your browser through WebAssembly.',
    summary:
      'The two-dimensional esoteric language, interpreted in WebAssembly.',
    workspace: {
      id: 'baerscript',
      label: 'BaerScript',
      starter: baerscriptStarter,
    },
  },
];
