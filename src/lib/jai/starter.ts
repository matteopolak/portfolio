import { FORMAT_CONFIG_PATH } from './format.ts';
import { LINT_SETTINGS } from './language-client.ts';
import { PROJECT_CONFIG_PATH, projectConfigStarter } from './project-config.ts';
import { SourcePath } from './workspace.ts';

/**
 * Files a new Jai workspace opens with when the compiler release has no tour
 * (releases before the compiler shipped `tour/`), or the tour fails to load.
 */
export const starterFiles: Record<string, string> = {
  'main.jai': `#import "Basic";
#load "lib/math.jai";

main :: () {
    total := 0;
    for i: 1..10 {
        total += square(i);
        print("% squared is %\\n", i, square(i));
    }
    print("Sum of squares: %\\n", total);
}
`,
  'lib/math.jai': `square :: (x: int) -> int {
    return x * x;
}
`,
  [PROJECT_CONFIG_PATH]: projectConfigStarter,
};

/**
 * A clean workspace: a hello-world `main.jai` and the default jacket.toml (the
 * same one the tour and the built-in starter get).
 */
export const defaultFiles = (): Record<string, string> => ({
  'main.jai': `#import "Basic";

main :: () {
    print("Hello, World!\\n");
}
`,
  [PROJECT_CONFIG_PATH]: projectConfigStarter,
});

/** The workspace a session starts with, and the tabs to open (the first is active). */
export interface Starter {
  files: Record<string, string>;
  open: string[];
  /** The directory `load_asset` fetches from, for a shipped example. */
  assets?: string;
  /** The preset workspace this is (`examples.json` name), if it is one. */
  example?: string;
}

/** Release asset that lists the tour's files; they live under `tour/` next to it. */
export const TOUR_INDEX_ASSET = 'tour.json';
/** The tour's guide, opened in a tab beside main.jai when present. */
export const TOUR_GUIDE = 'tour.md';
const MAX_TOUR_FILES = 64;
const MAX_TOUR_BYTES = 1024 * 1024;

export const defaultStarter = (): Starter => ({
  files: defaultFiles(),
  open: ['main.jai'],
});

export const builtinStarter = (): Starter => ({
  files: { ...starterFiles },
  open: ['main.jai'],
});

/** The listed paths, if `index` is a usable tour index; otherwise undefined. */
export function tourPaths(index: unknown): string[] | undefined {
  if (typeof index !== 'object' || index === null) return undefined;
  const { schema_version, main, files } = index as Record<string, unknown>;
  if (
    schema_version !== 1 ||
    main !== 'main.jai' ||
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > MAX_TOUR_FILES ||
    !files.includes(main)
  )
    return undefined;
  const paths = new Set<string>();
  for (const file of files) {
    try {
      // Only plain relative paths, exactly as written: no `..`, `./` or duplicates.
      if (SourcePath.parse(file).name !== file || paths.has(file))
        return undefined;
    } catch {
      return undefined;
    }
    paths.add(file);
  }
  return [...paths];
}

/** Reads `paths` from `base + folder` into a file map, within the size cap. */
async function loadFiles(
  base: string,
  folder: string,
  paths: readonly string[],
  signal: AbortSignal,
  fetcher: typeof fetch
): Promise<Record<string, string> | undefined> {
  const texts = await Promise.all(
    paths.map(async (path) => {
      const url =
        base + folder + path.split('/').map(encodeURIComponent).join('/');
      const file = await fetcher(url, { signal });
      if (!file.ok) throw new Error(`Missing file ${path}`);
      return file.text();
    })
  );
  const files: Record<string, string> = {};
  let bytes = 0;
  paths.forEach((path, index) => {
    bytes += texts[index].length;
    files[path] = texts[index];
  });
  if (bytes > MAX_TOUR_BYTES) return undefined;
  // A workspace with its own root config keeps it; a jacket.toml beside a
  // legacy file would silently replace it.
  if (
    ![PROJECT_CONFIG_PATH, FORMAT_CONFIG_PATH, LINT_SETTINGS].some(
      (path) => path in files
    )
  )
    files[PROJECT_CONFIG_PATH] = projectConfigStarter;
  return files;
}

