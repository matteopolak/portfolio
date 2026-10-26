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

/** Files from a bundle index (`tour.json`, `<example>.json`) and the folder beside it. */
async function loadIndexed(
  base: string,
  index: string,
  folder: string,
  signal: AbortSignal,
  fetcher: typeof fetch
): Promise<{ files: Record<string, string>; assets: boolean } | undefined> {
  const response = await fetcher(base + index, { signal });
  if (!response.ok) return undefined;
  const json: unknown = await response.json();
  const paths = tourPaths(json);
  if (!paths) return undefined;
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
  // A tour with its own root config keeps it; a jacket.toml beside a legacy
  // file would silently replace it.
  if (
    ![PROJECT_CONFIG_PATH, FORMAT_CONFIG_PATH, LINT_SETTINGS].some(
      (path) => path in files
    )
  )
    files[PROJECT_CONFIG_PATH] = projectConfigStarter;
  const { assets } = json as { assets?: unknown };
  return { files, assets: Array.isArray(assets) && assets.length > 0 };
}

/**
 * Loads the language tour shipped with the compiler release
 * (`/jai/<revision>/tour.json` and `tour/**`), plus the default jacket.toml.
 * Any missing or malformed piece falls back to the built-in starter, so a
 * release from before the tour still opens; only an abort is thrown.
 */
export async function loadStarter(
  revision: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<Starter> {
  try {
    const tour = await loadIndexed(
      `/jai/${revision}/`,
      TOUR_INDEX_ASSET,
      'tour/',
      signal,
      fetcher
    );
    if (!tour) return builtinStarter();
    const open = ['main.jai'];
    if (TOUR_GUIDE in tour.files) open.push(TOUR_GUIDE);
    return { files: tour.files, open };
  } catch (error) {
    if (signal.aborted) throw error;
    return builtinStarter();
  }
}

/** Example programs the release ships beside the tour: `<name>.json` and `<name>/`. */
export const EXAMPLES = [
  { name: 'textured_cube', title: 'Textured cube (WebGPU)' },
] as const;

/**
 * Loads a shipped example as a starter. Its asset files stay in the bundle,
 * and `assets` points `load_asset` at its folder. Undefined when the release
 * does not have it.
 */
export async function loadExample(
  revision: string,
  name: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<Starter | undefined> {
  const base = `/jai/${revision}/`;
  const folder = `${encodeURIComponent(name)}/`;
  const example = await loadIndexed(
    base,
    `${encodeURIComponent(name)}.json`,
    folder,
    signal,
    fetcher
  ).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return undefined;
  });
  if (!example) return undefined;
  return {
    files: example.files,
    open: ['main.jai'],
    ...(example.assets ? { assets: base + folder } : {}),
  };
}
