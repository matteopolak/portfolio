/*
 * DOM side of "Import folder" and "Reset workspace": the folder picker, reading
 * the picked files and the small confirmation dialog. The rules (filters, caps,
 * entry file) are in workspace-import.ts.
 */
import {
  entryPath,
  looksBinary,
  normalizeImportPath,
  planImport,
  skippedSummary,
} from './workspace-import.ts';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

/** A modal dialog styled like the site (see CodeWorkspace.svelte); resolves true on confirm. */
export function confirmDialog(
  panel: HTMLElement,
  { title, message, confirmLabel }: ConfirmOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ide-confirm';
    dialog.setAttribute('aria-labelledby', 'ide-confirm-title');
    dialog.setAttribute('aria-describedby', 'ide-confirm-message');
    const heading = document.createElement('h2');
    heading.id = 'ide-confirm-title';
    heading.textContent = title;
    const text = document.createElement('p');
    text.id = 'ide-confirm-message';
    text.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'ide-confirm__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'ide-confirm__danger';
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);
    dialog.append(heading, text, actions);
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(answer);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    // Escape closes the dialog: that cancels.
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    panel.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

/** Opens the browser's folder picker; resolves undefined when it is cancelled. */
export function pickFolder(): Promise<File[] | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.multiple = true;
    input.hidden = true;
    const finish = (files: File[] | undefined) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () =>
      finish(input.files?.length ? [...input.files] : undefined)
    );
    input.addEventListener('cancel', () => finish(undefined));
    document.body.append(input);
    input.click();
  });
}

export type FolderImport =
  | {
      ok: true;
      files: Record<string, string>;
      entry: string;
      /** e.g. "Imported 12 files. Skipped 3 ignored." */
      summary: string;
    }
  | { ok: false; message: string };

/** Reads a picked folder's files into a path -> text map, applying the import rules. */
export async function readFolder(
  files: readonly File[],
  entryName: string
): Promise<FolderImport> {
  const plan = planImport(
    files.map((file) => ({
      path: file.webkitRelativePath || file.name,
      size: file.size,
    }))
  );
  if (plan.error) return { ok: false, message: plan.error };
  const byPath = new Map<string, File>();
  for (const file of files) {
    const path = normalizeImportPath(file.webkitRelativePath || file.name);
    if (path !== undefined) byPath.set(path, file);
  }
  const texts: Record<string, string> = {};
  let binary = plan.skipped.binary;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  for (const { path } of plan.accepted) {
    const source = byPath.get(path);
    if (!source) continue;
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (looksBinary(bytes)) {
      binary += 1;
      continue;
    }
    texts[path] = decoder.decode(bytes);
  }
  const paths = Object.keys(texts);
  if (!paths.length)
    return { ok: false, message: 'That folder has no text files to import.' };
  const entry = entryPath(paths, entryName)!;
  const skipped = skippedSummary({ ...plan.skipped, binary });
  return {
    ok: true,
    files: texts,
    entry,
    summary:
      `Imported ${paths.length} file${paths.length === 1 ? '' : 's'}.` +
      (skipped ? ' ' + skipped : ''),
  };
}
