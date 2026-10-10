/*
 * `pnpm lighthouse [--no-upload]`: runs Lighthouse CI over the built site
 * (`pnpm build` first) for the mobile and desktop presets and saves the
 * reports to .lighthouseci/<preset>/. See docs/performance.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const macChrome =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const env = { ...process.env };
if (!env.CHROME_PATH && existsSync(macChrome)) env.CHROME_PATH = macChrome;

let failed = false;
for (const formFactor of ['mobile', 'desktop']) {
  console.log(`\n== Lighthouse (${formFactor}) ==`);
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'lhci',
      'autorun',
      '--upload.target=filesystem',
      `--upload.outputDir=.lighthouseci/${formFactor}`,
    ],
    { stdio: 'inherit', env: { ...env, LHCI_FORM_FACTOR: formFactor } }
  );
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
