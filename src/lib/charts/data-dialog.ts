/*
 * The "Data" button on blog charts (ChartShell.svelte): opens one shared
 * dialog with the chart's table and a CSV download. The table itself is
 * server-rendered (visually hidden) in every chart, so this only clones it;
 * charts stay static SVG and need no hydration for this.
 */
import { closeAnimated, openDialog } from '../dialog-lifecycle.ts';

let dialog: HTMLDialogElement | undefined;
let currentCsv = '';
let currentName = 'chart';

/** RFC 4180 quoting: wrap fields that contain a comma, quote or newline. */
const csvField = (text: string) =>
  /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

export function tableToCsv(table: HTMLTableElement): string {
  return [...table.rows]
    .map((row) =>
      [...row.cells]
        .map((cell) => csvField(cell.textContent?.trim() ?? ''))
        .join(',')
    )
    .join('\r\n');
}

export const csvFileName = (title: string) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'chart'
  }.csv`;

function ensureDialog(): HTMLDialogElement {
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'chart-dialog';
  dialog.setAttribute('aria-labelledby', 'chart-dialog-title');
  dialog.innerHTML = `
    <div class="chart-dialog__head">
      <h2 id="chart-dialog-title"></h2>
      <button type="button" class="chart-dialog__close" aria-label="Close" data-close>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>
      </button>
    </div>
    <div class="chart-dialog__scroll" tabindex="0" aria-label="Chart data"></div>
    <div class="chart-dialog__actions">
      <button type="button" class="chart-dialog__download" data-download>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"/></svg>
        Download CSV
      </button>
    </div>`;
  const close = () => closeAnimated(dialog);
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.querySelector('[data-download]')!.addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([currentCsv], { type: 'text/csv' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = currentName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  // Escape and backdrop clicks close through the same exit animation.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog!.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) close();
  });
  document.body.append(dialog);
  return dialog;
}

function open(figure: HTMLElement, opener: HTMLElement) {
  const source = figure.querySelector<HTMLTableElement>(
    '[data-chart-table] table'
  );
  if (!source) return;
  const title =
    figure.querySelector('.chart__title')?.textContent?.trim() || 'Chart data';
  const table = source.cloneNode(true) as HTMLTableElement;
  table.querySelector('caption')?.remove();
  currentCsv = tableToCsv(table);
  currentName = csvFileName(title);
  const target = ensureDialog();
  target.querySelector('h2')!.textContent = title;
  target.querySelector('.chart-dialog__scroll')!.replaceChildren(table);
  target.addEventListener('close', () => opener.focus(), { once: true });
  openDialog(target);
}

let wired = false;

/** Reveals the Data buttons on the current page; safe to call on every navigation. */
export function enhanceChartData() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-chart-data]'
  )) {
    button.hidden = false;
  }
  if (wired) return;
  wired = true;
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-chart-data]'
    );
    const figure = button?.closest<HTMLElement>('figure');
    if (button && figure) open(figure, button);
  });
}
