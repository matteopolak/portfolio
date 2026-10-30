import { PROJECT_CONFIG_PATH, projectConfigStarter } from './project-config.ts';
import type { Starter } from './starter.ts';

/** The largest program a link may carry (decoded bytes). */
const MAX_LINKED_BYTES = 1024 * 1024;

/**
 * The program in a `#code=<base64url of UTF-8, no padding>` fragment (the
 * Jacket docs' "Open in playground" links), or undefined when there is none
 * or it does not decode.
 */
export function programFromHash(hash: string): string | undefined {
  const match = /^#code=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match || match[1].length % 4 === 1) return undefined;
  const base64 = match[1].replaceAll('-', '+').replaceAll('_', '/');
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    if (binary.length > MAX_LINKED_BYTES) return undefined;
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** A workspace holding just `code` as main.jai, with the default jacket.toml. */
export const programStarter = (code: string): Starter => ({
  files: { 'main.jai': code, [PROJECT_CONFIG_PATH]: projectConfigStarter },
  open: ['main.jai'],
});
