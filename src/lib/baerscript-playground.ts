import Prism from 'prismjs';
import { initializeCodePlayground } from './code-playground';

Prism.languages.baerscript = {
  comment: /#.*/,
  operator: /[.+*<>^v-]|\[|\]/,
};

export function initializeBaerscriptPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  return initializeCodePlayground(root, signal, {
    workerUrl: new URL('./baerscript-worker.ts', import.meta.url),
    workerName: 'baerscript-interpreter',
    highlight: (source) =>
      Prism.highlight(source, Prism.languages.baerscript, 'baerscript'),
  });
}
