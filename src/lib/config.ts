import rawToml from '../../portfolio.toml?raw';
import { parse } from 'smol-toml';
import type { Config } from '../types/config';

const config = parse(rawToml) as Config;

export default config;

export const jobs = config.job.filter((j) => j.enabled !== false);
export const projects = config.project.filter((p) => p.enabled !== false);

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
}
