/// <reference types="astro/client" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chrome origin-trial token for WebMCP, set at build time (docs/webmcp.md). */
  readonly PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN?: string;
}
