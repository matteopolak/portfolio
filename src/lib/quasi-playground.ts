import Prism from 'prismjs';
import 'prismjs/components/prism-rust';
import { initializeCodePlayground } from './code-playground';
import QuasiWorker from './quasi-worker?worker';

export function initializeQuasiPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  return initializeCodePlayground(root, signal, {
    createWorker: () => new QuasiWorker({ name: 'quasi-interpreter' }),
    highlight: (source) =>
      Prism.highlight(source, Prism.languages.rust, 'rust'),
  });
}
