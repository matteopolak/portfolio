import { FORMAT_CONFIG_PATH, formatConfigStarter } from './format.ts';
import { LINT_SETTINGS, lintConfigStarter } from './language-client.ts';
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
  [FORMAT_CONFIG_PATH]: formatConfigStarter,
  [LINT_SETTINGS]: lintConfigStarter,
};

/**
 * A clean workspace: a hello-world `main.jai` and the default jaifmt.toml and
 * jailint.toml (the same ones the tour and the built-in starter get).
 */
export const defaultFiles = (): Record<string, string> => ({
  'main.jai': `#import "Basic";

main :: () {
    print("Hello, World!\\n");
}
`,
  [FORMAT_CONFIG_PATH]: formatConfigStarter,
  [LINT_SETTINGS]: lintConfigStarter,
});

/** The workspace a session starts with, and the tabs to open (the first is active). */
export interface Starter {
  files: Record<string, string>;
  open: string[];
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

/**
 * Loads the language tour shipped with the compiler release
 * (`/jai/<revision>/tour.json` and `tour/**`), plus the default jaifmt.toml and jailint.toml.
 * Any missing or malformed piece falls back to the built-in starter, so a
 * release from before the tour still opens; only an abort is thrown.
 */
export async function loadStarter(
  revision: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<Starter> {
  const base = `/jai/${revision}/`;
  try {
    const response = await fetcher(base + TOUR_INDEX_ASSET, { signal });
    if (!response.ok) return builtinStarter();
    const paths = tourPaths(await response.json());
    if (!paths) return builtinStarter();
    const texts = await Promise.all(
      paths.map(async (path) => {
        const url =
          base + 'tour/' + path.split('/').map(encodeURIComponent).join('/');
        const file = await fetcher(url, { signal });
        if (!file.ok) throw new Error(`Missing tour file ${path}`);
        return file.text();
      })
    );
    const files: Record<string, string> = {};
    let bytes = 0;
    paths.forEach((path, index) => {
      bytes += texts[index].length;
      files[path] = texts[index];
    });
    if (bytes > MAX_TOUR_BYTES) return builtinStarter();
    files[FORMAT_CONFIG_PATH] ??= formatConfigStarter;
    files[LINT_SETTINGS] ??= lintConfigStarter;
    const open = ['main.jai'];
    if (paths.includes(TOUR_GUIDE)) open.push(TOUR_GUIDE);
    return { files, open };
  } catch (error) {
    if (signal.aborted) throw error;
    return builtinStarter();
  }
}
