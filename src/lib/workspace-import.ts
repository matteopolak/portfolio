/*
 * Pure rules for importing a folder into a playground workspace (no DOM):
 * path normalization, what to skip, size caps and which file opens first.
 * The DOM side (picker, reading files, dialogs) is workspace-actions.ts.
 */

export const IMPORT_LIMITS = {
  /** Files kept after skipping noise. */
  files: 500,
  /** Total size of the kept files. */
  bytes: 5 * 1024 * 1024,
  /** One file's size; larger ones are skipped as not source. */
  fileBytes: 1024 * 1024,
} as const;

/** Directories that are never source. */
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'target']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

const BINARY_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif webp bmp ico icns tif tiff avif heic psd ' +
    'mp3 wav ogg flac aac m4a mp4 mov avi mkv webm ' +
    'zip gz tgz bz2 xz 7z rar tar jar war ' +
    'exe dll so dylib a o obj lib bin class pyc wasm ' +
    'pdf doc docx xls xlsx ppt pptx ttf otf woff woff2 eot ' +
    'sqlite db dmg iso'
  ).split(' ')
);

export interface ImportCandidate {
  /** `file.webkitRelativePath`, or a path relative to the picked folder. */
  path: string;
  size: number;
}

export interface AcceptedFile {
  path: string;
  size: number;
}

export interface ImportPlan {
  accepted: AcceptedFile[];
  /** Counts of what was left out, for the summary message. */
  skipped: { ignored: number; binary: number; large: number };
  /** Set when a cap is exceeded; nothing should be imported then. */
  error?: string;
}

/**
 * `myproj/src/main.jai` -> `src/main.jai`: drops the picked folder's own name.
 * Returns undefined for the folder's root entry or an unusable path (`..`,
 * absolute, backslashes, NUL, `:`), which are skipped rather than imported.
 */
export function normalizeImportPath(relativePath: string): string | undefined {
  if (/[\\\0:]/u.test(relativePath) || relativePath.startsWith('/'))
    return undefined;
  const parts: string[] = [];
  for (const part of relativePath.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return undefined;
    parts.push(part);
  }
  if (parts.length < 2) return undefined;
  return parts.slice(1).join('/');
}

/** Paths under `.git/`, `node_modules/`, `target/` or named like OS metadata. */
export function isIgnoredPath(path: string): boolean {
  const parts = path.split('/');
  if (IGNORED_FILES.has(parts[parts.length - 1])) return true;
  return parts.slice(0, -1).some((part) => IGNORED_DIRECTORIES.has(part));
}

export function hasBinaryExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** A NUL byte in the first 8 KB marks a file as binary. */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192);
  for (let index = 0; index < end; index += 1)
    if (bytes[index] === 0) return true;
  return false;
}

/** Decides which of the picked files to read and whether the caps allow it. */
export function planImport(candidates: Iterable<ImportCandidate>): ImportPlan {
  const accepted: AcceptedFile[] = [];
  const skipped = { ignored: 0, binary: 0, large: 0 };
  const seen = new Set<string>();
  let bytes = 0;
  for (const candidate of candidates) {
    const path = normalizeImportPath(candidate.path);
    if (path === undefined || isIgnoredPath(path) || seen.has(path)) {
      skipped.ignored += 1;
      continue;
    }
    if (hasBinaryExtension(path)) {
      skipped.binary += 1;
      continue;
    }
    if (candidate.size > IMPORT_LIMITS.fileBytes) {
      skipped.large += 1;
      continue;
    }
    seen.add(path);
    accepted.push({ path, size: candidate.size });
    bytes += candidate.size;
  }
  const plan: ImportPlan = { accepted, skipped };
  if (accepted.length === 0) {
    plan.error = 'That folder has no text files to import.';
  } else if (accepted.length > IMPORT_LIMITS.files) {
    plan.error = `That folder has ${accepted.length} files; the limit is ${IMPORT_LIMITS.files}. Pick a smaller folder.`;
  } else if (bytes > IMPORT_LIMITS.bytes) {
    plan.error = `That folder is ${(bytes / 1024 / 1024).toFixed(1)} MB of source; the limit is ${IMPORT_LIMITS.bytes / 1024 / 1024} MB. Pick a smaller folder.`;
  }
  return plan;
}

/** The file to open after an import: `main.<ext>`, else the first source file, else the first file. */
export function entryPath(
  paths: readonly string[],
  entryName: string
): string | undefined {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  const shallowest = (candidates: string[]) =>
    candidates.sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
    )[0];
  if (sorted.includes(entryName)) return entryName;
  const nested = sorted.filter((path) => path.endsWith('/' + entryName));
  if (nested.length) return shallowest(nested);
  const extension = entryName.slice(entryName.lastIndexOf('.'));
  const sameLanguage = sorted.filter((path) => path.endsWith(extension));
  if (sameLanguage.length) return shallowest(sameLanguage);
  return shallowest(sorted);
}

/** One-line summary of what an import left out, or '' when nothing was skipped. */
export function skippedSummary(skipped: ImportPlan['skipped']): string {
  const parts: string[] = [];
  if (skipped.ignored) parts.push(`${skipped.ignored} ignored`);
  if (skipped.binary) parts.push(`${skipped.binary} binary`);
  if (skipped.large) parts.push(`${skipped.large} too large`);
  return parts.length ? `Skipped ${parts.join(', ')}.` : '';
}
