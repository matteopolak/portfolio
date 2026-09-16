import Prism from 'prismjs';
import 'prismjs/components/prism-rust';
import { initializeCodePlayground } from './code-playground';

export function initializeQuasiPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  return initializeCodePlayground(root, signal, {
    workerUrl: new URL('./quasi-worker.ts', import.meta.url),
    workerName: 'quasi-interpreter',
    highlight: (source) =>
      Prism.highlight(source, Prism.languages.rust, 'rust'),
  });
}
