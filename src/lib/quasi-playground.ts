import { initializeCodePlayground } from './code-playground';
import QuasiWorker from './quasi-worker?worker';
export function initializeQuasiPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  return initializeCodePlayground(root, signal, {
    createWorker: () => new QuasiWorker(),
    language: 'quasi',
  });
}
