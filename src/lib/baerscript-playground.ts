import { initializeCodePlayground } from './code-playground';
import BaerscriptWorker from './baerscript-worker?worker';
export function initializeBaerscriptPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  return initializeCodePlayground(root, signal, {
    createWorker: () =>
      new BaerscriptWorker({ name: 'baerscript-interpreter' }),
    language: 'baerscript',
  });
}