/** Release asset listing the preset workspaces; each lives in `<name>/` beside it. */
export const EXAMPLES_INDEX_ASSET = 'examples.json';

/** A preset workspace from `examples.json`. */
export interface Example {
  name: string;
  title: string;
  summary: string;
  /** Workspace paths, `main.jai` first. */
  files: string[];
  /** Files `load_asset` may fetch from `<name>/`; not copied into the workspace. */
  assets: string[];
}

const EXAMPLE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** The usable entries of an `examples.json`; undefined if it is not one. */
export function examplesIndex(index: unknown): Example[] | undefined {
  if (typeof index !== 'object' || index === null) return undefined;
  const { schema_version, examples } = index as Record<string, unknown>;
  if (schema_version !== 2 || !Array.isArray(examples)) return undefined;
  const names = new Set<string>();
  const usable: Example[] = [];
  for (const entry of examples) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, title, summary, main, files, assets } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof name !== 'string' ||
      !EXAMPLE_NAME.test(name) ||
      names.has(name) ||
      typeof title !== 'string' ||
      !Array.isArray(assets)
    )
      continue;
    // Run always runs main.jai, so a workspace must have it.
    const paths = tourPaths({ schema_version: 1, main, files });
    if (!paths) continue;
    const assetPaths = assets.filter((path): path is string => {
      try {
        return typeof path === 'string' && SourcePath.parse(path).name === path;
      } catch {
        return false;
      }
    });
    if (assetPaths.length !== assets.length) continue;
    names.add(name);
    usable.push({
      name,
      title,
      summary: typeof summary === 'string' ? summary : '',
      files: paths,
      assets: assetPaths,
    });
  }
  return usable.length ? usable : undefined;
}

/**
 * The release's preset workspaces (`/jai/<revision>/examples.json`), or an
 * empty list when it has none or the index is unusable. Only an abort throws.
 */
export async function loadExamples(
  revision: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<Example[]> {
  try {
    const response = await fetcher(`/jai/${revision}/${EXAMPLES_INDEX_ASSET}`, {
      signal,
    });
    if (!response.ok) return [];
    return examplesIndex(await response.json()) ?? [];
  } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
}

/**
 * One preset workspace as a starter. Its assets stay in the bundle, and
 * `assets` points `load_asset` at its folder. Undefined if a file is missing.
 */
export async function loadExample(
  revision: string,
  example: Example,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<Starter | undefined> {
  const base = `/jai/${revision}/`;
  const folder = `${encodeURIComponent(example.name)}/`;
  try {
    const files = await loadFiles(base, folder, example.files, signal, fetcher);
    if (!files) return undefined;
    return {
      files,
      open: ['main.jai'],
      example: example.name,
      ...(example.assets.length ? { assets: base + folder } : {}),
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

/** Releases before `examples.json`: the language tour (`tour.json`, `tour/**`). */
async function loadTour(
  revision: string,
  signal: AbortSignal,
  fetcher: typeof fetch
): Promise<Starter | undefined> {
  const base = `/jai/${revision}/`;
  const response = await fetcher(base + TOUR_INDEX_ASSET, { signal });
  if (!response.ok) return undefined;
  const paths = tourPaths(await response.json());
  if (!paths) return undefined;
  const files = await loadFiles(base, 'tour/', paths, signal, fetcher);
  if (!files) return undefined;
  const open = ['main.jai'];
  if (TOUR_GUIDE in files) open.push(TOUR_GUIDE);
  return { files, open };
}

/**
 * The workspace a session opens with: the release's first preset workspace
 * (`examples.json`), else its language tour (older releases), else the
 * built-in starter, so any release still opens; only an abort is thrown.
 */
export async function loadStarter(
  revision: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<Starter> {
  try {
    const [first] = await loadExamples(revision, signal, fetcher);
    const starter =
      (first && (await loadExample(revision, first, signal, fetcher))) ||
      (await loadTour(revision, signal, fetcher));
    return starter ?? builtinStarter();
  } catch (error) {
    if (signal.aborted) throw error;
    return builtinStarter();
  }
}
