import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectConfigStarter } from '../../src/lib/jai/project-config.ts';
import { examplesIndex, tourPaths } from '../../src/lib/jai/starter.ts';

/** A workspace a local compiler build ships, as the playground would open it. */
export interface LocalWorkspace {
  label: string;
  files: Record<string, string>;
  /** Runs headless with exit code 0 (the tour, or the first example). */
  runs: boolean;
  /** Text the run prints, when known. */
  stdout?: RegExp;
}

async function read(dir: string, paths: string[]) {
  const files: Record<string, string> = {};
  for (const path of paths)
    files[path] = await readFile(join(dir, path), 'utf8');
  if (!('jacket.toml' in files)) files['jacket.toml'] = projectConfigStarter;
  return files;
}

/**
 * The preset workspaces of a local build (`examples.json`), or its language
 * tour for builds before them.
 */
export async function localWorkspaces(dir: string): Promise<LocalWorkspace[]> {
  const examples = await readFile(join(dir, 'examples.json'), 'utf8').then(
    (text) => examplesIndex(JSON.parse(text)),
    () => undefined
  );
  if (examples)
    return Promise.all(
      examples.map(async ({ name, files }, index) => ({
        label: name,
        files: await read(join(dir, name), files),
        runs: index === 0,
      }))
    );
  const paths = tourPaths(
    JSON.parse(await readFile(join(dir, 'tour.json'), 'utf8'))
  );
  if (!paths) throw new Error('Local build has neither examples nor a tour');
  return [
    {
      label: 'tour',
      files: await read(join(dir, 'tour'), paths),
      runs: true,
      stdout: /That's the tour/,
    },
  ];
}
