import { navigate as astroNavigate } from 'astro:transitions/client';
import { activeRunTarget, onRunTargetsChange } from '../run-target.ts';
import { chooseTheme, currentTheme } from '../theme-client.ts';
import { createToolRegistry } from './registry.ts';
import { toolsForPage, type AgentData, type ToolDeps } from './tools.ts';
import type { ModelContextLike } from './types.ts';

const cache = new Map<string, Promise<unknown>>();

/** Same-origin fetch of the build-time JSON; cached, and retried after a failure. */
function load<K extends keyof AgentData>(name: K): Promise<AgentData[K]> {
  let pending = cache.get(name);
  if (!pending) {
    pending = fetch(`/agent/${name}.json`, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${name} data.`);
        return response.json();
      })
      .catch((error) => {
        cache.delete(name);
        throw error;
      });
    cache.set(name, pending);
  }
  return pending as Promise<AgentData[K]>;
}

const deps: ToolDeps = {
  load,
  navigate(path) {
    // ClientRouter is on every page but the playgrounds, which load fully.
    if (document.querySelector('meta[name="astro-view-transitions-enabled"]'))
      void astroNavigate(path);
    else location.assign(path);
  },
  theme: { current: currentTheme, choose: chooseTheme },
  runTarget: activeRunTarget,
};

/** Registers the tools and keeps them in step with the page. Loaded lazily by boot.ts. */
export function startWebMcp(context: ModelContextLike) {
  const registry = createToolRegistry(context);
  const sync = () => registry.sync(toolsForPage(deps));
  sync();
  // Under ClientRouter a new page may add or drop `run_code`.
  document.addEventListener('astro:page-load', sync);
  // A playground mounting or a demo modal opening changes the set too.
  onRunTargetsChange(sync);
}
