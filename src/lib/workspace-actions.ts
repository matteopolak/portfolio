/*
 * DOM side of "Import folder" and "Reset workspace": the folder picker, reading
 * the picked files and the small confirmation dialog. The rules (filters, caps,
 * entry file) are in workspace-import.ts.
 */
import { closeAnimated } from './dialog-lifecycle.ts';
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
    const icon = document.createElement('span');
    icon.className = 'ide-confirm__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = WARNING_ICON;
    const heading = document.createElement('h2');
    heading.id = 'ide-confirm-title';
    heading.textContent = title;
    const text = document.createElement('p');
    text.id = 'ide-confirm-message';
    text.textContent = message;
    const body = document.createElement('div');
    body.className = 'ide-confirm__body';
    body.append(heading, text);
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
    dialog.append(icon, body, actions);
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      resolve(answer);
      // Same exit animation as the demo dialogs; removed once really closed.
      closeAnimated(dialog);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    // Escape cancels, but through the exit animation rather than an instant close.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    // A click outside the dialog's box lands on the backdrop: that cancels too.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) finish(false);
    });
    dialog.addEventListener('close', () => {
      finish(false);
      dialog.remove();
    });
    panel.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

const WARNING_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

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
