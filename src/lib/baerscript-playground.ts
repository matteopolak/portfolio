import Prism from 'prismjs';
import { initializeCodePlayground } from './code-playground';
import BaerscriptWorker from './baerscript-worker?worker';

Prism.languages.baerscript = {
  comment: /#.*/,
  operator: /[.+*<>^v-]|\[|\]/,
};

export function initializeBaerscriptPlayground(
  root: HTMLElement,
  signal: AbortSignal
) {
  return initializeCodePlayground(root, signal, {
    createWorker: () =>
      new BaerscriptWorker({ name: 'baerscript-interpreter' }),
    highlight: (source) =>
      Prism.highlight(source, Prism.languages.baerscript, 'baerscript'),
  });
}
