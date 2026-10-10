import { findModelContext } from './types.ts';

/*
 * The only WebMCP code in the main bundle. It waits for an idle moment and
 * loads the real module (register.ts and the tools) only if the browser has
 * `document.modelContext` (or the older `navigator.modelContext`), so
 * browsers without WebMCP download and run next to nothing.
 */
const start = () => {
  const context = findModelContext();
  if (!context) return;
  void import('./register.ts').then((module) => module.startWebMcp(context));
};

if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) window.requestIdleCallback(start);
  else setTimeout(start, 2000);
}
